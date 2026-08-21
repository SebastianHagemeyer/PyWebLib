# PyWebLib multiplayer relay

The server behind `import net`. One [Durable Object](https://developers.cloudflare.com/durable-objects/)
per room, relaying each player's updates to everyone else in it.

**You do not need this to use multiplayer.** If you never deploy it, `net.js`
falls back to Supabase Realtime and everything works. Deploy it when you want
multiplayer to be cheap.

## Why it exists

Supabase bills broadcast **per recipient**: one update in a room of four counts
as five messages. Traffic grows with the *square* of the room size, so a few
classes a week runs into real money.

A relay does not have to work that way. Here only messages arriving **in** are
billed, and incoming WebSocket messages are counted 20:1 on top of that. The
fan-out back to the room is free, so the squared term disappears. Measured
against the real code, relaying ten rounds of updates:

| Room size | Messages relayed | Cloudflare bills | Supabase would bill |
|---|---|---|---|
| 2 | 6 | 6 | 12 |
| 4 | 36 | 12 | 48 |
| 8 | 168 | 24 | 192 |
| 16 | 960 | 64 | 1024 |

Five classes a week lands at roughly 17k requests and 3.1k GB-s **per class
day**, against a free-plan allowance of 100,000 requests and 13,000 GB-s a day.

## Deploy

```bash
cd worker
npx wrangler login      # first time only
npx wrangler deploy
```

Wrangler prints a URL like `https://pyweblib-rooms.YOUR-NAME.workers.dev`. Put
it in `net.js`:

```js
const RELAY_URL = PWL.netRelayUrl || "https://pyweblib-rooms.YOUR-NAME.workers.dev";
```

That is the only change. Reload the Playground and check in the console:

```js
PWL.net.transport()   // "cloudflare"
```

Nothing else moves: no Python changes, no student code changes, and the Supabase
path stays as the fallback for anyone who has not deployed this.

## How it works

`net.join("bomb-tag")` opens a WebSocket to `/room/bomb-tag`. Cloudflare
guarantees the Durable Object with a given name exists **exactly once in the
world**, so `idFromName(room)` puts every player in that room onto the same
object wherever they are. It relays what arrives to everyone else connected.

Three things are worth knowing if you edit `src/index.js`:

- **Hibernation.** Sockets are accepted with `ctx.acceptWebSocket`, so an idle
  room is evicted from memory and stops costing duration while staying
  connected. That means plain `this.something` fields do **not** survive.
  Per-player state rides on each socket's attachment (2 KB limit, hence the
  1400-byte message cap) and the room's shared values live in `ctx.storage`.
  Anything you stash on `this` will silently vanish mid-game.
- **Late joiners are the relay's job.** It already knows everyone's last state,
  so a newcomer is sent the room on connect. On the Supabase path the existing
  players have to re-broadcast instead; `net.js` skips that work here via the
  transport's `serverSyncsNewPeers` flag.
- **The room empties itself.** Last player out triggers `storage.deleteAll()`,
  so tomorrow's game in the same room name does not inherit today's bomb holder.

## Limits

Set in `src/index.js`, and matched in `net.js`:

| | |
|---|---|
| Players per room | 24 |
| Message size | 1400 bytes |
| Shared values per room | 32 |
| Messages per socket | 400 per 10s |

The rate limit is the backstop for a student loop that forgets to throttle:
excess is dropped rather than disconnected, so the game keeps running and just
stops paying for frames nobody sees.

## Testing without deploying

`npx wrangler dev` runs it locally; point `RELAY_URL` at the URL it prints.
