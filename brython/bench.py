"""Raw Python speed, Brython vs Pyodide. bench.html runs this file in both.

A: the collision maths PyWebLib's game module uses today (rotated boxes).
B: the plain box test the Brython lab's game.py uses for unrotated sprites.
Both sweep 200 blocks twice for 4 movers, the shape of a platformer frame.
"""
import math, time

# --- A: the collision maths PyWebLib's game module does today (OBB / SAT) ---
class SlowSprite:
    def __init__(self, x, y, w, h):
        self.x = x; self.y = y; self.w = w; self.h = h
        self.angle = 0; self.scale_x = 1; self.scale_y = 1
        self.anchor = (0.5, 0.5); self._hitbox = None; self.kind = "box"
    def _draw_wh(self):
        return self.w, self.h
    def _hit_wh(self):
        w, h = self.w, self.h
        return w * abs(self.scale_x), h * abs(self.scale_y)
    def _local_offset(self):
        ax, ay = self.anchor
        dw, dh = self._draw_wh()
        return ((0.5 - ax) * dw, (0.5 - ay) * dh)
    def _hit_centre(self):
        lx, ly = self._local_offset()
        lx *= self.scale_x; ly *= self.scale_y
        a = self.angle * math.pi / 180.0
        ca, sa = math.cos(a), math.sin(a)
        return (self.x + lx * ca - ly * sa, self.y + lx * sa + ly * ca)
    def _obb(self):
        w, h = self._hit_wh()
        cx, cy = self._hit_centre()
        return (cx, cy, w / 2.0, h / 2.0, self.angle * math.pi / 180.0)
    def touches(self, other):
        return _obb_overlap(self._obb(), other._obb())

def _obb_overlap(a, b):
    ax, ay, ahw, ahh, aa = a
    bx, by, bhw, bhh, ba = b
    aux, auy = math.cos(aa), math.sin(aa)
    avx, avy = -math.sin(aa), math.cos(aa)
    bux, buy = math.cos(ba), math.sin(ba)
    bvx, bvy = -math.sin(ba), math.cos(ba)
    dx, dy = bx - ax, by - ay
    for lx, ly in ((aux, auy), (avx, avy), (bux, buy), (bvx, bvy)):
        ra = ahw * abs(aux * lx + auy * ly) + ahh * abs(avx * lx + avy * ly)
        rb = bhw * abs(bux * lx + buy * ly) + bhh * abs(bvx * lx + bvy * ly)
        if abs(dx * lx + dy * ly) > ra + rb:
            return False
    return True

# --- B: plain axis-aligned boxes take a two-line fast path ---
class FastSprite:
    def __init__(self, x, y, w, h):
        self.x = x; self.y = y; self.w = w; self.h = h
    def touches(self, o):
        return (abs(self.x - o.x) * 2 < self.w + o.w and
                abs(self.y - o.y) * 2 < self.h + o.h)

def world(cls):
    blocks = [cls(x * 24 + 12, y * 24 + 12, 24, 24) for x in range(20) for y in range(5, 15)]
    movers = [cls(100, 50, 16, 24)] + [cls(50 + i * 100, 50, 18, 14) for i in range(3)]
    return blocks, movers

def one_frame(blocks, movers):
    # The shape of the user's loop: each mover sweeps every block twice.
    n = 0
    for m in movers:
        for b in blocks:
            if m.touches(b): n += 1
        for b in blocks:
            if m.touches(b): n += 1
    return n

def run(cls, frames=60):
    blocks, movers = world(cls)
    one_frame(blocks, movers)            # warm-up
    t = time.perf_counter()
    for _ in range(frames):
        one_frame(blocks, movers)
    return (time.perf_counter() - t) * 1000.0 / frames

def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

def run_fib():
    t = time.perf_counter(); fib(22); return (time.perf_counter() - t) * 1000.0

RESULT = {"obb_ms_per_frame": run(SlowSprite), "aabb_ms_per_frame": run(FastSprite), "fib22_ms": run_fib()}
