/*
 * Pyodide runs HERE, off the main thread. The turtle's "sleep between segments"
 * blocks this worker with Atomics.wait() on a SharedArrayBuffer - the universal,
 * JSPI-free way to suspend synchronous WASM/Python. The main thread keeps
 * rendering while this thread is parked. Works anywhere SharedArrayBuffer does
 * (Safari 15.2+, Firefox, Chrome).
 */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
importScripts(PYODIDE + "pyodide.js");

let pyodide = null;
let waitBuf = null;   // Int32Array over the SharedArrayBuffer

const TURTLE_PY = `
import math
from js import _seg, _sleep

class Turtle:
    def __init__(self):
        self.x = 0.0; self.y = 0.0; self.h = 0.0; self.pen = "#22d3a5"
    def color(self, c): self.pen = c
    def right(self, a): self.h -= a
    def left(self, a): self.h += a
    def forward(self, d):
        nx = self.x + math.cos(math.radians(self.h)) * d
        ny = self.y + math.sin(math.radians(self.h)) * d
        _seg(self.x, self.y, nx, ny, self.pen)   # draw on the main thread
        self.x, self.y = nx, ny
        _sleep(18)                                # BLOCKS this worker via Atomics.wait

t = Turtle()
colors = ["#22d3a5", "#ffd43b", "#ff6b6b", "#4f46e5", "#f78c6c", "#89ddff"]
for i in range(150):
    t.color(colors[i % len(colors)])
    t.forward(4 + i * 1.4)
    t.right(59)
print("spiral complete")
`;

self.onmessage = async function (e) {
  const msg = e.data;
  if (msg.type === "init") {
    waitBuf = new Int32Array(msg.sab);
    // Expose the draw + sleep primitives to Python.
    self._seg = function (x1, y1, x2, y2, color) {
      self.postMessage({ type: "seg", a: [x1, y1, x2, y2], c: String(color) });
    };
    self._sleep = function (ms) {
      // Park the worker for `ms`. No value ever gets notified, so it just times
      // out - a real blocking sleep with zero busy-waiting and no JSPI.
      Atomics.wait(waitBuf, 0, 0, ms);
    };
    try {
      pyodide = await loadPyodide({ indexURL: PYODIDE });
      self.postMessage({
        type: "ready",
        jspiInWorker: (typeof WebAssembly.Suspending === "function"),
        sabOk: (typeof SharedArrayBuffer !== "undefined")
      });
    } catch (err) {
      self.postMessage({ type: "error", where: "loadPyodide (CDN under COEP?)", msg: String(err && err.message || err) });
    }
  } else if (msg.type === "run") {
    try {
      await pyodide.runPythonAsync(TURTLE_PY);   // the _sleep calls block synchronously via Atomics
      self.postMessage({ type: "done" });
    } catch (err) {
      self.postMessage({ type: "error", where: "run", msg: String(err && err.message || err) });
    }
  }
};
