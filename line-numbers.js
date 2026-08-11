/* Line numbers down the side of the code editor, off by default, remembered.
 *
 * Ported from the same feature in ITbasics, which shares this editor's shape.
 * This file only DRAWS them. The switch lives on the Settings page next to the
 * theme, because both are "how the site looks" choices that you set once.
 *
 * settings.js writes the same localStorage key directly rather than calling in
 * here, because this script is not loaded on Settings. The key is the contract
 * between the two files, which is why it is spelled out in both.
 *
 * The editor element is never moved in the DOM. It is contenteditable, CodeJar
 * owns its caret and Prism rehighlights it in place, and pyrun.js holds a
 * reference to it. So the gutter is a sibling laid over the editor's left edge
 * rather than a wrapper around it, and the editor gains enough left padding to
 * sit clear of it.
 *
 * Alignment is only possible because .sandbox-code is white-space: pre. One
 * logical line is one visual line, so numbering is a count, not a measurement.
 * If that ever becomes pre-wrap this silently stops lining up, and it would
 * have to measure wrapped rows instead.
 */
(function () {
  "use strict";

  var KEY = "pwl-linenums";     // settings.js writes this too
  var GUTTER_W = 44;            // keep in step with .sandbox-gutter in styles.css

  function wanted() {
    try { return localStorage.getItem(KEY) === "on"; } catch (e) { return false; }
  }
  function remember(on) {
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {
      /* Private browsing. The choice still holds for this page. */
    }
  }

  var editors = [];             // { code, gutter }

  function countLines(code) {
    // textContent, not innerText: innerText collapses and re-inserts newlines
    // by rendered layout, which is a different number from the one on screen.
    var t = code.textContent || "";
    var n = t.split("\n").length;
    // A trailing newline leaves an empty last line not worth numbering.
    if (n > 1 && t.charAt(t.length - 1) === "\n") n--;
    return Math.max(n, 1);
  }

  // The gutter is positioned against .sandbox-editor, which also holds the
  // toolbar, so "top: 0" would paint the numbers over the main.py label. Line
  // it up with the code box itself and re-measure whenever that can have moved.
  function placeGutter(e) {
    if (!e.gutter) return;
    e.gutter.style.top = e.code.offsetTop + "px";
    e.gutter.style.height = e.code.clientHeight + "px";
  }

  function paintGutter(e) {
    if (!e.gutter) return;
    placeGutter(e);
    var n = countLines(e.code);
    var out = [];
    for (var i = 1; i <= n; i++) out.push(i);
    e.gutter.textContent = out.join("\n");
    // The gutter does not scroll on its own; it rides the editor's scroll.
    e.gutter.style.transform = "translateY(" + -e.code.scrollTop + "px)";
  }

  function apply(e, on) {
    e.code.classList.toggle("has-linenums", on);
    if (e.gutter) e.gutter.hidden = !on;
    if (on) paintGutter(e);
  }
  function applyAll(on) {
    editors.forEach(function (e) { apply(e, on); });
  }

  function setup(shell) {
    var code = shell.querySelector(".sandbox-code");
    if (!code || code._lineNums) return;
    code._lineNums = true;

    var host = code.parentNode;
    if (!host) return;
    host.classList.add("has-gutter-host");

    var gutter = document.createElement("div");
    gutter.className = "sandbox-gutter";
    gutter.setAttribute("aria-hidden", "true");
    host.insertBefore(gutter, code);

    var e = { code: code, gutter: gutter };
    editors.push(e);

    // Typing changes the count; scrolling changes which numbers sit opposite
    // which lines. Both are cheap enough to do on the event.
    code.addEventListener("input", function () { if (!gutter.hidden) paintGutter(e); });
    code.addEventListener("scroll", function () { if (!gutter.hidden) paintGutter(e); });
    // Maximising, expanding, rotating a tablet or a wrapping toolbar all move
    // the box without firing either of those.
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(function () { if (!gutter.hidden) paintGutter(e); }).observe(code);
      } catch (err) { /* the resize listener below still covers most of it */ }
    }

    apply(e, wanted());
  }

  function init() {
    var shells = document.querySelectorAll(".sandbox-shell");
    for (var i = 0; i < shells.length; i++) setup(shells[i]);
  }

  // sandbox.js loads the saved program (or an example) after its own boot, so
  // the first count can be of an empty box. Recount once things have settled.
  function recount() {
    editors.forEach(function (e) { if (!e.gutter.hidden) paintGutter(e); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      window.setTimeout(recount, 400);
    });
  } else {
    init();
    window.setTimeout(recount, 400);
  }

  // Another tab changing the setting should not leave this one disagreeing.
  window.addEventListener("storage", function (ev) {
    if (ev.key === KEY) applyAll(wanted());
  });
  window.addEventListener("resize", recount);

  window.PWLLineNums = {
    refresh: recount,
    GUTTER_W: GUTTER_W,
    mode: function () { return wanted() ? "on" : "off"; },
    setMode: function (m) {
      var on = m === "on";
      remember(on);
      applyAll(on);
    }
  };
})();
