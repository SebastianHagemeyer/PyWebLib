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
  const PROGRAM_CAP = 10;   // keep in step with enforce_project_limit() in supabase-schema.sql

  // "My programs" quick-picker, inserted just under the share panel.
  const myHost = document.createElement("div");
  myHost.className = "pwl-myprograms";
  if (host.parentNode) host.parentNode.insertBefore(myHost, host.nextSibling);
  let myPrograms = [];

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
    const editing = (window.PWL && window.PWL.editing) || null;
    const owned = editing && editing.author_id === user.id;
    if (editing && owned) {
      host.innerHTML =
        '<div class="share-cta">' +
          "<div><h2>Editing: " + esc(editing.title) + "</h2>" +
          "<p>What you publish will update this program. Or share it as a brand new one.</p></div>" +
          '<div class="share-cta-btns">' +
            '<button type="button" class="btn btn-primary" id="pwl-update-btn">Update this program</button>' +
            '<button type="button" class="btn btn-ghost" id="pwl-new-btn">Share as new</button>' +
          "</div>" +
        "</div>";
      document.getElementById("pwl-update-btn").addEventListener("click", function () { openShareModal(editing.id); });
      document.getElementById("pwl-new-btn").addEventListener("click", function () { openShareModal(); });
      return;
    }
    if (editing && !owned) {
      host.innerHTML =
        '<div class="share-cta">' +
          "<div><h2>Remixing: " + esc(editing.title) + "</h2>" +
          "<p>This one belongs to someone else, so publishing shares your own copy.</p></div>" +
          '<button type="button" class="btn btn-primary" id="pwl-share-btn">Share as your own</button>' +
        "</div>";
      document.getElementById("pwl-share-btn").addEventListener("click", function () { openShareModal(); });
      return;
    }
    host.innerHTML =
      '<div class="share-cta">' +
        '<div><h2>Share your program</h2><p>Publish what is in the editor to the community gallery.</p></div>' +
        '<button type="button" class="btn btn-primary" id="pwl-share-btn">Share to community</button>' +
      "</div>";
    const btn = document.getElementById("pwl-share-btn");
    if (btn) btn.addEventListener("click", function () { openShareModal(); });
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

  async function openShareModal(preselectId) {
    const code = currentCode();
    if (!code.trim()) { toast("Write some code first, then share it."); return; }
    // Force-stop a still-running program the moment we start the upload flow.
    // This ends the run so a turtle's drawing is captured and a game freezes on
    // its last frame (both become the thumbnail), and it releases the game's
    // keyboard capture so the Share form below is typeable (space included).
    if (window.PWL && window.PWL.stopRun) { try { await window.PWL.stopRun(); } catch (e) {} }
    const kind = detectKind(code);
    const P = window.PWL || {};
    // Use a captured scene only if it came from running THIS code: a game's
    // last frame, or a turtle program's finished-drawing poster.
    let scene = null;
    if (P.lastGameScene && P.lastGameSceneCode === code) scene = P.lastGameScene;
    else if (P.lastTurtleScene && P.lastTurtleSceneCode === code) scene = P.lastTurtleScene;
    const user = PWL.auth && PWL.auth.user();

    // The author's existing programs, so they can overwrite one instead of
    // always publishing a fresh copy.
    let mine = [];
    if (user) {
      const r = await sb.from("projects").select("id,title,description,scene")
        .eq("author_id", user.id).order("updated_at", { ascending: false });
      if (!r.error && r.data) mine = r.data;
    }
    const targetField = mine.length
      ? '<label>Publish to<select name="target">' +
          '<option value="">A new program</option>' +
          mine.map(function (m) { return '<option value="' + esc(m.id) + '">Update: ' + esc(m.title) + "</option>"; }).join("") +
        "</select></label>"
      : "";
    const atCap = mine.length >= PROGRAM_CAP;

    const back = document.createElement("div");
    back.className = "pwl-modal-back";
    back.innerHTML =
      '<div class="pwl-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="pwl-modal-x" aria-label="Close">&times;</button>' +
        '<h2 class="pwl-modal-title">Share to community</h2>' +
        '<span class="cc-kind cc-kind-' + esc(kind) + '">' + esc(kind) + "</span>" +
        '<div class="pwl-share-preview-wrap"><canvas class="pwl-share-preview" width="320" height="180"></canvas></div>' +
        '<p class="pwl-thumb-keep" hidden style="margin:6px 0 0;font-size:0.85rem;color:var(--muted)">Keeping this program\'s thumbnail. Run it to capture a new one.</p>' +
        ((kind === "turtle" || kind === "game") && !scene
          ? '<div class="pwl-share-runfirst"><span>' +
              (kind === "game"
                ? "Run your game first to capture a live thumbnail of it."
                : "Run your program first to save its drawing as the thumbnail.") +
            '</span><button type="button" class="btn btn-ghost pwl-runfirst-btn">Run it now</button></div>' +
            '<button type="button" class="pwl-publish-anyway">Publish without a thumbnail</button>'
          : "") +
        '<form id="pwl-share-form" class="pwl-share-form">' +
          targetField +
          '<p class="pwl-cap-note" hidden></p>' +
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

    // "Run it now": close the dialog and run the program in the Playground, so
    // the user (who may need to answer prompts or play a game) can drive it, then
    // Share again to capture a real thumbnail.
    const runFirstBtn = back.querySelector(".pwl-runfirst-btn");
    if (runFirstBtn) runFirstBtn.addEventListener("click", function () {
      close();
      if (window.PWL && window.PWL.startRun) window.PWL.startRun();
      toast(kind === "game"
        ? "Playing your game. Hit Share again when it looks right."
        : "Running your program. Hit Share again when it looks right.");
    });

    const form = back.querySelector("#pwl-share-form");
    const titleEl = form.querySelector('input[name="title"]');
    const descEl = form.querySelector('textarea[name="description"]');
    const targetEl = form.querySelector('select[name="target"]');
    const submitBtn = form.querySelector('button[type="submit"]');
    const capNote = form.querySelector(".pwl-cap-note");
    const keepNote = back.querySelector(".pwl-thumb-keep");
    if (capNote) capNote.textContent =
      "You have " + mine.length + " programs, the most allowed. Pick one above to update, or delete one in the community first.";

    // A turtle/game normally needs a live thumbnail before it can be published,
    // so cards aren't just code. The exception: updating a program that already
    // has a saved thumbnail keeps the old one, so the gate depends on the target.
    const runfirstBox = back.querySelector(".pwl-share-runfirst");
    let allowNoScene = false;
    const anywayBtn = back.querySelector(".pwl-publish-anyway");
    if (anywayBtn) anywayBtn.addEventListener("click", function () {
      allowNoScene = true;
      anywayBtn.remove();
      if (runfirstBox) runfirstBox.classList.add("bypassed");
      refreshSubmit();
      titleEl.focus();
    });

    function targetSceneJson() {
      // The saved thumbnail of the program we're about to update, if it has one.
      if (!targetEl || !targetEl.value) return null;
      const m = mine.filter(function (x) { return x.id === targetEl.value; })[0];
      return (m && m.scene) ? m.scene : null;
    }
    function needsThumbNow() {
      if (scene) return false;                       // captured one this run
      if (kind !== "turtle" && kind !== "game") return false;
      return !targetSceneJson();                     // else keep the target's own
    }
    function renderPreview() {
      if (!pv || !window.PWL.preview) return;
      // A fresh capture wins; otherwise show the target's existing thumbnail.
      try { window.PWL.preview.renderInto(pv, code, scene || targetSceneJson()); } catch (e) {}
    }

    // At the cap you can still update an existing program, just not add a new one.
    function refreshSubmit() {
      const isNew = !targetEl || !targetEl.value;
      const capBlocked = atCap && isNew;
      const needs = needsThumbNow();
      if (capNote) capNote.hidden = !capBlocked;
      // Hide the "run first / no thumbnail" prompts when the old one is kept.
      if (runfirstBox) runfirstBox.style.display = needs ? "" : "none";
      if (anywayBtn) anywayBtn.style.display = (needs && !allowNoScene) ? "" : "none";
      if (keepNote) keepNote.hidden = !(!scene && !!targetSceneJson());
      submitBtn.disabled = capBlocked || (needs && !allowNoScene);
    }
    // Choosing an existing program fills in its title and description and turns
    // the button into an update; "A new program" resets to a fresh post.
    if (targetEl) {
      targetEl.addEventListener("change", function () {
        const m = mine.filter(function (x) { return x.id === targetEl.value; })[0];
        if (m) {
          titleEl.value = m.title || "";
          descEl.value = m.description || "";
          submitBtn.textContent = "Update program";
        } else {
          submitBtn.textContent = "Publish";
        }
        renderPreview();
        refreshSubmit();
      });
    }
    // Pre-target a program (from "Update this program" on the Playground).
    if (preselectId && targetEl) {
      const has = Array.prototype.some.call(targetEl.options, function (o) { return o.value === preselectId; });
      if (has) { targetEl.value = preselectId; targetEl.dispatchEvent(new Event("change")); }
    }
    refreshSubmit();
    titleEl.focus();

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const u = PWL.auth && PWL.auth.user();
      if (!u) { PWL.auth.signInWithGoogle(); return; }
      const title = titleEl.value.trim();
      if (!title) return;
      if (needsThumbNow() && !allowNoScene) { toast("Run your program first to capture a thumbnail, or choose \"Publish without a thumbnail\"."); return; }
      const targetId = targetEl ? targetEl.value : "";
      if (atCap && !targetId) { toast("You're at the " + PROGRAM_CAP + " program limit. Update one, or delete one first."); return; }
      const sceneJson = scene
        ? JSON.stringify(scene.kind === "turtle"
            ? { kind: "turtle", w: scene.w, h: scene.h, bg: scene.bg, ops: scene.ops }
            : trimScene(scene))
        : null;
      submitBtn.disabled = true;
      submitBtn.textContent = targetId ? "Updating…" : "Publishing…";
      let res;
      if (targetId) {
        // Overwrite the chosen program with the current editor code. RLS only
        // lets an author touch their own rows, and the list is theirs anyway.
        const upd = {
          title: title,
          description: descEl.value.trim() || null,
          code: code,
          kind: kind,
          updated_at: new Date().toISOString()
        };
        // Only replace the thumbnail when we captured a fresh one this run;
        // otherwise leave the program's existing thumbnail untouched.
        if (sceneJson !== null) upd.scene = sceneJson;
        res = await sb.from("projects").update(upd).eq("id", targetId).select("id").single();
      } else {
        res = await sb.from("projects").insert({
          author_id: u.id,
          title: title,
          description: descEl.value.trim() || null,
          code: code,
          kind: kind,
          scene: sceneJson
        }).select("id").single();
      }
      if (res.error) {
        submitBtn.disabled = false;
        submitBtn.textContent = targetId ? "Update program" : "Publish";
        toast("Couldn't save: " + res.error.message);
        return;
      }
      close();
      toast(targetId ? "Updated! Taking you to the community…" : "Shared! Taking you to the community…");
      setTimeout(function () { window.location.href = "community/"; }, 700);
    });
  }

  async function loadMine() {
    const user = PWL.auth && PWL.auth.user();
    if (!user) { myPrograms = []; renderMine(); return; }
    const r = await sb.from("projects").select("id,title,code,author_id")
      .eq("author_id", user.id).order("updated_at", { ascending: false });
    myPrograms = (!r.error && r.data) ? r.data : [];
    renderMine();
  }
  function renderMine() {
    if (!myPrograms.length) { myHost.innerHTML = ""; return; }
    myHost.innerHTML =
      '<div class="pwl-mine">' +
        '<span class="pwl-mine-title">Your programs</span>' +
        '<select id="pwl-mine-select" aria-label="Open one of your programs">' +
          '<option value="">Open one of your published programs…</option>' +
          myPrograms.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.title) + "</option>"; }).join("") +
        "</select>" +
      "</div>";
    const sel = document.getElementById("pwl-mine-select");
    sel.addEventListener("change", function () {
      const p = myPrograms.filter(function (x) { return x.id === sel.value; })[0];
      sel.value = "";
      if (p && window.PWL.loadProgram) {
        window.PWL.loadProgram(p.code, { id: p.id, title: p.title, author_id: p.author_id });
      }
    });
  }

  document.addEventListener("pwl:auth", function () { render(); loadMine(); });
  document.addEventListener("pwl:editing", render);
  render();
  loadMine();
})();
