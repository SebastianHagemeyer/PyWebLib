#!/usr/bin/env node
/*
 * Build the static pages from src/.
 *
 * WHY THIS EXISTS. Thirteen pages each carried their own copy of the head, the
 * header and the footer: 496 of 1569 HTML lines, 32% of the markup, and up to
 * 69% on a short page. Copies drift, and these already had:
 *
 *   - three docs/ pages missing <link rel="manifest"> and two favicon sizes
 *   - footers disagreeing on whether Privacy/Terms links exist at all
 *   - the same three docs pages missing "Assets" from the nav, which only
 *     showed with JS off because auth.js rebuilt the nav at runtime
 *
 * None of that is anyone being careless. It is what hand-copied chrome does.
 *
 * NO DEPENDENCIES, ON PURPOSE. Node's fs and nothing else. This is a public
 * teaching repo: no npm install, no node_modules, no lockfile, and a student
 * can still clone it and open a file. The built pages are committed alongside
 * their source, so GitHub Pages needs no CI and what is served is what is in
 * the repo.
 *
 *   node build.mjs           write the pages
 *   node build.mjs --check   build to memory and diff against what is on disk,
 *                            exit 1 on any difference. Nothing is written.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const SRC = "src";
const NL = "\n";

/* Everything is handled in LF and compared in LF.
 *
 * git's core.autocrlf hands out CRLF working files on Windows, but the nav and
 * script blocks below are joined with \n, so the output came out MIXED: CRLF
 * from the template, LF from the generated parts. --check then compared that
 * against a pure-CRLF file on disk and reported all 13 pages as drifted every
 * single time, which makes the check worthless. Normalise going in and compare
 * normalised, so the answer is about content and never about line endings. */
const lf = (s) => s.replace(/\r\n/g, "\n");
const LAYOUT = lf(readFileSync(join(SRC, "_layout.html"), "utf8"));
const NAV = JSON.parse(readFileSync(join(SRC, "_nav.json"), "utf8"));

const CARET =
  '<svg class="nav-caret" viewBox="0 0 10 10" aria-hidden="true">' +
  '<path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* Front matter is a JSON object in an HTML comment at the top of the page, so
 * the source file stays valid HTML that an editor will still highlight. */
function split(text) {
  // Stop at the end of the comment's line. A trailing \s* would eat the
  // indentation off the first line of the body as well.
  const m = text.match(/^<!--\s*(\{[\s\S]*?\})\s*-->[ \t]*\r?\n/);
  if (!m) throw new Error("page has no front matter");
  return [JSON.parse(m[1]), text.slice(m[0].length)];
}

/* "" at the root, "../" one deep, "../../" two deep. Getting this wrong by
 * hand is what made the headers diverge in the first place. */
function rootFor(outPath) {
  const depth = outPath.split(sep).length - 1;
  return depth === 0 ? "" : "../".repeat(depth);
}

/* The finished nav, dropdowns and active state included.
 *
 * auth.js used to assemble this on every page load: find the Community link by
 * its text, build a dropdown, delete the Assets and Leaderboard anchors, repeat
 * for About, then mark the active item from location.pathname. Roughly sixty
 * lines of DOM surgery recreating identical markup every time, which also left
 * the nav un-enhanced until JS ran and wrong for good without it.
 *
 * The build knows the page's own path, so it writes the answer instead. */
function nav(pagePath) {
  const on = (href) => href === pagePath;
  const out = [];
  for (const l of NAV.links) {
    if (!l.menu) {
      out.push('        <a class="header-link' + (on(l.href) ? " active" : "") +
               '" href="' + l.href + '">' + l.text + "</a>");
      continue;
    }
    // The trigger also lights up when the page is one of its menu items, which
    // is what markActive() did at runtime.
    const hot = on(l.href) || l.menu.some((m) => on(m.href));
    const items = l.menu.map((m) =>
      "            <a" + (on(m.href) ? ' class="active"' : "") +
      ' href="' + m.href + '">' + m.text + "</a>").join(NL);
    out.push(
      '        <div class="nav-dd">' + NL +
      '          <a class="header-link' + (hot ? " active" : "") + '" href="' +
      l.href + '">' + l.text + CARET + "</a>" + NL +
      '          <div class="nav-dd-menu">' + NL + items + NL + "          </div>" + NL +
      "        </div>");
  }
  return out.join(NL);
}

function render(page, body, outPath) {
  const root = rootFor(outPath);
  const pagePath = "/" + outPath.split(sep).slice(0, -1).map((s) => s + "/").join("");
  const fill = {
    title: page.title,
    description: page.description,
    root,
    nav: nav(pagePath),
    head: (page.head || "").trimEnd(),
    // Script paths in front matter are relative to the SITE ROOT, and the
    // build adds the depth. No defer added here: these pages load in order
    // today and a refactor must not quietly change execution timing.
    scripts: (page.scripts || []).map((s) =>
      '  <script src="' +
      (/^(https?:)?\/\//.test(s) || s.startsWith("/") ? s : root + s) +
      '"></script>').join(NL),
    credits: page.credits ? " " + page.credits : "",
    content: body.trimEnd(),
    // Inline scripts live after the footer on some pages. Cutting the body at
    // <footer dropped them, which would have broken the docs pages' data-load
    // buttons and the sprite gallery.
    tail: (page.tail || "").trimEnd(),
  };
  return LAYOUT.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in fill)) throw new Error("unknown slot {{" + k + "}} in _layout.html");
    return fill[k];
  });
}

function pages(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (name.endsWith(".html") && !name.startsWith("_")) out.push(p);
  }
  return out;
}

/* src/index.html -> index.html, src/docs/guide.html -> docs/guide/index.html */
function outputFor(srcPath) {
  const rel = relative(SRC, srcPath).replace(/\.html$/, "");
  return rel === "index" ? "index.html" : join(rel, "index.html");
}

const check = process.argv.includes("--check");
let built = 0, differs = 0;
for (const srcPath of pages()) {
  const [meta, body] = split(lf(readFileSync(srcPath, "utf8")));
  const outPath = outputFor(srcPath);
  const html = render(meta, body, outPath);
  if (check) {
    let current = null;
    try { current = lf(readFileSync(outPath, "utf8")); } catch { /* new page */ }
    if (current !== html) { differs++; console.log("  DIFFERS  " + outPath); }
    else console.log("  same     " + outPath);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    console.log("  wrote    " + outPath);
  }
  built++;
}
console.log(NL + built + " page(s)" + (check ? ", " + differs + " differing" : " written"));
if (check && differs) process.exit(1);
