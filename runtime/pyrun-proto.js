/*
 * Shared protocol between the main thread and the Pyodide worker, for the
 * non-JSPI (Safari/Firefox) runtime. One SharedArrayBuffer carries control
 * futexes, live input state (keys/mouse/playing) the worker reads synchronously,
 * and a byte region for a submitted input() line. Loaded in BOTH contexts
 * (script tag on the page, importScripts in the worker), so it hangs itself off
 * `self`.
 */
(function (g) {
  "use strict";

  // Int32 control slots (index into the Int32Array view).
  const CTRL = {
    SLEEP: 0,        // futex: worker parks here for a frame/sleep; 1 = interrupted
    INPUT: 1,        // futex: 0 = waiting for input, 1 = input ready
    STOP: 2,         // 1 = stop requested
    PLAYING: 3,      // game.playing()
    MX: 4, MY: 5, MDOWN: 6, MCLICKS: 7, MIN: 8,
    INLEN: 9,        // number of UTF-8 bytes of the submitted input line
    RESTART: 10,     // 1 = the game asked to restart (game_over(retry=True))
    KEYS: 16,        // key states live at KEYS .. KEYS+NKEYS-1 (1 = down)
    NKEYS: 48
  };
  const CTRL_INTS = 128;                 // 512 bytes of Int32 control
  const STR_OFF = CTRL_INTS * 4;         // input-string byte region starts here
  const STR_MAX = 8192;
  const TOTAL_BYTES = STR_OFF + STR_MAX;

  // Map a key name (as game.pressed() uses) to a slot in the KEYS region.
  function keyIndex(name) {
    const named = { left: 0, right: 1, up: 2, down: 3, space: 4, enter: 5, escape: 6, shift: 7, tab: 8, backspace: 9 };
    const n = String(name == null ? "" : name).toLowerCase();
    if (n in named) return CTRL.KEYS + named[n];
    const c = n.charCodeAt(0);
    if (c >= 97 && c <= 122) return CTRL.KEYS + 10 + (c - 97);   // a-z  -> +10..35
    if (c >= 48 && c <= 57) return CTRL.KEYS + 36 + (c - 48);    // 0-9  -> +36..45
    return CTRL.KEYS + 46;                                        // misc bucket
  }

  g.PRProto = {
    CTRL: CTRL,
    CTRL_INTS: CTRL_INTS,
    STR_OFF: STR_OFF,
    STR_MAX: STR_MAX,
    TOTAL_BYTES: TOTAL_BYTES,
    keyIndex: keyIndex,
    // Build the shared buffer + views. `interrupt` is a separate 1-byte shared
    // buffer for Pyodide.setInterruptBuffer (it wants its own array).
    make: function () {
      const sab = new SharedArrayBuffer(TOTAL_BYTES);
      const intB = new SharedArrayBuffer(1);
      return {
        sab: sab, ctrl: new Int32Array(sab, 0, CTRL_INTS), str: new Uint8Array(sab, STR_OFF, STR_MAX),
        interrupt: intB, interruptView: new Uint8Array(intB)
      };
    },
    attach: function (sab, interrupt) {
      return {
        sab: sab, ctrl: new Int32Array(sab, 0, CTRL_INTS), str: new Uint8Array(sab, STR_OFF, STR_MAX),
        interrupt: interrupt, interruptView: new Uint8Array(interrupt)
      };
    }
  };
})(typeof self !== "undefined" ? self : this);
