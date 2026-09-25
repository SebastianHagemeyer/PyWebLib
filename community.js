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
  const pager = document.getElementById("cc-pager");
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
  let sort = "trending";     // the gallery opens on this week's best
  const TRENDING_DAYS = 7;   // how far back the Trending tab looks
  function sinceDaysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }
  const PAGE_SIZE = 6;
  let page = 0;          // 0-based current page
  let totalCount = 0;    // total projects matching the current filter
  let projects = [];
  let votedSet = new Set();
  let currentUserId = null;
  let isAdmin = false;       // moderator: can rename/delete any post (checked once)
  let adminChecked = false;
  let pubSupported = true;   // set false once we learn the DB has no `published` column
  let featSupported = true;  // ditto for `featured` (pinned posts)
  let pinned = [];           // the pins that exist
  let featured = [];         // the pins actually being shown (page one only)
  // A pin is only an advert while it is rare, and this must stay BELOW
  // PAGE_SIZE so page one always has room for ordinary programs too.
  const FEATURED_MAX = 3;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Escape a comment body, then turn bare http(s) links into safe anchors.
  function linkify(s) {
    const str = String(s == null ? "" : s);
    const re = /(https?:\/\/[^\s<>"']+)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(str))) {
      out += esc(str.slice(last, m.index));
      let url = m[1], trail = "";
      const t = url.match(/[.,!?;:)\]]+$/);
      if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
      const safe = esc(url);
      out += '<a href="' + safe + '" target="_blank" rel="noopener noreferrer nofollow">' + safe + "</a>" + esc(trail);
      last = m.index + m[1].length;
    }
    out += esc(str.slice(last));
    return out;
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
  // Show "updated Xd ago" once a post has been edited (its updated_at pulls
  // meaningfully ahead of created_at), otherwise just when it was shared.
  function whenLabel(p) {
    const made = new Date(p.created_at).getTime();
    const edited = new Date(p.updated_at || p.created_at).getTime();
    if (edited && made && edited - made > 60000) return "updated " + timeAgo(p.updated_at);
    return timeAgo(p.created_at);
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
    // Person silhouette sits underneath; the photo overlays it and drops out
    // (onerror) if it can't load. crossorigin lets it pass COEP when the page is
    // cross-origin isolated (Safari), where a plain <img> would be blocked.
    const cross = window.crossOriginIsolated ? ' crossorigin="anonymous"' : "";
    const photo = url ? '<img class="pwl-avatar-photo" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer"' + cross + ' onerror="this.remove()" />' : "";
    return '<span class="pwl-avatar sm"><svg class="pwl-avatar-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M12 14.4c-4.3 0-7.8 2.7-7.8 6.1V24h15.6v-3.5c0-3.4-3.5-6.1-7.8-6.1z"/></svg>' + photo + "</span>";
  }

  const EYE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  function viewsHtml(n) { return '<span class="cc-views" title="Views">' + EYE_SVG + " " + (Number(n) || 0) + "</span>"; }
  // Count a view once per program per browser session (so refreshes and repeat
  // clicks don't inflate it), and optimistically bump the card's counter.
  function countView(p, card) {
    try {
      const k = "pwl-viewed:" + p.id;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch (e) {}
    p.view_count = (Number(p.view_count) || 0) + 1;
    const el = card && card.querySelector(".cc-views");
    if (el) el.innerHTML = EYE_SVG + " " + p.view_count;
    // supabase-js queries are lazy: they only send once awaited or .then()'d.
    try { sb.rpc("increment_view", { pid: p.id }).then(null, function () {}); } catch (e) {}
  }
  function nameOf(profile) { return esc((profile && profile.display_name) || "Someone"); }

  // Pins sit on page one and count toward its six, so page one holds fewer
  // ordinary programs and every later page starts that much earlier. Without
  // the shift, page one showed seven cards and page two repeated one of them.
  function firstPageRoom() {
    return Math.max(1, PAGE_SIZE - Math.min(pinned.length, PAGE_SIZE - 1));
  }
  function pageCount() {
    const rest = Math.max(0, totalCount - firstPageRoom());
    return Math.max(1, 1 + Math.ceil(rest / PAGE_SIZE));
  }

  // The row shape both the paged list and the pinned strip ask for. The two
  // optional columns are there so a database that has not had the migrations
  // run still loads the gallery instead of erroring out.
  function cols(withViews, withPub, withFeat) {
    return "id,title,description,code,kind,scene,vote_count," +
      (withPub ? "published," : "") + (withViews ? "view_count," : "") +
      (withFeat ? "featured,featured_at," : "") +
      "created_at,updated_at,author_id,profiles!author_id(display_name,avatar_url),comments(count)";
  }

  async function refresh() {
    grid.hidden = false;
    grid.innerHTML = '<p class="community-empty">Loading…</p>';
    const user = PWL.auth && PWL.auth.user();
    currentUserId = user ? user.id : null;
    // Learn (once) whether this user may moderate. is_admin() is security-definer
    // so the page never reads the admins table directly.
    if (user && !adminChecked) {
      adminChecked = true;
      try { const r = await sb.rpc("is_admin"); isAdmin = !!(r && r.data === true); } catch (e) { isAdmin = false; }
    }

    // The pins are fetched FIRST, because how many there are decides how much
    // room page one has left. They are only RENDERED on page one: repeating
    // the same card down every page of the gallery is what made it feel
    // parasitic rather than promoted.
    pinned = await loadFeatured();
    featured = page === 0 ? pinned : [];

    function build(withViews, withPub) {
      let q = sb.from("projects").select(cols(withViews, withPub, featSupported), { count: "exact" });
      if (mineOnly && user) {
        q = q.eq("author_id", user.id);                          // your own, drafts included
      } else {
        if (withPub) q = q.eq("published", true);                // public feed: published only
        // Pinned posts have their own strip at the top of every tab, so keep
        // them out of the paged list rather than printing the same card twice.
        if (featSupported) q = q.eq("featured", false);
      }
      if (sort === "new") {
        q = q.order("created_at", { ascending: false });
      } else {
        // Trending is Top with a window on it: only what was shared in the last
        // week, so a new hit isn't buried under the all-time favourites.
        if (sort === "trending") q = q.gte("created_at", sinceDaysAgo(TRENDING_DAYS));
        // Top: most upvotes first; ties broken by most views, then newest.
        q = q.order("vote_count", { ascending: false });
        if (withViews) q = q.order("view_count", { ascending: false });
        q = q.order("created_at", { ascending: false });
      }
      const room = firstPageRoom();
      const from = page === 0 ? 0 : room + (page - 1) * PAGE_SIZE;
      const take = page === 0 ? room : PAGE_SIZE;
      return q.range(from, from + take - 1);
    }
    // Ask for view_count and published, but tolerate a database that hasn't added
    // them yet (schema not re-run): fall back so the gallery still loads.
    let res = await build(true, pubSupported);
    if (res.error && /featured/i.test(res.error.message || "")) { featSupported = false; res = await build(true, pubSupported); }
    if (res.error && /published/i.test(res.error.message || "")) { pubSupported = false; res = await build(true, false); }
    if (res.error && /view_count/i.test(res.error.message || "")) res = await build(false, pubSupported);
    const { data, error, count } = res;
    if (error) {
      grid.innerHTML = '<p class="community-empty">Could not load programs: ' + esc(error.message) + "</p>";
      if (pager) pager.hidden = true;
      return;
    }
    totalCount = (typeof count === "number") ? count : (data ? data.length : 0);
    // Paged past the end (e.g. after a delete)? Step back to the last page and refetch.
    const lastPage = pageCount() - 1;
    if (page > lastPage) { page = lastPage; return refresh(); }
    projects = data || [];

    votedSet = new Set();
    if (user && (projects.length || featured.length)) {
      const res = await sb.from("votes").select("project_id").eq("user_id", user.id);
      votedSet = new Set((res.data || []).map(function (r) { return r.project_id; }));
    }
    renderGrid();
    renderPager();
  }

  // The pinned posts, fetched on their own rather than ordered to the front of
  // the list above. Trending's seven-day window and Top's vote ordering would
  // each drop or bury a pin, and a pin has to lead all three tabs the same way.
  // Fetched on every page even though only page one shows them, because the
  // count is what the paging is shifted by.
  async function loadFeatured() {
    if (mineOnly || !featSupported) return [];
    function run(withViews) {
      let q = sb.from("projects").select(cols(withViews, pubSupported, true)).eq("featured", true);
      if (pubSupported) q = q.eq("published", true);
      return q.order("featured_at", { ascending: false }).limit(FEATURED_MAX);
    }
    let r = await run(true);
    if (r.error && /published/i.test(r.error.message || "")) { pubSupported = false; r = await run(true); }
    if (r.error && /view_count/i.test(r.error.message || "")) r = await run(false);
    if (r.error) {
      // No `featured` column yet (migration not run): stop asking for it.
      if (/featured/i.test(r.error.message || "")) featSupported = false;
      return [];
    }
    return r.data || [];
  }

  function renderPager() {
    if (!pager) return;
    const pages = pageCount();
    if (pages <= 1) { pager.hidden = true; pager.innerHTML = ""; return; }
    pager.hidden = false;
    pager.innerHTML =
      '<button type="button" class="cc-page-btn" data-page="prev"' + (page <= 0 ? " disabled" : "") + ">‹ Prev</button>" +
      '<span class="cc-page-info">Page ' + (page + 1) + " of " + pages + "  ·  " + totalCount + " project" + (totalCount === 1 ? "" : "s") +
        (pinned.length ? " + " + pinned.length + " featured" : "") + "</span>" +
      '<button type="button" class="cc-page-btn" data-page="next"' + (page >= pages - 1 ? " disabled" : "") + ">Next ›</button>";
    function go(delta) {
      page = Math.min(pages - 1, Math.max(0, page + delta));
      refresh();
      if (grid && grid.scrollIntoView) grid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    pager.querySelector('[data-page="prev"]').addEventListener("click", function () { go(-1); });
    pager.querySelector('[data-page="next"]').addEventListener("click", function () { go(1); });
  }

  function renderGrid() {
    grid.innerHTML = "";
    // Pinned first, then the tab's own list. The note below is appended rather
    // than replacing the grid, so an empty week still shows what is featured.
    featured.forEach(function (p) { grid.appendChild(buildCard(p)); });
    projects.forEach(function (p) { grid.appendChild(buildCard(p)); });
    if (!projects.length) {
      const note = document.createElement("p");
      note.className = "community-empty";
      note.textContent = mineOnly
        ? "You haven't shared anything yet. Open the Playground and hit Share."
        : sort === "trending"
          ? "Nothing new shared in the last " + TRENDING_DAYS + " days. Try Top for the all-time favourites."
          : "No programs yet. Be the first, open the Playground and hit Share!";
      grid.appendChild(note);
    }
  }

  function buildCard(p) {
    const commentCount = (p.comments && p.comments[0] && p.comments[0].count) || 0;
    const voted = votedSet.has(p.id);
    const mine = currentUserId && p.author_id === currentUserId;
    const isDraft = p.published === false;   // false only when the column exists
    const isFeatured = p.featured === true;   // true only when the column exists
    const card = document.createElement("article");
    card.className = "community-card" + (isDraft ? " is-draft" : "") + (isFeatured ? " is-featured" : "");
    card._p = p;
    card.innerHTML =
      '<a class="cc-thumb-wrap" href="../game/?id=' + encodeURIComponent(p.id) + '">' +
        '<canvas class="cc-thumb" width="320" height="180"></canvas>' +
        (isFeatured ? '<span class="cc-kind cc-featured" title="Pinned by a moderator: it leads Trending, New and Top">★ Featured</span>' : "") +
      "</a>" +
      '<div class="cc-head">' +
        '<span class="cc-kind cc-kind-' + esc(p.kind) + '">' + esc(p.kind) + "</span>" +
        (isDraft ? '<span class="cc-kind cc-draft" title="Only you can see this">Draft</span>' : "") +
        '<h3 class="cc-title"></h3>' +
        '<button type="button" class="cc-play" data-act="play" title="' + (p.kind === "game" ? "Play" : p.kind === "game3d" ? "Open in the Playground" : "Run") + '">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3l9 5-9 5z" fill="currentColor"/></svg> ' +
          (p.kind === "game" ? "Play" : p.kind === "game3d" ? "Open" : "Run") +
        "</button>" +
      "</div>" +
      '<p class="cc-desc"></p>' +
      '<div class="cc-author">' + avatarOf(p.profiles) + "<span>" + nameOf(p.profiles) +
        ' &middot; ' + esc(whenLabel(p)) + "</span>" + viewsHtml(p.view_count) + "</div>" +
      '<div class="cc-actions">' +
        '<button type="button" class="cc-vote' + (voted ? " voted" : "") + '" data-act="vote" title="Upvote">' +
          '<span class="cc-arrow"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 4l5 6.5H3z" fill="currentColor"/></svg></span> <span class="cc-votes">' + p.vote_count + "</span></button>" +
        '<button type="button" class="cc-btn" data-act="open">Open in Playground</button>' +
        '<button type="button" class="cc-btn cc-comment-btn" data-act="detail"><svg class="cc-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 2h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 3v-3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor"/></svg> ' + commentCount + "</button>" +
        (mine && isDraft ? '<button type="button" class="cc-btn cc-publish" data-act="publish">Publish</button>' : "") +
        (mine ? '<button type="button" class="cc-btn cc-edit" data-act="edit">Edit</button>' : "") +
        (isAdmin && featSupported && !isDraft
          ? '<button type="button" class="cc-btn cc-feat' + (isFeatured ? " on" : "") + '" data-act="feature" title="' +
            (isFeatured ? "Unpin this post" : "Pin this post to the top of Trending, New and Top") + '">' +
            (isFeatured ? "★ Unfeature" : "☆ Feature") + "</button>"
          : "") +
        (isAdmin && !mine ? '<button type="button" class="cc-btn cc-mod" data-act="rename" title="Rename this post (admin)">Rename</button>' +
                            '<button type="button" class="cc-btn cc-mod cc-mod-del" data-act="mod-del" title="Delete this post (admin)">Delete</button>' : "") +
      "</div>";
    card.querySelector(".cc-title").textContent = p.title;
    const desc = card.querySelector(".cc-desc");
    if (p.description) desc.innerHTML = linkify(p.description); else desc.remove();
    card.querySelector('[data-act="vote"]').addEventListener("click", function () { toggleVote(p, card); });
    card.querySelector('[data-act="play"]').addEventListener("click", function () {
      // Games deserve the full page: leaderboard, comments, big stage. Turtle
      // and plain-Python programs run inline in a quick popup.
      if (p.kind === "game") { window.location.href = "../game/?id=" + encodeURIComponent(p.id); return; }
      // 3D needs the Playground's WebGL stage: neither the popup player nor the
      // game page has one, so they would just show an empty box.
      if (p.kind === "game3d") { openInPlayground(p); return; }
      countView(p, card);
      if (window.PWL.player) window.PWL.player.openModal({ code: p.code, kind: p.kind, title: p.title });
    });
    // The thumbnail is a link to the game page, which has no 3D stage either.
    if (p.kind === "game3d") {
      const thumbLink = card.querySelector(".cc-thumb-wrap");
      if (thumbLink) thumbLink.addEventListener("click", function (e) { e.preventDefault(); openInPlayground(p); });
    }
    card.querySelector('[data-act="open"]').addEventListener("click", function () { openInPlayground(p); });
    card.querySelector('[data-act="detail"]').addEventListener("click", function () { openDetail(p); });
    if (mine) card.querySelector('[data-act="edit"]').addEventListener("click", function () { openEditor(p); });
    const featBtn = card.querySelector('[data-act="feature"]');
    if (featBtn) featBtn.addEventListener("click", function () { adminFeature(p, featBtn); });
    if (isAdmin && !mine) {
      card.querySelector('[data-act="rename"]').addEventListener("click", function () { adminRename(p, card); });
      const delBtn = card.querySelector('[data-act="mod-del"]');
      let armed = false, armTimer;
      delBtn.addEventListener("click", function () {
        if (!armed) {
          armed = true; delBtn.textContent = "Click again to delete"; delBtn.classList.add("armed");
          clearTimeout(armTimer);
          armTimer = setTimeout(function () { armed = false; delBtn.textContent = "Delete"; delBtn.classList.remove("armed"); }, 3500);
          return;
        }
        clearTimeout(armTimer);
        adminDelete(p);
      });
    }
    if (mine && isDraft) {
      // Two-click, like delete: publishing is public and one-way, so a single
      // stray click shouldn't do it.
      const pubBtn = card.querySelector('[data-act="publish"]');
      let armed = false, armTimer;
      pubBtn.addEventListener("click", function () {
        if (!armed) {
          armed = true; pubBtn.textContent = "Click again to publish"; pubBtn.classList.add("armed");
          clearTimeout(armTimer);
          armTimer = setTimeout(function () { armed = false; pubBtn.textContent = "Publish"; pubBtn.classList.remove("armed"); }, 3500);
          return;
        }
        clearTimeout(armTimer);
        publishDraft(p);
      });
    }
    if (window.PWL.preview) { try { window.PWL.preview.renderInto(card.querySelector(".cc-thumb"), p.code, p.scene); } catch (e) {} }
    return card;
  }

  // Flip one of your drafts to public, straight from its card.
  async function publishDraft(p) {
    const res = await sb.from("projects")
      .update({ published: true, updated_at: new Date().toISOString() })
      .eq("id", p.id).select("id").single();
    if (res.error) { toast("Couldn't publish: " + res.error.message); return; }
    p.published = true;
    toast("Published! It's live in the community now.");
    refresh();
  }

  // ---- Admin: pin a post to the top of every tab ----
  // Deliberately does NOT touch updated_at: featuring a program is not the
  // author editing it, and the card would otherwise start claiming it was.
  // The database is the real gate (a trigger rejects a non-admin), this button
  // is just the handle.
  async function adminFeature(p, btn) {
    const next = !p.featured;
    if (btn) btn.disabled = true;
    const res = await sb.from("projects").update({ featured: next })
      .eq("id", p.id).select("id,featured").single();
    if (btn) btn.disabled = false;
    if (res.error) { toast("Couldn't " + (next ? "feature" : "unfeature") + ": " + res.error.message); return; }
    p.featured = next;
    toast(next ? "Featured. It now leads Trending, New and Top." : "No longer featured.");
    refresh();
  }

  // ---- Admin moderation: rename / delete anyone's post ----
  async function adminRename(p, card) {
    const next = window.prompt("Rename this post:", p.title || "");
    if (next == null) return;                     // cancelled
    const title = next.trim().slice(0, 120);
    if (!title || title === p.title) return;
    const res = await sb.from("projects")
      .update({ title: title, updated_at: new Date().toISOString() })
      .eq("id", p.id).select("id").single();
    if (res.error) { toast("Rename failed: " + res.error.message); return; }
    p.title = title;
    const el = card.querySelector(".cc-title"); if (el) el.textContent = title;
    toast("Renamed.");
  }
  async function adminDelete(p) {
    const res = await sb.from("projects").delete().eq("id", p.id);
    if (res.error) { toast("Delete failed: " + res.error.message); return; }
    toast("Post deleted.");
    refresh();
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
    try {
      localStorage.setItem("pyweblib-load", p.code);
      // Bind the editor to this program so a re-share updates it (if it's yours).
      localStorage.setItem("pyweblib-bind", JSON.stringify({ id: p.id, title: p.title, author_id: p.author_id, published: p.published }));
    } catch (e) {}
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
        '<div class="cc-author">' + avatarOf(p.profiles) + "<span>" + nameOf(p.profiles) +
          ' &middot; ' + esc(whenLabel(p)) + "</span></div>" +
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
    if (p.description) md.innerHTML = linkify(p.description); else md.remove();
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
        row.querySelector(".pwl-comment-text").innerHTML = linkify(c.body);
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

  function detectKind(code) {
    // game3d first, and \b on the 2D test: "import game" is a prefix of
    // "import game3d".
    if (/(^|\n)\s*(import\s+game3d|from\s+game3d\s+import)/.test(code)) return "game3d";
    if (/(^|\n)\s*(import\s+game\b|from\s+game\s+import)/.test(code)) return "game";
    if (/(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(code)) return "turtle";
    return "python";
  }

  // ---- Edit or delete your own program ----
  function openEditor(p) {
    const back = document.createElement("div");
    back.className = "pwl-modal-back";
    back.innerHTML =
      '<div class="pwl-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="pwl-modal-x" aria-label="Close">&times;</button>' +
        '<h2 class="pwl-modal-title">Edit your program</h2>' +
        '<form id="pwl-edit-form" class="pwl-share-form">' +
          '<label>Title<input name="title" type="text" maxlength="80" required autocomplete="off" /></label>' +
          '<label>Description (optional)<textarea name="description" maxlength="280" rows="2"></textarea></label>' +
          '<label>Code<textarea name="code" class="pwl-code-edit" spellcheck="false" rows="12"></textarea></label>' +
          '<div class="pwl-modal-actions">' +
            '<button type="submit" class="btn btn-primary">Save changes</button>' +
            '<button type="button" class="btn btn-danger" data-act="del">Delete</button>' +
          "</div>" +
        "</form>" +
      "</div>";
    const titleEl = back.querySelector('input[name="title"]');
    const descEl = back.querySelector('textarea[name="description"]');
    const codeEl = back.querySelector('textarea[name="code"]');
    titleEl.value = p.title;
    descEl.value = p.description || "";
    codeEl.value = p.code;

    function close() { back.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.querySelector(".pwl-modal-x").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    titleEl.focus();

    // Two-click delete so it is not a one-tap mistake.
    const delBtn = back.querySelector('[data-act="del"]');
    let armed = false;
    delBtn.addEventListener("click", async function () {
      if (!armed) { armed = true; delBtn.textContent = "Click again to delete"; return; }
      delBtn.disabled = true;
      const res = await sb.from("projects").delete().eq("id", p.id);
      if (res.error) { delBtn.disabled = false; toast("Couldn't delete: " + res.error.message); return; }
      close(); toast("Deleted."); refresh();
    });

    back.querySelector("#pwl-edit-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const title = titleEl.value.trim();
      const code = codeEl.value;
      if (!title || !code.trim()) return;
      const submit = back.querySelector('button[type="submit"]');
      submit.disabled = true; submit.textContent = "Saving…";
      const payload = {
        title: title,
        description: descEl.value.trim() || null,
        code: code,
        kind: detectKind(code),
        updated_at: new Date().toISOString()
      };
      if (code !== p.code) payload.scene = null;   // code changed: drop the stale snapshot
      const res = await sb.from("projects").update(payload).eq("id", p.id);
      if (res.error) { submit.disabled = false; submit.textContent = "Save changes"; toast("Couldn't save: " + res.error.message); return; }
      close(); toast("Saved."); refresh();
    });
  }

  // ---- Sort tabs ----
  document.querySelectorAll(".community-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".community-tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      sort = tab.getAttribute("data-sort") || "top";
      page = 0;
      refresh();
    });
  });

  // Re-fetch when auth changes (to light up the user's own votes).
  document.addEventListener("pwl:auth", refresh);
  refresh();
})();
