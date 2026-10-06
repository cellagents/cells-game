// Config loader. Reads a JSON file from one of several candidate paths,
// then applies environment-variable overrides for the handful of fields
// commonly tuned per deployment or test run.
//
// Candidate order (first that exists wins):
//   1. $CELLAGENTS_GAME_CONFIG          explicit override
//   2. <repo-root>/config.json          user-managed, gitignored
//   3. <repo-root>/config.example.json  checked-in defaults
//
// Shape (grouped since 3.0.0):
//   server.*  — transport + operational knobs
//   game.*    — world + gameplay mechanics (incl. per-player starting
//               values; the server owns these, the client never does)
//   client.*  — surface-specific knobs grouped by page/view:
//               theme, admin, follow, lobby, player, spectator
//
// There is no compatibility shim for the old flat shape; the loader
// errors out loudly if someone hands it a pre-3.0 config so the
// mismatch is caught at startup instead of at first use.

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

export interface ServerLoopRates {
    /** Physics tick frequency (per-player movement + collisions). */
    physicsHz: number;
    /** Metabolism + leaderboard recompute frequency. */
    metabolismHz: number;
    /** World-state fan-out frequency (serverTellPlayerMove per socket). */
    fanOutHz: number;
}

export interface ServerConfig {
    host: string;
    port: number;
    loopRates: ServerLoopRates;
    /** Server kicks sockets whose last heartbeat is older than this
     *  many milliseconds. Set to 0 to disable the kick. */
    maxHeartbeatInterval: number;
    logChat: boolean;
    dbFileName: string;
}

export interface GameConfig {
    width: number;
    height: number;
    /** Target total mass in the world (food + players combined). */
    mass: number;
    maxFood: number;
    foodMass: number;
    foodUniformDisposition: boolean;
    maxVirus: number;
    virus: VirusConfig;
    slowBase: number;
    massLossRate: number;
    minMassLoss: number;
    defaultPlayerMass: number;
    limitSplit: number;
    /** Mass cost + ejected pellet size for the fireFood (W) action. */
    fireFood: number;
    newPlayerInitialPosition: NewPlayerInitialPosition;
}

export interface LobbyButton {
    label: string;
    href: string;
}

export interface LobbyConfig {
    buttonsBefore?: LobbyButton[];
    buttonsAfter?: LobbyButton[];
}

export interface AdminConfig {
    /** Bearer token for the /admin HTTP API. Admin is disabled when
     *  this is unset, empty, or the literal placeholder "DEFAULT". */
    pass: string;
}

/** Placeholder sections. Empty today; present so operators can see
 *  where surface-specific knobs will land as they're added. */
export interface ThemeConfig {}
export interface FollowConfig {}
export interface PlayerClientConfig {}
export interface SpectatorConfig {}

export interface ClientConfig {
    theme: ThemeConfig;
    admin: AdminConfig;
    follow: FollowConfig;
    lobby: LobbyConfig;
    player: PlayerClientConfig;
    spectator: SpectatorConfig;
}

export interface Config {
    server: ServerConfig;
    game: GameConfig;
    client: ClientConfig;
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
    let source: string | null = null;
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
            source = p;
            break;
        }
    }
    if (!raw) {
        throw new Error('No cells-game config file found; set CELLAGENTS_GAME_CONFIG or create config.json / config.example.json');
    }

    // Reject the pre-3.0 flat layout up-front so the mismatch is caught
    // at startup instead of as a runtime "undefined" surprise.
    if (!raw.server || !raw.game || !raw.client) {
        throw new Error(
            `Config at ${source} is missing one of the required top-level sections (server, game, client). `
            + 'The flat pre-3.0 shape is no longer supported; see config.example.json for the grouped layout.'
        );
    }

    const cfg = raw as unknown as Config;

    // Env overrides. Keep the whitelist narrow: these are the knobs
    // commonly tuned without editing the file (docker, CI, test harness).
    cfg.server.host = envStr('HOST', cfg.server.host);
    cfg.server.port = envInt('PORT', cfg.server.port);
    cfg.client.admin.pass = envStr('ADMIN_PASS', cfg.client.admin.pass);
    // Set MAX_HEARTBEAT_INTERVAL=0 to disable the server-side kick for
    // stalled clients (useful for test harnesses and automated agents).
    cfg.server.maxHeartbeatInterval = envInt('MAX_HEARTBEAT_INTERVAL', cfg.server.maxHeartbeatInterval);

    return cfg;
}

const config: Config = loadConfig();

export default config;
module.exports = config;
