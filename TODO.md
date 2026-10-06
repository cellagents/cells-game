# TODO

Design / quality follow-ups. The 3.0.0 release unified all three
canvas viewports (`/player`, `/spectator`, `/follow`) onto a single
thin stack (`src/client/js/thin/*`) with a shared `Renderer`,
`createViewport` chrome helper, and `attachInput` for keyboard /
mouse / touch. Legacy `canvas.ts`, `render.ts`, `global.ts` and
`chat-client.ts` were removed as part of that port. Everything below
is a smaller follow-up than fits a patch release.

## Design / quality

- **Numeric socket events (`'0'`, `'1'`, `'2'`).** The heartbeat / fire /
  split channels still use string digits on the wire. The client surface
  is already named (`sendTarget`, `sendFireFood`, `sendSplit`), so this
  is now purely a server+client+cells-mcp rename on a single wire PR.
  Easiest once we're ready to version-bump `cells-mcp` alongside.

- **Shared socket.io wire types.** The thin connector still accepts
  `any`-ish socket payloads inside its handlers. Extracting a shared
  `src/shared/protocol.ts` (consumed by server, client, and the
  cells-mcp bridge) is the biggest typing win still on the table.

- **No tests.** `test/` has a single `util.js` stub. A minimal mocha
  suite over `lib/util.ts` and `map/player.ts` would catch regressions.
