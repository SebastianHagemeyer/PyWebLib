/*
 * The settings page.
 *
 * Auth arrives asynchronously, so the page opens on a neutral "checking"
 * state rather than guessing. Showing the signed-out card first and swapping
 * it out would flash "sign in" at someone who already is.
 *
 * The theme control writes through PWL.theme, which owns the preference. This
 * file only reflects it, so the page and the rest of the site cannot disagree.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const seg = $("theme-seg");
  if (!seg) return;                       // not the settings page

  const gates = {
    loading: $("set-loading"),
    out: $("set-signedout"),
    body: $("set-body"),
  };
  function show(which) {
    Object.keys(gates).forEach(function (k) {
      if (gates[k]) gates[k].hidden = k !== which;
    });
  }

  function paintTheme() {
    const pref = PWL.theme ? PWL.theme.get() : "system";
    const now = PWL.theme ? PWL.theme.resolved() : "light";
    seg.querySelectorAll("[data-theme-set]").forEach(function (b) {
      const on = b.getAttribute("data-theme-set") === pref;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    const note = $("theme-state");
    if (note) {
      note.textContent = pref === "system"
        ? "Following your device, which is currently " + now + "."
        : "Always " + pref + " on this device.";
    }
  }

  // Line numbers. The same "set it once, per device" shape as the theme, so it
  // lives here rather than as a button in the editor toolbar. line-numbers.js
  // is not loaded on this page, so this writes the key directly; the key name
  // is the contract between the two files and is spelled out in both.
  const LINENUM_KEY = "pwl-linenums";
  const lineSeg = $("linenum-seg");

  function lineMode() {
    try { return localStorage.getItem(LINENUM_KEY) === "on" ? "on" : "off"; }
    catch (e) { return "off"; }
  }
  function paintLines() {
    if (!lineSeg) return;
    const now = lineMode();
    lineSeg.querySelectorAll("[data-linenum-set]").forEach(function (b) {
      const on = b.getAttribute("data-linenum-set") === now;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  function setLines(mode) {
    try { localStorage.setItem(LINENUM_KEY, mode === "on" ? "on" : "off"); }
    catch (e) { /* private browsing: the choice just will not stick */ }
    paintLines();
  }
  if (lineSeg) {
    lineSeg.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-linenum-set]");
      if (btn) setLines(btn.getAttribute("data-linenum-set"));
    });
    lineSeg.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const btns = [].slice.call(lineSeg.querySelectorAll("[data-linenum-set]"));
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
      next.focus();
      setLines(next.getAttribute("data-linenum-set"));
    });
    paintLines();
  }

  // Editor hints. Same story again: a "how the site behaves" preference that
  // used to be a button in the editor toolbar. The toolbar keeps the things you
  // press while working (Maximise, Reset, Run). editor-tools.js owns the key and
  // defaults it ON: anything that is not exactly "off" counts as on.
  const HINTS_KEY = "pwl-editor-hints";
  const hintsSeg = $("hints-seg");

  function hintsMode() {
    try { return localStorage.getItem(HINTS_KEY) === "off" ? "off" : "on"; }
    catch (e) { return "on"; }
  }
  function paintHints() {
    if (!hintsSeg) return;
    const now = hintsMode();
    hintsSeg.querySelectorAll("[data-hints-set]").forEach(function (b) {
      const on = b.getAttribute("data-hints-set") === now;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  function setHints(mode) {
    try { localStorage.setItem(HINTS_KEY, mode === "off" ? "off" : "on"); }
    catch (e) { /* private browsing: the choice just will not stick */ }
    paintHints();
  }
  if (hintsSeg) {
    hintsSeg.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-hints-set]");
      if (btn) setHints(btn.getAttribute("data-hints-set"));
    });
    hintsSeg.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const btns = [].slice.call(hintsSeg.querySelectorAll("[data-hints-set]"));
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
      next.focus();
      setHints(next.getAttribute("data-hints-set"));
    });
    paintHints();
  }

  seg.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-theme-set]");
    if (!btn || !PWL.theme) return;
    PWL.theme.set(btn.getAttribute("data-theme-set"));
  });
  // Keyboard: a radiogroup should move with the arrow keys.
  seg.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const btns = [].slice.call(seg.querySelectorAll("[data-theme-set]"));
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    PWL.theme.set(next.getAttribute("data-theme-set"));
  });
  if (window.PWL && PWL.theme) PWL.theme.onChange(paintTheme);
  paintTheme();

  function paintAccount(user, profile) {
    if (!user) { show("out"); return; }
    show("body");
    const name = (profile && profile.display_name) || user.email || "You";
    const email = user.email || "";
    $("set-name").textContent = name;
    // Class-code accounts have a synthesised address; showing it would be noise.
    const student = PWL.auth && PWL.auth.isStudent && PWL.auth.isStudent();
    $("set-email").textContent = student ? "Class code account" : email;
    const rename = $("set-rename");
    // Students keep the handle they were given: this is a public site.
    if (rename && student) rename.remove();
  }

  if (window.PWL && PWL.auth) {
    PWL.auth.onChange(paintAccount);
    paintAccount(PWL.auth.user(), PWL.auth.profile());
  } else {
    // Supabase is not configured on this deployment, so there is no account
    // to manage. Appearance still works, and it is the part most people came
    // for, so show the page rather than a dead end.
    show("body");
    const acct = document.querySelector("#set-body .set-card:last-child");
    if (acct) acct.remove();
  }
})();
