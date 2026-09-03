/*
 * Pyodide worker for the non-JSPI runtime. It runs the SAME Python modules the
 * main thread uses (forwarded as install strings), with two swaps that remove
 * the JSPI requirement:
 *   1. pyodide.ffi.run_sync is monkeypatched to a passthrough, and
 *   2. the _io blocking calls (sleep / next_frame / input) block THIS worker
 *      with Atomics.wait on a SharedArrayBuffer instead of stack-switching.
 * Draw calls are posted to the main thread, which replays them through the
 * existing TURTLE_IO / GAME_IO. Live input (keys, mouse, playing) is read
 * straight out of the shared buffer, and so is the multiplayer room: this
 * worker cannot receive a postMessage while it is parked in Atomics.wait, so
 * the main thread writes each new room snapshot into the buffer instead.
 */
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
importScripts(PYODIDE_URL + "pyodide.js", "./pyrun-proto.js");

let pyodide = null;
let mem = null;                 // { ctrl, str, interruptView, ... } from PRProto.attach
const assetRatios = {};         // asset id -> width/height, pushed from the main thread
const assetInks = {};            // asset id -> "fx,fy,fw,fh" artwork box, likewise
let savedState = {};            // logical save key -> blob, seeded by "saveSnapshot" at run start
let netId = "solo";             // my multiplayer player id, handed over at init
let netAvailable = false;       // is a multiplayer backend configured at all?
let netSeqSeen = -1;            // last settled snapshot counter we decoded
let netCache = "";              // ...and the JSON we decoded from it
let lastTextSeq = -1;          // last game.textbox() submission counter we returned
const CTRL = self.PRProto.CTRL;
const dec = new TextDecoder();

function post(io, op, args) { self.postMessage({ t: "io", io: io, op: op, args: args }); }

// Park the worker for `ms`, waking early if the main thread bumps the SLEEP slot
// (a stop). Reading the value first makes it race-safe: if it already changed,
// Atomics.wait returns immediately.
function blockSleep(ms) {
  const v = Atomics.load(mem.ctrl, CTRL.SLEEP);
  Atomics.wait(mem.ctrl, CTRL.SLEEP, v, Math.max(0, ms | 0));
}
// Ask the main thread for a line, then block until it's submitted (or a stop).
function blockInput(prompt) {
  Atomics.store(mem.ctrl, CTRL.INLEN, -1);
  post("s", "requestInput", [String(prompt == null ? "" : prompt)]);
  const v = Atomics.load(mem.ctrl, CTRL.INPUT);
  Atomics.wait(mem.ctrl, CTRL.INPUT, v);
  if (Atomics.load(mem.ctrl, CTRL.STOP) === 1) return "";
  const len = Atomics.load(mem.ctrl, CTRL.INLEN);
  if (len <= 0) return "";
  // TextDecoder rejects SharedArrayBuffer views, so copy to a plain array first.
  const copy = new Uint8Array(Math.min(len, mem.str.length));
  copy.set(mem.str.subarray(0, copy.length));
  return dec.decode(copy);
}

const TURTLE_IO = {
  animateOk: function () { return true; },
  sleepMs: function (seconds) { blockSleep(seconds * 1000); },
  segment: function (x1, y1, x2, y2, color, width) { post("t", "segment", [x1, y1, x2, y2, color, width]); },
  fillPoly: function (flat, color) { post("t", "fillPoly", [Array.from(flat), color]); },
  dot: function (x, y, size, color) { post("t", "dot", [x, y, size, color]); },
  text: function (x, y, text, color, size, align, fontName) { post("t", "text", [x, y, text, color, size, align, fontName]); },
  bg: function (color) { post("t", "bg", [color]); },
  wipe: function () { post("t", "wipe", []); },
  sprite: function (x, y, heading, visible) { post("t", "sprite", [x, y, heading, visible]); }
};

const GAME_IO = {
  jspiOk: function () { return true; },
  playing: function () { return Atomics.load(mem.ctrl, CTRL.PLAYING) === 1; },
  stop: function () { Atomics.store(mem.ctrl, CTRL.PLAYING, 0); },
  restart: function () { Atomics.store(mem.ctrl, CTRL.RESTART, 1); },
  reset: function () { Atomics.store(mem.ctrl, CTRL.PLAYING, 1); post("g", "reset", []); },
  setup: function (w, h, bg) { Atomics.store(mem.ctrl, CTRL.PLAYING, 1); post("g", "setup", [w, h, bg]); },
  setCursor: function (hidden) { post("g", "setCursor", [hidden]); },
  fullscreen: function (on) { post("g", "fullscreen", [!!on]); },
  submitScore: function (points) { post("g", "submitScore", [points]); },
  // Save games. Writes go to the main thread to hit localStorage, and also
  // update the local snapshot so an immediate load() sees them. Reads are served
  // straight from the snapshot (seeded before the run) - no round-trip needed.
  saveState: function (key, blob) {
    savedState[String(key)] = String(blob);
    post("g", "saveState", [String(key), String(blob)]);
  },
  loadState: function (key) {
    var k = String(key);
    return Object.prototype.hasOwnProperty.call(savedState, k) ? savedState[k] : null;
  },
  clearState: function (key) {
    if (key == null) { savedState = {}; post("g", "clearState", [null]); }
    else { delete savedState[String(key)]; post("g", "clearState", [String(key)]); }
  },
  sound: function (name) { post("g", "sound", [name]); },
  toneStart: function (id, freq, wave, vol) { post("g", "toneStart", [id, freq, wave, vol]); },
  tonePitch: function (id, hz) { post("g", "tonePitch", [id, hz]); },
  toneVolume: function (id, v) { post("g", "toneVolume", [id, v]); },
  toneStop: function (id) { post("g", "toneStop", [id]); },
  preloadAssets: function (ids) { post("g", "preloadAssets", [String(ids)]); },
  // The art lives on the main thread, so it pushes each asset's shape over as it
  // loads (see the "assetRatio" message). 1 until then: a square box, which is
  // what this did before, and it corrects itself once the art arrives.
  assetRatio: function (id) {
    if (id == null || id === "") return 1;
    post("g", "preloadAssets", [JSON.stringify([id])]);   // make sure it is being fetched
    return assetRatios[String(id)] || 1;
  },
  assetInk: function (id) {
    if (id == null || id === "") return "";
    return assetInks[String(id)] || "";
  },
  pressed: function (key) { return Atomics.load(mem.ctrl, self.PRProto.keyIndex(key)) === 1; },
  mouseX: function () { return Atomics.load(mem.ctrl, CTRL.MX); },
  mouseY: function () { return Atomics.load(mem.ctrl, CTRL.MY); },
  mouseIn: function () { return Atomics.load(mem.ctrl, CTRL.MIN) === 1; },
  mouseDown: function () { return Atomics.load(mem.ctrl, CTRL.MDOWN) === 1; },
  mouseClicks: function () { return Atomics.load(mem.ctrl, CTRL.MCLICKS); },
  nextFrame: function (seconds) { blockSleep(seconds * 1000); },
  // Every canvas lives on the main thread, so saving is just a message: no
  // OffscreenCanvas, and no blob has to be handed back across the boundary.
  saveImage: function (which, name, ask) { post("g", "saveImage", [String(which), String(name), !!ask]); },
  copyImage: function (which) { post("g", "copyImage", [String(which)]); },
  // DOM widgets (game.textbox()/game.button()) live on the main thread; making
  // and moving them is fire-and-forget. Reading events is the interesting half.
  uiCreate: function (id, kind, props) { post("g", "uiCreate", [String(id), String(kind), String(props)]); },
  uiUpdate: function (id, props) { post("g", "uiUpdate", [String(id), String(props)]); },
  uiRemove: function (id) { post("g", "uiRemove", [String(id)]); },
  // Recent submit/click events as JSON, read out of the shared buffer (a worker
  // parked in Atomics.wait can't be handed them any other way). "" when nothing
  // new since the last poll; Python de-dupes the array by each event's seq.
  uiPoll: function () {
    const seq = Atomics.load(mem.ctrl, CTRL.TEXTSEQ);
    if (seq === lastTextSeq) return "";
    lastTextSeq = seq;
    const n = Atomics.load(mem.ctrl, CTRL.TEXTLEN);
    if (n <= 0) return "";
    return dec.decode(mem.str.slice(0, n));
  },
  draw: function (json) { post("g", "draw", [String(json)]); }
};

// 3D (import game3d). Only the rendering has to reach the main thread; the
// blocking and the live input work exactly like the 2D game's.
const GAME3D_IO = {
  jspiOk: function () { return true; },   // run_sync is a passthrough here
  nextFrame: function (seconds) { blockSleep(seconds * 1000); },
  pressed: function (key) { return Atomics.load(mem.ctrl, self.PRProto.keyIndex(key)) === 1; },
  reset: function () { Atomics.store(mem.ctrl, CTRL.PLAYING, 1); post("d", "reset", []); },
  draw: function (json) { post("d", "draw", [String(json)]); }
};

// Multiplayer (import net). Sending is fire-and-forget to the main thread,
// which owns the socket. READING is the interesting half: a worker stuck in
// Atomics.wait never runs its message handler, so the room cannot be delivered
// by postMessage and is read out of the shared buffer instead.
const NET_IO = {
  myId: function () { return netId; },
  available: function () { return netAvailable; },
  join: function (room, name, rate) { post("n", "join", [String(room), String(name), Number(rate) || 5]); },
  leave: function () { post("n", "leave", []); },
  publish: function (json) { post("n", "publish", [String(json)]); },
  setShared: function (key, json) { post("n", "setShared", [String(key), String(json)]); },
  reset: function () { post("n", "reset", []); },
  /* The read side of the seqlock in pyrun.js: the writer makes the counter odd
   * while the bytes are changing and even once they have settled. An odd count,
   * or a count that moved while we were copying, means we caught a half-written
   * snapshot, so we keep the last good one — one stale frame beats handing
   * Python a torn string to parse. */
  snapshot: function () {
    const before = Atomics.load(mem.ctrl, CTRL.NETSEQ);
    if (before % 2 !== 0) return netCache;          // a write is in flight
    if (before === netSeqSeen) return netCache;     // nothing new since last time
    const len = Atomics.load(mem.ctrl, CTRL.NETLEN);
    if (len <= 0) { netSeqSeen = before; netCache = ""; return netCache; }
    const copy = new Uint8Array(Math.min(len, mem.net.length));
    copy.set(mem.net.subarray(0, copy.length));
    if (Atomics.load(mem.ctrl, CTRL.NETSEQ) !== before) return netCache;   // it moved: torn
    netCache = dec.decode(copy);
    netSeqSeen = before;
    return netCache;
  }
};

const SANDBOX_IO = {
  readLine: function (prompt) { return blockInput(prompt); },
  sleepMs: function (seconds) { blockSleep(seconds * 1000); },
  shouldStop: function () { return Atomics.load(mem.ctrl, CTRL.STOP) === 1; },
  clearOutput: function () { post("s", "clearOutput", []); },
  writeColored: function (text, color) { post("s", "writeColored", [String(text), String(color)]); }
};

const RESET_PY =
  "import sys\n" +
  "if 'turtle' in sys.modules: sys.modules['turtle']._reset_all()\n" +
  "if 'game' in sys.modules: sys.modules['game']._reset_all()\n" +
  "if 'game3d' in sys.modules: sys.modules['game3d']._reset_all()\n" +
  "if 'net' in sys.modules: sys.modules['net']._reset_all()\n";

self.onmessage = async function (e) {
  const msg = e.data;
  try {
    if (msg.type === "assetRatio") { assetRatios[String(msg.id)] = Number(msg.ratio) || 1; return; }
    if (msg.type === "assetInk") { assetInks[String(msg.id)] = String(msg.ink || ""); return; }
    if (msg.type === "saveSnapshot") { savedState = msg.data || {}; return; }
    if (msg.type === "init") {
      mem = self.PRProto.attach(msg.sab, msg.interrupt);
      netId = String(msg.netId || "solo");
      netAvailable = !!msg.netAvailable;
      pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
      pyodide.setInterruptBuffer(mem.interruptView);
      pyodide.setStdout({ batched: function (s) { post("s", "stdout", [s]); } });
      pyodide.setStderr({ batched: function (s) { post("s", "stderr", [s]); } });
      pyodide.registerJsModule("_sandbox_io", SANDBOX_IO);
      pyodide.registerJsModule("_turtle_io", TURTLE_IO);
      pyodide.registerJsModule("_game_io", GAME_IO);
      pyodide.registerJsModule("_game3d_io", GAME3D_IO);
      pyodide.registerJsModule("_net_io", NET_IO);
      // The swap that removes the JSPI requirement: run_sync just returns its
      // argument, because the blocking already happened inside the _io call.
      pyodide.runPython("import pyodide.ffi as _f\n_f.run_sync = lambda x: x\n");
      const inst = msg.installs;
      for (let i = 0; i < inst.length; i++) await pyodide.runPythonAsync(inst[i]);
      post("s", "ready", []);
    } else if (msg.type === "run") {
      // Fresh state each run, like the main-thread path.
      Atomics.store(mem.ctrl, CTRL.STOP, 0);
      mem.interruptView[0] = 0;
      // A game can ask to restart itself (game_over(retry=True)); re-run the
      // whole program each time it does, until it ends normally or is stopped.
      do {
        Atomics.store(mem.ctrl, CTRL.RESTART, 0);
        await pyodide.runPythonAsync(RESET_PY);
        const ns = pyodide.runPython("dict(__name__='__main__')");
        try {
          await pyodide.runPythonAsync(msg.code, { globals: ns });
        } finally { ns.destroy(); }
      } while (Atomics.load(mem.ctrl, CTRL.RESTART) === 1 && Atomics.load(mem.ctrl, CTRL.STOP) === 0);
      self.postMessage({ t: "done" });
    }
  } catch (err) {
    const m = (err && err.message) ? String(err.message) : String(err);
    self.postMessage({ t: "runerror", msg: m });
  }
};
