/*
 * Quality-of-life upgrades for every code editor (.sandbox-code) on a page.
 * Load this script before pyrun.js / challenges.js so its key handlers
 * register first. Three features:
 *
 * 1. Block indent: with several lines selected, Tab indents them all by 4
 *    spaces and Shift+Tab un-indents. Shift+Tab also un-indents the current
 *    line with no selection. A plain Tab with no selection is left for the
 *    editor's own handler (insert 4 spaces).
 *
 * 2. Smart backspace: with the caret sitting after nothing but spaces, one
 *    Backspace removes a whole indent level instead of one space at a time.
 *
 * 3. Live indentation checking: a small strip under the editor warns about
 *    the classic crashes BEFORE they run the code: a missing indent after a
 *    ':' line, an unexpected indent, a dedent that lines up with nothing,
 *    and tab characters in the indent. Pure string checks, debounced, so
 *    it costs nothing even on a slow Chromebook.
 */
(function () {
  "use strict";

  // ---- Selection helpers (text offsets inside a contenteditable) ----------

  function selectionOffsets(editor) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer) || !editor.contains(r.endContainer)) return null;
    function offsetOf(node, off) {
      const probe = document.createRange();
      probe.selectNodeContents(editor);
      probe.setEnd(node, off);
      return probe.toString().length;
    }
    return { start: offsetOf(r.startContainer, r.startOffset), end: offsetOf(r.endContainer, r.endOffset) };
  }

  function setSelectionOffsets(editor, start, end) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let pos = 0, node, sNode = null, sOff = 0, eNode = null, eOff = 0;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (!sNode && pos + len >= start) { sNode = node; sOff = start - pos; }
      if (pos + len >= end) { eNode = node; eOff = end - pos; break; }
      pos += len;
    }
    if (!sNode) return;
    if (!eNode) { eNode = sNode; eOff = sNode.textContent.length; }
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- Tab / Shift+Tab block indent ----------------------------------------

  function onTabKey(e) {
    if (e.key !== "Tab") return;
    const editor = e.currentTarget;
    const pos = selectionOffsets(editor);
    if (!pos) return;
    const text = editor.textContent;
    const spansLines = text.slice(pos.start, pos.end).indexOf("\n") !== -1;
    // A plain Tab on a single caret stays with the editor's own handler.
    if (!e.shiftKey && !spansLines) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const lineStart = text.lastIndexOf("\n", pos.start - 1) + 1;
    let lineEnd = text.indexOf("\n", Math.max(pos.end - 1, pos.start));
    if (lineEnd === -1) lineEnd = text.length;

    const lines = text.slice(lineStart, lineEnd).split("\n");
    const newBlock = lines.map(function (l) {
      if (e.shiftKey) return l.replace(/^ {1,4}/, "");
      return l.trim() ? "    " + l : l;
    }).join("\n");

    editor.textContent = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
    if (window.Prism) { try { window.Prism.highlightElement(editor); } catch (err) {} }
    // Let the editor's own machinery (save-on-change etc.) know.
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    setSelectionOffsets(editor, lineStart, lineStart + newBlock.length);
  }

  // ---- Smart backspace -------------------------------------------------------
  // With the caret sitting after nothing but spaces, one Backspace removes a
  // whole indent level (back to the previous multiple of 4) instead of one
  // space at a time, like a proper code editor.
  function onBackspaceKey(e) {
    if (e.key !== "Backspace" || e.ctrlKey || e.metaKey || e.altKey) return;
    const editor = e.currentTarget;
    const pos = selectionOffsets(editor);
    if (!pos || pos.start !== pos.end || pos.start === 0) return;
    const text = editor.textContent;
    const lineStart = text.lastIndexOf("\n", pos.start - 1) + 1;
    const before = text.slice(lineStart, pos.start);
    // Only when the line so far is pure indentation, two spaces or more.
    if (before.length < 2 || /[^ ]/.test(before)) return;
    // Delete back to the previous tab stop: 5 spaces -> 4, 4 -> 0, 3 -> 0.
    const remove = ((before.length - 1) % 4) + 1;
    if (remove < 2) return;
    // Select the spaces and let the native Backspace delete the selection:
    // the browser then handles the caret, undo stack and input events.
    setSelectionOffsets(editor, pos.start - remove, pos.start);
  }

  // ---- Indentation linting ---------------------------------------------------

  // Strips string literals (naively) so brackets/colons inside them don't
  // confuse the checks, then trailing comments.
  function stripStringsAndComments(line) {
    let out = "";
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "#") break;
      out += c;
    }
    return out;
  }

  function lintIndent(code) {
    const problems = [];
    const lines = String(code || "").split("\n");
    const stack = [0];        // indent levels currently open
    let expectDeeper = false; // previous code line ended with ":"
    let colonLine = 0;
    let prevIndent = 0;
    let prevLineNo = 0;
    let bracketDepth = 0;
    let inTriple = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // Triple-quoted strings: skip everything inside them.
      const triples = (raw.match(/'''|"""/g) || []).length;
      if (inTriple) {
        if (triples % 2 === 1) inTriple = false;
        continue;
      }
      if (triples % 2 === 1) inTriple = true;

      const stripped = stripStringsAndComments(raw);
      if (!stripped.trim()) continue; // blank or comment-only line

      // Lines inside unclosed brackets are continuations: don't lint them.
      if (bracketDepth > 0) {
        bracketDepth += (stripped.match(/[([{]/g) || []).length;
        bracketDepth -= (stripped.match(/[)\]}]/g) || []).length;
        if (bracketDepth < 0) bracketDepth = 0;
        continue;
      }

      const leadRaw = raw.match(/^[ \t]*/)[0];
      if (leadRaw.indexOf("\t") !== -1) {
        problems.push({ line: i + 1, msg: "there's a tab character in the indent; use spaces (4 per level)" });
      }
      const indent = leadRaw.replace(/\t/g, "    ").length;

      if (expectDeeper) {
        if (indent <= prevIndent) {
          problems.push({ line: i + 1, msg: 'needs an indent (4 more spaces): line ' + colonLine + ' ends with ":" so the next line belongs inside it' });
          // Recover: pretend the block never opened, keep checking below.
          expectDeeper = false;
          checkAgainstStack(indent, i);
        } else {
          stack.push(indent);
        }
      } else {
        checkAgainstStack(indent, i);
      }

      function checkAgainstStack(ind, lineIdx) {
        if (ind > stack[stack.length - 1]) {
          problems.push({ line: lineIdx + 1, msg: "unexpected indent: this line is deeper than line " + prevLineNo + ', but that line doesn\'t end with ":"' });
          stack.push(ind); // recover so one mistake doesn't cascade
        } else {
          while (stack.length > 1 && stack[stack.length - 1] > ind) stack.pop();
          if (stack[stack.length - 1] !== ind) {
            problems.push({ line: lineIdx + 1, msg: "this indent doesn't line up with any line above it" });
            stack.push(ind);
          }
        }
      }

      bracketDepth += (stripped.match(/[([{]/g) || []).length;
      bracketDepth -= (stripped.match(/[)\]}]/g) || []).length;
      if (bracketDepth < 0) bracketDepth = 0;

      expectDeeper = bracketDepth === 0 && /:\s*$/.test(stripped);
      if (expectDeeper) colonLine = i + 1;
      prevIndent = indent;
      prevLineNo = i + 1;
    }

    // A ":" on the very last line with nothing after it.
    if (expectDeeper) {
      problems.push({ line: colonLine, msg: 'ends with ":" but there\'s nothing indented under it yet' });
    }
    return problems;
  }

  // ---- Used-before-defined checking ------------------------------------------
  // Flags a name that is USED but never given a value ANYWHERE in the program
  // (the classic petyears vs pet_years typo). Built to almost never cry wolf:
  // the "defined" set is collected generously (any assignment, loop target,
  // param, import, etc. counts), the "used" test is conservative, and the whole
  // check switches off on anything dynamic (star imports, exec/eval). It is a
  // gentle nudge, not a real type checker.

  const PY_KEYWORDS = new Set(("False None True and as assert async await break " +
    "class continue def del elif else except finally for from global if import in " +
    "is lambda nonlocal not or pass raise return try while with yield match case").split(" "));

  const PY_BUILTINS = new Set(("print input int str float bool list dict set tuple " +
    "len range sum min max abs round sorted reversed enumerate zip map filter open " +
    "type isinstance issubclass ord chr id repr format hex oct bin ascii all any next " +
    "iter object super property staticmethod classmethod hasattr getattr setattr " +
    "delattr callable bytes bytearray frozenset complex divmod pow slice memoryview " +
    "Exception ValueError TypeError KeyError IndexError ZeroDivisionError NameError " +
    "RuntimeError StopIteration KeyboardInterrupt AttributeError IndexError OverflowError " +
    "NotImplementedError FileNotFoundError " +
    // Sandbox extras and conventional names that are always available here.
    "clear self cls __name__ __main__ True False None").split(/\s+/));

  // Replace every string body and comment with spaces (keeping length and
  // newlines) so identifiers inside them are never seen. Handles triple quotes.
  function stripAll(code) {
    const s = String(code || "");
    let out = "";
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "#") { // comment to end of line
        while (i < s.length && s[i] !== "\n") { out += " "; i++; }
        continue;
      }
      if (c === '"' || c === "'") {
        const triple = s.substr(i, 3) === c + c + c;
        const close = triple ? c + c + c : c;
        out += " ".repeat(close.length);
        i += close.length;
        while (i < s.length) {
          if (s[i] === "\\") { out += s[i] === "\n" ? "\n" : "  "; i += 2; continue; }
          if (!triple && s[i] === "\n") break; // unterminated single-line string
          if (s.substr(i, close.length) === close) { out += " ".repeat(close.length); i += close.length; break; }
          out += s[i] === "\n" ? "\n" : " ";
          i++;
        }
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  function idsIn(str) {
    return (String(str || "").match(/[A-Za-z_]\w*/g) || []);
  }

  function collectDefined(stripped) {
    const defined = new Set();
    const lines = stripped.split("\n");
    let suppress = false;

    if (/\bimport\s+\*/.test(stripped) ||
        /\b(?:exec|eval|globals|locals|vars)\s*\(/.test(stripped)) {
      suppress = true;
    }

    // Program-wide patterns (order/scope-insensitive: defined ANYWHERE counts).
    let m;
    // for TARGETS in ...   (also comprehensions)
    const forRe = /\bfor\s+([^]*?)\s+in\b/g;
    while ((m = forRe.exec(stripped))) idsIn(m[1]).forEach(function (n) { defined.add(n); });
    // ... as NAME   (with/except/import as)
    const asRe = /\bas\s+([A-Za-z_]\w*)/g;
    while ((m = asRe.exec(stripped))) defined.add(m[1]);
    // walrus  NAME :=
    const walrusRe = /([A-Za-z_]\w*)\s*:=/g;
    while ((m = walrusRe.exec(stripped))) defined.add(m[1]);
    // lambda PARAMS :
    const lamRe = /\blambda\b([^:\n]*):/g;
    while ((m = lamRe.exec(stripped))) idsIn(m[1]).forEach(function (n) { defined.add(n); });

    lines.forEach(function (line) {
      const t = line.replace(/^\s+/, "");
      // def NAME(PARAMS)
      let dm = t.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/);
      if (dm) {
        defined.add(dm[1]);
        dm[2].split(",").forEach(function (p) {
          const id = (p.replace(/[:=].*/, "").replace(/[*\s]/g, "").match(/^[A-Za-z_]\w*/) || [])[0];
          if (id) defined.add(id);
        });
        return;
      }
      // class NAME
      let cm = t.match(/^class\s+([A-Za-z_]\w*)/);
      if (cm) { defined.add(cm[1]); return; }
      // import a, b.c as d  /  from m import a, b as c
      let im = t.match(/^import\s+(.+)/);
      if (im) {
        im[1].split(",").forEach(function (part) {
          const seg = part.trim();
          const alias = seg.match(/\bas\s+([A-Za-z_]\w*)/);
          if (alias) defined.add(alias[1]);
          else defined.add((seg.match(/^[A-Za-z_]\w*/) || [])[0]);
        });
        return;
      }
      let fm = t.match(/^from\s+\S+\s+import\s+(.+)/);
      if (fm) {
        fm[1].split(",").forEach(function (part) {
          const seg = part.trim();
          const alias = seg.match(/\bas\s+([A-Za-z_]\w*)/);
          defined.add(alias ? alias[1] : (seg.match(/^[A-Za-z_]\w*/) || [])[0]);
        });
        return;
      }
      // global / nonlocal a, b
      let gm = t.match(/^(?:global|nonlocal)\s+(.+)/);
      if (gm) { idsIn(gm[1]).forEach(function (n) { defined.add(n); }); return; }

      // Assignment: everything left of the LAST depth-0 "=" that isn't
      // ==, !=, <=, >= is targets (handles chains a = b = 5, and augmented
      // += still counts as defining). Kwargs live at depth > 0, so skipped.
      let depth = 0, lastEq = -1;
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === "=" && depth === 0) {
          const prev = line[k - 1], nxt = line[k + 1];
          if (nxt === "=" || prev === "=" || prev === "!" || prev === "<" || prev === ">") { k++; continue; }
          lastEq = k;
        }
      }
      if (lastEq >= 0) idsIn(line.slice(0, lastEq)).forEach(function (n) { defined.add(n); });
    });

    return { defined: defined, suppress: suppress };
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 99;
    const dp = [];
    for (let i = 0; i <= m; i++) dp[i] = [i];
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  }

  function suggestName(name, defined) {
    let best = null, bestD = 3;
    defined.forEach(function (d) {
      if (d === name) return;
      const dist = levenshtein(name.toLowerCase(), d.toLowerCase());
      if (dist < bestD || (dist === bestD && best && d.length > best.length)) { bestD = dist; best = d; }
    });
    return (best && bestD <= 2) ? best : null;
  }

  function lintNames(code) {
    const stripped = stripAll(code);
    const info = collectDefined(stripped);
    if (info.suppress) return [];
    const defined = info.defined;

    // Lines whose identifiers are definitions or module paths, not variable
    // uses: skip flagging anything on them.
    const skipLine = {};
    stripped.split("\n").forEach(function (line, idx) {
      if (/^\s*(?:import|from|global|nonlocal)\b/.test(line) ||
          /^\s*(?:async\s+)?def\b/.test(line) ||
          /^\s*class\b/.test(line)) {
        skipLine[idx] = true;
      }
    });

    const problems = [];
    const seen = {};
    const re = /[A-Za-z_]\w*/g;
    let m;
    // Track line/column incrementally as we scan (matches arrive in order), so
    // this stays O(n) instead of a slice + split for every identifier - the old
    // way went quadratic and ground to a halt on large programs.
    let scanPos = 0, lineNo = 1, lineStart = 0;
    while ((m = re.exec(stripped))) {
      const name = m[0];
      const start = m.index;
      if (/\d/.test(name[0])) continue;
      if (PY_KEYWORDS.has(name) || PY_BUILTINS.has(name) || defined.has(name)) continue;
      if (seen[name]) continue;
      // A letter (f/r/b/u prefixes) sitting right before a quote is a string
      // prefix, not a name: f"...", r'...', rb"...".
      const after = code[start + name.length];
      if ((after === '"' || after === "'") && /^[frbuFRBU]{1,2}$/.test(name)) continue;

      // Which line/column? Advance the counter to this match (see note above).
      while (scanPos < start) { if (stripped.charCodeAt(scanPos) === 10) { lineNo++; lineStart = scanPos + 1; } scanPos++; }
      const line = lineNo;                 // 1-based
      const col = start - lineStart;       // 0-based
      if (skipLine[line - 1]) continue;

      // Attribute access (foo.BAR): skip.
      let p = start - 1;
      while (p >= 0 && stripped[p] === " ") p--;
      if (p >= 0 && stripped[p] === ".") continue;

      // Keyword arg or assignment target (NAME= ... single '='): skip.
      let q = start + name.length;
      while (q < stripped.length && stripped[q] === " ") q++;
      if (stripped[q] === "=" && stripped[q + 1] !== "=") continue;

      seen[name] = true;
      problems.push({ line: line, col: col, name: name, suggestion: suggestName(name, defined) });
    }
    return problems;
  }

  // Wait for a real pause in typing before saying anything, and never flag
  // the line the caret is on (or the one just above a fresh blank line),
  // so kids aren't nagged about code they're mid-way through writing.
  const LINT_DELAY_MS = 1400;
  const MAX_LINT_CHARS = 60000;   // above this, skip hints so a huge file never lags
  const HINTS_KEY = "pwl-editor-hints";
  function hintsOn() { try { return localStorage.getItem(HINTS_KEY) !== "off"; } catch (e) { return true; } }
  const lintRefreshers = [];      // re-run / clear every editor when hints are toggled

  function attachLint(editor) {
    const host = editor.closest(".sandbox-editor") || editor.parentNode;
    const hint = document.createElement("div");
    hint.className = "indent-hint";
    hint.hidden = true;
    host.appendChild(hint);

    // Transparent red wash over the offending line (indentation issues) and a
    // red underline over a single word (used-before-defined). pointer-events:
    // none so neither ever blocks clicks or typing.
    const flag = document.createElement("div");
    flag.className = "indent-flag";
    flag.hidden = true;
    host.appendChild(flag);

    const nameFlag = document.createElement("div");
    nameFlag.className = "name-flag";
    nameFlag.hidden = true;
    host.appendChild(nameFlag);

    let timer = null;
    let flaggedLine = 0;             // line-wash target (indent)
    let flaggedWord = null;          // {line, col, len} word-underline target
    let charW = 0;

    function metrics() {
      const cs = getComputedStyle(editor);
      let lh = parseFloat(cs.lineHeight);
      if (isNaN(lh)) lh = (parseFloat(cs.fontSize) || 14) * 1.5;
      if (!charW) {
        const probe = document.createElement("span");
        probe.style.font = cs.font;
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.whiteSpace = "pre";
        probe.textContent = "0000000000";
        host.appendChild(probe);
        charW = probe.getBoundingClientRect().width / 10;
        host.removeChild(probe);
      }
      return {
        lh: lh,
        padTop: parseFloat(cs.paddingTop) || 0,
        padLeft: parseFloat(cs.paddingLeft) || 0
      };
    }

    function caretLine() {
      const pos = selectionOffsets(editor);
      if (!pos) return -1;
      return editor.textContent.slice(0, pos.start).split("\n").length; // 1-based
    }

    function lineIsBlank(n) {
      const lines = editor.textContent.split("\n");
      return !((lines[n - 1] || "").trim());
    }

    function inView(top, lh) {
      return top >= editor.offsetTop - 1 && top <= editor.offsetTop + editor.clientHeight - lh * 0.5;
    }

    function positionFlag() {
      const mt = metrics();
      if (flaggedLine) {
        const top = editor.offsetTop + mt.padTop + (flaggedLine - 1) * mt.lh - editor.scrollTop;
        if (inView(top, mt.lh)) {
          flag.style.top = top + "px";
          flag.style.height = mt.lh + "px";
          flag.style.left = editor.offsetLeft + "px";
          flag.style.width = editor.clientWidth + "px";
          flag.hidden = false;
        } else { flag.hidden = true; }
      } else { flag.hidden = true; }

      if (flaggedWord && charW) {
        const top = editor.offsetTop + mt.padTop + (flaggedWord.line - 1) * mt.lh - editor.scrollTop;
        const left = editor.offsetLeft + mt.padLeft + flaggedWord.col * charW - editor.scrollLeft;
        if (inView(top, mt.lh) && left >= editor.offsetLeft - 1) {
          nameFlag.style.top = top + "px";
          nameFlag.style.height = mt.lh + "px";
          nameFlag.style.left = left + "px";
          nameFlag.style.width = (flaggedWord.len * charW) + "px";
          nameFlag.hidden = false;
        } else { nameFlag.hidden = true; }
      } else { nameFlag.hidden = true; }
    }

    function clear() {
      hint.hidden = true;
      flaggedLine = 0;
      flaggedWord = null;
      flag.hidden = true;
      nameFlag.hidden = true;
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, LINT_DELAY_MS);
    }

    // Don't nag about the line the caret is on, or a fresh blank line right
    // under it: the student is probably still typing there.
    function notAtCaret(at) {
      return function (p) {
        if (at === -1) return true;
        if (p.line === at) return false;
        if (p.line === at - 1 && lineIsBlank(at)) return false;
        return true;
      };
    }

    function run() {
      timer = null;
      // Off by choice, or too big to be worth it: say nothing.
      if (!hintsOn() || (editor.textContent || "").length > MAX_LINT_CHARS) { clear(); return; }
      const at = caretLine();

      // Indentation problems come first: they stop the whole program running.
      const indent = lintIndent(editor.textContent).filter(notAtCaret(at));
      if (indent.length) {
        const p = indent[0];
        hint.hidden = false;
        hint.textContent = "Line " + p.line + ": " + p.msg +
          (indent.length > 1 ? "  (and " + (indent.length - 1) + " more)" : "");
        flaggedLine = p.line;
        flaggedWord = null;
        positionFlag();
        return;
      }

      // Then used-before-defined names.
      const nameProblems = lintNames(editor.textContent).filter(notAtCaret(at));
      if (nameProblems.length) {
        const p = nameProblems[0];
        let msg = "Line " + p.line + ": " + '"' + p.name + '" is used but never given a value. ';
        msg += p.suggestion
          ? 'Did you mean "' + p.suggestion + '"? Check the spelling.'
          : "Create it first with " + p.name + " = ... , or is it a typo?";
        hint.hidden = false;
        hint.textContent = msg + (nameProblems.length > 1 ? "  (and " + (nameProblems.length - 1) + " more)" : "");
        flaggedLine = 0;
        flaggedWord = { line: p.line, col: p.col, len: p.name.length };
        positionFlag();
        return;
      }

      clear();
    }

    editor.addEventListener("input", schedule);
    editor.addEventListener("keyup", schedule);
    editor.addEventListener("scroll", positionFlag);
    lintRefreshers.push(function () { clear(); if (hintsOn()) schedule(); });
  }

  // Hints are switched on the Settings page now, not in the editor toolbar, so
  // this only has to react to the key changing. settings.js writes it directly
  // (it cannot call in here: this file is not loaded there), which is why the
  // key name is spelled out in both. Anything not exactly "off" is on, so the
  // default with no key stored at all is on.
  //
  // The .sandbox-hints button is gone from the markup; the handler stays for any
  // page that still has one, and costs nothing when there is none.
  function setupHintsToggle() {
    const btns = document.querySelectorAll(".sandbox-hints");
    function paint() {
      const on = hintsOn();
      btns.forEach(function (b) { b.textContent = "Hints: " + (on ? "on" : "off"); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem(HINTS_KEY, hintsOn() ? "off" : "on"); } catch (e) {}
        paint();
        lintRefreshers.forEach(function (fn) { fn(); });
      });
    });
    // Settings is its own page, so the usual path is a fresh load that simply
    // reads the key. This covers the two-tabs case.
    window.addEventListener("storage", function (ev) {
      if (ev.key !== HINTS_KEY) return;
      paint();
      lintRefreshers.forEach(function (fn) { fn(); });
    });
    paint();
  }

  function boot() {
    document.querySelectorAll(".sandbox-code").forEach(function (editor) {
      editor.addEventListener("keydown", onTabKey);
      editor.addEventListener("keydown", onBackspaceKey);
      attachLint(editor);
    });
    setupHintsToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }

  // Exposed for tests.
  window.EditorTools = { lintIndent: lintIndent, lintNames: lintNames };
})();
