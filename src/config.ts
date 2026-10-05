// Config loader. Reads a JSON file from one of several candidate paths,
// then applies environment-variable overrides for the handful of fields
// commonly tuned per deployment or test run.
//
// Candidate order (first that exists wins):
//   1. $CELLAGENTS_GAME_CONFIG          explicit override
//   2. <repo-root>/config.json          user-managed, gitignored
//   3. <repo-root>/config.example.json  checked-in defaults
//

import fs from 'node:fs';
import path from 'node:path';

export interface VirusConfig {
    fill: string;
    stroke: string;
    strokeWidth: number;
    defaultMass: { from: number; to: number };
    splitMass: number;
    uniformDisposition: boolean;
}

export type NewPlayerInitialPosition = 'farthest' | 'random';

export interface Config {
    host: string;
    port: number;
    foodMass: number;
    fireFood: number;
    limitSplit: number;
    defaultPlayerMass: number;
    virus: VirusConfig;
    gameWidth: number;
    gameHeight: number;
    adminPass: string;
    gameMass: number;
    maxFood: number;
    maxVirus: number;
    slowBase: number;
    logChat: boolean;
    networkUpdateFactor: number;
    maxHeartbeatInterval: number;
    foodUniformDisposition: boolean;
    newPlayerInitialPosition: NewPlayerInitialPosition;
    massLossRate: number;
    minMassLoss: number;
    dbFileName: string;
}

function envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
    }
    return parsed;
}

function envStr(name: string, fallback: string): string {
    const raw = process.env[name];
    return raw === undefined || raw === '' ? fallback : raw;
}

function loadConfig(): Config {
    // src/config.ts compiles to bin/config.js; repo root is one dir up.
    const repoRoot = path.resolve(__dirname, '..');
    const envPath = process.env.CELLAGENTS_GAME_CONFIG;
    const candidates = [
        envPath,
        path.resolve(repoRoot, 'config.json'),
        path.resolve(repoRoot, 'config.example.json')
    ].filter((p): p is string => typeof p === 'string');

    let raw: Record<string, unknown> | null = null;
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
            break;
        }
    }
    if (!raw) {
        throw new Error('No cells-game config file found; set CELLAGENTS_GAME_CONFIG or create config.json / config.example.json');
    }

    // Legacy shape migrations: accept old field forms silently so existing
    // config.json files keep working after the 2.0.1 cleanup. These shims
    // can be removed once no deployment still ships the old shape.
    //
    //   logChat: 0 | 1  (number)   -> boolean
    //   sqlinfo: { fileName }      -> dbFileName
    if (typeof raw.logChat === 'number') raw.logChat = raw.logChat !== 0;
    if (raw.dbFileName === undefined && raw.sqlinfo && typeof raw.sqlinfo === 'object') {
        const info = raw.sqlinfo as Record<string, unknown>;
        if (typeof info.fileName === 'string') raw.dbFileName = info.fileName;
    }
    delete raw.sqlinfo;

    const cfg = raw as unknown as Config;

    // Env overrides. Keep the whitelist narrow: these are the knobs
    // commonly tuned without editing the file (docker, CI, test harness).
    cfg.host = envStr('HOST', cfg.host);
    cfg.port = envInt('PORT', cfg.port);
    cfg.adminPass = envStr('ADMIN_PASS', cfg.adminPass);
    // Set MAX_HEARTBEAT_INTERVAL=0 to disable the server-side kick for
    // stalled clients (useful for test harnesses and automated agents).
    cfg.maxHeartbeatInterval = envInt('MAX_HEARTBEAT_INTERVAL', cfg.maxHeartbeatInterval);

    return cfg;
}

const config: Config = loadConfig();

export default config;
module.exports = config;
