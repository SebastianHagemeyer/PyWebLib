/*
 * PWL inline player: run a shared program (game / turtle / python) right where
 * you are, without opening the full Playground. It boots one Pyodide through
 * PyRun, mounts a game/turtle canvas plus an output pane, loads the code into a
 * hidden editor, and auto-runs so it "just plays".
 *
 * Used by the community cards (in a modal) and by the program page (inline).
 * Needs pyrun.js and sprites.js on the page. Games need JSPI (Chrome/Edge 137+).
 */
(function () {
  "use strict";
  const PWL = (window.PWL = window.PWL || {});

  function kindOf(code) {
    if (/(^|\n)\s*(import\s+game|from\s+game\s+import)/.test(code || "")) return "game";
    if (/(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(code || "")) return "turtle";
    return "python";
  }
  function supported() { return !!window.PyRun; }
  function jspiOk() { return !!(window.PyRun && window.PyRun.jspiSupported()); }
  // Turtle & games run if the browser has JSPI (Chrome/Edge) OR the cross-browser
  // worker runtime is available (cross-origin isolated, with SharedArrayBuffer).
  function canRunGraphics() {
    return jspiOk() || (typeof window !== "undefined" && window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined");
  }

  // Build the player DOM into `container` and start running
  // program = { code, kind, title }. opts.onScore(points) receives scores from
  // game.submit_score() (used by the program page's leaderboard). Returns
  // { runner, destroy }.
  function mount(container, program, opts) {
    const kind = program.kind || kindOf(program.code);
    container.innerHTML =
      '<div class="pwl-player pwl-player-is-' + kind + '">' +
        '<div class="pwl-player-bar">' +
          '<button type="button" class="btn btn-primary pwl-player-run"><span class="sandbox-run-label">Run</span></button>' +
          (kind === "game"
            ? '<button type="button" class="btn btn-ghost game-fs-btn pwl-player-fs" '
              + 'title="Fullscreen the game" aria-label="Fullscreen the game">'
              + '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
              + '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" '
              + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
              + 'stroke-linejoin="round"/></svg></button>'
            : "") +
        "</div>" +
        '<div class="pwl-player-stage">' +
          '<div class="turtle-stage pwl-player-turtle-wrap"' + (kind === "turtle" ? "" : " hidden") + ">" +
            '<canvas class="pwl-player-turtle" width="560" height="380"></canvas>' +
            '<canvas class="pwl-player-sprite" width="560" height="380"></canvas>' +
          "</div>" +
          '<div class="game-stage pwl-player-game-wrap"' + (kind === "game" ? "" : " hidden") + ">" +
            '<canvas class="pwl-player-game" width="480" height="360" tabindex="0"></canvas>' +
          "</div>" +
        "</div>" +
        '<pre class="pwl-player-out sandbox-out-body"></pre>' +
      "</div>";

    const runBtn = container.querySelector(".pwl-player-run");
    const fsBtn = container.querySelector(".pwl-player-fs");
    if (fsBtn) fsBtn.addEventListener("click", function () {
      if (window.PWL && window.PWL.toggleGameFullscreen) window.PWL.toggleGameFullscreen();
    });
    const outEl = container.querySelector(".pwl-player-out");
    const gameCanvas = container.querySelector(".pwl-player-game");
    const turtleCanvas = container.querySelector(".pwl-player-turtle");
    const spriteCanvas = container.querySelector(".pwl-player-sprite");
    const turtleWrap = container.querySelector(".pwl-player-turtle-wrap");
    const gameWrap = container.querySelector(".pwl-player-game-wrap");

    // A hidden editor holds the code; there is no visible editor in the player.
    const editorEl = document.createElement("div");
    editorEl.style.display = "none";
    container.appendChild(editorEl);

    const needsRuntime = kind === "game" || kind === "turtle";
    if (needsRuntime && !canRunGraphics()) {
      outEl.textContent =
        "Getting your browser ready for games & turtle… if nothing happens, reload the page. " +
        "(Chrome and Edge run them instantly.)";
    }

    const runner = window.PyRun.create({
      editor: editorEl,
      output: outEl,
      runBtn: runBtn,
      defaultCode: program.code,
      storageKey: null,
      // Save games (game.save/load) are namespaced per published program, so each
      // one keeps its own progress. Falls back to the page path when there's no id.
      saveKey: program && program.id != null ? "prog:" + program.id : null,
      turtle: { canvas: turtleCanvas, sprite: spriteCanvas },
      game: { canvas: gameCanvas, onScore: (opts && opts.onScore) || null },
      onChange: function (code) {
        const k = kindOf(code);
        turtleWrap.hidden = k !== "turtle";
        gameWrap.hidden = k !== "game";
      }
    });
    runner.setCode(program.code);
    // Auto-run so a click on Play just plays. Skip auto-run only when a game or
    // turtle can't run here yet; the Run button is still there to try.
    if (!needsRuntime || canRunGraphics()) runner.run();

    return {
      runner: runner,
      destroy: function () { try { runner.stop(); } catch (e) {} container.innerHTML = ""; }
    };
  }

  // Open the player in a modal (used by community cards).
  function openModal(program) {
    const back = document.createElement("div");
    back.className = "pwl-modal-back";
    back.innerHTML =
      '<div class="pwl-modal pwl-player-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="pwl-modal-x" aria-label="Close">&times;</button>' +
        '<h2 class="pwl-modal-title"></h2>' +
        '<div class="pwl-player-host"></div>' +
      "</div>";
    back.querySelector(".pwl-modal-title").textContent = program.title || "Play";
    const host = back.querySelector(".pwl-player-host");
    let session = null;
    function close() {
      if (session) session.destroy();
      back.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.querySelector(".pwl-modal-x").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    session = mount(host, program);
    return { close: close };
  }

  PWL.player = { mount: mount, openModal: openModal, supported: supported, jspiOk: jspiOk, kindOf: kindOf };
})();
