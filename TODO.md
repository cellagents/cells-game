# TODO

Follow-up items for future releases. Three correctness items flagged
during the 2.0.0 TypeScript migration were addressed in 2.0.1
(VirusManager.delete, playerDied payload, chat-repository error
handling); everything below is design / quality work.

## Design / quality

- **Numeric socket events (`'0'`, `'1'`, `'2'`).** The heartbeat/fire/split
  channels use string digits. Harder to grep, harder to type. Replace
  with named events (`'heartbeat'`, `'fireFood'`, `'split'`) as a joint
  server+client change.

- **Shared socket.io wire types.** The client (`app.ts`, `canvas.ts`,
  `chat-client.ts`) uses `any` for socket payloads. Extracting a shared
  `src/shared/protocol.ts` (consumed by server, client, and the
  cells-mcp bridge) is the biggest typing win still on the table.

- **Client-side `GameControls` extraction.** The original upstream TODO
  called out `src/client/js/app.ts` and `chat-client.ts` as needing
  extraction into separate control classes. Still applies.

- **Loose `global` state on the client.** `src/client/js/global.ts` keeps
  an index signature so the ad-hoc runtime fields (player, target,
  socket, animLoopHandle, foodSides) still compile. Tightening this
  requires untangling the init order first.

- **No tests.** `test/` has a single `util.js` stub. A minimal mocha
  suite over `lib/util.ts` and `map/player.ts` would catch regressions.

## Toolchain

- **`ts-loader` lags behind TypeScript 7.** The migration pinned TS to
  5.9 so webpack builds work. Revisit once ts-loader 10+ ships (or
  swap to `esbuild-loader` / `swc-loader`).

- **ESLint is unwired.** The old `eslint.config.js` targeted `.js` files
  only; it was dropped along with the eslint dep. Reintroduce with
  `typescript-eslint` when the codebase has a clear convention to
  enforce.
