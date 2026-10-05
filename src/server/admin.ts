// HTTP admin API. Guarded by a bearer token read from config.adminPass
// (which honors the ADMIN_PASS env var). Mounted at /admin by server.ts
// only when adminEnabled() returns true; otherwise the entire /admin
// surface (HTML page + API) is absent and visitors get a plain 404.

import { Router, Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { Map as GameMap } from './map/map';
import config from '../config';

export interface AdminDeps {
    io: SocketIOServer;
    map: GameMap;
    sockets: Record<string, Socket>;
}

// Admin is only enabled when the operator has set an explicit, non-default
// bearer token. The literal "DEFAULT" placeholder from config.example.json
// is treated as unset so a fresh deployment that forgot to set ADMIN_PASS
// doesn't accidentally expose admin with the shipped value.
export function adminEnabled(): boolean {
    const pw = config.adminPass;
    return typeof pw === 'string' && pw.length > 0 && pw !== 'DEFAULT';
}

function bearerAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match || match[1] !== config.adminPass) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    next();
}

export function createAdminRouter(deps: AdminDeps): Router {
    const router = Router();
    router.use(bearerAuth);

    router.get('/state', (_req, res) => {
        res.json({
            players: deps.map.players.data.map((p) => ({
                id: p.id,
                name: p.name,
                massTotal: Math.round(p.massTotal),
                cells: p.cells.length
            })),
            counts: {
                players: deps.map.players.data.length,
                food: deps.map.food.data.length,
                viruses: deps.map.viruses.data.length,
                massFood: deps.map.massFood.data.length
            },
            config: {
                gameWidth: config.gameWidth,
                gameHeight: config.gameHeight,
                maxFood: config.maxFood,
                maxVirus: config.maxVirus,
                maxHeartbeatInterval: config.maxHeartbeatInterval
            }
        });
    });

    router.post('/kick', (req, res) => {
        const name = typeof req.body?.name === 'string' ? req.body.name : null;
        if (!name) {
            res.status(400).json({ error: 'name required' });
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
            socket.emit('kick', 'Kicked by admin.');
            socket.disconnect();
        }
        deps.map.players.removePlayerByIndex(index);
        console.log('[ADMIN] HTTP kick: ' + name);
        res.json({ ok: true });
    });

    router.post('/broadcast', (req, res) => {
        const message = typeof req.body?.message === 'string' ? req.body.message : null;
        if (!message) {
            res.status(400).json({ error: 'message required' });
            return;
        }
        // Admin broadcasts appear in every chat as a message from the
        // reserved sender "ADMIN"; clients render that sender in bold.
        deps.io.emit('serverSendPlayerChat', { sender: 'ADMIN', message });
        console.log('[ADMIN] HTTP broadcast: ' + message);
        res.json({ ok: true });
    });

    return router;
}
