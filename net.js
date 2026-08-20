/*
 * PyWebLib multiplayer transport: the JS half of `import net`.
 *
 * WHAT A ROOM IS. Everyone who joins the same room name is connected to one
 * relay that copies each player's updates to the others. Two relays are
 * supported and they are chosen automatically:
 *
 *   1. A Cloudflare Worker (see worker/), if RELAY_URL below is filled in.
 *      PREFERRED. Only messages arriving IN are billed, so the fan-out back to
 *      the room is free and cost grows with the number of players rather than
 *      its SQUARE. Several classes a week fit inside the Workers free plan.
 *
 *   2. Supabase Realtime broadcast, otherwise. Needs no server at all, which is
 *      why it is the fallback: a fork of PyWebLib that never deploys the Worker
 *      still gets working multiplayer. It bills PER RECIPIENT, though, so one
 *      update in a room of four costs five messages and a class costs money.
 *
 * Everything except the socket itself is shared between the two: the throttle,
 * the dedupe, the roster, the timeout sweep and the snapshot. A transport only
 * has to connect, send and report status, so a third one would be ~40 lines and
 * no change anywhere else. Python never learns which is in use.
 *
 * WHY SENDING IS THROTTLED AND DEDUPED HERE rather than in Python: it is the
 * one place both transports benefit, and on Supabase it is the difference
 * between free and a bill. A parked sprite sends one heartbeat every 1.5s; a
 * moving one sends at most `rate` a second no matter how fast the game loop is.
 *
 * Public surface, all consumed by pyrun.js's NET_IO:
 *
 *   PWL.net.join(room, opts)   join (or re-join) a room; idempotent
 *   PWL.net.leave()            drop the connection and forget every peer
 *   PWL.net.publish(state)     set MY player state; sent throttled + deduped
 *   PWL.net.setShared(k, v)    set a room-wide value (last write wins)
 *   PWL.net.snapshotJson()     the whole room as JSON, cached between changes
 *   PWL.net.onChange(cb)       called whenever that snapshot changes
 *   PWL.net.id                 my player id, stable for this tab
 */
(function () {
  "use strict";

  const PWL = (window.PWL = window.PWL || {});

  /* ---- THE ONE THING TO CONFIGURE ---------------------------------------
   * Your deployed relay, e.g. "https://pyweblib-rooms.you.workers.dev".
   * Empty means "fall back to Supabase Realtime". Deploy instructions are in
   * worker/README.md; it is one `npx wrangler deploy`. */
  const RELAY_URL = PWL.netRelayUrl || "";

  // ---- Tunables -----------------------------------------------------------
  // 5, not 10. On the Supabase path cost grows with the SQUARE of the room
  // size, and at a 30 fps game loop the difference between 5 and 10 updates a
  // second is hard to see while the bill for it is exactly double. Games that
  // really need it can still ask: net.join(room, rate=15).
  const DEFAULT_RATE = 5;       // outbound player updates per second, max
  const HEARTBEAT_MS = 1500;    // resend an unchanged state at least this often
  const PEER_TIMEOUT_MS = 4000; // drop a peer we have not heard from since
  const MAX_PEERS = 24;         // most players one room will report
  // 1024, so that a legal state still fits inside the Worker's 1400-byte
  // per-message cap once it is wrapped in the envelope and the player id.
  const MAX_STATE_BYTES = 1024;
  const MAX_SHARED_BYTES = 1024;// cap on one shared value
  const MAX_SHARED_KEYS = 32;   // most shared values one room will hold
  const EVENTS_PER_SECOND = 20; // Supabase realtime client's own rate limit

  // ---- State --------------------------------------------------------------
  let transport = null;         // the active transport, or null
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
   * channel name can hold and something a classmate can retype from memory.
   * The Worker validates against the same shape. */
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

  // =========================================================================
  // Transports. Each one implements: connect(room, handlers), send(event,
  // payload), close(). handlers is { onStatus(state), onMessage(event, data) }.
  // =========================================================================

  /* The Worker relay. A plain WebSocket, plus reconnect: a classroom wifi blip
   * should cost a second of staleness, not end the game. */
  function cloudflareTransport(baseUrl) {
    let ws = null, room = "", h = null, attempt = 0, timer = null, done = false;

    function url() {
      return baseUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/room/" + room;
    }

    function open() {
      if (done) return;
      let sock;
      try { sock = new WebSocket(url()); } catch (e) { h.onStatus("unavailable"); return; }
      ws = sock;
      sock.onopen = function () {
        if (done) { try { sock.close(); } catch (e) {} return; }
        attempt = 0;
        h.onStatus("joined");
      };
      sock.onmessage = function (ev) {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.e) h.onMessage(m.e, m.d);
      };
      sock.onclose = function () {
        if (done || ws !== sock) return;
        h.onStatus("joining");
        retry();
      };
      // onerror is followed by onclose, so reconnecting is handled there; this
      // only exists so the very first failure does not look like a clean close.
      sock.onerror = function () { if (!done && attempt === 0) h.onStatus("joining"); };
    }

    function retry() {
      if (done) return;
      // 0.5s, 1s, 2s, 4s, then every 8s. A room is worth waiting for.
      const wait = Math.min(8000, 500 * Math.pow(2, attempt++));
      clearTimeout(timer);
      timer = setTimeout(open, wait);
    }

    return {
      name: "cloudflare",
      // The relay hands a newcomer everyone's last state itself, so net.js does
      // not have to make the existing players re-broadcast on every join.
      serverSyncsNewPeers: true,
      connect: function (r, handlers) {
        room = r; h = handlers; done = false; attempt = 0;
        h.onStatus("joining");
        open();
      },
      send: function (event, payload) {
        if (!ws || ws.readyState !== 1) return;
        try { ws.send(JSON.stringify({ e: event, d: payload })); } catch (e) {}
      },
      close: function () {
        done = true;
        clearTimeout(timer);
        if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      }
    };
  }

  /* Supabase Realtime broadcast. Its own client, because the one in
   * supabase-config.js is shared with sign-in and the leaderboard and defaults
   * to 10 events/second, which a game loop sits right on top of. */
  function supabaseTransport() {
    let client = null, channel = null;

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

    return {
      name: "supabase",
      serverSyncsNewPeers: false,
      connect: function (room, h) {
        const sb = ensureClient();
        if (!sb) { h.onStatus("unavailable"); return; }
        h.onStatus("joining");
        try {
          channel = sb.channel("pwl-room-" + room, {
            config: { broadcast: { self: false, ack: false } }
          });
          ["p", "x", "bye"].forEach(function (ev) {
            channel.on("broadcast", { event: ev }, function (m) { h.onMessage(ev, m.payload); });
          });
          channel.subscribe(function (status) {
            if (status === "SUBSCRIBED") h.onStatus("joined");
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") h.onStatus("unavailable");
          });
        } catch (e) {
          channel = null;
          h.onStatus("unavailable");
        }
      },
      send: function (event, payload) {
        if (!channel) return;
        try { channel.send({ type: "broadcast", event: event, payload: payload }); } catch (e) {}
      },
      close: function () {
        if (!channel) return;
        try { channel.unsubscribe(); } catch (e) {}
        try { if (client) client.removeChannel(channel); } catch (e) {}
        channel = null;
      }
    };
  }

  function pickTransport() {
    if (RELAY_URL) return cloudflareTransport(RELAY_URL);
    if (PWL.supabaseUrl && PWL.supabaseKey) return supabaseTransport();
    return null;
  }

  // =========================================================================
  // Room logic, shared by every transport.
  // =========================================================================

  function setState(next) {
    if (state === next) return;
    state = next;
    snapshotDirty = true;
    if (next === "joined") {
      startSweep();
      flush(true);                                    // announce ourselves
      if (Object.keys(shared).length) rawSend("x", { i: myId, v: shared });
    }
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
    if (!transport || state !== "joined") return;
    transport.send(event, payload);
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
   * frame; at 30 fps and rate 5 that is five of every six calls collapsing into
   * the next window instead of becoming traffic. */
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
    // On a relay that does not remember the room, a player we have not seen
    // before has just appeared and knows nothing: tell them where we are and
    // what the shared values say, or they wait a whole timeout to find out.
    // The Worker does this itself, so there it would be pure waste.
    if (!existing && transport && !transport.serverSyncsNewPeers) {
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

  const HANDLERS = {
    onStatus: setState,
    onMessage: function (event, data) {
      if (event === "p") onPlayer(data);
      else if (event === "x") onShared(data);
      else if (event === "bye") onBye(data);
    }
  };

  // ---- Public API ---------------------------------------------------------
  function join(room, opts) {
    const want = cleanRoom(room);
    opts = opts || {};
    rate = Math.max(1, Math.min(20, Number(opts.rate) || DEFAULT_RATE));
    myName = opts.name ? String(opts.name).slice(0, 24) : defaultName();

    // Already here: re-connecting every time a student presses Run would blink
    // everyone's car off the screen (and on Supabase, burn the join rate limit).
    if (transport && want === roomName && (state === "joined" || state === "joining")) {
      snapshotDirty = true;
      emit();
      return;
    }
    leave();

    transport = pickTransport();
    if (!transport) { setState("unavailable"); return; }
    roomName = want;
    transport.connect(want, HANDLERS);
  }

  function leave() {
    if (transport) {
      rawSend("bye", { i: myId });
      transport.close();
    }
    transport = null;
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
    // A runaway state object would be rejected by the relay or just waste the
    // room's quota; drop the overflow here where it is diagnosable.
    let json;
    try { json = JSON.stringify(next); } catch (e) { return; }
    if (json.length > MAX_STATE_BYTES) return;
    myState = next;
    schedule();
  }

  /* The snapshot has to stay inside the worker runtime's shared-memory region,
   * and peers are already bounded by MAX_PEERS and MAX_STATE_BYTES. Shared
   * values are the other half of that budget: without these two caps one
   * net.set() of a big string would truncate the snapshot mid-JSON and every
   * player's room would freeze on the last parseable copy. */
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

  /* Clearing between runs drops the ghosts but KEEPS the connection: pressing
   * Run should not cost a reconnect, and the room is the same room. */
  function resetRun() {
    myState = null;
    lastSentJson = "";
    snapshotDirty = true;
  }

  window.addEventListener("pagehide", function () { if (transport) rawSend("bye", { i: myId }); });

  PWL.net = {
    id: myId,
    join: join,
    leave: leave,
    publish: publish,
    setShared: setShared,
    resetRun: resetRun,
    state: function () { return state; },
    // Which relay is in use, or "" before the first join. Handy in the console
    // for checking a deploy actually took effect.
    transport: function () { return transport ? transport.name : (RELAY_URL ? "cloudflare" : "supabase"); },
    available: function () { return !!(RELAY_URL || (PWL.supabaseUrl && PWL.supabaseKey)); },
    snapshotJson: function () {
      if (snapshotDirty) rebuild();
      return snapshotJson;
    },
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); }
  };
})();
