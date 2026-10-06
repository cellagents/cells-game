import express from 'express';
import * as http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as SAT from 'sat';
import * as path from 'path';

import * as chatRepository from './repositories/chat-repository';
import config from '../config';
import * as util from './lib/util';
import { Map as GameMap, playerUtils } from './map/map';
import { Player } from './map/player';
import { getPosition } from './lib/entityUtils';
import { adminEnabled, createAdminRouter } from './admin';
import {
    PROTOCOL_VERSION,
    parseSubscribe,
    ClientEvent,
    ServerEvent,
    type Capability,
    type Welcome,
    type Reject,
    type Tick,
    type PlayerSnapshot,
    type SelfSnapshot
} from '@cellagents/game-protocol';
import { readFileSync } from 'fs';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

const map = new GameMap(config);

const sockets: Record<string, Socket> = {};

/** Per-socket subscriber record. Keyed by socket.id. This is the one
 *  truth about what the socket is allowed to send and receive. */
interface Subscriber {
    socketId: string;
    capabilities: Set<Capability>;
    /** Supplied in subscribe. Spectators have null; presence
     *  subscribers always have a non-null name (validator enforced). */
    name: string | null;
    /** Clamped at subscribe time or whenever windowResized arrives. */
    screen: { width: number; height: number } | null;
    /** Target subscriber id to follow; set only on viewport+follow. */
    follow: string | null;
    /** Non-null iff the subscriber currently has a live cell on the
     *  map. Cleared on death; re-populated on respawn. The record
     *  stays alive in `subscribers` either way. */
    player: Player | null;
    /** Last known world-space anchor used for culling. For a live
     *  presence subscriber the current player.x/y keeps this fresh;
     *  for a dead one it freezes at the death position. For
     *  follow subscribers it's updated per tick from the followed
     *  player. For full-map spectators it's unused (no culling). */
    lastSeen: { x: number; y: number };
}
const subscribers: Record<string, Subscriber> = {};

app.use(express.json());
const INIT_MASS_LOG = util.mathLog(config.game.defaultPlayerMass, config.game.slowBase);

type LeaderboardEntry = { id: string; name: string | null };
let leaderboard: LeaderboardEntry[] = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

// Package version for GET /protocol. Read lazily at startup; not
// recomputed per request. If the file is missing (unlikely in a built
// container) we fall back to a sentinel; tests can override via the
// CELLS_SERVER_VERSION env var.
const SERVER_VERSION = (() => {
    const env = process.env.CELLS_SERVER_VERSION;
    if (env) return env;
    try {
        const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        return 'unknown';
    }
})();

const clientRoot = path.join(__dirname, '..', 'client');
app.get('/', (_req, res) => res.sendFile(path.join(clientRoot, 'lobby.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(clientRoot, 'player.html')));
app.get('/spectator', (_req, res) => res.sendFile(path.join(clientRoot, 'spectator.html')));
app.get('/follow', (_req, res) => res.sendFile(path.join(clientRoot, 'follow.html')));
app.get('/managed', (_req, res) => res.sendFile(path.join(clientRoot, 'managed.html')));

// GET /protocol — HTTP probe used by cells-mcp (and anyone else) to
// decide which wire the server speaks before opening a socket. A
// pre-1.0 server does not expose this route and 404s, which is what
// legacy-mode detection relies on.
app.get('/protocol', (_req, res) => {
    res.json({
        protocol: PROTOCOL_VERSION,
        server: 'cells-game',
        version: SERVER_VERSION
    });
});

// Per-view UI config for the client's floating-button chrome. The
// client fetches this at page load; see thin/chrome.ts for the
// consumption side. Every field is sanitised so a malformed config
// surfaces as safe defaults rather than breaking the chrome row.
// Each view returns only the buttons that apply to it:
//   lobby:  theme
//   admin:  theme + lock
//   canvas: exit + theme + chat/leaderboard/minimap (as widgets)
const VIEW_WHITELIST = ['lobby', 'admin', 'player', 'spectator', 'follow', 'managed'] as const;
type UiViewName = typeof VIEW_WHITELIST[number];
const ACTION_DEFAULT = { button: true };
const WIDGET_DEFAULT = { button: true, defaultVisible: { desktop: true, mobile: false } };
app.get('/ui-config', (req, res) => {
    const view = typeof req.query.view === 'string' ? req.query.view : '';
    if (!(VIEW_WHITELIST as readonly string[]).includes(view)) {
        res.status(400).json({ error: 'unknown view' });
        return;
    }
    const section = (config.client as unknown as Record<UiViewName, { ui?: unknown }>)[view as UiViewName];
    const ui = (section && typeof section === 'object' ? (section as { ui?: unknown }).ui : null) as
        | Record<string, unknown>
        | null;
    const rawOf = (name: string) =>
        (ui && typeof ui === 'object' ? (ui as Record<string, unknown>)[name] : null) as
            | Record<string, unknown> | null;
    const action = (name: string) => {
        const raw = rawOf(name);
        if (!raw) return { ...ACTION_DEFAULT };
        return { button: typeof raw.button === 'boolean' ? raw.button : ACTION_DEFAULT.button };
    };
    const widget = (name: string) => {
        const raw = rawOf(name);
        if (!raw) return { ...WIDGET_DEFAULT };
        const dv = (raw.defaultVisible && typeof raw.defaultVisible === 'object'
            ? raw.defaultVisible as Record<string, unknown>
            : {}) as Record<string, unknown>;
        return {
            button: typeof raw.button === 'boolean' ? raw.button : WIDGET_DEFAULT.button,
            defaultVisible: {
                desktop: typeof dv.desktop === 'boolean' ? dv.desktop : WIDGET_DEFAULT.defaultVisible.desktop,
                mobile: typeof dv.mobile === 'boolean' ? dv.mobile : WIDGET_DEFAULT.defaultVisible.mobile
            }
        };
    };
    if (view === 'lobby') {
        res.json({ theme: action('theme') });
        return;
    }
    if (view === 'admin') {
        res.json({ theme: action('theme'), lock: action('lock') });
        return;
    }
    res.json({
        exit: action('exit'),
        theme: action('theme'),
        chat: widget('chat'),
        leaderboard: widget('leaderboard'),
        minimap: widget('minimap')
    });
});

// Public lobby content: lets the lobby page render operator-authored
// extras (links to the project site, docs, etc.) without rebuilding
// the client bundle. Only shape-checked fields are exposed; anything
// unexpected in config.json is dropped silently so a typo cannot
// inject arbitrary attributes into the DOM.
app.get('/lobby-config', (_req, res) => {
    const content = config.client.lobby?.content;
    const sanitize = (list: unknown): Array<{ label: string; href: string }> => {
        if (!Array.isArray(list)) return [];
        return list
            .filter((b): b is { label: string; href: string } =>
                !!b && typeof (b as { label?: unknown }).label === 'string'
                && typeof (b as { href?: unknown }).href === 'string')
            .map((b) => ({ label: b.label, href: b.href }));
    };
    res.json({
        extraLinks: sanitize(content?.extraLinks)
    });
});

if (adminEnabled()) {
    app.get('/admin', (_req, res) => res.sendFile(path.join(clientRoot, 'admin.html')));
    app.use('/admin', createAdminRouter({ io, map, sockets }));
    console.log('[ADMIN] HTTP admin API enabled at /admin');
} else {
    // Admin disabled: 404 anything under /admin and the raw admin.html path
    // so the static middleware below can't serve them. Nothing distinguishes
    // "admin was never present" from "admin is turned off" to the outside.
    app.use((req, res, next) => {
        if (req.path === '/admin' || req.path.startsWith('/admin/') || req.path === '/admin.html') {
            res.status(404).end();
            return;
        }
        next();
    });
    console.log('[ADMIN] disabled (ADMIN_PASS is unset or default)');
}

app.use(express.static(clientRoot));

// Connection handling. The 1.0 server does not read any query string;
// subscribers connect bare and then declare themselves via a
// 'subscribe' event. The old `?type=player|spectator` branches are
// gone. A client that fails to send `subscribe` within the handshake
// timeout is dropped silently.
io.on('connection', (socket: Socket) => {
    const handshakeTimeout = setTimeout(() => {
        if (!subscribers[socket.id]) {
            socket.emit('reject', {
                code: 'INVALID_PAYLOAD',
                message: 'no subscribe within handshake window'
            } satisfies Reject);
            socket.disconnect();
        }
    }, 5000);

    socket.once('subscribe', (raw: unknown) => {
        clearTimeout(handshakeTimeout);
        attachSubscriber(socket, raw);
    });
});

function generateSpawnpoint() {
    const radius = util.massToRadius(config.game.defaultPlayerMass);
    return getPosition(config.game.newPlayerInitialPosition === 'farthest', radius, map.players.data as unknown as import('./lib/util').PositionWithRadius[]);
}

/** Clamp a client-advertised screen rectangle to the server's
 *  configured maximum. Mutates nothing; returns a new object. */
function clampScreen(screen: { width: number; height: number }): { width: number; height: number } {
    return {
        width: Math.min(screen.width, config.server.maxViewport.width),
        height: Math.min(screen.height, config.server.maxViewport.height)
    };
}

/** Decide the capability-set-driven role of a subscriber. The three
 *  valid combinations are exhaustive thanks to the SubscribeSchema
 *  semantic validator. */
function roleOf(caps: Set<Capability>): 'spectator' | 'follow' | 'player' {
    if (caps.has('presence')) return 'player';
    if (caps.has('viewport')) return 'follow';
    return 'spectator';
}

function attachSubscriber(socket: Socket, raw: unknown): void {
    const parsed = parseSubscribe(raw);
    if (!parsed.ok) {
        socket.emit('reject', { code: parsed.code, message: parsed.message } satisfies Reject);
        socket.disconnect();
        return;
    }

    const sub = parsed.value;
    const caps = new Set<Capability>(sub.capabilities);
    const role = roleOf(caps);

    // Register BEFORE emitting welcome so the per-event capability
    // gates below find the record on their first lookup.
    sockets[socket.id] = socket;
    const record: Subscriber = {
        socketId: socket.id,
        capabilities: caps,
        name: sub.name ?? null,
        screen: sub.screen ? clampScreen(sub.screen) : null,
        follow: sub.follow ?? null,
        player: null,
        // Default anchor to the map centre; refined per role below
        // and kept fresh by sendUpdates.
        lastSeen: { x: config.game.width / 2, y: config.game.height / 2 }
    };
    subscribers[socket.id] = record;

    if (role === 'player') {
        const player = new playerUtils.Player(socket.id);
        if (map.players.findIndexByID(socket.id) > -1) {
            socket.emit('reject', {
                code: 'INVALID_PAYLOAD',
                message: 'duplicate player id'
            } satisfies Reject);
            cleanupSocket(socket, /* notifyOthers */ false);
            socket.disconnect();
            return;
        }
        player.init(generateSpawnpoint(), config.game.defaultPlayerMass);
        const sanitizedName = (sub.name as string).replace(/(<([^>]+)>)/ig, '');
        player.clientProvidedData({
            name: sanitizedName,
            screenWidth: record.screen!.width,
            screenHeight: record.screen!.height
        });
        map.players.pushNew(player);
        record.player = player;
        record.lastSeen = { x: player.x, y: player.y };
        io.emit(ServerEvent.playerJoin, { name: player.name });
        console.log('[INFO] Player ' + player.name + ' connected (presence subscriber).');
    } else {
        // Spectator or follow viewer; neither occupies the map.
        io.emit(ServerEvent.playerJoin, { name: '' });
    }

    socket.emit('welcome', welcomeFor(record));

    wireEvents(socket, record);
}

/** Compose the welcome payload for a subscriber. The validator
 *  guarantees that a presence subscriber had a name on subscribe, so
 *  record.name is non-null whenever record.player is. */
function welcomeFor(record: Subscriber): Welcome {
    return {
        protocol: PROTOCOL_VERSION,
        subscriberId: record.socketId,
        world: { width: config.game.width, height: config.game.height },
        self: record.player && record.name !== null
            ? { id: record.player.id, name: record.name, hue: record.player.hue }
            : null
    };
}

/** Capability-gated event wiring. Every handler checks the current
 *  subscriber record so revocation (if we ever add it) just works. */
function wireEvents(socket: Socket, record: Subscriber): void {
    socket.on('disconnect', () => {
        cleanupSocket(socket, /* notifyOthers */ true);
    });

    socket.on(ClientEvent.pingcheck, () => {
        socket.emit(ServerEvent.pongcheck);
    });

    // windowResized is a viewport concern; a follow viewer with no
    // screen advertised ignores it (its viewport comes from the
    // followed player's screen in the legacy fan-out path).
    socket.on(ClientEvent.windowResized, (data: { width?: number; height?: number }) => {
        if (!record.capabilities.has('viewport')) return;
        if (typeof data?.width !== 'number' || typeof data?.height !== 'number') return;
        const clamped = clampScreen({ width: data.width, height: data.height });
        record.screen = clamped;
        if (record.player) {
            record.player.screenWidth = clamped.width;
            record.player.screenHeight = clamped.height;
        }
    });

    socket.on(ClientEvent.respawn, () => {
        if (!record.capabilities.has('steer') || !record.player) return;
        map.players.removePlayerByID(record.player.id);
        record.player.init(generateSpawnpoint(), config.game.defaultPlayerMass);
        map.players.pushNew(record.player);
        socket.emit('welcome', welcomeFor(record));
        console.log('[INFO] User ' + record.name + ' has respawned');
    });

    socket.on(ClientEvent.playerChat, (data: { message?: unknown }) => {
        if (!record.capabilities.has('presence') || !record.player || record.name === null) return;
        if (typeof data?.message !== 'string') return;
        const stripped = data.message.replace(/(<([^>]+)>)/ig, '').substring(0, 35);
        if (!stripped) return;

        if (config.server.logChat) {
            const d = new Date();
            console.log('[CHAT] [' + d.getHours() + ':' + d.getMinutes() + '] ' + record.name + ': ' + stripped);
        }

        // Sender is server-authoritative. The client cannot forge it.
        socket.broadcast.emit(ServerEvent.serverSendPlayerChat, {
            sender: record.name,
            message: stripped
        });

        chatRepository.logChatMessage(record.name, stripped, record.player.ipAddress)
            .catch((err) => console.error('Error when attempting to log chat message', err));
    });

    socket.on(ClientEvent.heartbeat, (target: { x: number; y: number }) => {
        if (!record.capabilities.has('steer') || !record.player) return;
        record.player.lastHeartbeat = new Date().getTime();
        if (target.x !== record.player.x || target.y !== record.player.y) {
            record.player.target = target;
        }
    });

    socket.on(ClientEvent.fireFood, () => {
        if (!record.capabilities.has('steer') || !record.player) return;
        const minCellMass = config.game.defaultPlayerMass + config.game.fireFood;
        for (let i = 0; i < record.player.cells.length; i++) {
            if (record.player.cells[i].mass >= minCellMass) {
                record.player.changeCellMass(i, -config.game.fireFood);
                map.massFood.addNew(record.player, i, config.game.fireFood);
            }
        }
    });

    socket.on(ClientEvent.split, () => {
        if (!record.capabilities.has('steer') || !record.player) return;
        record.player.userSplit(config.game.limitSplit, config.game.defaultPlayerMass);
    });
}

function cleanupSocket(socket: Socket, notifyOthers: boolean): void {
    const record = subscribers[socket.id];
    if (!record) return;
    delete subscribers[socket.id];
    delete sockets[socket.id];
    if (record.player) {
        map.players.removePlayerByID(record.player.id);
        if (notifyOthers && record.name !== null) {
            socket.broadcast.emit(ServerEvent.playerDisconnect, { name: record.name });
            console.log('[INFO] User ' + record.name + ' has disconnected');
        }
    }
}

const tickPlayer = (currentPlayer: Player) => {
    if (config.server.maxHeartbeatInterval > 0 &&
        currentPlayer.lastHeartbeat < new Date().getTime() - config.server.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit(ServerEvent.kick, {
            reason: 'Last heartbeat received over ' + config.server.maxHeartbeatInterval + ' ago.'
        });
        sockets[currentPlayer.id].disconnect();
    }

    currentPlayer.move(config.game.slowBase, config.game.width, config.game.height, INIT_MASS_LOG);

    const isEntityInsideCircle = (point: { x: number; y: number }, circle: SAT.Circle): boolean => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell: { mass: number }, cellCircle: SAT.Circle, cellIndex: number, mass: { id: string; speed: number; num: number; mass: number; x: number; y: number }): boolean => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num) return false;
            if (cell.mass > mass.mass * 1.1) return true;
        }
        return false;
    };

    const canEatVirus = (cell: { mass: number }, cellCircle: SAT.Circle, virus: { mass: number; x: number; y: number }): boolean => {
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle);
    };

    const cellsToSplit: number[] = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];
        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes);
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (eatenFoodIndexes.length * config.game.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.game.limitSplit, config.game.defaultPlayerMass);
};

const tickGame = () => {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.game.width, config.game.height);

    map.players.handleCollisions((gotEaten, eater) => {
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);

        map.players.data[eater.playerIndex].changeCellMass(eater.cellIndex, cellGotEaten.mass);

        const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (playerDied) {
            const playerGotEaten = map.players.data[gotEaten.playerIndex];
            const killer = map.players.data[eater.playerIndex];
            io.emit(ServerEvent.playerDied, {
                playerEatenName: playerGotEaten.name,
                killerName: killer?.name ?? null
            });
            const victimRecord = subscribers[playerGotEaten.id];
            if (victimRecord) {
                // Freeze the culling anchor at the death spot so the
                // dead subscriber keeps receiving the local area
                // (self:null) until it emits respawn.
                victimRecord.lastSeen = { x: playerGotEaten.x, y: playerGotEaten.y };
                victimRecord.player = null;
            }
            sockets[playerGotEaten.id].emit(ServerEvent.died);
            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });
};

const calculateLeaderboard = () => {
    const topPlayers = map.players.getTopPlayers();

    if (leaderboard.length !== topPlayers.length) {
        leaderboard = topPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== topPlayers[i].id) {
                leaderboard = topPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
};

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.game.massLossRate, config.game.defaultPlayerMass, config.game.minMassLoss);
    }

    map.balanceMass(config.game.foodMass, config.game.mass, config.game.maxFood, config.game.maxVirus);
};

/** Compose and emit a tick for one subscriber. Centralises the three
 *  camera semantics (presence, follow, full-map) plus the dead-state
 *  behaviour (presence record whose player is null). */
function emitTickFor(socket: Socket, record: Subscriber): void {
    // self (per spec): own player for presence subscribers (null
    // between death and respawn); followed player for viewport+follow
    // viewers (null if the target is gone); null for full-map
    // spectators.
    let selfPlayer: Player | null = null;
    let anchor: { x: number; y: number } | null = null;
    let screen: { width: number; height: number } | null = null;

    if (record.player) {
        selfPlayer = record.player;
        anchor = { x: record.player.x, y: record.player.y };
        screen = record.screen;
        record.lastSeen = anchor;
    } else if (record.capabilities.has('presence')) {
        // Dead presence subscriber awaiting respawn.
        anchor = record.lastSeen;
        screen = record.screen;
    } else if (record.capabilities.has('viewport') && record.follow) {
        const target = map.players.data.find((p) => p.id === record.follow);
        if (target && target.screenWidth && target.screenHeight) {
            selfPlayer = target;
            anchor = { x: target.x, y: target.y };
            screen = { width: target.screenWidth, height: target.screenHeight };
            record.lastSeen = anchor;
        }
    }

    const anchorAndScreen = anchor && screen ? { anchor, screen } : null;
    const inView = anchorAndScreen
        ? (e: { x: number; y: number; radius: number }) => util.testRectangleRectangle(
            e.x, e.y, e.radius * 1.1, e.radius * 1.1,
            anchorAndScreen.anchor.x, anchorAndScreen.anchor.y,
            anchorAndScreen.screen.width / 2, anchorAndScreen.screen.height / 2
        )
        : () => true;

    const food = (anchorAndScreen ? map.food.data.filter(inView) : map.food.data)
        .map((f) => ({ x: f.x, y: f.y, hue: f.hue, radius: f.radius }));
    const viruses = (anchorAndScreen ? map.viruses.data.filter(inView) : map.viruses.data)
        .map((v) => ({ x: v.x, y: v.y, radius: v.radius }));
    const mass = (anchorAndScreen ? map.massFood.data.filter(inView) : map.massFood.data)
        .map((m) => ({
            x: m.x,
            y: m.y,
            hue: typeof m.hue === 'number' ? m.hue : 0,
            radius: typeof m.radius === 'number' ? m.radius : 10
        }));
    const players = (anchorAndScreen
        ? map.players.data.filter((p) => p.cells.some((c) => inView(c)))
        : map.players.data
    ).map(playerSnapshot);

    const tick: Tick = {
        self: selfPlayer ? selfSnapshot(selfPlayer) : null,
        players,
        food,
        mass,
        viruses
    };
    socket.emit(ServerEvent.tick, tick);
    if (leaderboardChanged) sendLeaderboard(socket);
}

function playerSnapshot(p: Player): PlayerSnapshot {
    return {
        id: p.id,
        name: p.name,
        hue: p.hue,
        massTotal: Math.round(p.massTotal),
        cells: p.cells.map((c) => ({
            x: c.x,
            y: c.y,
            mass: c.mass,
            radius: c.radius
        }))
    };
}

function selfSnapshot(p: Player): SelfSnapshot {
    return {
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        hue: p.hue,
        massTotal: Math.round(p.massTotal),
        cells: p.cells.map((c) => ({
            x: c.x,
            y: c.y,
            mass: c.mass,
            radius: c.radius
        }))
    };
}

const sendUpdates = () => {
    for (const record of Object.values(subscribers)) {
        const socket = sockets[record.socketId];
        if (!socket) continue;
        emitTickFor(socket, record);
    }
    leaderboardChanged = false;
};

const sendLeaderboard = (socket: Socket) => {
    socket.emit(ServerEvent.leaderboard, {
        players: map.players.data.length,
        leaderboard
    });
};

setInterval(tickGame, 1000 / config.server.loopRates.physicsHz);
setInterval(gameloop, 1000 / config.server.loopRates.metabolismHz);
setInterval(sendUpdates, 1000 / config.server.loopRates.fanOutHz);

server.listen(config.server.port, config.server.host, () => console.log('[DEBUG] Listening on ' + config.server.host + ':' + config.server.port));
