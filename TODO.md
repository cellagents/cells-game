# TODO

Design / quality follow-ups. Correctness items from the 2.0.0 migration
were cleared in 2.0.1; 2.1.0 added the dark-mode canvas sync, the
out-of-arena shading, and ESLint. Everything below is a bigger-shaped
refactor than fits a patch release.

## Design / quality

- **Numeric socket events (`'0'`, `'1'`, `'2'`).** The heartbeat/fire/split
  channels use string digits. Harder to grep, harder to type. Replace
  with named events (`'heartbeat'`, `'fireFood'`, `'split'`) as a joint
  server+client change.

- **Shared socket.io wire types.** The client (`app.ts`, `canvas.ts`,
  `chat-client.ts`) uses `any` for socket payloads - the ESLint pass
  flags each one as a warning. Extracting a shared
  `src/shared/protocol.ts` (consumed by server, client, and the
  cells-mcp bridge) is the biggest typing win still on the table and
  would drop the 75-warning count toward zero.

- **Client-side `GameControls` extraction.** The original upstream TODO
  called out `src/client/js/app.ts` and `chat-client.ts` as needing
  extraction into separate control classes. Still applies.

- **Loose `global` state on the client.** `src/client/js/global.ts` keeps
  an index signature so the ad-hoc runtime fields (player, target,
  socket, animLoopHandle, foodSides) still compile. Tightening this
  requires untangling the init order first.

- **No tests.** `test/` has a single `util.js` stub. A minimal mocha
  suite over `lib/util.ts` and `map/player.ts` would catch regressions.

## Known bugs

- **ESC does not navigate to lobby from `/player` and `/spectator`.** The
  × overlay button works (anchor click → navigation fires normally).
  The ESC keydown handler runs (we can observe `socket.close()` taking
  effect: on `/player` the game freezes, on `/spectator` the overlay
  shows "Reconnecting..."), and `window.location.href` is unchanged
  afterwards. Reproduced in both Firefox and Chrome, plain top-level
  tab, no iframe, no PWA. Confirmed from DevTools console that
  `window.location.assign('/')`, `window.location.replace('/')`, and
  `window.location = '/'` all navigate successfully after the ESC
  freeze, so `location` writes themselves are not blocked. Writing
  `location.href` from inside the keydown handler is dropped silently.
  Tried: deferring the write via `setTimeout(..., 0)` (no effect);
  swapping between `.href` / `.assign` / `.replace`; removing a
  re-entry guard that was trapping subsequent attempts. Ruled out:
  service worker (none registered), beforeunload handler (none set),
  pointer lock / fullscreen (none used), the canvas keydown handler
  stopping propagation (`directionDown` in `canvas.ts` neither
  prevents default nor stops propagation on ESC). Code path lives in
  `leaveToLobby()` in `src/client/js/player.ts`,
  `src/client/js/spectator.ts`, `src/client/js/follow.ts`. Needs
  deeper investigation; a minimal repro outside the socket.io/canvas
  context would help isolate whether this is a quirk of running the
  write immediately after `socket.close()` or something about the
  keydown target chain.
