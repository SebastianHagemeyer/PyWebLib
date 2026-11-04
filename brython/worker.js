/*
 * Brython lab worker: runs the player's Python in a Web Worker, so the page
 * stays responsive however heavy (or broken) the game loop is.
 *
 * Why each piece is here:
 *   - Brython transpiles Python to JavaScript, so a game.frame() call is a
 *     plain JS call: no WebAssembly boundary, no JSON in between.
 *   - The worker draws on its OWN OffscreenCanvas and hands each finished
 *     frame to the page as an ImageBitmap (transferred, so nothing is copied).
 *     The page never parses a scene description.
 *   - Keys and the mouse live in a SharedArrayBuffer the page writes into. A
 *     worker blocked in Atomics.wait can't receive postMessage, but it can
 *     always read shared memory, so input is never stale.
 *   - game.frame(fps) waits only for what is LEFT of the frame budget, so a
 *     loop that takes 10 ms at 60 fps still gets 60 fps (a fixed 16.7 ms sleep
 *     on top of the work would give ~37).
 */
importScripts("keys.js");

const K = self.LabKeys;
let ctrl = null;            // Int32Array over the shared buffer
let canvas = null, ctx = null;
let dpr = 1, logicalW = 480, logicalH = 360;
let nextDeadline = 0;
const stats = { frames: 0, py: 0, draw: 0, items: 0, since: 0, lastReturn: 0 };

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

function out(kind, text) { post({ t: "out", k: kind, text: String(text) }); }

// ---- the renderer --------------------------------------------------------
// One call per frame with a flat list (STRIDE values per sprite), already in
// draw order. Kinds: 0 box, 1 circle, 2 label, 3 emoji/text sprite.
const STRIDE = 10;
const fontCache = {};
function font(size) {
  return fontCache[size] || (fontCache[size] =
    "600 " + size + "px system-ui, 'Segoe UI', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif");
}

function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) { c.fillRect(x, y, w, h); return; }
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

function setupCanvas(w, h) {
  logicalW = w; logicalH = h;
  if (!canvas) {
    canvas = new OffscreenCanvas(Math.round(w * dpr), Math.round(h * dpr));
    ctx = canvas.getContext("2d", { alpha: false });
  } else {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  post({ t: "window", w: w, h: h });
}

function render(list, bg) {
  const c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = bg;
  c.fillRect(0, 0, logicalW, logicalH);
  c.textAlign = "center";
  c.textBaseline = "middle";
  const n = list.length;
  for (let i = 0; i < n; i += STRIDE) {
    const kind = list[i], x = list[i + 1], y = list[i + 2], w = list[i + 3], h = list[i + 4];
    const color = list[i + 5];
    if (kind === 0) {
      c.fillStyle = color;
      const r = list[i + 9];
      if (r) roundRect(c, x - w / 2, y - h / 2, w, h, r);
      else c.fillRect(x - w / 2, y - h / 2, w, h);
    } else if (kind === 1) {
      c.fillStyle = color;
      c.beginPath();
      c.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      const text = list[i + 6], back = list[i + 7], size = list[i + 8];
      c.font = font(size);
      if (back) {
        const tw = c.measureText(text).width;
        c.fillStyle = back;
        roundRect(c, x - tw / 2 - 6, y - size * 0.65, tw + 12, size * 1.3, size * 0.35);
      }
      c.fillStyle = color;
      c.fillText(text, x, y);
    }
  }
  const bmp = canvas.transferToImageBitmap();
  post({ t: "frame", bmp: bmp }, [bmp]);
}

// Park until the next frame is due. Only the time LEFT in the budget is
// waited; if we're more than a whole frame late we resync instead of trying
// to catch up with a burst of frames.
function waitFrame(fps) {
  const period = 1000 / Math.max(1, fps);
  const now = performance.now();
  if (nextDeadline < now - period) nextDeadline = now;
  if (nextDeadline > now) Atomics.wait(ctrl, K.CTRL.STOP, 0, nextDeadline - now);
  nextDeadline += period;
}

function blockSleep(ms) {
  if (ms > 0) Atomics.wait(ctrl, K.CTRL.STOP, 0, ms);
}

// ---- what Python sees as `_g.pwl` (imported by game.py) -------------------
self.pwl = {
  playing: function () { return Atomics.load(ctrl, K.CTRL.STOP) === 0; },
  pressed: function (name) {
    const i = K.keyIndex(name);
    return i >= 0 && Atomics.load(ctrl, i) === 1;
  },
  mouseX: function () { return Atomics.load(ctrl, K.CTRL.MX); },
  mouseY: function () { return Atomics.load(ctrl, K.CTRL.MY); },
  mouseDown: function () { return Atomics.load(ctrl, K.CTRL.MDOWN) === 1; },
  mouseIn: function () { return Atomics.load(ctrl, K.CTRL.MIN) === 1; },
  clicks: function () { return Atomics.load(ctrl, K.CTRL.CLICKS); },
  setup: function (w, h) { if (w !== logicalW || h !== logicalH || !canvas) setupCanvas(w, h); },
  // Width of a label's text, so a label used as a button is clickable across
  // its whole width rather than only near its middle.
  measure: function (text, size) {
    if (!ctx) setupCanvas(logicalW, logicalH);
    ctx.font = font(size);
    return ctx.measureText(String(text)).width;
  },
  sleep: function (seconds) { blockSleep(seconds * 1000); },
  // The whole per-frame round trip: draw, hand the bitmap over, then wait.
  frame: function (list, bg, fps) {
    const t0 = performance.now();
    if (stats.lastReturn) stats.py += t0 - stats.lastReturn;
    if (!canvas) setupCanvas(logicalW, logicalH);
    render(list, bg);
    const t1 = performance.now();
    stats.draw += t1 - t0;
    stats.items = list.length / STRIDE;
    stats.frames++;
    if (t1 - stats.since >= 500) {
      post({ t: "stats", fps: stats.frames * 1000 / (t1 - stats.since),
             py: stats.py / stats.frames, draw: stats.draw / stats.frames, sprites: stats.items });
      stats.frames = 0; stats.py = 0; stats.draw = 0; stats.since = t1;
    }
    waitFrame(fps);
    stats.lastReturn = performance.now();
  }
};

// ---- boot ---------------------------------------------------------------
const STDIO_PY = [
  "import sys",
  "from browser import self as _g",
  "class _Out:",
  "    def __init__(self, kind): self.kind = kind",
  "    def write(self, text): _g.labOut(self.kind, text)",
  "    def flush(self): pass",
  "sys.stdout = _Out('out')",
  "sys.stderr = _Out('err')",
  "import time",
  "time.sleep = _g.pwl.sleep",
  ""
].join("\n");

self.onmessage = function (ev) {
  const m = ev.data;
  if (m.t !== "run") return;
  ctrl = new Int32Array(m.sab);
  dpr = m.dpr || 1;
  const t0 = performance.now();
  try {
    importScripts(m.brython + "brython.min.js", m.brython + "brython_stdlib.js");
  } catch (e) {
    out("err", "Could not load Brython from " + m.brython + "\n" + e);
    post({ t: "done" });
    return;
  }
  const B = self.__BRYTHON__;
  let wroteErr = false;
  self.labOut = function (kind, text) {
    if (kind === "err") wroteErr = true;
    out(kind, text);
  };
  post({ t: "loaded", ms: performance.now() - t0 });
  try {
    B.runPythonSource(STDIO_PY, { id: "_lab_stdio" });
    B.runPythonSource(m.gamePy, { id: "game" });
    const t1 = performance.now();
    stats.since = t1;
    B.runPythonSource(m.src, { id: "__main__" });
  } catch (e) {
    // Brython has normally printed a full Python traceback to stderr already.
    if (!wroteErr) out("err", (e && (e.message || (e.args && e.args[0]))) || String(e));
  }
  post({ t: "done" });
};
