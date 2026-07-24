/*
 * PyWebLib Supabase config.
 *
 * Fill these two in AFTER you create your Supabase project:
 *   Supabase dashboard -> Project Settings -> API
 *     - Project URL      -> SUPABASE_URL
 *     - Project API keys: "anon public" -> SUPABASE_ANON_KEY
 *
 * The anon key is PUBLIC by design and safe to commit: all security comes from
 * the row-level-security policies in supabase-schema.sql. See README "Community
 * setup" for the full checklist (Google sign-in, running the SQL, redirect URLs).
 *
 * Until these are filled in, the site runs fine and just hides the community
 * features (sign-in, publishing, upvotes, comments, leaderboard).
 */
(function () {
  "use strict";

  const SUPABASE_URL = "https://dwjwbqovfxsemlnzdcye.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_QrysqcQ6IBgvOlXgDo6kxw_h6AeJQYi";

  const PWL = (window.PWL = window.PWL || {});
  const looksReal =
    /^https:\/\/[a-z0-9]+\.supabase\.co/.test(SUPABASE_URL) &&
    SUPABASE_ANON_KEY.length > 30 &&
    SUPABASE_ANON_KEY.indexOf("YOUR-") === -1;

  let client = null;
  if (looksReal && window.supabase && typeof window.supabase.createClient === "function") {
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      client = null;
    }
  }

  PWL.supabase = client;          // the Supabase CLIENT (null until configured)
  PWL.configured = !!client;      // has the community backend been set up?
})();
