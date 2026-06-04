# PyPlayground

Run real Python in your browser. No install, no setup, no backend. PyPlayground is a single static page that runs CPython compiled to WebAssembly with [Pyodide](https://pyodide.org), so every line of code executes client-side. It ships with a click-to-load snippet gallery, an editor with syntax highlighting, and a few extras layered on top of stock Python.

> Python Playground online with coloured prints, import time working in sync, and input() working inline.

![Colored spiral](assets/spiral.gif)

## Scope

PyPlayground is deliberately small and self-contained:

- **Static only.** A handful of text files (HTML, one JS file, CSS) plus a favicon. No build step, no server, no database, no accounts.
- **Client-side Python.** Pyodide loads once from a CDN (about 10 MB, cached afterwards) and runs entirely in the browser tab.
- **Made for teaching and tinkering.** Drop it on any static host, share a link, and learners can edit code and press Run.

It is not a full IDE or a hosted notebook. There is no shared file system, no package server, and no persistence beyond your own browser's local storage.

## Examples

Colour, animation, randomness, and interactive input all run as real Python in the page.

**Christmas tree** (random ornaments via `import random`, coloured `print`):

![Christmas tree](assets/tree.gif)

**Heat map dice** (each roll coloured red to green by its value):

![Heat map dice](assets/dice.gif)

There are more in the snippet gallery at the bottom of the page: FizzBuzz, Fibonacci, the Caesar cipher, a Sierpinski triangle, and others.

## Features

- Live editor with syntax highlighting (CodeJar and Prism).
- Real CPython via Pyodide, so `import random`, `math`, `time` and friends just work.
- Interactive `input()` with an inline, terminal-style prompt.
- Coloured output: `print("hi", col="#ff0")` (or `color=`); any CSS colour works.
- A `clear()` builtin to wipe the panel and animate frame by frame.
- Interruptible: a Stop button cancels long loops and sleeps. `Ctrl+Enter` runs.
- Snippet gallery: click a card to load an example.
- Autosave: your code is kept in `localStorage`.

## Quick start

The files are static, but they must be served over http(s). Opening `index.html` as a `file://` URL will not work, because the editor and the WebAssembly runtime are fetched as modules.

On Windows, double-click `serve.bat`. It finds Python, starts a local server, and opens your browser.

Or use any static server:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Deploy by dropping the files on any static host: GitHub Pages, Netlify, Cloudflare Pages, and so on. There is no build step.

## How it works

- Pyodide (CPython to WebAssembly) loads from the jsDelivr CDN on the first Run, then the browser caches it.
- CodeJar provides the editable area; Prism highlights it on every keystroke.
- The extras (`input()`, `clear()`, coloured `print`, interruptible `sleep`, and the Stop button) are layered onto stock Python at runtime. See the `PY_INSTALL_*` strings in `sandbox.js`.

## Browser support

Interactive `input()` needs WebAssembly JSPI (stack switching), available in Chrome and Edge 137 and newer. Everything else works in any modern browser; without JSPI, `input()` shows a friendly message instead of hanging.

## Customising

- Starter code: edit `DEFAULT_CODE` near the top of `sandbox.js`.
- Snippets: add objects to the `EXAMPLES` array in `sandbox.js`.
- Colours: tweak the CSS variables in `:root` at the top of `styles.css`.

## License

Released under CC0 1.0 (public domain), see [LICENSE](LICENSE). Do whatever you like with it. PyPlayground loads Pyodide, CodeJar, and Prism from a CDN; each is under its own permissive license.
