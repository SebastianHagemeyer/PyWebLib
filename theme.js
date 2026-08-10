/*
 * Light / dark theme.
 *
 * The FIRST paint is not handled here. A small inline script in <head> (see
 * src/_layout.html) sets data-theme before the stylesheet loads, because a
 * script down here runs long after the page has already flashed white. This
 * file owns everything after that: reading and writing the preference, keeping
 * "system" honest when the OS flips, and telling the settings page.
 *
 * Stored as "light", "dark" or "system" under pwl-theme. Absent means system.
 * The preference is per device, not per account: it lives in localStorage, so
 * it also applies when signed out, even though the control for it is on the
 * settings page.
 *
 *   PWL.theme.get()        -> "light" | "dark" | "system"
 *   PWL.theme.resolved()   -> "light" | "dark", what is actually on screen
 *   PWL.theme.set(pref)
 *   PWL.theme.onChange(cb) -> cb(pref, resolved)
 */
(function () {
  "use strict";
  const PWL = (window.PWL = window.PWL || {});
  const KEY = "pwl-theme";
  const listeners = [];
  const mq = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : { matches: false, addEventListener: function () {} };

  function get() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system";                    // private mode: fall back, never throw
    }
  }

  function resolved() {
    const p = get();
    return p === "system" ? (mq.matches ? "dark" : "light") : p;
  }

  function apply() {
    document.documentElement.setAttribute("data-theme", resolved());
  }

  function set(pref) {
    if (pref !== "light" && pref !== "dark") pref = "system";
    try {
      if (pref === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch (e) {}
    apply();
    listeners.forEach(function (cb) {
      try { cb(pref, resolved()); } catch (e) {}
    });
  }

  // Following the OS is only meaningful if it keeps following it.
  if (mq.addEventListener) {
    mq.addEventListener("change", function () { if (get() === "system") apply(); });
  } else if (mq.addListener) {
    mq.addListener(function () { if (get() === "system") apply(); });
  }

  // Another tab changed it: match, rather than drifting apart.
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) apply();
  });

  apply();
  PWL.theme = {
    get: get, set: set, resolved: resolved,
    onChange: function (cb) { listeners.push(cb); },
  };
})();
