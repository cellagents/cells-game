# TODO

Items noticed during the TypeScript migration. These are preserved as-is in
code (behavior parity was the rule) and tracked here for a follow-up pass.

## Likely bugs

- **`VirusManager.delete` takes an index, callers pass an array.**
  `src/server/map/virus.ts` exposes `delete(virusCollision: number)` which
  calls `this.data.splice(virusCollision, 1)`. `src/server/server.ts`
  invokes it with `map.viruses.delete(eatenVirusIndexes)` where
  `eatenVirusIndexes` is `number[]`. `splice()` coerces the array to a
  number (single-element arrays coerce to that element, multi-element
  arrays coerce to `NaN` which rounds to 0), so only one virus is ever
  removed per tick and the rest linger. `FoodManager.delete` and
  `MassFoodManager.remove` already use `util.removeIndexes` with an array,
  which is the correct shape.

- **`game-logic.ts` imports config but never references it.** The module
  only exports `adjustForBoundaries`, which is passed `gameWidth` and
  `gameHeight` as parameters. The import predates the migration and can
  be dropped once a cleanup pass starts.

- **`playerDied` event payload mismatch.** Server emits
  `{ name: playerGotEaten.name }` (`src/server/server.ts`) but the client
  listener reads `data.playerEatenName` (`src/client/js/app.ts`). Flagged
  with an inline TODO in the upstream fork; still unresolved.

- **Admin kick parses `reason` incorrectly.** In `src/server/server.ts`,
  the loop builds `reason` from `data[1..n]` guarded by
  `if (f === data.length)`, which is never true inside a `for` with
  `f < data.length`. Result: the final word of the reason is silently
  dropped. Preserved for now.

## Design / quality

- **Numeric socket events (`'0'`, `'1'`, `'2'`).** The heartbeat/fire/split
  channels use string digits. Harder to grep, harder to type. Replace
  with named events (`'heartbeat'`, `'fireFood'`, `'split'`) as a joint
  server+client change.

- **Shared socket.io wire types.** The client (`app.ts`, `canvas.ts`,
  `chat-client.ts`) uses `any` for socket payloads. Extracting a shared
  `src/shared/protocol.ts` (consumed by server, client, and the cells-mcp
  bridge) is the biggest typing win still on the table.

- **Client-side `GameControls` extraction.** The original upstream TODO
  called out `src/client/js/app.ts` and `chat-client.ts` as needing
  extraction into separate control classes. Still applies.

- **Loose `global` state on the client.** `src/client/js/global.ts` keeps
  an index signature so the ad-hoc runtime fields (player, target,
  socket, animLoopHandle, foodSides) still compile. Tightening this
  requires untangling the init order first.

- **`sqlite3` repositories swallow errors.** `chat-repository.ts` and
  `logging-repository.ts` resolve on both success and failure. Callers
  can't distinguish. Return the error (or at least surface a boolean).

- **No tests.** `test/` has a single `util.js` stub. The migration
  verified behavior only via build + boot + HTTP smoke. A minimal mocha
  suite over `lib/util.ts` and `map/player.ts` would catch regressions.

## Toolchain

- **`ts-loader` lags behind TypeScript 7.** The migration pinned TS to
  5.9 so webpack builds work. Revisit once ts-loader 10+ ships (or
  swap to `esbuild-loader` / `swc-loader`).

- **ESLint is unwired.** The old `eslint.config.js` targeted `.js` files
  only; it was dropped along with the eslint dep. Reintroduce with
  `typescript-eslint` when the codebase has a clear convention to
  enforce.
