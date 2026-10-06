# 4.0.0 — Protocol freeze, capability subscribers, dual-mode mcp

Last release before `cells-game` and `cells-mcp` are archived and the
system is torn apart into `core` / `mcp` / `game-protocol` / `web`.
Nothing new is a goal here. The goal is to **crystallise the wire
contract** so the four new repos have a stable interface to compile
against, and so `cells-mcp` keeps working against both pre-4.0
servers it may encounter in the wild and the new 4.0 server.

## Deliverables

1. `src/shared/protocol.ts` in cells-game: the single source of
   truth for the handshake, event names, payload shapes, capability
   enum, and version identifier.
2. Mirrored package in the `game-protocol` repo (already created
   empty on GitHub) that cells-game, cells-mcp, and the future
   `core`/`web` repos all consume.
3. cells-game server speaks only the 4.0 protocol; rejects legacy
   handshakes with an explicit error payload.
4. cells-game web client (thin stack) migrated to the 4.0 protocol.
5. cells-mcp speaks **both** 4.0 and the pre-4.0 protocol. On
   connect it probes 4.0; on a legacy-shape response it switches to
   legacy for the remainder of that socket's lifetime.
6. Minor server cleanups found along the way: collapse
   `map.players.data` + `spectators[]` into one subscriber list;
   drop the `type=player|spectator` query parameter.
7. `harness/TODO.md` migration note updated once cells-mcp handshake
   stabilises.

Nothing else. No gameplay changes. No new features. No performance
work. Those are post-archival concerns for `core`.

## Protocol specification

### Versioning

Protocol version is a short string: `"4.0"`. It is sent by both
sides in the first exchange so each can tell what it's talking to.

```
Rule 1: The server speaks exactly one protocol version per build.
Rule 2: The client advertises what it would like; server responds
        with what it will serve or refuses the connection.
Rule 3: Minor versions ("4.1") are backwards-compatible with the
        same-major client; major versions are not.
```

Pre-4.0 servers never sent a version marker. Their presence is
inferred by shape (see "Legacy detection" below).

### Transport

- Socket.IO over the existing HTTP server, same port, same
  `io(...)` binding. No change in deployment.
- JSON payloads. No binary / protobuf in this revision; those are
  `core` concerns.

### Handshake

Replaces the current `?type=player|spectator` query + role-specific
`gotit`.

**Client → server (immediately after `connect`):**

```ts
socket.emit('subscribe', {
    protocol: '4.0',               // required
    capabilities: ['receive', 'steer', 'presence', 'viewport'],
    name?: string,                 // required if capabilities.includes('presence')
    screen?: { width: number; height: number },  // required if 'viewport' + no follow
    follow?: string                // required if 'viewport' + no screen
});
```

Valid capability combinations (any subset of the four flags, with
some combinations rejected server-side as nonsensical):

| Capabilities                                          | Today's role     |
|-------------------------------------------------------|------------------|
| `receive`                                             | spectator (full) |
| `receive + viewport` (with `follow`)                  | follow viewer    |
| `receive + viewport` (with `screen`)                  | spectator slice  |
| `receive + steer + presence + viewport` (with `screen`)| player           |
| `receive + steer + presence + viewport` (with `screen`, bot) | future llm bot |

Invalid: `steer` without `presence` (nothing to steer); `presence`
without `viewport` (server needs a screen size to cull); `presence`
without `name`.

**Server → client:**

Success:
```ts
socket.emit('welcome', {
    protocol: '4.0',
    subscriberId: string,          // socket id, surfaced for clarity
    world: { width: number; height: number },
    self?: { id: string; hue: number; ... }  // present iff presence granted
});
```

Rejection (unknown protocol version, invalid capability set, bad
name, server full, etc.):
```ts
socket.emit('reject', {
    code: 'UNSUPPORTED_PROTOCOL' | 'INVALID_CAPABILITIES'
        | 'INVALID_NAME' | 'SERVER_FULL' | ...,
    message: string
});
// then: socket.disconnect()
```

Pre-4.0 clients that connect with `?type=player&...` and emit the
old `gotit` payload receive `reject({code: 'UNSUPPORTED_PROTOCOL'})`
and are disconnected. No translation shim.

### Client-to-server events (steer-only)

Server only accepts these when the subscriber has `steer` and
`presence` capabilities. Attempts without are silently dropped
(so a buggy adapter doesn't desync, but a misbehaving one doesn't
affect the world).

| Event        | Payload                          | Replaces |
|--------------|----------------------------------|----------|
| `heartbeat`  | `{ x: number; y: number }`       | `'0'`    |
| `fireFood`   | — (no payload)                   | `'1'`    |
| `split`      | — (no payload)                   | `'2'`    |
| `windowResized` | `{ width, height }`           | unchanged |
| `respawn`    | — (no payload)                   | unchanged |
| `pingcheck`  | — (no payload)                   | unchanged |
| `playerChat` | `{ sender: string; message: string }` | unchanged |

### Server-to-client events (receive-only)

| Event                   | Payload shape | Who gets it |
|-------------------------|---------------|-------------|
| `welcome` / `reject`    | see handshake | all |
| `tick`                  | see "Tick payload" below | subscribers with `receive` |
| `leaderboard`           | `{ players: number; leaderboard: Array<{id, name}> }` | subscribers with `receive` |
| `pongcheck`             | — | emitter of pingcheck |
| `kick`                  | `{ reason: string }` | subscribers with `presence` |
| `died`                  | — | subscribers with `presence` |
| `playerJoin`            | `{ name: string }` | all |
| `playerDisconnect`      | `{ name: string }` | all |
| `playerDied`            | `{ playerEatenName: string; killerName: string | null }` | all |
| `serverSendPlayerChat`  | `{ sender: string; message: string }` | all |
| `serverMSG`             | `string` (deprecated; kept for one minor) | all |

`RIP` → `died` (semantic rename; the old event name was never
documented well).

### Tick payload

Formerly `serverTellPlayerMove(playerData, visiblePlayers, foods,
mass, viruses)`. Flattened into one object for easier type
narrowing:

```ts
socket.emit('tick', {
    self: null | {
        id: string;
        x: number;
        y: number;
        massTotal: number;
        hue: number;
        cells: Array<{ x: number; y: number; mass: number; radius: number }>;
    },
    players: Array<{
        id: string;
        name: string | null;
        hue: number;
        massTotal: number;
        cells: Array<{ x: number; y: number; mass: number; radius: number }>;
    }>,
    food: Array<{ x: number; y: number; hue: number; radius: number }>,
    mass: Array<{ x: number; y: number; hue: number; radius: number }>,
    viruses: Array<{ x: number; y: number; radius: number }>
});
```

Semantics:

- `self` is non-null iff the subscriber has `presence`. For
  spectators it is `null`.
- `players` always contains all visible-to-this-subscriber players.
  For a player subscriber, self is included in `players` (matches
  current server behaviour; the renderer uses this).
- Food/mass/viruses are the visible-to-this-subscriber subset.

### Capability enforcement (server-side)

- Server records each socket's granted capability set at subscribe
  time.
- Steer-channel events (`heartbeat`, `fireFood`, `split`, `respawn`,
  `windowResized`) check `capabilities.includes('steer')` before
  acting. Non-steer subscribers are silently ignored.
- `playerChat` requires `presence` (so spectators can't impersonate
  players in chat). Spectators get a separate `spectatorChat` only
  if we decide to allow it; v1 denies it.
- Subscribers without `receive` get nothing pushed. (Edge case:
  nothing today needs this, so the grant rule is "`receive`
  defaults to true unless explicitly denied in the subscribe
  payload"; may remove entirely if nothing exercises it.)

### Legacy detection (cells-mcp dual mode)

cells-mcp 2.x will meet both 4.0 servers (new) and pre-4.0 servers
(archived, running wherever today's `cellagents.dev` has been
deployed). It must pick the right wire per connection.

Strategy — one probe, no race:

1. Connect socket.io as today (no `?type=` query; the 4.0 server
   accepts bare connections).
2. On `connect`, emit `subscribe({ protocol: '4.0', capabilities:
   ['receive','steer','presence','viewport'], ... })`.
3. Set a 1500ms timer waiting for `welcome` with `protocol: '4.0'`.
4. **Outcome A** — `welcome` received within window:
     - If payload includes `protocol: '4.0'`: 4.0 mode confirmed.
       Done.
     - If payload lacks `protocol`: this is a pre-4.0 server that
       ignored the `subscribe` emit and reacted to something else.
       Fall through to Outcome B.
5. **Outcome B** — `reject` received, or timer fires, or any other
   signal that 4.0 was not understood:
     - Disconnect and reconnect with `?type=player` query.
     - Emit legacy `gotit({name, screenWidth, screenHeight})` on
       `welcome`.
     - Flag the socket as legacy for its lifetime.

The flag is set on the socket, not globally, so a single cells-mcp
process could in principle talk to multiple game servers. In
practice we expect one server per cells-mcp runtime.

**Fallback is sticky.** Once a socket flips to legacy, it never
re-attempts 4.0 even on reconnect. If a server upgrade changes the
wire mid-session, the user re-establishes the MCP session.

**Legacy mode scope.** cells-mcp 2.x retains its current
implementation (minus the dual-mode wrapper), which is why the only
thing we need to add here is the probe + fallback. No new legacy
features; no bug fixes against the legacy server beyond what cells-mcp
has today.

### Package: `@cellagents/game-protocol`

Lives in the GitHub repo `cellagents/game-protocol`. Export shape:

```
src/
  index.ts            // re-exports
  version.ts          // export const PROTOCOL_VERSION = '4.0';
  handshake.ts        // Subscribe, Welcome, Reject types
  events.ts           // Client→server and server→client event unions
  entities.ts         // Snapshot shapes (Cell, Player, Food, ...)
  capabilities.ts     // Capability enum + validation helpers
```

Consumers:

- cells-game: `import { ... } from '@cellagents/game-protocol'`
  for both the server's socket.on handlers and the client's thin
  connector.
- cells-mcp: same import, used by both the 4.0 code path and
  (for shared types like `Cell`) the legacy code path.
- Future `core` repo: regenerated schema (TypeScript source is the
  reference; a Rust/Go port of the shape lives in `core` manually
  or via a code-gen step in `game-protocol`, TBD).

Published as a path dependency during this release (`file:
../game-protocol`); converts to a real npm/github-pkg publish in a
later step once the shape is stable.

### Minor server cleanups (confirmed scope)

Only cleanups that fall out of touching the handshake:

- Collapse `map.players.data` and `spectators[]` into one
  `subscribers` list keyed by socket id, with capabilities stored
  per entry. `enumerateWhatPlayersSee` becomes
  `enumerateSubscribers` with capability-conditional filtering.
- Drop the `type=player|spectator` query parameter. All subscribers
  connect bare and declare capabilities in the subscribe payload.
- Rename `tickPlayer` → `tickSubscriber`; it's capability-gated
  (physics only runs for `presence`-granted subscribers).

Deferred to `core` (NOT in 4.0):

- Deterministic / seedable physics.
- Replay logging.
- Pluggable tick source.
- Rust/Go rewrite of the server.
- Protocol framing (JSON → protobuf, binary snapshots, etc.).

## Migration order

Within cells-game, feat/4.0-protocol branch:

1. **Day 1 — Protocol module.** Author `src/shared/protocol.ts`
   with the full type set. Verify it compiles standalone with no
   server/client dependencies. (This file is the thing we'll move
   to the `game-protocol` repo in step 7.)
2. **Day 1 — Server handshake.** Replace `type=player|spectator`
   branching in `addPlayer`/`addSpectator` with a single
   `addSubscriber` that reads the `subscribe` payload. Keep
   emitting `welcome` but with the new payload shape; reject
   malformed subscribes.
3. **Day 2 — Server unification.** Merge the two subscriber lists;
   rewrite `sendUpdates` to iterate the unified list with
   per-subscriber visibility.
4. **Day 2 — Server wire rename.** `0/1/2/RIP/serverTellPlayerMove`
   → `heartbeat/fireFood/split/died/tick`. Pure find-replace plus
   payload reshape on `tick`.
5. **Day 3 — Client migration.** Update the thin connector to the
   new handshake and events. Update the four viewport pages'
   `connect()` calls to pass capabilities instead of `role`.
6. **Day 3 — Tests + manual verification.** Full-stack smoke:
   lobby → player, lobby → spectator, lobby → follow, /managed.
   Observe tick payloads with devtools.
7. **Day 4 — Promote protocol module to game-protocol repo.**
   Clone the empty repo, copy `src/shared/protocol.ts` as the
   package source, publish via path dep, update cells-game to
   import from the dep instead of the local file.
8. **Day 4 — Bump to 4.0.0, merge, tag.**

Within cells-mcp, feat/4.0-dual-protocol branch (parallel):

9. **Day 5 — Legacy capture.** The current `GameClient` is already
   the legacy implementation. Rename class/file to make this
   explicit (`LegacyGameClient` / `legacy-game-client.ts`).
10. **Day 5 — 4.0 implementation.** New `GameClient` using
    `@cellagents/game-protocol` types. Reuses the same public API
    the rest of cells-mcp calls into so swap is transparent.
11. **Day 6 — Probe + fallback wrapper.** `connect()` returns a
    `GameClient | LegacyGameClient` behind a shared interface.
    Probe logic as spec'd above.
12. **Day 6 — Integration test.** Run cells-mcp 2.x against both
    cells-game 3.x (archived state) and 4.0 (new state). Confirm
    tools work in both modes.
13. **Day 7 — cells-mcp 2.0.0 release, tag, merge.** (cells-mcp
    gets its own major because this is a breaking change in its
    protocol-handling layer, even though the external MCP tool
    surface is unchanged.)

## Risks and open questions

**R1 — The dual-mode detection probe is heuristic.** If a pre-4.0
server happens to respond to the unknown `subscribe` emit with a
`welcome` by coincidence (because it responds to anything via a
different code path), we might wrongly conclude it's a 4.0 server.
Mitigation: 4.0 server's `welcome` carries `protocol: '4.0'`; if
that field is absent we treat it as pre-4.0 and fall back. This is
robust against the actual pre-4.0 server (which does not emit
`welcome` until it sees a legacy `type=` query and `gotit`), but
noting the heuristic nature.

**R2 — Capability subset explosion.** Every reasonable combination
is listed above; invalid combinations are rejected. If a new
capability lands post-4.0, the validator just gets more cases. No
anticipated issue.

**R3 — Harness URL migration carries over.** The 3.0 TODO note in
`harness/TODO.md` about `/managed?player=X` still applies; 4.0
doesn't change those URLs but does change the on-the-wire
handshake. Harness update becomes a 4.0 task once 4.0 server is
deployed. Not in this plan's scope.

**R4 — cells-mcp legacy-mode bugs.** The current gameClient has
known behaviour the LLM clients depend on; we're not supposed to
be fixing anything in legacy mode. If an LLM-visible issue appears
during dual-mode testing in a case that only trips the legacy
path, we document it and don't fix it — the fix lives in `mcp` in
the post-archival era.

**O1 — Should `welcome` include an initial snapshot?** Currently
clients wait for the next `tick`. One snapshot embedded in
`welcome` would speed up first paint on slow fan-out rates. Low
priority; defer unless cheap.

**O2 — Should `subscribe` support an opaque reconnection token?**
A reconnecting player could resume their identity if the token
survives a socket drop. Nice-to-have but introduces session state
on the server. Defer to `core`.

## Not in this release

Explicitly excluded, to prevent scope creep. Each has its own
reason:

- Gameplay changes (physics, metabolism, chat UI, admin features).
  Pre-archival state should match 3.0 behavior exactly in gameplay.
- Performance work. Deferred to `core`.
- Binary / protobuf encoding. Deferred to `core` or to
  `game-protocol` once we have a concrete need.
- A separate HTTP API wrapper over socket.io. Not needed; the
  protocol IS the API, documented via the shared types package.
- UI changes. 3.0's chrome/config/viewport refactor stands.
- Tests beyond smoke / regression. The archival timeline doesn't
  warrant a test-suite build-out here; `core` starts clean.

## Review checklist (before coding starts)

- [ ] Capability names and semantics correct? (`receive`, `steer`,
      `presence`, `viewport`.)
- [ ] Handshake payload shape — anything missing or over-specified?
- [ ] Legacy detection probe strategy — risk acceptable?
- [ ] Game-protocol package layout matches your plans for the
      post-archival `game-protocol` repo?
- [ ] Migration order has no hidden sequencing bug?
- [ ] Scope exclusions ("Not in this release") correct?

Ping back on review; I'll start coding in the order above once
these are confirmed.
