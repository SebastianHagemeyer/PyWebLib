/*
 * PyRun: a reusable in-browser Python runner for PyWebLib.
 *
 * The engine (Pyodide + JSPI input()/sleep, a Stop button, clear() and
 * print(col=)) is wrapped in a factory so a page can embed an editor +
 * output panel just by calling PyRun.create(...).
 *
 * Also here: optional canvas-backed `turtle` and `game` modules, so code can
 * `import turtle` to draw or `import game` to make games. Both animate via the
 * same interruptible-sleep JSPI trick, and the Stop button interrupts them.
 *
 * Usage:
 *   var runner = PyRun.create({
 *     editor:  el,           // contenteditable div for code
 *     output:  el,           // <pre> for program output
 *     runBtn:  el,           // Run/Stop button (label span optional)
 *     storageKey: "key",     // localStorage autosave slot
 *     defaultCode: "...",
 *     turtle: { canvas: el, sprite: el },  // optional drawing canvases
 *     game:   { canvas: el }               // optional game canvas
 *   });
 */
(function () {
  "use strict";

  const PYODIDE_VERSION = "0.27.7";
  const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/pyodide.js";
  const CODEJAR_URL = "https://cdn.jsdelivr.net/npm/codejar@4.0.0/dist/codejar.min.js";

  // One Pyodide per page, shared by every runner instance. Only one
  // program runs at a time; `active` is the runner whose panels receive
  // stdout, input prompts and turtle drawing.
  let pyodide = null;
  let loadingPromise = null;
  let active = null;
  let running = false;
  let pendingReject = null;
  let stopRequested = false;

  // JSPI (WebAssembly stack switching) lets input() and sleep block on
  // the main thread without freezing the page. Chrome/Edge 137+.
  function jspiSupported() {
    return typeof WebAssembly !== "undefined" &&
      typeof WebAssembly.Suspending === "function";
  }

  // ---- Non-JSPI runtime (Safari/Firefox): run Pyodide in a Web Worker and
  //      block on SharedArrayBuffer instead of stack switching. Chrome/Edge keep
  //      the fast main-thread JSPI path and never touch any of this. ----------
  let workerMem = null;                 // shared SAB views (main side)
  let sharedWorker = null, sharedWorkerReady = null, workerReadyResolve = null, workerFinalize = null;
  const WORKER_URL = "/runtime/pyrun-worker.js";
  let FORCE_WORKER = false;
  try { FORCE_WORKER = /[?&#]pyworker=1\b/.test(location.search + location.hash) || localStorage.getItem("pyworker") === "1"; } catch (e) {}
  function useWorkerRuntime() { return !jspiSupported() || FORCE_WORKER; }

  // Only non-JSPI browsers register coi-serviceworker (it reloads once to apply
  // the isolation headers SharedArrayBuffer needs). So isolation, and its OAuth
  // question, only ever apply on Safari/Firefox, never on Chrome.
  (function registerCoi() {
    try {
      if (!useWorkerRuntime() || typeof window === "undefined") return;
      if (window.crossOriginIsolated || !window.isSecureContext || !navigator.serviceWorker) return;
      navigator.serviceWorker.register("/coi-serviceworker.js", { scope: "/" }).then(function (reg) {
        if (!navigator.serviceWorker.controller && reg.active) window.location.reload();
      }).catch(function () {});
      navigator.serviceWorker.addEventListener("controllerchange", function () { window.location.reload(); });
    } catch (e) {}
  })();

  // ---- Python-side setup strings (same behaviour as sandbox.js) ----------

  const PY_INSTALL_INPUT = `
import builtins as _b
def _pyrun_install_input():
    import sys
    from pyodide.ffi import run_sync
    from _sandbox_io import readLine
    def input(prompt=""):
        sys.stdout.flush()
        sys.stderr.flush()
        return run_sync(readLine(str(prompt)))
    _b.input = input
_pyrun_install_input()
del _pyrun_install_input, _b
`;

  const PY_DISABLE_INPUT = `
import builtins as _b
def _pyrun_install_input():
    def input(*args, **kwargs):
        raise RuntimeError(
            "Interactive input() needs Chrome or Edge in this sandbox. "
            "Open this page there, or set a variable instead, e.g. name = 'Alex'"
        )
    _b.input = input
_pyrun_install_input()
del _pyrun_install_input, _b
`;

  const PY_PATCH_SLEEP = `
def _pyrun_install_sleep():
    import time, sys
    from pyodide.ffi import run_sync
    from _sandbox_io import sleepMs
    def _yielding_sleep(seconds):
        sys.stdout.flush()
        sys.stderr.flush()
        if seconds and seconds > 0:
            run_sync(sleepMs(seconds))
    time.sleep = _yielding_sleep
_pyrun_install_sleep()
del _pyrun_install_sleep
`;

  const PY_INSTALL_INTERRUPT = `
def _pyrun_install_interrupt():
    import sys
    from _sandbox_io import shouldStop
    counter = [0]
    def trace(frame, event, arg):
        counter[0] += 1
        if counter[0] >= 500:
            counter[0] = 0
            # Never raise inside the event loop's own machinery. settrace is
            # global, so the counter can trip while the interpreter is deep in
            # pyodide's webloop scheduling a callback. The KeyboardInterrupt
            # then lands in an asyncio Handle that nobody awaits: it escapes as
            # an unhandled promise rejection, runPythonAsync never settles, and
            # the run's finally block never runs, so Stop stays stuck as Stop
            # and the program can't be started again without a reload.
            # User code is what we want to interrupt, and it is never in here.
            name = frame.f_code.co_filename
            if "webloop" in name or "/asyncio/" in name:
                return trace
            if shouldStop():
                raise KeyboardInterrupt("Stopped by user")
        return trace
    sys.settrace(trace)
_pyrun_install_interrupt()
del _pyrun_install_interrupt
`;

  const PY_INSTALL_CLEAR = `
def _pyrun_install_clear():
    import sys, builtins
    from _sandbox_io import clearOutput
    def clear():
        sys.stdout.flush()
        sys.stderr.flush()
        clearOutput()
    builtins.clear = clear
_pyrun_install_clear()
del _pyrun_install_clear
`;

  const PY_INSTALL_COLOR_PRINT = `
def _pyrun_install_color_print():
    import sys, builtins
    from _sandbox_io import writeColored
    real_print = builtins.print
    def print(*args, col=None, color=None, sep=' ', end='\\n', file=None, flush=False):
        chosen = col if col is not None else color
        if chosen is not None and file is None:
            sys.stdout.flush()
            sys.stderr.flush()
            text = sep.join(str(a) for a in args) + end
            writeColored(text, str(chosen))
        else:
            real_print(*args, sep=sep, end=end, file=file, flush=flush)
    builtins.print = print
_pyrun_install_color_print()
del _pyrun_install_color_print
`;

  // ---- The turtle module ---------------------------------------------------
  // A classroom-sized reimplementation of Python's turtle on a canvas.
  // One shared turtle; turtle.Turtle() returns a proxy to it so code from
  // any beginner tutorial ("t = turtle.Turtle()") still works. Coordinates
  // match real turtle: origin at the centre, y grows upward, heading 0 = east.
  const PY_INSTALL_TURTLE = `
def _pyrun_install_turtle():
    import sys, math, types
    import _turtle_io as _io

    _animate_ok = bool(_io.animateOk())
    if _animate_ok:
        from pyodide.ffi import run_sync

    S = {}

    def _reset_state():
        S.update(x=0.0, y=0.0, heading=0.0, pen=True, visible=True,
                 pencolor="#22d3a5", fillcolor="#22d3a5", width=2,
                 speed=6, filling=False, path=[])

    _reset_state()

    def _sync():
        _io.sprite(S["x"], S["y"], S["heading"], S["visible"])

    def _pause(ms):
        if _animate_ok and ms > 0:
            run_sync(_io.sleepMs(ms / 1000))

    def _frame_delay():
        # speed 1 = slow and dramatic, 10 = quick, 0 = instant
        sp = S["speed"]
        if not sp:
            return 0
        return (11 - max(1, min(10, sp))) * 3

    def _goto(nx, ny):
        nx = float(nx); ny = float(ny)
        dist = math.hypot(nx - S["x"], ny - S["y"])
        delay = _frame_delay()
        steps = 1
        if delay and dist > 0:
            steps = max(1, min(int(dist / 10) + 1, 40))
        sx, sy = S["x"], S["y"]
        for i in range(1, steps + 1):
            px = sx + (nx - sx) * i / steps
            py = sy + (ny - sy) * i / steps
            if S["pen"]:
                _io.segment(S["x"], S["y"], px, py, S["pencolor"], S["width"])
            S["x"], S["y"] = px, py
            _sync()
            if steps > 1 or delay:
                _pause(delay)
        if S["filling"]:
            S["path"].append((S["x"], S["y"]))

    # ---- movement ----
    def forward(distance):
        rad = math.radians(S["heading"])
        _goto(S["x"] + math.cos(rad) * distance, S["y"] + math.sin(rad) * distance)
    def backward(distance): forward(-distance)
    def left(angle):
        S["heading"] = (S["heading"] + angle) % 360
        _sync()
    def right(angle): left(-angle)
    def goto(x, y=None):
        if y is None:
            x, y = x        # accept goto((x, y))
        _goto(x, y)
    def setx(x): _goto(x, S["y"])
    def sety(y): _goto(S["x"], y)
    def setheading(angle):
        S["heading"] = angle % 360
        _sync()
    def home():
        _goto(0, 0)
        setheading(0)
    def circle(radius, extent=360):
        # Approximate with short segments, like real turtle does.
        steps = max(12, min(72, int(abs(extent) / 5)))
        step_angle = extent / steps
        side = 2 * abs(radius) * math.sin(math.radians(abs(step_angle)) / 2)
        turn = step_angle if radius >= 0 else -step_angle
        left(turn / 2)
        for _ in range(steps):
            forward(side)
            left(turn)
        left(-turn / 2)

    # ---- pen ----
    def penup():
        S["pen"] = False
    def pendown():
        S["pen"] = True
    def isdown():
        return S["pen"]
    def pensize(width=None):
        if width is None:
            return S["width"]
        S["width"] = max(1, float(width))
    def pencolor(c=None):
        if c is None:
            return S["pencolor"]
        S["pencolor"] = str(c)
    def fillcolor(c=None):
        if c is None:
            return S["fillcolor"]
        S["fillcolor"] = str(c)
    def color(*args):
        if not args:
            return (S["pencolor"], S["fillcolor"])
        pencolor(args[0])
        fillcolor(args[1] if len(args) > 1 else args[0])
    def begin_fill():
        S["filling"] = True
        S["path"] = [(S["x"], S["y"])]
    def end_fill():
        if S["filling"] and len(S["path"]) > 2:
            flat = []
            for (px, py) in S["path"]:
                flat.append(px); flat.append(py)
            _io.fillPoly(flat, S["fillcolor"])
        S["filling"] = False
        S["path"] = []
    def dot(size=None, c=None):
        if size is None:
            size = max(S["width"] + 4, S["width"] * 2)
        _io.dot(S["x"], S["y"], size, str(c) if c else S["pencolor"])
        _pause(_frame_delay())
    def write(text, move=False, align="left", font=("Arial", 12, "normal")):
        size = 12
        name = "Arial"
        try:
            name = str(font[0]); size = int(font[1])
        except Exception:
            pass
        _io.text(S["x"], S["y"], str(text), S["pencolor"], size, str(align), name)

    # ---- looks & misc ----
    def speed(value=None):
        if value is None:
            return S["speed"]
        names = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}
        if isinstance(value, str):
            value = names.get(value, 6)
        S["speed"] = max(0, min(10, int(value)))
    def hideturtle():
        S["visible"] = False
        _sync()
    def showturtle():
        S["visible"] = True
        _sync()
    def bgcolor(c):
        _io.bg(str(c))
    def position():
        return (S["x"], S["y"])
    def xcor(): return S["x"]
    def ycor(): return S["y"]
    def heading(): return S["heading"]
    def clear():
        _io.wipe()
        _sync()
    def reset():
        _io.wipe()
        _io.bg("")
        _reset_state()
        _sync()
    def done(): pass

    ns = dict(
        forward=forward, fd=forward, backward=backward, back=backward, bk=backward,
        left=left, lt=left, right=right, rt=right,
        goto=goto, setpos=goto, setposition=goto, setx=setx, sety=sety,
        setheading=setheading, seth=setheading, home=home, circle=circle,
        penup=penup, pu=penup, up=penup, pendown=pendown, pd=pendown, down=pendown,
        isdown=isdown, pensize=pensize, width=pensize,
        pencolor=pencolor, fillcolor=fillcolor, color=color,
        begin_fill=begin_fill, end_fill=end_fill, dot=dot, write=write,
        speed=speed, hideturtle=hideturtle, ht=hideturtle,
        showturtle=showturtle, st=showturtle, bgcolor=bgcolor,
        position=position, pos=position, xcor=xcor, ycor=ycor, heading=heading,
        clear=clear, reset=reset, done=done, mainloop=done, exitonclick=done
    )

    class Turtle:
        """All Turtle() objects steer the one shared classroom turtle."""
        def __init__(self, *a, **k):
            pass
        def __getattr__(self, name):
            if name in ns:
                return ns[name]
            raise AttributeError("turtle has no " + name)

    class _ScreenObj:
        def bgcolor(self, c): bgcolor(c)
        def title(self, *a): pass
        def setup(self, *a, **k): pass
        def clear(self): clear()
        def reset(self): reset()
        def exitonclick(self): pass
        def mainloop(self): pass

    def Screen():
        return _ScreenObj()

    mod = types.ModuleType("turtle")
    mod.__dict__.update(ns)
    mod.Turtle = Turtle
    mod.Pen = Turtle
    mod.Screen = Screen
    mod._reset_all = reset
    sys.modules["turtle"] = mod

_pyrun_install_turtle()
del _pyrun_install_turtle
`;

  // ---- The game module -----------------------------------------------------
  // A tiny classroom game library, drawn on a canvas. Sprites are emoji (free
  // art), plus boxes and text. The whole thing rides the same JSPI trick as
  // time.sleep: game.frame() draws the scene then blocks one frame, so a plain
  // "while game.playing():" loop animates without freezing the tab, and Stop
  // interrupts it. Screen coordinates: (0,0) top-left, x right, y down.
  const PY_INSTALL_GAME = `
def _pyrun_install_game():
    import sys, json, types, math
    import _game_io as _io
    _jspi = bool(_io.jspiOk())
    if _jspi:
        from pyodide.ffi import run_sync

    W = {"w": 480, "h": 360, "bg": "#0b1020", "score": 0, "over": None,
         "debug": False, "clicks": 0, "tick": 0}
    _sprites = []
    # Ink: marks stamped onto a layer that is NOT wiped between frames, unlike
    # sprites. Each entry is a short list (an op letter plus its numbers) that
    # rides along in the scene the next frame() sends, so ten thousand dots cost
    # one message, and once stamped they cost nothing at all to keep.
    _ink = []

    def _norm_asset(v):
        # Asset ids are numbers (you see them as #2 and write game.sprite(2,...)),
        # so keep them as ints where possible. That way sprite.asset == 2 works
        # the way you'd expect instead of secretly being the string "2".
        if v is None or v == "":
            return None
        try:
            return int(v)
        except (ValueError, TypeError):
            return str(v)

    class Sprite:
        def __init__(self, kind, **kw):
            self.kind = kind
            self.x = kw.get("x", 0)
            self.y = kw.get("y", 0)
            self.size = kw.get("size", 40)
            self.w = kw.get("w", self.size)
            self.h = kw.get("h", self.size)
            self.art = kw.get("art", -1)
            self._asset = _norm_asset(kw.get("asset", None))   # a published Asset id, or None
            self._display = kw.get("display", "")
            self._content = kw.get("content", self._display)
            self._resolvable = kw.get("resolvable", False)
            self.color = kw.get("color", "#ffffff")
            # Corner rounding for a box, in pixels. Settable later, like colour:
            #   button.radius = 10
            self.radius = kw.get("radius", 0)
            self.background = kw.get("background", None)
            self.angle = kw.get("angle", 0)
            self.scale_x = kw.get("scale_x", 1)
            self.scale_y = kw.get("scale_y", 1)
            # Higher layer draws on top. Sprites on the same layer keep the
            # order they were made in. Labels default high so a scoreboard
            # sits above the action.
            # Which point of the sprite sits on (x, y), as fractions of its art:
            # (0.5, 0.5) is the middle, (0, 0) the top-left corner. Handy for a
            # cursor whose tip should be the pointer, or a plant that should
            # stand on its feet.
            self.anchor = kw.get("anchor", (0.5, 0.5))
            self.layer = kw.get("layer", 0)
            # A custom collision box (width, height), or None to auto-size it
            # from the art. Set it with sprite.hitbox = (w, h).
            self._hitbox = kw.get("hitbox", None)
            self.visible = True
            self._anim = None
            self._anim_every = 6
            _sprites.append(self)

        @property
        def hitbox(self):
            return self._hitbox

        @hitbox.setter
        def hitbox(self, value):
            # (width, height) to fix the collision box, or None to auto-size.
            if value is None:
                self._hitbox = None
            else:
                w, h = value
                self._hitbox = (float(w), float(h))

        @property
        def content(self):
            return self._content

        @content.setter
        def content(self, value):
            # Setting a sprite's content can switch its skin: an art number, a
            # name like "coin", or an emoji. A label just shows the new text.
            self._content = value
            if self._resolvable:
                self.kind, self.art, self._display = _resolve_skin(value)
                self._asset = None   # a built-in skin replaces any asset
                # Pick up (or drop) any built-in animation for the new skin.
                if self.art in _ANIM_ART:
                    self.animate(_ANIM_ART[self.art])
                else:
                    self._anim = None
            else:
                self._display = str(value)

        # .text is the old name for .content, kept so older code still runs.
        @property
        def text(self):
            return self._content

        @text.setter
        def text(self, value):
            self.content = value

        # .asset switches this sprite to a published Asset by id, the same one
        # you would pass to game.sprite(id, asset=True). Set it to None (or set
        # .content to a built-in skin) to switch back.
        @property
        def asset(self):
            return self._asset

        @asset.setter
        def asset(self, value):
            if value is None or value == "":
                self._asset = None
                if self.kind == "asset":
                    self.kind = "emoji"
                    self._display = ""
            else:
                self._asset = _norm_asset(value)
                self.kind = "asset"
                self._anim = None

        # .z is a friendly alias for .layer: higher numbers draw in front,
        # lower numbers sit behind. Sprites sharing a value keep creation order.
        @property
        def z(self):
            return self.layer

        @z.setter
        def z(self, value):
            self.layer = value

        def _draw_wh(self):
            # How big the art is actually drawn, before scale_x/scale_y.
            if self.kind == "box" or self.kind == "circle":
                return self.w, self.h
            if self.kind == "asset":
                # An asset keeps its own proportions: the long side is size.
                r = float(_io.assetRatio(self._asset)) or 1.0
                return (self.size, self.size / r) if r >= 1 else (self.size * r, self.size)
            return self.size, self.size

        def _hit_wh(self):
            # The unrotated width and height of the collision box, before angle.
            if self._hitbox is not None:
                w, h = self._hitbox
            elif self.kind == "box" or self.kind == "circle":
                # The box around it. touches() stays rectangular, which is close
                # enough for a hole you drop a mole into.
                w, h = self.w, self.h
            elif self.kind == "art":
                wf, hf = _HIT_ASPECT.get(self.art, (0.8, 0.8))
                w, h = self.size * wf, self.size * hf
            elif self.kind == "asset":
                # Hug the artwork, not the canvas around it. A rocket drawn tall
                # and thin gets a tall thin box, so game.debug(True) outlines
                # what you can actually see.
                ink = _asset_ink(self._asset)
                if ink:
                    dw, dh = self._draw_wh()
                    w, h = dw * ink[2], dh * ink[3]
                else:
                    w, h = self.size * 0.8, self.size * 0.8   # until the art loads
            else:
                # emoji/text: a slightly-smaller-than-size box feels fair.
                w, h = self.size * 0.8, self.size * 0.8
            return w * abs(self.scale_x), h * abs(self.scale_y)

        def _local_offset(self):
            # Where the middle of the art sits relative to the anchor, in the
            # sprite's own unrotated, unscaled units. anchor (0.5, 0.5) is the
            # middle, so this is (0, 0) and nothing moves.
            ax, ay = self.anchor
            dw, dh = self._draw_wh()
            return ((0.5 - ax) * dw, (0.5 - ay) * dh)

        def _hit_centre(self):
            # Where the collision box actually sits. (x, y) is the anchor, so the
            # box is offset from it and then SPINS AROUND IT, the same way the art
            # does. A hitbox you set yourself is taken at face value.
            lx, ly = self._local_offset()
            if self._hitbox is None and self.kind == "asset":
                # The artwork is rarely dead centre on its canvas; the box follows
                # it, or it ends up sitting beside the sprite.
                ink = _asset_ink(self._asset)
                if ink:
                    dw, dh = self._draw_wh()
                    lx += (ink[0] + ink[2] / 2.0 - 0.5) * dw
                    ly += (ink[1] + ink[3] / 2.0 - 0.5) * dh
            lx *= self.scale_x          # signed: a mirrored sprite mirrors its offset
            ly *= self.scale_y
            a = self.angle * math.pi / 180.0
            ca, sa = math.cos(a), math.sin(a)
            return (self.x + lx * ca - ly * sa, self.y + lx * sa + ly * ca)

        def _obb(self):
            # Oriented box for collisions: centre, half-sizes, angle (radians).
            w, h = self._hit_wh()
            cx, cy = self._hit_centre()
            return (cx, cy, w / 2.0, h / 2.0, self.angle * math.pi / 180.0)

        def touches(self, other):
            # True if the two boxes overlap, taking each sprite's rotation and
            # scale into account (see _obb_overlap below).
            return _obb_overlap(self._obb(), other._obb())

        def at_mouse(self):
            # True while the mouse pointer is inside this sprite's collision
            # box. Click a plant to grow it:
            #   if plant.at_mouse() and game.clicked(): plant.size += 10
            mx, my = float(_io.mouseX()), float(_io.mouseY())
            cx, cy, hw, hh, a = self._obb()
            dx, dy = mx - cx, my - cy
            lx = dx * math.cos(a) + dy * math.sin(a)
            ly = -dx * math.sin(a) + dy * math.cos(a)
            return abs(lx) <= hw and abs(ly) <= hh
        def hide(self):
            self.visible = False
        def show(self):
            self.visible = True
        def remove(self):
            # Take the sprite off the screen for good (unlike hide, it is gone).
            self.visible = False
            if self in _sprites:
                _sprites.remove(self)

        def animate(self, frames, every=6):
            # Flip through a list of skins on a timer, like a little flip-book:
            #   coin.animate(["🌑", "🌓", "🌕", "🌗"])   # spins through phases
            # Each frame shows for "every" calls to game.frame() (default 6).
            # Pass None to stop. (Pac-Man chomps this way on its own.)
            if not frames:
                self._anim = None
                return self
            self._anim = [_resolve_skin(f) for f in frames]
            self._anim_every = max(1, int(every))
            return self

    def window(width=480, height=360, background=None):
        if not _jspi:
            raise RuntimeError(
                "Games need Chrome or Edge in this sandbox. Open this page there to play."
            )
        W["w"] = int(width); W["h"] = int(height); W["score"] = 0; W["over"] = None
        W["clicks"] = 0
        if background is not None:
            W["bg"] = str(background)
        _io.setup(W["w"], W["h"], W["bg"])

    def background(color):
        W["bg"] = str(color)

    # Built-in drawn skins. You can pass the number, the name ("chicken"), or
    # any emoji of your own.
    _ART_NAMES = ["chicken", "dog", "bird", "egg", "coin", "basket",
                  "shocked", "calm", "turtle", "car", "mouse",
                  "rocket", "asteroid", "laser",
                  "snake", "pacman", "ghost", "pacman2", "kid"]

    # Sprites that flip through frames on their own (art index -> frame skins).
    _ANIM_ART = {}
    if "pacman" in _ART_NAMES and "pacman2" in _ART_NAMES:
        _ANIM_ART[_ART_NAMES.index("pacman")] = ["pacman", "pacman2"]

    # Default collision-box shape per art (width, height as a fraction of size),
    # so a wide car gets a wide box and a tall egg a tall one. Anything not
    # listed falls back to a near-square box. Override any sprite with .hitbox.
    # Each asset's artwork box inside its canvas, asked for once and remembered.
    _INK = {}
    def _asset_ink(aid):
        if aid is None or aid == "":
            return None
        if aid in _INK:
            return _INK[aid]
        try:
            raw = str(_io.assetInk(aid) or "")
        except Exception:
            return None
        if not raw:
            return None            # art not loaded yet; ask again next frame
        try:
            p = [float(v) for v in raw.split(",")]
        except ValueError:
            return None
        if len(p) != 4 or p[2] <= 0 or p[3] <= 0:
            return None
        _INK[aid] = tuple(p)
        return _INK[aid]

    _HIT_ASPECT = {
        3: (0.60, 0.80),   # egg: taller than wide
        8: (0.84, 0.68),   # turtle: a bit wide
        9: (0.84, 0.50),   # car: wide and low
        14: (0.72, 0.90),  # snake: taller than wide
        18: (0.50, 0.86),  # kid: tall and narrow
    }

    def _obb_overlap(a, b):
        # Separating Axis Theorem for two oriented boxes. Each box is
        # (cx, cy, half_w, half_h, angle). They overlap unless some axis (one
        # of the four box edges' normals) has a gap between the two shadows.
        ax, ay, ahw, ahh, aa = a
        bx, by, bhw, bhh, ba = b
        aux, auy = math.cos(aa), math.sin(aa)      # box A local x-axis
        avx, avy = -math.sin(aa), math.cos(aa)     # box A local y-axis
        bux, buy = math.cos(ba), math.sin(ba)      # box B local x-axis
        bvx, bvy = -math.sin(ba), math.cos(ba)     # box B local y-axis
        dx, dy = bx - ax, by - ay
        for lx, ly in ((aux, auy), (avx, avy), (bux, buy), (bvx, bvy)):
            ra = ahw * abs(aux * lx + auy * ly) + ahh * abs(avx * lx + avy * ly)
            rb = bhw * abs(bux * lx + buy * ly) + bhh * abs(bvx * lx + bvy * ly)
            if abs(dx * lx + dy * ly) > ra + rb:
                return False
        return True

    def _resolve_skin(skin):
        # Work out (kind, art_index, display_text) for a skin value.
        idx = -1
        if isinstance(skin, bool):
            idx = -1
        elif isinstance(skin, int):
            idx = skin
        elif isinstance(skin, str) and skin in _ART_NAMES:
            idx = _ART_NAMES.index(skin)
        if idx >= 0:
            return ("art", idx, "")
        return ("emoji", -1, str(skin))

    def sprite(skin, x=None, y=None, size=40, asset=False):
        cx = W["w"] // 2 if x is None else x
        cy = W["h"] // 2 if y is None else y
        if asset:
            # A sprite you designed in the Asset studio, used by its id number.
            return Sprite("asset", asset=skin, size=size, x=cx, y=cy,
                          content=skin, resolvable=True)
        kind, art, display = _resolve_skin(skin)
        sp = Sprite(kind, art=art, display=display, content=skin,
                    resolvable=True, size=size, x=cx, y=cy)
        if art in _ANIM_ART:
            sp.animate(_ANIM_ART[art])
        return sp

    def box(x, y, w, h, color="#ffffff", radius=0):
        # radius rounds the corners, the same way a label's background pill is
        # rounded. 0 is a sharp rectangle; anything past half the short side is
        # clamped, so a big number gives a stadium shape rather than a mess:
        #   btn = game.box(730, 30, 160, 44, "#8a4a12", radius=12)
        return Sprite("box", x=x, y=y, w=w, h=h, color=color, radius=radius)

    def circle(x, y, w, h=None, color="#ffffff"):
        # A round one, measured like game.box: w across and h down. Leave h out
        # for a true circle. A squashed one reads as a hole in the ground:
        #   game.circle(240, 180, 70, 22, "#3d2a1a")
        return Sprite("circle", x=x, y=y, w=w, h=(w if h is None else h),
                      color=color)

    def label(message, x, y, size=20, color="#ffffff", background=None):
        # color is the text colour; background (optional) draws a filled box
        # behind the text so it stays readable on any scene, e.g.
        #   game.label("Score: 0", 80, 24, color="#ffffff", background="#000000")
        return Sprite("text", display=str(message), content=message,
                      x=x, y=y, size=size, color=color, background=background,
                      layer=1000)

    # ---- Ink: drawing that stays put ----------------------------------------
    # A sprite is a thing you keep moving, so every frame redraws it from
    # scratch. Ink is the opposite: a mark you stamp once and leave alone. That
    # makes it the right tool for a trail, a fractal, a painting, anything where
    # the picture builds up. A million dots of ink cost the same as one, because
    # by the next frame they are just pixels.
    def plot(x, y, color="#ffffff", size=2):
        # Stamp one dot and leave it there for good:
        #   game.plot(x, y, "#22d3a5")
        _ink.append(["p", float(x), float(y), float(size), str(color)])

    def line(x1, y1, x2, y2, color="#ffffff", width=2):
        # A stamped stroke. Use it instead of plot() when the thing you are
        # tracking moves fast, or the trail comes out as dashes:
        #   game.line(old_x, old_y, ship.x, ship.y, "#4ea8ff")
        _ink.append(["l", float(x1), float(y1), float(x2), float(y2),
                     float(width), str(color)])

    def fade(amount=0.05):
        # Rub out a fraction of the ink, so trails die away instead of piling up
        # forever. Call it once a frame: 0.02 is a long comet tail, 0.2 a short
        # one. The window background shows through as it goes.
        _ink.append(["f", max(0.0, min(1.0, float(amount)))])

    def wipe():
        # Erase all the ink at once, leaving the sprites alone.
        _ink.append(["w"])

    def _which_surface(surface, caller):
        which = "screen" if surface is None else str(surface).lower()
        if which not in ("screen", "ink"):
            raise ValueError(
                'game.' + caller + '() takes surface="ink" or nothing at all, '
                "not " + repr(surface))
        return which

    def save_image(surface=None, filename=None, ask=False):
        # Save the picture as a PNG on the player's computer. It hands the file
        # to the browser and returns straight away, so it is safe to call from
        # inside the game loop:
        #   if game.pressed("s"): game.save_image()
        # surface picks what goes in the file:
        #   None (the default) is what you can see, sprites and all
        #   "ink" is JUST the stamped layer, with no sprites over the top, so a
        #   drawing saves clean without having to hide the scoreboard first
        # ask=True opens a proper "where shall I put it?" dialog instead of
        # dropping it in Downloads. Chrome and Edge only, and only while the
        # keypress that asked for it is still fresh, so treat it as a bonus.
        which = _which_surface(surface, "save_image")
        if filename is None:
            import time as _t
            filename = "pyweblib_" + _t.strftime("%Y%m%d_%H%M%S") + ".png"
        name = str(filename)
        if not name.lower().endswith(".png"):
            name += ".png"
        fn = getattr(_io, "saveImage", None)
        if fn is None:
            raise RuntimeError(
                "This browser cannot save images from a game. Try Chrome or Edge.")
        # Any ink stamped this tick is still sitting in the batch, so push the
        # picture out before asking for a copy of it, or the newest marks would
        # be missing from the file.
        _draw()
        fn(which, name, bool(ask))

    def copy_image(surface=None):
        # Put the picture on the clipboard instead of saving it, ready to paste
        # straight into a chat or a post:
        #   if game.pressed("c"): game.copy_image("ink")
        which = _which_surface(surface, "copy_image")
        fn = getattr(_io, "copyImage", None)
        if fn is None:
            raise RuntimeError(
                "This browser cannot copy images from a game. Try Chrome or Edge.")
        _draw()
        fn(which)

    def pressed(key):
        return bool(_io.pressed(str(key).lower()))

    def mouse_x():
        # Where the mouse pointer is, in game coordinates.
        return float(_io.mouseX())

    def mouse_y():
        return float(_io.mouseY())

    def mouse_in():
        # True while the pointer is over the game window.
        return bool(_io.mouseIn())

    def mouse_down():
        # True while the mouse button is held, like pressed() but for clicks.
        return bool(_io.mouseDown())

    def clicked():
        # True once per fresh click on the game window, then False until the
        # next click. Use it for buttons and menus so one tap fires one action.
        cur = int(_io.mouseClicks())
        if cur != W["clicks"]:
            W["clicks"] = cur
            return True
        return False

    def score(points=None):
        # A plain running-total counter. score(1) adds one and returns the new
        # total; score() just reads it. It draws NOTHING on its own: to show the
        # score, make a label and update its text, e.g.
        #   board = game.label("Score: 0", 60, 22)
        #   board.text = "Score: " + str(game.score())
        if points is not None:
            W["score"] += int(points)
        return W["score"]

    def playing():
        return bool(_io.playing())

    def submit_score(points):
        # Save this run's score to the game's own leaderboard in the Game
        # Gallery. Only does something when someone is playing your PUBLISHED
        # game in the gallery; in the Sandbox it is quietly ignored. Call it
        # when the run ends, right before game_over:
        #   game.submit_score(score)
        #   game.game_over("Score: " + str(score))
        try:
            _io.submitScore(float(points))
        except (TypeError, ValueError):
            pass

    def save(key, value):
        # Remember a value between runs, in this browser, for this program: a
        # garden's coins, unlocked levels, a best time. value can be a number,
        # text, True/False, or lists/dicts of those. Save when something changes
        # (a plant grows, a level clears), not every single frame:
        #   game.save("coins", 120)
        #   game.save("plants", ["carrot", "rose"])
        try:
            blob = json.dumps(value)
        except (TypeError, ValueError):
            raise ValueError(
                "game.save() can store numbers, text, True/False and "
                "lists/dicts of those, not a " + type(value).__name__)
        _io.saveState(str(key), blob)

    def load(key, default=None):
        # Read back what game.save() stored under this key. The first time (before
        # anything was saved) you get default, so a new player starts fresh:
        #   coins  = game.load("coins", 0)
        #   plants = game.load("plants", [])
        raw = _io.loadState(str(key))
        if raw is None or raw == "":
            return default
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return default

    def clear_save(key=None):
        # Forget one saved value, or this whole program's save when you leave the
        # key out (wire it to a "New game" button):
        #   game.clear_save("coins")   # just the coins
        #   game.clear_save()          # wipe everything this program saved
        _io.clearState(None if key is None else str(key))

    def sound(name=0):
        # Play a short built-in arcade sound. Pick one by number:
        #   0 beep   1 buzz   2 coin   3 powerup   4 jump
        #   5 laser  6 hit    7 explosion   8 win   9 lose
        # The names work too, e.g. game.sound("coin"). Like the keys, the
        # browser only allows audio after a click on the game.
        _io.sound(name)

    _tone_ids = [0]

    class _Tone:
        # A sustained tone you can steer live. Created by game.tone() (below).
        def __init__(self, freq=440, wave="sine", volume=0.15):
            _tone_ids[0] += 1
            self._id = _tone_ids[0]
            self._on = True
            _io.toneStart(self._id, float(freq), str(wave), float(volume))
        def pitch(self, hz):
            if self._on:
                _io.tonePitch(self._id, float(hz))
            return self
        def volume(self, v):
            if self._on:
                _io.toneVolume(self._id, float(v))
            return self
        def stop(self):
            if self._on:
                self._on = False
                _io.toneStop(self._id)

    def tone(freq=440, wave="sine", volume=0.15):
        # Start a sustained tone and get a handle to steer it live: engines,
        # sirens, drones. Unlike game.sound() (a one-shot), it keeps playing until
        # you .stop() it (or the game ends). Change it every frame:
        #   eng = game.tone(60, "sawtooth", 0.12)   # idle hum
        #   eng.pitch(55 + speed * 12)               # ramps with acceleration
        #   eng.volume(0.1)
        #   eng.stop()
        # wave is "sine", "square", "sawtooth" or "triangle".
        return _Tone(freq, wave, volume)

    def hide_cursor(hidden=True):
        # Hide the real mouse pointer while it is over the game window, so a
        # sprite can play the pointer instead (a watering can, a crosshair).
        _io.setCursor(bool(hidden))

    def show_cursor():
        _io.setCursor(False)

    def debug(on=True):
        # Turn on red hit-box outlines to see exactly what touches() checks.
        # The box is axis-aligned and ignores rotation and scale, on purpose:
        # that is what collisions really use, so a spun sprite looks off.
        W["debug"] = bool(on)

    def fullscreen(on=True):
        # Fill the whole screen with the game window. Perfect for phones. On
        # iPhone this is a full-window overlay (Safari there has no true
        # fullscreen); on a computer or Android it also asks for real fullscreen.
        # Put it right after game.window():
        #   game.window(400, 640)
        #   game.fullscreen()
        fn = getattr(_io, "fullscreen", None)
        if fn is not None:
            fn(bool(on))

    def _draw(banner=None):
        arr = []
        # Draw low layers first so high layers land on top. sorted() is stable,
        # so sprites sharing a layer keep the order they were created in.
        for s in sorted(_sprites, key=lambda s: s.layer):
            if not s.visible:
                continue
            # hbw/hbh/hba are the collision box touches() actually uses (size
            # and rotation), so debug mode outlines exactly what overlaps.
            kind, art, disp = s.kind, s.art, s._display
            if s._anim:
                kind, art, disp = s._anim[(W["tick"] // s._anim_every) % len(s._anim)]
            hbw, hbh = s._hit_wh()
            hbcx, hbcy = s._hit_centre()
            ax, ay = s.anchor
            arr.append({"kind": kind, "x": s.x, "y": s.y, "size": s.size,
                        "w": s.w, "h": s.h, "text": str(disp), "color": s.color,
                        "art": art, "asset": s.asset, "angle": s.angle,
                        "sx": s.scale_x, "sy": s.scale_y, "back": s.background,
                        "ax": ax, "ay": ay, "rad": s.radius,
                        # where the collision box really sits, anchor and the
                        # artwork's offset on its canvas included
                        "hbx": hbcx, "hby": hbcy,
                        "hbw": hbw, "hbh": hbh, "hba": s.angle})
        # Once the game is over the banner is sticky: every later redraw (like
        # the frame() at the end of the loop) keeps showing it instead of
        # painting over it.
        shown = banner if banner is not None else W["over"]
        # The ink batch goes out with this frame and is then forgotten here: the
        # marks live on the JS side's layer from now on, not in this list.
        ink = _ink[:]
        del _ink[:]
        _io.draw(json.dumps({"w": W["w"], "h": W["h"], "bg": W["bg"],
                             "sprites": arr, "banner": shown, "ink": ink,
                             "debug": W["debug"]}))

    def frame(fps=30):
        W["tick"] += 1
        _draw()
        if _jspi:
            run_sync(_io.nextFrame(1.0 / max(1, int(fps))))

    def game_over(message="Game Over", retry=False):
        # retry=True lets a tap or click restart the game, instead of the player
        # having to press Run again. Great on a phone.
        W["over"] = str(message)
        _draw()
        if retry:
            # Settle briefly so the tap that ended the game doesn't instantly
            # retry it, then wait on the banner for a fresh tap and ask the host
            # to re-run the whole program from the top.
            for _ in range(12):
                frame(30)
            base = int(_io.mouseClicks())
            rst = getattr(_io, "restart", None)
            while _io.playing():
                if int(_io.mouseClicks()) != base:
                    if rst:
                        rst()
                    break
                frame(30)
        _io.stop()

    def preload(*ids):
        # Fetch custom asset art up front so a sprite you later set with
        # sprite.asset = id (or game.sprite(id, asset=True)) is ready instead of
        # popping in on first draw. Call it once near the top, before the loop:
        #   game.preload(7, 8, 9)   or   game.preload(my_ids)
        flat = []
        for i in ids:
            if isinstance(i, (list, tuple)):
                flat.extend(i)
            else:
                flat.append(i)
        want = [x for x in (_norm_asset(v) for v in flat) if x is not None]
        try:
            _io.preloadAssets(json.dumps(want))
        except Exception:
            pass

    def _reset_all():
        _sprites.clear()
        del _ink[:]
        W.update(w=480, h=360, bg="#0b1020", score=0, over=None, debug=False,
                 clicks=0, tick=0)
        _io.reset()

    mod = types.ModuleType("game")
    mod.window = window
    mod.background = background
    mod.sprite = sprite
    mod.box = box
    mod.circle = circle
    mod.label = label
    mod.plot = plot
    mod.line = line
    mod.fade = fade
    mod.wipe = wipe
    mod.save_image = save_image
    mod.copy_image = copy_image
    mod.pressed = pressed
    mod.hide_cursor = hide_cursor
    mod.show_cursor = show_cursor
    mod.mouse_x = mouse_x
    mod.mouse_y = mouse_y
    mod.mouse_in = mouse_in
    mod.mouse_down = mouse_down
    mod.clicked = clicked
    mod.score = score
    mod.playing = playing
    mod.frame = frame
    mod.game_over = game_over
    mod.submit_score = submit_score
    mod.save = save
    mod.load = load
    mod.clear_save = clear_save
    mod.sound = sound
    mod.tone = tone
    mod.debug = debug
    mod.fullscreen = fullscreen
    mod.preload = preload
    mod.Sprite = Sprite
    mod._reset_all = _reset_all
    sys.modules["game"] = mod

_pyrun_install_game()
del _pyrun_install_game
`;

  // ---- SPIKE: `import game3d`, a tiny 3D scene API ---------------------------
  // Deliberately the same shape as the game module: you make objects, mutate
  // their attributes, and call frame(). Python owns the objects and posts the
  // whole scene as JSON each frame; the JS side (GAME3D_IO) diffs that against a
  // pool of three.js meshes. Coordinates are the usual 3D ones: x right, y up,
  // z toward the camera, in "metres" rather than pixels.
  const PY_INSTALL_GAME3D = `
def _pyrun_install_game3d():
    import sys, json, types, math
    import _game3d_io as _io
    _jspi = bool(_io.jspiOk())
    if _jspi:
        from pyodide.ffi import run_sync

    S = {"bg": "#8ec5f0", "tick": 0, "next_id": 0}
    _objs = []
    _cam = {"x": 0.0, "y": 6.0, "z": 14.0, "tx": 0.0, "ty": 0.0, "tz": 0.0,
            "fov": 60.0, "follow": None, "dist": 12.0, "height": 6.0}

    class Thing:
        def __init__(self, kind, **kw):
            S["next_id"] += 1
            self.id = S["next_id"]
            self.kind = kind
            self.x = float(kw.get("x", 0.0))
            self.y = float(kw.get("y", 0.0))
            self.z = float(kw.get("z", 0.0))
            size = float(kw.get("size", 1.0))
            self.w = float(kw.get("width", size))
            self.h = float(kw.get("height", size))
            self.d = float(kw.get("depth", size))
            self.rx = 0.0
            self.ry = 0.0
            self.rz = 0.0
            self.color = kw.get("color", "#cdd6e4")
            self.visible = True
            _objs.append(self)

        def move(self, dx=0, dy=0, dz=0):
            self.x += dx
            self.y += dy
            self.z += dz

        def spin(self, rx=0, ry=0, rz=0):
            self.rx += rx
            self.ry += ry
            self.rz += rz

        def distance_to(self, other):
            return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2 +
                             (self.z - other.z) ** 2)

        def touches(self, other):
            # Overlap of the two boxes around each object, so it works for any shape.
            return (abs(self.x - other.x) * 2 < (self.w + other.w) and
                    abs(self.y - other.y) * 2 < (self.h + other.h) and
                    abs(self.z - other.z) * 2 < (self.d + other.d))

        def remove(self):
            if self in _objs:
                _objs.remove(self)

    def box(x=0, y=0, z=0, size=1, color="#e2483d", **kw):
        return Thing("box", x=x, y=y, z=z, size=size, color=color, **kw)

    def sphere(x=0, y=0, z=0, size=1, color="#f6c945", **kw):
        return Thing("sphere", x=x, y=y, z=z, size=size, color=color, **kw)

    def cylinder(x=0, y=0, z=0, size=1, color="#48bb78", **kw):
        return Thing("cylinder", x=x, y=y, z=z, size=size, color=color, **kw)

    def ground(size=60, y=0, color="#3f8f4f"):
        # A big flat floor to stand things on.
        return Thing("plane", x=0, y=y, z=0, width=size, height=1, depth=size,
                     color=color)

    def background(color):
        S["bg"] = str(color)

    def camera(x=None, y=None, z=None, look_at=None, follow=None,
               distance=None, height=None, fov=None):
        if x is not None: _cam["x"] = float(x)
        if y is not None: _cam["y"] = float(y)
        if z is not None: _cam["z"] = float(z)
        if look_at is not None:
            _cam["tx"], _cam["ty"], _cam["tz"] = [float(v) for v in look_at]
        if follow is not None: _cam["follow"] = follow
        if distance is not None: _cam["dist"] = float(distance)
        if height is not None: _cam["height"] = float(height)
        if fov is not None: _cam["fov"] = float(fov)

    def pressed(key):
        return bool(_io.pressed(str(key)))

    def _draw():
        arr = []
        for o in _objs:
            arr.append({"i": o.id, "k": o.kind, "x": o.x, "y": o.y, "z": o.z,
                        "w": o.w, "h": o.h, "d": o.d,
                        "rx": o.rx, "ry": o.ry, "rz": o.rz,
                        "c": str(o.color), "vis": bool(o.visible)})
        cam = {k: _cam[k] for k in ("x", "y", "z", "tx", "ty", "tz", "fov")}
        target = _cam["follow"]
        if target is not None:
            # Sit behind and above whatever we are following, looking at it.
            cam["x"] = target.x
            cam["y"] = target.y + _cam["height"]
            cam["z"] = target.z + _cam["dist"]
            cam["tx"], cam["ty"], cam["tz"] = target.x, target.y, target.z
        _io.draw(json.dumps({"bg": S["bg"], "cam": cam, "objs": arr}))

    def frame(fps=60):
        S["tick"] += 1
        _draw()
        if _jspi:
            run_sync(_io.nextFrame(1.0 / max(1, int(fps))))

    def tick():
        return S["tick"]

    def _reset_all():
        _objs.clear()
        S.update(bg="#8ec5f0", tick=0, next_id=0)
        _cam.update(x=0.0, y=6.0, z=14.0, tx=0.0, ty=0.0, tz=0.0, fov=60.0,
                    follow=None, dist=12.0, height=6.0)
        _io.reset()

    mod = types.ModuleType("game3d")
    mod.box = box
    mod.sphere = sphere
    mod.cylinder = cylinder
    mod.ground = ground
    mod.background = background
    mod.camera = camera
    mod.pressed = pressed
    mod.frame = frame
    mod.tick = tick
    mod.Thing = Thing
    mod._reset_all = _reset_all
    sys.modules["game3d"] = mod

_pyrun_install_game3d()
del _pyrun_install_game3d
`;

  // ---- JS side of the game: canvas drawing + keyboard, dispatched to active -
  let gameKeys = {};
  let gamePlaying = true;
  let gameRestart = false;   // set by game_over(retry=True) on a tap: re-run

  function gameCtx() {
    if (!active || !active.opts.game) return null;
    return active.gameCtx;
  }
  function gameActive() { return running && active && active.opts.game; }

  function gameKeyName(e) {
    const k = e.key;
    if (k === "ArrowLeft") return "left";
    if (k === "ArrowRight") return "right";
    if (k === "ArrowUp") return "up";
    if (k === "ArrowDown") return "down";
    if (k === " " || k === "Spacebar") return "space";
    return String(k).toLowerCase();
  }
  const GAME_KEYS_TO_EAT = { left: 1, right: 1, up: 1, down: 1, space: 1 };
  window.addEventListener("keydown", function (e) {
    if (!gameActive() && !game3dActive()) return;   // 3D programs read the same keys
    const n = gameKeyName(e);
    gameKeys[n] = true;
    if (workerMem) Atomics.store(workerMem.ctrl, window.PRProto.keyIndex(n), 1);
    if (GAME_KEYS_TO_EAT[n]) e.preventDefault();
  });
  window.addEventListener("keyup", function (e) {
    if (!gameActive() && !game3dActive()) return;
    const n = gameKeyName(e);
    gameKeys[n] = false;
    if (workerMem) Atomics.store(workerMem.ctrl, window.PRProto.keyIndex(n), 0);
  });

  // Mouse (and touch, via pointer events) over the game canvas. Positions are
  // converted from screen pixels to game coordinates, so a CSS-scaled canvas
  // still reports the numbers the game logic uses. clicks only ever counts up;
  // the Python side notices it changing to fire game.clicked() once per press.
  let gameMouse = { x: 0, y: 0, inside: false, down: false, clicks: 0 };
  function gameMouseTrack(e) {
    if (!gameActive()) return;
    const c = gameCtx();
    if (!c) return;
    const cv = c.canvas;
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Screen pixels to LOGICAL game units (not buffer pixels: the buffer is sized
    // to the display, so only the logical size means anything to the game).
    gameMouse.x = (e.clientX - r.left) * (gameLogicalW / r.width);
    gameMouse.y = (e.clientY - r.top) * (gameLogicalH / r.height);
    gameMouse.inside = e.clientX >= r.left && e.clientX < r.right &&
                       e.clientY >= r.top && e.clientY < r.bottom;
    if (workerMem) {
      const K = window.PRProto.CTRL, c = workerMem.ctrl;
      Atomics.store(c, K.MX, Math.round(gameMouse.x));
      Atomics.store(c, K.MY, Math.round(gameMouse.y));
      Atomics.store(c, K.MIN, gameMouse.inside ? 1 : 0);
    }
  }
  window.addEventListener("pointermove", gameMouseTrack);
  window.addEventListener("pointerdown", function (e) {
    gameMouseTrack(e);
    if (!gameActive() || !gameMouse.inside) return;
    gameMouse.down = true;
    gameMouse.clicks += 1;
    if (workerMem) {
      const K = window.PRProto.CTRL, c = workerMem.ctrl;
      Atomics.store(c, K.MDOWN, 1);
      Atomics.add(c, K.MCLICKS, 1);
    }
  });
  window.addEventListener("pointerup", function () {
    gameMouse.down = false;
    if (workerMem) Atomics.store(workerMem.ctrl, window.PRProto.CTRL.MDOWN, 0);
  });

  // ---- Fullscreen games. A full-viewport CSS overlay is the workhorse (the ONLY
  // way on iPhone, whose Safari has no Fullscreen API), and it needs no user
  // gesture, so game.fullscreen() can trigger it straight from Python. Where the
  // real API exists (desktop/Android/iPad) we also request it as a bonus. Input
  // already maps through getBoundingClientRect, so a CSS-scaled canvas is fine.
  function pwlGameCanvasEl() {
    const c = gameCtx();
    if (c) return c.canvas;
    return document.getElementById("game-canvas");
  }
  // ---- Crisp rendering ------------------------------------------------------
  // The game's own resolution (game.window's width/height) is a COORDINATE
  // SPACE, not a pixel count. The canvas's pixel buffer is sized to the real
  // device pixels it occupies on screen, and the 2D context is scaled so Python
  // still draws in logical units. Nothing is ever a small buffer stretched by
  // CSS, so a fullscreen game is as sharp as the display allows: sprite art is
  // SVG and the browser re-rasterizes it at whatever size we draw it, and text
  // and shapes are resolution-independent too.
  let gameLogicalW = 480, gameLogicalH = 360;   // matches the Python module's default W
  const MAX_DPR = 3;                // past this the gain is invisible, the cost isn't
  const MAX_BUFFER_PX = 5e6;        // ~5 MP ceiling so a 4K fullscreen still holds 60fps
  let lastGameSceneJson = null;     // replayed after a resize (the buffer change clears it)
  let fitRetries = 0;               // bounds the "panel not laid out yet" retry loop

  // Map logical units onto the buffer. Re-applied every frame because assigning
  // canvas.width/height resets the context state, transform included.
  function applyGameTransform(ctx) {
    const c = ctx || gameCtx();
    if (!c || !c.canvas || !(gameLogicalW > 0) || !(gameLogicalH > 0)) return;
    c.setTransform(c.canvas.width / gameLogicalW, 0, 0, c.canvas.height / gameLogicalH, 0, 0);
  }
  function fitGameCanvas() {
    const cv = pwlGameCanvasEl();
    if (!cv) return;
    const lw = gameLogicalW, lh = gameLogicalH;
    if (!(lw > 0) || !(lh > 0)) return;

    // 1. The CSS box. Ask for a size, then MEASURE what the layout actually gave
    //    (`max-width:100%` may have shrunk it) and lock the height to that, so the
    //    buffer below always matches what is really on screen.
    let cssW, cssH;
    if (document.body.classList.contains("pwl-game-fs")) {
      const stage = cv.parentElement;
      if (!stage) return;
      const availW = stage.clientWidth || window.innerWidth;
      const availH = stage.clientHeight || window.innerHeight;
      const fit = Math.min(availW / lw, availH / lh);
      if (!(fit > 0) || !isFinite(fit)) return;
      cssW = Math.round(lw * fit);
      cssH = Math.round(lh * fit);
    } else {
      // Natural size, letting the stylesheet shrink it on a narrow screen.
      cv.style.width = lw + "px";
      cv.style.height = "auto";
      const r = cv.getBoundingClientRect();
      cssW = Math.round(r.width);
      // Panel still hidden (or mid-layout): measuring now would build a 1x1
      // buffer, so leave the canvas alone and retry once the layout settles.
      // Bounded, or a permanently hidden panel would spin every frame.
      if (!(cssW >= 40)) {
        if (fitRetries++ < 20) requestAnimationFrame(fitGameCanvas);
        return;
      }
      fitRetries = 0;
      cssH = Math.round(cssW * lh / lw);
    }
    if (!(cssW > 0) || !(cssH > 0)) return;
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";
    // Trust the screen over the arithmetic: if the stylesheet still clamped the
    // width (narrow panel, or a real-fullscreen exit that hasn't reflowed yet),
    // take the measured width so the buffer can't drift from the display.
    const shown = cv.getBoundingClientRect();
    if (shown.width >= 40 && Math.abs(Math.round(shown.width) - cssW) > 1) {
      cssW = Math.round(shown.width);
      cssH = Math.round(cssW * lh / lw);
      cv.style.width = cssW + "px";
      cv.style.height = cssH + "px";
    }

    // 2. One buffer pixel per device pixel.
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR);
    let bw = Math.max(1, Math.round(cssW * dpr));
    let bh = Math.max(1, Math.round(cssH * dpr));
    if (bw * bh > MAX_BUFFER_PX) {
      const k = Math.sqrt(MAX_BUFFER_PX / (bw * bh));
      bw = Math.max(1, Math.round(bw * k));
      bh = Math.max(1, Math.round(bh * k));
    }
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw; cv.height = bh;    // this clears the canvas
      applyGameTransform();
      // A running game repaints next frame, but a finished/paused one would be
      // left blank, so put the last frame back. Flagged as a replay: the ink in
      // that scene was stamped when it first arrived, and stamping it twice
      // would double up every fade() and wipe() it carried.
      if (lastGameSceneJson != null && GAME_IO && GAME_IO.draw) {
        try { GAME_IO.draw(lastGameSceneJson, true); } catch (e) {}
      }
      return;
    }
    applyGameTransform();
  }

  // ---- The ink layer -------------------------------------------------------
  // Sprites are wiped and redrawn every frame. Ink is not: it lives on its own
  // offscreen canvas that nothing clears, so a drawing can build up over
  // thousands of frames and cost nothing to keep. The buffer is sized ONCE per
  // run, exactly like the turtle's and for the same reason: assigning
  // canvas.width erases the canvas, so the ink must not follow the visible one
  // when a panel resizes or a phone rotates. Compositing scales it instead.
  let gameInk = null, gameInkCtx = null;
  const MAX_INK_PX = 4e6;
  const TAU = Math.PI * 2;

  function resetGameInk() {
    const lw = gameLogicalW, lh = gameLogicalH;
    if (!(lw > 0) || !(lh > 0) || typeof document === "undefined") return;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR);
    // Generous enough that any later layout change only ever scales it DOWN,
    // which stays sharp. The stage can never be wider than the viewport.
    let k = (Math.max(lw, window.innerWidth || lw) / lw) * dpr;
    const px = (lw * k) * (lh * k);
    if (px > MAX_INK_PX) k *= Math.sqrt(MAX_INK_PX / px);
    k = Math.max(1, k);
    const bw = Math.max(1, Math.round(lw * k));
    const bh = Math.max(1, Math.round(lh * k));
    if (!gameInk) gameInk = document.createElement("canvas");
    gameInk.width = bw; gameInk.height = bh;      // assigning size also clears it
    gameInkCtx = gameInk.getContext("2d");
    if (gameInkCtx) gameInkCtx.setTransform(bw / lw, 0, 0, bh / lh, 0, 0);
  }

  // Stamp one frame's batch of marks. Runs of dots sharing a colour go into a
  // single path, because a chaos game sends a few thousand of them per frame and
  // one fill() beats a few thousand.
  function applyInk(ops) {
    if (!ops || !ops.length) return;
    if (!gameInkCtx) resetGameInk();
    const c = gameInkCtx;
    if (!c) return;
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o[0] === "p") {
        const col = o[4];
        c.fillStyle = col;
        c.beginPath();
        let r = Math.max(0.25, o[3] / 2);
        c.moveTo(o[1] + r, o[2]);       // or the arcs get joined up by a line
        c.arc(o[1], o[2], r, 0, TAU);
        while (i + 1 < ops.length && ops[i + 1][0] === "p" && ops[i + 1][4] === col) {
          const p = ops[++i];
          r = Math.max(0.25, p[3] / 2);
          c.moveTo(p[1] + r, p[2]);
          c.arc(p[1], p[2], r, 0, TAU);
        }
        c.fill();
      } else if (o[0] === "l") {
        c.strokeStyle = o[6];
        c.lineWidth = Math.max(0.25, o[5]);
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(o[1], o[2]);
        c.lineTo(o[3], o[4]);
        c.stroke();
      } else if (o[0] === "f") {
        // Rub the layer out toward transparent rather than painting the
        // background over it: whatever colour the window is shows through as a
        // trail dies, and a saved "ink" PNG keeps its see-through background.
        c.save();
        c.globalCompositeOperation = "destination-out";
        c.globalAlpha = o[1];
        c.fillStyle = "#000";
        c.fillRect(0, 0, gameLogicalW, gameLogicalH);
        c.restore();
      } else if (o[0] === "w") {
        c.clearRect(0, 0, gameLogicalW, gameLogicalH);
      }
    }
  }

  // ---- Saving a game picture ----------------------------------------------
  // Both runtimes keep every canvas on the main thread (the worker only ever
  // posts drawing instructions over), so there is one code path here and no
  // blob has to cross a thread boundary. Nothing is handed a Python callback
  // either, so there are no proxies to leak however many times it is called.
  function gameSaveProblem(msg) {
    try { SANDBOX_IO.writeColored("\n[save_image] " + msg + "\n", "#ff8f4e"); } catch (e) {}
  }

  function anchorDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Hold the URL open long enough for the browser to have taken the bytes,
    // then hand the memory back.
    setTimeout(function () {
      try { a.remove(); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 5000);
  }

  function deliverPng(blob, name) {
    // iOS ignores the download attribute in a lot of contexts, and a student on
    // an iPad would just see nothing happen. The share sheet is what actually
    // saves a file there, so prefer it on those devices only.
    const touchMac = /Mac/.test(navigator.platform || "") && (navigator.maxTouchPoints || 0) > 1;
    const iosish = /iP(hone|ad|od)/.test(navigator.platform || "") || touchMac;
    if (iosish && typeof File === "function" && navigator.canShare) {
      try {
        const file = new File([blob], name, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).catch(function (err) {
            // A cancelled share sheet is a choice, not a failure.
            if (!err || err.name !== "AbortError") anchorDownload(blob, name);
          });
          return;
        }
      } catch (e) { /* fall through to the ordinary download */ }
    }
    anchorDownload(blob, name);
  }

  function encodePng(canvas, name, sink) {
    try {
      canvas.toBlob(function (blob) {
        if (!blob) { gameSaveProblem("the browser could not encode the picture."); return; }
        sink(blob, name);
      }, "image/png");
    } catch (e) {
      // Practically only reachable if something ever draws a cross-origin image
      // onto the canvas: everything this library loads is a data: URI, which
      // does not taint it. Say so plainly rather than failing silently.
      gameSaveProblem(
        "the browser blocked reading the picture (" + ((e && e.name) || "error") +
        "). That happens when artwork was loaded from another site.");
    }
  }

  function saveGamePicture(which, name, ask) {
    const src = String(which) === "ink" ? gameInk : (gameCtx() && gameCtx().canvas);
    if (!src || !src.width) {
      gameSaveProblem("there is no game window to save yet. Call game.window() first.");
      return;
    }
    // A real "where shall I put it?" dialog, like a desktop app's. Chromium
    // only, and it needs a click or keypress the browser still counts as live,
    // so it is an upgrade where it works and never a requirement.
    if (ask && typeof window.showSaveFilePicker === "function") {
      const act = navigator.userActivation;
      if (!act || act.isActive !== false) {
        window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "PNG image", accept: { "image/png": [".png"] } }]
        }).then(function (handle) {
          encodePng(src, name, function (blob) {
            handle.createWritable()
              .then(function (w) { return w.write(blob).then(function () { return w.close(); }); })
              .catch(function () { gameSaveProblem("could not write to that file."); });
          });
        }, function (err) {
          if (err && err.name === "AbortError") return;    // they hit cancel
          encodePng(src, name, deliverPng);                // no picker: just save it
        });
        return;
      }
    }
    encodePng(src, name, deliverPng);
  }

  function copyGamePicture(which) {
    const src = String(which) === "ink" ? gameInk : (gameCtx() && gameCtx().canvas);
    if (!src || !src.width) {
      gameSaveProblem("there is no game window to copy yet. Call game.window() first.");
      return;
    }
    if (!navigator.clipboard || typeof window.ClipboardItem !== "function") {
      gameSaveProblem("this browser cannot copy images to the clipboard.");
      return;
    }
    encodePng(src, "clipboard.png", function (blob) {
      navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })])
        .catch(function () {
          gameSaveProblem("the browser would not let the page use the clipboard.");
        });
    });
  }
  // The shared player's markup has no ✕ (the editor does), so add one to whatever
  // stage is going fullscreen. Without it there's no way out on a phone.
  function ensureFsExit(stage) {
    if (!stage) return;
    let btn = stage.querySelector(".game-fs-exit");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "game-fs-exit";
      btn.setAttribute("aria-label", "Exit fullscreen");
      btn.title = "Exit fullscreen (Esc)";
      btn.innerHTML = "✕";
      stage.appendChild(btn);
    }
    if (!btn.__pwlFsWired) {
      btn.__pwlFsWired = true;
      btn.addEventListener("click", function () { setGameFullscreen(null, false); });
    }
  }
  function setGameFullscreen(canvas, on) {
    // Flip the body flag first and unconditionally, so exiting always releases the
    // scroll lock even when the canvas can't be found (e.g. a run just ended).
    document.body.classList.toggle("pwl-game-fs", !!on);
    const cv = canvas || pwlGameCanvasEl();
    // The stage is the element the CSS turns into the overlay; it's present on both
    // the editor and the community player (unlike .game-panel, which is editor-only).
    const stage = cv && cv.closest ? cv.closest(".game-stage") : null;
    const host = (cv && cv.closest && (cv.closest(".game-panel") || cv.closest(".pwl-player"))) || stage;
    if (host) host.classList.toggle("is-fs", !!on);
    if (on) {
      ensureFsExit(stage);
      const el = stage || cv;
      if (el) {
        try {
          if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(function () {}); }
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } catch (e) {}
      }
    } else {
      try {
        if (document.exitFullscreen && document.fullscreenElement) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(function () {}); }
        else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
      } catch (e) {}
    }
    fitGameCanvas();
    requestAnimationFrame(fitGameCanvas);
    // Entering/leaving the real Fullscreen API is asynchronous, so the layout we
    // measured above can still be the old one. Refit once it has settled.
    setTimeout(fitGameCanvas, 120);
    setTimeout(fitGameCanvas, 400);
  }
  window.addEventListener("resize", fitGameCanvas);
  window.addEventListener("orientationchange", function () { setTimeout(fitGameCanvas, 120); });
  document.addEventListener("fullscreenchange", function () {
    // Real fullscreen exited (Esc / system gesture): drop the CSS overlay too.
    if (!document.fullscreenElement && document.body.classList.contains("pwl-game-fs")) {
      setGameFullscreen(null, false);
      return;
    }
    // Otherwise the viewport just changed under us, so resize the buffer to match.
    fitGameCanvas();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.body.classList.contains("pwl-game-fs")) setGameFullscreen(null, false);
  });
  window.PWL = window.PWL || {};
  window.PWL.setGameFullscreen = function (on) { setGameFullscreen(null, on !== false); };
  window.PWL.toggleGameFullscreen = function () {
    setGameFullscreen(null, !document.body.classList.contains("pwl-game-fs"));
  };

  // ---- Built-in themed sprite art ----
  // The flat SVG art lives in sprites.js (window.PWL_SPRITES), the single
  // source shared with the community preview renderer. Order matches
  // _ART_NAMES in the Python game module.
  const SPRITE_SVGS = (window.PWL_SPRITES || []);
  const SPRITE_ART = SPRITE_SVGS.map(function (svg) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    return img;
  });

  // ---- Shared asset SVG cache (localStorage, a few days). Fetched sprite art
  // is kept in the browser so repeat visits (and every viewer's later sessions)
  // draw from cache instead of hammering Supabase. Shared with preview.js via
  // the same keys, so warming it in a game also warms the gallery thumbnails.
  window.PWL = window.PWL || {};
  window.PWL.assetSvgCache = window.PWL.assetSvgCache || (function () {
    var TTL = 3 * 24 * 3600 * 1000, PREFIX = "pwl-asset:";
    function get(id) {
      try {
        var raw = localStorage.getItem(PREFIX + id);
        if (!raw) return null;
        var o = JSON.parse(raw);
        if (!o || typeof o.svg !== "string" || (Date.now() - (o.ts || 0)) > TTL) {
          localStorage.removeItem(PREFIX + id); return null;
        }
        return o.svg;
      } catch (e) { return null; }
    }
    function put(id, svg) {
      var rec = JSON.stringify({ svg: svg, ts: Date.now() });
      try { localStorage.setItem(PREFIX + id, rec); }
      catch (e) {   // out of space: drop cached sprites and keep just this one
        try {
          for (var i = localStorage.length - 1; i >= 0; i--) {
            var k = localStorage.key(i);
            if (k && k.indexOf(PREFIX) === 0) localStorage.removeItem(k);
          }
          localStorage.setItem(PREFIX + id, rec);
        } catch (e2) {}
      }
    }
    return { get: get, put: put };
  })();

  // ---- User-made assets (from the Asset studio): game.sprite(id, asset=True).
  // Each id's SVG is fetched from Supabase once and cached as an Image, then
  // drawn like a built-in. Worker-runtime games still draw here on the main
  // thread, so this one cache serves both runtimes. ----
  const ASSET_IMAGES = {};       // "id" -> Image, or null while it loads
  const ASSET_RATIO = {};        // "id" -> width/height of the SVG (defaults to 1)
  // The SVG's own width:height, so a wide sprite is drawn wide rather than
  // squashed into a square. Studio shapes use viewBox "0 0 64 64" (ratio 1);
  // an imported SVG keeps whatever shape it was drawn at.
  function svgRatio(svg) {
    var m = /viewBox\s*=\s*["']?\s*[-\d.eE]+[ ,]+[-\d.eE]+[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)/.exec(svg || "");
    if (m) { var w = parseFloat(m[1]), h = parseFloat(m[2]); if (w > 0 && h > 0) return w / h; }
    var mw = /\bwidth\s*=\s*["']?\s*([\d.]+)/.exec(svg || "");
    var mh = /\bheight\s*=\s*["']?\s*([\d.]+)/.exec(svg || "");
    if (mw && mh) { var ww = parseFloat(mw[1]), hh = parseFloat(mh[1]); if (ww > 0 && hh > 0) return ww / hh; }
    return 1;
  }
  // Where the artwork actually sits inside its canvas, as fractions of it, so a
  // long thin sprite gets a long thin collision box instead of the whole square.
  // Measured by rasterising once and scanning alpha, which counts strokes and
  // curves the way your eye does.
  const ASSET_INK = {};   // "id" -> "fx,fy,fw,fh"
  function measureInk(key, img) {
    try {
      const R = 96;   // plenty for a box, cheap to scan
      const cv = document.createElement("canvas");
      cv.width = R; cv.height = R;
      const c = cv.getContext("2d", { willReadFrequently: true });
      c.clearRect(0, 0, R, R);
      c.drawImage(img, 0, 0, R, R);
      const d = c.getImageData(0, 0, R, R).data;
      let x0 = R, y0 = R, x1 = -1, y1 = -1;
      for (let y = 0; y < R; y++) {
        for (let x = 0; x < R; x++) {
          if (d[(y * R + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0 || y1 < y0) return;                 // nothing drawn
      const ink = [x0 / R, y0 / R, (x1 - x0 + 1) / R, (y1 - y0 + 1) / R]
        .map(function (v) { return Math.round(v * 1000) / 1000; }).join(",");
      ASSET_INK[key] = ink;
      try {
        if (sharedWorker) sharedWorker.postMessage({ type: "assetInk", id: String(key), ink: ink });
      } catch (e) {}
    } catch (e) { /* tainted or undecodable: fall back to the square box */ }
  }

  function useAssetSvg(key, svg) {
    ASSET_RATIO[key] = svgRatio(svg);
    // Python needs the shape of the art to size its collision box, and in the
    // worker runtime Python lives on the other side, so push it across.
    try {
      if (sharedWorker) sharedWorker.postMessage({ type: "assetRatio", id: String(key), ratio: ASSET_RATIO[key] });
    } catch (e) {}
    const img = new Image();
    img.onload = function () { measureInk(key, img); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    ASSET_IMAGES[key] = img;
  }
  function ensureAsset(id) {
    if (id == null || id === "") return;
    const key = String(id);
    if (key in ASSET_IMAGES) return;    // already loaded, loading, or missing
    ASSET_IMAGES[key] = null;           // mark in-flight so we fetch only once
    const cache = window.PWL && window.PWL.assetSvgCache;
    const hit = cache && cache.get(key);
    if (hit) { useAssetSvg(key, hit); return; }   // served from localStorage, no DB read
    const sb = window.PWL && window.PWL.supabase;
    if (!sb) return;
    try {
      sb.from("assets").select("svg").eq("id", key).single().then(function (r) {
        if (r && r.data && r.data.svg) {
          if (cache) cache.put(key, r.data.svg);
          useAssetSvg(key, r.data.svg);
        }
      }, function () {});
    } catch (e) {}
  }
  // Hosts can warm the cache before a run so assets don't pop in mid-game.
  window.PWL = window.PWL || {};
  window.PWL.preloadGameAssets = function (ids) {
    (ids || []).forEach(function (id) { ensureAsset(id); });
  };

  // ---- Arcade sound: a tiny Web Audio synth, no audio files. game.sound(0..9)
  // (or by name) plays a short built-in effect. Browsers only allow audio after
  // a user gesture, but games are clicked to play, so it unlocks by then.
  let audioCtx = null;
  function gameAudio() {
    if (audioCtx) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = AC ? new AC() : null;
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }
  function sTone(c, at, f0, f1, dur, type, vol) {
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(f0, at);
    if (f1 != null && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const v = vol == null ? 0.18 : vol;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(at); osc.stop(at + dur + 0.02);
  }
  function sNoise(c, at, dur, vol, cutoff) {
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);   // decaying hiss
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cutoff || 1400;
    const g = c.createGain(); g.gain.value = vol == null ? 0.18 : vol;
    src.connect(lp); lp.connect(g); g.connect(c.destination);
    src.start(at); src.stop(at + dur);
  }
  // Numbered so game.sound(0), game.sound(1)... work, like the sprite skins.
  const SOUND_ORDER = ["beep", "buzz", "coin", "powerup", "jump", "laser", "hit", "explosion", "win", "lose"];
  const SOUND_ALIAS = { blip: "beep", wrong: "buzz", error: "buzz", point: "coin", score: "coin", shoot: "laser", zap: "laser", hurt: "hit", boom: "explosion", gameover: "lose", won: "win" };
  const SOUNDS = {
    beep: function (c, t) { sTone(c, t, 880, null, 0.08, "square", 0.18); },
    buzz: function (c, t) { sTone(c, t, 130, 90, 0.18, "sawtooth", 0.16); },
    coin: function (c, t) { sTone(c, t, 988, null, 0.06, "square", 0.16); sTone(c, t + 0.06, 1319, null, 0.13, "square", 0.16); },
    powerup: function (c, t) { [523, 659, 784, 1047].forEach(function (f, i) { sTone(c, t + i * 0.05, f, null, 0.08, "square", 0.15); }); },
    jump: function (c, t) { sTone(c, t, 300, 660, 0.14, "square", 0.17); },
    laser: function (c, t) { sTone(c, t, 900, 180, 0.16, "sawtooth", 0.15); },
    hit: function (c, t) { sTone(c, t, 200, 60, 0.15, "square", 0.2); sNoise(c, t, 0.11, 0.12, 1200); },
    explosion: function (c, t) { sNoise(c, t, 0.4, 0.25, 900); sTone(c, t, 120, 40, 0.4, "sawtooth", 0.12); },
    win: function (c, t) { [523, 659, 784, 1047].forEach(function (f, i) { sTone(c, t + i * 0.11, f, null, 0.15, "triangle", 0.18); }); },
    lose: function (c, t) { [420, 330, 262, 196].forEach(function (f, i) { sTone(c, t + i * 0.13, f, null, 0.17, "sawtooth", 0.16); }); }
  };
  function playGameSound(which) {
    const c = gameAudio();
    if (!c) return;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    let name;
    if (typeof which === "number") name = SOUND_ORDER[which] || "beep";
    else {
      const s = String(which == null ? "beep" : which).toLowerCase().trim();
      name = /^\d+$/.test(s) ? (SOUND_ORDER[+s] || "beep") : (SOUND_ALIAS[s] || s);
    }
    const fn = SOUNDS[name] || SOUNDS.beep;
    try { fn(c, c.currentTime + 0.01); } catch (e) {}
  }

  // ---- Held tones: a sustained oscillator you can re-pitch / re-volume live
  // (engines, sirens, drones). Unlike game.sound()'s one-shots, these keep
  // playing until stopped, and are all killed when the game resets or ends.
  // The game picks each tone's id (a counter on the Python side), so starting
  // and updating are plain fire-and-forget calls that also work from the worker.
  const heldTones = {};   // id -> { osc, gain }
  const TONE_WAVES = { sine: 1, square: 1, sawtooth: 1, triangle: 1 };
  function startTone(id, freq, wave, vol) {
    const c = gameAudio();
    if (!c) return;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    stopTone(id);   // replace any tone already using this id
    try {
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = TONE_WAVES[wave] ? wave : "sine";
      osc.frequency.setValueAtTime(Math.max(1, Number(freq) || 440), c.currentTime);
      const v = Math.max(0, Math.min(1, vol == null ? 0.15 : Number(vol)));
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), c.currentTime + 0.03);
      osc.connect(g); g.connect(c.destination);
      osc.start();
      heldTones[id] = { osc: osc, gain: g };
    } catch (e) {}
  }
  function pitchTone(id, hz) {
    const c = gameAudio(), t = heldTones[id];
    if (!c || !t) return;
    // setTargetAtTime glides smoothly, so per-frame updates don't click.
    try { t.osc.frequency.setTargetAtTime(Math.max(1, Number(hz) || 1), c.currentTime, 0.03); } catch (e) {}
  }
  function volumeTone(id, v) {
    const c = gameAudio(), t = heldTones[id];
    if (!c || !t) return;
    try { t.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, Number(v) || 0)), c.currentTime, 0.03); } catch (e) {}
  }
  function stopTone(id) {
    const t = heldTones[id];
    if (!t) return;
    delete heldTones[id];
    const c = audioCtx;
    try {
      if (c) {
        t.gain.gain.cancelScheduledValues(c.currentTime);
        t.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.03);   // brief fade, no click
        t.osc.stop(c.currentTime + 0.15);
      } else { t.osc.stop(); }
    } catch (e) {}
  }
  function stopAllTones() {
    Object.keys(heldTones).forEach(function (id) { stopTone(id); });
  }

  // A rounded-rectangle path, the same shape a label's background pill uses.
  // arcTo rather than roundRect, which is younger than some of the browsers
  // that only ever see this file through a preview.
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---- Save games (game.save / game.load / game.clear_save) ----
  // Everything a program saves is namespaced per program, so one game can never
  // read or clobber another's save. The namespace is the host's saveKey, else
  // its code-autosave storageKey, else the page path as a last resort.
  function gameSaveNamespace() {
    var o = (active && active.opts) || {};
    var k = o.saveKey != null ? o.saveKey : o.storageKey;
    if (typeof k === "function") { try { k = k(); } catch (e) { k = null; } }
    if (!k) { try { k = location.pathname; } catch (e) { k = "default"; } }
    return String(k);
  }
  function gameSaveKey(logicalKey) { return "pwlsg:" + gameSaveNamespace() + ":" + logicalKey; }

  const GAME_IO = {
    jspiOk: function () { return jspiSupported(); },
    // Persist one value for this program (JSON string in, from Python). Silently
    // no-ops if storage is full or blocked, so a save can never crash a game.
    saveState: function (key, blob) {
      try { localStorage.setItem(gameSaveKey(String(key)), String(blob)); } catch (e) {}
    },
    // Read one value back (or null when nothing is stored). Used directly on the
    // main-thread runtime; the worker serves it from the snapshot below instead.
    loadState: function (key) {
      try { return localStorage.getItem(gameSaveKey(String(key))); } catch (e) { return null; }
    },
    // Forget one key, or (key == null) this whole program's save.
    clearState: function (key) {
      try {
        if (key == null) {
          var p = gameSaveKey("");
          for (var i = localStorage.length - 1; i >= 0; i--) {
            var k = localStorage.key(i);
            if (k && k.indexOf(p) === 0) localStorage.removeItem(k);
          }
        } else {
          localStorage.removeItem(gameSaveKey(String(key)));
        }
      } catch (e) {}
    },
    // Every saved value for this program as { logicalKey: blob }. Pushed into the
    // worker at run start so game.load() works there without touching
    // localStorage (a Web Worker has none).
    saveSnapshot: function () {
      var out = {};
      try {
        var p = gameSaveKey("");
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(p) === 0) out[k.slice(p.length)] = localStorage.getItem(k);
        }
      } catch (e) {}
      return out;
    },
    sound: function (which) { playGameSound(which); },
    toneStart: function (id, freq, wave, vol) { startTone(id, freq, wave, vol); },
    tonePitch: function (id, hz) { pitchTone(id, hz); },
    toneVolume: function (id, v) { volumeTone(id, v); },
    toneStop: function (id) { stopTone(id); },
    // Warm the asset cache from game.preload(). Accepts a JSON array string (how
    // Python and the worker send it) or a plain array. Runs on the main thread
    // for both runtimes, where the asset cache lives.
    preloadAssets: function (ids) {
      var list;
      try { list = typeof ids === "string" ? JSON.parse(ids) : ids; } catch (e) { return; }
      (list || []).forEach(function (id) { ensureAsset(id); });
    },
    // The art's width/height, so Python can give an asset a collision box the
    // same shape as the thing you can see. 1 until the art has loaded, which is
    // the old square-box behaviour, and it corrects itself on the next frame.
    assetRatio: function (id) {
      if (id == null || id === "") return 1;
      var key = String(id);
      ensureAsset(key);
      return ASSET_RATIO[key] || 1;
    },
    // "fx,fy,fw,fh": the artwork's box inside its canvas, as fractions. Empty
    // until the art has loaded and been measured.
    assetInk: function (id) {
      if (id == null || id === "") return "";
      var key = String(id);
      ensureAsset(key);
      return ASSET_INK[key] || "";
    },
    fullscreen: function (on) { setGameFullscreen(null, on !== false); },
    playing: function () { return gamePlaying; },
    stop: function () { gamePlaying = false; },
    restart: function () { gameRestart = true; },
    reset: function () {
      stopAllTones();   // a fresh run (or a restart) starts silent
      gameKeys = {};
      gamePlaying = true;
      gameMouse.down = false; gameMouse.clicks = 0;
      // Back to the Python module's default window (_reset_all does the same to
      // W), so a game that never calls game.window() can't inherit the last
      // game's coordinate space.
      gameLogicalW = 480; gameLogicalH = 360;
      lastGameSceneJson = null;
      fitRetries = 0;
      resetGameInk();   // a new run starts on a blank layer, not last run's drawing
      const c = gameCtx();
      if (c) {
        c.canvas.style.cursor = "";
        fitGameCanvas();
        applyGameTransform(c);
        c.clearRect(0, 0, gameLogicalW, gameLogicalH);
      }
    },
    setup: function (w, h, bg) {
      gamePlaying = true;
      gameKeys = {};
      gameMouse.down = false; gameMouse.clicks = 0;
      const c = gameCtx();
      if (!c) return;
      // The requested size is the game's coordinate space; fitGameCanvas turns it
      // into a display-resolution pixel buffer.
      gameLogicalW = Number(w) || 480;
      gameLogicalH = Number(h) || 360;
      lastGameSceneJson = null;
      fitRetries = 0;
      resetGameInk();   // the layer matches the window the game just asked for
      c.canvas.style.background = String(bg || "#0b1020");
      c.canvas.style.cursor = "";
      fitGameCanvas();
    },
    setCursor: function (hidden) {
      const c = gameCtx();
      if (c) c.canvas.style.cursor = hidden ? "none" : "";
    },
    submitScore: function (points) {
      // Only a host that plugs in an onScore handler (e.g. a leaderboard)
      // receives scores; everywhere else this is a no-op by design.
      if (gameActive() && typeof active.opts.game.onScore === "function") {
        active.opts.game.onScore(Number(points));
      }
    },
    pressed: function (key) { return Boolean(gameKeys[String(key).toLowerCase()]); },
    mouseX: function () { return gameMouse.x; },
    mouseY: function () { return gameMouse.y; },
    mouseIn: function () { return gameMouse.inside; },
    mouseDown: function () { return gameMouse.down; },
    mouseClicks: function () { return gameMouse.clicks; },
    nextFrame: function (seconds) { return interruptibleSleep(seconds); },
    saveImage: function (which, name, ask) { saveGamePicture(which, name, !!ask); },
    copyImage: function (which) { copyGamePicture(which); },
    draw: function (json, isReplay) {
      let scene;
      try { scene = JSON.parse(json); } catch (e) { return; }
      const c = gameCtx();
      if (!c) return;
      const cv = c.canvas;
      // Draw in logical units: the buffer is display-sized, so this transform is
      // what makes the same code crisp at any resolution.
      applyGameTransform(c);
      // Stamp this frame's ink before compositing. Only on a real frame: a
      // replay (after a resize) is showing a scene whose marks are already on
      // the layer, and re-running them would double its fades and wipes.
      if (!isReplay) applyInk(scene.ink);
      lastGameSceneJson = json;
      // Remember the last drawn frame so publish.js can save it as a preview
      // "scene" (real sprite positions + the window size), tagged with the code
      // that produced it. The size lets the previewer scale sprites correctly
      // even when the game used a non-default window. It must be the LOGICAL
      // size, which is what the sprite coordinates are in.
      try {
        window.PWL = window.PWL || {};
        scene.w = gameLogicalW; scene.h = gameLogicalH;
        window.PWL.lastGameScene = scene;
        window.PWL.lastGameSceneCode = window.PWL.runningCode;
      } catch (e) {}
      c.clearRect(0, 0, gameLogicalW, gameLogicalH);
      c.fillStyle = scene.bg || "#0b1020";
      c.fillRect(0, 0, gameLogicalW, gameLogicalH);
      // Ink sits between the background and the sprites, so a scoreboard still
      // reads over the top of a drawing that has been building up all game.
      if (gameInk && gameInk.width) {
        c.drawImage(gameInk, 0, 0, gameLogicalW, gameLogicalH);
      }
      (scene.sprites || []).forEach(function (s) {
        // Angle (degrees) spins the sprite and scale_x / scale_y stretch or
        // mirror it, all about its own centre: move the canvas origin to the
        // sprite, rotate, scale, then draw at (0,0). scale -1 flips it.
        var ang = Number(s.angle) || 0;
        var sx = (s.sx == null || !isFinite(Number(s.sx))) ? 1 : Number(s.sx);
        var sy = (s.sy == null || !isFinite(Number(s.sy))) ? 1 : Number(s.sy);
        var moved = ang !== 0 || sx !== 1 || sy !== 1;
        // The anchor is the sprite's handle: that point sits on (x, y) AND the
        // sprite spins around it, so a hammer anchored at its handle swings from
        // the handle. The art's middle is offset from it by this much, in the
        // sprite's own units (Python does the same sum for the collision box).
        var anX = (s.ax == null || !isFinite(Number(s.ax))) ? 0.5 : Number(s.ax);
        var anY = (s.ay == null || !isFinite(Number(s.ay))) ? 0.5 : Number(s.ay);
        var lx = 0, ly = 0;
        if (anX !== 0.5 || anY !== 0.5) {
          var dW, dH;
          if (s.kind === "box" || s.kind === "circle") { dW = s.w; dH = s.h; }
          else if (s.kind === "asset") {
            var rr = ASSET_RATIO[String(s.asset)] || 1;
            var ssz = s.size || 40;
            dW = rr >= 1 ? ssz : ssz * rr;
            dH = rr >= 1 ? ssz / rr : ssz;
          } else { dW = s.size || 40; dH = s.size || 40; }
          lx = (0.5 - anX) * dW;
          ly = (0.5 - anY) * dH;
        }
        if (moved) {
          c.save();
          c.translate(s.x, s.y);          // the anchor: the pivot
          if (ang !== 0) c.rotate(ang * Math.PI / 180);
          if (sx !== 1 || sy !== 1) c.scale(sx, sy);
        }
        // Inside a scaled frame lx/ly are already in the right units; outside it
        // there is no scale to apply (sx and sy are 1 whenever `moved` is false).
        var dx = moved ? lx : s.x + lx, dy = moved ? ly : s.y + ly;
        if (s.kind === "box") {
          c.fillStyle = s.color || "#fff";
          var rr = Math.min(Number(s.rad) || 0, Math.abs(s.w) / 2, Math.abs(s.h) / 2);
          if (rr > 0) {
            roundRectPath(c, dx - s.w / 2, dy - s.h / 2, s.w, s.h, rr);
            c.fill();
          } else {
            c.fillRect(dx - s.w / 2, dy - s.h / 2, s.w, s.h);
          }
        } else if (s.kind === "circle") {
          c.fillStyle = s.color || "#fff";
          c.beginPath();
          c.ellipse(dx, dy, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
          c.fill();
        } else if (s.kind === "art") {
          var img = SPRITE_ART[s.art];
          var sz = s.size || 40;
          if (img && img.complete && img.naturalWidth) {
            c.drawImage(img, dx - sz / 2, dy - sz / 2, sz, sz);
          } else {
            // Unknown skin index (or not loaded yet): a purple square shows up.
            c.fillStyle = "#9b59b6";
            c.fillRect(dx - sz / 2, dy - sz / 2, sz, sz);
          }
        } else if (s.kind === "asset") {
          ensureAsset(s.asset);
          var akey = String(s.asset);
          var aimg = ASSET_IMAGES[akey];
          var asz = s.size || 40;
          if (aimg && aimg.complete && aimg.naturalWidth) {
            // Fit the sprite to its own proportions: the longer side is `size`,
            // the shorter side follows the SVG's aspect ratio. scale_x/scale_y
            // (already applied to the canvas above) still stretch it further.
            var ratio = ASSET_RATIO[akey] || 1;
            var aw = ratio >= 1 ? asz : asz * ratio;
            var ah = ratio >= 1 ? asz / ratio : asz;
            c.drawImage(aimg, dx - aw / 2, dy - ah / 2, aw, ah);
          } else {
            // Still loading (or unknown id): a soft placeholder square.
            c.fillStyle = "rgba(155,89,182,0.45)";
            c.fillRect(dx - asz / 2, dy - asz / 2, asz, asz);
          }
        } else if (s.kind === "text") {
          c.font = "bold " + (s.size || 20) + "px system-ui, sans-serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          if (s.back) {
            // A rounded box behind the text so it reads on any background.
            var tw = c.measureText(s.text).width;
            var th = s.size || 20;
            var padX = 8, padY = 5, r = 6;
            var bx = dx - tw / 2 - padX, by = dy - th / 2 - padY;
            var bw = tw + padX * 2, bh = th + padY * 2;
            c.fillStyle = s.back;
            c.beginPath();
            c.moveTo(bx + r, by);
            c.arcTo(bx + bw, by, bx + bw, by + bh, r);
            c.arcTo(bx + bw, by + bh, bx, by + bh, r);
            c.arcTo(bx, by + bh, bx, by, r);
            c.arcTo(bx, by, bx + bw, by, r);
            c.closePath();
            c.fill();
          }
          c.fillStyle = s.color || "#fff";
          c.fillText(s.text, dx, dy);
        } else {
          c.font = (s.size || 40) + "px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', system-ui, sans-serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(s.text, dx, dy);
        }
        if (moved) c.restore();
      });
      // Debug mode: outline each sprite's real collision box, rotated to match
      // the sprite's angle, so what you see is exactly what touches() compares.
      if (scene.debug) {
        c.save();
        c.strokeStyle = "#ff2d2d";
        c.lineWidth = 1.5;
        (scene.sprites || []).forEach(function (s) {
          var bw = Number(s.hbw) || 0, bh = Number(s.hbh) || 0;
          if (bw <= 0 || bh <= 0) return;
          var a = (Number(s.hba) || 0) * Math.PI / 180;
          // hbx/hby is where the box really is, anchor included.
          var bx = (s.hbx == null) ? s.x : Number(s.hbx);
          var by = (s.hby == null) ? s.y : Number(s.hby);
          c.save();
          c.translate(bx, by);
          if (a) c.rotate(a);
          c.strokeRect(-bw / 2, -bh / 2, bw, bh);
          c.restore();
        });
        c.restore();
      }
      if (scene.banner) {
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.fillRect(0, 0, gameLogicalW, gameLogicalH);
        c.fillStyle = "#ffffff";
        c.textAlign = "center";
        c.textBaseline = "middle";
        // Wrap the banner onto as many lines as it needs, and if a single word
        // is still too wide, shrink the text, so long messages never run off
        // the edges of the game window.
        var maxW = gameLogicalW - 40;
        var size = 30;
        c.font = "bold " + size + "px system-ui, sans-serif";
        // Split on newlines first (so "\n" in a message is a real line break),
        // then word-wrap each line so it still fits the window.
        var lines = [];
        var paras = String(scene.banner).split("\n");
        for (var pi = 0; pi < paras.length; pi++) {
          var words = paras[pi].split(" ");
          var line = "";
          for (var wi = 0; wi < words.length; wi++) {
            var test = line ? line + " " + words[wi] : words[wi];
            if (line && c.measureText(test).width > maxW) {
              lines.push(line);
              line = words[wi];
            } else {
              line = test;
            }
          }
          lines.push(line);
        }
        var widest = 0;
        for (var li = 0; li < lines.length; li++) {
          widest = Math.max(widest, c.measureText(lines[li]).width);
        }
        if (widest > maxW) {
          size = Math.max(12, Math.floor(size * maxW / widest));
          c.font = "bold " + size + "px system-ui, sans-serif";
        }
        var lineH = size * 1.25;
        var startY = gameLogicalH / 2 - (lines.length - 1) * lineH / 2;
        for (var k = 0; k < lines.length; k++) {
          c.fillText(lines[k], gameLogicalW / 2, startY + k * lineH);
        }
      }
    }
  };

  // ---- SPIKE: JS side of `import game3d`, a thin bridge onto three.js -------
  // Python posts the whole scene as JSON each frame (same retained-mode shape
  // the 2D game uses). Here we diff it against a pool of meshes keyed by the id
  // Python assigns, so nothing is rebuilt per frame and geometry/materials are
  // shared. three.js is imported lazily on first use, so 2D programs never pay
  // for the download.
  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
  let THREE = null, threeLoading = null, threeFailed = false;
  let g3dRenderer = null, g3dScene = null, g3dCam = null, g3dSun = null;
  let g3dMeshes = new Map();     // Python object id -> THREE.Mesh
  const g3dGeoCache = {};        // kind -> shared unit geometry
  const g3dMatCache = new Map(); // colour -> shared material
  let lastG3dScene = null;

  function game3dActive() { return running && active && active.opts.game3d; }
  function game3dCanvasEl() {
    if (active && active.opts.game3d && active.opts.game3d.canvas) return active.opts.game3d.canvas;
    return document.getElementById("game3d-canvas");
  }
  function ensureThree() {
    if (THREE) return Promise.resolve(THREE);
    if (!threeLoading) {
      threeLoading = import(THREE_URL).then(function (m) { THREE = m; return m; },
        function (e) { threeLoading = null; threeFailed = true; throw e; });
    }
    return threeLoading;
  }
  function g3dGeometry(kind) {
    if (!g3dGeoCache[kind]) {
      if (kind === "sphere") g3dGeoCache[kind] = new THREE.SphereGeometry(0.5, 32, 24);
      else if (kind === "cylinder") g3dGeoCache[kind] = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
      else if (kind === "plane") {
        const g = new THREE.PlaneGeometry(1, 1);
        g.rotateX(-Math.PI / 2);      // lie flat, so y is up as Python expects
        g3dGeoCache[kind] = g;
      } else g3dGeoCache[kind] = new THREE.BoxGeometry(1, 1, 1);
    }
    return g3dGeoCache[kind];
  }
  function g3dMaterial(color) {
    const key = String(color || "#cdd6e4");
    if (!g3dMatCache.has(key)) {
      let c;
      try { c = new THREE.Color(key); } catch (e) { c = new THREE.Color("#cdd6e4"); }
      g3dMatCache.set(key, new THREE.MeshLambertMaterial({ color: c }));
    }
    return g3dMatCache.get(key);
  }
  function ensureG3dRenderer() {
    const cv = game3dCanvasEl();
    if (!cv || !THREE) return null;
    if (g3dRenderer && g3dRenderer.domElement === cv) return g3dRenderer;
    g3dRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    g3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    g3dScene = new THREE.Scene();
    g3dCam = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 4000);
    // Friendly default lighting: soft sky/ground fill plus one sun.
    g3dScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
    g3dSun = new THREE.DirectionalLight(0xffffff, 1.15);
    g3dSun.position.set(8, 16, 10);
    g3dScene.add(g3dSun);
    g3dMeshes = new Map();
    return g3dRenderer;
  }
  // Same crispness rule as the 2D canvas: the drawing buffer matches the real
  // device pixels, three.js just does the arithmetic for us via setPixelRatio.
  function fitG3dCanvas() {
    const cv = game3dCanvasEl();
    if (!cv || !g3dRenderer) return;
    const lw = cv.__pwlLogicalW || 480, lh = cv.__pwlLogicalH || 360;
    const host = cv.parentElement;
    let avail = lw;
    if (host) {
      let pad = 0;
      try {
        const cs = getComputedStyle(host);
        pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      } catch (e) {}
      avail = Math.max(1, (host.clientWidth || lw) - pad);
    }
    const cssW = Math.max(40, Math.round(Math.min(lw, avail)));
    const cssH = Math.round(cssW * lh / lw);
    const cur = g3dRenderer.getSize(new THREE.Vector2());
    if (Math.round(cur.x) !== cssW || Math.round(cur.y) !== cssH) {
      g3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
      g3dRenderer.setSize(cssW, cssH, true);   // true: also set the CSS size
      g3dCam.aspect = cssW / cssH;
      g3dCam.updateProjectionMatrix();
    }
  }
  function num(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }
  const D2R = Math.PI / 180;
  function renderG3d(sc) {
    if (!ensureG3dRenderer()) return;
    fitG3dCanvas();
    if (!g3dScene.background || g3dScene.__bg !== sc.bg) {
      try { g3dScene.background = new THREE.Color(sc.bg || "#8ec5f0"); g3dScene.__bg = sc.bg; } catch (e) {}
    }
    const c = sc.cam || {};
    g3dCam.position.set(num(c.x, 0), num(c.y, 6), num(c.z, 14));
    g3dCam.lookAt(num(c.tx, 0), num(c.ty, 0), num(c.tz, 0));
    const fov = num(c.fov, 60);
    if (g3dCam.fov !== fov) { g3dCam.fov = fov; g3dCam.updateProjectionMatrix(); }

    const seen = new Set();
    (sc.objs || []).forEach(function (o) {
      seen.add(o.i);
      let m = g3dMeshes.get(o.i);
      if (!m || m.__kind !== o.k) {                 // new object, or it changed shape
        if (m) g3dScene.remove(m);
        m = new THREE.Mesh(g3dGeometry(o.k), g3dMaterial(o.c));
        m.__kind = o.k; m.__color = o.c;
        g3dScene.add(m);
        g3dMeshes.set(o.i, m);
      }
      if (m.__color !== o.c) { m.material = g3dMaterial(o.c); m.__color = o.c; }
      m.visible = o.vis !== false;
      m.position.set(num(o.x, 0), num(o.y, 0), num(o.z, 0));
      m.scale.set(num(o.w, 1) || 1, num(o.h, 1) || 1, num(o.d, 1) || 1);
      m.rotation.set(num(o.rx, 0) * D2R, num(o.ry, 0) * D2R, num(o.rz, 0) * D2R);
    });
    // Anything Python removed goes too.
    g3dMeshes.forEach(function (m, id) {
      if (!seen.has(id)) { g3dScene.remove(m); g3dMeshes.delete(id); }
    });
    g3dRenderer.render(g3dScene, g3dCam);
  }
  function paintG3d(sc) {
    if (THREE) { renderG3d(sc); return; }
    if (threeFailed) return;
    ensureThree().then(function () {
      if (lastG3dScene) renderG3d(lastG3dScene);
    }, function () {
      if (active && active.appendOut) {
        active.appendOut("Could not load the 3D library (three.js). Check your connection and run again.", "err");
      }
    });
  }
  const GAME3D_IO = {
    jspiOk: function () { return jspiSupported(); },
    nextFrame: function (seconds) { return interruptibleSleep(seconds); },
    pressed: function (key) { return Boolean(gameKeys[String(key).toLowerCase()]); },
    reset: function () {
      lastG3dScene = null;
      if (g3dScene) {
        g3dMeshes.forEach(function (m) { g3dScene.remove(m); });
        g3dMeshes.clear();
      }
      ensureThree().then(function () {}, function () {});   // warm it up early
    },
    draw: function (json) {
      let sc;
      try { sc = JSON.parse(json); } catch (e) { return; }
      lastG3dScene = sc;
      paintG3d(sc);
    }
  };
  window.addEventListener("resize", function () { if (lastG3dScene && THREE && g3dRenderer) renderG3d(lastG3dScene); });

  // ---- JS side of the turtle: canvas drawing, dispatched to `active` ------

  function turtleCtx() {
    if (!active || !active.opts.turtle) return null;
    return active.turtleCtx;
  }
  function spriteCtx() {
    if (!active || !active.opts.turtle) return null;
    return active.spriteCtx;
  }
  // ---- Crisp turtle -------------------------------------------------------
  // Same idea as the game: draw in logical units into a buffer sized to real
  // device pixels. The difference is that a turtle drawing ACCUMULATES strokes,
  // so resizing the buffer mid-drawing would erase it (and the op recorder is
  // capped, so a replay could not always rebuild it). Instead the buffer is
  // sized once per run, generously enough that any later layout change
  // (maximising the editor, rotating a phone) only ever scales it DOWN, which
  // stays sharp. The stage can never be wider than the viewport, so that bounds
  // how big it ever needs to be.
  const MAX_TURTLE_PX = 4e6;   // per canvas, so two stacked buffers stay reasonable
  // The turtle's coordinate space: the canvas's ORIGINAL attribute size, kept on
  // the element because the buffer no longer reports it.
  function turtleLogical(cv) {
    if (!cv.__pwlLogicalW) {
      cv.__pwlLogicalW = cv.width || 560;
      cv.__pwlLogicalH = cv.height || 380;
    }
    return { w: cv.__pwlLogicalW, h: cv.__pwlLogicalH };
  }
  function turtleScaleFor(lw, lh) {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DPR);
    const maxCssW = Math.max(lw, window.innerWidth || lw);
    let k = (maxCssW / lw) * dpr;
    const px = (lw * k) * (lh * k);
    if (px > MAX_TURTLE_PX) k *= Math.sqrt(MAX_TURTLE_PX / px);
    return Math.max(1, k);
  }
  // Size one turtle canvas for this run and scale its context. Returns the
  // logical size to draw against.
  function sizeTurtleCanvas(cv) {
    if (!cv) return null;
    const L = turtleLogical(cv);
    const k = turtleScaleFor(L.w, L.h);
    const bw = Math.max(1, Math.round(L.w * k));
    const bh = Math.max(1, Math.round(L.h * k));
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const ctx = cv.getContext("2d");
    if (ctx) ctx.setTransform(bw / L.w, 0, 0, bh / L.h, 0, 0);
    return L;
  }

  // Turtle coords (origin centre, y up) to canvas pixels (logical, pre-transform).
  function tx(c, x) { return turtleLogical(c.canvas).w / 2 + x; }
  function ty(c, y) { return turtleLogical(c.canvas).h / 2 - y; }

  // The turtle sprite: custom SVG art (top-down, facing right = heading 0),
  // rendered onto the overlay canvas via an Image. Same drawing as the
  // track-picker icon on the assignment page.
  const TURTLE_SPRITE_SVG =
    '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M14 32 L5 27.5 L7.5 32 L5 36.5 Z" fill="#2f855a"/>' +
      '<ellipse cx="23" cy="16.5" rx="7" ry="4.5" transform="rotate(-35 23 16.5)" fill="#38a169"/>' +
      '<ellipse cx="41" cy="16.5" rx="7" ry="4.5" transform="rotate(35 41 16.5)" fill="#38a169"/>' +
      '<ellipse cx="23" cy="47.5" rx="7" ry="4.5" transform="rotate(35 23 47.5)" fill="#38a169"/>' +
      '<ellipse cx="41" cy="47.5" rx="7" ry="4.5" transform="rotate(-35 41 47.5)" fill="#38a169"/>' +
      '<circle cx="52" cy="32" r="7.5" fill="#48bb78"/>' +
      '<circle cx="55" cy="29.3" r="1.4" fill="#1a202c"/>' +
      '<circle cx="55" cy="34.7" r="1.4" fill="#1a202c"/>' +
      '<ellipse cx="30" cy="32" rx="18" ry="15" fill="#2e9e63" stroke="#1f7a4a" stroke-width="2"/>' +
      '<polygon points="30,24 37,28 37,36 30,40 23,36 23,28" fill="#3db878" stroke="#1f7a4a" stroke-width="1.5"/>' +
      '<path d="M30 24 L30 18 M37 28 L43.5 24.5 M37 36 L43.5 39.5 M30 40 L30 46 M23 36 L16.5 39.5 M23 28 L16.5 24.5" ' +
            'stroke="#1f7a4a" stroke-width="1.5" fill="none"/>' +
    '</svg>';
  const turtleSpriteImg = new Image();
  turtleSpriteImg.src = "data:image/svg+xml;utf8," + encodeURIComponent(TURTLE_SPRITE_SVG);

  // Record each turtle draw call (in turtle coords: origin centre, y up) so the
  // finished drawing can be saved as a small JSON op-list and replayed as a
  // community thumbnail, the way games store their scene. Capped so a runaway
  // drawing can't bloat the row; coords are rounded to keep the JSON tiny.
  const TURTLE_OP_CAP = 4000;
  function rec(op) {
    const r = active && active.turtleRec;
    if (!r) return;
    flushSeg(r);                 // any other op ends the straight run in progress
    if (r.ops.length >= TURTLE_OP_CAP) return;
    r.ops.push(op);
  }
  // One decimal, not whole units. A thumbnail is scaled to fit its card, so a
  // small drawing is magnified, and half a unit of error goes with it.
  function rnd(v) { const n = Math.round(Number(v) * 10) / 10; return n || 0; }

  // Straight runs are recorded as ONE segment.
  //
  // The turtle animates a single forward() by walking it in up to 40 short
  // steps. Recording each step separately meant every intermediate point got
  // snapped to the grid, which bent a straight diagonal into a visible
  // staircase on the community card. (The live canvas never showed it: that
  // draws the unrounded numbers.) Holding the current run and extending it
  // while the next step carries straight on means only the real corners are
  // ever rounded, and the op count drops by roughly the step count with it,
  // so a long drawing is far less likely to hit the cap.
  function recSeg(x1, y1, x2, y2, color, width) {
    const r = active && active.turtleRec;
    if (!r) return;
    const p = r.pend;
    if (p && p.c === color && p.w === width &&
        Math.abs(p.x2 - x1) < 1e-9 && Math.abs(p.y2 - y1) < 1e-9) {
      const ax = p.x2 - p.x1, ay = p.y2 - p.y1;
      const bx = x2 - x1, by = y2 - y1;
      // Same heading (the cross product vanishes) and not doubling back.
      const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (Math.abs(ax * by - ay * bx) <= 1e-9 * (scale + 1) && ax * bx + ay * by >= 0) {
        p.x2 = x2; p.y2 = y2;
        return;
      }
    }
    flushSeg(r);
    r.pend = { x1: x1, y1: y1, x2: x2, y2: y2, c: color, w: width };
  }
  function flushSeg(r) {
    const p = r && r.pend;
    if (!p) return;
    r.pend = null;
    if (r.ops.length >= TURTLE_OP_CAP) return;
    r.ops.push({ k: "s", a: [rnd(p.x1), rnd(p.y1), rnd(p.x2), rnd(p.y2)], c: p.c, w: p.w });
  }

  const TURTLE_IO = {
    animateOk: function () { return jspiSupported(); },
    sleepMs: function (seconds) { return interruptibleSleep(seconds); },
    segment: function (x1, y1, x2, y2, color, width) {
      const c = turtleCtx();
      if (!c) return;
      c.strokeStyle = String(color);
      c.lineWidth = Number(width) || 2;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(tx(c, x1), ty(c, y1));
      c.lineTo(tx(c, x2), ty(c, y2));
      c.stroke();
      recSeg(Number(x1), Number(y1), Number(x2), Number(y2),
             String(color), Number(width) || 2);
    },
    fillPoly: function (flatPoints, color) {
      const c = turtleCtx();
      if (!c) return;
      const pts = Array.from(flatPoints);
      if (pts.length < 6) return;
      c.fillStyle = String(color);
      c.beginPath();
      c.moveTo(tx(c, pts[0]), ty(c, pts[1]));
      for (let i = 2; i < pts.length; i += 2) {
        c.lineTo(tx(c, pts[i]), ty(c, pts[i + 1]));
      }
      c.closePath();
      c.fill();
      rec({ k: "p", a: pts.map(rnd), c: String(color) });
    },
    dot: function (x, y, size, color) {
      const c = turtleCtx();
      if (!c) return;
      c.fillStyle = String(color);
      c.beginPath();
      c.arc(tx(c, x), ty(c, y), Math.max(1, size / 2), 0, Math.PI * 2);
      c.fill();
      rec({ k: "d", x: rnd(x), y: rnd(y), z: Number(size) || 6, c: String(color) });
    },
    text: function (x, y, text, color, size, align, fontName) {
      const c = turtleCtx();
      if (!c) return;
      c.fillStyle = String(color);
      c.font = "bold " + (Number(size) || 12) + "px " + (fontName || "Arial") + ", sans-serif";
      c.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
      c.textBaseline = "bottom";
      c.fillText(String(text), tx(c, x), ty(c, y));
      rec({ k: "t", x: rnd(x), y: rnd(y), s: String(text), c: String(color), z: Number(size) || 12, al: String(align || "left") });
    },
    bg: function (color) {
      if (!active || !active.opts.turtle) return;
      active.opts.turtle.canvas.style.background = String(color || "");
      if (active.turtleRec) active.turtleRec.bg = String(color || "");
    },
    wipe: function () {
      const c = turtleCtx();
      if (!c) return;
      const L = turtleLogical(c.canvas);
      c.clearRect(0, 0, L.w, L.h);
      // clear() wipes the recording, the half-finished straight run included.
      if (active && active.turtleRec) { active.turtleRec.ops = []; active.turtleRec.pend = null; }
    },
    sprite: function (x, y, heading, visible) {
      const c = spriteCtx();
      if (!c) return;
      const LS = turtleLogical(c.canvas);
      c.clearRect(0, 0, LS.w, LS.h);
      if (!visible) return;
      c.save();
      c.translate(tx(c, x), ty(c, y));
      // Heading 0 = east; the sprite art faces right, so just counter the
      // canvas's flipped y axis.
      c.rotate(-heading * Math.PI / 180);
      const size = 30;
      if (turtleSpriteImg.complete && turtleSpriteImg.naturalWidth) {
        c.drawImage(turtleSpriteImg, -size / 2, -size / 2, size, size);
      } else {
        // Image still decoding on the very first frame: simple pointer stand-in.
        c.fillStyle = "#2e9e63";
        c.beginPath();
        c.moveTo(10, 0); c.lineTo(-7, 6); c.lineTo(-4, 0); c.lineTo(-7, -6);
        c.closePath();
        c.fill();
      }
      c.restore();
    }
  };

  // Save the finished turtle drawing as a compact JSON op-list (recorded above),
  // so the community gallery can replay it as a thumbnail the way games replay
  // their scene. Stored on window.PWL, tagged with the code that made it, for
  // publish.js to read; only for turtle programs that actually drew something.
  function captureTurtleScene(runner) {
    if (!runner || !runner.turtleCtx || !runner.opts.turtle) return;
    const code = (window.PWL && window.PWL.runningCode) || "";
    if (!/(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(code)) return;
    const drawing = runner.turtleRec;
    // The last straight run is still being extended when the program ends, so
    // commit it before reading, or the final stroke goes missing from the card.
    if (drawing) flushSeg(drawing);
    if (!drawing || !drawing.ops.length) return;   // nothing was drawn: no thumbnail
    const cv = runner.turtleCtx.canvas;
    // The turtle's background (from bgcolor()) or the default dark stage, so a
    // light-penned drawing still reads against it.
    const bg = (drawing.bg || runner.opts.turtle.canvas.style.background || "").trim() || "#0f1226";
    // The LOGICAL size: the recorded ops are in turtle coordinates, which is what
    // the thumbnail replayer scales against (not the device-sized buffer).
    const L = turtleLogical(cv);
    window.PWL = window.PWL || {};
    window.PWL.lastTurtleScene = {
      kind: "turtle", w: L.w, h: L.h, bg: bg, ops: drawing.ops.slice()
    };
    window.PWL.lastTurtleSceneCode = code;
  }

  // ---- Shared IO (input/clear/colour print), dispatched to `active` --------

  function appendToActive(text, kind) {
    if (active) active.appendOut(text, kind);
  }

  function readLineInteractive(promptText) {
    return new Promise(function (resolve, reject) {
      if (!active) { reject(new Error("No active runner")); return; }
      const output = active.opts.output;
      const line = document.createElement("span");
      line.className = "out-stdin-line";
      if (promptText) line.appendChild(document.createTextNode(promptText));

      const field = document.createElement("input");
      field.type = "text";
      field.className = "sandbox-stdin";
      field.autocomplete = "off";
      field.autocapitalize = "off";
      field.spellcheck = false;
      field.size = 1;
      line.appendChild(field);

      const cursor = document.createElement("span");
      cursor.className = "sandbox-cursor";
      cursor.setAttribute("aria-hidden", "true");
      line.appendChild(cursor);

      output.appendChild(line);
      output.scrollTop = output.scrollHeight;

      function resize() {
        field.size = Math.max(1, field.value.length);
      }
      field.addEventListener("input", resize);
      line.addEventListener("mousedown", function (e) {
        if (e.target !== field) { e.preventDefault(); field.focus(); }
      });

      field.focus({ preventScroll: true });
      Promise.resolve().then(function () { field.focus({ preventScroll: true }); });

      function cleanup() {
        pendingReject = null;
        field.removeEventListener("input", resize);
        field.removeEventListener("keydown", onKey);
      }

      function onKey(e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const value = field.value;
        cleanup();
        const echo = document.createElement("span");
        echo.className = "out-stdin";
        echo.textContent = value;
        line.replaceChild(echo, field);
        if (cursor.parentNode === line) line.removeChild(cursor);
        line.appendChild(document.createTextNode("\n"));
        output.scrollTop = output.scrollHeight;
        resolve(value);
      }

      pendingReject = function (err) {
        cleanup();
        if (field.parentNode === line) {
          const stopMark = document.createElement("span");
          stopMark.className = "out-stderr";
          stopMark.textContent = "[stopped]";
          line.replaceChild(stopMark, field);
        }
        if (cursor.parentNode === line) line.removeChild(cursor);
        line.appendChild(document.createTextNode("\n"));
        reject(err);
      };

      field.addEventListener("keydown", onKey);
    });
  }

  function interruptibleSleep(seconds) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        pendingReject = null;
        resolve();
      }, Math.max(0, seconds * 1000));
      pendingReject = function (err) {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  const SANDBOX_IO = {
    readLine: readLineInteractive,
    sleepMs: interruptibleSleep,
    shouldStop: function () {
      if (!stopRequested) return false;
      stopRequested = false;
      return true;
    },
    clearOutput: function () {
      if (active) active.opts.output.innerHTML = "";
    },
    writeColored: function (text, color) {
      if (!active) return;
      const output = active.opts.output;
      const span = document.createElement("span");
      span.style.color = String(color || "");
      span.textContent = String(text);
      output.appendChild(span);
      output.scrollTop = output.scrollHeight;
    }
  };

  // ---- Worker runtime plumbing (main side) --------------------------------
  // Replays the worker's draw calls through the SAME TURTLE_IO/GAME_IO used by
  // the JSPI path, and feeds it live input via the shared buffer.
  function zeroInputState() {
    if (!workerMem) return;
    const c = workerMem.ctrl, K = window.PRProto.CTRL;
    for (let i = 0; i < K.NKEYS; i++) Atomics.store(c, K.KEYS + i, 0);
    Atomics.store(c, K.MX, 0); Atomics.store(c, K.MY, 0);
    Atomics.store(c, K.MDOWN, 0); Atomics.store(c, K.MCLICKS, 0); Atomics.store(c, K.MIN, 0);
  }
  function ensureWorker() {
    if (sharedWorkerReady) return sharedWorkerReady;
    sharedWorkerReady = new Promise(function (resolve, reject) {
      try {
        workerMem = window.PRProto.make();
        const w = new Worker(WORKER_URL);
        w.onmessage = onWorkerMessage;
        w.onerror = function (ev) { reject(new Error("worker failed: " + (ev && ev.message || "load error"))); };
        workerReadyResolve = resolve;
        w.postMessage({
          type: "init", sab: workerMem.sab, interrupt: workerMem.interrupt,
          installs: [PY_INSTALL_INPUT, PY_PATCH_SLEEP, PY_INSTALL_INTERRUPT, PY_INSTALL_CLEAR, PY_INSTALL_COLOR_PRINT, PY_INSTALL_TURTLE, PY_INSTALL_GAME, PY_INSTALL_GAME3D]
        });
        sharedWorker = w;
      } catch (e) { reject(e); }
    });
    return sharedWorkerReady;
  }
  function onWorkerMessage(e) {
    const m = e.data;
    if (!m) return;
    if (m.t === "io") { handleWorkerIO(m); return; }
    if (m.t === "done" || m.t === "runerror") {
      if (m.t === "runerror" && active) {
        const msg = m.msg || "";
        if (/KeyboardInterrupt|Stopped by user/.test(msg)) active.appendOut("[stopped]", "info");
        else if (msg) active.appendOut(msg, "stderr");
      }
      if (workerFinalize) { const f = workerFinalize; workerFinalize = null; f(); }
    }
  }
  function handleWorkerIO(m) {
    const a = m.args || [];
    try {
      if (m.io === "t") { if (TURTLE_IO[m.op]) TURTLE_IO[m.op].apply(null, a); }
      else if (m.io === "g") {
        if (m.op === "reset") { GAME_IO.reset(); zeroInputState(); }
        else if (GAME_IO[m.op]) GAME_IO[m.op].apply(null, a);
      } else if (m.io === "d") {          // 3D (import game3d)
        if (m.op === "reset") { GAME3D_IO.reset(); zeroInputState(); }
        else if (GAME3D_IO[m.op]) GAME3D_IO[m.op].apply(null, a);
      } else if (m.io === "s") {
        if (m.op === "stdout") appendToActive(a[0], "stdout");
        else if (m.op === "stderr") appendToActive(a[0], "stderr");
        else if (m.op === "writeColored") SANDBOX_IO.writeColored(a[0], a[1]);
        else if (m.op === "clearOutput") SANDBOX_IO.clearOutput();
        else if (m.op === "requestInput") workerRequestInput(a[0]);
        else if (m.op === "ready") { if (workerReadyResolve) { const r = workerReadyResolve; workerReadyResolve = null; r(); } }
      }
    } catch (err) { /* one bad op must not kill the run */ }
  }
  function workerRequestInput(promptText) {
    if (!active) return;
    const output = active.opts.output;
    const line = document.createElement("span");
    line.className = "out-stdin-line";
    if (promptText) line.appendChild(document.createTextNode(promptText));
    const field = document.createElement("input");
    field.type = "text"; field.className = "sandbox-stdin";
    field.autocapitalize = "off"; field.autocomplete = "off"; field.spellcheck = false;
    line.appendChild(field);
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    setTimeout(function () { try { field.focus(); } catch (e) {} }, 0);
    function submit() {
      const val = field.value;
      const done = document.createElement("span");
      done.className = "out-stdin"; done.textContent = val;
      field.replaceWith(done);
      output.appendChild(document.createTextNode("\n"));
      output.scrollTop = output.scrollHeight;
      const bytes = new TextEncoder().encode(val);
      const n = Math.min(bytes.length, workerMem.str.length);
      workerMem.str.set(bytes.subarray(0, n));
      const K = window.PRProto.CTRL;
      Atomics.store(workerMem.ctrl, K.INLEN, n);
      Atomics.add(workerMem.ctrl, K.INPUT, 1);
      Atomics.notify(workerMem.ctrl, K.INPUT);
    }
    field.addEventListener("keydown", function onKey(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); field.removeEventListener("keydown", onKey); submit(); }
    });
  }

  // ---- Pyodide bootstrap ----------------------------------------------------

  function loadPyodideScript() {
    if (window.loadPyodide) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = PYODIDE_URL;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Couldn't reach the Python runtime CDN.")); };
      document.head.appendChild(s);
    });
  }

  async function ensurePyodide() {
    if (pyodide) return pyodide;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async function () {
      appendToActive("Loading Python runtime (one-time, ~10 MB)…", "info");
      await loadPyodideScript();
      const py = await window.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/"
      });
      py.setStdout({ batched: function (s) { appendToActive(s, "stdout"); } });
      py.setStderr({ batched: function (s) { appendToActive(s, "stderr"); } });
      py.registerJsModule("_sandbox_io", SANDBOX_IO);
      py.registerJsModule("_turtle_io", TURTLE_IO);
      py.registerJsModule("_game_io", GAME_IO);
      py.registerJsModule("_game3d_io", GAME3D_IO);
      const useJspi = jspiSupported();
      await py.runPythonAsync(useJspi ? PY_INSTALL_INPUT : PY_DISABLE_INPUT);
      if (useJspi) await py.runPythonAsync(PY_PATCH_SLEEP);
      await py.runPythonAsync(PY_INSTALL_INTERRUPT);
      await py.runPythonAsync(PY_INSTALL_CLEAR);
      await py.runPythonAsync(PY_INSTALL_COLOR_PRINT);
      await py.runPythonAsync(PY_INSTALL_TURTLE);
      await py.runPythonAsync(PY_INSTALL_GAME);
      await py.runPythonAsync(PY_INSTALL_GAME3D);
      appendToActive("Python ready. Running your code…", "info");
      pyodide = py;
      return py;
    })();

    return loadingPromise;
  }

  // ---- Runner factory --------------------------------------------------------

  function create(opts) {
    const editor = opts.editor;
    const output = opts.output;
    const runBtn = opts.runBtn;
    const runLabel = runBtn ? runBtn.querySelector(".sandbox-run-label") : null;
    let jar = null;

    const runner = {
      opts: opts,
      turtleCtx: null,
      spriteCtx: null,
      gameCtx: null,
      turtleRec: null,   // { ops:[], bg:"" } recorded during a turtle run for the thumbnail
      appendOut: function (text, kind) {
        const span = document.createElement("span");
        if (kind) span.className = "out-" + kind;
        span.textContent = text + (text.endsWith("\n") ? "" : "\n");
        output.appendChild(span);
        output.scrollTop = output.scrollHeight;
      }
    };

    if (opts.turtle && opts.turtle.canvas) {
      runner.turtleCtx = opts.turtle.canvas.getContext("2d");
      if (opts.turtle.sprite) runner.spriteCtx = opts.turtle.sprite.getContext("2d");
    }
    if (opts.game && opts.game.canvas) {
      runner.gameCtx = opts.game.canvas.getContext("2d");
    }
    if (opts.game3d && opts.game3d.canvas) {
      // Remember the 3D stage's aspect: the WebGL buffer is device-sized, so the
      // attributes stop reporting it (same rule as the turtle canvases).
      const sv = opts.game3d.canvas;
      if (!sv.__pwlLogicalW) { sv.__pwlLogicalW = sv.width || 480; sv.__pwlLogicalH = sv.height || 360; }
    }

    // storageKey and defaultCode may be plain values or functions, so a
    // page can swap save slots on the fly (e.g. per assignment track).
    function storageKey() {
      return typeof opts.storageKey === "function" ? opts.storageKey() : opts.storageKey;
    }
    function defaultCode() {
      return typeof opts.defaultCode === "function" ? opts.defaultCode() : (opts.defaultCode || "");
    }
    function getCode() {
      return jar ? jar.toString() : editor.textContent;
    }
    function setCode(code) {
      if (jar) jar.updateCode(code);
      else editor.textContent = code;
      saveCode(code);
    }
    function loadSaved() {
      const k = storageKey();
      const saved = k ? localStorage.getItem(k) : null;
      return (saved && saved.length) ? saved : defaultCode();
    }
    function saveCode(code) {
      const k = storageKey();
      const val = code == null ? getCode() : code;
      if (k) localStorage.setItem(k, val);
      // Fires on typing, snippet loads and setCode, so pages can react to
      // what the code contains (e.g. show the turtle canvas on import).
      if (opts.onChange) opts.onChange(val);
    }

    function setRunMode(mode) {
      const isLoading = mode === "loading";
      const isBusy = mode === "busy" || isLoading;
      if (runLabel) {
        runLabel.textContent = isLoading ? "Loading…" : isBusy ? "Stop" : "Run";
      } else if (runBtn) {
        runBtn.textContent = isLoading ? "Loading…" : isBusy ? "Stop" : "Run";
      }
      if (runBtn) {
        runBtn.disabled = isLoading;
        runBtn.classList.toggle("is-busy", isBusy);
        runBtn.classList.toggle("btn-primary", !isBusy);
        runBtn.classList.toggle("btn-danger", isBusy && !isLoading);
      }
    }

    // Putting the run back to idle. Safe to call twice: whoever gets there
    // first wins, so the normal end of a run and the watchdog below cannot
    // both fire the teardown.
    let finalized = true;
    function finalizeRun() {
      if (finalized) return;
      finalized = true;
      running = false;
      stopRequested = false;
      pendingReject = null;
      if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
      // A game that ended or was stopped leaves fullscreen, so the page scrolls
      // again (a restart loop stays inside run(), so it keeps fullscreen).
      try { setGameFullscreen(null, false); } catch (e) {}
      try { stopAllTones(); } catch (e) {}   // silence any held engine/drone tone
      try { captureTurtleScene(runner); } catch (e) {}
      setRunMode("idle");
      if (opts.onRunEnd) opts.onRunEnd();
    }

    let stopWatchdog = null;
    function stop() {
      if (!running) return;
      stopRequested = true;
      gamePlaying = false; // a game loop checking game.playing() exits cleanly
      if (pendingReject) {
        const r = pendingReject;
        pendingReject = null;
        r(new Error("Stopped by user"));
      }
      // Stop must always give the button back. A clean stop lands in run()'s
      // finally within a frame or two; if it has not, something swallowed the
      // interrupt and that promise is never going to settle, so put the UI
      // back anyway rather than stranding the user on a dead Stop button.
      if (stopWatchdog) clearTimeout(stopWatchdog);
      stopWatchdog = setTimeout(function () {
        stopWatchdog = null;
        if (!running) return;
        runner.appendOut("[stopped]", "info");
        // Detach first: if Python really is still grinding away in the
        // background, this stops its output and drawing reaching the page.
        if (active === runner) active = null;
        finalizeRun();
      }, 1200);
    }

    function clearOut() { output.innerHTML = ""; }

    function resetTurtle() {
      runner.turtleRec = { ops: [], bg: "", pend: null };   // fresh op recording for the thumbnail
      if (!runner.turtleCtx) return;
      const c = runner.turtleCtx;
      // Size this run's buffers up front, so nothing has to be resized (and
      // erased) once the drawing is under way.
      const L = sizeTurtleCanvas(c.canvas);
      c.clearRect(0, 0, L.w, L.h);
      opts.turtle.canvas.style.background = "";
      if (runner.spriteCtx) {
        const LS = sizeTurtleCanvas(runner.spriteCtx.canvas);
        runner.spriteCtx.clearRect(0, 0, LS.w, LS.h);
      }
    }

    async function run() {
      if (running) { stop(); return; }
      running = true;
      finalized = false;
      if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
      try { window.PWL = window.PWL || {}; window.PWL.runningCode = getCode(); } catch (e) {}
      active = runner;
      stopRequested = false;
      pendingReject = null;
      clearOut();
      resetTurtle();
      // A fresh run starts windowed; restarts (game_over retry) keep fullscreen.
      setGameFullscreen(null, false);
      setRunMode(pyodide ? "busy" : "loading");
      if (opts.onRunStart) opts.onRunStart();
      try {
        const py = await ensurePyodide();
        setRunMode("busy");
        // A game can ask to restart itself (game_over(retry=True)); re-run the
        // whole program each time it does, until it ends normally or is stopped.
        do {
          gameRestart = false;
          // Fresh turtle/game state every run, so re-running behaves like
          // running a .py file from scratch.
          await py.runPythonAsync(
            "import sys\n" +
            "if 'turtle' in sys.modules:\n" +
            "    sys.modules['turtle']._reset_all()\n" +
            "if 'game' in sys.modules:\n" +
            "    sys.modules['game']._reset_all()\n" +
            "if 'game3d' in sys.modules:\n" +
            "    sys.modules['game3d']._reset_all()\n"
          );
          resetTurtle();
          // Run in a FRESH namespace each time, so variables from a previous
          // run can't linger and produce "ghost" results after the code has
          // changed. Without this, a value set last run (e.g. age) is still
          // there this run if the new code reads it before assigning it.
          const ns = py.runPython("dict(__name__='__main__')");
          try {
            await py.runPythonAsync(getCode(), { globals: ns });
          } finally {
            ns.destroy();
          }
        } while (gameRestart && !stopRequested);
      } catch (err) {
        const msg = (err && err.message) ? String(err.message) : String(err);
        if (/Stopped by user|KeyboardInterrupt/.test(msg)) {
          runner.appendOut("[stopped]", "info");
        } else {
          runner.appendOut(msg, "stderr");
        }
      } finally {
        finalizeRun();
      }
    }

    // ---- Non-JSPI path: same run()/stop() surface, backed by the worker ----
    const useWorker = useWorkerRuntime();
    async function runWorker() {
      if (running) { stopWorker(); return; }
      if (typeof SharedArrayBuffer === "undefined" || !window.crossOriginIsolated) {
        runner.appendOut("Getting this browser ready for turtle & games… if nothing happens, reload the page.", "info");
        return;
      }
      running = true;
      active = runner;
      try { window.PWL = window.PWL || {}; window.PWL.runningCode = getCode(); } catch (e) {}
      stopRequested = false;
      clearOut();
      resetTurtle();
      // A fresh run starts windowed; restarts (game_over retry) keep fullscreen.
      setGameFullscreen(null, false);
      setRunMode(sharedWorker ? "busy" : "loading");
      if (opts.onRunStart) opts.onRunStart();
      workerFinalize = function () {
        running = false; stopRequested = false;
        try { setGameFullscreen(null, false); } catch (e) {}
        try { stopAllTones(); } catch (e) {}
        try { captureTurtleScene(runner); } catch (e) {}
        setRunMode("idle");
        if (opts.onRunEnd) opts.onRunEnd();
      };
      try {
        await ensureWorker();
        if (active !== runner) return;   // superseded while Pyodide loaded
        setRunMode("busy");
        const c = workerMem.ctrl, K = window.PRProto.CTRL;
        Atomics.store(c, K.STOP, 0);
        Atomics.store(c, K.PLAYING, 1);
        workerMem.interruptView[0] = 0;
        zeroInputState();
        // Seed the worker with this program's saved values before it runs, so
        // game.load() can read them (the worker can't reach localStorage itself).
        sharedWorker.postMessage({ type: "saveSnapshot", data: GAME_IO.saveSnapshot() });
        sharedWorker.postMessage({ type: "run", code: getCode() });
      } catch (err) {
        runner.appendOut(String(err && err.message || err), "stderr");
        if (workerFinalize) { const f = workerFinalize; workerFinalize = null; f(); }
      }
    }
    function stopWorker() {
      if (!running || !workerMem) return;
      stopRequested = true;
      const c = workerMem.ctrl, K = window.PRProto.CTRL;
      Atomics.store(c, K.STOP, 1);
      Atomics.store(c, K.PLAYING, 0);
      workerMem.interruptView[0] = 2;    // Pyodide SIGINT at the next Python opcode
      Atomics.add(c, K.SLEEP, 1); Atomics.notify(c, K.SLEEP);   // wake a frame sleep
      Atomics.add(c, K.INPUT, 1); Atomics.notify(c, K.INPUT);   // wake an input wait
    }
    function runDispatch() { return useWorker ? runWorker() : run(); }
    function stopDispatch() { return useWorker ? stopWorker() : stop(); }

    // Prism wraps every token in a <span>, so a big program becomes thousands of
    // DOM nodes; re-tokenising the whole thing on each change (and the browser
    // mutating that many nodes on a big paste or Ctrl+A-delete) is what stalls.
    // Past this size we keep the editor as one plain-text node: no colour, but
    // instant to type in, paste into and clear.
    const HIGHLIGHT_LIMIT = 20000;
    function enableHighlighting(CodeJar) {
      jar = CodeJar(editor, function (el) {
        if ((el.textContent || "").length > HIGHLIGHT_LIMIT) { el.textContent = el.textContent; return; }
        window.Prism.highlightElement(el);
      }, {
        tab: "    ",
        indentOn: /[(\[{:]\s*$/
      });
      jar.updateCode(loadSaved());
      jar.onUpdate(function (code) { saveCode(code); });
    }

    function enablePlainEditor() {
      editor.contentEditable = "plaintext-only";
      editor.textContent = loadSaved();
      editor.addEventListener("input", function () { saveCode(); });
    }

    function initEditor() {
      editor.textContent = loadSaved();
      if (!window.Prism) {
        enablePlainEditor();
        return;
      }
      import(CODEJAR_URL)
        .then(function (mod) {
          if (mod && typeof mod.CodeJar === "function") enableHighlighting(mod.CodeJar);
          else enablePlainEditor();
        })
        .catch(function () { enablePlainEditor(); });
    }

    editor.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runDispatch();
      }
    });
    if (runBtn) runBtn.addEventListener("click", runDispatch);

    initEditor();

    return {
      run: runDispatch,
      stop: stopDispatch,
      getCode: getCode,
      setCode: setCode,
      reloadSaved: function () { setCode(loadSaved()); },
      clearOutput: clearOut,
      isRunning: function () { return running && active === runner; },
      // Stop the program and resolve once its run has fully unwound, i.e. the
      // finally block has run (turtle drawing captured, game frozen on its last
      // frame, keyboard capture released). Resolves immediately if idle. Used by
      // the Share flow so a snapshot is taken from a stopped, stable program.
      stopAndWait: function () {
        return new Promise(function (resolve) {
          if (!(running && active === runner)) { resolve(); return; }
          stopDispatch();
          let n = 0;
          (function poll() {
            if (!(running && active === runner) || n++ > 150) resolve();
            else setTimeout(poll, 8);
          })();
        });
      }
    };
  }

  window.PyRun = { create: create, jspiSupported: jspiSupported };
})();
