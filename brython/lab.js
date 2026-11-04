/*
 * Brython lab, page side. Owns the editor, the visible canvas and the input
 * buffer; the Python itself runs in worker.js.
 *
 * Brython is loaded from jsDelivr. To try a self-hosted copy, add
 * ?brython=/path/to/brython/ (with a trailing slash) to the URL.
 */
(function () {
  const BRYTHON_VERSION = "3.14.3";
  let BRYTHON_BASE = "https://cdn.jsdelivr.net/npm/brython@" + BRYTHON_VERSION + "/";
  try {
    const q = new URLSearchParams(location.search).get("brython");
    if (q) BRYTHON_BASE = new URL(q, location.href).href;
  } catch (e) {}

  const K = window.LabKeys;
  const $ = function (id) { return document.getElementById(id); };
  const editor = $("code"), canvas = $("screen"), out = $("out"), hud = $("hud");
  const runBtn = $("run"), stopBtn = $("stop"), status = $("status");
  const view = canvas.getContext("bitmaprenderer");

  let worker = null, ctrl = null, gamePy = null, logicalW = 480, logicalH = 360;
  let runStarted = 0;

  // ---- isolation (SharedArrayBuffer needs it) -------------------------------
  // GitHub Pages can't send COOP/COEP headers, so the site's existing
  // coi-serviceworker adds them; it reloads the page once the first time.
  function ensureIsolated() {
    if (window.crossOriginIsolated) return true;
    if (!window.isSecureContext || !navigator.serviceWorker) {
      setStatus("This page needs https (or localhost) for SharedArrayBuffer.", true);
      return false;
    }
    let reloaded = false;
    try { reloaded = sessionStorage.getItem("labCoiReload") === "1"; } catch (e) {}
    if (reloaded) {
      setStatus("Could not turn on cross-origin isolation in this browser, so the lab can't run.", true);
      return false;
    }
    setStatus("Turning on cross-origin isolation (one reload)...");
    navigator.serviceWorker.register("../coi-serviceworker.js", { scope: "./" }).then(function (reg) {
      const go = function () {
        try { sessionStorage.setItem("labCoiReload", "1"); } catch (e) {}
        location.reload();
      };
      if (reg.active) go();
      else navigator.serviceWorker.addEventListener("controllerchange", go);
      const sw = reg.installing || reg.waiting;
      if (sw) sw.addEventListener("statechange", function () { if (sw.state === "activated") go(); });
    }).catch(function (e) { setStatus("Service worker failed: " + e, true); });
    return false;
  }
  try { if (window.crossOriginIsolated) sessionStorage.removeItem("labCoiReload"); } catch (e) {}

  function setStatus(text, bad) {
    status.textContent = text;
    status.className = bad ? "status bad" : "status";
  }

  // ---- output panel ----------------------------------------------------------
  function write(kind, text) {
    const span = document.createElement("span");
    if (kind === "err") span.className = "err";
    span.textContent = text;
    out.appendChild(span);
    // Keep the panel bounded: a print() in a 60 fps loop would otherwise
    // grow the DOM forever.
    while (out.childNodes.length > 400) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
  }

  // ---- running ---------------------------------------------------------------
  function sizeCanvas(w, h) {
    logicalW = w; logicalH = h;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.aspectRatio = w + " / " + h;
    canvas.style.maxWidth = w + "px";
  }

  function stop(msg) {
    if (worker) { worker.terminate(); worker = null; }
    stopBtn.disabled = true;
    if (msg) setStatus(msg);
  }

  async function run() {
    if (!ensureIsolated()) return;
    stop();
    out.textContent = "";
    hud.textContent = "";
    try { localStorage.setItem("brythonLabCode", editor.value); } catch (e) {}
    if (gamePy === null) gamePy = await (await fetch("game.py", { cache: "no-cache" })).text();
    ctrl = new Int32Array(new SharedArrayBuffer(K.SLOTS * 4));
    worker = new Worker("worker.js");
    stopBtn.disabled = false;   // Run stays live: pressing it again restarts
    runStarted = performance.now();
    setStatus("Loading Brython...");
    worker.onmessage = onWorker;
    worker.onerror = function (e) { write("err", "Worker error: " + (e.message || e) + "\n"); stop(); };
    worker.postMessage({ t: "run", src: editor.value, gamePy: gamePy, sab: ctrl.buffer,
                         dpr: window.devicePixelRatio || 1, brython: BRYTHON_BASE });
    canvas.focus();
  }

  function onWorker(ev) {
    const m = ev.data;
    if (m.t === "frame") {
      view.transferFromImageBitmap(m.bmp);
    } else if (m.t === "out") {
      write(m.k, m.text);
    } else if (m.t === "window") {
      sizeCanvas(m.w, m.h);
    } else if (m.t === "loaded") {
      setStatus("Brython loaded in " + Math.round(m.ms) + " ms. Running.");
    } else if (m.t === "stats") {
      hud.textContent = Math.round(m.fps) + " fps  |  Python " + m.py.toFixed(1) +
        " ms/frame  |  draw " + m.draw.toFixed(1) + " ms  |  " + m.sprites + " sprites";
      window.__labStats = m;
    } else if (m.t === "done") {
      stop("Finished.");
    }
  }

  // ---- input into the shared buffer -------------------------------------------
  function keyName(e) {
    if (e.key === "Shift") return "shift";
    if (e.key === "Control") return "ctrl";
    return String(e.key).toLowerCase();
  }
  function setKey(e, down) {
    if (!ctrl) return;
    const i = K.keyIndex(keyName(e));
    if (i >= 0) Atomics.store(ctrl, i, down ? 1 : 0);
  }
  canvas.addEventListener("keydown", function (e) {
    setKey(e, true);
    if (worker && (e.key === " " || e.key.indexOf("Arrow") === 0)) e.preventDefault();
  });
  canvas.addEventListener("keyup", function (e) { setKey(e, false); });
  canvas.addEventListener("blur", function () {
    if (!ctrl) return;
    for (let i = K.CTRL.KEYS; i < K.SLOTS; i++) Atomics.store(ctrl, i, 0);
  });
  function mouse(e) {
    if (!ctrl) return;
    const r = canvas.getBoundingClientRect();
    Atomics.store(ctrl, K.CTRL.MX, Math.round((e.clientX - r.left) * logicalW / r.width));
    Atomics.store(ctrl, K.CTRL.MY, Math.round((e.clientY - r.top) * logicalH / r.height));
    // Shift held while clicking counts as "shift pressed" even if the canvas
    // missed the keydown (focus was elsewhere).
    Atomics.store(ctrl, K.keyIndex("shift"), e.shiftKey ? 1 : 0);
  }
  canvas.addEventListener("pointermove", mouse);
  canvas.addEventListener("pointerenter", function (e) { mouse(e); if (ctrl) Atomics.store(ctrl, K.CTRL.MIN, 1); });
  canvas.addEventListener("pointerleave", function () { if (ctrl) Atomics.store(ctrl, K.CTRL.MIN, 0); });
  canvas.addEventListener("pointerdown", function (e) {
    canvas.focus();
    mouse(e);
    if (!ctrl) return;
    Atomics.store(ctrl, K.CTRL.MDOWN, 1);
    Atomics.add(ctrl, K.CTRL.CLICKS, 1);
  });
  window.addEventListener("pointerup", function () { if (ctrl) Atomics.store(ctrl, K.CTRL.MDOWN, 0); });

  // ---- editor niceties -----------------------------------------------------------
  editor.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = editor.selectionStart;
      editor.setRangeText("    ", s, editor.selectionEnd, "end");
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  });
  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", function () { stop("Stopped."); });
  $("reset").addEventListener("click", async function () {
    editor.value = await (await fetch("demo.py", { cache: "no-cache" })).text();
  });

  sizeCanvas(480, 360);
  (async function init() {
    let saved = null;
    try { saved = localStorage.getItem("brythonLabCode"); } catch (e) {}
    editor.value = saved || await (await fetch("demo.py", { cache: "no-cache" })).text();
    if (ensureIsolated()) setStatus("Ready. Press Run (Ctrl+Enter). Click the game to give it the keyboard.");
  })();

  window.__lab = { run: run, stop: stop };
})();
