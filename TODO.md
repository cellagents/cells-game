# TODO

Design / quality follow-ups. The 3.0.0 release unified all three
canvas viewports (`/player`, `/spectator`, `/follow`) onto a single
thin stack (`src/client/js/thin/*`) with a shared `Renderer`,
`createViewport` chrome helper, and `attachInput` for keyboard /
mouse / touch. Legacy `canvas.ts`, `render.ts`, `global.ts` and
`chat-client.ts` were removed as part of that port. Everything below
is a smaller follow-up than fits a patch release.

## 4.0.0 — Wire-protocol + subscriber-model break

These two land together because they share the same breakage surface
(wire shape + `cells-mcp` migration + harness update). Shipping them
in one coherent release is strictly less disruptive than two.

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

  Benefits worth tracking the rewrite against:
  1. `cells-mcp` becomes a capability-set (`receive + steer`
     against a server-controlled presence, or `receive + steer +
     presence` as a bot), not a protocol-forgery emulating the
     player handshake.
  2. Server collapses `map.players.data` + `spectators[]` into a
     single subscriber list; `enumerateWhatPlayersSee` becomes
     `enumerateSubscribers` with capability-conditional filtering.
  3. Future variants (replay subscriber reading from a recording;
     LLM-driven participant; analytics observer) become one more
     capability combination, not a new protocol branch.

  Handshake sketch: `subscribe({ capabilities, name?, screen?,
  follow? })` replaces the `type=` query + role-specific `gotit`
  payloads. Lifecycle events (`RIP`, `kick`) stay but become
  capability-gated server-side.

  Scope note: this is the trigger-driven path. Hold until a concrete
  need appears (replay viewer, LLM agent subscriber, harness-side
  cleanup pressure) OR until the wire rename above ships, since
  both break `cells-mcp` and the harness in the same way.

## Design / quality (not blocking a major)

- **Shared socket.io wire types.** The thin connector still accepts
  `any`-ish socket payloads inside its handlers. Extracting a shared
  `src/shared/protocol.ts` (consumed by server, client, and the
  cells-mcp bridge) is the biggest typing win still on the table.
  Naturally sized to land alongside the 4.0 wire rename.

- **No tests.** `test/` has a single `util.js` stub. A minimal mocha
  suite over `lib/util.ts` and `map/player.ts` would catch regressions.
