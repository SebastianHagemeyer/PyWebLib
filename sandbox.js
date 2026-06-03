(function () {
  "use strict";

  const PYODIDE_VERSION = "0.27.7";
  const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/pyodide.js";
  const CODEJAR_URL = "https://cdn.jsdelivr.net/npm/codejar@4.0.0/dist/codejar.min.js";
  const STORAGE_KEY = "pyplayground-code";

  const DEFAULT_CODE =
    '# Try editing and hit Run.\n' +
    '# Press Ctrl+Enter to run, Tab to indent.\n\n' +
    'print("Hello, PyPlayground!")\n\n' +
    '# A loop\n' +
    'for i in range(5):\n' +
    '    print("Number:", i, "squared is", i ** 2)\n\n' +
    '# A list\n' +
    'names = ["Ava", "Saxon", "Kamran"]\n' +
    'for name in names:\n' +
    '    print("Hey,", name + "!")\n\n' +
    '# Maths\n' +
    'total = sum(range(1, 11))\n' +
    'print("Sum of 1 to 10 is", total)\n';

  // Click-to-load snippets. Each gets a card at the bottom of the page.
  const EXAMPLES = [
    {
      title: "Star triangle",
      desc: "Right-aligned stars climbing up.",
      code:
        "x = 1\n" +
        "while x < 10:\n" +
        "    print('%10s' % ('*' * x))\n" +
        "    x = x + 1\n"
    },
    {
      title: "Diamond",
      desc: "Centered stars going up then back down.",
      code:
        "n = 5\n" +
        "for i in range(n):\n" +
        "    print(' ' * (n - i - 1) + '*' * (2 * i + 1))\n" +
        "for i in range(n - 2, -1, -1):\n" +
        "    print(' ' * (n - i - 1) + '*' * (2 * i + 1))\n"
    },
    {
      title: "Times table",
      desc: "The 7 times table, one row at a time.",
      code:
        "n = 7\n" +
        "for i in range(1, 13):\n" +
        "    print(n, 'x', i, '=', n * i)\n"
    },
    {
      title: "FizzBuzz",
      desc: "Count 1 to 20. Fizz, Buzz, FizzBuzz on the multiples.",
      code:
        "for i in range(1, 21):\n" +
        "    if i % 15 == 0:\n" +
        "        print('FizzBuzz')\n" +
        "    elif i % 3 == 0:\n" +
        "        print('Fizz')\n" +
        "    elif i % 5 == 0:\n" +
        "        print('Buzz')\n" +
        "    else:\n" +
        "        print(i)\n"
    },
    {
      title: "Roll a dice",
      desc: "Random rolls, 10 in a row.",
      code:
        "import random\n" +
        "\n" +
        "for i in range(10):\n" +
        "    roll = random.randint(1, 6)\n" +
        "    print('Roll', i + 1, ':', roll)\n"
    },
    {
      title: "Heat map dice",
      desc: "Rolls coloured red (cold) to green (hot) by value.",
      code:
        "import random\n" +
        "import time\n" +
        "\n" +
        "for i in range(10):\n" +
        "    roll = random.randint(1, 6)\n" +
        "    hue = (roll - 1) * 24   # 0=red ... 120=green\n" +
        "    color = f\"hsl({hue}, 100%, 50%)\"\n" +
        "    print(f\"Roll {i+1}: {'*' * roll}  ({roll})\", col=color)\n" +
        "    time.sleep(0.2)\n"
    },
    {
      title: "Letter staircase",
      desc: "Build up a word, one letter per line.",
      code:
        "word = 'PYTHON'\n" +
        "for i in range(1, len(word) + 1):\n" +
        "    print(word[:i])\n"
    },
    {
      title: "Countdown",
      desc: "Ask for a number, then count down to GO!",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"Count down from: \"))\n" +
        "for i in range(n, 0, -1):\n" +
        "    print(i)\n" +
        "    time.sleep(0.5)\n" +
        "print(\"GO!\")\n"
    },
    {
      title: "Loading bar",
      desc: "Animated progress bar filling step by step.",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"How many steps? \"))\n" +
        "for i in range(n + 1):\n" +
        "    print('[' + '=' * i + ' ' * (n - i) + ']')\n" +
        "    time.sleep(0.1)\n" +
        "print(\"Done!\")\n"
    },
    {
      title: "Fibonacci",
      desc: "Each number is the sum of the previous two.",
      code:
        "count = int(input(\"How many Fibonacci numbers? \"))\n" +
        "a, b = 0, 1\n" +
        "for _ in range(count):\n" +
        "    print(a)\n" +
        "    a, b = b, a + b\n"
    },
    {
      title: "Hailstone",
      desc: "Halve if even, 3n+1 if odd. Always reaches 1!",
      code:
        "n = int(input(\"Starting number (try 27): \"))\n" +
        "print(\"Start:\", n)\n" +
        "steps = 0\n" +
        "while n != 1:\n" +
        "    n = n // 2 if n % 2 == 0 else 3 * n + 1\n" +
        "    print(n)\n" +
        "    steps += 1\n" +
        "print(\"Reached 1 in\", steps, \"steps!\")\n"
    },
    {
      title: "Spiral",
      desc: "Watch a grid of digits spiral inward, one cell per frame.",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"Grid size (try 7): \"))\n" +
        "grid = [[' '] * n for _ in range(n)]\n" +
        "x, y, dx, dy = 0, 0, 1, 0\n" +
        "\n" +
        "for i in range(n * n):\n" +
        "    grid[y][x] = str((i + 1) % 10)\n" +
        "    nx, ny = x + dx, y + dy\n" +
        "    if not (0 <= nx < n and 0 <= ny < n) or grid[ny][nx] != ' ':\n" +
        "        dx, dy = -dy, dx\n" +
        "        nx, ny = x + dx, y + dy\n" +
        "    x, y = nx, ny\n" +
        "    # clear() wipes the output panel - then we redraw the whole grid.\n" +
        "    clear()\n" +
        "    for row in grid:\n" +
        "        print(' '.join(row))\n" +
        "    time.sleep(0.05)\n"
    },
    {
      title: "Colored spiral",
      desc: "Animated spiral with a rainbow hue rotating as it draws.",
      code:
        "import time\n" +
        "\n" +
        "n = int(input(\"Grid size (try 7): \"))\n" +
        "grid   = [[' '] * n for _ in range(n)]\n" +
        "colors = [[''] * n for _ in range(n)]\n" +
        "x, y, dx, dy = 0, 0, 1, 0\n" +
        "\n" +
        "for i in range(n * n):\n" +
        "    grid[y][x] = str((i + 1) % 10)\n" +
        "    colors[y][x] = f\"hsl({i * 360 // (n * n)}, 90%, 60%)\"\n" +
        "    nx, ny = x + dx, y + dy\n" +
        "    if not (0 <= nx < n and 0 <= ny < n) or grid[ny][nx] != ' ':\n" +
        "        dx, dy = -dy, dx\n" +
        "        nx, ny = x + dx, y + dy\n" +
        "    x, y = nx, ny\n" +
        "    clear()\n" +
        "    for r in range(n):\n" +
        "        for c in range(n):\n" +
        "            ch = grid[r][c]\n" +
        "            if ch != ' ':\n" +
        "                print(f\"{ch} \", col=colors[r][c], end='')\n" +
        "            else:\n" +
        "                print('. ', col='#444', end='')\n" +
        "        print(col='white')\n" +
        "    time.sleep(0.05)\n"
    },
    {
      title: "Sine wave",
      desc: "An ASCII wave drawn with math.sin().",
      code:
        "import math\n" +
        "\n" +
        "lines = int(input(\"How many lines? (try 40) \"))\n" +
        "for x in range(lines):\n" +
        "    y = math.sin(x / 4) * 10\n" +
        "    print(' ' * int(y + 12) + '*')\n"
    },
    {
      title: "Sierpinski triangle",
      desc: "A fractal pattern from one bitwise trick.",
      code:
        "n = int(input(\"Size - try 8, 16 or 32: \"))\n" +
        "for y in range(n):\n" +
        "    row = ''\n" +
        "    for x in range(n):\n" +
        "        row += '* ' if (x & (n - 1 - y)) == 0 else '  '\n" +
        "    print(row)\n"
    },
    {
      title: "Rainbow print",
      desc: "Colour text with print(\"hi\", col=\"#FF00AA\"). Any CSS colour works.",
      code:
        "# col= takes hex codes, colour names, rgb() or hsl()\n" +
        "print(\"Hello in red!\", col=\"red\")\n" +
        "print(\"Hex teal\",       col=\"#1abc9c\")\n" +
        "print(\"RGB orange\",     col=\"rgb(255, 165, 0)\")\n" +
        "print(\"HSL navy\",       col=\"hsl(220, 100%, 30%)\")\n" +
        "print()\n" +
        "\n" +
        "print(\"Now a rainbow:\")\n" +
        "words  = \"RED ORANGE YELLOW GREEN BLUE INDIGO VIOLET\".split()\n" +
        "colors = ['#ff0000', '#ff7f00', '#ffff00', '#00cc00', '#1e90ff', '#4b0082', '#9400d3']\n" +
        "for w, c in zip(words, colors):\n" +
        "    print(w, col=c)\n"
    },
    {
      title: "Christmas tree",
      desc: "Green tree with random coloured ornaments and a trunk.",
      code:
        "import random\n" +
        "\n" +
        "n = int(input(\"Tree height (try 8): \"))\n" +
        "GREEN = '#0aa84a'\n" +
        "BROWN = '#7b4a1a'\n" +
        "ORNAMENTS = ['#ff2b2b', '#ffd400', '#ff5cb0', '#3aaeff', '#ff8800']\n" +
        "\n" +
        "for i in range(n):\n" +
        "    pad = ' ' * (n - i - 1)\n" +
        "    print(pad, col=GREEN, end='')\n" +
        "    for j in range(2 * i + 1):\n" +
        "        if 0 < j < 2 * i and random.random() < 0.25:\n" +
        "            print('o', col=random.choice(ORNAMENTS), end='')\n" +
        "        else:\n" +
        "            print('*', col=GREEN, end='')\n" +
        "    print(col=GREEN)\n" +
        "\n" +
        "# Trunk\n" +
        "print(' ' * (n - 1), col=BROWN, end='')\n" +
        "print('|||', col=BROWN)\n"
    },
    {
      title: "Caesar cipher",
      desc: "Encode OR decode a secret message by shifting letters.",
      code:
        "choice = input(\"Encode or decode? (e/d): \")\n" +
        "msg = input(\"Your message: \")\n" +
        "shift = int(input(\"Shift by how many letters? \"))\n" +
        "\n" +
        "# Decoding is just encoding in the opposite direction.\n" +
        "if choice.lower().startswith(\"d\"):\n" +
        "    shift = -shift\n" +
        "\n" +
        "out = ''\n" +
        "for ch in msg:\n" +
        "    if ch.isalpha():\n" +
        "        out += chr((ord(ch.upper()) - 65 + shift) % 26 + 65)\n" +
        "    else:\n" +
        "        out += ch\n" +
        "print('Original:', msg)\n" +
        "print('Result:  ', out)\n"
    }
  ];

  // Wires Python's input() to the inline reader below. run_sync blocks the
  // Python program (via JSPI stack switching) until readLine's promise
  // resolves, so input() behaves exactly like a real terminal. The helpers
  // live in a throwaway function so nothing leaks into the student's globals.
  // Flushing stdout/stderr first so that anything just print()ed shows up
  // before the prompt - otherwise back-to-back print()/input() can render
  // out of order in the panel.
  const PY_INSTALL_INPUT = `
import builtins as _b
def _sandbox_install_input():
    import sys
    from pyodide.ffi import run_sync
    from _sandbox_io import readLine
    def input(prompt=""):
        sys.stdout.flush()
        sys.stderr.flush()
        return run_sync(readLine(str(prompt)))
    _b.input = input
_sandbox_install_input()
del _sandbox_install_input, _b
`;

  // Fallback for browsers without JSPI (e.g. Safari): a clear message
  // instead of the old window.prompt() popup.
  const PY_DISABLE_INPUT = `
import builtins as _b
def _sandbox_install_input():
    def input(*args, **kwargs):
        raise RuntimeError(
            "Interactive input() needs Chrome or Edge in this sandbox. "
            "Open this page there, or set a variable instead, e.g. name = 'Alex'"
        )
    _b.input = input
_sandbox_install_input()
del _sandbox_install_input, _b
`;

  // Patches time.sleep to yield back to the JS event loop while sleeping,
  // so anything print()ed before sleep actually shows up in the output
  // panel during the pause instead of all at the end. Same JSPI trick
  // we already use for input(): run_sync suspends Python until the
  // asyncio.sleep promise resolves, freeing JS to repaint in between.
  // Also flushes stdout/stderr so end="" prints aren't stuck in the buffer.
  //
  // Wrapped in an installer so the imports get captured in the closure
  // of _yielding_sleep. A top-level `del` after the def would remove
  // the names from the global namespace, and Python resolves names in
  // function bodies at call time - so the inner function would NameError
  // the first time it ran.
  //
  // Uses sleepMs from _sandbox_io (not asyncio.sleep directly) so the
  // sleep is interruptible by the Stop button - JS can reject the
  // promise to wake Python early with an exception.
  const PY_PATCH_SLEEP = `
def _sandbox_install_sleep():
    import time, sys
    from pyodide.ffi import run_sync
    from _sandbox_io import sleepMs
    def _yielding_sleep(seconds):
        sys.stdout.flush()
        sys.stderr.flush()
        if seconds and seconds > 0:
            run_sync(sleepMs(seconds))
    time.sleep = _yielding_sleep
_sandbox_install_sleep()
del _sandbox_install_sleep
`;

  // Installs a tracing hook that periodically checks a JS-side stop flag
  // and raises KeyboardInterrupt when the user clicks Stop. Without this,
  // tight CPU loops (no sleep / no input) can't be interrupted - run_sync
  // never gets a chance to fire. The counter > N gate keeps overhead low.
  const PY_INSTALL_INTERRUPT = `
def _sandbox_install_interrupt():
    import sys
    from _sandbox_io import shouldStop
    counter = [0]
    def trace(frame, event, arg):
        counter[0] += 1
        if counter[0] >= 500:
            counter[0] = 0
            if shouldStop():
                raise KeyboardInterrupt("Stopped by user")
        return trace
    sys.settrace(trace)
_sandbox_install_interrupt()
del _sandbox_install_interrupt
`;

  // Adds clear() as a Python builtin so students can wipe the output
  // panel and animate things frame by frame. Flushes stdout/stderr
  // first so buffered text doesn't end up appearing AFTER the clear.
  const PY_INSTALL_CLEAR = `
def _sandbox_install_clear():
    import sys, builtins
    from _sandbox_io import clearOutput
    def clear():
        sys.stdout.flush()
        sys.stderr.flush()
        clearOutput()
    builtins.clear = clear
_sandbox_install_clear()
del _sandbox_install_clear
`;

  // Adds a col= keyword to the built-in print(). When provided, the
  // text bypasses stdout and goes straight to the output panel with
  // the colour applied via inline CSS, so any valid CSS colour works
  // (hex, name, rgb(), hsl()). Falls back to the real print() when
  // col is None so all existing prints keep working unchanged. Also
  // accepts color= as an alias.
  const PY_INSTALL_COLOR_PRINT = `
def _sandbox_install_color_print():
    import sys, builtins
    from _sandbox_io import writeColored
    real_print = builtins.print
    def print(*args, col=None, color=None, sep=' ', end='\\n', file=None, flush=False):
        chosen = col if col is not None else color
        if chosen is not None and file is None:
            sys.stdout.flush()
            sys.stderr.flush()
            text = sep.join(str(a) for a in args) + end
            writeColored(text, str(chosen))
        else:
            real_print(*args, sep=sep, end=end, file=file, flush=flush)
    builtins.print = print
_sandbox_install_color_print()
del _sandbox_install_color_print
`;

  let pyodide = null;
  let loadingPromise = null;
  let running = false;
  let jar = null;
  // Set by readLineInteractive / interruptibleSleep while they're awaiting
  // a JS promise. stop() rejects this to unstick Python early.
  let pendingReject = null;
  // Polled by the Python trace hook so tight CPU loops can be interrupted
  // too - cleared on read so user catch-blocks don't loop on KeyboardInterrupt.
  let stopRequested = false;

  const editor   = document.getElementById("sandbox-code");
  const output   = document.getElementById("sandbox-output");
  const runBtn   = document.getElementById("sandbox-run");
  const runLabel = runBtn ? runBtn.querySelector(".sandbox-run-label") : null;
  const resetBtn = document.querySelector(".sandbox-reset");
  const clearBtn = document.querySelector(".sandbox-clear");

  if (!editor || !output || !runBtn) return;

  function getCode() {
    return jar ? jar.toString() : editor.textContent;
  }
  function setCode(code) {
    if (jar) jar.updateCode(code);
    else editor.textContent = code;
  }
  function loadCode() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved && saved.length) ? saved : DEFAULT_CODE;
  }
  function saveCode(code) {
    localStorage.setItem(STORAGE_KEY, code == null ? getCode() : code);
  }

  // The Run button doubles as Stop while code is executing. setRunMode
  // flips its label, colour and disabled state. "loading" is the brief
  // initial Pyodide download - it can't be interrupted.
  function setRunMode(mode) {
    const isLoading = mode === "loading";
    const isBusy = mode === "busy" || isLoading;
    if (runLabel) {
      runLabel.textContent = isLoading ? "Loading…" : isBusy ? "Stop" : "Run";
    }
    runBtn.disabled = isLoading;
    runBtn.classList.toggle("is-busy", isBusy);
    runBtn.classList.toggle("btn-primary", !isBusy);
    runBtn.classList.toggle("btn-danger", isBusy && !isLoading);
  }

  function stop() {
    if (!running) return;
    stopRequested = true;
    if (pendingReject) {
      const r = pendingReject;
      pendingReject = null;
      r(new Error("Stopped by user"));
    }
  }

  function appendOut(text, kind) {
    const span = document.createElement("span");
    if (kind) span.className = "out-" + kind;
    span.textContent = text + (text.endsWith("\n") ? "" : "\n");
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
  }
  function clearOut() { output.innerHTML = ""; }

  // Reads one line of input from the student, terminal-style: shows the
  // prompt (if any) inline in the output, drops in a focused text field with
  // a blinking caret, and resolves with the typed text once Enter is pressed.
  // Stop button rejects via pendingReject; the line is then marked [stopped].
  function readLineInteractive(promptText) {
    return new Promise(function (resolve, reject) {
      const line = document.createElement("span");
      line.className = "out-stdin-line";
      if (promptText) line.appendChild(document.createTextNode(promptText));

      const field = document.createElement("input");
      field.type = "text";
      field.className = "sandbox-stdin";
      field.autocomplete = "off";
      field.autocapitalize = "off";
      field.spellcheck = false;
      // Hug the typed text so the flashing cursor (a separate element
      // pinned just after the field) sits right next to the last char.
      // size=1 is the minimum HTML allows; the line-wide mousedown
      // handler below makes click-to-focus work anywhere on the line,
      // so the tight field doesn't hurt clickability.
      field.size = 1;
      line.appendChild(field);

      // Flashing block cursor so it's obvious Python is paused waiting for
      // input, even when input() has no prompt. The native caret is hidden
      // via CSS in favour of this.
      const cursor = document.createElement("span");
      cursor.className = "sandbox-cursor";
      cursor.setAttribute("aria-hidden", "true");
      line.appendChild(cursor);

      output.appendChild(line);
      output.scrollTop = output.scrollHeight;

      function resize() {
        // No +1 padding: that's what made the cursor drift away from text.
        // Math.max with 1 because size=0 is invalid HTML.
        field.size = Math.max(1, field.value.length);
      }
      field.addEventListener("input", resize);
      // Clicking anywhere on the line re-focuses the field, so a stray
      // click in the output panel doesn't leave the prompt unresponsive.
      line.addEventListener("mousedown", function (e) {
        if (e.target !== field) { e.preventDefault(); field.focus(); }
      });

      // Focus immediately, with a microtask fallback. Some Chromium
      // builds need a beat after appendChild before focus sticks.
      // preventScroll keeps focus from fighting the scrollTop set above.
      field.focus({ preventScroll: true });
      Promise.resolve().then(function () { field.focus({ preventScroll: true }); });

      function cleanup() {
        pendingReject = null;
        field.removeEventListener("input", resize);
        field.removeEventListener("keydown", onKey);
      }

      function onKey(e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const value = field.value;
        cleanup();
        // Echo what was typed into the transcript, then drop the live widgets.
        const echo = document.createElement("span");
        echo.className = "out-stdin";
        echo.textContent = value;
        line.replaceChild(echo, field);
        if (cursor.parentNode === line) line.removeChild(cursor);
        line.appendChild(document.createTextNode("\n"));
        output.scrollTop = output.scrollHeight;
        resolve(value);
      }

      pendingReject = function (err) {
        cleanup();
        if (field.parentNode === line) {
          const stop = document.createElement("span");
          stop.className = "out-stderr";
          stop.textContent = "[stopped]";
          line.replaceChild(stop, field);
        }
        if (cursor.parentNode === line) line.removeChild(cursor);
        line.appendChild(document.createTextNode("\n"));
        reject(err);
      };

      field.addEventListener("keydown", onKey);
    });
  }

  // setTimeout-based sleep we can cancel from JS. Used by the patched
  // time.sleep so the Stop button can wake Python early from a long sleep.
  function interruptibleSleep(seconds) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        pendingReject = null;
        resolve();
      }, Math.max(0, seconds * 1000));
      pendingReject = function (err) {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  // JSPI (WebAssembly stack switching) lets input() block on the main thread
  // without freezing the page. Present in Chrome/Edge 137+; not in Safari.
  function jspiSupported() {
    return typeof WebAssembly !== "undefined" &&
      typeof WebAssembly.Suspending === "function";
  }

  async function setupInput(py) {
    py.registerJsModule("_sandbox_io", {
      readLine: readLineInteractive,
      sleepMs: interruptibleSleep,
      // Consume-on-read: the Python trace hook gets True once per Stop
      // click, then we clear it so user try/except blocks don't loop
      // forever on KeyboardInterrupt.
      shouldStop: function () {
        if (!stopRequested) return false;
        stopRequested = false;
        return true;
      },
      // Wipes the output panel - exposed to Python as the clear() builtin
      // so students can animate things frame by frame.
      clearOutput: function () { output.innerHTML = ""; },
      // Writes text directly to the output panel with a CSS colour applied.
      // Used by the col= keyword on the patched print().
      writeColored: function (text, color) {
        const span = document.createElement("span");
        span.style.color = String(color || "");
        span.textContent = String(text);
        output.appendChild(span);
        output.scrollTop = output.scrollHeight;
      }
    });
    const useJspi = jspiSupported();
    await py.runPythonAsync(useJspi ? PY_INSTALL_INPUT : PY_DISABLE_INPUT);
    if (useJspi) {
      await py.runPythonAsync(PY_PATCH_SLEEP);
    }
    await py.runPythonAsync(PY_INSTALL_INTERRUPT);
    await py.runPythonAsync(PY_INSTALL_CLEAR);
    await py.runPythonAsync(PY_INSTALL_COLOR_PRINT);
  }

  function loadPyodideScript() {
    if (window.loadPyodide) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = PYODIDE_URL;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Couldn't reach the Python runtime CDN.")); };
      document.head.appendChild(s);
    });
  }

  async function ensurePyodide() {
    if (pyodide) return pyodide;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async function () {
      setRunMode("loading");
      appendOut("Loading Python runtime (one-time, ~10 MB)…", "info");
      await loadPyodideScript();
      pyodide = await window.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/"
      });
      pyodide.setStdout({ batched: function (s) { appendOut(s, "stdout"); } });
      pyodide.setStderr({ batched: function (s) { appendOut(s, "stderr"); } });
      await setupInput(pyodide);
      appendOut("Python ready. Running your code…", "info");
      return pyodide;
    })();

    return loadingPromise;
  }

  async function run() {
    // The Run button doubles as Stop while we're busy.
    if (running) { stop(); return; }
    running = true;
    stopRequested = false;
    pendingReject = null;
    clearOut();
    setRunMode("busy");
    try {
      const py = await ensurePyodide();
      setRunMode("busy"); // ensurePyodide flips to "loading" on first run
      await py.runPythonAsync(getCode());
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : String(err);
      if (/Stopped by user|KeyboardInterrupt/.test(msg)) {
        appendOut("[stopped]", "info");
      } else {
        appendOut(msg, "stderr");
      }
    } finally {
      running = false;
      stopRequested = false;
      pendingReject = null;
      setRunMode("idle");
    }
  }

  function reset() {
    loadInto(DEFAULT_CODE, "Reset to the example");
  }

  function enableHighlighting(CodeJar) {
    jar = CodeJar(editor, function (el) {
      window.Prism.highlightElement(el);
    }, {
      tab: "    ",
      indentOn: /[(\[{:]\s*$/
    });
    jar.updateCode(loadCode());
    jar.onUpdate(function (code) { saveCode(code); });
  }

  function enablePlainEditor() {
    // Fallback: plain contenteditable, no highlighting.
    editor.contentEditable = "plaintext-only";
    editor.textContent = loadCode();
    editor.addEventListener("input", function () { saveCode(); });
  }

  function initEditor() {
    // Show the starter code immediately so the editor never looks empty
    // while CodeJar streams in.
    editor.textContent = loadCode();

    // CodeJar 4.x is published as an ES module, so a classic <script src>
    // tag can't load it - the browser throws on the top-level `export` and
    // never defines CodeJar. Pull it in with a dynamic import() (which does
    // understand ES modules) and then layer Prism highlighting on top.
    // Fall back to a plain editable area if either piece is unavailable.
    if (!window.Prism) {
      enablePlainEditor();
      return;
    }

    import(CODEJAR_URL)
      .then(function (mod) {
        if (mod && typeof mod.CodeJar === "function") enableHighlighting(mod.CodeJar);
        else enablePlainEditor();
      })
      .catch(function () { enablePlainEditor(); });
  }

  // Ctrl/Cmd + Enter runs the code (works whether CodeJar is loaded or not).
  editor.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  runBtn.addEventListener("click", run);
  if (resetBtn) resetBtn.addEventListener("click", reset);
  if (clearBtn) clearBtn.addEventListener("click", clearOut);

  function renderExamples() {
    const grid = document.getElementById("sandbox-examples");
    if (!grid) return;
    grid.innerHTML = "";
    EXAMPLES.forEach(function (ex) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sandbox-example-card";
      btn.innerHTML =
        '<span class="sandbox-example-title">' + escapeHtml(ex.title) + '</span>' +
        '<span class="sandbox-example-desc">' + escapeHtml(ex.desc) + '</span>';
      btn.addEventListener("click", function () {
        loadInto(ex.code, 'Loaded "' + ex.title + '"');
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.appendChild(btn);
    });
  }

  // Generic "swap the editor for this code, but offer Undo via a toast"
  // helper. Used by both Reset and the snippet cards so the UX is the
  // same everywhere - no more blocking confirm() dialogs.
  let previousCode = null;
  function loadInto(code, message) {
    const cur = getCode();
    if (cur === code) {
      showToast({ message: message + " (already there)" });
      return;
    }
    previousCode = cur;
    setCode(code);
    saveCode(code);
    editor.focus();
    showToast({
      message: message,
      actionLabel: "Undo",
      action: function () {
        if (previousCode == null) return;
        const swap = previousCode;
        previousCode = null;
        setCode(swap);
        saveCode(swap);
      }
    });
  }

  function showToast(opts) {
    let toast = document.getElementById("it-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "it-toast";
      toast.className = "toast";
      document.body.appendChild(toast);
      toast.addEventListener("mouseenter", function () {
        if (toast._timer) { clearTimeout(toast._timer); toast._timer = null; }
      });
      toast.addEventListener("mouseleave", function () {
        toast._timer = setTimeout(hideToast, 3000);
      });
    }
    toast.innerHTML = "";
    const msg = document.createElement("span");
    msg.className = "toast-msg";
    msg.textContent = opts.message;
    toast.appendChild(msg);
    if (opts.action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = opts.actionLabel || "Undo";
      btn.addEventListener("click", function () { opts.action(); hideToast(); });
      toast.appendChild(btn);
    }
    requestAnimationFrame(function () { toast.classList.add("show"); });
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    const toast = document.getElementById("it-toast");
    if (!toast) return;
    toast.classList.remove("show");
    if (toast._timer) { clearTimeout(toast._timer); toast._timer = null; }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  initEditor();
  renderExamples();
})();
