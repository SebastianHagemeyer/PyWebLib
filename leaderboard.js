/*
 * PyWebLib leaderboard: top creators by total upvotes across their programs.
 * Reads the top_creators view from supabase-schema.sql.
 */
(function () {
  "use strict";

  const PWL = window.PWL || {};
  const sb = PWL.supabase;
  const list = document.getElementById("leaderboard-list");
  const notice = document.getElementById("leaderboard-notice");
  if (!list) return;

  if (!PWL.configured || !sb) {
    if (notice) notice.hidden = false;
    list.hidden = true;
    return;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function avatarOf(row) {
    const url = row && row.avatar_url;
    const cross = window.crossOriginIsolated ? ' crossorigin="anonymous"' : "";
    const photo = url ? '<img class="pwl-avatar-photo" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer"' + cross + ' onerror="this.remove()" />' : "";
    return '<span class="pwl-avatar"><svg class="pwl-avatar-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M12 14.4c-4.3 0-7.8 2.7-7.8 6.1V24h15.6v-3.5c0-3.4-3.5-6.1-7.8-6.1z"/></svg>' + photo + "</span>";
  }

  async function load() {
    list.hidden = false;
    list.innerHTML = '<p class="community-empty">Loading…</p>';
    const { data, error } = await sb.from("top_creators").select("*").limit(50);
    if (error) {
      list.innerHTML = '<p class="community-empty">Could not load the leaderboard: ' + esc(error.message) + "</p>";
      return;
    }
    if (!data || !data.length) {
      list.innerHTML = '<p class="community-empty">No creators yet. Publish a program from the Playground to get on the board!</p>';
      return;
    }
    list.innerHTML = "";
    data.forEach(function (row, i) {
      const el = document.createElement("div");
      el.className = "lb-row" + (i < 3 ? " lb-top lb-top-" + (i + 1) : "");
      el.innerHTML =
        '<span class="lb-rank">' + (i + 1) + "</span>" +
        avatarOf(row) +
        '<span class="lb-name"></span>' +
        '<span class="lb-stats"><strong>' + row.total_votes + "</strong> upvote" +
          (Number(row.total_votes) === 1 ? "" : "s") + " &middot; " +
          row.project_count + " program" + (Number(row.project_count) === 1 ? "" : "s") + "</span>";
      el.querySelector(".lb-name").textContent = row.display_name || "Someone";
      list.appendChild(el);
    });
  }

  load();
})();
