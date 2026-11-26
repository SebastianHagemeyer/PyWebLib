/*
 * PyWebLib creator page (/user/?id=<uuid>): everything one person has shared.
 * Their published programs (each opens on its own game page) and their sprite
 * assets (each opens in the Asset studio as a copy to remix, credited to them).
 * Every author name on the site links here.
 */
(function () {
  "use strict";

  const PWL = window.PWL || {};
  const sb = PWL.supabase;
  const notice = document.getElementById("up-notice");
  const view = document.getElementById("up-view");
  if (!view) return;

  const uid = new URLSearchParams(location.search).get("id") || "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function say(text) { notice.textContent = text; notice.hidden = false; }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function setCount(id, n) { const el = document.getElementById(id); if (el) el.textContent = n ? String(n) : ""; }
  function dataUri(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }

  if (!PWL.configured || !sb) { say("The community isn't switched on on this copy of the site."); return; }
  if (!/^[0-9a-f-]{36}$/i.test(uid)) { say("That link doesn't point at anyone. Try a name on the Community page."); return; }

  // The optional columns may not exist on a database that hasn't had every
  // migration run, so each query retries without them rather than failing.
  async function loadPrograms() {
    const base = "id,title,kind,code,scene,vote_count,created_at";
    let r = await sb.from("projects").select(base + ",view_count").eq("author_id", uid).eq("published", true)
      .order("vote_count", { ascending: false }).order("created_at", { ascending: false });
    if (r.error) r = await sb.from("projects").select(base).eq("author_id", uid)
      .order("vote_count", { ascending: false }).order("created_at", { ascending: false });
    return (r && r.data) || [];
  }
  async function loadAssets() {
    let r = await sb.from("assets").select("id,name,svg,vote_count").eq("author_id", uid)
      .order("vote_count", { ascending: false }).order("created_at", { ascending: false });
    if (r.error) r = await sb.from("assets").select("id,name,svg").eq("author_id", uid).order("created_at", { ascending: false });
    return (r && r.data) || [];
  }

  function programCard(p) {
    const el = document.createElement("a");
    el.className = "up-prog";
    // 3D needs the Playground's WebGL stage, which the game page doesn't have.
    el.href = "../game/?id=" + encodeURIComponent(p.id);
    el.innerHTML =
      '<canvas class="cc-thumb" width="320" height="180"></canvas>' +
      '<span class="up-prog-body">' +
        '<span class="cc-kind cc-kind-' + esc(p.kind) + '">' + esc(p.kind) + "</span>" +
        '<span class="up-prog-title"></span>' +
        '<span class="up-prog-votes" title="Upvotes"><svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M8 3.5l5.5 7H2.5z" fill="currentColor"/></svg> ' + (Number(p.vote_count) || 0) + "</span>" +
      "</span>";
    el.querySelector(".up-prog-title").textContent = p.title || "untitled";
    if (p.kind === "game3d") {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        try {
          localStorage.setItem("pyweblib-load", p.code);
          localStorage.setItem("pyweblib-bind", JSON.stringify({ id: p.id, title: p.title, author_id: uid, published: true }));
        } catch (err) {}
        location.href = "../";
      });
    }
    if (PWL.preview) { try { PWL.preview.renderInto(el.querySelector(".cc-thumb"), p.code, p.scene); } catch (e) {} }
    return el;
  }

  function assetCard(a, voted, canVote) {
    const el = document.createElement("div");
    el.className = "asset-card";
    el.innerHTML =
      '<a class="asset-card-link" href="../assets/?remix=' + a.id + '" title="Open a copy in the Asset studio">' +
        '<img class="asset-card-pic" alt="" src="' + esc(dataUri(a.svg)) + '" /></a>' +
      '<span class="asset-card-id">#' + a.id + "</span>" +
      '<span class="asset-card-name"></span>';
    el.querySelector(".asset-card-name").textContent = a.name || "untitled";
    if (canVote) el.appendChild(PWL.assetVotes.button(a, voted));
    return el;
  }

  // Sign-in can land while a load is still running. Only the newest may draw.
  let loadSeq = 0;
  async function load() {
    const mySeq = ++loadSeq;
    const prof = await sb.from("profiles").select("id,display_name,avatar_url").eq("id", uid).maybeSingle();
    if (mySeq !== loadSeq) return;
    if (prof.error || !prof.data) { say("We couldn't find that person. They may have deleted their account."); return; }
    const who = prof.data.display_name || "Someone";
    document.title = who + " | PyWebLib";
    document.getElementById("up-name").textContent = who;
    const av = document.getElementById("up-avatar");
    const cross = window.crossOriginIsolated ? ' crossorigin="anonymous"' : "";
    av.innerHTML = '<span class="pwl-avatar up-avatar-big"><svg class="pwl-avatar-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M12 14.4c-4.3 0-7.8 2.7-7.8 6.1V24h15.6v-3.5c0-3.4-3.5-6.1-7.8-6.1z"/></svg>' +
      (prof.data.avatar_url ? '<img class="pwl-avatar-photo" src="' + esc(prof.data.avatar_url) + '" alt="" referrerpolicy="no-referrer"' + cross + ' onerror="this.remove()" />' : "") + "</span>";
    view.hidden = false;

    const both = await Promise.all([loadPrograms(), loadAssets()]);
    if (mySeq !== loadSeq) return;
    const progs = both[0], assets = both[1];

    const pBox = document.getElementById("up-programs");
    pBox.innerHTML = "";
    if (!progs.length) pBox.innerHTML = '<p class="community-empty">No published programs yet.</p>';
    else progs.forEach(function (p) { pBox.appendChild(programCard(p)); });
    setCount("up-prog-count", progs.length);

    const aBox = document.getElementById("up-assets");
    const canVote = PWL.assetVotes && PWL.assetVotes.supported(assets);
    const voted = canVote ? await PWL.assetVotes.mine(assets.map(function (a) { return a.id; })) : new Set();
    if (mySeq !== loadSeq) return;
    aBox.innerHTML = "";
    if (!assets.length) aBox.innerHTML = '<p class="community-empty">No assets yet.</p>';
    else assets.forEach(function (a) { aBox.appendChild(assetCard(a, voted, canVote)); });
    setCount("up-asset-count", assets.length);

    const progVotes = progs.reduce(function (s, p) { return s + (Number(p.vote_count) || 0); }, 0);
    const assetVotes = assets.reduce(function (s, a) { return s + (Number(a.vote_count) || 0); }, 0);
    document.getElementById("up-stats").textContent =
      plural(progs.length, "program") + " · " + plural(assets.length, "asset") + " · " + plural(progVotes + assetVotes, "upvote");
  }

  load();
  // Signing in or out changes which arrows are lit.
  if (PWL.auth && PWL.auth.onChange) PWL.auth.onChange(function () { load(); });
})();
