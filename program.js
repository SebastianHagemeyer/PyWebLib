/*
 * PyWebLib program page (/game/?id=<uuid>): a shareable page for a single
 * shared program. Shows a preview you can Play inline (no Playground needed),
 * the description and code, an upvote and comments, plus "Open in the
 * Playground" (which binds the editor to this program) and "Copy link".
 */
(function () {
  "use strict";

  const PWL = window.PWL || {};
  const sb = PWL.supabase;
  const notice = document.getElementById("pg-notice");
  const view = document.getElementById("pg-view");
  if (!view) return;

  const id = new URLSearchParams(location.search).get("id");

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
  function whenLabel(p) {
    const made = new Date(p.created_at).getTime();
    const edited = new Date(p.updated_at || p.created_at).getTime();
    if (edited && made && edited - made > 60000) return "updated " + timeAgo(p.updated_at);
    return timeAgo(p.created_at);
  }
  function avatarOf(profile) {
    const url = profile && profile.avatar_url;
    const cross = window.crossOriginIsolated ? ' crossorigin="anonymous"' : "";
    const photo = url ? '<img class="pwl-avatar-photo" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer"' + cross + ' onerror="this.remove()" />' : "";
    return '<span class="pwl-avatar sm"><svg class="pwl-avatar-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M12 14.4c-4.3 0-7.8 2.7-7.8 6.1V24h15.6v-3.5c0-3.4-3.5-6.1-7.8-6.1z"/></svg>' + photo + "</span>";
  }
  function nameOf(profile) { return esc((profile && profile.display_name) || "Someone"); }
  const EYE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  function viewsHtml(n) { return '<span class="pg-views" title="Views">' + EYE_SVG + " " + (Number(n) || 0) + "</span>"; }
  // Opening the program page is a view: count it once per browser session (so a
  // refresh doesn't inflate it) and optimistically bump the number on the page.
  function countView(p) {
    try {
      const k = "pwl-viewed:" + p.id;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch (e) {}
    p.view_count = (Number(p.view_count) || 0) + 1;
    const el = view.querySelector(".pg-views");
    if (el) el.innerHTML = EYE_SVG + " " + p.view_count;
    // supabase-js queries are lazy: they only send once awaited or .then()'d.
    try { sb.rpc("increment_view", { pid: p.id }).then(null, function () {}); } catch (e) {}
  }
  function toast(msg) {
    let t = document.getElementById("pwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "pwl-toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove("show"); }, 3000);
  }
  function showNotice(msg) {
    if (notice) { notice.textContent = msg; notice.hidden = false; }
    view.hidden = true;
  }

  if (!PWL.configured || !sb) {
    showNotice("The community isn't switched on yet. It needs a Supabase project with Google sign-in.");
    return;
  }
  if (!id) {
    showNotice("No program was named. Browse the community to find one.");
    return;
  }

  async function load() {
    function cols(withViews) {
      return "id,title,description,code,kind,scene,vote_count," + (withViews ? "view_count," : "") +
        "created_at,updated_at,author_id,profiles!author_id(display_name,avatar_url),comments(count)";
    }
    // Ask for view_count, but tolerate a database that hasn't added it yet.
    let res = await sb.from("projects").select(cols(true)).eq("id", id).single();
    if (res.error && /view_count/i.test(res.error.message || "")) {
      res = await sb.from("projects").select(cols(false)).eq("id", id).single();
    }
    const { data, error } = res;
    if (error || !data) {
      showNotice("That program couldn't be found. It may have been deleted.");
      return;
    }
    render(data);
  }

  function render(p) {
    document.title = (p.title || "Program") + " | PyWebLib";
    const kind = p.kind || "python";
    const playLabel = kind === "game" ? "Play" : "Run";
    // A game that calls game.submit_score() gets a per-game leaderboard: one
    // best score per signed-in player, submitted automatically as they play.
    const hasLeaderboard = kind === "game" && /game\s*\.\s*submit_score/.test(p.code || "");
    let runBest = null;

    async function loadLeaderboard() {
      const box = view.querySelector(".pg-lb-body");
      if (!box) return;
      const res = await sb.from("game_scores")
        .select("score,user_id,profiles(display_name,avatar_url)")
        .eq("project_id", p.id).order("score", { ascending: false }).limit(10);
      if (res.error) { box.textContent = "Could not load scores."; return; }
      renderLeaderboard(res.data || []);
    }
    function renderLeaderboard(rows) {
      const box = view.querySelector(".pg-lb-body");
      if (!box) return;
      const user = PWL.auth && PWL.auth.user();
      if (!rows.length) {
        box.innerHTML = '<p class="pg-lb-empty">No scores yet. Play to be the first!</p>';
      } else {
        box.innerHTML = rows.map(function (r, i) {
          const me = user && r.user_id === user.id ? " me" : "";
          return '<div class="pg-lb-row' + me + '"><span class="pg-lb-rank">' + (i + 1) + "</span>" +
            avatarOf(r.profiles) + '<span class="pg-lb-name">' + nameOf(r.profiles) +
            '</span><span class="pg-lb-score">' + Number(r.score) + "</span></div>";
        }).join("");
      }
      if (!user) box.innerHTML += '<p class="pg-lb-signin">Sign in and play to get on the board.</p>';
    }
    async function submitScore(points) {
      points = Number(points);
      const user = PWL.auth && PWL.auth.user();
      if (!user || !isFinite(points)) return;
      points = Math.floor(points);
      if (runBest != null && points <= runBest) return;   // not better than this run
      runBest = points;
      try {
        const cur = await sb.from("game_scores").select("score")
          .eq("project_id", p.id).eq("user_id", user.id).maybeSingle();
        if (!(cur.data && Number(cur.data.score) >= points)) {   // keep only your best
          await sb.from("game_scores").upsert(
            { project_id: p.id, user_id: user.id, score: points, updated_at: new Date().toISOString() },
            { onConflict: "project_id,user_id" });
        }
      } catch (e) {}
      loadLeaderboard();
    }

    view.hidden = false;
    view.innerHTML =
      '<div class="cc-head">' +
        '<span class="cc-kind cc-kind-' + esc(kind) + '">' + esc(kind) + "</span>" +
        '<h1 class="pg-title"></h1>' +
      "</div>" +
      '<div class="cc-author">' + avatarOf(p.profiles) + "<span>" + nameOf(p.profiles) +
        " &middot; " + esc(whenLabel(p)) + "</span>" + viewsHtml(p.view_count) + "</div>" +
      '<div class="pg-stage">' +
        '<div class="pg-play" id="pg-play"></div>' +
        (hasLeaderboard ? '<aside class="pg-leaderboard" id="pg-leaderboard"><h2 class="pg-lb-title">Leaderboard</h2><div class="pg-lb-body">Loading…</div></aside>' : "") +
      "</div>" +
      '<p class="pg-desc"></p>' +
      '<div class="pg-actions">' +
        '<button type="button" class="btn btn-primary" id="pg-open">Open in the Playground</button>' +
        '<button type="button" class="cc-vote" id="pg-vote" title="Upvote">' +
          '<span class="cc-arrow"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 4l5 6.5H3z" fill="currentColor"/></svg></span> ' +
          '<span class="cc-votes">' + p.vote_count + "</span></button>" +
        '<button type="button" class="btn btn-ghost" id="pg-copy">Copy link</button>' +
      "</div>" +
      '<details class="pg-code-wrap"' + (kind === "game" ? "" : " open") + '>' +
        '<summary class="pg-code-summary">Code</summary>' +
        '<pre class="pwl-modal-code pg-code"></pre>' +
      "</details>" +
      '<h2 class="pg-h">Comments</h2>' +
      '<div class="pwl-comments" id="pg-comments">Loading…</div>' +
      '<form class="pwl-comment-form" id="pg-comment-form" hidden>' +
        '<input type="text" maxlength="1000" placeholder="Add a comment…" aria-label="Add a comment" />' +
        '<button type="submit" class="btn btn-primary">Post</button>' +
      "</form>" +
      '<p class="pwl-comment-signin" id="pg-comment-signin" hidden>Sign in to join the conversation.</p>';

    view.querySelector(".pg-title").textContent = p.title || "Untitled";
    const desc = view.querySelector(".pg-desc");
    if (p.description) desc.textContent = p.description; else desc.remove();
    view.querySelector(".pg-code").textContent = p.code;

    // Poster with a Play overlay: click it to run inline, no Playground needed.
    const playHost = view.querySelector("#pg-play");
    playHost.innerHTML =
      '<div class="pg-poster">' +
        '<canvas class="pg-poster-canvas" width="480" height="270"></canvas>' +
        '<button type="button" class="pg-play-btn"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3l9 5-9 5z" fill="currentColor"/></svg> ' + playLabel + "</button>" +
      "</div>";
    const posterCanvas = playHost.querySelector(".pg-poster-canvas");
    if (window.PWL.preview) { try { window.PWL.preview.renderInto(posterCanvas, p.code, p.scene); } catch (e) {} }
    playHost.querySelector(".pg-play-btn").addEventListener("click", function () {
      if (!window.PWL.player) { toast("The player isn't ready, try refreshing."); return; }
      runBest = null;   // a fresh play resets the best-of-this-run guard
      window.PWL.player.mount(playHost, { code: p.code, kind: kind, title: p.title },
        hasLeaderboard ? { onScore: submitScore } : null);
    });
    if (hasLeaderboard) loadLeaderboard();

    // Open in the Playground, bound to this program so a re-share updates it.
    view.querySelector("#pg-open").addEventListener("click", function () {
      try {
        localStorage.setItem("pyweblib-load", p.code);
        localStorage.setItem("pyweblib-bind", JSON.stringify({ id: p.id, title: p.title, author_id: p.author_id, published: p.published }));
      } catch (e) {}
      window.location.href = "../";
    });

    view.querySelector("#pg-copy").addEventListener("click", function () {
      const url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast("Link copied!"); }, function () { toast(url); });
      } else { toast(url); }
    });

    wireVote(p);
    loadComments(p);
    countView(p);
  }

  async function wireVote(p) {
    const btn = document.getElementById("pg-vote");
    let voted = false;
    const user = PWL.auth && PWL.auth.user();
    if (user) {
      const r = await sb.from("votes").select("project_id").eq("user_id", user.id).eq("project_id", p.id);
      voted = !!(r.data && r.data.length);
      btn.classList.toggle("voted", voted);
    }
    btn.addEventListener("click", async function () {
      if (!PWL.auth || !PWL.auth.requireSignIn()) return;
      const uid = PWL.auth.user().id;
      voted = !voted;
      p.vote_count = Math.max(0, p.vote_count + (voted ? 1 : -1));
      btn.classList.toggle("voted", voted);
      btn.querySelector(".cc-votes").textContent = p.vote_count;
      try {
        if (voted) await sb.from("votes").insert({ project_id: p.id, user_id: uid });
        else await sb.from("votes").delete().eq("project_id", p.id).eq("user_id", uid);
      } catch (e) {
        voted = !voted;
        p.vote_count = Math.max(0, p.vote_count + (voted ? 1 : -1));
        btn.classList.toggle("voted", voted);
        btn.querySelector(".cc-votes").textContent = p.vote_count;
        toast("Vote didn't save, try again.");
      }
    });
  }

  async function loadComments(p) {
    const box = document.getElementById("pg-comments");
    const form = document.getElementById("pg-comment-form");
    const signin = document.getElementById("pg-comment-signin");
    const user = PWL.auth && PWL.auth.user();
    if (user) form.hidden = false; else signin.hidden = false;

    const { data, error } = await sb.from("comments")
      .select("id,body,created_at,user_id,profiles(display_name,avatar_url)")
      .eq("project_id", p.id).order("created_at", { ascending: true });
    if (error) { box.textContent = "Could not load comments."; return; }
    let comments = data || [];

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
          comments = comments.filter(function (x) { return x.id !== c.id; });
          render(comments);
        });
        box.appendChild(row);
      });
    }
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

  // Re-run once auth resolves (so votes/comments reflect the signed-in user).
  let loaded = false;
  function start() { if (loaded) return; loaded = true; load(); }
  document.addEventListener("pwl:auth", function () { /* auth affects vote/comment UI on next load */ });
  start();
})();
