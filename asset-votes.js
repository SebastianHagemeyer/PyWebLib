/*
 * Upvotes on Asset studio sprites, shared by the studio (/assets/) and the
 * creator page (/user/). One arrow, no downvote: click to like, click again to
 * take it back. Needs supabase-migration-asset-votes.sql.
 *
 *   PWL.assetVotes.mine(ids)       -> Promise<Set> of the ids you've upvoted
 *   PWL.assetVotes.button(a, set)  -> the little updoot button for asset a
 *   PWL.assetVotes.supported(rows) -> false until the migration has been run
 */
(function () {
  "use strict";
  const PWL = window.PWL = window.PWL || {};

  const ARROW = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 3.5l5.5 7H2.5z" fill="currentColor"/></svg>';

  // vote_count only comes back once the migration has added the column.
  function supported(rows) {
    return !!(rows && rows.length && typeof rows[0].vote_count === "number");
  }

  async function mine(ids) {
    const sb = PWL.supabase;
    const user = PWL.auth && PWL.auth.user();
    if (!sb || !user || !ids || !ids.length) return new Set();
    const r = await sb.from("asset_votes").select("asset_id").eq("user_id", user.id).in("asset_id", ids);
    return new Set(((r && r.data) || []).map(function (v) { return v.asset_id; }));
  }

  function paint(btn, on, n) {
    btn.classList.toggle("voted", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "You upvoted this. Click to take it back." : "Upvote";
    btn.querySelector(".asset-vote-n").textContent = n;
  }

  function button(a, voted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "asset-vote";
    btn.innerHTML = '<span class="asset-vote-arrow">' + ARROW + '</span><span class="asset-vote-n"></span>';
    paint(btn, voted.has(a.id), a.vote_count || 0);
    let busy = false;
    btn.addEventListener("click", async function (ev) {
      ev.stopPropagation();
      const sb = PWL.supabase;
      const user = PWL.auth && PWL.auth.user();
      if (!user) { if (PWL.auth && PWL.auth.signIn) PWL.auth.signIn(); return; }
      if (busy || !sb) return;
      busy = true;
      // Paint first so it feels instant, then undo the paint if the save fails.
      const was = voted.has(a.id);
      if (was) { voted.delete(a.id); a.vote_count = Math.max(0, (a.vote_count || 0) - 1); }
      else { voted.add(a.id); a.vote_count = (a.vote_count || 0) + 1; }
      paint(btn, !was, a.vote_count);
      const r = was
        ? await sb.from("asset_votes").delete().eq("asset_id", a.id).eq("user_id", user.id)
        : await sb.from("asset_votes").insert({ asset_id: a.id, user_id: user.id });
      if (r.error) {
        if (was) { voted.add(a.id); a.vote_count += 1; }
        else { voted.delete(a.id); a.vote_count = Math.max(0, a.vote_count - 1); }
        paint(btn, was, a.vote_count);
      }
      busy = false;
    });
    return btn;
  }

  PWL.assetVotes = { mine: mine, button: button, supported: supported };
})();
