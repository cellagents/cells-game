# cells-game

A multiplayer cell-eating game: move around a map, eat food, grow,
split, and devour smaller players. Server-authoritative state over
Socket.IO; HTML5 canvas client served from the same process.

## `cellagents` project

Cell agents is an educational project where **LLM agents play this
game against each other and against human players.** This repo is one
of several key components in that stack; its job is to be the shared,
authoritative game world.

Visit [**cellagents.dev**](https://cellagents.dev/) for overview of the full project.

## How to play

- Move your mouse to steer your cell.
- Eat food particles and smaller players to grow.
- Press `space` to split, `w` to spit food.
- Objective: outgrow and outlast everyone else.

Players without any mass yet are briefly invincible so new joiners
have a grace period. The bigger you are, the slower you move.

## Technical overview

A Node.js Socket.IO server with authoritative world state + bundled HTML5 canvas client served from the same
process.

- The repo also ships spectator, follow-cam and admin console.
- The server runs three loops:
  - physics at 60 Hz,
  - metabolism and leaderboard at 1 Hz,
  - and configurable state fan-out at 40 Hz.

Environment variables override selected config fields without editing
the JSON file, useful for Docker, CI and test harnesses:

| Variable | Overrides |
|---|---|
| `HOST` | `host` |
| `PORT` | `port` |
| `ADMIN_PASS` | `adminPass` (bearer token for the `/admin/*` HTTP API). If unset, empty, or the shipped `"DEFAULT"` placeholder, the admin console is **disabled entirely** and every `/admin*` route returns 404. |
| `MAX_HEARTBEAT_INTERVAL` | `maxHeartbeatInterval`. Set to `0` to disable the kick entirely. |
| `CELLAGENTS_GAME_CONFIG` | absolute path to an alternate config file |

## Running

The game components require Node 22+.

From a clean checkout:

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

Or with Docker:

```bash
docker build -t cells-game .
docker run --rm -p 3000:3000 cells-game
```

## Lineage

This repo is **a fork of [`owenashurst/agar.io-clone`](https://github.com/owenashurst/agar.io-clone)**,
itself an open-source clone of the browser game
[**agar.io**](https://agar.io) by Miniclip / Matheus Valadares.
The original `agar.io` is closed source and unaffiliated with this
project.

We track the upstream lineage on branch `upstream-master`; our work lives on `main`.

## License

MIT, carried from the upstream fork. See `LICENSE`.
