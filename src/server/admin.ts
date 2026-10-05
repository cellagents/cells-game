// HTTP admin API. Guarded by a bearer token read from config.adminPass
// (which honors the ADMIN_PASS env var). Mounted at /admin by server.ts.

import { Router, Request, Response, NextFunction } from 'express';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { Map as GameMap } from './map/map';
import config from '../config';

export interface AdminDeps {
    io: SocketIOServer;
    map: GameMap;
    sockets: Record<string, Socket>;
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
        deps.io.emit('serverMSG', message);
        console.log('[ADMIN] HTTP broadcast: ' + message);
        res.json({ ok: true });
    });

    return router;
}
