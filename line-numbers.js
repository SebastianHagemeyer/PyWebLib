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
 * Alignment is a MEASUREMENT, not a count. CodeJar sets white-space: pre-wrap
 * as an inline style on the editor, which beats the stylesheet, so a long line
 * wraps onto several visual rows rather than scrolling sideways. Numbering
 * logical lines therefore drifts: every wrapped row pushes the code below it
 * down a line while the numbers march on regardless, and by the bottom of a
 * long file they point at the wrong thing entirely.
 *
 * So each logical line is measured for how many rows it actually occupies, and
 * its number is followed by that many blank lines. The measuring is skipped
 * whenever nothing wraps, which is the usual case.
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

  function logicalLines(code) {
    // textContent, not innerText: innerText collapses and re-inserts newlines
    // by rendered layout, which is a different number from the one on screen.
    var t = code.textContent || "";
    var lines = t.split("\n");
    // A trailing newline leaves an empty last line not worth numbering.
    if (lines.length > 1 && t.charAt(t.length - 1) === "\n") lines.pop();
    return lines;
  }

  // Every text node in order, so a character offset into textContent can be
  // turned back into a DOM position. Prism emits a flat run of token spans, so
  // one logical line is spread across however many of them it happens to touch.
  function textNodes(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }
  function posAt(nodes, index) {
    var acc = 0;
    for (var i = 0; i < nodes.length; i++) {
      var len = nodes[i].nodeValue.length;
      if (acc + len >= index) return { node: nodes[i], offset: index - acc };
      acc += len;
    }
    var last = nodes[nodes.length - 1];
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  // How many visual rows each logical line occupies. Ones is the answer almost
  // always, so that case is detected cheaply and the ranges are never built.
  function rowsPerLine(code, lines) {
    var ones = lines.map(function () { return 1; });
    var cs = window.getComputedStyle(code);
    var lineH = parseFloat(cs.lineHeight);
    if (!lineH) return ones;
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var rowsTotal = Math.round((code.scrollHeight - padY) / lineH);
    if (rowsTotal <= lines.length) return ones;     // nothing wrapped

    var nodes = textNodes(code);
    if (!nodes.length) return ones;
    var out = [], at = 0;
    for (var i = 0; i < lines.length; i++) {
      var start = at, end = at + lines[i].length;
      at = end + 1;                                  // step over the newline
      if (start === end) { out.push(1); continue; }  // an empty line is one row
      var a = posAt(nodes, start), b = posAt(nodes, end);
      if (!a || !b) { out.push(1); continue; }
      var rows = 1;
      try {
        var range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        var rects = range.getClientRects();
        // A line can produce several rects on the SAME row, one per token span,
        // so count distinct tops rather than rects.
        var tops = {};
        for (var r = 0; r < rects.length; r++) {
          if (rects[r].width > 0 || rects[r].height > 0) tops[Math.round(rects[r].top)] = 1;
        }
        rows = Math.max(1, Object.keys(tops).length);
      } catch (e) { /* leave it at one row */ }
      out.push(rows);
    }
    return out;
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
    var lines = logicalLines(e.code);
    var rows = rowsPerLine(e.code, lines);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      out.push(String(i + 1));
      // Blank rows opposite the wrapped continuation of a long line, so the
      // next number still sits beside the line it belongs to.
      for (var r = 1; r < rows[i]; r++) out.push("");
    }
    e.inner.textContent = out.join("\n");
    // The gutter does not scroll on its own; its contents ride the editor's.
    e.inner.style.transform = "translateY(" + -e.code.scrollTop + "px)";
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
    // The numbers live in an inner element. Scrolling moves THAT, while the
    // outer box stays pinned over the code and clips it. Translating the box
    // itself slid it up out of its slot and over the toolbar.
    var inner = document.createElement("div");
    inner.className = "sandbox-gutter-inner";
    gutter.appendChild(inner);
    host.insertBefore(gutter, code);

    var e = { code: code, gutter: gutter, inner: inner };
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
