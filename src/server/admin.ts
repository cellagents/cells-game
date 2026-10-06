// HTTP admin API. Guarded by a bearer token read from
// config.client.admin.pass (which honors the ADMIN_PASS env var).
// Mounted at /admin by server.ts only when adminEnabled() returns
// true; otherwise the entire /admin surface (HTML page + API) is
// absent and visitors get a plain 404.

import { Router, Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { Map as GameMap } from './map/map';
import config from '../config';
import { ServerEvent, type Capability } from '@cellagents/game-protocol';

export interface SubscriberAudit {
    socketId: string;
    clientId: string;
    userAgent: string;
    capabilities: Set<Capability>;
    name: string | null;
    follow: string | null;
    connectedAt: number;
    remoteAddress: string;
    player: { id: string } | null;
}

export interface AdminDeps {
    io: SocketIOServer;
    map: GameMap;
    sockets: Record<string, Socket>;
    subscribers: Record<string, SubscriberAudit>;
}

export function adminEnabled(): boolean {
    const pw = config.client.admin.pass;
    return typeof pw === 'string' && pw.length > 0 && pw !== 'DEFAULT';
}

function bearerAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match || match[1] !== config.client.admin.pass) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    next();
}

export function createAdminRouter(deps: AdminDeps): Router {
    const router = Router();
    router.use(bearerAuth);

    router.get('/state', (_req, res) => {
        // Admin audit list: every subscriber, not only players.
        // userAgent is free-form text and MUST be escaped by the
        // admin page before rendering.
        const subscriberRows = Object.values(deps.subscribers).map((s) => ({
            socketId: s.socketId,
            clientId: s.clientId,
            userAgent: s.userAgent,
            capabilities: Array.from(s.capabilities),
            name: s.name,
            follow: s.follow,
            connectedAt: s.connectedAt,
            remoteAddress: s.remoteAddress,
            kind: s.player ? 'presence' : (s.capabilities.has('omniscient')
                ? (s.capabilities.has('follow') ? 'spectator-toggle' : 'omniscient')
                : s.capabilities.has('follow') ? 'follow' : 'other')
        }));
        res.json({
            // Legacy: list of players for the current admin page.
            players: deps.map.players.data.map((p) => ({
                id: p.id,
                name: p.name,
                massTotal: Math.round(p.massTotal),
                cells: p.cells.length
            })),
            // New in 1.0: full subscriber audit.
            subscribers: subscriberRows,
            counts: {
                players: deps.map.players.data.length,
                subscribers: subscriberRows.length,
                food: deps.map.food.data.length,
                viruses: deps.map.viruses.data.length,
                massFood: deps.map.massFood.data.length
            },
            config: {
                gameWidth: config.game.width,
                gameHeight: config.game.height,
                maxFood: config.game.maxFood,
                maxVirus: config.game.maxVirus,
                maxHeartbeatInterval: config.server.maxHeartbeatInterval
            }
        });
    });

    // Kick by name (presence subscribers only) OR by socket id (any
    // subscriber, including spectators and follow viewers).
    router.post('/kick', (req, res) => {
        const name = typeof req.body?.name === 'string' ? req.body.name : null;
        const socketId = typeof req.body?.socketId === 'string' ? req.body.socketId : null;
        if (!name && !socketId) {
            res.status(400).json({ error: 'name or socketId required' });
            return;
        }
        if (socketId) {
            const socket = deps.sockets[socketId];
            if (!socket) {
                res.status(404).json({ error: 'subscriber not found' });
                return;
            }
            socket.emit(ServerEvent.kick, { reason: 'Kicked by admin.' });
            socket.disconnect();
            console.log('[ADMIN] HTTP kick (socket): ' + socketId);
            res.json({ ok: true });
            return;
        }
        const index = deps.map.players.data.findIndex((p) => p.name === name);
        if (index < 0) {
            res.status(404).json({ error: 'player not found' });
            return;
        }
        const player = deps.map.players.data[index];
        const socket = deps.sockets[player.id];
        if (socket) {
            socket.emit(ServerEvent.kick, { reason: 'Kicked by admin.' });
            socket.disconnect();
        }
        deps.map.players.removePlayerByIndex(index);
        console.log('[ADMIN] HTTP kick (name): ' + name);
        res.json({ ok: true });
    });

    router.post('/broadcast', (req, res) => {
        const message = typeof req.body?.message === 'string' ? req.body.message : null;
        if (!message) {
            res.status(400).json({ error: 'message required' });
            return;
        }
        // Admin broadcasts land as a protocol-1.0 Message with
        // from: null (null signals server/admin origin). The web
        // client renders those in bold / with an admin style.
        deps.io.emit(ServerEvent.message, {
            from: null,
            scope: 'all',
            text: message,
            time: Date.now()
        });
        console.log('[ADMIN] HTTP broadcast: ' + message);
        res.json({ ok: true });
    });

    return router;
}
