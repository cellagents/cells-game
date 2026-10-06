// Socket.IO connector for spectator/follow modes. Returns a small handle
// with the latest snapshot, world size, leaderboard and an on()
// subscription primitive.
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

export interface ConnectOptions {
    gameServerUrl: string;
    data?: 'full' | 'viewport';
    follow?: string | null;
}

type EventName = 'connect' | 'disconnect' | 'snapshot' | 'world' | 'leaderboard';
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
    on(event: EventName, cb: Listener): () => void;
    disconnect(): void;
}

export function connect({ gameServerUrl, data = 'full', follow = null }: ConnectOptions): GameHandle {
    const query: Record<string, string> = { type: 'spectator', data };
    if (follow) query.follow = follow;

    const socket: Socket = io(gameServerUrl, { query, reconnection: true });
    const listeners = new Map<EventName, Set<Listener>>();

    const handle: GameHandle = {
        socket,
        snapshot: null,
        leaderboard: [],
        world: { width: 5000, height: 5000 },
        on(event, cb) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(cb);
            return () => listeners.get(event)!.delete(cb);
        },
        disconnect() {
            document.removeEventListener('visibilitychange', onVisibility);
            socket.disconnect();
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
        // 'io server disconnect' means the server closed us on purpose
        // (kick, shutdown). Everything else is transport-level and the
        // socket.io client will auto-reconnect.
        emit('disconnect', { reason, deliberate: reason === 'io server disconnect' });
    });

    socket.on('welcome', (_playerSettings: unknown, gameSizes: WorldSize) => {
        handle.world = gameSizes;
        emit('world', gameSizes);
        // Spectator handshake: upstream clients emit 'gotit' with no args.
        socket.emit('gotit');
    });

    socket.on('serverTellPlayerMove', (self: Snapshot['self'], players: Snapshot['players'], food: Snapshot['food'], mass: Snapshot['mass'], viruses: Snapshot['viruses']) => {
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
