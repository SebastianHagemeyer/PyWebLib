/*
 * PyWebLib "Share to community" flow on the Playground. Renders into #pwl-share:
 * a sign-in prompt when signed out, a Share button when signed in. Publishing
 * opens a small dialog for a title + description, then inserts a project row.
 * Reads the current editor code from window.PWL.getCode (set by sandbox.js).
 */
(function () {
  "use strict";

  const PWL = window.PWL || {};
  const host = document.getElementById("pwl-share");
  if (!host) return;

  if (!PWL.configured) { host.hidden = true; return; }
  const sb = PWL.supabase;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    let t = document.getElementById("pwl-toast");
    if (!t) { t = document.createElement("div"); t.id = "pwl-toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.classList.remove("show"); }, 3400);
  }
  function currentCode() { return (PWL.getCode ? PWL.getCode() : "") || ""; }
  function detectKind(code) {
    if (/(^|\n)\s*(import\s+game|from\s+game\s+import)/.test(code)) return "game";
    if (/(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(code)) return "turtle";
    return "python";
  }

  function render() {
    host.hidden = false;
    const user = PWL.auth && PWL.auth.user();
    if (!user) {
      host.innerHTML =
        '<div class="share-cta">' +
          '<div><h2>Share your program</h2>' +
          "<p>Sign in with Google to publish this to the community, collect upvotes and climb the leaderboard.</p></div>" +
          '<button type="button" class="btn btn-google" data-pwl="signin"><span>Sign in with Google</span></button>' +
        "</div>";
      return; // data-pwl="signin" is handled by auth.js
    }
    host.innerHTML =
      '<div class="share-cta">' +
        '<div><h2>Share your program</h2><p>Publish what is in the editor to the community gallery.</p></div>' +
        '<button type="button" class="btn btn-primary" id="pwl-share-btn">Share to community</button>' +
      "</div>";
    const btn = document.getElementById("pwl-share-btn");
    if (btn) btn.addEventListener("click", openShareModal);
  }

  function trimScene(scene) {
    if (!scene || !scene.sprites) return null;
    return {
      w: scene.w, h: scene.h, bg: scene.bg,
      sprites: scene.sprites.map(function (s) {
        return { kind: s.kind, x: s.x, y: s.y, size: s.size, w: s.w, h: s.h,
                 text: s.text, color: s.color, art: s.art, angle: s.angle,
                 sx: s.sx, sy: s.sy, back: s.back };
      })
    };
  }

  function openShareModal() {
    const code = currentCode();
    if (!code.trim()) { toast("Write some code first, then share it."); return; }
    const kind = detectKind(code);
    const P = window.PWL || {};
    // Use the live scene only if it came from running THIS code.
    const scene = (P.lastGameScene && P.lastGameSceneCode === code) ? P.lastGameScene : null;

    const back = document.createElement("div");
    back.className = "pwl-modal-back";
    back.innerHTML =
      '<div class="pwl-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="pwl-modal-x" aria-label="Close">&times;</button>' +
        '<h2 class="pwl-modal-title">Share to community</h2>' +
        '<span class="cc-kind cc-kind-' + esc(kind) + '">' + esc(kind) + "</span>" +
        (kind === "game" ? '<div class="pwl-share-preview-wrap"><canvas class="pwl-share-preview" width="320" height="180"></canvas></div>' : "") +
        '<form id="pwl-share-form" class="pwl-share-form">' +
          '<label>Title<input name="title" type="text" maxlength="80" required autocomplete="off" placeholder="My cool ' + esc(kind) + " program\" /></label>" +
          '<label>Description (optional)<textarea name="description" maxlength="280" rows="2" placeholder="What does it do? Any keys to press?"></textarea></label>' +
          '<pre class="pwl-modal-code"></pre>' +
          '<div class="pwl-modal-actions"><button type="submit" class="btn btn-primary">Publish</button></div>' +
        "</form>" +
      "</div>";
    back.querySelector(".pwl-modal-code").textContent = code;

    function close() { back.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.querySelector(".pwl-modal-x").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    const pv = back.querySelector(".pwl-share-preview");
    if (pv && window.PWL.preview) { try { window.PWL.preview.renderInto(pv, code, scene); } catch (e) {} }
    back.querySelector('input[name="title"]').focus();

    back.querySelector("#pwl-share-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const user = PWL.auth && PWL.auth.user();
      if (!user) { PWL.auth.signInWithGoogle(); return; }
      const fd = new FormData(e.target);
      const title = String(fd.get("title") || "").trim();
      if (!title) return;
      const submit = e.target.querySelector('button[type="submit"]');
      submit.disabled = true; submit.textContent = "Publishing…";
      const res = await sb.from("projects").insert({
        author_id: user.id,
        title: title,
        description: String(fd.get("description") || "").trim() || null,
        code: code,
        kind: kind,
        scene: scene ? JSON.stringify(trimScene(scene)) : null
      }).select("id").single();
      if (res.error) {
        submit.disabled = false; submit.textContent = "Publish";
        toast("Couldn't publish: " + res.error.message);
        return;
      }
      close();
      toast("Shared! Taking you to the community…");
      setTimeout(function () { window.location.href = "community/"; }, 700);
    });
  }

  document.addEventListener("pwl:auth", render);
  render();
})();
