"""A small, fast `game` module for the Brython lab.

It mirrors the parts of PyWebLib's `import game` that most programs use, so a
game written for the main site runs here unchanged. The point is speed, so:

* touches() on unrotated sprites is a plain box test (two subtractions and
  two comparisons) instead of the rotated-box maths. That one change is worth
  ~25x on a game that checks hundreds of blocks a frame, in ANY runtime.
* frame() makes ONE call into JavaScript with a flat list of numbers and
  strings. No dict per sprite and no JSON.
* Sprites are re-sorted by layer only when something was added, removed or
  re-layered, not every frame.
* remove() is O(1): the sprite is flagged and swept out on the next frame,
  so clearing a 300-block world doesn't cost 300 list scans.
"""
from browser import self as _g
import math as _math

_io = _g.pwl

W = {"w": 480, "h": 360, "bg": "#0b1020", "clicks": 0, "score": 0,
     "dirty": True, "dead": False, "over": None}
_sprites = []
_order = []

BOX, CIRCLE, LABEL, TEXT = 0, 1, 2, 3


class Sprite:
    def __init__(self, kind, x, y, w, h, color="#ffffff", text="", size=20,
                 background=None, layer=0, radius=0):
        self.kind = kind
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.color = color
        self._text = str(text)
        self._size = size
        self.background = background
        self._layer = layer
        self.radius = radius
        self.angle = 0
        self.visible = True
        self._alive = True
        _sprites.append(self)
        W["dirty"] = True
        if kind == LABEL:
            self._fit_label()

    # Draw order. Higher layers draw on top; changing it re-sorts once.
    @property
    def layer(self):
        return self._layer

    @layer.setter
    def layer(self, value):
        self._layer = value
        W["dirty"] = True

    z = layer

    @property
    def content(self):
        return self._text

    @content.setter
    def content(self, value):
        value = str(value)
        if value != self._text:
            self._text = value
            if self.kind == LABEL:
                self._fit_label()

    text = content

    @property
    def size(self):
        return self._size

    @size.setter
    def size(self, value):
        self._size = value
        if self.kind == LABEL:
            self._fit_label()
        elif self.kind == TEXT:
            self.w = self.h = value * 0.8

    def _fit_label(self):
        # A label's hit box is its text, so a label works as a button.
        self.w = float(_io.measure(self._text, self._size)) + 12
        self.h = self._size * 1.3

    def touches(self, other):
        # The fast path: neither sprite is rotated, so the boxes are axis
        # aligned. Edges that just meet count as touching, exactly like the
        # main site's game module.
        if self.angle or other.angle:
            return _rotated_overlap(self, other)
        dx = self.x - other.x
        if dx < 0:
            dx = -dx
        if dx + dx > self.w + other.w:
            return False
        dy = self.y - other.y
        if dy < 0:
            dy = -dy
        return dy + dy <= self.h + other.h

    def touching(self, others):
        # The first sprite in `others` this one touches, or None. One call
        # instead of a loop when you only need to know "am I hitting a wall".
        for o in others:
            if self.touches(o):
                return o
        return None

    def at_mouse(self):
        dx = _io.mouseX() - self.x
        dy = _io.mouseY() - self.y
        return abs(dx) * 2 <= self.w and abs(dy) * 2 <= self.h

    def hide(self):
        self.visible = False

    def show(self):
        self.visible = True

    def remove(self):
        if self._alive:
            self._alive = False
            self.visible = False
            W["dead"] = True


def _rotated_overlap(a, b):
    # Separating axis test for two rotated boxes (rare, so kept simple).
    def axes(s):
        r = s.angle * _math.pi / 180.0
        return (_math.cos(r), _math.sin(r)), (-_math.sin(r), _math.cos(r))
    au, av = axes(a)
    bu, bv = axes(b)
    dx, dy = b.x - a.x, b.y - a.y
    for lx, ly in (au, av, bu, bv):
        ra = a.w / 2 * abs(au[0] * lx + au[1] * ly) + a.h / 2 * abs(av[0] * lx + av[1] * ly)
        rb = b.w / 2 * abs(bu[0] * lx + bu[1] * ly) + b.h / 2 * abs(bv[0] * lx + bv[1] * ly)
        if abs(dx * lx + dy * ly) > ra + rb:
            return False
    return True


def _layer_of(s):
    return s._layer


# ---- making things -------------------------------------------------------
def window(width=480, height=360, background=None):
    W["w"] = int(width)
    W["h"] = int(height)
    if background is not None:
        W["bg"] = str(background)
    _io.setup(W["w"], W["h"])


def background(color):
    W["bg"] = str(color)


def box(x, y, w, h, color="#ffffff", radius=0):
    return Sprite(BOX, x, y, w, h, color, radius=radius)


def circle(x, y, w, h=None, color="#ffffff"):
    return Sprite(CIRCLE, x, y, w, w if h is None else h, color)


def label(message, x, y, size=20, color="#ffffff", background=None):
    return Sprite(LABEL, x, y, 0, 0, color, text=message, size=size,
                  background=background, layer=1000)


def sprite(skin, x=None, y=None, size=40):
    # Emoji or any text as a sprite (the drawn art skins live on the main site).
    cx = W["w"] // 2 if x is None else x
    cy = W["h"] // 2 if y is None else y
    return Sprite(TEXT, cx, cy, size * 0.8, size * 0.8, "#ffffff",
                  text=skin, size=size)


# ---- input ---------------------------------------------------------------
def pressed(key):
    return bool(_io.pressed(key))


def mouse_x():
    return _io.mouseX()


def mouse_y():
    return _io.mouseY()


def mouse_down():
    return bool(_io.mouseDown())


def mouse_in():
    return bool(_io.mouseIn())


def clicked():
    # True once per click, then False until the next one.
    cur = _io.clicks()
    if cur != W["clicks"]:
        W["clicks"] = cur
        return True
    return False


# ---- the loop ------------------------------------------------------------
def playing():
    return bool(_io.playing()) and W["over"] is None


def score(points=None):
    if points is not None:
        W["score"] += int(points)
    return W["score"]


def _scene():
    global _sprites
    if W["dead"]:
        _sprites = [s for s in _sprites if s._alive]
        W["dead"] = False
        W["dirty"] = True
    if W["dirty"]:
        _order[:] = sorted(_sprites, key=_layer_of)
        W["dirty"] = False
    flat = []
    add = flat.extend
    for s in _order:
        if s.visible:
            # `or ""`: Brython hands None to JavaScript as a (truthy) object.
            add((s.kind, s.x, s.y, s.w, s.h, s.color, s._text,
                 s.background or "", s._size, s.radius))
    return flat


def frame(fps=30):
    _io.frame(_scene(), W["bg"], fps)


def game_over(message="Game Over"):
    label(message, W["w"] / 2, W["h"] / 2, size=32, color="#ffffff",
          background="#000000aa").layer = 2000
    _io.frame(_scene(), W["bg"], 30)
    W["over"] = str(message)


def stop():
    W["over"] = ""
