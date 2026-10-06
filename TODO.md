# TODO

Design / quality follow-ups. The 3.0.0 release unified all three
canvas viewports (`/player`, `/spectator`, `/follow`) onto a single
thin stack (`src/client/js/thin/*`) with a shared `Renderer`,
`createViewport` chrome helper, and `attachInput` for keyboard /
mouse / touch. Legacy `canvas.ts`, `render.ts`, `global.ts` and
`chat-client.ts` were removed as part of that port. Everything below
is a smaller follow-up than fits a patch release.

## 4.0.0 — Official game protocol + capability-based subscribers

Framing: cells-game publishes a stable, documented, versioned
real-time protocol as its public API. The web client, `cells-mcp`,
the harness, and any future bot adapter are all consumers of that
one protocol — none of them lives inside the server as a special
case. MCP becomes a reference *adapter* that holds a subscriber
connection on behalf of a tool-using client, not a protocol-forger
pretending to be a player.

The three items below ship together because they share the same
breakage surface (wire shape, `cells-mcp` handshake, harness URLs).
Shipping them in one coherent release is strictly less disruptive
than splitting them.

- **Rename the numeric socket events (`'0'`, `'1'`, `'2'`).** The
  heartbeat / fire / split channels still use string digits on the
  wire. The client-side sender surface is already named
  (`sendTarget`, `sendFireFood`, `sendSplit`), so this is purely a
  server + client + `cells-mcp` rename on a single wire PR. Target
  names: `'heartbeat'`, `'fireFood'`, `'split'`.

- **Capability-based subscriber model.** Replace the player /
  spectator dichotomy with a uniform subscriber whose shape is
  described by capability flags:

      receive    – gets snapshot + leaderboard + world
      steer      – can send heartbeat / fireFood / split
      presence   – occupies a cell in the world (eats, is eaten,
                   is spawned, can die)
      viewport   – has a screen size the server uses for visibility
                   culling, OR a follow-target id

  Today's roles map to:
      player        = receive + steer + presence + viewport
      spectator     = receive
      follow-view   = receive + viewport (viewport = follow-id)
      managed       = receive, chrome-locked by config

  Handshake sketch: `subscribe({ capabilities, name?, screen?,
  follow? })` replaces the `type=` query + role-specific `gotit`
  payloads. Capability checks live on the server: an adapter whose
  subscriber was granted `steer: false` cannot smuggle a
  `heartbeat`/`split` through its tool layer — the game server
  rejects at the protocol boundary. Lifecycle events (`RIP`,
  `kick`) stay but become capability-gated server-side.

  Deprecate the `type=player|spectator` aliases on the wire; any
  legacy client sending them is unsupported, not translated. The
  web client and `cells-mcp` migrate in the same PR; nothing else
  exists today.

  Benefits worth tracking the rewrite against:
  1. `cells-mcp` becomes a capability-set (`receive + steer` with
     a server-controlled presence, or `receive + steer + presence`
     as a bot), not a protocol-forgery emulating the player
     handshake.
  2. Server collapses `map.players.data` + `spectators[]` into a
     single subscriber list; `enumerateWhatPlayersSee` becomes
     `enumerateSubscribers` with capability-conditional filtering.
  3. Future variants (replay subscriber reading from a recording;
     Python asyncio bot framework; analytics observer) become one
     more capability combination, not a new protocol branch.

- **Shared protocol types package (`src/shared/protocol.ts`).**
  Promoted from design/quality note to a 4.0 release goal because
  it is the thing that makes "official game protocol" tangible
  rather than aspirational. The handshake, event names, payload
  shapes, and capability enum all live in one TypeScript module
  consumed by:

  - The game server (narrows its socket.on handlers).
  - The thin client stack (replaces the `any` casts the connector
    still carries).
  - `cells-mcp` (imports instead of re-declaring).

  Ship as a published package (`@cellagents/game-protocol`) or at
  minimum pin a path dependency so `cells-mcp` upgrades
  deliberately rather than drifting against the server.

## Design / quality (not blocking a major)

- **No tests.** `test/` has a single `util.js` stub. A minimal
  mocha suite over `lib/util.ts` and `map/player.ts` would catch
  regressions.
