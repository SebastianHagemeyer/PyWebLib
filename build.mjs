#!/usr/bin/env node
/*
 * Build the static pages from src/.
 *
 * WHY THIS EXISTS. Thirteen pages each carried their own copy of the head, the
 * header and the footer: 496 of 1569 HTML lines, 32% of the markup, and up to
 * 69% on a short page. Copies drift, and these already had:
 *
 *   - the three docs/ subpages missing the "Assets" nav link
 *   - the same three missing <link rel="manifest"> and two favicon sizes
 *   - footers disagreeing on whether Privacy/Terms links exist at all
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
const LAYOUT = readFileSync(join(SRC, "_layout.html"), "utf8");
const NAV = JSON.parse(readFileSync(join(SRC, "_nav.json"), "utf8"));

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

function nav(active) {
  return NAV.links.map((l) => {
    // "active", not "is-active": auth.js reads classList.contains("active")
    // when it rebuilds the nav, and would drop the state otherwise.
    const cls = l.text === active ? "header-link active" : "header-link";
    return `        <a class="${cls}" href="${l.href}">${l.text}</a>`;
  }).join("\n");
}

function render(page, body, outPath) {
  const root = rootFor(outPath);
  const fill = {
    title: page.title,
    description: page.description,
    root,
    nav: nav(page.active || ""),
    head: (page.head || "").trimEnd(),
    // Script paths in front matter are relative to the SITE ROOT, and the
    // build adds the depth. No defer added here: these pages load in order
    // today and a refactor must not quietly change execution timing.
    scripts: (page.scripts || []).map((s) =>
      `  <script src="${/^(https?:)?\/\//.test(s) || s.startsWith("/") ? s : root + s}"></script>`
    ).join("\n"),
    credits: page.credits ? " " + page.credits : "",
    content: body.trimEnd(),
    // Inline scripts live after the footer on some pages. They were
    // silently dropped when the body was cut at <footer, which would
    // have broken the docs pages' data-load buttons and sprite gallery.
    tail: (page.tail || "").trimEnd(),
  };
  return LAYOUT.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in fill)) throw new Error(`unknown slot {{${k}}} in _layout.html`);
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
  const [meta, body] = split(readFileSync(srcPath, "utf8"));
  const outPath = outputFor(srcPath);
  const html = render(meta, body, outPath);
  if (check) {
    let current = null;
    try { current = readFileSync(outPath, "utf8"); } catch { /* new page */ }
    if (current !== html) {
      differs++;
      console.log(`  DIFFERS  ${outPath}`);
    } else {
      console.log(`  same     ${outPath}`);
    }
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`  wrote    ${outPath}`);
  }
  built++;
}
console.log(`\n${built} page(s)` + (check ? `, ${differs} differing` : " written"));
if (check && differs) process.exit(1);
