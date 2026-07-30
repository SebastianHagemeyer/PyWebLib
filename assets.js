/*
 * PyWebLib Asset studio: draw a small sprite out of shapes and publish it to the
 * `assets` table. A game then uses it with game.sprite(id, asset=True). The SVG
 * is composed here from a fixed set of shapes (rect / circle / ellipse / line /
 * triangle), so there is no author-supplied markup to sanitise.
 */
(function () {
  "use strict";

  const PWL = window.PWL || {};
  const sb = PWL.supabase;

  const studio = document.getElementById("asset-studio");
  const notice = document.getElementById("asset-notice");
  if (!studio) return;
  if (!PWL.configured || !sb) {
    if (notice) notice.hidden = false;
    studio.style.opacity = "0.5";
  }

  const stage = document.getElementById("asset-stage");
  const colorInput = document.getElementById("asset-color");
  const swatchWrap = document.getElementById("asset-swatches");
  const recentWrap = document.getElementById("asset-recent");
  const recentRow = document.getElementById("asset-recent-row");
  const nameInput = document.getElementById("asset-name");
  const publishBtn = document.getElementById("asset-publish");
  const msg = document.getElementById("asset-msg");
  const mineEl = document.getElementById("asset-mine");
  const allEl = document.getElementById("asset-all");
  const previews = ["asset-prev-a", "asset-prev-b", "asset-prev-c"].map(function (id) { return document.getElementById(id); });

  const PALETTE = ["#4f46e5", "#ef4444", "#f59e0b", "#ffd43b", "#22c55e", "#14b8a6",
                   "#3b82f6", "#a855f7", "#ec4899", "#78350f", "#ffffff", "#111827"];

  // ---- editor state ----
  let shapes = [];        // array of shape objects, drawn in order (last on top)
  let selected = -1;      // index of the selected shape, or -1
  let tool = "select";
  let color = "#4f46e5";
  const history = [];     // JSON snapshots for undo
  let editingId = null;   // the asset id we're updating, or null for a new one
  let pathPts = [];        // vertices of the path currently being drawn
  let importedSvg = null;  // an uploaded SVG, published as-is (not shape-based)
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem("pwl-asset-recent") || "[]"); } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rnd(n) { return Math.round(n * 10) / 10; }
  function clamp(n) { return Math.max(0, Math.min(64, n)); }
  function snapshot() { history.push(JSON.stringify(shapes)); if (history.length > 60) history.shift(); }

  // ---- shape -> SVG ----
  function shapeSvg(s) {
    if (s.type === "rect")
      return '<rect x="' + rnd(s.x) + '" y="' + rnd(s.y) + '" width="' + rnd(s.w) + '" height="' + rnd(s.h) + '" rx="' + rnd(s.rx || 0) + '" fill="' + s.fill + '"/>';
    if (s.type === "circle")
      return '<circle cx="' + rnd(s.cx) + '" cy="' + rnd(s.cy) + '" r="' + rnd(s.r) + '" fill="' + s.fill + '"/>';
    if (s.type === "ellipse")
      return '<ellipse cx="' + rnd(s.cx) + '" cy="' + rnd(s.cy) + '" rx="' + rnd(s.rx) + '" ry="' + rnd(s.ry) + '" fill="' + s.fill + '"/>';
    if (s.type === "line")
      return '<line x1="' + rnd(s.x1) + '" y1="' + rnd(s.y1) + '" x2="' + rnd(s.x2) + '" y2="' + rnd(s.y2) + '" stroke="' + s.fill + '" stroke-width="' + rnd(s.width || 4) + '" stroke-linecap="round"/>';
    if (s.type === "triangle")
      return '<polygon points="' + rnd(s.x + s.w / 2) + ',' + rnd(s.y) + ' ' + rnd(s.x) + ',' + rnd(s.y + s.h) + ' ' + rnd(s.x + s.w) + ',' + rnd(s.y + s.h) + '" fill="' + s.fill + '"/>';
    if (s.type === "path")
      return '<path d="' + s.points.map(function (pt, i) { return (i ? "L" : "M") + rnd(pt[0]) + " " + rnd(pt[1]); }).join(" ") + ' Z" fill="' + s.fill + '"/>';
    if (s.type === "raw")
      // A piece of an imported SVG kept verbatim (curves, strokes, clips and all),
      // positioned/stretched by a matrix wrapper so we never touch its geometry.
      return '<g transform="matrix(' + s.m.map(function (v) { return Math.round(v * 100000) / 100000; }).join(" ") + ')">' + s.markup + '</g>';
    return "";
  }
  function toSvg(list) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + (list || shapes).map(shapeSvg).join("") + "</svg>";
  }
  function dataUri(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }

  function bbox(s) {
    if (s.type === "rect" || s.type === "triangle") return { x: s.x, y: s.y, w: s.w, h: s.h };
    if (s.type === "circle") return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    if (s.type === "ellipse") return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    if (s.type === "line") return { x: Math.min(s.x1, s.x2) - 3, y: Math.min(s.y1, s.y2) - 3, w: Math.abs(s.x2 - s.x1) + 6, h: Math.abs(s.y2 - s.y1) + 6 };
    if (s.type === "path") {
      const xs = s.points.map(function (p) { return p[0]; }), ys = s.points.map(function (p) { return p[1]; });
      const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
      return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
    }
    if (s.type === "raw") {
      // Axis-aligned bounds of the base box pushed through the piece's matrix.
      const m = s.m, xs = [], ys = [];
      [[s.bx, s.by], [s.bx + s.bw, s.by], [s.bx, s.by + s.bh], [s.bx + s.bw, s.by + s.bh]].forEach(function (p) {
        xs.push(m[0] * p[0] + m[2] * p[1] + m[4]); ys.push(m[1] * p[0] + m[3] * p[1] + m[5]);
      });
      const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
      return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  function hit(s, px, py) {
    const b = bbox(s);
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }
  function moveShape(s, dx, dy) {
    if (s.type === "rect" || s.type === "triangle") { s.x += dx; s.y += dy; }
    else if (s.type === "circle" || s.type === "ellipse") { s.cx += dx; s.cy += dy; }
    else if (s.type === "line") { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
    else if (s.type === "path") { s.points = s.points.map(function (p) { return [p[0] + dx, p[1] + dy]; }); }
    else if (s.type === "raw") { s.m[4] += dx; s.m[5] += dy; }
  }
  // Remap a shape from one bounding box to another (used by the resize handles),
  // so you can stretch anything in any direction, great for remixing.
  function scaleShape(s, ox, oy, ow, oh, nx, ny, nw, nh) {
    const fx = ow ? nw / ow : 1, fy = oh ? nh / oh : 1;
    const mx = function (x) { return nx + (x - ox) * fx; };
    const my = function (y) { return ny + (y - oy) * fy; };
    if (s.type === "rect" || s.type === "triangle") { s.x = mx(s.x); s.y = my(s.y); s.w *= fx; s.h *= fy; }
    else if (s.type === "ellipse") { s.cx = mx(s.cx); s.cy = my(s.cy); s.rx *= fx; s.ry *= fy; }
    else if (s.type === "circle") { s.cx = mx(s.cx); s.cy = my(s.cy); s.r *= (fx + fy) / 2; }
    else if (s.type === "line") { s.x1 = mx(s.x1); s.y1 = my(s.y1); s.x2 = mx(s.x2); s.y2 = my(s.y2); }
    else if (s.type === "path") { s.points = s.points.map(function (p) { return [mx(p[0]), my(p[1])]; }); }
    else if (s.type === "raw") {
      // Compose the bbox remap (a plain scale+translate in canvas space) onto the
      // piece's matrix, so its curves stretch as one without editing the path data.
      const A = { a: fx, b: 0, c: 0, d: fy, e: nx - ox * fx, f: ny - oy * fy };
      const o = { a: s.m[0], b: s.m[1], c: s.m[2], d: s.m[3], e: s.m[4], f: s.m[5] };
      const r = matMul(A, o);
      s.m = [r.a, r.b, r.c, r.d, r.e, r.f];
    }
  }
  const HANDLES = [[0,0],[0.5,0],[1,0],[0,0.5],[1,0.5],[0,1],[0.5,1],[1,1]];
  // The 8 resize handles sit on a frame that hugs the shape from just OUTSIDE it
  // and never shrinks below H_MIN across. So on a tiny shape they frame it instead
  // of piling on top and burying it (the old bug: fixed-size handles on a shrunk
  // shape covered it completely, and their hit-zones swallowed the shape body so
  // you couldn't even grab it to move).
  const H_GAP = 2;    // push handles this far outside the shape box
  const H_MIN = 13;   // smallest frame span, so 8 handles can't crowd a small shape
  function handleFrame(b) {
    return {
      cx: b.x + b.w / 2, cy: b.y + b.h / 2,
      halfW: Math.max(b.w / 2 + H_GAP, H_MIN / 2),
      halfH: Math.max(b.h / 2 + H_GAP, H_MIN / 2)
    };
  }
  // Drawn/hit centre of every handle (clamped onto the canvas), plus the offset
  // from the real box edge it controls, so a drag maps back to that edge cleanly.
  function handleList(b) {
    const f = handleFrame(b);
    return HANDLES.map(function (h) {
      const x = clamp(f.cx + (h[0] - 0.5) * 2 * f.halfW);
      const y = clamp(f.cy + (h[1] - 0.5) * 2 * f.halfH);
      return { hx: h[0], hy: h[1], x: x, y: y, offX: x - (b.x + h[0] * b.w), offY: y - (b.y + h[1] * b.h) };
    });
  }
  function handleAt(px, py) {
    if (selected < 0 || tool !== "select") return null;
    const b = bbox(shapes[selected]);
    const list = handleList(b);
    for (let i = 0; i < list.length; i++) {
      const hp = list[i];
      if (Math.abs(px - hp.x) <= 2.6 && Math.abs(py - hp.y) <= 2.6)
        return { hx: hp.hx, hy: hp.hy, ox: b.x, oy: b.y, ow: b.w, oh: b.h, offX: hp.offX, offY: hp.offY };
    }
    return null;
  }

  // ---- render the canvas + previews ----
  function currentSvg() { return importedSvg || toSvg(); }
  function render() {
    if (importedSvg) {
      stage.innerHTML = '<image href="' + esc(dataUri(importedSvg)) + '" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>';
    } else {
      let svg = shapes.map(shapeSvg).join("");
      if (selected >= 0 && shapes[selected]) {
        const b = bbox(shapes[selected]);
        svg += '<rect x="' + rnd(b.x) + '" y="' + rnd(b.y) + '" width="' + rnd(b.w) + '" height="' + rnd(b.h) +
               '" fill="none" stroke="#4f46e5" stroke-width="0.8" stroke-dasharray="2 1.5" vector-effect="non-scaling-stroke"/>';
        if (tool === "select") {   // drag these to stretch the shape
          svg += handleList(b).map(function (hp) {
            return '<rect x="' + rnd(hp.x - 1.5) + '" y="' + rnd(hp.y - 1.5) + '" width="3" height="3" fill="#ffffff" stroke="#4f46e5" stroke-width="0.6" vector-effect="non-scaling-stroke"/>';
          }).join("");
        }
      }
      if (pathPts.length) {   // the path being drawn: open line + dots
        svg += '<polyline points="' + pathPts.map(function (p) { return rnd(p[0]) + "," + rnd(p[1]); }).join(" ") +
               '" fill="none" stroke="#4f46e5" stroke-width="0.8" vector-effect="non-scaling-stroke"/>';
        svg += pathPts.map(function (p, i) { return '<circle cx="' + rnd(p[0]) + '" cy="' + rnd(p[1]) + '" r="' + (i === 0 ? 1.8 : 1.1) + '" fill="' + (i === 0 ? "#ef4444" : "#4f46e5") + '"/>'; }).join("");
      }
      stage.innerHTML = svg;
    }
    const uri = dataUri(currentSvg());
    previews.forEach(function (img) { if (img) img.src = uri; });
    reflectImport();
  }

  // ---- pointer coordinates in the 0..64 canvas space ----
  function toStage(e) {
    const r = stage.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * 64), y: clamp((e.clientY - r.top) / r.height * 64) };
  }

  let drawing = null;   // { startX, startY, shape } while drawing
  let dragging = null;  // { lastX, lastY } while moving a selection
  let resizing = null;  // { h, orig } while dragging a resize handle

  stage.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    if (tool === "eyedrop") { sampleColorAt(toStage(e)); return; }   // pick, works on imports too
    if (importedSvg) return;   // an imported SVG is published as-is, not edited
    const p = toStage(e);
    if (tool === "path") {
      // Click to drop points; click the first (red) dot, or press Enter, to finish.
      if (pathPts.length >= 3 && Math.hypot(p.x - pathPts[0][0], p.y - pathPts[0][1]) < 4) finishPath();
      else { pathPts.push([clamp(p.x), clamp(p.y)]); render(); }
      return;
    }
    if (tool === "select") {
      const h = handleAt(p.x, p.y);   // grabbed a resize handle?
      if (h) { snapshot(); resizing = { h: h, orig: JSON.parse(JSON.stringify(shapes[selected])) }; return; }
      selected = -1;
      for (let i = shapes.length - 1; i >= 0; i--) { if (hit(shapes[i], p.x, p.y)) { selected = i; break; } }
      if (selected >= 0) { snapshot(); dragging = { lastX: p.x, lastY: p.y }; }
      render();
      return;
    }
    snapshot();
    const s = { type: tool, fill: color };
    if (tool === "line") { s.x1 = p.x; s.y1 = p.y; s.x2 = p.x; s.y2 = p.y; s.width = 4; }
    else if (tool === "circle") { s.cx = p.x; s.cy = p.y; s.r = 0; }
    else if (tool === "ellipse") { s.cx = p.x; s.cy = p.y; s.rx = 0; s.ry = 0; }
    else { s.x = p.x; s.y = p.y; s.w = 0; s.h = 0; }
    drawing = { startX: p.x, startY: p.y, shape: s };
    shapes.push(s);
    selected = shapes.length - 1;
    render();
  });

  stage.addEventListener("pointermove", function (e) {
    if (!drawing && !dragging && !resizing) return;
    const p = toStage(e);
    if (resizing) {
      // Rebuild the box from the drag, keeping the handle's opposite side fixed.
      // Handles sit outside the box, so subtract their offset to hit the real edge.
      const h = resizing.h;
      const ex = p.x - h.offX, ey = p.y - h.offY;
      let nx = h.ox, ny = h.oy, nw = h.ow, nh = h.oh;
      if (h.hx === 0) { nx = Math.min(ex, h.ox + h.ow - 1); nw = h.ox + h.ow - nx; }
      else if (h.hx === 1) { nw = Math.max(1, ex - h.ox); }
      if (h.hy === 0) { ny = Math.min(ey, h.oy + h.oh - 1); nh = h.oy + h.oh - ny; }
      else if (h.hy === 1) { nh = Math.max(1, ey - h.oy); }
      shapes[selected] = JSON.parse(JSON.stringify(resizing.orig));
      scaleShape(shapes[selected], h.ox, h.oy, h.ow, h.oh, nx, ny, nw, nh);
      render();
      return;
    }
    if (dragging) {
      moveShape(shapes[selected], p.x - dragging.lastX, p.y - dragging.lastY);
      dragging.lastX = p.x; dragging.lastY = p.y;
      render();
      return;
    }
    const s = drawing.shape, x0 = drawing.startX, y0 = drawing.startY;
    if (s.type === "line") { s.x2 = p.x; s.y2 = p.y; }
    else if (s.type === "circle") { s.cx = (x0 + p.x) / 2; s.cy = (y0 + p.y) / 2; s.r = Math.max(Math.abs(p.x - x0), Math.abs(p.y - y0)) / 2; }
    else if (s.type === "ellipse") { s.cx = (x0 + p.x) / 2; s.cy = (y0 + p.y) / 2; s.rx = Math.abs(p.x - x0) / 2; s.ry = Math.abs(p.y - y0) / 2; }
    else { s.x = Math.min(x0, p.x); s.y = Math.min(y0, p.y); s.w = Math.abs(p.x - x0); s.h = Math.abs(p.y - y0); }
    render();
  });

  stage.addEventListener("pointerup", function (e) {
    if (drawing) {
      const s = drawing.shape;
      // A plain click (no real drag) drops a default-sized shape.
      const tiny = (s.type === "line") ? (Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1) < 3)
        : (s.type === "circle") ? (s.r < 2)
        : (s.type === "ellipse") ? (s.rx < 2 || s.ry < 2)
        : (s.w < 2 || s.h < 2);
      if (tiny) applyDefault(s);
      pushRecent(s.fill);
      drawing = null;
      render();
    }
    dragging = null; resizing = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
  });

  function applyDefault(s) {
    if (s.type === "line") { s.x2 = clamp(s.x1 + 18); s.y2 = s.y1; }
    else if (s.type === "circle") { s.r = 12; }
    else if (s.type === "ellipse") { s.rx = 14; s.ry = 9; }
    else if (s.type === "triangle") { s.x -= 11; s.y -= 10; s.w = 22; s.h = 20; }
    else { s.x -= 10; s.y -= 7; s.w = 20; s.h = 14; s.rx = 1; }
    s.x = clamp(s.x); s.y = clamp(s.y);
  }

  function finishPath() {
    if (pathPts.length >= 3) {
      snapshot();
      shapes.push({ type: "path", points: pathPts.slice(), fill: color });
      selected = shapes.length - 1;
      pushRecent(color);
    }
    pathPts = [];
    render();
  }

  // ---- tools + colours ----
  document.getElementById("asset-toolbar").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-tool]");
    if (!btn) return;
    tool = btn.getAttribute("data-tool");
    if (pathPts.length) pathPts = [];   // abandon a half-drawn path when switching
    document.querySelectorAll(".asset-tool").forEach(function (b) { b.classList.toggle("is-on", b === btn); });
    if (tool !== "select") selected = -1;
    render();
  });
  PALETTE.forEach(function (c) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "asset-swatch"; b.style.background = c; b.title = c;
    b.addEventListener("click", function () { setColor(c); });
    swatchWrap.appendChild(b);
  });
  function renderRecent() {
    if (!recentWrap || !recentRow) return;
    recentRow.hidden = !recent.length;
    recentWrap.innerHTML = "";
    recent.forEach(function (c) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "asset-swatch"; b.style.background = c; b.title = c;
      b.addEventListener("click", function () { setColor(c); });
      recentWrap.appendChild(b);
    });
  }
  function pushRecent(c) {
    if (!c || !/^#[0-9a-f]{3,8}$/i.test(c)) return;
    recent = [c].concat(recent.filter(function (x) { return x !== c; })).slice(0, 12);
    try { localStorage.setItem("pwl-asset-recent", JSON.stringify(recent)); } catch (e) {}
    renderRecent();
  }
  function setColor(c) {
    color = c;
    pushRecent(c);
    if (colorInput) colorInput.value = /^#[0-9a-f]{6}$/i.test(c) ? c : colorInput.value;
    if (selected >= 0 && shapes[selected]) { snapshot(); shapes[selected].fill = c; render(); }
  }
  if (colorInput) colorInput.addEventListener("input", function () { setColor(colorInput.value); });

  // Eyedropper: rasterise the current drawing and read the pixel under the click,
  // so you can pull an exact colour out of the scene (great for matching imported art).
  function sampleColorAt(p) {
    const R = 300;
    const img = new Image();
    img.onload = function () {
      try {
        const cv = document.createElement("canvas"); cv.width = R; cv.height = R;
        const c = cv.getContext("2d");
        let dx = 0, dy = 0, dw = R, dh = R;
        if (importedSvg && img.naturalWidth > 0 && img.naturalHeight > 0) {
          // Match the stage's letterbox (preserveAspectRatio meet into the 64 box).
          const s = Math.min(R / img.naturalWidth, R / img.naturalHeight);
          dw = img.naturalWidth * s; dh = img.naturalHeight * s;
          dx = (R - dw) / 2; dy = (R - dh) / 2;
        }
        c.drawImage(img, dx, dy, dw, dh);
        const px = Math.max(0, Math.min(R - 1, Math.round(p.x / 64 * R)));
        const py = Math.max(0, Math.min(R - 1, Math.round(p.y / 64 * R)));
        const d = c.getImageData(px, py, 1, 1).data;
        if (d[3] < 8) { showMsg("That spot is empty. Aim at part of the drawing.", false); return; }
        const hex = "#" + [d[0], d[1], d[2]].map(function (n) { return ("0" + n.toString(16)).slice(-2); }).join("");
        setColor(hex);
        showMsg("Picked " + hex, true);
      } catch (err) { showMsg("Couldn't read a colour there.", false); }
    };
    img.onerror = function () { showMsg("Couldn't read a colour there.", false); };
    img.src = dataUri(importedSvg || toSvg(shapes));
  }

  // Import an SVG file: sanitised and published as-is (not turned into shapes).
  const importBtn = document.getElementById("asset-import-btn");
  const importInput = document.getElementById("asset-import");
  if (importBtn && importInput) {
    importBtn.addEventListener("click", function () { importInput.click(); });
    importInput.addEventListener("change", function () {
      const f = importInput.files && importInput.files[0];
      importInput.value = "";
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        const clean = sanitizeSvg(String(rd.result || ""));
        if (!clean) { showMsg("That file isn't an SVG we can use (or it's over the size limit).", false); return; }
        snapshot();
        importedSvg = clean; shapes = []; selected = -1; pathPts = []; editingId = null;
        if (!nameInput.value) nameInput.value = (f.name || "sprite").replace(/\.svg$/i, "").slice(0, 40);
        setPublishLabel(); render();
        showMsg('Imported! Publish it as-is, hit "Break into editable shapes" to edit it, or Clear to start over.', true);
      };
      rd.readAsText(f);
    });
  }
  function sanitizeSvg(text) {
    let doc;
    try { doc = new DOMParser().parseFromString(text, "image/svg+xml"); } catch (e) { return null; }
    const svg = doc.querySelector("svg");
    if (!svg || doc.querySelector("parsererror")) return null;
    // Drop anything scriptable, animated, or that loads from the network.
    doc.querySelectorAll("script,foreignObject,a,animate,animateTransform,animateMotion,set,handler").forEach(function (n) { n.remove(); });
    doc.querySelectorAll("*").forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (at) {
        const nm = at.name.toLowerCase();
        if (nm.indexOf("on") === 0) n.removeAttribute(at.name);
        else if ((nm === "href" || nm === "xlink:href") && !/^\s*#/.test(at.value)) n.removeAttribute(at.name);
        else if (nm === "style" && /url\s*\(|expression|javascript:/i.test(at.value)) n.removeAttribute(at.name);
      });
    });
    if (!svg.getAttribute("viewBox")) {
      const w = parseFloat(svg.getAttribute("width")) || 64, h = parseFloat(svg.getAttribute("height")) || 64;
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    }
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const outSvg = new XMLSerializer().serializeToString(svg);
    return outSvg.length <= 7800 ? outSvg : null;
  }

  function reorder(dir) {
    if (selected < 0) return;
    const j = selected + dir;
    if (j < 0 || j >= shapes.length) return;
    snapshot();
    const s = shapes.splice(selected, 1)[0];
    shapes.splice(j, 0, s);
    selected = j; render();
  }
  document.getElementById("asset-forward").addEventListener("click", function () { reorder(1); });
  document.getElementById("asset-back").addEventListener("click", function () { reorder(-1); });
  document.getElementById("asset-delete").addEventListener("click", deleteSel);
  function deleteSel() { if (selected < 0) return; snapshot(); shapes.splice(selected, 1); selected = -1; render(); }
  document.getElementById("asset-undo").addEventListener("click", undo);
  function undo() { if (!history.length) return; shapes = JSON.parse(history.pop()); selected = -1; render(); }
  document.getElementById("asset-clear").addEventListener("click", function () {
    if (!shapes.length && !importedSvg) return;
    snapshot(); shapes = []; selected = -1; editingId = null; importedSvg = null; pathPts = []; setPublishLabel(); render();
  });

  document.addEventListener("keydown", function (e) {
    if (/input|textarea/i.test((e.target && e.target.tagName) || "")) return;
    if (e.key === "Enter" && tool === "path") { e.preventDefault(); finishPath(); return; }
    if (e.key === "Escape" && pathPts.length) { e.preventDefault(); pathPts = []; render(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else { const k = { v: "select", r: "rect", c: "circle", e: "ellipse", l: "line", t: "triangle", p: "path", i: "eyedrop" }[e.key.toLowerCase()];
      if (k) { const btn = document.querySelector('[data-tool="' + k + '"]'); if (btn) btn.click(); } }
  });

  // ---- publish + library ----
  function showMsg(text, ok) {
    if (!msg) return;
    msg.hidden = false; msg.textContent = text;
    msg.className = "asset-msg " + (ok ? "is-ok" : "is-err");
  }
  function setPublishLabel() { if (publishBtn) publishBtn.textContent = editingId ? "Update asset" : "Publish asset"; }

  if (publishBtn) publishBtn.addEventListener("click", async function () {
    if (!PWL.configured || !sb) { showMsg("The asset backend isn't set up yet.", false); return; }
    const user = PWL.auth && PWL.auth.user();
    if (!user) { PWL.auth.signInWithGoogle(); return; }
    if (!shapes.length && !importedSvg) { showMsg("Draw something first.", false); return; }
    const svg = currentSvg();
    if (svg.length > 8000) { showMsg("That sprite is too detailed to save. Use fewer shapes.", false); return; }
    const name = (nameInput.value || "").trim() || "untitled";
    publishBtn.disabled = true;
    let res;
    if (editingId) {
      res = await sb.from("assets").update({ name: name, svg: svg, updated_at: new Date().toISOString() }).eq("id", editingId).select("id").single();
    } else {
      res = await sb.from("assets").insert({ author_id: user.id, name: name, svg: svg }).select("id").single();
    }
    publishBtn.disabled = false;
    if (res.error) { showMsg("Couldn't save: " + res.error.message, false); return; }
    editingId = res.data.id;
    setPublishLabel();
    showMsg("Saved as asset #" + res.data.id + "  —  use it with game.sprite(" + res.data.id + ", asset=True)", true);
    loadLibrary();
  });

  function card(a, mine) {
    const el = document.createElement("div");
    el.className = "asset-card";
    el.innerHTML =
      '<img class="asset-card-pic" alt="" title="' + (mine ? "Click to edit" : "Click to remix a copy") + '" src="' + esc(dataUri(a.svg)) + '" />' +
      '<button type="button" class="asset-card-id" title="Copy the game.sprite line">#' + a.id + '</button>' +
      '<span class="asset-card-name"></span>' +
      (mine ? '<button type="button" class="asset-card-del" title="Delete">×</button>' : "");
    el.querySelector(".asset-card-name").textContent = a.name || "untitled";
    // Open the sprite in the editor: yours to edit, someone else's as a fresh
    // copy to remix and publish as your own.
    el.querySelector(".asset-card-pic").addEventListener("click", function () { loadIntoEditor(a, !mine); });
    // The #id copies the line that uses it in a game.
    el.querySelector(".asset-card-id").addEventListener("click", function () {
      const snippet = "game.sprite(" + a.id + ", 100, 100, asset=True)";
      try { navigator.clipboard.writeText(snippet); showMsg("Copied: " + snippet, true); } catch (e) { showMsg(snippet, true); }
    });
    if (mine) el.querySelector(".asset-card-del").addEventListener("click", async function (ev) {
      ev.stopPropagation();
      if (!confirm("Delete asset #" + a.id + "? Games using it will lose it.")) return;
      const r = await sb.from("assets").delete().eq("id", a.id);
      if (!r.error) { if (editingId === a.id) { editingId = null; setPublishLabel(); } loadLibrary(); }
    });
    return el;
  }
  // Our own saved sprites use viewBox "0 0 64 64" and only the simple shapes the
  // editor can round-trip. Anything else (imported art drawn on a different
  // canvas, or using groups, transforms or curves) can't be turned back into
  // editable shapes without mangling it, so we show it exactly as saved instead.
  function isStudioNative(svg) {
    if (!/viewBox\s*=\s*["']\s*0\s+0\s+64\s+64\s*["']/.test(svg)) return false;
    if (/<g[\s>]|transform\s*=|<image|<text|<use|<defs/i.test(svg)) return false;
    if (/\sd\s*=\s*["'][^"']*[CcSsQqTtAa]/.test(svg)) return false;   // path curves
    return true;
  }
  function loadIntoEditor(a, asTemplate) {
    snapshot();
    selected = -1; pathPts = [];
    editingId = asTemplate ? null : a.id;   // a remix publishes as a NEW asset
    let imported = false;
    if (isStudioNative(a.svg)) {
      const parsed = parseSvg(a.svg);
      if (parsed && parsed.length) { shapes = parsed; importedSvg = null; }
      else { shapes = []; importedSvg = a.svg; imported = true; }
    } else {
      // Show it as-is (letterboxed, keeps its aspect), ready to rename + republish.
      shapes = []; importedSvg = a.svg; imported = true;
    }
    nameInput.value = asTemplate ? ((a.name || "sprite") + " remix") : (a.name || "");
    setPublishLabel();
    render();
    const extra = imported ? ' It came in as one piece: hit "Break into editable shapes" to split it up, or just rename and republish it.' : "";
    showMsg(asTemplate
      ? ("Opened a copy of #" + a.id + " to remix." + extra + (imported ? "" : " Publish it to save your own."))
      : ("Editing your asset #" + a.id + "." + extra), true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadLibrary() {
    if (!PWL.configured || !sb) return;
    const user = PWL.auth && PWL.auth.user();
    if (mineEl) {
      if (!user) { mineEl.innerHTML = '<p class="community-empty">Sign in to save and reuse your sprites.</p>'; }
      else {
        const r = await sb.from("assets").select("id,name,svg").eq("author_id", user.id).order("created_at", { ascending: false });
        mineEl.innerHTML = "";
        if (r.error || !r.data || !r.data.length) mineEl.innerHTML = '<p class="community-empty">No assets yet. Draw one above and publish it.</p>';
        else r.data.forEach(function (a) { mineEl.appendChild(card(a, true)); });
      }
    }
    if (allEl) {
      const r = await sb.from("assets").select("id,name,svg").order("created_at", { ascending: false }).limit(60);
      allEl.innerHTML = "";
      if (r.error || !r.data || !r.data.length) allEl.innerHTML = '<p class="community-empty">No community assets yet. Be the first!</p>';
      else r.data.forEach(function (a) { allEl.appendChild(card(a, false)); });
    }
  }

  // A tiny, forgiving reader that turns our own saved SVG back into shapes so an
  // asset can be reopened and edited. It only understands the shapes we write.
  function parseSvg(svg) {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror")) return null;
    const out = [];
    doc.querySelectorAll("rect,circle,ellipse,line,polygon,path").forEach(function (n) {
      const t = n.tagName.toLowerCase(), f = n.getAttribute("fill") || n.getAttribute("stroke") || "#000";
      const num = function (a) { return parseFloat(n.getAttribute(a)) || 0; };
      if (t === "rect") out.push({ type: "rect", x: num("x"), y: num("y"), w: num("width"), h: num("height"), rx: num("rx"), fill: f });
      else if (t === "circle") out.push({ type: "circle", cx: num("cx"), cy: num("cy"), r: num("r"), fill: f });
      else if (t === "ellipse") out.push({ type: "ellipse", cx: num("cx"), cy: num("cy"), rx: num("rx"), ry: num("ry"), fill: f });
      else if (t === "line") out.push({ type: "line", x1: num("x1"), y1: num("y1"), x2: num("x2"), y2: num("y2"), width: parseFloat(n.getAttribute("stroke-width")) || 4, fill: f });
      else if (t === "polygon") { const pts = (n.getAttribute("points") || "").trim().split(/\s+/).map(function (p) { return p.split(",").map(parseFloat); });
        if (pts.length >= 3) { const xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
          const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys); out.push({ type: "triangle", x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y, fill: f }); } }
      else if (t === "path") { const pts = [];
        (n.getAttribute("d") || "").replace(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/gi, function (m, a, b) { pts.push([parseFloat(a), parseFloat(b)]); return m; });
        if (pts.length >= 3) out.push({ type: "path", points: pts, fill: f }); }
    });
    return out;
  }

  // ---- Import decomposition: an SVG -> movable pieces -------------------------
  // Splits an imported SVG into pieces you can move/stretch while KEEPING each
  // piece's original markup (curves, strokes, clips, everything), so a see-through
  // part (a stroked open path, a clip) is never flattened into a solid blob. The
  // browser bakes each piece's transform via getCTM(); folded with a viewBox->0..64
  // fit, that becomes one matrix wrapper, so the geometry itself is never rewritten.
  // A plain solid-filled rect/circle/ellipse with no stroke becomes a native
  // editable shape (a bonus); everything else is kept as a verbatim "raw" piece.
  const FLAT_MAX_SHAPES = 120;   // safety cap on total pieces
  const SKIP_TAGS = { defs: 1, style: 1, title: 1, desc: 1, metadata: 1, clippath: 1, mask: 1, symbol: 1, marker: 1, lineargradient: 1, radialgradient: 1, filter: 1, pattern: 1 };
  const DRAW_TAGS = { path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polygon: 1, polyline: 1, text: 1, use: 1 };
  const PAINT_PROPS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "fill-rule", "opacity", "fill-opacity", "stroke-opacity"];
  function matMul(m, n) {      // m * n, each { a,b,c,d,e,f }
    return {
      a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
      c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
      e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f
    };
  }
  function matAt(M, x, y) { return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]; }
  function toHex(v) {   // "rgb(239, 68, 68)" -> "#ef4444"; leave names/hex as-is
    const m = /^rgba?\(([^)]+)\)/i.exec(v);
    if (!m) return v;
    const p = m[1].split(/[ ,/]+/).map(parseFloat);
    if (p.length < 3 || p.slice(0, 3).some(isNaN)) return v;
    const h = function (n) { return ("0" + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); };
    return "#" + h(p[0]) + h(p[1]) + h(p[2]);
  }
  function flatColor(el, prop) {
    // Resolved paint; none / transparent / gradient url() -> null (caller decides).
    let v = "";
    try { v = getComputedStyle(el)[prop]; } catch (e) {}
    v = (v || el.getAttribute(prop) || "").trim();
    if (!v || v === "none" || v === "transparent" || /^url\(/i.test(v)) return null;
    if (/rgba?\([^)]*[,/]\s*0(\.0+)?\s*\)$/i.test(v)) return null;   // fully transparent
    return toHex(v);
  }
  // A <g> must stay whole when its clip/mask/opacity/filter would break if we
  // pulled its children out; a plain wrapper group we descend through so its parts
  // separate into their own pieces.
  function isAtomicGroup(g) {
    if (g.getAttribute("clip-path") || g.getAttribute("mask") || g.getAttribute("filter")) return true;
    const op = g.getAttribute("opacity");
    return op !== null && parseFloat(op) < 1;
  }
  function collectPieces(node, acc) {
    for (let i = 0; i < node.children.length && acc.length < FLAT_MAX_SHAPES; i++) {
      const el = node.children[i], tag = el.tagName.toLowerCase();
      if (SKIP_TAGS[tag]) continue;
      if (tag === "g") { if (isAtomicGroup(el)) acc.push(el); else collectPieces(el, acc); }
      else if (DRAW_TAGS[tag]) acc.push(el);
    }
    return acc;
  }
  // Copy resolved paint onto a clone so it still looks right once pulled out of any
  // inherited context. "none" is kept on purpose: that is how see-through parts and
  // stroked "holes" are made.
  function bakePaint(clone, src) {
    let cs = null;
    try { cs = getComputedStyle(src); } catch (e) {}
    if (!cs) return;
    PAINT_PROPS.forEach(function (p) {
      let v = (cs.getPropertyValue(p) || "").trim();
      if (!v || v === "normal") return;
      if (/^url\(/i.test(v)) v = "#888888";        // gradient/pattern we don't keep
      else if (/^rgb/i.test(v)) v = toHex(v);
      clone.setAttribute(p, v.replace(/px/g, ""));  // SVG attrs take unitless lengths
    });
  }
  // Pull the defs a piece references into the piece itself, with per-piece-unique
  // ids so two pieces sharing a clip never cross-talk after one is moved.
  function inlineDefs(markup, root, uid) {
    const seen = {};
    function suffix(id) { if (!(id in seen)) seen[id] = id + "__p" + uid; return seen[id]; }
    // Rewrite BOTH paint refs (url(#id): clip/mask/fill) and template refs
    // (href="#id": <use>) so nothing points at an id we didn't carry along.
    function rewrite(str) {
      return str
        .replace(/url\(#([^)\s"']+)\)/g, function (_, id) { return "url(#" + suffix(id) + ")"; })
        .replace(/((?:xlink:)?href)\s*=\s*"#([^"]+)"/g, function (_, attr, id) { return attr + '="#' + suffix(id) + '"'; });
    }
    const out = rewrite(markup);
    // Inline every referenced def, then follow refs THOSE defs contain in turn
    // (e.g. a <use> pointing at a <g>), each with a per-piece-unique id.
    let defs = "", done = {}, pending = Object.keys(seen);
    while (pending.length) {
      pending.forEach(function (id) {
        if (done[id]) return;
        done[id] = true;
        const def = root.querySelector('[id="' + id.replace(/["\\]/g, "") + '"]');
        if (!def) return;
        const c = def.cloneNode(true);
        c.setAttribute("id", seen[id]);
        defs += rewrite(new XMLSerializer().serializeToString(c));   // may register more ids
      });
      pending = Object.keys(seen).filter(function (id) { return !done[id]; });
    }
    return defs ? ("<defs>" + defs + "</defs>" + out) : out;
  }
  function flattenSvg(svgText) {
    const clean = sanitizeSvg(svgText);
    if (!clean) return null;
    // Off-screen but rendered (not display:none), so the geometry APIs work.
    const holder = document.createElement("div");
    holder.setAttribute("style", "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;");
    holder.innerHTML = clean;
    const root = holder.querySelector("svg");
    if (!root) return null;
    document.body.appendChild(holder);
    let out = [];
    try {
      let vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(parseFloat);
      if (vb.length !== 4 || !vb.every(isFinite) || vb[2] <= 0 || vb[3] <= 0) {
        const w = parseFloat(root.getAttribute("width")) || 64, h = parseFloat(root.getAttribute("height")) || 64;
        vb = [0, 0, w, h];
      }
      // viewBox units -> 0..64, aspect-preserving and centred (same "meet" fit as
      // the as-is preview), folded onto each piece's baked CTM.
      const s = Math.min(64 / vb[2], 64 / vb[3]) || 1;
      const fit = { a: s, b: 0, c: 0, d: s, e: (64 - vb[2] * s) / 2 - vb[0] * s, f: (64 - vb[3] * s) / 2 - vb[1] * s };
      const els = collectPieces(root, []);
      for (let i = 0; i < els.length && out.length < FLAT_MAX_SHAPES; i++) {
        const el = els[i], tag = el.tagName.toLowerCase();
        const ctm = el.getCTM && el.getCTM();
        if (!ctm) continue;   // not rendered
        const M = matMul(fit, { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f });
        const axis = Math.abs(M.b) < 1e-3 && Math.abs(M.c) < 1e-3;   // no rotation/skew
        const fill = flatColor(el, "fill"), stroke = flatColor(el, "stroke");
        const num = function (a) { return parseFloat(el.getAttribute(a)) || 0; };
        // Native editable shape only for a plain solid-filled primitive with no
        // stroke or clip and an axis-aligned transform (visually identical, and you
        // get full reshape/recolour). Anything else is kept verbatim.
        const simple = axis && fill && !stroke && !el.getAttribute("clip-path") && !el.getAttribute("mask");
        if (simple && tag === "rect") {
          const c0 = matAt(M, num("x"), num("y")), c1 = matAt(M, num("x") + num("width"), num("y") + num("height"));
          out.push({ type: "rect", x: rnd(clamp(Math.min(c0[0], c1[0]))), y: rnd(clamp(Math.min(c0[1], c1[1]))),
                     w: rnd(Math.abs(c1[0] - c0[0])), h: rnd(Math.abs(c1[1] - c0[1])), rx: rnd(Math.abs(num("rx") * M.a)), fill: fill });
        } else if (simple && tag === "circle") {
          const c = matAt(M, num("cx"), num("cy")), rx = Math.abs(num("r") * M.a), ry = Math.abs(num("r") * M.d);
          if (Math.abs(rx - ry) < 0.5) out.push({ type: "circle", cx: rnd(clamp(c[0])), cy: rnd(clamp(c[1])), r: rnd(rx), fill: fill });
          else out.push({ type: "ellipse", cx: rnd(clamp(c[0])), cy: rnd(clamp(c[1])), rx: rnd(rx), ry: rnd(ry), fill: fill });
        } else if (simple && tag === "ellipse") {
          const c = matAt(M, num("cx"), num("cy"));
          out.push({ type: "ellipse", cx: rnd(clamp(c[0])), cy: rnd(clamp(c[1])), rx: rnd(Math.abs(num("rx") * M.a)), ry: rnd(Math.abs(num("ry") * M.d)), fill: fill });
        } else {
          // Raw piece: keep the markup exactly, place it with the baked matrix.
          let bb; try { bb = el.getBBox(); } catch (e) { bb = null; }
          if (!bb || (!bb.width && !bb.height)) continue;
          const clone = el.cloneNode(true);
          clone.removeAttribute("transform");
          bakePaint(clone, el);
          // Carry any referenced defs into the piece: url(#) (clip/mask) AND
          // href="#" (a <use>'s template). A plain <use href> has no url(), so this
          // must run unconditionally or its target dangles and the piece vanishes.
          let markup = inlineDefs(new XMLSerializer().serializeToString(clone), root, i);
          out.push({ type: "raw", markup: markup, m: [M.a, M.b, M.c, M.d, M.e, M.f], bx: bb.x, by: bb.y, bw: bb.width, bh: bb.height });
        }
      }
    } catch (e) { out = []; }
    try { document.body.removeChild(holder); } catch (e) {}
    return out.length ? out : null;
  }
  function reflectImport() {
    const b = document.getElementById("asset-breakup");
    if (b) b.hidden = !importedSvg;
  }
  function breakupImported() {
    if (!importedSvg) return;
    const flat = flattenSvg(importedSvg);
    if (!flat || !flat.length) {
      showMsg("Couldn't find separable parts in this one. It's still fine to publish as-is.", false);
      return;
    }
    shapes = flat; importedSvg = null; selected = -1; pathPts = [];
    reflectImport(); render();
    showMsg("Split into " + flat.length + " piece" + (flat.length === 1 ? "" : "s") + " you can move, stretch or delete. Curvy parts keep their exact shape. Then publish.", true);
  }
  const breakupBtn = document.getElementById("asset-breakup");
  if (breakupBtn) breakupBtn.addEventListener("click", breakupImported);
  PWL.assetStudio = { flatten: flattenSvg };

  render();
  renderRecent();
  setPublishLabel();
  reflectImport();
  if (PWL.configured && sb) {
    loadLibrary();
    if (PWL.auth && PWL.auth.onChange) PWL.auth.onChange(function () { loadLibrary(); });
  }
})();
