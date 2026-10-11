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
    KNOWN_ENTITY_KINDS,
    type Capability,
    type Welcome,
    type Reject,
    type Tick,
    type Entity,
    type PlayerMeta,
    type Rules,
    type Effect,
    type Message
} from '@cellagents/game-protocol';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

const map = new GameMap(config);

const sockets: Record<string, Socket> = {};

/** Grace window during which a freshly spawned (or respawned)
 *  presence subscriber is `invulnerable`: collisions skip eating
 *  it. 3s is long enough for a bot to orient and short enough
 *  that camping on a spawn is not a strategy. */
const SPAWN_GRACE_MS = 3000;

/** Per-socket subscriber record. Keyed by socket.id. This is the one
 *  truth about what the socket is allowed to send and receive. */
interface Subscriber {
    socketId: string;
    /** Caller-chosen stable identity across sessions. Minted when
     *  the client did not supply one. */
    clientId: string;
    /** User-agent-like identifier of the connecting software. */
    userAgent: string;
    /** Granted capability set (same as requested in 1.0). */
    capabilities: Set<Capability>;
    /** Granted action types; non-empty iff `act` is granted. */
    grantedActions: string[];
    /** Supplied in subscribe. Non-presence subscribers have null. */
    name: string | null;
    /** Clamped at subscribe time or whenever windowResized arrives. */
    screen: { width: number; height: number } | null;
    /** Follow-target player id. Only meaningful if `follow` is held. */
    follow: string | null;
    /** Non-null iff this subscriber currently has a live body. */
    player: Player | null;
    /** Last known world-space anchor used for culling (dead
     *  presence subscribers freeze on it). */
    lastSeen: { x: number; y: number };
    /** Server-ms timestamp of the last spawn/respawn; drives the
     *  invulnerable effect and the server-side grace check. */
    spawnedAt: number;
    /** Chat rate limiter: timestamps of recent `say` emits used by
     *  the sliding-window check. */
    sayHistory: number[];
    /** Remote address, for the admin audit. */
    remoteAddress: string;
    /** Connected-at wall clock, for the admin audit. */
    connectedAt: number;
}
const subscribers: Record<string, Subscriber> = {};

/** Monotonic sequence stamped on every tick. */
let tickSeq = 0;

/** Entity id counters, one per kind. Food is plentiful; small
 *  integers are fine. Cells use their index into a player's cells
 *  array + a prefix of the player id; this stays stable across
 *  ticks within a session. */
let nextVirusId = 1;
let nextFoodId = 1;
let nextEjectedId = 1;

/** Cell id derivation: because the Cell class doesn't carry an id,
 *  derive one from the player id + cell index. Keeps the id stable
 *  while a cell exists at a given slot; splits create fresh slots
 *  so the id changes, which is the honest answer for the current
 *  cell model. The post-archival `core` repo can promote cell ids
 *  to first-class state. */
function cellId(playerId: string, cellIndex: number): number {
    // Hash-free encoding: hash the socket id to a 24-bit prefix,
    // append cellIndex in the low 8 bits. Collisions across sockets
    // are harmless for rendering/grouping (we also group by owner).
    let h = 0;
    for (let i = 0; i < playerId.length; i++) {
        h = ((h << 5) - h + playerId.charCodeAt(i)) | 0;
    }
    return ((h & 0xffffff) << 8) | (cellIndex & 0xff);
}

app.use(express.json());
const INIT_MASS_LOG = util.mathLog(config.game.defaultPlayerMass, config.game.slowBase);

type LeaderboardEntry = { id: string; name: string | null };
let leaderboard: LeaderboardEntry[] = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

/** Package version. Read lazily at startup. Tests override via
 *  CELLS_SERVER_VERSION. */
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

/** Server identity string that goes into `welcome.server` and the
 *  `/protocol` probe. Mandatory, free-form, recommended format
 *  `name/semver[+build]`. */
const SERVER_IDENTITY = `cells-game/${SERVER_VERSION}`;

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
        server: SERVER_IDENTITY
    });
});

// Per-view UI config for the client's floating-button chrome. The
// client fetches this at page load; see thin/chrome.ts for the
// consumption side. Every field is sanitised so a malformed config
// surfaces as safe defaults rather than breaking the chrome row.
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
    const actionCfg = (name: string) => {
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
        res.json({ theme: actionCfg('theme') });
        return;
    }
    if (view === 'admin') {
        res.json({ theme: actionCfg('theme'), lock: actionCfg('lock') });
        return;
    }
    res.json({
        exit: actionCfg('exit'),
        theme: actionCfg('theme'),
        chat: widget('chat'),
        leaderboard: widget('leaderboard'),
        minimap: widget('minimap')
    });
});

// Public lobby content.
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
    app.use('/admin', createAdminRouter({ io, map, sockets, subscribers }));
    console.log('[ADMIN] HTTP admin API enabled at /admin');
} else {
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
// subscribers connect bare and declare themselves via `subscribe`.
io.on('connection', (socket: Socket) => {
    const handshakeTimeout = setTimeout(() => {
        if (!subscribers[socket.id]) {
            socket.emit(ServerEvent.reject, {
                code: 'INVALID_PAYLOAD',
                message: 'no subscribe within handshake window'
            } satisfies Reject);
            socket.disconnect();
        }
    }, 5000);

    socket.once(ClientEvent.subscribe, (raw: unknown) => {
        clearTimeout(handshakeTimeout);
        attachSubscriber(socket, raw);
    });
});

function generateSpawnpoint() {
    const radius = util.massToRadius(config.game.defaultPlayerMass);
    return getPosition(
        config.game.newPlayerInitialPosition === 'farthest',
        radius,
        map.players.data as unknown as import('./lib/util').PositionWithRadius[]
    );
}

/** Clamp a client-advertised screen rectangle to the server's
 *  configured maximum. */
function clampScreen(screen: { width: number; height: number }): { width: number; height: number } {
    return {
        width: Math.min(screen.width, config.server.maxViewport.width),
        height: Math.min(screen.height, config.server.maxViewport.height)
    };
}

/** Compose the current rules bag from live config. Shipped on
 *  welcome; a future server would emit `rulesChanged` to replace
 *  the bag mid-session. */
function currentRules(): Rules {
    return {
        eatRatio: 1.1,
        splitLimit: config.game.limitSplit,
        defaultPlayerMass: config.game.defaultPlayerMass,
        foodMass: config.game.foodMass,
        fireFoodMass: config.game.fireFood,
        maxHeartbeatInterval: config.server.maxHeartbeatInterval,
        chatMaxLength: 200,
        chatRateHz: 2
    };
}

function attachSubscriber(socket: Socket, raw: unknown): void {
    const parsed = parseSubscribe(raw);
    if (!parsed.ok) {
        socket.emit(ServerEvent.reject, { code: parsed.code, message: parsed.message } satisfies Reject);
        socket.disconnect();
        return;
    }

    const sub = parsed.value;
    const caps = new Set<Capability>(sub.capabilities);
    const now = Date.now();

    // Register BEFORE emitting welcome so the per-event capability
    // gates below find the record on their first lookup.
    sockets[socket.id] = socket;
    const grantedActions = caps.has('act') ? ['split', 'eject'] : [];
    const record: Subscriber = {
        socketId: socket.id,
        clientId: sub.clientId ?? randomUUID(),
        userAgent: sub.userAgent,
        capabilities: caps,
        grantedActions,
        name: sub.name ?? null,
        screen: sub.screen ? clampScreen(sub.screen) : null,
        follow: sub.follow ?? null,
        player: null,
        lastSeen: { x: config.game.width / 2, y: config.game.height / 2 },
        spawnedAt: 0,
        sayHistory: [],
        remoteAddress: socket.handshake.address,
        connectedAt: now
    };
    subscribers[socket.id] = record;

    if (caps.has('presence')) {
        const player = new playerUtils.Player(socket.id);
        if (map.players.findIndexByID(socket.id) > -1) {
            socket.emit(ServerEvent.reject, {
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
        record.spawnedAt = now;
        io.emit(ServerEvent.playerJoin, { name: player.name });
        console.log('[INFO] Player ' + player.name + ' connected (presence subscriber).');
    } else {
        io.emit(ServerEvent.playerJoin, { name: '' });
    }

    socket.emit(ServerEvent.welcome, welcomeFor(record));

    wireEvents(socket, record);
}

/** Compose the welcome payload for a subscriber. */
function welcomeFor(record: Subscriber): Welcome {
    return {
        protocol: PROTOCOL_VERSION,
        server: SERVER_IDENTITY,
        sessionId: record.socketId,
        clientId: record.clientId,
        world: { width: config.game.width, height: config.game.height },
        capabilities: Array.from(record.capabilities),
        actions: [...record.grantedActions],
        rules: currentRules(),
        self: record.player && record.name !== null
            ? { id: record.player.id, name: record.name, hue: record.player.hue }
            : null
    };
}

/** Capability-gated event wiring. Every handler re-reads the
 *  subscriber record so capability revocation (if we ever add it)
 *  takes effect without re-wiring. */
function wireEvents(socket: Socket, record: Subscriber): void {
    socket.on('disconnect', () => {
        cleanupSocket(socket, /* notifyOthers */ true);
    });

    socket.on(ClientEvent.pingcheck, () => {
        socket.emit(ServerEvent.pongcheck);
    });

    // windowResized hints the server's culling policy; only a
    // presence subscriber has one, since omniscient subscribers
    // see everything and follow viewers inherit the followed
    // player's screen.
    socket.on(ClientEvent.windowResized, (data: { width?: number; height?: number }) => {
        if (!record.capabilities.has('presence')) return;
        if (typeof data?.width !== 'number' || typeof data?.height !== 'number') return;
        const clamped = clampScreen({ width: data.width, height: data.height });
        record.screen = clamped;
        if (record.player) {
            record.player.screenWidth = clamped.width;
            record.player.screenHeight = clamped.height;
        }
    });

    socket.on(ClientEvent.respawn, () => {
        if (!record.capabilities.has('presence') || !record.player) return;
        map.players.removePlayerByID(record.player.id);
        record.player.init(generateSpawnpoint(), config.game.defaultPlayerMass);
        map.players.pushNew(record.player);
        record.spawnedAt = Date.now();
        socket.emit(ServerEvent.welcome, welcomeFor(record));
        console.log('[INFO] User ' + record.name + ' has respawned');
    });

    socket.on(ClientEvent.say, (data: unknown) => {
        if (!record.capabilities.has('chat') || !record.player || record.name === null) return;
        if (!data || typeof data !== 'object') return;
        const d = data as { scope?: unknown; to?: unknown; text?: unknown; data?: unknown };
        if (d.scope !== 'all' && d.scope !== 'team' && d.scope !== 'direct') return;
        if (typeof d.text !== 'string') return;

        // Rate limit (sliding window). chatRateHz events per second.
        const rules = currentRules();
        const rateHz = typeof rules.chatRateHz === 'number' ? rules.chatRateHz : 2;
        const maxLen = typeof rules.chatMaxLength === 'number' ? rules.chatMaxLength : 200;
        const now = Date.now();
        record.sayHistory = record.sayHistory.filter((t) => now - t < 1000);
        if (record.sayHistory.length >= rateHz) return;
        record.sayHistory.push(now);

        const stripped = d.text.replace(/(<([^>]+)>)/ig, '').substring(0, maxLen);
        if (!stripped) return;

        // Structured bot payload. Protocol allows a flat
        // Record<string, RulesPrimitive>; drop the whole message if
        // what we were handed doesn't match (not just the data: the
        // sender asked for a structured send and the structure is
        // malformed, so silently stripping the data would mislead).
        let forwardedData: Record<string, string | number | boolean> | undefined;
        if (d.data !== undefined) {
            if (!d.data || typeof d.data !== 'object' || Array.isArray(d.data)) return;
            const entries = Object.entries(d.data as Record<string, unknown>);
            const okValues = entries.every(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
            if (!okValues) return;
            forwardedData = Object.fromEntries(entries) as Record<string, string | number | boolean>;
        }

        if (config.server.logChat) {
            const t = new Date();
            console.log('[CHAT] [' + t.getHours() + ':' + t.getMinutes() + '] ' + record.name + ': ' + stripped);
        }

        // Routing. `team` is reserved; the 1.0 server drops it silently.
        const message: Message = {
            from: { id: record.player.id, name: record.name },
            scope: d.scope,
            text: stripped,
            time: now,
            ...(forwardedData ? { data: forwardedData } : {})
        };

        if (d.scope === 'all') {
            // Everyone (including the sender) sees it; the sender's
            // own render path treats their from.id === self.id as "me".
            io.emit(ServerEvent.message, message);
        } else if (d.scope === 'direct') {
            if (typeof d.to !== 'string' || !d.to) return;
            const targetSocketId = Object.values(subscribers).find((s) => s.player?.id === d.to)?.socketId;
            if (!targetSocketId) return;
            const targetSocket = sockets[targetSocketId];
            if (targetSocket) targetSocket.emit(ServerEvent.message, message);
            // Echo to sender too so their chat UI shows what they sent.
            socket.emit(ServerEvent.message, message);
        }
        // scope === 'team' falls through: dropped silently.

        if (config.server.logChat) {
            chatRepository.logChatMessage(record.name, stripped, record.player.ipAddress)
                .catch((err) => console.error('Error when attempting to log chat message', err));
        }
    });

    socket.on(ClientEvent.heartbeat, (target: { x: number; y: number }) => {
        if (!record.capabilities.has('steer') || !record.player) return;
        record.player.lastHeartbeat = new Date().getTime();
        if (target.x !== record.player.x || target.y !== record.player.y) {
            record.player.target = target;
        }
    });

    socket.on(ClientEvent.action, (data: unknown) => {
        if (!record.capabilities.has('act') || !record.player) return;
        if (!data || typeof data !== 'object') return;
        const d = data as { type?: unknown };
        if (typeof d.type !== 'string') return;
        if (!record.grantedActions.includes(d.type)) return;

        if (d.type === 'split') {
            record.player.userSplit(config.game.limitSplit, config.game.defaultPlayerMass);
        } else if (d.type === 'eject') {
            const minCellMass = config.game.defaultPlayerMass + config.game.fireFood;
            for (let i = 0; i < record.player.cells.length; i++) {
                if (record.player.cells[i].mass >= minCellMass) {
                    record.player.changeCellMass(i, -config.game.fireFood);
                    map.massFood.addNew(record.player, i, config.game.fireFood);
                }
            }
        }
    });

    socket.on(ClientEvent.setFollow, (data: unknown) => {
        if (!record.capabilities.has('follow')) return;
        if (!data || typeof data !== 'object') return;
        const d = data as { target?: unknown };
        if (d.target === null) {
            record.follow = null;
            return;
        }
        if (typeof d.target === 'string' && d.target.length > 0) {
            record.follow = d.target;
        }
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
        const victimPlayer = map.players.data[gotEaten.playerIndex];
        const victimRecord = victimPlayer ? subscribers[victimPlayer.id] : null;
        // Spawn-grace invulnerability: a subscriber whose
        // record.spawnedAt is within SPAWN_GRACE_MS cannot be eaten.
        if (victimRecord && Date.now() < victimRecord.spawnedAt + SPAWN_GRACE_MS) {
            return;
        }

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
            const victim = subscribers[playerGotEaten.id];
            if (victim) {
                victim.lastSeen = { x: playerGotEaten.x, y: playerGotEaten.y };
                victim.player = null;
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
        map.players.shrinkCells(config.game.massLossRate, config.game.massLossExponent, config.game.defaultPlayerMass, config.game.minMassLoss);
    }

    map.balanceMass(config.game.foodMass, config.game.mass, config.game.maxFood, config.game.maxVirus);
};

// -------- Tick builders ------------------------------------------------------

/** Convert a Player's cells into Entity records with kind='cell'. */
function cellsToEntities(p: Player, now: number): Entity[] {
    const noMergeUntil = p.timeToMerge && p.timeToMerge > now ? p.timeToMerge : null;
    const noMergeEffects: Effect[] | undefined = noMergeUntil !== null
        ? [{ type: 'noMerge', until: noMergeUntil }]
        : undefined;
    return p.cells.map((c, i) => ({
        kind: 'cell' as const,
        id: cellId(p.id, i),
        x: c.x,
        y: c.y,
        mass: c.mass,
        radius: c.radius,
        owner: p.id,
        ...(noMergeEffects ? { effects: noMergeEffects } : {})
    }));
}

function playerMetaOf(p: Player, now: number): PlayerMeta {
    const record = subscribers[p.id];
    const invulnerableUntil = record ? record.spawnedAt + SPAWN_GRACE_MS : 0;
    const effects: Effect[] = [];
    if (invulnerableUntil > now) {
        effects.push({ type: 'invulnerable', until: invulnerableUntil });
    }
    return {
        id: p.id,
        name: p.name,
        hue: p.hue,
        massTotal: Math.round(p.massTotal),
        x: p.x,
        y: p.y,
        ...(effects.length ? { effects } : {})
    };
}

/** Compose and emit a tick for one subscriber. Centralises the four
 *  camera semantics (presence, dead presence, follow, omniscient)
 *  and the entity-list build. */
function emitTickFor(socket: Socket, record: Subscriber, now: number): void {
    let selfPlayer: Player | null = null;
    let anchor: { x: number; y: number } | null = null;
    let screen: { width: number; height: number } | null = null;
    let allowFullMap = false;    // omniscient subscribers see unculled

    if (record.capabilities.has('presence')) {
        if (record.player) {
            selfPlayer = record.player;
            anchor = { x: record.player.x, y: record.player.y };
            screen = record.screen;
            record.lastSeen = anchor;
        } else {
            // Dead presence subscriber awaiting respawn.
            anchor = record.lastSeen;
            screen = record.screen;
        }
    } else if (record.capabilities.has('follow') && record.follow) {
        const target = map.players.data.find((p) => p.id === record.follow);
        if (target && target.screenWidth && target.screenHeight) {
            selfPlayer = target;
            anchor = { x: target.x, y: target.y };
            screen = { width: target.screenWidth, height: target.screenHeight };
            record.lastSeen = anchor;
        } else if (record.capabilities.has('omniscient')) {
            // Follow target gone + omniscient granted: full-map
            // fallback instead of an empty tick.
            allowFullMap = true;
        }
        // else: follow-only, target gone → empty tick (handled below).
    } else if (record.capabilities.has('omniscient')) {
        allowFullMap = true;
    }
    // No match: either a follow-only subscriber with no target or a
    // dead presence with no screen. Empty tick.

    const culled = anchor && screen ? { anchor, screen } : null;
    const inView = culled
        ? (e: { x: number; y: number; radius: number }) => util.testRectangleRectangle(
            e.x, e.y, e.radius * 1.1, e.radius * 1.1,
            culled.anchor.x, culled.anchor.y,
            culled.screen.width / 2, culled.screen.height / 2
        )
        : null;

    const unculled = allowFullMap && !culled;

    const foodEntities: Entity[] = ((unculled || inView === null) && !allowFullMap && !culled
        ? []
        : (unculled ? map.food.data : (culled && inView ? map.food.data.filter(inView) : []))
    ).map((f) => ({
        kind: 'food' as const,
        id: foodWireId(f),
        x: f.x,
        y: f.y,
        mass: config.game.foodMass,
        radius: f.radius,
        hue: f.hue
    }));

    const virusEntities: Entity[] = ((unculled || inView === null) && !allowFullMap && !culled
        ? []
        : (unculled ? map.viruses.data : (culled && inView ? map.viruses.data.filter(inView) : []))
    ).map((v) => ({
        kind: 'virus' as const,
        id: virusWireId(v),
        x: v.x,
        y: v.y,
        mass: v.mass,
        radius: v.radius
    }));

    const ejectedEntities: Entity[] = ((unculled || inView === null) && !allowFullMap && !culled
        ? []
        : (unculled ? map.massFood.data : (culled && inView ? map.massFood.data.filter(inView) : []))
    ).map((m) => ({
        kind: 'ejected' as const,
        id: ejectedWireId(m),
        x: m.x,
        y: m.y,
        mass: m.mass,
        radius: m.radius,
        hue: m.hue
    }));

    // Visible players (including self when it has cells).
    const visiblePlayers = (unculled
        ? map.players.data
        : (culled && inView
            ? map.players.data.filter((p) => p.cells.some((c) => inView(c)))
            : (selfPlayer ? [selfPlayer] : []))
    );
    const cellEntities = visiblePlayers.flatMap((p) => cellsToEntities(p, now));

    const players: PlayerMeta[] = visiblePlayers.map((p) => playerMetaOf(p, now));

    const tick: Tick = {
        seq: tickSeq,
        time: now,
        self: selfPlayer ? playerMetaOf(selfPlayer, now) : null,
        players,
        entities: [...cellEntities, ...foodEntities, ...ejectedEntities, ...virusEntities]
    };
    socket.emit(ServerEvent.tick, tick);
    if (leaderboardChanged) sendLeaderboard(socket);
}

// Stable wire ids per entity instance. These are allocated at
// construction and stored on each entity so a tick emits the same
// id each time until the entity is removed.
function foodWireId(f: unknown): number {
    const fe = f as { wireId?: number };
    if (typeof fe.wireId !== 'number') fe.wireId = nextFoodId++;
    return fe.wireId;
}
function virusWireId(v: unknown): number {
    const ve = v as { wireId?: number };
    if (typeof ve.wireId !== 'number') ve.wireId = nextVirusId++;
    return ve.wireId;
}
function ejectedWireId(m: unknown): number {
    const me = m as { wireId?: number };
    if (typeof me.wireId !== 'number') me.wireId = nextEjectedId++;
    return me.wireId;
}

const sendUpdates = () => {
    tickSeq++;
    const now = Date.now();
    for (const record of Object.values(subscribers)) {
        const socket = sockets[record.socketId];
        if (!socket) continue;
        emitTickFor(socket, record, now);
    }
    leaderboardChanged = false;
};

const sendLeaderboard = (socket: Socket) => {
    socket.emit(ServerEvent.leaderboard, {
        players: map.players.data.length,
        leaderboard
    });
};

// Exported for the admin surface + for KNOWN_ENTITY_KINDS smoke
// (keeps the import alive).
export { subscribers };
void KNOWN_ENTITY_KINDS;

setInterval(tickGame, 1000 / config.server.loopRates.physicsHz);
setInterval(gameloop, 1000 / config.server.loopRates.metabolismHz);
setInterval(sendUpdates, 1000 / config.server.loopRates.fanOutHz);

server.listen(config.server.port, config.server.host, () => console.log('[DEBUG] Listening on ' + config.server.host + ':' + config.server.port));
