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
  }

  // ---- render the canvas + previews ----
  function render() {
    let svg = shapes.map(shapeSvg).join("");
    if (selected >= 0 && shapes[selected]) {
      const b = bbox(shapes[selected]);
      svg += '<rect x="' + rnd(b.x) + '" y="' + rnd(b.y) + '" width="' + rnd(b.w) + '" height="' + rnd(b.h) +
             '" fill="none" stroke="#4f46e5" stroke-width="0.8" stroke-dasharray="2 1.5" vector-effect="non-scaling-stroke"/>';
    }
    stage.innerHTML = svg;
    const uri = dataUri(toSvg());
    previews.forEach(function (img) { if (img) img.src = uri; });
  }

  // ---- pointer coordinates in the 0..64 canvas space ----
  function toStage(e) {
    const r = stage.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * 64), y: clamp((e.clientY - r.top) / r.height * 64) };
  }

  let drawing = null;   // { startX, startY, shape } while drawing
  let dragging = null;  // { lastX, lastY } while moving a selection

  stage.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    const p = toStage(e);
    if (tool === "select") {
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
    if (!drawing && !dragging) return;
    const p = toStage(e);
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
      drawing = null;
      render();
    }
    dragging = null;
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

  // ---- tools + colours ----
  document.getElementById("asset-toolbar").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-tool]");
    if (!btn) return;
    tool = btn.getAttribute("data-tool");
    document.querySelectorAll(".asset-tool").forEach(function (b) { b.classList.toggle("is-on", b === btn); });
    if (tool !== "select") { selected = -1; render(); }
  });
  PALETTE.forEach(function (c) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "asset-swatch"; b.style.background = c; b.title = c;
    b.addEventListener("click", function () { setColor(c); });
    swatchWrap.appendChild(b);
  });
  function setColor(c) {
    color = c;
    if (colorInput) colorInput.value = /^#[0-9a-f]{6}$/i.test(c) ? c : colorInput.value;
    if (selected >= 0 && shapes[selected]) { snapshot(); shapes[selected].fill = c; render(); }
  }
  if (colorInput) colorInput.addEventListener("input", function () { setColor(colorInput.value); });

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
    if (!shapes.length) return;
    snapshot(); shapes = []; selected = -1; editingId = null; setPublishLabel(); render();
  });

  document.addEventListener("keydown", function (e) {
    if (/input|textarea/i.test((e.target && e.target.tagName) || "")) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else { const k = { v: "select", r: "rect", c: "circle", e: "ellipse", l: "line", t: "triangle" }[e.key.toLowerCase()];
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
    if (!shapes.length) { showMsg("Draw something first.", false); return; }
    const svg = toSvg();
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
      '<img class="asset-card-pic" alt="" src="' + esc(dataUri(a.svg)) + '" />' +
      '<span class="asset-card-id">#' + a.id + '</span>' +
      '<span class="asset-card-name"></span>' +
      (mine ? '<button type="button" class="asset-card-del" title="Delete">×</button>' : "");
    el.querySelector(".asset-card-name").textContent = a.name || "untitled";
    el.querySelector(".asset-card-pic").addEventListener("click", function () {
      // Click a sprite to copy the line that uses it.
      const snippet = "game.sprite(" + a.id + ", 100, 100, asset=True)";
      try { navigator.clipboard.writeText(snippet); showMsg("Copied: " + snippet, true); } catch (e) { showMsg(snippet, true); }
      if (mine) loadIntoEditor(a);
    });
    if (mine) el.querySelector(".asset-card-del").addEventListener("click", async function (ev) {
      ev.stopPropagation();
      if (!confirm("Delete asset #" + a.id + "? Games using it will lose it.")) return;
      const r = await sb.from("assets").delete().eq("id", a.id);
      if (!r.error) { if (editingId === a.id) { editingId = null; setPublishLabel(); } loadLibrary(); }
    });
    return el;
  }
  function loadIntoEditor(a) {
    try {
      const parsed = parseSvg(a.svg);
      if (parsed) { snapshot(); shapes = parsed; selected = -1; editingId = a.id; nameInput.value = a.name || ""; setPublishLabel(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    } catch (e) {}
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
    doc.querySelectorAll("rect,circle,ellipse,line,polygon").forEach(function (n) {
      const t = n.tagName.toLowerCase(), f = n.getAttribute("fill") || n.getAttribute("stroke") || "#000";
      const num = function (a) { return parseFloat(n.getAttribute(a)) || 0; };
      if (t === "rect") out.push({ type: "rect", x: num("x"), y: num("y"), w: num("width"), h: num("height"), rx: num("rx"), fill: f });
      else if (t === "circle") out.push({ type: "circle", cx: num("cx"), cy: num("cy"), r: num("r"), fill: f });
      else if (t === "ellipse") out.push({ type: "ellipse", cx: num("cx"), cy: num("cy"), rx: num("rx"), ry: num("ry"), fill: f });
      else if (t === "line") out.push({ type: "line", x1: num("x1"), y1: num("y1"), x2: num("x2"), y2: num("y2"), width: parseFloat(n.getAttribute("stroke-width")) || 4, fill: f });
      else if (t === "polygon") { const pts = (n.getAttribute("points") || "").trim().split(/\s+/).map(function (p) { return p.split(",").map(parseFloat); });
        if (pts.length >= 3) { const xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
          const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys); out.push({ type: "triangle", x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y, fill: f }); } }
    });
    return out;
  }

  render();
  setPublishLabel();
  if (PWL.configured && sb) {
    loadLibrary();
    if (PWL.auth && PWL.auth.onChange) PWL.auth.onChange(function () { loadLibrary(); });
  }
})();
