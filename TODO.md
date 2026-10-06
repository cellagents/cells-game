# TODO

cells-game is scheduled for public archival after the 4.0.0 release.
Nothing new ships here. The system is being torn apart into:

- `core` — authoritative game server (likely Rust + PyO3)
- `web`  — browser client (continues TypeScript)
- `mcp`  — MCP adapter (continues TypeScript)
- `game-protocol` — the shared wire contract (`@cellagents/game-protocol`,
  seeded by 4.0 as the canonical source of truth)

What landed in 4.0.0:

- Protocol version `1.0`, published as `@cellagents/game-protocol`.
- Capability-based subscriber model (steer / presence / viewport),
  replacing the player / spectator dichotomy on the wire.
- Wire rename (`0/1/2/RIP/serverTellPlayerMove` → `heartbeat/fireFood/
  split/died/tick`), flattened `tick` payload.
- Server-side `map.players.data` + `spectators[]` unified into one
  subscriber list, with `emitTickFor` owning the three camera
  semantics.
- `GET /protocol` HTTP probe for dual-mode clients.
- 27-test mocha suite covering handshake grammar + socket smoke.

## Known gaps worth remembering

- **cells-mcp dual-mode wire fallback.** Shipping separately in
  cells-mcp 2.0.0 against the pre-fork `agar.io-clone` protocol.
  No new work needed in this repo.

- **Harness is unmaintained.** It never spoke the socket directly;
  the only URL affected (`/follow?player=X&managed=1`) is already
  flagged in `harness/TODO.md`.

- **Chat logging.** `logChat: true` still writes raw messages to
  sqlite. Fine for archive-era usage; `core` can rethink retention.

- **No gameplay changes since 3.0.** Physics, metabolism, visibility
  culling and chat behaviour are byte-equivalent across 3.x and 4.x
  on the gameplay layer; only the wire protocol around them changed.
