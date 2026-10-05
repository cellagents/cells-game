// Socket.IO connector for spectator/follow modes. Returns a small handle
// with the latest snapshot, world size, leaderboard and an on()
// subscription primitive.

import { io, Socket } from 'socket.io-client';
import type { Snapshot } from './renderer';
import type { WorldSize } from './camera';

export interface ConnectOptions {
    gameServerUrl: string;
    data?: 'full' | 'viewport';
    follow?: string | null;
}

type EventName = 'connect' | 'snapshot' | 'world' | 'leaderboard';
type Listener = (payload: unknown) => void;

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
        disconnect() { socket.disconnect(); }
    };

    const emit = (event: EventName, payload: unknown) => {
        const set = listeners.get(event);
        if (set) for (const cb of set) cb(payload);
    };

    socket.on('connect', () => emit('connect', null));

    socket.on('welcome', (_playerSettings: unknown, gameSizes: WorldSize) => {
        handle.world = gameSizes;
        emit('world', gameSizes);
        // Spectator handshake: upstream clients emit 'gotit' with no args.
        socket.emit('gotit');
    });

    socket.on('serverTellPlayerMove', (self: Snapshot['self'], players: Snapshot['players'], food: Snapshot['food'], mass: Snapshot['mass'], viruses: Snapshot['viruses']) => {
        handle.snapshot = { self, players, food, mass, viruses };
        emit('snapshot', handle.snapshot);
    });

    socket.on('leaderboard', (data: { leaderboard?: Array<{ id: string; name: string | null }> }) => {
        handle.leaderboard = data?.leaderboard || [];
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
