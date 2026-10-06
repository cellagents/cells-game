// Socket.IO connector for every viewport (player, spectator, follow,
// managed). Speaks protocol 1.0: a single `subscribe` handshake with
// capability flags, followed by `welcome` + `tick` streaming.
//
// Returns a GameHandle that exposes the latest snapshot/world/leader-
// board state and an on() subscription primitive, plus a small sender
// API (sendTarget / sendFireFood / sendSplit / ...) that pages use
// instead of touching socket.io directly.
//
// Late-subscriber replay: handshake events (connect / disconnect /
// welcome / world) are cached so a caller that attaches .on() after
// the event has already fired still gets called (asynchronously via
// queueMicrotask).
//
// Visibility handling: while document.hidden is true, incoming tick
// and leaderboard payloads update the handle but are NOT emitted to
// listeners. On the visible transition the latest stored payload is
// emitted exactly once so returning to a backgrounded tab does not
// unleash a flurry of buffered state.

import { io, Socket } from 'socket.io-client';
import {
    PROTOCOL_VERSION,
    ClientEvent,
    ServerEvent,
    type Capability,
    type Welcome,
    type Reject,
    type Tick,
    type Leaderboard
} from '@cellagents/game-protocol';
import type { WorldSize } from './camera';

export type { Capability } from '@cellagents/game-protocol';

export interface ConnectOptions {
    gameServerUrl: string;
    /** The subscribe handshake payload the client sends to the server.
     *  The caller is responsible for assembling a legal combination;
     *  see the protocol module's `validCapabilitySet`. */
    capabilities: Capability[];
    /** Required when capabilities includes 'presence'. */
    name?: string;
    /** Required when the capability set is player/bot (presence +
     *  viewport). Not required for follow viewers (they inherit the
     *  followed player's viewport). */
    screen?: { width: number; height: number };
    /** Required when the capability set is a follow viewer
     *  (viewport without presence). */
    follow?: string;
}

type EventName =
    | 'connect'
    | 'disconnect'
    | 'welcome'
    | 'reject'
    | 'snapshot'
    | 'world'
    | 'leaderboard'
    | 'died'
    | 'kick'
    | 'pong';

type Listener = (payload: unknown) => void;

/** socket.io-client's disconnect reason strings worth distinguishing.
 *  'io server disconnect' means the server deliberately closed us
 *  (kick, shutdown, etc.) and will not reconnect on its own. Anything
 *  else is transport-level and socket.io's built-in backoff retries. */
export type DisconnectPayload = { reason: string; deliberate: boolean };

export interface GameHandle {
    socket: Socket;
    snapshot: Tick | null;
    leaderboard: Array<{ id: string; name: string | null }>;
    world: WorldSize;
    /** Server-provided id for this subscriber. Set by the welcome
     *  handler. Clients use it to key against the snapshot. */
    selfId: string | null;
    on(event: EventName, cb: Listener): () => void;
    disconnect(): void;
    /** Client -> server. Target steering (heartbeat). */
    sendTarget(target: { x: number; y: number }): void;
    sendFireFood(): void;
    sendSplit(): void;
    /** Client -> server. Viewport resize notification. Allowed for
     *  any viewport-capable subscriber (player or follow viewer). */
    sendWindowResized(width: number, height: number): void;
    sendRespawn(): void;
    sendPing(): void;
    /** Client -> server. Chat message. The server stamps the sender
     *  from its known identity; the client cannot forge it. */
    sendChat(message: string): void;
}

export function connect(opts: ConnectOptions): GameHandle {
    const socket: Socket = io(opts.gameServerUrl, { reconnection: true });
    const listeners = new Map<EventName, Set<Listener>>();
    let pingStartedAt = 0;

    const lastEvent = new Map<EventName, unknown>();
    const REPLAYABLE: readonly EventName[] = ['connect', 'disconnect', 'welcome', 'world'];
    const isReplayable = (e: EventName): boolean => REPLAYABLE.indexOf(e) !== -1;

    const handle: GameHandle = {
        socket,
        snapshot: null,
        leaderboard: [],
        world: { width: 5000, height: 5000 },
        selfId: null,
        on(event, cb) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(cb);
            if (isReplayable(event) && lastEvent.has(event)) {
                const payload = lastEvent.get(event);
                queueMicrotask(() => cb(payload));
            }
            return () => listeners.get(event)!.delete(cb);
        },
        disconnect() {
            document.removeEventListener('visibilitychange', onVisibility);
            socket.disconnect();
        },
        sendTarget(target) { socket.emit(ClientEvent.heartbeat, target); },
        sendFireFood() { socket.emit(ClientEvent.fireFood); },
        sendSplit() { socket.emit(ClientEvent.split); },
        sendWindowResized(width, height) {
            socket.emit(ClientEvent.windowResized, { width, height });
        },
        sendRespawn() { socket.emit(ClientEvent.respawn); },
        sendPing() {
            pingStartedAt = Date.now();
            socket.emit(ClientEvent.pingcheck);
        },
        sendChat(message) { socket.emit(ClientEvent.playerChat, { message }); }
    };

    const emit = (event: EventName, payload: unknown) => {
        if (isReplayable(event)) lastEvent.set(event, payload);
        const set = listeners.get(event);
        if (set) for (const cb of set) cb(payload);
    };

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

    socket.on('connect', () => {
        lastEvent.delete('disconnect');
        emit('connect', null);
        // Fire the handshake. The server rejects anything malformed
        // via a 'reject' event + disconnect, which bubbles up through
        // the normal disconnect path.
        socket.emit(ClientEvent.subscribe, {
            protocol: PROTOCOL_VERSION,
            capabilities: opts.capabilities,
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.screen ? { screen: opts.screen } : {}),
            ...(opts.follow ? { follow: opts.follow } : {})
        });
    });
    socket.on('disconnect', (reason: string) => {
        lastEvent.delete('connect');
        emit('disconnect', { reason, deliberate: reason === 'io server disconnect' });
    });

    socket.on(ServerEvent.welcome, (payload: Welcome) => {
        handle.world = payload.world;
        handle.selfId = payload.subscriberId;
        emit('world', payload.world);
        emit('welcome', payload);
    });

    socket.on(ServerEvent.reject, (payload: Reject) => {
        emit('reject', payload);
        // The server also disconnects us; the normal disconnect
        // handler picks it up.
    });

    socket.on(ServerEvent.tick, (payload: Tick) => {
        handle.snapshot = payload;
        if (document.hidden) {
            hasPendingSnapshot = true;
            return;
        }
        emit('snapshot', handle.snapshot);
    });

    socket.on(ServerEvent.leaderboard, (payload: Leaderboard) => {
        handle.leaderboard = payload?.leaderboard || [];
        if (document.hidden) {
            hasPendingLeaderboard = true;
            return;
        }
        emit('leaderboard', handle.leaderboard);
    });

    socket.on(ServerEvent.died, () => emit('died', null));
    socket.on(ServerEvent.kick, (payload: { reason: string }) => emit('kick', payload?.reason ?? ''));
    socket.on(ServerEvent.pongcheck, () => emit('pong', Date.now() - pingStartedAt));

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
