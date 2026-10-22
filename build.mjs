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

/* Absolute, because a social preview card cannot be a relative path: the
 * scraper fetching it is Discord's or Google's, not a browser sitting on the
 * page. Everything under {{social}} is built from this. */
const SITE = "https://play.pyweblib.org";
const CARD_DIR = "/assets/og/";
const DEFAULT_CARD = "og-default.png";

/* Cloudflare Web Analytics. Cookieless, no fingerprinting and nothing stored
 * per person, so it needs no consent banner and the privacy policy's "no
 * tracking cookies" stays true. It answers the only question we actually have:
 * whether anyone outside this school is finding the guides.
 *
 * The token is public by design. It names the site being counted, not the
 * account, and it has to reach the browser to work.
 *
 * Empty string turns it off and emits nothing, the same bargain
 * supabase-config.js makes: clone this repo, build it, and you get a working
 * site that reports to nobody. IMPORTANT: a token is tied to ONE hostname, so
 * the school mirror must not ship this one. sync-mirror.ps1 swaps it out. */
const ANALYTICS_TOKEN = "418c9dadd19b4d168004f4e47076039c";

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

/* Anything going into an HTML attribute. The page titles carry pipes and
 * ampersands already, and one apostrophe or quote in a future description
 * would otherwise end the attribute early and mangle the card. */
const attr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
           .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Canonical URL, Open Graph and Twitter tags, for every page.
 *
 * WHY THIS IS BUILT AND NOT WRITTEN. Exactly one page (game/) had these,
 * hand-written as a 14-line escaped string inside its front matter, so every
 * other link to this site rendered in Discord, WhatsApp and Slack as a bare
 * grey URL with no title and no picture. Thirteen more hand-copied blocks is
 * how the header drifted in the first place. The build already knows a page's
 * URL, title and description, which is all a card needs, so the only thing a
 * page has to say is which picture to use.
 *
 * Front matter:
 *   card         file in assets/og/, default og-default.png
 *   cardAlt      alt text for it
 *   ogTitle      social headline, when the <title> is too long or too dull
 *   ogDesc       social blurb, when the meta description is too long
 *   noindex      true to ask search engines to skip the page
 */
function social(page, pagePath) {
  const url = SITE + pagePath;
  const card = SITE + CARD_DIR + (page.card || DEFAULT_CARD);
  const title = page.ogTitle || page.title;
  const desc = page.ogDesc || page.description;
  const alt = page.cardAlt || "PyWebLib: real Python in your browser.";
  const tags = [
    ['<link rel="canonical" href="' + attr(url) + '" />'],
    page.noindex ? ['<meta name="robots" content="noindex, follow" />'] : [],
    ['<meta property="og:type" content="website" />'],
    ['<meta property="og:site_name" content="PyWebLib" />'],
    ['<meta property="og:url" content="' + attr(url) + '" />'],
    ['<meta property="og:title" content="' + attr(title) + '" />'],
    ['<meta property="og:description" content="' + attr(desc) + '" />'],
    ['<meta property="og:image" content="' + attr(card) + '" />'],
    ['<meta property="og:image:width" content="1200" />'],
    ['<meta property="og:image:height" content="630" />'],
    ['<meta property="og:image:alt" content="' + attr(alt) + '" />'],
    ['<meta name="twitter:card" content="summary_large_image" />'],
    ['<meta name="twitter:title" content="' + attr(title) + '" />'],
    ['<meta name="twitter:description" content="' + attr(desc) + '" />'],
    ['<meta name="twitter:image" content="' + attr(card) + '" />'],
    ['<meta name="twitter:image:alt" content="' + attr(alt) + '" />'],
  ].flat();
  return tags.map((t) => "  " + t).join(NL);
}

function render(page, body, outPath) {
  const root = rootFor(outPath);
  const pagePath = "/" + outPath.split(sep).slice(0, -1).map((s) => s + "/").join("");
  const fill = {
    title: page.title,
    description: page.description,
    root,
    nav: nav(pagePath),
    social: social(page, pagePath),
    // Last script on the page, and a module so it defers: counting a visit
    // must never hold up Pyodide or the editor.
    analytics: ANALYTICS_TOKEN
      ? '  <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js"' + NL +
        "          data-cf-beacon='{\"token\": \"" + ANALYTICS_TOKEN + "\"}'></script>"
      : "",
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
const urls = [];

/* Both modes go through here, so --check compares exactly what a build
 * would write, sitemap included. */
function emit(outPath, text) {
  if (check) {
    let current = null;
    try { current = lf(readFileSync(outPath, "utf8")); } catch { /* new file */ }
    if (current !== text) { differs++; console.log("  DIFFERS  " + outPath); }
    else console.log("  same     " + outPath);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.log("  wrote    " + outPath);
  }
}

for (const srcPath of pages()) {
  const [meta, body] = split(lf(readFileSync(srcPath, "utf8")));
  const outPath = outputFor(srcPath);
  emit(outPath, render(meta, body, outPath));
  if (!meta.noindex) {
    urls.push(SITE + "/" + outPath.split(sep).slice(0, -1).map((s) => s + "/").join(""));
  }
  built++;
}

/* The sitemap, from the pages the build just wrote.
 *
 * WHY GENERATED. The site had none at all, so the five docs pages, the
 * community gallery and the leaderboard were left for Google to find on its
 * own. A hand-written one would be a fifteenth copy of the page list to keep
 * in step, and the first thing to go stale.
 *
 * No <lastmod>, <changefreq> or <priority>. Google ignores the last two
 * outright, and a lastmod can only be honest here if it tracks each page's
 * real edit: taking it from git makes the committed sitemap disagree with the
 * commit that writes it, and taking it from the clock makes every page claim
 * to change on every build. A wrong lastmod is worse than none, because it
 * teaches the crawler to stop believing the file.
 *
 * Pages carrying noindex are left out: asking for a page to be indexed and
 * telling it not to be is a contradiction Search Console reports as an error.
 */
emit("sitemap.xml",
  '<?xml version="1.0" encoding="UTF-8"?>' + NL +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + NL +
  urls.map((u) => "  <url>" + NL + "    <loc>" + u + "</loc>" + NL + "  </url>").join(NL) + NL +
  "</urlset>" + NL);

/* llms.txt and llms-full.txt: the docs in plain text, for AI assistants.
 *
 * WHY. People ask ChatGPT and Claude for help with `import game`, and without
 * this the assistant guesses pygame, which is a different library. The Docs
 * page can't help: it is drawn by docs.js in the browser, and AI crawlers
 * mostly don't run JavaScript, so to them it is an empty page. These two files
 * are the llms.txt convention (llmstxt.org): a short map of the site, and the
 * whole reference in one fetch.
 *
 * Both are built from the DOCS array in docs.js, so the reference still lives
 * in exactly one place. It is a plain data literal, so it can be cut out of the
 * file and evaluated without a browser. */
function docsData() {
  const src = lf(readFileSync("docs.js", "utf8"));
  const start = src.indexOf("var DOCS = [");
  const end = src.indexOf(NL + "  ];", start);
  if (start < 0 || end < 0) throw new Error("could not find the DOCS array in docs.js");
  return new Function("return " + src.slice(start + "var DOCS = ".length, end + 4))();
}

/* The one-function pages: src/docs/<library>/<name>.html. */
function fnPages() {
  const out = [];
  for (const srcPath of pages(join(SRC, "docs"))) {
    const rel = relative(join(SRC, "docs"), srcPath).split(sep);
    if (rel.length !== 2) continue;
    const [meta] = split(lf(readFileSync(srcPath, "utf8")));
    const path = "/docs/" + rel[0] + "/" + rel[1].replace(/\.html$/, "") + "/";
    out.push({ lib: rel[0], path, title: meta.title.replace(/\s*\|.*$/, ""), description: meta.description });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const DOCS = docsData();
const FNS = fnPages();
const pageFor = (href) => SITE + "/docs/" + href;

const LLMS_INTRO = [
  "PyWebLib (https://play.pyweblib.org) runs real Python 3 in the web browser (Pyodide), with no install.",
  "It is used in schools to learn Python, and adds its own libraries on top of standard Python:",
  "",
  "- `game`: a 2D game library (sprites, keys, mouse, collisions, sound, saving, per-game leaderboards).",
  "- `turtle`: turtle drawing, like desktop Python's turtle.",
  "- `game3d`: simple 3D games (shapes, a camera, the same game loop).",
  "- `net`: multiplayer, used together with `game`.",
  "",
  "Important when writing code for PyWebLib:",
  "",
  "- `import game` is PyWebLib's OWN library. It is NOT pygame and has a different API. Do not use pygame calls.",
  "- Every game has the same shape: `game.window(w, h)`, make sprites, then `while game.playing():` ... `game.frame()`.",
  "- Coordinates are pixels from the top-left of the game window; y grows DOWNWARD. Sprites are positioned by their centre.",
  "- `game.frame()` draws one frame and waits (30 fps by default). Put it at the end of the loop.",
  "- Code runs in the Playground at https://play.pyweblib.org. Programs can be published to the community gallery.",
];
const MIN_GAME = [
  "```python",
  "import game",
  "",
  "game.window(480, 360)",
  'player = game.sprite("chicken", 240, 300, size=52)',
  "",
  "while game.playing():",
  '    if game.pressed("left"):',
  "        player.x = player.x - 5",
  '    if game.pressed("right"):',
  "        player.x = player.x + 5",
  "    game.frame()",
  "```",
];

emit("llms.txt", [
  "# PyWebLib",
  "",
  "> Real Python in the browser, with its own beginner-friendly game, turtle, 3D and multiplayer libraries.",
  "",
  ...LLMS_INTRO,
  "",
  "A minimal game:",
  "",
  ...MIN_GAME,
  "",
  "## Docs",
  "",
  "- [Full reference (plain text)](" + SITE + "/llms-full.txt): every function in every library, with an example each. Read this first.",
  "- [Game library guide](" + SITE + "/docs/game/): a hands-on walkthrough of making a game.",
  "- [Turtle guide](" + SITE + "/docs/turtle/): drawing with turtle.",
  "- [Multiplayer guide](" + SITE + "/docs/net/): the net library.",
  ...(FNS.length ? ["", "## Function pages", "", ...FNS.map((f) =>
    "- [" + f.title + "](" + SITE + f.path + "): " + f.description)] : []),
  "",
].join(NL));

emit("llms-full.txt", [
  "# PyWebLib reference",
  "",
  ...LLMS_INTRO,
  "",
  "A minimal game:",
  "",
  ...MIN_GAME,
  "",
  ...DOCS.flatMap((sec) => [
    "## " + sec.name,
    "",
    ...(sec.blurb ? [sec.blurb + (sec.blurbLink ? pageFor(sec.blurbLink.href) + "." : ""), ""] : []),
    ...sec.items.flatMap((it) => [
      "### `" + it.sig + "`",
      "",
      it.desc,
      ...(it.page ? ["", "Full page: " + pageFor(it.page)] : []),
      ...(it.ex ? ["", "```python", it.ex, "```"] : []),
      "",
    ]),
  ]),
].join(NL));

console.log(NL + built + " page(s), " + urls.length + " in the sitemap" +
            (check ? ", " + differs + " differing" : ", written"));
if (check && differs) process.exit(1);
