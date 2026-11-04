/*
 * The key table, loaded by BOTH the page (lab.js) and the worker (worker.js),
 * so a key's slot in the shared buffer means the same thing on each side.
 *
 * Shared-buffer layout (Int32Array): the first CTRL.KEYS slots are control
 * values, then one slot per key in KEY_NAMES (1 = held, 0 = up).
 */
(function (g) {
  const KEY_NAMES = [];
  for (let c = 97; c <= 122; c++) KEY_NAMES.push(String.fromCharCode(c));   // a-z
  for (let d = 0; d <= 9; d++) KEY_NAMES.push(String(d));                   // 0-9
  KEY_NAMES.push("left", "right", "up", "down", "space", "shift", "enter",
                 "escape", "ctrl", "alt", "tab", "backspace");
  const CTRL = { STOP: 0, MX: 1, MY: 2, MDOWN: 3, CLICKS: 4, MIN: 5, KEYS: 16 };
  const INDEX = {};
  KEY_NAMES.forEach(function (n, i) { INDEX[n] = CTRL.KEYS + i; });
  // A few friendly aliases, so game.pressed("arrowleft") or (" ") also work.
  const ALIAS = { arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down",
                  " ": "space", spacebar: "space", control: "ctrl", esc: "escape", "return": "enter" };
  function keyIndex(name) {
    let n = String(name).toLowerCase();
    if (ALIAS[n]) n = ALIAS[n];
    return INDEX[n] === undefined ? -1 : INDEX[n];
  }
  g.LabKeys = { KEY_NAMES: KEY_NAMES, CTRL: CTRL, keyIndex: keyIndex,
                SLOTS: CTRL.KEYS + KEY_NAMES.length };
})(self);
