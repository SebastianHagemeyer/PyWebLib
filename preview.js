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

  // ---- Custom assets: game.sprite(id, asset=True). Their SVG already lives in
  // the Supabase `assets` table, so we fetch that text once (no stored images)
  // and cache it as an Image, exactly like the game runtime. The cache is shared
  // across every card, so one asset id is fetched a single time no matter how
  // many previews use it. onReady repaints the card once the SVG arrives. ----
  const ASSET_IMG = {};     // "id" -> Image (null while it loads)
  const ASSET_RATIO = {};   // "id" -> width / height from the viewBox (default 1)
  const ASSET_WAIT = {};    // "id" -> callbacks waiting for the load
  // Shared localStorage cache (a few days), same keys as the game runtime, so a
  // fetched sprite is reused across cards, sessions and the game itself instead
  // of re-reading Supabase every time.
  const assetCache = PWL.assetSvgCache || (PWL.assetSvgCache = (function () {
    var TTL = 3 * 24 * 3600 * 1000, PREFIX = "pwl-asset:";
    function get(id) {
      try {
        var raw = localStorage.getItem(PREFIX + id);
        if (!raw) return null;
        var o = JSON.parse(raw);
        if (!o || typeof o.svg !== "string" || (Date.now() - (o.ts || 0)) > TTL) { localStorage.removeItem(PREFIX + id); return null; }
        return o.svg;
      } catch (e) { return null; }
    }
    function put(id, svg) {
      var rec = JSON.stringify({ svg: svg, ts: Date.now() });
      try { localStorage.setItem(PREFIX + id, rec); }
      catch (e) {
        try {
          for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) localStorage.removeItem(k); }
          localStorage.setItem(PREFIX + id, rec);
        } catch (e2) {}
      }
    }
    return { get: get, put: put };
  })());
  function assetSvgRatio(svg) {
    const m = /viewBox\s*=\s*["']?\s*[-\d.eE]+[ ,]+[-\d.eE]+[ ,]+([-\d.eE]+)[ ,]+([-\d.eE]+)/.exec(svg || "");
    if (m) { const w = parseFloat(m[1]), h = parseFloat(m[2]); if (w > 0 && h > 0) return w / h; }
    return 1;
  }
  function buildAssetImg(key, svg) {
    ASSET_RATIO[key] = assetSvgRatio(svg);
    const img = new Image();
    img.onload = function () {
      const cbs = ASSET_WAIT[key] || []; ASSET_WAIT[key] = [];
      cbs.forEach(function (cb) { try { cb(); } catch (e) {} });
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    ASSET_IMG[key] = img;
    return img;
  }
  function assetImage(id, onReady) {
    const key = String(id);
    if (key in ASSET_IMG) {
      const cached = ASSET_IMG[key];
      if (cached && cached.complete && cached.naturalWidth) return cached;
      if (onReady) (ASSET_WAIT[key] = ASSET_WAIT[key] || []).push(onReady);
      return null;
    }
    ASSET_IMG[key] = null;   // mark in-flight so we fetch only once
    if (onReady) (ASSET_WAIT[key] = ASSET_WAIT[key] || []).push(onReady);
    const hit = assetCache && assetCache.get(key);
    if (hit) {   // served from localStorage, no DB read
      const img = buildAssetImg(key, hit);
      return (img.complete && img.naturalWidth) ? img : null;
    }
    const sb = PWL.supabase;
    if (!sb) return null;
    try {
      sb.from("assets").select("svg").eq("id", key).single().then(function (r) {
        if (r && r.data && r.data.svg) { if (assetCache) assetCache.put(key, r.data.svg); buildAssetImg(key, r.data.svg); }
      }, function () {});
    } catch (e) {}
    return null;
  }
  // Coalesce several asset loads on one card into a single repaint.
  function scheduleRerender(scene, canvas) {
    if (canvas.__pwlPending) return;
    canvas.__pwlPending = true;
    setTimeout(function () { canvas.__pwlPending = false; try { renderScene(scene, canvas); } catch (e) {} }, 30);
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
      // Skip custom assets (asset=True): the number is an asset id, not a
      // built-in skin, and their real spot comes from the saved scene.
      const close = setup.indexOf(")", m.index);
      if (close !== -1 && /\basset\s*=\s*True\b/.test(setup.slice(m.index, close + 1))) continue;
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

    // Same window clip as renderScene: keep off-window items out of the bg bleed.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, scene.w * scale, scene.h * scale);
    ctx.clip();

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
    ctx.restore();   // release the window clip
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

  // ---- Code thumbnail: the first lines of a program, syntax-highlighted onto
  // the canvas, so a program with no visual output shows real code instead of a
  // blank placeholder. A tiny self-contained Python tokenizer keeps this
  // dependency-free (no Prism needed on the gallery pages). Colours mirror the
  // editor theme in styles.css.
  const CODE_BG = "#0f1226";
  const CODE_COL = {
    kw: "#c792ea", str: "#c3e88d", num: "#f78c6c", com: "#8b92b0",
    op: "#89ddff", fn: "#82aaff", dec: "#ffcb6b", txt: "#e6e7ef", gutter: "#4a5378"
  };
  const PY_KW = {};
  ("def class return if elif else for while break continue pass import from as in is not and " +
   "or None True False try except finally raise with lambda yield global nonlocal del assert " +
   "async await match case").split(" ").forEach(function (w) { PY_KW[w] = 1; });
  const PY_BI = {};
  ("print range len int str float bool list dict set tuple input abs min max sum sorted " +
   "enumerate zip map filter open type round reversed repr format isinstance super any all").split(" ")
    .forEach(function (w) { PY_BI[w] = 1; });

  function tokenizeLine(line) {
    const toks = [];
    const n = line.length;
    let i = 0, prevWord = null, sawCode = false;
    while (i < n) {
      const c = line[i];
      if (c === " " || c === "\t") { let j = i; while (j < n && (line[j] === " " || line[j] === "\t")) j++; toks.push({ t: line.slice(i, j), c: null }); i = j; continue; }
      if (c === "#") { toks.push({ t: line.slice(i), c: CODE_COL.com }); break; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && line[j] !== c) { if (line[j] === "\\") j++; j++; }
        j = Math.min(n, j + 1);
        toks.push({ t: line.slice(i, j), c: CODE_COL.str }); i = j; sawCode = true; continue;
      }
      if (c >= "0" && c <= "9") { let j = i; while (j < n && /[0-9._xXa-fA-F]/.test(line[j])) j++; toks.push({ t: line.slice(i, j), c: CODE_COL.num }); i = j; sawCode = true; continue; }
      if (c === "@" && !sawCode) { let j = i + 1; while (j < n && /[A-Za-z0-9_.]/.test(line[j])) j++; toks.push({ t: line.slice(i, j), c: CODE_COL.dec }); i = j; sawCode = true; continue; }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
        const w = line.slice(i, j);
        let col = CODE_COL.txt;
        if (PY_KW[w]) col = CODE_COL.kw;
        else if (prevWord === "def" || prevWord === "class") col = CODE_COL.fn;
        else if (PY_BI[w]) col = CODE_COL.fn;
        else { let k = j; while (k < n && line[k] === " ") k++; if (line[k] === "(") col = CODE_COL.fn; }
        toks.push({ t: w, c: col }); prevWord = w; i = j; sawCode = true; continue;
      }
      toks.push({ t: c, c: CODE_COL.op }); i++; sawCode = true;
    }
    return toks;
  }

  function drawCode(code, canvas) {
    const ctx = canvas.getContext("2d");
    const CW = canvas.width, CH = canvas.height;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = CODE_BG; ctx.fillRect(0, 0, CW, CH);
    const lines = String(code || "").replace(/\t/g, "    ").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();   // drop leading blank lines
    if (!lines.length || !lines.join("").trim()) { drawPlaceholder("python", canvas); return; }

    const maxLines = 10;
    const padY = Math.round(CH * 0.07);
    const avail = CH - padY * 2;
    let fontSize = Math.max(8, Math.min(14, Math.floor(avail / (maxLines * 1.5))));
    const lineH = Math.round(fontSize * 1.5);
    const shown = Math.min(maxLines, Math.max(1, Math.floor(avail / lineH)), lines.length);

    ctx.font = fontSize + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    const chW = ctx.measureText("M").width || fontSize * 0.6;
    const gutterW = Math.round(chW * 2.4);
    const padX = Math.round(chW * 0.8);
    const x0 = padX + gutterW;

    for (let li = 0; li < shown; li++) {
      const y = padY + li * lineH;
      ctx.fillStyle = CODE_COL.gutter;
      ctx.textAlign = "right";
      ctx.fillText(String(li + 1), padX + gutterW - Math.round(chW * 0.7), y);
      ctx.textAlign = "left";
      let x = x0;
      const toks = tokenizeLine(lines[li]);
      for (let ti = 0; ti < toks.length && x < CW; ti++) {
        const tk = toks[ti];
        if (tk.c) { ctx.fillStyle = tk.c; ctx.fillText(tk.t, x, y); }
        x += ctx.measureText(tk.t).width;
      }
    }
    if (lines.length > shown) {   // hint that the program continues
      ctx.fillStyle = CODE_COL.gutter;
      ctx.textAlign = "left";
      ctx.fillText("…", x0, padY + shown * lineH);
    }
  }

  // Replay a saved turtle drawing: a JSON op-list (line segments, fills, dots,
  // text) recorded in turtle coords (origin centre, y up), letterboxed onto the
  // preview canvas over its own background. The vector twin of renderScene.
  function renderTurtle(scene, canvas) {
    const ctx = canvas.getContext("2d");
    const CW = canvas.width, CH = canvas.height;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = scene.bg || "#0f1226";
    ctx.fillRect(0, 0, CW, CH);
    const ops = scene.ops || [];

    // Fit the actual drawing (the bounding box of every op) into the thumbnail,
    // so a small sketch fills the space and a big one is scaled down to fit
    // instead of being clipped, rather than always mapping the fixed turtle area.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function ext(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i], a = o.a || [];
      if (o.k === "s") { ext(a[0], a[1]); ext(a[2], a[3]); }
      else if (o.k === "p") { for (let j = 0; j < a.length; j += 2) ext(a[j], a[j + 1]); }
      else if (o.k === "d") { const r = (o.z || 6) / 2; ext(o.x - r, o.y - r); ext(o.x + r, o.y + r); }
      else if (o.k === "t") { ext(o.x, o.y); }
    }

    const pad = Math.round(Math.min(CW, CH) * 0.08);
    const bw = maxX - minX, bh = maxY - minY;
    let scale, tx, ty;
    if (!ops.length || !isFinite(bw) || !isFinite(bh) || (bw < 1 && bh < 1)) {
      // Nothing to fit (or a single point): fall back to the logical turtle area.
      const W = scene.w || 560, H = scene.h || 380;
      scale = Math.min((CW - pad * 2) / W, (CH - pad * 2) / H);
      tx = CW / 2; ty = CH / 2;
    } else {
      scale = Math.min((CW - pad * 2) / Math.max(bw, 1), (CH - pad * 2) / Math.max(bh, 1));
      const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
      tx = CW / 2 - bcx * scale;   // map the drawing's centre to the canvas centre
      ty = CH / 2 + bcy * scale;   // (+bcy: screen y is flipped from turtle y)
    }
    // Turtle coords (origin centre, y up) -> preview pixels.
    function PX(x) { return tx + x * scale; }
    function PY(y) { return ty - y * scale; }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.k === "s") {                         // line segment
        const a = o.a || [];
        ctx.strokeStyle = o.c || "#22d3a5";
        ctx.lineWidth = Math.max(0.6, (o.w || 2) * scale);
        ctx.beginPath();
        ctx.moveTo(PX(a[0]), PY(a[1]));
        ctx.lineTo(PX(a[2]), PY(a[3]));
        ctx.stroke();
      } else if (o.k === "p") {                  // filled polygon
        const a = o.a || [];
        if (a.length < 6) continue;
        ctx.fillStyle = o.c || "#22d3a5";
        ctx.beginPath();
        ctx.moveTo(PX(a[0]), PY(a[1]));
        for (let j = 2; j < a.length; j += 2) ctx.lineTo(PX(a[j]), PY(a[j + 1]));
        ctx.closePath();
        ctx.fill();
      } else if (o.k === "d") {                  // dot
        ctx.fillStyle = o.c || "#22d3a5";
        ctx.beginPath();
        ctx.arc(PX(o.x), PY(o.y), Math.max(0.8, (o.z || 6) / 2 * scale), 0, Math.PI * 2);
        ctx.fill();
      } else if (o.k === "t") {                  // written text
        ctx.fillStyle = o.c || "#e6e7ef";
        ctx.font = "bold " + Math.max(6, (o.z || 12) * scale) + "px system-ui, sans-serif";
        ctx.textAlign = o.al === "center" ? "center" : o.al === "right" ? "right" : "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(o.s || ""), PX(o.x), PY(o.y));
      }
    }
  }

  // Paint a saved runtime scene (real sprite positions captured at publish time).
  function renderScene(scene, canvas) {
    const ctx = canvas.getContext("2d");
    const CW = canvas.width, CH = canvas.height;
    ctx.clearRect(0, 0, CW, CH);
    const W = scene.w || 480, H = scene.h || 360;
    ctx.fillStyle = scene.bg || "#0b1020";
    ctx.fillRect(0, 0, CW, CH);
    const scale = Math.min(CW / W, CH / H);
    const ox = (CW - W * scale) / 2, oy = (CH - H * scale) / 2;
    // Clip the sprites to the game window so anything the game parked off-screen
    // (e.g. pipes spawned to the right, not yet scrolled into the player's view)
    // stays hidden in the gallery too, exactly as the live canvas clips whatever
    // falls past its edge. The background still fills the whole card (the bleed
    // the author likes) because this clip covers only the sprites, after the fill.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, W * scale, H * scale);
    ctx.clip();
    (scene.sprites || []).forEach(function (s) {
      const ang = Number(s.angle) || 0;
      const sx = (s.sx == null || !isFinite(+s.sx)) ? 1 : +s.sx;
      const sy = (s.sy == null || !isFinite(+s.sy)) ? 1 : +s.sy;
      ctx.save();
      ctx.translate(ox + s.x * scale, oy + s.y * scale);
      if (ang) ctx.rotate(ang * Math.PI / 180);
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      if (s.kind === "box") {
        ctx.fillStyle = s.color || "#fff";
        ctx.fillRect(-s.w * scale / 2, -s.h * scale / 2, s.w * scale, s.h * scale);
      } else if (s.kind === "art") {
        const img = IMAGES[s.art];
        const sz = (s.size || 40) * scale;
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      } else if (s.kind === "asset") {
        // A sprite the author designed in the Asset studio: fetch its SVG once
        // and draw it at its real proportions (longer side = size), repainting
        // the card when it loads.
        const aimg = assetImage(s.asset, function () { scheduleRerender(scene, canvas); });
        if (aimg) {
          const sz = (s.size || 40) * scale;
          const ratio = ASSET_RATIO[String(s.asset)] || 1;
          const aw = ratio >= 1 ? sz : sz * ratio;
          const ah = ratio >= 1 ? sz / ratio : sz;
          ctx.drawImage(aimg, -aw / 2, -ah / 2, aw, ah);
        }
      } else if (s.kind === "text") {
        ctx.font = "bold " + ((s.size || 20) * scale) + "px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (s.back) {
          // A rounded pill behind the text, matching the game engine's draw so a
          // score badge in the preview looks like the one in the running game.
          const tw = ctx.measureText(String(s.text || "")).width;
          const th = (s.size || 20) * scale;
          const padX = 8 * scale, padY = 5 * scale, r = 6 * scale;
          const bw = tw + padX * 2, bh = th + padY * 2, bx = -bw / 2, by = -bh / 2;
          ctx.fillStyle = s.back;
          ctx.beginPath();
          ctx.moveTo(bx + r, by);
          ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
          ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
          ctx.arcTo(bx, by + bh, bx, by, r);
          ctx.arcTo(bx, by, bx + bw, by, r);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = s.color || "#fff";
        ctx.fillText(String(s.text || ""), 0, 0);
      } else {
        ctx.font = ((s.size || 40) * scale) + "px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(s.text || ""), 0, 0);
      }
      ctx.restore();
    });
    ctx.restore();   // release the window clip
  }

  // A saved runtime scene wins (real sprite positions); otherwise parse the
  // code's opening scene; otherwise a themed placeholder. sceneJson is optional.
  function renderInto(canvas, code, sceneJson) {
    if (sceneJson) {
      try {
        const scene = typeof sceneJson === "string" ? JSON.parse(sceneJson) : sceneJson;
        if (scene && scene.kind === "turtle" && scene.ops) {
          renderTurtle(scene, canvas);
          return "turtle";
        }
        if (scene && scene.sprites && scene.sprites.length) {
          renderScene(scene, canvas);
          setTimeout(function () { try { renderScene(scene, canvas); } catch (e) {} }, 150);
          return "scene";
        }
      } catch (e) {}
    }
    const kind = detectKind(code);
    if (kind === "game") {
      const drew = drawGame(code, canvas);
      // A game we couldn't parse a scene from falls back to its code, not a
      // blank placeholder.
      if (drew === 0) drawCode(code, canvas);
      else setTimeout(function () { try { drawGame(code, canvas); } catch (e) {} }, 150);
    } else {
      // python (and a turtle program that wasn't run) show their code.
      drawCode(code, canvas);
    }
    return kind;
  }

  PWL.preview = { renderInto: renderInto, renderScene: renderScene, renderTurtle: renderTurtle, drawCode: drawCode, detectKind: detectKind };
})();
