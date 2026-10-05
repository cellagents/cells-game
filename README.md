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

Open <http://localhost:3000>. Default port can be overridden via
`config.js`.

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

- `src/server/` - Socket.IO server, authoritative world state, physics
  loop (60 Hz), metabolism/leaderboard loop (1 Hz), state fan-out (40 Hz).
- `src/client/` - the default web client (canvas renderer, input,
  chat). Served from the same Node process at `/`.
- `scripts/build.mjs`, `webpack.config.js` - client bundle build.
- `Dockerfile` - Node 22 Alpine, single stage.
- `config.js` - port, world size, chat settings, etc.

## License

MIT, carried from the upstream fork. See `LICENSE`.
