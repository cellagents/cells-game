// Socket.IO connector for every viewport (player, spectator, follow).
// Returns a GameHandle that exposes the latest snapshot/world/leaderboard
// state and an on() subscription primitive. Also provides a sender()
// for the handful of client->server messages so pages don't talk to
// socket.io directly.
//
// Visibility handling: while document.hidden is true, incoming snapshot
// and leaderboard payloads are stored on the handle but NOT emitted to
// listeners. On the visible transition, the latest stored payload (if
// any) is emitted exactly once. This prevents the perceived "replay"
// after returning from a background tab, where buffered packets would
// otherwise be delivered to subscribers as a flurry of state updates.
// Socket.IO itself keeps running so chat and other control events are
// still processed in real time; only the per-tick world updates are
// coalesced.

import { io, Socket } from 'socket.io-client';
import type { Snapshot } from './renderer';
import type { WorldSize } from './camera';

export type ConnectRole = 'player' | 'spectator';

export interface ConnectOptions {
    gameServerUrl: string;
    /** 'player' uses the player handshake (sends gotit with name/screen
     *  dims, respawn, kick, RIP). 'spectator' uses the viewer handshake
     *  (gotit with no args, no kick/RIP). Default: 'spectator'. */
    role?: ConnectRole;
    /** Spectator-only: ask for the whole map ('full') or a viewport
     *  slice around the followed target ('viewport'). */
    data?: 'full' | 'viewport';
    /** Spectator-only: id of the player to follow when data='viewport'. */
    follow?: string | null;
    /** Player-only: nickname sanitized by the caller. Sent to the server
     *  in the gotit handshake. */
    playerName?: string;
}

type EventName =
    | 'connect'
    | 'disconnect'
    /** First snapshot of self: fires once on welcome. Payload is the
     *  server's canonical player representation (id, x, y, hue, etc.). */
    | 'welcome'
    | 'snapshot'
    | 'world'
    | 'leaderboard'
    /** Player-only: server told us we died (RIP). */
    | 'died'
    /** Player-only: server kicked us; payload is the reason string. */
    | 'kick'
    /** Player-only: round-trip reply to a ping. Payload is latency ms. */
    | 'pong';

type Listener = (payload: unknown) => void;

/** socket.io-client's disconnect reason strings worth distinguishing.
 *  'io server disconnect' means the server deliberately closed us
 *  (kick, shutdown, etc.) and will not reconnect on its own. Anything
 *  else is transport-level and socket.io's built-in backoff retries. */
export type DisconnectPayload = { reason: string; deliberate: boolean };

export interface GameHandle {
    socket: Socket;
    snapshot: Snapshot | null;
    leaderboard: Array<{ id: string; name: string | null }>;
    world: WorldSize;
    /** Server-provided self id. Set by the welcome handler for both
     *  player and spectator roles; players use it to key against the
     *  snapshot's players array, which does not re-ship self info. */
    selfId: string | null;
    on(event: EventName, cb: Listener): () => void;
    disconnect(): void;
    /** Client -> server. Target steering (heartbeat on every tick). */
    sendTarget(target: { x: number; y: number }): void;
    /** Client -> server. Eject mass. */
    sendFireFood(): void;
    /** Client -> server. Split. */
    sendSplit(): void;
    /** Client -> server. Resize notification (player only). */
    sendWindowResized(width: number, height: number): void;
    /** Client -> server. Respawn request (player only). */
    sendRespawn(): void;
    /** Client -> server. Latency probe; server replies with 'pong'. */
    sendPing(): void;
    /** Client -> server. Chat message. */
    sendChat(sender: string, message: string): void;
}

export function connect(opts: ConnectOptions): GameHandle {
    const role: ConnectRole = opts.role ?? 'spectator';
    const query: Record<string, string> = { type: role };
    if (role === 'spectator') {
        query.data = opts.data ?? 'full';
        if (opts.follow) query.follow = opts.follow;
    }

    const socket: Socket = io(opts.gameServerUrl, { query, reconnection: true });
    const listeners = new Map<EventName, Set<Listener>>();
    let pingStartedAt = 0;

    const handle: GameHandle = {
        socket,
        snapshot: null,
        leaderboard: [],
        world: { width: 5000, height: 5000 },
        selfId: null,
        on(event, cb) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(cb);
            return () => listeners.get(event)!.delete(cb);
        },
        disconnect() {
            document.removeEventListener('visibilitychange', onVisibility);
            socket.disconnect();
        },
        sendTarget(target) { socket.emit('0', target); },
        sendFireFood() { socket.emit('1'); },
        sendSplit() { socket.emit('2'); },
        sendWindowResized(screenWidth, screenHeight) {
            if (role !== 'player') return;
            socket.emit('windowResized', { screenWidth, screenHeight });
        },
        sendRespawn() {
            if (role !== 'player') return;
            socket.emit('respawn');
        },
        sendPing() {
            pingStartedAt = Date.now();
            socket.emit('pingcheck');
        },
        sendChat(sender, message) {
            socket.emit('playerChat', { sender, message });
        }
    };

    const emit = (event: EventName, payload: unknown) => {
        const set = listeners.get(event);
        if (set) for (const cb of set) cb(payload);
    };

    // While hidden, the two high-rate events (snapshot and leaderboard)
    // only update the handle; they do not reach listeners. On the
    // visible transition we flush the latest value exactly once.
    let hasPendingSnapshot = false;
    let hasPendingLeaderboard = false;
    const onVisibility = () => {
        if (document.hidden) return;
        if (hasPendingSnapshot && handle.snapshot) {
            emit('snapshot', handle.snapshot);
            hasPendingSnapshot = false;
        }
        if (hasPendingLeaderboard) {
            emit('leaderboard', handle.leaderboard);
            hasPendingLeaderboard = false;
        }
    };
    document.addEventListener('visibilitychange', onVisibility);

    socket.on('connect', () => emit('connect', null));
    socket.on('disconnect', (reason: string) => {
        emit('disconnect', { reason, deliberate: reason === 'io server disconnect' });
    });

    socket.on('welcome', (playerSettings: { id?: string } | null, gameSizes: WorldSize) => {
        handle.world = gameSizes;
        emit('world', gameSizes);
        if (role === 'player') {
            // Store id and run the player handshake. The caller supplies
            // the sanitized name; screen dimensions come from the window
            // and may change later via sendWindowResized.
            handle.selfId = playerSettings?.id ?? null;
            emit('welcome', playerSettings);
            socket.emit('gotit', {
                ...(playerSettings || {}),
                name: opts.playerName ?? '',
                screenWidth: window.innerWidth,
                screenHeight: window.innerHeight
            });
        } else {
            // Spectator: upstream clients emit 'gotit' with no args.
            emit('welcome', playerSettings);
            socket.emit('gotit');
        }
    });

    socket.on('serverTellPlayerMove', (
        self: Snapshot['self'],
        players: Snapshot['players'],
        food: Snapshot['food'],
        mass: Snapshot['mass'],
        viruses: Snapshot['viruses']
    ) => {
        handle.snapshot = { self, players, food, mass, viruses };
        if (document.hidden) {
            hasPendingSnapshot = true;
            return;
        }
        emit('snapshot', handle.snapshot);
    });

    socket.on('leaderboard', (data: { leaderboard?: Array<{ id: string; name: string | null }> }) => {
        handle.leaderboard = data?.leaderboard || [];
        if (document.hidden) {
            hasPendingLeaderboard = true;
            return;
        }
        emit('leaderboard', handle.leaderboard);
    });

    // Player-only server-to-client events. Harmless on spectator since
    // the server never emits them to viewer sockets.
    socket.on('RIP', () => emit('died', null));
    socket.on('kick', (reason: string) => emit('kick', reason || ''));
    socket.on('pongcheck', () => emit('pong', Date.now() - pingStartedAt));

    return handle;
}

// If served from the game server itself, default to the serving origin;
// allow a ?gameServer=http://host:port override for local dev.
export function resolveGameServer(): string {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('gameServer');
    if (override) return override;
    return '';
}
