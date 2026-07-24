/*
 * PyWebLib community gallery: browse shared programs, upvote, open one back in
 * the Playground, and read/leave comments. Publishing happens on the Playground
 * (publish.js). Everything here no-ops gracefully until Supabase is configured.
 */
(function () {
  "use strict";

  const PWL = window.PWL || {};
  const sb = PWL.supabase;
  const grid = document.getElementById("community-grid");
  const notice = document.getElementById("community-notice");
  const toolbar = document.getElementById("community-toolbar");
  if (!grid) return;

  if (!PWL.configured || !sb) {
    if (notice) notice.hidden = false;
    if (toolbar) toolbar.hidden = true;
    grid.hidden = true;
    return;
  }

  const params = new URLSearchParams(location.search);
  const mineOnly = params.get("mine") === "1";
  let sort = "top";
  let projects = [];
  let votedSet = new Set();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    const s = Math.max(1, Math.floor((Date.now() - then) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); if (d < 30) return d + "d ago";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  function toast(msg) {
    let t = document.getElementById("pwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "pwl-toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  function avatarOf(profile) {
    const url = profile && profile.avatar_url;
    const name = (profile && profile.display_name) || "Someone";
    if (url) return '<img class="pwl-avatar sm" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer" />';
    return '<span class="pwl-avatar sm pwl-avatar-text">' + esc((name[0] || "?").toUpperCase()) + '</span>';
  }
  function nameOf(profile) { return esc((profile && profile.display_name) || "Someone"); }

  async function refresh() {
    grid.hidden = false;
    grid.innerHTML = '<p class="community-empty">Loading…</p>';
    const user = PWL.auth && PWL.auth.user();

    let q = sb.from("projects").select(
      "id,title,description,code,kind,vote_count,created_at,author_id," +
      "profiles(display_name,avatar_url),comments(count)"
    );
    if (mineOnly && user) q = q.eq("author_id", user.id);
    q = sort === "new"
      ? q.order("created_at", { ascending: false })
      : q.order("vote_count", { ascending: false }).order("created_at", { ascending: false });

    const { data, error } = await q.limit(100);
    if (error) {
      grid.innerHTML = '<p class="community-empty">Could not load programs: ' + esc(error.message) + "</p>";
      return;
    }
    projects = data || [];

    votedSet = new Set();
    if (user && projects.length) {
      const res = await sb.from("votes").select("project_id").eq("user_id", user.id);
      votedSet = new Set((res.data || []).map(function (r) { return r.project_id; }));
    }
    renderGrid();
  }

  function renderGrid() {
    if (!projects.length) {
      grid.innerHTML = '<p class="community-empty">' +
        (mineOnly
          ? "You haven't shared anything yet. Open the Playground and hit Share."
          : "No programs yet. Be the first, open the Playground and hit Share!") +
        "</p>";
      return;
    }
    grid.innerHTML = "";
    projects.forEach(function (p) {
      const commentCount = (p.comments && p.comments[0] && p.comments[0].count) || 0;
      const voted = votedSet.has(p.id);
      const card = document.createElement("article");
      card.className = "community-card";
      card._p = p;
      card.innerHTML =
        '<div class="cc-head">' +
          '<span class="cc-kind cc-kind-' + esc(p.kind) + '">' + esc(p.kind) + "</span>" +
          '<h3 class="cc-title"></h3>' +
        "</div>" +
        '<p class="cc-desc"></p>' +
        '<div class="cc-author">' + avatarOf(p.profiles) + "<span>" + nameOf(p.profiles) +
          ' &middot; ' + esc(timeAgo(p.created_at)) + "</span></div>" +
        '<div class="cc-actions">' +
          '<button type="button" class="cc-vote' + (voted ? " voted" : "") + '" data-act="vote" title="Upvote">' +
            '<span class="cc-arrow">&#9650;</span> <span class="cc-votes">' + p.vote_count + "</span></button>" +
          '<button type="button" class="cc-btn" data-act="open">Open in Playground</button>' +
          '<button type="button" class="cc-btn" data-act="detail">&#128172; ' + commentCount + "</button>" +
        "</div>";
      card.querySelector(".cc-title").textContent = p.title;
      const desc = card.querySelector(".cc-desc");
      if (p.description) desc.textContent = p.description; else desc.remove();
      card.querySelector('[data-act="vote"]').addEventListener("click", function () { toggleVote(p, card); });
      card.querySelector('[data-act="open"]').addEventListener("click", function () { openInPlayground(p); });
      card.querySelector('[data-act="detail"]').addEventListener("click", function () { openDetail(p); });
      grid.appendChild(card);
    });
  }

  async function toggleVote(p, card) {
    if (!PWL.auth || !PWL.auth.requireSignIn()) return;
    const uid = PWL.auth.user().id;
    const wasVoted = votedSet.has(p.id);
    // Optimistic update.
    if (wasVoted) { votedSet.delete(p.id); p.vote_count = Math.max(0, p.vote_count - 1); }
    else { votedSet.add(p.id); p.vote_count += 1; }
    paintVote(card, p);
    try {
      if (wasVoted) {
        await sb.from("votes").delete().eq("project_id", p.id).eq("user_id", uid);
      } else {
        await sb.from("votes").insert({ project_id: p.id, user_id: uid });
      }
    } catch (e) {
      // Revert on failure.
      if (wasVoted) { votedSet.add(p.id); p.vote_count += 1; }
      else { votedSet.delete(p.id); p.vote_count = Math.max(0, p.vote_count - 1); }
      paintVote(card, p);
      toast("Vote didn't save, try again.");
    }
  }
  function paintVote(card, p) {
    const btn = card.querySelector('[data-act="vote"]');
    if (!btn) return;
    btn.classList.toggle("voted", votedSet.has(p.id));
    btn.querySelector(".cc-votes").textContent = p.vote_count;
  }

  function openInPlayground(p) {
    try { localStorage.setItem("pyweblib-load", p.code); } catch (e) {}
    // Community lives at /community/, the Playground one level up.
    window.location.href = "../";
  }

  // ---- Detail modal with comments ----
  function openDetail(p) {
    const back = document.createElement("div");
    back.className = "pwl-modal-back";
    back.innerHTML =
      '<div class="pwl-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="pwl-modal-x" aria-label="Close">&times;</button>' +
        '<span class="cc-kind cc-kind-' + esc(p.kind) + '">' + esc(p.kind) + "</span>" +
        '<h2 class="pwl-modal-title"></h2>' +
        '<div class="cc-author">' + avatarOf(p.profiles) + "<span>" + nameOf(p.profiles) + "</span></div>" +
        '<p class="pwl-modal-desc"></p>' +
        '<pre class="pwl-modal-code"></pre>' +
        '<div class="pwl-modal-actions">' +
          '<button type="button" class="btn btn-primary" data-act="open">Open in Playground</button>' +
        "</div>" +
        '<h3 class="pwl-comments-h">Comments</h3>' +
        '<div class="pwl-comments" id="pwl-comments">Loading…</div>' +
        '<form class="pwl-comment-form" id="pwl-comment-form" hidden>' +
          '<input type="text" maxlength="1000" placeholder="Add a comment…" aria-label="Add a comment" />' +
          '<button type="submit" class="btn btn-primary">Post</button>' +
        "</form>" +
        '<p class="pwl-comment-signin" id="pwl-comment-signin" hidden>Sign in to join the conversation.</p>' +
      "</div>";
    back.querySelector(".pwl-modal-title").textContent = p.title;
    const md = back.querySelector(".pwl-modal-desc");
    if (p.description) md.textContent = p.description; else md.remove();
    back.querySelector(".pwl-modal-code").textContent = p.code;

    function close() { back.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.querySelector(".pwl-modal-x").addEventListener("click", close);
    back.querySelector('[data-act="open"]').addEventListener("click", function () { openInPlayground(p); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);

    loadComments(p, back);
  }

  async function loadComments(p, back) {
    const box = back.querySelector("#pwl-comments");
    const form = back.querySelector("#pwl-comment-form");
    const signin = back.querySelector("#pwl-comment-signin");
    const user = PWL.auth && PWL.auth.user();
    if (user) form.hidden = false; else signin.hidden = false;

    const { data, error } = await sb.from("comments")
      .select("id,body,created_at,user_id,profiles(display_name,avatar_url)")
      .eq("project_id", p.id).order("created_at", { ascending: true });
    if (error) { box.textContent = "Could not load comments."; return; }

    function render(list) {
      if (!list.length) { box.innerHTML = '<p class="pwl-comments-empty">No comments yet. Say something nice!</p>'; return; }
      box.innerHTML = "";
      list.forEach(function (c) {
        const row = document.createElement("div");
        row.className = "pwl-comment";
        row.innerHTML =
          avatarOf(c.profiles) +
          '<div class="pwl-comment-body"><span class="pwl-comment-name">' + nameOf(c.profiles) +
          ' <span class="pwl-comment-when">' + esc(timeAgo(c.created_at)) + "</span></span>" +
          '<span class="pwl-comment-text"></span></div>' +
          (user && c.user_id === user.id ? '<button type="button" class="pwl-comment-del" title="Delete">&times;</button>' : "");
        row.querySelector(".pwl-comment-text").textContent = c.body;
        const del = row.querySelector(".pwl-comment-del");
        if (del) del.addEventListener("click", async function () {
          await sb.from("comments").delete().eq("id", c.id);
          list = list.filter(function (x) { return x.id !== c.id; });
          render(list);
        });
        box.appendChild(row);
      });
    }
    let comments = data || [];
    render(comments);

    if (user) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        const input = form.querySelector("input");
        const body = (input.value || "").trim();
        if (!body) return;
        input.value = "";
        const ins = await sb.from("comments")
          .insert({ project_id: p.id, user_id: user.id, body: body })
          .select("id,body,created_at,user_id,profiles(display_name,avatar_url)").single();
        if (ins.error) { toast("Comment didn't post."); return; }
        comments.push(ins.data);
        render(comments);
      });
    }
  }

  // ---- Sort tabs ----
  document.querySelectorAll(".community-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".community-tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      sort = tab.getAttribute("data-sort") || "top";
      refresh();
    });
  });

  // Re-fetch when auth changes (to light up the user's own votes).
  document.addEventListener("pwl:auth", refresh);
  refresh();
})();
