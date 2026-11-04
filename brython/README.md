# Brython lab

An experiment: run PyWebLib's `import game` programs with
[Brython](https://brython.info/) (Python compiled to JavaScript) instead of
Pyodide (CPython compiled to WebAssembly), and find out where the speed actually
goes. It is completely separate from the main site: nothing outside this folder
loads it, and it changes nothing in `pyrun.js`.

- `index.html` + `lab.js`: the page (editor, canvas, Run/Stop, an fps readout).
- `worker.js`: loads Brython in a Web Worker and runs the program there.
- `game.py`: a small, fast `game` module (a subset of the real one, below).
- `keys.js`: the key table shared by the page and the worker.
- `demo.py`: a block-mining platformer used as the test game.
- `bench.html` + `bench.py`: raw Python speed, Brython against Pyodide.

Open `/brython/` on the site, or locally run `python -m http.server` from the
repo root and go to `http://localhost:8000/brython/`. The first visit reloads
once to switch on cross-origin isolation (see "How it works").

## Results

Headless Chromium on the same machine, running `demo.py` (about 200 blocks, 3
enemies, a player that collides with every block twice a frame):

| Runtime | fps | Python per frame |
| --- | --- | --- |
| PyWebLib today (Pyodide, main thread) | 15.5 | 40 ms |
| PyWebLib with `sys.settrace` removed | 41 | 5.3 ms |
| ...and `frame()` waiting only for the rest of the frame | **60** | 5.3 ms |
| This Brython lab | **60** | 3.5 to 5 ms |

Raw Python speed (`bench.html`, lower is better):

| Measure | Brython | Pyodide |
| --- | --- | --- |
| Start-up, ms | ~200 | ~1,900 |
| Rotated-box collisions, ms/frame | 88 | 6.5 |
| Plain box collisions, ms/frame | 2.6 | 0.2 |
| `fib(22)`, ms | 16 | 2.9 |

What that means:

1. **Brython isn't faster at Python. Pyodide is about 6 to 13 times
   faster.** Brython's real advantages are start-up (about 10x quicker, with
   far less to download) and calling JavaScript cheaply.
2. **The main site's slowness comes from two things in PyWebLib, not from
   Pyodide.**
   - The Stop button is wired up with `sys.settrace(trace)` (`PY_INSTALL_INTERRUPT`
     in `pyrun.js`). That calls a Python function on every line, call and
     return of the program, which made this game about 7.5x slower. Stop can
     only take effect while Python is parked in `frame()`, `sleep()` or
     `input()` anyway, because that's the only time the page's JavaScript
     gets to run. So a check at those points does the same job for free.
   - `game.frame(60)` sleeps a full 1/60 s *after* the frame's work instead of
     waiting until the next frame is due. 5 ms of work plus a 16.7 ms sleep
     caps the game at about 45 fps, even on a fast computer.
3. **The algorithm matters more than the runtime.** `touches()` on unrotated
   sprites as a plain box test is ~25x faster than the rotated-box maths in
   both runtimes. The lab's `game.py` takes that shortcut whenever neither
   sprite has an angle.

## How it works (and why each part is fast)

- **Python runs in a Web Worker.** The page never freezes, and Stop is
  `worker.terminate()`, which ends even a `while True:` that never calls
  `frame()`.
- **The worker draws on its own `OffscreenCanvas`** and transfers each finished
  frame to the page as an `ImageBitmap` (moved, not copied). There's no JSON
  scene and no parsing on the page side.
- **One call into JavaScript per frame.** `frame()` passes a flat list of
  numbers and strings rather than a dict per sprite.
- **Input lives in a `SharedArrayBuffer`.** A worker blocked in
  `Atomics.wait` can't receive messages, but it can always read shared memory,
  so keys and the mouse are never stale.
- **Deadline-based frames.** `frame(fps)` waits only for what's left of the
  frame budget.
- **Cross-origin isolation** (needed for `SharedArrayBuffer`) comes from the
  site's existing `coi-serviceworker.js`, registered for this folder only, so
  the rest of the site is unaffected.

## Brython compatibility (tested)

Works like CPython: `try`/`except`/`else`/`finally`, `raise ... from`, custom
exception classes, tracebacks with line numbers and `^^^` markers, f-strings
with format specs and `=`, `match`/`case`, generators, `yield from`, the walrus
operator, `global`/`nonlocal`, properties, `__slots__`, operator overloading,
dataclasses, big integers, `//` and `%` on negatives, `round()`, and the stdlib
modules games use (`random` with the same seeded sequence as CPython, `math`,
`json`, `time`, `re`, `collections`, `itertools`, `functools`, `enum`,
`heapq`). Injecting your own modules works too: this lab's `game` is one.

Doesn't work:
- **Packages with C code** (numpy, pandas, and so on). Pyodide can load these;
  Brython can't.
- **`asyncio`** is a stub (Brython has its own `browser.aio`).
- **`threading`** runs threads one after another, not at the same time.
- **Blocking calls** (`time.sleep`, `input()`, a game loop) only work off the
  main thread, which is why this lab uses a worker. `time.sleep` is patched;
  `input()` isn't wired up here.

## What the lab's `game` module covers

`window`, `background`, `box`, `circle`, `label`, `sprite` (emoji/text only),
`pressed`, `mouse_x`, `mouse_y`, `mouse_down`, `mouse_in`, `clicked`,
`playing`, `frame`, `score`, `game_over`, `stop`. Sprites have `x`, `y`, `w`,
`h`, `color`, `layer`/`z`, `content`/`text`, `size`, `visible`, `angle`,
`touches`, `touching`, `at_mouse`, `hide`, `show`, `remove`, plus any attribute
you add yourself (`slime.vy = 0`).

Not ported: drawn art skins and Asset studio sprites, `animate`, anchors,
scale, custom hitboxes, `debug`, sounds and tones, save/load, ink (`plot`,
`line`), text boxes and buttons, `fullscreen`, `submit_score`, `import net`,
`import game3d`, `import turtle`, `input()`, coloured `print`. Many published
games use at least one of these, so they won't run here as they stand.

One deliberate difference: a label's hit box is its text, so a label used as a
button works when clicked anywhere on it. On the main site, a label's hit box is
a small square in the middle of the text.
