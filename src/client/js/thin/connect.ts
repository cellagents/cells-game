// Socket.IO connector for every viewport (player, spectator, follow,
// managed). Speaks protocol 1.0: a single `subscribe` handshake with
// capability flags, followed by `welcome` + `tick` streaming.
//
// Returns a GameHandle that exposes the latest tick/world/leaderboard
// state and an on() subscription primitive, plus a small sender API
// (sendTarget / sendSplit / sendEject / sendSay / ...) that pages use
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
    type Leaderboard,
    type Message,
    type Rules
} from '@cellagents/game-protocol';
import type { WorldSize } from './camera';

export type { Capability } from '@cellagents/game-protocol';

/** Durable client-identity key kept in localStorage so the server can
 *  recognise this browser install across sessions. */
const CLIENT_ID_KEY = 'cellagents.cells.clientId';

function readOrMintClientId(): string {
    try {
        const existing = window.localStorage.getItem(CLIENT_ID_KEY);
        if (existing) return existing;
        const minted = crypto.randomUUID();
        window.localStorage.setItem(CLIENT_ID_KEY, minted);
        return minted;
    } catch {
        return crypto.randomUUID();
    }
}

export interface ConnectOptions {
    gameServerUrl: string;
    /** User-agent-like identifier of this build. Mandatory per
     *  protocol 1.0. Example: `web/4.0.0`. */
    userAgent: string;
    /** The subscribe handshake payload the client sends to the server. */
    capabilities: Capability[];
    /** Required when capabilities includes 'presence'. */
    name?: string;
    /** Required when the capability set is player/bot (presence + ...). */
    screen?: { width: number; height: number };
    /** Required for follow-only subscribers; may be set on
     *  omniscient+follow spectators too. */
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
    | 'pong'
    | 'message'
    | 'actionsChanged'
    | 'rulesChanged';

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
    /** Server-provided id for this subscriber's player row. On a
     *  presence subscriber this is also the socket id. Null until
     *  welcome arrives. */
    selfId: string | null;
    /** Granted capabilities as reported by welcome; identical to
     *  the requested set in the 1.0 server. */
    capabilities: Set<Capability>;
    /** Allowed action types. Updated by `actionsChanged`. */
    actions: Set<string>;
    /** Active rules bag. Updated by `rulesChanged`. */
    rules: Rules;
    on(event: EventName, cb: Listener): () => void;
    disconnect(): void;
    sendTarget(target: { x: number; y: number }): void;
    sendSplit(): void;
    sendEject(): void;
    sendWindowResized(width: number, height: number): void;
    sendRespawn(): void;
    sendPing(): void;
    /** Chat message. Server stamps the sender. */
    sendSay(text: string): void;
    /** Change the follow target (null clears). Gated by `follow`
     *  server-side; a non-follow subscriber's call is dropped. */
    sendSetFollow(target: string | null): void;
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
        capabilities: new Set<Capability>(opts.capabilities),
        actions: new Set<string>(),
        rules: {},
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
        sendSplit() {
            if (!handle.actions.has('split')) return;
            socket.emit(ClientEvent.action, { type: 'split' });
        },
        sendEject() {
            if (!handle.actions.has('eject')) return;
            socket.emit(ClientEvent.action, { type: 'eject' });
        },
        sendWindowResized(width, height) {
            socket.emit(ClientEvent.windowResized, { width, height });
        },
        sendRespawn() { socket.emit(ClientEvent.respawn); },
        sendPing() {
            pingStartedAt = Date.now();
            socket.emit(ClientEvent.pingcheck);
        },
        sendSay(text) { socket.emit(ClientEvent.say, { scope: 'all', text }); },
        sendSetFollow(target) { socket.emit(ClientEvent.setFollow, { target }); }
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

    const clientId = readOrMintClientId();

    socket.on('connect', () => {
        lastEvent.delete('disconnect');
        emit('connect', null);
        socket.emit(ClientEvent.subscribe, {
            protocol: PROTOCOL_VERSION,
            userAgent: opts.userAgent,
            capabilities: opts.capabilities,
            clientId,
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
        handle.selfId = payload.self?.id ?? payload.sessionId;
        handle.capabilities = new Set<Capability>(payload.capabilities);
        handle.actions = new Set<string>(payload.actions);
        handle.rules = payload.rules;
        emit('world', payload.world);
        emit('welcome', payload);
    });

    socket.on(ServerEvent.reject, (payload: Reject) => {
        emit('reject', payload);
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
    socket.on(ServerEvent.message, (payload: Message) => emit('message', payload));
    socket.on(ServerEvent.actionsChanged, (payload: { actions: string[] }) => {
        handle.actions = new Set(payload?.actions ?? []);
        emit('actionsChanged', payload);
    });
    socket.on(ServerEvent.rulesChanged, (payload: { rules: Rules }) => {
        handle.rules = payload?.rules ?? {};
        emit('rulesChanged', payload);
    });

    return handle;
}

/** If served from the game server itself, default to the serving
 *  origin; allow a ?gameServer=http://host:port override for local
 *  dev. */
export function resolveGameServer(): string {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('gameServer');
    if (override) return override;
    return '';
}
