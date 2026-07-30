/*
 * PyWebLib auth + account control.
 *
 * Google sign-in through Supabase. Renders the account control into every
 * element with id="pwl-account" (or class "pwl-account") in the page header,
 * and exposes window.PWL.auth for the community pages:
 *
 *   PWL.auth.user()               -> the signed-in Supabase user, or null
 *   PWL.auth.profile()            -> their profiles row {display_name, avatar_url}
 *   PWL.auth.signInWithGoogle()   -> starts the Google OAuth redirect
 *   PWL.auth.signOut()
 *   PWL.auth.onChange(cb)         -> cb(user, profile) on every auth change
 *   PWL.auth.requireSignIn()      -> true if signed in, else kicks off sign-in
 *
 * A "pwl:auth" event also fires on document after every change.
 */
(function () {
  "use strict";

  const PWL = (window.PWL = window.PWL || {});
  const sb = PWL.supabase;

  let currentUser = null;
  let currentProfile = null;
  const listeners = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function googleIcon() {
    return '<svg class="g-icon" viewBox="0 0 18 18" aria-hidden="true" width="16" height="16">' +
      '<path fill="#4285F4" d="M17.6 9.2c0-.6-.05-1.2-.16-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z"/>' +
      '<path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.400-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z"/>' +
      '<path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3z"/>' +
      '<path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.1 6.6 3.6 9 3.6z"/>' +
      '</svg>';
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/);
    const a = (parts[0] || "?")[0] || "?";
    const b = parts.length > 1 ? (parts[parts.length - 1][0] || "") : "";
    return (a + b).toUpperCase();
  }

  function avatarMarkup() {
    const url = currentProfile && currentProfile.avatar_url;
    const cross = window.crossOriginIsolated ? ' crossorigin="anonymous"' : "";
    const photo = url ? '<img class="pwl-avatar-photo" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer"' + cross + ' onerror="this.remove()" />' : "";
    return '<span class="pwl-avatar"><svg class="pwl-avatar-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M12 14.4c-4.3 0-7.8 2.7-7.8 6.1V24h15.6v-3.5c0-3.4-3.5-6.1-7.8-6.1z"/></svg>' + photo + "</span>";
  }

  function displayName() {
    return (currentProfile && currentProfile.display_name) ||
           (currentUser && (currentUser.email || "You")) || "You";
  }

  function accountMarkup() {
    if (!PWL.configured) return "";
    if (!currentUser) {
      return '<button type="button" class="btn btn-google" data-pwl="signin">' +
             googleIcon() + '<span>Sign in</span></button>';
    }
    return '<div class="pwl-acct" data-open="false">' +
             '<button type="button" class="pwl-acct-btn" data-pwl="acct-toggle" aria-haspopup="true">' +
               avatarMarkup() +
               '<span class="pwl-acct-name">' + esc(displayName()) + '</span>' +
             '</button>' +
             '<div class="pwl-acct-menu" role="menu">' +
               '<a class="pwl-acct-item" href="/community/?mine=1" role="menuitem">My programs</a>' +
               '<button type="button" class="pwl-acct-item" data-pwl="editname" role="menuitem">Edit name</button>' +
               '<button type="button" class="pwl-acct-item" data-pwl="signout" role="menuitem">Sign out</button>' +
             '</div>' +
           '</div>';
  }

  function render() {
    document.querySelectorAll("#pwl-account, .pwl-account").forEach(function (el) {
      el.innerHTML = accountMarkup();
    });
  }

  // Event delegation so we never lose handlers when the markup is re-rendered.
  function closeNavDropdowns(except) {
    document.querySelectorAll(".nav-dd.open").forEach(function (dd) {
      if (dd === except) return;
      dd.classList.remove("open");
      const t = dd.querySelector(".nav-dd-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("click", function (e) {
    // Header nav dropdown trigger: tap/click to open, so it works on touch
    // where :hover never fires.
    const navTrigger = e.target.closest(".nav-dd-trigger");
    if (navTrigger) {
      e.preventDefault();
      const dd = navTrigger.closest(".nav-dd");
      const open = dd.classList.toggle("open");
      navTrigger.setAttribute("aria-expanded", open ? "true" : "false");
      closeNavDropdowns(dd);
      return;
    }

    const trigger = e.target.closest("[data-pwl]");
    if (trigger) {
      const what = trigger.getAttribute("data-pwl");
      if (what === "signin") { e.preventDefault(); signInWithGoogle(); return; }
      if (what === "signout") { e.preventDefault(); signOut(); return; }
      if (what === "editname") { e.preventDefault(); openNameEditor(); return; }
      if (what === "acct-toggle") {
        const box = trigger.closest(".pwl-acct");
        box.dataset.open = box.dataset.open === "true" ? "false" : "true";
        return;
      }
    }
    // A click anywhere else closes any open account menu or nav dropdown.
    document.querySelectorAll(".pwl-acct[data-open='true']").forEach(function (box) {
      if (!box.contains(e.target)) box.dataset.open = "false";
    });
    closeNavDropdowns(null);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeNavDropdowns(null);
  });

  function emit() {
    listeners.forEach(function (cb) {
      try { cb(currentUser, currentProfile); } catch (err) {}
    });
    document.dispatchEvent(new CustomEvent("pwl:auth", {
      detail: { user: currentUser, profile: currentProfile }
    }));
  }

  async function loadProfile() {
    if (!sb || !currentUser) { currentProfile = null; return; }
    try {
      const res = await sb.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
      currentProfile = res.data || null;
      // First sign-in can race the DB trigger; fall back to the Google metadata.
      if (!currentProfile) {
        const m = currentUser.user_metadata || {};
        currentProfile = {
          id: currentUser.id,
          display_name: m.full_name || m.name || (currentUser.email || "").split("@")[0],
          avatar_url: m.avatar_url || m.picture || null
        };
      }
    } catch (e) {
      currentProfile = null;
    }
  }

  async function signInWithGoogle() {
    if (!sb) return;
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href }
    });
  }

  async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
    // onAuthStateChange handles the UI; this is just a safety net.
    currentUser = null; currentProfile = null; render(); emit();
  }

  async function updateName(name) {
    if (!sb || !currentUser) return { error: { message: "not signed in" } };
    const res = await sb.from("profiles").update({ display_name: name }).eq("id", currentUser.id);
    if (!res.error) { await loadProfile(); render(); emit(); }
    return res;
  }

  function openNameEditor() {
    if (!currentUser) { signInWithGoogle(); return; }
    const back = document.createElement("div");
    back.className = "pwl-modal-back";
    back.innerHTML =
      '<div class="pwl-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="pwl-modal-x" aria-label="Close">&times;</button>' +
        '<h2 class="pwl-modal-title">Edit your name</h2>' +
        '<form id="pwl-name-form" class="pwl-share-form">' +
          '<label>Display name<input name="name" type="text" maxlength="40" required autocomplete="off" /></label>' +
          '<p class="pwl-comment-signin" id="pwl-name-err" hidden></p>' +
          '<div class="pwl-modal-actions"><button type="submit" class="btn btn-primary">Save</button></div>' +
        "</form>" +
      "</div>";
    const input = back.querySelector('input[name="name"]');
    input.value = displayName();
    const err = back.querySelector("#pwl-name-err");
    function close() { back.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.querySelector(".pwl-modal-x").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    input.focus(); input.select();
    back.querySelector("#pwl-name-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = "Saving…"; err.hidden = true;
      const res = await updateName(name);
      if (res.error) {
        btn.disabled = false; btn.textContent = "Save";
        err.textContent = "Couldn't save: " + res.error.message; err.hidden = false;
      } else { close(); }
    });
  }

  const caret =
    '<svg class="nav-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Mark whichever menu item is the page you are on, and light up the trigger
  // when one of its items is active.
  function markActive(dd) {
    const here = location.pathname.replace(/index\.html$/, "");
    let any = false;
    dd.querySelectorAll(".nav-dd-menu a").forEach(function (a) {
      if (a.pathname.replace(/index\.html$/, "") === here) { a.classList.add("active"); any = true; }
    });
    if (any) {
      const t = dd.querySelector(".nav-dd-trigger, .header-link");
      if (t) t.classList.add("active");
    }
  }

  // Turn Community into a dropdown just like Docs: the trigger stays a link to
  // the gallery, and the menu adds Assets and Leaderboard (opens on hover/focus).
  function enhanceCommunityNav(nav, root) {
    let community = null, assets = null, leaderboard = null;
    nav.querySelectorAll("a.header-link").forEach(function (a) {
      const t = a.textContent.trim();
      if (t === "Community") community = a;
      else if (t === "Assets") assets = a;
      else if (t === "Leaderboard") leaderboard = a;
    });
    if (!community) return;
    const wasActive = community.classList.contains("active");
    const dd = document.createElement("div");
    dd.className = "nav-dd";
    dd.innerHTML =
      '<a class="header-link' + (wasActive ? " active" : "") + '" href="' + root + 'community/">Community' +
        caret +
      "</a>" +
      '<div class="nav-dd-menu">' +
        '<a href="' + root + 'assets/">Assets</a>' +
        '<a href="' + root + 'leaderboard/">Leaderboard</a>' +
      "</div>";
    community.replaceWith(dd);
    if (assets) assets.remove();
    if (leaderboard) leaderboard.remove();
    markActive(dd);
  }

  // Turn the "About" header link into a dropdown: the trigger goes to the About
  // page, and the menu holds all the docs (the reference plus the guides).
  function enhanceAboutNav(nav, root) {
    let aboutLink = null;
    nav.querySelectorAll("a.header-link").forEach(function (a) {
      if (a.textContent.trim() === "About") aboutLink = a;
    });
    if (!aboutLink) return;
    const wasActive = aboutLink.classList.contains("active");
    const dd = document.createElement("div");
    dd.className = "nav-dd";
    dd.innerHTML =
      '<a class="header-link' + (wasActive ? " active" : "") + '" href="' + root + 'about/">About' +
        caret +
      "</a>" +
      '<div class="nav-dd-menu">' +
        '<a href="' + root + 'docs/">Docs</a>' +
        '<a href="' + root + 'docs/guide/">Guide</a>' +
        '<a href="' + root + 'docs/turtle/">Turtle guide</a>' +
        '<a href="' + root + 'docs/game/">Game guide</a>' +
      "</div>";
    aboutLink.replaceWith(dd);
    markActive(dd);
  }

  // Shared across every page so the nav markup itself does not have to be
  // duplicated. Paths come from the account element's data-root.
  function enhanceNav() {
    const nav = document.querySelector(".site-nav");
    if (!nav || nav.querySelector(".nav-dd")) return;
    const acct = document.querySelector("#pwl-account, .pwl-account");
    const root = (acct && acct.getAttribute("data-root")) || "";
    enhanceCommunityNav(nav, root);
    enhanceAboutNav(nav, root);
  }

  async function init() {
    enhanceNav();
    render();               // paints the "Sign in" button (or nothing) immediately
    if (!sb) return;
    try {
      const { data } = await sb.auth.getSession();
      currentUser = data && data.session ? data.session.user : null;
      await loadProfile();
      render();
      emit();
    } catch (e) { /* offline / misconfigured: leave signed out */ }

    sb.auth.onAuthStateChange(async function (_event, session) {
      currentUser = session ? session.user : null;
      await loadProfile();
      render();
      emit();
    });
  }

  PWL.auth = {
    user: function () { return currentUser; },
    profile: function () { return currentProfile; },
    displayName: displayName,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onChange: function (cb) { listeners.push(cb); return function () {}; },
    requireSignIn: function () {
      if (currentUser) return true;
      signInWithGoogle();
      return false;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
