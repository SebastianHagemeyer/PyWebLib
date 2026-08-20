/*
 * PyWebLib multiplayer transport: the JS half of `import net`.
 *
 * WHAT THIS IS. A room is a Supabase Realtime BROADCAST channel. That is a
 * hosted WebSocket relay, not the database: nothing here touches Postgres, so
 * there is no table, no schema and no row-level-security policy behind
 * multiplayer. Same project as the leaderboard, different feature.
 *
 * WHY ITS OWN CLIENT. supabase-config.js builds the client that sign-in and the
 * leaderboard share, and its realtime default is 10 events/second, which a game
 * loop sits right on top of. Multiplayer gets its own client at a higher rate so
 * a busy room cannot throttle sign-in, and so nothing here can disturb an
 * in-flight auth request.
 *
 * WHAT IT COSTS. Supabase bills broadcast PER RECIPIENT: one message into a room
 * of four counts as five (one sent, four received). That is why sending is
 * throttled AND deduplicated here rather than in Python; a parked car is free,
 * and a moving one costs at most `rate` messages a second. Read the numbers in
 * docs/net/ before opening a room to a whole class.
 *
 * Public surface, all consumed by pyrun.js's NET_IO:
 *
 *   PWL.net.join(room, opts)   join (or re-join) a room; idempotent
 *   PWL.net.leave()            drop the channel and forget every peer
 *   PWL.net.publish(state)     set MY player state; sent throttled + deduped
 *   PWL.net.setShared(k, v)    set a room-wide value (last write wins)
 *   PWL.net.snapshotJson()     the whole room as JSON, cached between changes
 *   PWL.net.onChange(cb)       called whenever that snapshot changes
 *   PWL.net.id                 my player id, stable for this tab
 */
(function () {
  "use strict";

  const PWL = (window.PWL = window.PWL || {});

  // ---- Tunables -----------------------------------------------------------
  const DEFAULT_RATE = 10;      // outbound player updates per second, max
  const HEARTBEAT_MS = 1500;    // resend an unchanged state at least this often
  const PEER_TIMEOUT_MS = 4000; // drop a peer we have not heard from since
  const MAX_PEERS = 24;         // most players one room will report
  const MAX_STATE_BYTES = 2048; // cap on one player's serialised state
  const MAX_SHARED_BYTES = 2048;// cap on one shared value
  const MAX_SHARED_KEYS = 32;   // most shared values one room will hold
  const EVENTS_PER_SECOND = 20; // realtime client's own rate limit

  // ---- State --------------------------------------------------------------
  let client = null;            // our dedicated Supabase client
  let channel = null;           // the joined channel, or null
  let roomName = "";            // sanitised room name we are in
  let state = "offline";        // offline | joining | joined | unavailable
  let rate = DEFAULT_RATE;

  let myState = null;           // last state Python asked us to publish
  let myName = "";
  let pending = false;          // a publish is waiting for the throttle window
  let lastSentJson = "";        // dedupe: skip a send identical to the last
  let lastSentAt = 0;
  let flushTimer = null;

  const peers = new Map();      // id -> { id, name, state, seen }
  const shared = Object.create(null);   // room-wide values, last write wins

  let snapshotJson = "";        // cached JSON of the whole room
  let snapshotDirty = true;
  const listeners = [];

  // A player id that survives pressing Run again, so your car does not appear
  // twice to everyone else for the four seconds the old one takes to time out.
  // Per TAB, not per browser: two tabs are two players, which is exactly how a
  // student tests multiplayer on one laptop.
  const myId = (function () {
    const KEY = "pwl.net.id";
    let v = "";
    try { v = sessionStorage.getItem(KEY) || ""; } catch (e) {}
    if (!v) {
      v = Math.random().toString(36).slice(2, 8);
      try { sessionStorage.setItem(KEY, v); } catch (e) {}
    }
    return v;
  })();

  /* Room names come from student code, so they are normalised to something a
   * channel name can hold and something a classmate can retype from memory. */
  function cleanRoom(name) {
    const s = String(name == null ? "" : name).toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || "lobby";
  }

  function defaultName() {
    try {
      const p = PWL.auth && PWL.auth.profile && PWL.auth.profile();
      if (p && p.display_name) return String(p.display_name).slice(0, 24);
    } catch (e) {}
    return "Player " + myId.slice(0, 3).toUpperCase();
  }

  function ensureClient() {
    if (client) return client;
    if (!PWL.supabaseUrl || !PWL.supabaseKey) return null;
    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
    try {
      client = window.supabase.createClient(PWL.supabaseUrl, PWL.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: EVENTS_PER_SECOND } }
      });
    } catch (e) { client = null; }
    return client;
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    snapshotDirty = true;
    emit();
  }

  function emit() {
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) {}
    }
  }

  // ---- Snapshot -----------------------------------------------------------
  // Everything Python needs to answer net.others(), net.get() and net.online(),
  // in one JSON string. Rebuilt lazily: a 30 fps game loop asks for this every
  // frame, but it only actually changes when a packet lands or a peer times out.
  function rebuild() {
    const now = Date.now();
    const out = [];
    peers.forEach(function (p) {
      if (now - p.seen > PEER_TIMEOUT_MS) return;
      if (out.length >= MAX_PEERS) return;
      out.push({ i: p.id, n: p.name, s: p.state || {} });
    });
    snapshotJson = JSON.stringify({
      state: state, room: roomName, id: myId, name: myName,
      peers: out, shared: shared
    });
    snapshotDirty = false;
  }

  /* Anything that ages out on its own (a peer going quiet) has to be swept even
   * when no packet arrives, or a disconnected player's car would sit on screen
   * forever. One timer for the whole module, only while we are in a room. */
  let sweepTimer = null;
  function startSweep() {
    if (sweepTimer) return;
    sweepTimer = setInterval(function () {
      const now = Date.now();
      let dropped = false;
      peers.forEach(function (p, id) {
        if (now - p.seen > PEER_TIMEOUT_MS) { peers.delete(id); dropped = true; }
      });
      if (dropped) { snapshotDirty = true; emit(); }
      // Keep our own entry alive in everyone else's sweep.
      if (myState && now - lastSentAt > HEARTBEAT_MS) flush(true);
    }, 1000);
  }
  function stopSweep() {
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  }

  // ---- Sending ------------------------------------------------------------
  function rawSend(event, payload) {
    if (!channel || state !== "joined") return;
    try { channel.send({ type: "broadcast", event: event, payload: payload }); } catch (e) {}
  }

  /* Send my state if it has actually changed (or `force`, for the heartbeat).
   * The dedupe is the whole cost story: a player standing still sends one
   * message every HEARTBEAT_MS instead of `rate` a second. */
  function flush(force) {
    pending = false;
    if (!myState || state !== "joined") return;
    const json = JSON.stringify(myState);
    if (!force && json === lastSentJson) return;
    lastSentJson = json;
    lastSentAt = Date.now();
    rawSend("p", { i: myId, n: myName, s: myState });
  }

  /* Coalesce to at most `rate` sends a second. Python calls net.me() every
   * frame; at 30 fps and rate 10 that is two of every three calls collapsing
   * into the next window instead of becoming traffic. */
  function schedule() {
    if (pending || state !== "joined") return;
    const wait = Math.max(0, (1000 / rate) - (Date.now() - lastSentAt));
    pending = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flush(false); }, wait);
  }

  // ---- Receiving ----------------------------------------------------------
  function onPlayer(payload) {
    if (!payload || !payload.i || payload.i === myId) return;
    const id = String(payload.i).slice(0, 16);
    const existing = peers.get(id);
    if (!existing && peers.size >= MAX_PEERS) return;
    peers.set(id, {
      id: id,
      name: String(payload.n == null ? "" : payload.n).slice(0, 24),
      state: payload.s && typeof payload.s === "object" ? payload.s : {},
      seen: Date.now()
    });
    // A player we have not seen before has just appeared, so tell them what we
    // know: our own position lands on their next frame instead of after their
    // first timeout, and the shared values stop being invisible to late joiners.
    if (!existing) {
      flush(true);
      if (Object.keys(shared).length) rawSend("x", { i: myId, v: shared });
    }
    snapshotDirty = true;
    emit();
  }

  function onShared(payload) {
    if (!payload || payload.i === myId || !payload.v || typeof payload.v !== "object") return;
    let changed = false;
    for (const k in payload.v) {
      if (!Object.prototype.hasOwnProperty.call(payload.v, k)) continue;
      const v = payload.v[k];
      if (typeof v === "string" && v.length > MAX_SHARED_BYTES) continue;
      if (!Object.prototype.hasOwnProperty.call(shared, k) &&
          Object.keys(shared).length >= MAX_SHARED_KEYS) continue;
      if (shared[k] !== v) { shared[k] = v; changed = true; }
    }
    if (changed) { snapshotDirty = true; emit(); }
  }

  function onBye(payload) {
    if (!payload || !payload.i) return;
    if (peers.delete(String(payload.i))) { snapshotDirty = true; emit(); }
  }

  // ---- Public API ---------------------------------------------------------
  function join(room, opts) {
    const want = cleanRoom(room);
    opts = opts || {};
    rate = Math.max(1, Math.min(20, Number(opts.rate) || DEFAULT_RATE));
    myName = opts.name ? String(opts.name).slice(0, 24) : defaultName();

    // Already here: re-joining every time a student presses Run would burn the
    // channel-join rate limit and blink everyone's car off the screen.
    if (channel && want === roomName && (state === "joined" || state === "joining")) {
      snapshotDirty = true;
      emit();
      return;
    }
    leave();

    const sb = ensureClient();
    if (!sb) { setState("unavailable"); return; }

    roomName = want;
    setState("joining");
    try {
      channel = sb.channel("pwl-room-" + roomName, {
        config: { broadcast: { self: false, ack: false } }
      });
      channel.on("broadcast", { event: "p" }, function (m) { onPlayer(m.payload); });
      channel.on("broadcast", { event: "x" }, function (m) { onShared(m.payload); });
      channel.on("broadcast", { event: "bye" }, function (m) { onBye(m.payload); });
      channel.subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          setState("joined");
          startSweep();
          flush(true);                                  // announce ourselves
          if (Object.keys(shared).length) rawSend("x", { i: myId, v: shared });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState("unavailable");
        }
      });
    } catch (e) {
      channel = null;
      setState("unavailable");
    }
  }

  function leave() {
    if (channel) {
      rawSend("bye", { i: myId });
      try { channel.unsubscribe(); } catch (e) {}
      try { if (client) client.removeChannel(channel); } catch (e) {}
    }
    channel = null;
    roomName = "";
    peers.clear();
    for (const k in shared) delete shared[k];
    myState = null;
    lastSentJson = "";
    pending = false;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    stopSweep();
    setState("offline");
    snapshotDirty = true;
  }

  function publish(next) {
    if (!next || typeof next !== "object") return;
    // A runaway state object would be rejected by the server (256 KB) or just
    // waste the room's quota; drop the overflow here where it is diagnosable.
    let json;
    try { json = JSON.stringify(next); } catch (e) { return; }
    if (json.length > MAX_STATE_BYTES) return;
    myState = next;
    schedule();
  }

  /* The snapshot has to stay inside the worker's shared-memory region, and
   * peers are already bounded by MAX_PEERS and MAX_STATE_BYTES. Shared values
   * are the other half of that budget: without these two caps one net.set() of
   * a big string would truncate the snapshot mid-JSON and every player's room
   * would freeze on the last parseable copy. */
  function setShared(key, value) {
    const k = String(key).slice(0, 32);
    if (shared[k] === value) return;
    if (typeof value === "string" && value.length > MAX_SHARED_BYTES) return;
    if (!Object.prototype.hasOwnProperty.call(shared, k) &&
        Object.keys(shared).length >= MAX_SHARED_KEYS) return;
    shared[k] = value;
    snapshotDirty = true;
    // Shared values are rare and decisive (who has the bomb), so they go out
    // immediately rather than waiting for the position throttle.
    rawSend("x", { i: myId, v: { [k]: value } });
    emit();
  }

  /* Clearing between runs drops the ghosts but KEEPS the socket: pressing Run
   * should not cost a reconnect, and the room is the same room. */
  function resetRun() {
    myState = null;
    lastSentJson = "";
    snapshotDirty = true;
  }

  window.addEventListener("pagehide", function () { if (channel) rawSend("bye", { i: myId }); });

  PWL.net = {
    id: myId,
    join: join,
    leave: leave,
    publish: publish,
    setShared: setShared,
    resetRun: resetRun,
    state: function () { return state; },
    available: function () { return !!(PWL.supabaseUrl && PWL.supabaseKey); },
    snapshotJson: function () {
      if (snapshotDirty) rebuild();
      return snapshotJson;
    },
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); }
  };
})();
