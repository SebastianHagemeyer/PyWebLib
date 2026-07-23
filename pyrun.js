/*
 * PyRun: a reusable in-browser Python runner for PyPlayground.
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
         "debug": False, "clicks": 0}
    _sprites = []

    class Sprite:
        def __init__(self, kind, **kw):
            self.kind = kind
            self.x = kw.get("x", 0)
            self.y = kw.get("y", 0)
            self.size = kw.get("size", 40)
            self.w = kw.get("w", self.size)
            self.h = kw.get("h", self.size)
            self.art = kw.get("art", -1)
            self._display = kw.get("display", "")
            self._content = kw.get("content", self._display)
            self._resolvable = kw.get("resolvable", False)
            self.color = kw.get("color", "#ffffff")
            self.background = kw.get("background", None)
            self.angle = kw.get("angle", 0)
            self.scale_x = kw.get("scale_x", 1)
            self.scale_y = kw.get("scale_y", 1)
            # Higher layer draws on top. Sprites on the same layer keep the
            # order they were made in. Labels default high so a scoreboard
            # sits above the action.
            self.layer = kw.get("layer", 0)
            # A custom collision box (width, height), or None to auto-size it
            # from the art. Set it with sprite.hitbox = (w, h).
            self._hitbox = kw.get("hitbox", None)
            self.visible = True
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
            else:
                self._display = str(value)

        # .text is the old name for .content, kept so older code still runs.
        @property
        def text(self):
            return self._content

        @text.setter
        def text(self, value):
            self.content = value

        def _hit_wh(self):
            # The unrotated width and height of the collision box, before angle.
            if self._hitbox is not None:
                w, h = self._hitbox
            elif self.kind == "box":
                w, h = self.w, self.h
            elif self.kind == "art":
                wf, hf = _HIT_ASPECT.get(self.art, (0.8, 0.8))
                w, h = self.size * wf, self.size * hf
            else:
                # emoji/text: a slightly-smaller-than-size box feels fair.
                w, h = self.size * 0.8, self.size * 0.8
            return w * abs(self.scale_x), h * abs(self.scale_y)

        def _obb(self):
            # Oriented box for collisions: centre, half-sizes, angle (radians).
            w, h = self._hit_wh()
            return (self.x, self.y, w / 2.0, h / 2.0,
                    self.angle * math.pi / 180.0)

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
                  "shocked", "calm", "turtle", "car"]

    # Default collision-box shape per art (width, height as a fraction of size),
    # so a wide car gets a wide box and a tall egg a tall one. Anything not
    # listed falls back to a near-square box. Override any sprite with .hitbox.
    _HIT_ASPECT = {
        3: (0.60, 0.80),   # egg: taller than wide
        8: (0.84, 0.68),   # turtle: a bit wide
        9: (0.84, 0.50),   # car: wide and low
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

    def sprite(skin, x=None, y=None, size=40):
        cx = W["w"] // 2 if x is None else x
        cy = W["h"] // 2 if y is None else y
        kind, art, display = _resolve_skin(skin)
        return Sprite(kind, art=art, display=display, content=skin,
                      resolvable=True, size=size, x=cx, y=cy)

    def box(x, y, w, h, color="#ffffff"):
        return Sprite("box", x=x, y=y, w=w, h=h, color=color)

    def label(message, x, y, size=20, color="#ffffff", background=None):
        # color is the text colour; background (optional) draws a filled box
        # behind the text so it stays readable on any scene, e.g.
        #   game.label("Score: 0", 80, 24, color="#ffffff", background="#000000")
        return Sprite("text", display=str(message), content=message,
                      x=x, y=y, size=size, color=color, background=background,
                      layer=1000)

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

    def _draw(banner=None):
        arr = []
        # Draw low layers first so high layers land on top. sorted() is stable,
        # so sprites sharing a layer keep the order they were created in.
        for s in sorted(_sprites, key=lambda s: s.layer):
            if not s.visible:
                continue
            # hbw/hbh/hba are the collision box touches() actually uses (size
            # and rotation), so debug mode outlines exactly what overlaps.
            hbw, hbh = s._hit_wh()
            arr.append({"kind": s.kind, "x": s.x, "y": s.y, "size": s.size,
                        "w": s.w, "h": s.h, "text": str(s._display), "color": s.color,
                        "art": s.art, "angle": s.angle,
                        "sx": s.scale_x, "sy": s.scale_y, "back": s.background,
                        "hbw": hbw, "hbh": hbh, "hba": s.angle})
        # Once the game is over the banner is sticky: every later redraw (like
        # the frame() at the end of the loop) keeps showing it instead of
        # painting over it.
        shown = banner if banner is not None else W["over"]
        _io.draw(json.dumps({"w": W["w"], "h": W["h"], "bg": W["bg"],
                             "sprites": arr, "banner": shown,
                             "debug": W["debug"]}))

    def frame(fps=30):
        _draw()
        if _jspi:
            run_sync(_io.nextFrame(1.0 / max(1, int(fps))))

    def game_over(message="Game Over"):
        W["over"] = str(message)
        _draw()
        _io.stop()

    def _reset_all():
        _sprites.clear()
        W.update(w=480, h=360, bg="#0b1020", score=0, over=None, debug=False,
                 clicks=0)
        _io.reset()

    mod = types.ModuleType("game")
    mod.window = window
    mod.background = background
    mod.sprite = sprite
    mod.box = box
    mod.label = label
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
    mod.debug = debug
    mod.Sprite = Sprite
    mod._reset_all = _reset_all
    sys.modules["game"] = mod

_pyrun_install_game()
del _pyrun_install_game
`;

  // ---- JS side of the game: canvas drawing + keyboard, dispatched to active -
  let gameKeys = {};
  let gamePlaying = true;

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
    if (!gameActive()) return;
    const n = gameKeyName(e);
    gameKeys[n] = true;
    if (GAME_KEYS_TO_EAT[n]) e.preventDefault();
  });
  window.addEventListener("keyup", function (e) {
    if (!gameActive()) return;
    gameKeys[gameKeyName(e)] = false;
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
    gameMouse.x = (e.clientX - r.left) * (cv.width / r.width);
    gameMouse.y = (e.clientY - r.top) * (cv.height / r.height);
    gameMouse.inside = e.clientX >= r.left && e.clientX < r.right &&
                       e.clientY >= r.top && e.clientY < r.bottom;
  }
  window.addEventListener("pointermove", gameMouseTrack);
  window.addEventListener("pointerdown", function (e) {
    gameMouseTrack(e);
    if (!gameActive() || !gameMouse.inside) return;
    gameMouse.down = true;
    gameMouse.clicks += 1;
  });
  window.addEventListener("pointerup", function () { gameMouse.down = false; });

  // ---- Built-in themed sprite art (a house style instead of only emoji) -----
  // Flat SVGs so they stay crisp at any size and spin/mirror with the sprite.
  // Order must match _ART_NAMES in the Python game module: chicken, dog, bird,
  // egg, coin. game.sprite(0) draws the first, and so on.
  const SPRITE_SVGS = [
    // 0: chicken (faces right)
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<path d="M20 41 q-10 0 -6 11 q7 -4 12 -5z" fill="#e6dcc2"/>' +
      '<ellipse cx="30" cy="42" rx="17" ry="15" fill="#f4efe0"/>' +
      '<circle cx="41" cy="26" r="11" fill="#fbf7ec"/>' +
      '<path d="M35 15 q2 -6 5 -1 q3 -6 6 0 q3 -5 4 3 q-9 3 -15 0z" fill="#e23b3b"/>' +
      '<path d="M51 25 l9 2 l-9 3z" fill="#f6a623"/>' +
      '<circle cx="44" cy="24" r="2.3" fill="#20242e"/>' +
      '<path d="M26 56 v6 M36 56 v6" stroke="#f6a623" stroke-width="3.4" stroke-linecap="round"/>' +
    '</svg>',
    // 1: dog (faces right)
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<path d="M12 44 q-6 2 -3 9" stroke="#c8894e" stroke-width="6" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="28" cy="46" rx="16" ry="12" fill="#c8894e"/>' +
      '<ellipse cx="34" cy="23" rx="5.5" ry="10" transform="rotate(24 34 23)" fill="#a56a34"/>' +
      '<ellipse cx="51" cy="23" rx="5.5" ry="10" transform="rotate(-24 51 23)" fill="#a56a34"/>' +
      '<circle cx="42" cy="32" r="13" fill="#d89a5b"/>' +
      '<ellipse cx="46" cy="38" rx="7.5" ry="6" fill="#f3ddc0"/>' +
      '<ellipse cx="50" cy="36" rx="2.6" ry="2.1" fill="#3b2a1d"/>' +
      '<circle cx="38" cy="30" r="2.3" fill="#20242e"/>' +
      '<circle cx="46" cy="30" r="2.3" fill="#20242e"/>' +
    '</svg>',
    // 2: bird (a yellow chick, faces right)
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<path d="M16 33 q-9 4 -3 13 q7 -5 11 -7z" fill="#e0a92e"/>' +
      '<ellipse cx="30" cy="34" rx="18" ry="15" fill="#f6c945"/>' +
      '<circle cx="42" cy="28" r="9" fill="#ffd75e"/>' +
      '<path d="M50 27 l9 1 l-9 3z" fill="#f2903a"/>' +
      '<circle cx="44" cy="26" r="2.1" fill="#20242e"/>' +
      '<path d="M30 48 v6 M37 48 v6" stroke="#f2903a" stroke-width="2.8" stroke-linecap="round"/>' +
    '</svg>',
    // 3: egg
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<path d="M32 7 C19 7 13 31 13 41 a19 20 0 0 0 38 0 C51 31 45 7 32 7 Z" fill="#f7f2e6"/>' +
      '<ellipse cx="25" cy="30" rx="5" ry="8" fill="#fffef8" opacity="0.7"/>' +
    '</svg>',
    // 4: coin
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="24" fill="#e0a92e"/>' +
      '<circle cx="32" cy="32" r="18" fill="#f6d066"/>' +
      '<path d="M32 18 l4.2 8.6 9.5 1.4 -6.9 6.7 1.6 9.4 -8.4 -4.4 -8.4 4.4 1.6 -9.4 -6.9 -6.7 9.5 -1.4z" fill="#e0a92e"/>' +
    '</svg>',
    // 5: basket (the weave is clipped to the body so it never pokes out)
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<defs><clipPath id="bkt"><path d="M14 25 h36 l-3.5 22 a5 5 0 0 1 -5 4 H22.5 a5 5 0 0 1 -5 -4 Z"/></clipPath></defs>' +
      '<path d="M19 24 a13 9 0 0 1 26 0" stroke="#a56a34" stroke-width="3.5" fill="none"/>' +
      '<path d="M14 25 h36 l-3.5 22 a5 5 0 0 1 -5 4 H22.5 a5 5 0 0 1 -5 -4 Z" fill="#c8894e"/>' +
      '<g clip-path="url(#bkt)" stroke="#9a6330" fill="none">' +
        '<path d="M12 33 h40 M12 40 h40 M12 47 h40" stroke-width="2"/>' +
        '<path d="M28 25 v30 M36 25 v30" stroke-width="1.6" opacity="0.5"/>' +
      '</g>' +
      '<rect x="11" y="22" width="42" height="7.5" rx="3.75" fill="#dca86a"/>' +
    '</svg>',
    // 6: shocked face
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="24" fill="#ffd35e"/>' +
      '<circle cx="24" cy="27" r="3.2" fill="#20242e"/>' +
      '<circle cx="40" cy="27" r="3.2" fill="#20242e"/>' +
      '<ellipse cx="32" cy="42" rx="6" ry="7.5" fill="#20242e"/>' +
    '</svg>',
    // 7: calm face
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="24" fill="#ffd35e"/>' +
      '<circle cx="24" cy="28" r="3.2" fill="#20242e"/>' +
      '<circle cx="40" cy="28" r="3.2" fill="#20242e"/>' +
      '<path d="M23 42 h18" stroke="#20242e" stroke-width="3.2" stroke-linecap="round"/>' +
    '</svg>',
    // 8: turtle (faces right)
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
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
      '<path d="M30 24 L30 18 M37 28 L43.5 24.5 M37 36 L43.5 39.5 M30 40 L30 46 M23 36 L16.5 39.5 M23 28 L16.5 24.5" stroke="#1f7a4a" stroke-width="1.5" fill="none"/>' +
    '</svg>',
    // 9: car (top-down, faces right)
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect x="17" y="16" width="9" height="6" rx="2" fill="#20242e"/>' +
      '<rect x="17" y="42" width="9" height="6" rx="2" fill="#20242e"/>' +
      '<rect x="38" y="16" width="9" height="6" rx="2" fill="#20242e"/>' +
      '<rect x="38" y="42" width="9" height="6" rx="2" fill="#20242e"/>' +
      '<rect x="11" y="21" width="43" height="22" rx="8" fill="#e2483d"/>' +
      '<path d="M33 24 h8 l6 8 -6 8 h-8 z" fill="#bfe0ff"/>' +
      '<rect x="18" y="26" width="13" height="12" rx="3" fill="#c33a30"/>' +
      '<circle cx="52" cy="27" r="1.9" fill="#fff0a6"/>' +
      '<circle cx="52" cy="37" r="1.9" fill="#fff0a6"/>' +
    '</svg>'
  ];
  const SPRITE_ART = SPRITE_SVGS.map(function (svg) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    return img;
  });

  const GAME_IO = {
    jspiOk: function () { return jspiSupported(); },
    playing: function () { return gamePlaying; },
    stop: function () { gamePlaying = false; },
    reset: function () {
      gameKeys = {};
      gamePlaying = true;
      gameMouse.down = false; gameMouse.clicks = 0;
      const c = gameCtx();
      if (c) {
        c.canvas.style.cursor = "";
        c.clearRect(0, 0, c.canvas.width, c.canvas.height);
      }
    },
    setup: function (w, h, bg) {
      gamePlaying = true;
      gameKeys = {};
      gameMouse.down = false; gameMouse.clicks = 0;
      const c = gameCtx();
      if (!c) return;
      c.canvas.width = Number(w) || 480;
      c.canvas.height = Number(h) || 360;
      c.canvas.style.background = String(bg || "#0b1020");
      c.canvas.style.cursor = "";
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
    draw: function (json) {
      const c = gameCtx();
      if (!c) return;
      let scene;
      try { scene = JSON.parse(json); } catch (e) { return; }
      const cv = c.canvas;
      c.clearRect(0, 0, cv.width, cv.height);
      c.fillStyle = scene.bg || "#0b1020";
      c.fillRect(0, 0, cv.width, cv.height);
      (scene.sprites || []).forEach(function (s) {
        // Angle (degrees) spins the sprite and scale_x / scale_y stretch or
        // mirror it, all about its own centre: move the canvas origin to the
        // sprite, rotate, scale, then draw at (0,0). scale -1 flips it.
        var ang = Number(s.angle) || 0;
        var sx = (s.sx == null || !isFinite(Number(s.sx))) ? 1 : Number(s.sx);
        var sy = (s.sy == null || !isFinite(Number(s.sy))) ? 1 : Number(s.sy);
        var moved = ang !== 0 || sx !== 1 || sy !== 1;
        if (moved) {
          c.save();
          c.translate(s.x, s.y);
          if (ang !== 0) c.rotate(ang * Math.PI / 180);
          if (sx !== 1 || sy !== 1) c.scale(sx, sy);
        }
        var dx = moved ? 0 : s.x, dy = moved ? 0 : s.y;
        if (s.kind === "box") {
          c.fillStyle = s.color || "#fff";
          c.fillRect(dx - s.w / 2, dy - s.h / 2, s.w, s.h);
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
          c.save();
          c.translate(s.x, s.y);
          if (a) c.rotate(a);
          c.strokeRect(-bw / 2, -bh / 2, bw, bh);
          c.restore();
        });
        c.restore();
      }
      if (scene.banner) {
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.fillRect(0, 0, cv.width, cv.height);
        c.fillStyle = "#ffffff";
        c.textAlign = "center";
        c.textBaseline = "middle";
        // Wrap the banner onto as many lines as it needs, and if a single word
        // is still too wide, shrink the text, so long messages never run off
        // the edges of the game window.
        var maxW = cv.width - 40;
        var size = 30;
        c.font = "bold " + size + "px system-ui, sans-serif";
        var words = String(scene.banner).split(" ");
        var lines = [];
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
        if (line) lines.push(line);
        var widest = 0;
        for (var li = 0; li < lines.length; li++) {
          widest = Math.max(widest, c.measureText(lines[li]).width);
        }
        if (widest > maxW) {
          size = Math.max(12, Math.floor(size * maxW / widest));
          c.font = "bold " + size + "px system-ui, sans-serif";
        }
        var lineH = size * 1.25;
        var startY = cv.height / 2 - (lines.length - 1) * lineH / 2;
        for (var k = 0; k < lines.length; k++) {
          c.fillText(lines[k], cv.width / 2, startY + k * lineH);
        }
      }
    }
  };

  // ---- JS side of the turtle: canvas drawing, dispatched to `active` ------

  function turtleCtx() {
    if (!active || !active.opts.turtle) return null;
    return active.turtleCtx;
  }
  function spriteCtx() {
    if (!active || !active.opts.turtle) return null;
    return active.spriteCtx;
  }
  // Turtle coords (origin centre, y up) to canvas pixels.
  function tx(c, x) { return c.canvas.width / 2 + x; }
  function ty(c, y) { return c.canvas.height / 2 - y; }

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
    },
    dot: function (x, y, size, color) {
      const c = turtleCtx();
      if (!c) return;
      c.fillStyle = String(color);
      c.beginPath();
      c.arc(tx(c, x), ty(c, y), Math.max(1, size / 2), 0, Math.PI * 2);
      c.fill();
    },
    text: function (x, y, text, color, size, align, fontName) {
      const c = turtleCtx();
      if (!c) return;
      c.fillStyle = String(color);
      c.font = "bold " + (Number(size) || 12) + "px " + (fontName || "Arial") + ", sans-serif";
      c.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
      c.textBaseline = "bottom";
      c.fillText(String(text), tx(c, x), ty(c, y));
    },
    bg: function (color) {
      if (!active || !active.opts.turtle) return;
      active.opts.turtle.canvas.style.background = String(color || "");
    },
    wipe: function () {
      const c = turtleCtx();
      if (!c) return;
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    },
    sprite: function (x, y, heading, visible) {
      const c = spriteCtx();
      if (!c) return;
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
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
      const useJspi = jspiSupported();
      await py.runPythonAsync(useJspi ? PY_INSTALL_INPUT : PY_DISABLE_INPUT);
      if (useJspi) await py.runPythonAsync(PY_PATCH_SLEEP);
      await py.runPythonAsync(PY_INSTALL_INTERRUPT);
      await py.runPythonAsync(PY_INSTALL_CLEAR);
      await py.runPythonAsync(PY_INSTALL_COLOR_PRINT);
      await py.runPythonAsync(PY_INSTALL_TURTLE);
      await py.runPythonAsync(PY_INSTALL_GAME);
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

    function stop() {
      if (!running) return;
      stopRequested = true;
      gamePlaying = false; // a game loop checking game.playing() exits cleanly
      if (pendingReject) {
        const r = pendingReject;
        pendingReject = null;
        r(new Error("Stopped by user"));
      }
    }

    function clearOut() { output.innerHTML = ""; }

    function resetTurtle() {
      if (!runner.turtleCtx) return;
      const c = runner.turtleCtx;
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
      opts.turtle.canvas.style.background = "";
      if (runner.spriteCtx) {
        runner.spriteCtx.clearRect(0, 0, runner.spriteCtx.canvas.width, runner.spriteCtx.canvas.height);
      }
    }

    async function run() {
      if (running) { stop(); return; }
      running = true;
      active = runner;
      stopRequested = false;
      pendingReject = null;
      clearOut();
      resetTurtle();
      setRunMode(pyodide ? "busy" : "loading");
      if (opts.onRunStart) opts.onRunStart();
      try {
        const py = await ensurePyodide();
        setRunMode("busy");
        // Fresh turtle/game state every run, so re-running behaves like
        // running a .py file from scratch.
        await py.runPythonAsync(
          "import sys\n" +
          "if 'turtle' in sys.modules:\n" +
          "    sys.modules['turtle']._reset_all()\n" +
          "if 'game' in sys.modules:\n" +
          "    sys.modules['game']._reset_all()\n"
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
      } catch (err) {
        const msg = (err && err.message) ? String(err.message) : String(err);
        if (/Stopped by user|KeyboardInterrupt/.test(msg)) {
          runner.appendOut("[stopped]", "info");
        } else {
          runner.appendOut(msg, "stderr");
        }
      } finally {
        running = false;
        stopRequested = false;
        pendingReject = null;
        setRunMode("idle");
        if (opts.onRunEnd) opts.onRunEnd();
      }
    }

    function enableHighlighting(CodeJar) {
      jar = CodeJar(editor, function (el) {
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
        run();
      }
    });
    if (runBtn) runBtn.addEventListener("click", run);

    initEditor();

    return {
      run: run,
      stop: stop,
      getCode: getCode,
      setCode: setCode,
      reloadSaved: function () { setCode(loadSaved()); },
      clearOutput: clearOut,
      isRunning: function () { return running && active === runner; }
    };
  }

  window.PyRun = { create: create, jspiSupported: jspiSupported };
})();
