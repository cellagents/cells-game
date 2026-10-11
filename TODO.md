# TODO

cells-game is scheduled for public archival after the 4.0.x line.
Nothing new ships here. The system is being torn apart into:

- `core`: authoritative game server (likely Rust + PyO3)
- `web`: browser client (continues TypeScript)
- `mcp`: MCP adapter (continues TypeScript)
- `game-protocol`: the shared wire contract (`@cellagents/game-protocol`,
  seeded by 4.0 as the canonical source of truth)

What landed in 4.0.0:

- Protocol version `1.0`, published as `@cellagents/game-protocol@1.0.0`.
- Capability-based subscriber model with six flags (`presence`,
  `steer`, `act`, `chat`, `omniscient`, `follow`), grants-only
  semantics, wall-hack combinations rejected during handshake.
- Wire rename to `heartbeat`, `action` (`{type: 'split'|'eject'}`),
  `setFollow`, `say`, `died`, `tick`, `message`, `rulesChanged`,
  `actionsChanged`; flattened `tick` payload with a discriminated
  entity list (`cell`, `food`, `ejected`, `virus`) and an
  unknown-kind fallback.
- Mandatory `subscribe.userAgent` and `welcome.server`
  (`name/semver`); opaque `clientId` carried through so one logical
  identity survives reconnects.
- Two emitted effects: `invulnerable` on players during a 3 s spawn
  grace (cannot be eaten, can still eat), `noMerge` on freshly
  split cells until `timeToMerge`.
- Server-side `map.players.data` plus `spectators[]` unified into
  one subscriber list, with `emitTickFor` owning the three camera
  semantics (first-person, omniscient full-map, omniscient-plus-
  follow).
- `GET /protocol` HTTP probe returns `{ protocol, server }`; the
  server identity string is `cells-game/<version>`.
- Chat primitive: `say`/`message` with scope routing
  (`all`/`direct`; `team` is reserved and dropped silently),
  rate-limited per `rules.chatRateHz`, truncated to
  `rules.chatMaxLength`. Admin broadcasts arrive as `message` with
  `from: null`.
- Web client ported onto the 1.0 surface across all four viewports;
  webpack injects `__CELLS_VERSION__` into the user-agent; Unicode
  nickname regex.
- 23-test mocha suite covering handshake grammar, capability gates,
  effects, chat routing (`direct` echo, `team` dropped, truncation),
  `setFollow` swap, action-without-cap, `say.data` round-trip.

## Known gaps worth remembering

- **cells-mcp dual-mode wire fallback.** Shipping in cells-mcp 2.x
  against both the 1.0 wire and the pre-fork `agar.io-clone`
  protocol. No new work needed in this repo.

- **Harness is unmaintained.** It never spoke the socket directly;
  the only URL affected (`/follow?player=X&managed=1`) is already
  flagged in `harness/TODO.md`.

- **Chat logging.** `logChat: true` still writes raw messages to
  sqlite. Fine for archive-era usage; `core` can rethink retention.

- **Gameplay changes since 3.0.** The 3 s spawn-grace invulnerability
  is a gameplay change delivered as part of 1.0, intentionally kept
  so the `invulnerable` effect in the protocol is real. The chat
  rate-limit (`chatRateHz`) and length cap (`chatMaxLength`) are
  also new. Physics, metabolism and visibility culling are otherwise
  byte-equivalent across 3.x and 4.x.
