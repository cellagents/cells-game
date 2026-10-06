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
//               global (cross-view defaults), admin, follow, lobby,
//               player, spectator, managed
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

export interface LobbyLink {
    label: string;
    href: string;
}

/** Lobby content: operator-authored page body additions. `ui` is
 *  reserved for canvas-interface knobs (floating buttons, overlays,
 *  minimap); the lobby is a plain form, so its operator customisation
 *  lives under `content`. Links are the only field today; copy and
 *  settings will land as siblings as they're added. */
export interface LobbyContentConfig {
    extraLinks: LobbyLink[];
}


/** Rule for a toggleable widget: button present AND default visibility.
 *  `button: false` omits the toggle button from the DOM AND locks the
 *  widget to its defaultVisible value for that viewport width class
 *  (users can't toggle it in). `defaultVisible` is split so operators
 *  can hide heavy overlays on narrow screens without touching desktop. */
export interface ViewUiWidget {
    button: boolean;
    defaultVisible: { desktop: boolean; mobile: boolean };
}

/** Rule for an action-only floating button (one that does something
 *  on click but has no visibility state of its own). `button: false`
 *  omits the button entirely. If forced on a view that doesn't wire
 *  an action for it, pressing it is a no-op. */
export interface ViewUiAction {
    button: boolean;
}

/** Lobby chrome: just the theme toggle. The lobby IS the exit
 *  destination so no exit button here; chat/leaderboard/minimap
 *  are canvas-view concerns. */
export interface LobbyUiConfig {
    theme: ViewUiAction;
}

/** Admin chrome: theme toggle plus a lock button that clears the
 *  admin session and returns to the login card. `lock` is distinct
 *  from `exit` because the admin page doesn't navigate away; it
 *  just reverts to its own login view. */
export interface AdminUiConfig {
    theme: ViewUiAction;
    lock: ViewUiAction;
}

/** Canvas-view chrome: full stack. `exit` navigates back to the lobby;
 *  the three widgets gate independent overlays. */
export interface CanvasUiConfig {
    exit: ViewUiAction;
    theme: ViewUiAction;
    chat: ViewUiWidget;
    leaderboard: ViewUiWidget;
    minimap: ViewUiWidget;
}

export interface AdminConfig {
    /** Bearer token for the /admin HTTP API. Admin is disabled when
     *  this is unset, empty, or the literal placeholder "DEFAULT". */
    pass: string;
    ui: AdminUiConfig;
}

/** Cross-view defaults (theme preference overrides, future shared
 *  branding knobs). Empty today, reserved as a sibling of the
 *  per-view sections. */
export interface GlobalConfig {}

export interface LobbyConfig { content: LobbyContentConfig; ui: LobbyUiConfig }
export interface FollowConfig { ui: CanvasUiConfig }
export interface PlayerClientConfig { ui: CanvasUiConfig }
export interface SpectatorConfig { ui: CanvasUiConfig }
/** Managed is the operator-embedded view (iframe harness surface).
 *  Same chrome shape as the other canvas views; typical config
 *  disables everything so the embedding parent stays in control. */
export interface ManagedConfig { ui: CanvasUiConfig }

export interface ClientConfig {
    global: GlobalConfig;
    admin: AdminConfig;
    follow: FollowConfig;
    lobby: LobbyConfig;
    player: PlayerClientConfig;
    spectator: SpectatorConfig;
    managed: ManagedConfig;
}

/** Views that have a `ui` section the client fetches at load time. */
export type UiView = 'lobby' | 'admin' | 'player' | 'spectator' | 'follow' | 'managed';

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
