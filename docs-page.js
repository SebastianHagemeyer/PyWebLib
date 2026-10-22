/* docs-page.js
 *
 * Shared by the one-function docs pages (docs/game/submit-score/ and friends).
 *
 *  - "Try it" buttons: <button data-load="ex-id"> stashes that <pre>'s code and
 *    opens the Playground, which picks it up from localStorage.
 *  - Highlights the bare <pre class="guide-code language-python"> blocks
 *    (Prism's auto-highlight only catches <code> elements).
 *
 * The Playground lives at the site root. Rather than hard-code "../../../" per
 * page depth, read the root off this script's own URL, which the build already
 * wrote relative to the page.
 */
(function () {
  "use strict";
  var me = document.currentScript && document.currentScript.src;
  var ROOT = me ? me.replace(/docs-page\.js(\?.*)?$/, "") : "/";

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-load]");
    if (!btn) return;
    var pre = document.getElementById(btn.getAttribute("data-load"));
    if (!pre) return;
    try {
      localStorage.setItem("pyweblib-load", pre.textContent.replace(/\s+$/, ""));
    } catch (err) { /* private mode: just navigate */ }
    location.href = ROOT;
  });

  if (window.Prism) {
    document.querySelectorAll("pre.guide-code").forEach(function (el) {
      try { window.Prism.highlightElement(el); } catch (e) {}
    });
  }
})();
