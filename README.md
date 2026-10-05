# cells-game

A multiplayer cell-eating game: move around a map, eat food, grow,
split, and devour smaller players. Server-authoritative state over
Socket.IO; HTML5 canvas client served from the same process.

## Lineage

This repo is **a fork of [`owenashurst/agar.io-clone`](https://github.com/owenashurst/agar.io-clone)**,
itself an open-source clone of the browser game
[**agar.io**](https://agar.io) by Miniclip / Matheus Valadares.
The original `agar.io` is closed source and unaffiliated with this
project.

Upstream MIT license carries through (see `LICENSE`).

We track the upstream lineage on branch `upstream-master`; our work lives on `main`.

## Relationship with `cellagents` organization

Cell agents is an educational project where **LLM agents play this
game against each other and against human players.** This repo is one
of five components in that stack; its job is to be the shared,
authoritative game world.

Full picture, repository map and architecture diagrams:
→ [**cellagents.dev/developers**](https://cellagents.dev/developers/)

If you just want to play, visit [**game.cellagents.dev**](https://game.cellagents.dev).

## Running locally

Node 22+. From a clean checkout:

```bash
npm install
npm start
```

Open <http://localhost:3000>. Configuration lives in a JSON file at the
repo root. Copy the committed template and edit the copy:

```bash
cp config.example.json config.json
```

The loader searches, in order: `$CELLAGENTS_GAME_CONFIG`,
`./config.json`, `./config.example.json`. The first file that exists
wins. `config.json` is gitignored so local tuning doesn't leak into
version control.

A handful of fields can also be overridden via environment variables
without editing the file (useful for Docker / CI / test harnesses):

| Variable | Overrides |
|---|---|
| `HOST` | `host` |
| `PORT` | `port` |
| `ADMIN_PASS` | `adminPass` (bearer token for the `/admin/*` HTTP API) |
| `MAX_HEARTBEAT_INTERVAL` | `maxHeartbeatInterval`. Set to `0` to disable the kick entirely. |
| `CELLAGENTS_GAME_CONFIG` | absolute path to an alternate config file |

Or with Docker:

```bash
docker build -t cells-game .
docker run --rm -p 3000:3000 cells-game
```

## How to play

- Move your mouse to steer your cell.
- Eat food particles and smaller players to grow.
- Press `space` to split, `w` to spit food.
- Objective: outgrow and outlast everyone else.

Players without any mass yet are briefly invincible so new joiners
have a grace period. The bigger you are, the slower you move.

## What's in the repo

- `src/server/` - Socket.IO server (TypeScript), authoritative world
  state, physics loop (60 Hz), metabolism/leaderboard loop (1 Hz), state
  fan-out (40 Hz).
- `src/client/` - the default web client (TypeScript, canvas renderer,
  input, chat). Served from the same Node process at `/`.
- `config.example.json` - checked-in default configuration (world
  size, port, admin password, etc.). Copy to `config.json` to tune.
- `src/config.ts` - typed config loader and env-override logic.
- `scripts/build.mjs`, `webpack.config.js` - server tsc + client webpack bundle.
- `tsconfig.server.json`, `tsconfig.client.json` - TypeScript configs.
- `Dockerfile` - Node 22 Alpine, single stage.

## License

MIT, carried from the upstream fork. See `LICENSE`.
