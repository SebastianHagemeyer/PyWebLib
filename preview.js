/*
 * PyWebLib community preview renderer.
 *
 * Paints a static "poster" of a shared program straight from its CODE, with no
 * Python and no stored images. It parses the literal setup calls that run before
 * the game loop (game.window / sprite / box / label) and draws that opening
 * scene onto a small canvas, using the shared sprite art from sprites.js.
 *
 * Best-effort by design: only literal, top-level calls are drawn (a sprite made
 * inside a loop or with random coordinates is skipped). turtle and plain-Python
 * programs get a themed placeholder instead. window.PWL.preview.renderInto(...).
 */
(function () {
  "use strict";
  const PWL = (window.PWL = window.PWL || {});

  const NAMES = window.PWL_SPRITE_NAMES || [];
  const SVGS = window.PWL_SPRITES || [];
  const IMAGES = SVGS.map(function (svg) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    return img;
  });
  function spriteImage(skin) {
    if (/^\d+$/.test(skin)) return IMAGES[parseInt(skin, 10)] || null;
    const i = NAMES.indexOf(skin);
    return i >= 0 ? IMAGES[i] : null;
  }

  function detectKind(code) {
    if (/(^|\n)\s*(import\s+game|from\s+game\s+import)/.test(code)) return "game";
    if (/(^|\n)\s*(import\s+turtle|from\s+turtle\s+import)/.test(code)) return "turtle";
    return "python";
  }

  // Only the part before "while game.playing():" is the opening scene.
  function setupPart(code) {
    const i = code.search(/\n\s*while\s+game\.playing\s*\(\s*\)/);
    return i === -1 ? code : code.slice(0, i);
  }

  function parseScene(code) {
    const setup = setupPart(code);
    const scene = { w: 480, h: 360, bg: "#0b1020", items: [] };
    let m;

    const win = setup.match(/game\.window\(\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*background\s*=\s*["']([^"']+)["'])?/);
    if (win) { scene.w = +win[1]; scene.h = +win[2]; if (win[3]) scene.bg = win[3]; }
    const bg = setup.match(/game\.background\(\s*["']([^"']+)["']/);
    if (bg) scene.bg = bg[1];

    const calls = [];
    const spriteRe = /game\.sprite\(\s*("([^"]*)"|'([^']*)'|(\d+))\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*size\s*=\s*(\d+))?/g;
    while ((m = spriteRe.exec(setup))) {
      const skin = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
      calls.push({ i: m.index, kind: "sprite", skin: skin, x: +m[5], y: +m[6], size: m[7] ? +m[7] : 40 });
    }
    const boxRe = /game\.box\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*["']([^"']+)["']/g;
    while ((m = boxRe.exec(setup))) {
      calls.push({ i: m.index, kind: "box", x: +m[1], y: +m[2], w: +m[3], h: +m[4], color: m[5] });
    }
    const labelRe = /game\.label\(\s*["']([^"']*)["']\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*size\s*=\s*(\d+))?(?:[^)]*?color\s*=\s*["']([^"']+)["'])?/g;
    while ((m = labelRe.exec(setup))) {
      calls.push({ i: m.index, kind: "label", text: m[1], x: +m[2], y: +m[3], size: m[4] ? +m[4] : 20, color: m[5] || "#ffffff" });
    }
    calls.sort(function (a, b) { return a.i - b.i; });
    scene.items = calls;
    return scene;
  }

  function drawGame(code, canvas) {
    const scene = parseScene(code);
    const ctx = canvas.getContext("2d");
    const CW = canvas.width, CH = canvas.height;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = scene.bg || "#0b1020";
    ctx.fillRect(0, 0, CW, CH);

    const scale = Math.min(CW / scene.w, CH / scene.h);
    const ox = (CW - scene.w * scale) / 2, oy = (CH - scene.h * scale) / 2;
    function X(x) { return ox + x * scale; }
    function Y(y) { return oy + y * scale; }

    let drew = 0;
    scene.items.forEach(function (it) {
      if (it.kind === "box") {
        ctx.fillStyle = it.color || "#fff";
        ctx.fillRect(X(it.x - it.w / 2), Y(it.y - it.h / 2), it.w * scale, it.h * scale);
        drew++;
      } else if (it.kind === "sprite") {
        const img = spriteImage(it.skin);
        const sz = it.size * scale;
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, X(it.x) - sz / 2, Y(it.y) - sz / 2, sz, sz);
        } else {
          ctx.font = sz + "px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(it.skin, X(it.x), Y(it.y));
        }
        drew++;
      } else if (it.kind === "label") {
        ctx.fillStyle = it.color || "#fff";
        ctx.font = "bold " + (it.size * scale) + "px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(it.text, X(it.x), Y(it.y));
        drew++;
      }
    });
    return drew;
  }

  function drawPlaceholder(kind, canvas) {
    const ctx = canvas.getContext("2d");
    const CW = canvas.width, CH = canvas.height;
    const g = ctx.createLinearGradient(0, 0, CW, CH);
    if (kind === "turtle") { g.addColorStop(0, "#12463a"); g.addColorStop(1, "#0b2a20"); }
    else { g.addColorStop(0, "#242a4a"); g.addColorStop(1, "#0f1226"); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(kind === "turtle" ? "turtle drawing" : "Python program", CW / 2, CH / 2);
  }

  function renderInto(canvas, code) {
    const kind = detectKind(code);
    if (kind === "game") {
      const drew = drawGame(code, canvas);
      if (drew === 0) { drawPlaceholder("python", canvas); }
      else {
        // Sprite SVGs may still be decoding on the first paint: redraw once.
        setTimeout(function () { try { drawGame(code, canvas); } catch (e) {} }, 150);
      }
    } else {
      drawPlaceholder(kind, canvas);
    }
    return kind;
  }

  PWL.preview = { renderInto: renderInto, detectKind: detectKind };
})();
