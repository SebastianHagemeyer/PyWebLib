/*
 * PyWebLib multiplayer relay: one Durable Object per room.
 *
 * WHY THIS EXISTS. The Supabase Realtime path in net.js works and needs no
 * server at all, but it bills broadcast PER RECIPIENT: one update in a room of
 * four costs five messages. Traffic therefore grows with the SQUARE of the room
 * size, and a few classes a week runs into real money.
 *
 * A relay does not have to work that way. Here only messages arriving IN are
 * billed (and incoming WebSocket messages are counted 20:1 on top of that); the
 * fan-out back to the room is free. The squared term disappears, which is the
 * whole reason this file exists. Several classes a week fit inside the Workers
 * free plan.
 *
 * WHY A DURABLE OBJECT AND NOT A PLAIN WORKER. Workers are stateless and
 * short-lived, and two players in the same room may well land in different data
 * centres. A room needs the opposite: ONE thing that both players are connected
 * to at the same time and that knows who is in it. Cloudflare guarantees a
 * Durable Object with a given name exists exactly once in the world, so
 * idFromName(room) sends everyone to the same object.
 *
 * HIBERNATION. Sockets are accepted with ctx.acceptWebSocket rather than
 * ws.accept(), so an idle room is evicted from memory and stops accruing
 * duration charges while staying connected. That means in-memory fields do NOT
 * survive: per-player state rides along on each socket's attachment, and the
 * room's shared values live in storage. Anything kept in a plain `this.x` would
 * silently vanish mid-game.
 *
 * The wire protocol is deliberately the same as the Supabase path's, so net.js
 * shares all its room logic between the two:
 *
 *   {e:"p",   d:{i,n,s}}   a player's position and skin
 *   {e:"x",   d:{i,v}}     shared room values (last write wins)
 *   {e:"bye", d:{i}}       a player left
 */
import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 24;        // matches MAX_PEERS in net.js
const MAX_MSG_BYTES = 1400;    // must leave room inside the 2 KB attachment limit
const MAX_SHARED_KEYS = 32;    // matches net.js
const WINDOW_MS = 10000;       // rate-limit window, per socket
const MAX_MSGS_PER_WINDOW = 400;
const ROOM_RE = /^[a-z0-9_-]{1,40}$/;

export class Room extends DurableObject {
  async fetch(request) {
    const open = this.ctx.getWebSockets();
    if (open.length >= MAX_PLAYERS) {
      return new Response("room full", { status: 409 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    // acceptWebSocket, not server.accept(): this is what allows the room to
    // hibernate between messages instead of being billed for sitting idle.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: "", last: null, n: 0, t: 0 });

    // Hand the newcomer the room exactly as it stands. On the Supabase path a
    // late joiner has to wait for everyone else to send their next update (or
    // provoke it); here the relay already knows, so they see the room on their
    // very first frame and nobody has to re-broadcast.
    for (const s of open) {
      const a = safeAttachment(s);
      if (a && a.last) trySend(server, a.last);
    }
    const shared = await this.ctx.storage.get("shared");
    if (shared && Object.keys(shared).length) {
      trySend(server, JSON.stringify({ e: "x", d: { i: "", v: shared } }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG_BYTES) return;

    const att = safeAttachment(ws) || { id: "", last: null, n: 0, t: 0 };

    // A student loop that forgets to throttle would otherwise burn the room's
    // whole daily quota in minutes. Drop the excess rather than disconnecting:
    // the game keeps running, it just stops paying for frames nobody sees.
    const now = Date.now();
    if (now - att.t > WINDOW_MS) { att.t = now; att.n = 0; }
    att.n += 1;
    if (att.n > MAX_MSGS_PER_WINDOW) { ws.serializeAttachment(att); return; }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object" || !msg.e) return;

    if (msg.e === "p" && msg.d && msg.d.i) {
      att.id = String(msg.d.i).slice(0, 16);
      // Remember this player's latest state so the NEXT joiner gets it for
      // free. Skipped if it would not fit the attachment, which only costs a
      // late joiner one update of staleness.
      att.last = raw.length <= MAX_MSG_BYTES ? raw : att.last;
    } else if (msg.e === "x" && msg.d && msg.d.v && typeof msg.d.v === "object") {
      // Shared values must outlive hibernation, so they go to storage rather
      // than a field on `this`. Rare by design (who has the bomb), so the write
      // is not on any hot path.
      const shared = (await this.ctx.storage.get("shared")) || {};
      for (const k of Object.keys(msg.d.v)) {
        if (!Object.prototype.hasOwnProperty.call(shared, k) &&
            Object.keys(shared).length >= MAX_SHARED_KEYS) continue;
        shared[String(k).slice(0, 32)] = msg.d.v[k];
      }
      await this.ctx.storage.put("shared", shared);
    } else if (msg.e !== "bye") {
      return;                       // unknown event: not relayed
    }

    ws.serializeAttachment(att);
    this.#broadcast(raw, ws);
  }

  async webSocketClose(ws) { await this.#departed(ws); }
  async webSocketError(ws) { await this.#departed(ws); }

  async #departed(ws) {
    const att = safeAttachment(ws);
    if (att && att.id) {
      this.#broadcast(JSON.stringify({ e: "bye", d: { i: att.id } }), ws);
    }
    // Last one out forgets the room, so a new game in the same room name does
    // not inherit yesterday's bomb holder.
    if (this.ctx.getWebSockets().filter((s) => s !== ws).length === 0) {
      await this.ctx.storage.deleteAll();
    }
  }

  /* Send to everyone except the sender. THIS is the line that makes the
   * economics work: outgoing messages are not billed as requests, so a room of
   * twenty costs the same to relay as a room of two. */
  #broadcast(data, except) {
    for (const s of this.ctx.getWebSockets()) {
      if (s !== except) trySend(s, data);
    }
  }
}

function safeAttachment(ws) {
  try { return ws.deserializeAttachment(); } catch { return null; }
}

function trySend(ws, data) {
  try { ws.send(data); } catch { /* already closing */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("PyWebLib rooms: ok\n", {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }

    const m = url.pathname.match(/^\/room\/(.+)$/);
    if (!m || !ROOM_RE.test(m[1])) {
      return new Response("not found", { status: 404 });
    }
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }

    // idFromName is the whole trick: the same room name resolves to the same
    // object for every player on earth.
    const id = env.ROOMS.idFromName(m[1]);
    return env.ROOMS.get(id).fetch(request);
  }
};
