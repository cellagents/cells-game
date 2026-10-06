// Protocol 1.0 — the wire contract between a subscriber and the
// cells-game server. Single source of truth for handshake, event
// names, payload shapes, capability flags and runtime validation.
//
// This module is intentionally free of server- and client-specific
// imports so it can be lifted verbatim to the standalone
// @cellagents/game-protocol package in step 4a of the 4.0 plan.
//
// Design notes:
//
//   - Zod is the ground truth. TypeScript types are inferred from
//     schemas via z.infer, so the compiler and the runtime validator
//     can never disagree.
//   - Server-authoritative. Clients may advertise anything; the
//     server validates every subscribe payload and rejects what it
//     cannot serve. Steer-channel events arriving outside a
//     presence+steer capability set are silently dropped.
//   - No `receive` capability. Every subscriber receives tick +
//     leaderboard; the three real capabilities are steer, presence
//     and viewport.

import { z } from 'zod';

export const PROTOCOL_VERSION = '1.0' as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// -------- Capabilities -------------------------------------------------------

export const CapabilitySchema = z.enum(['steer', 'presence', 'viewport']);
export type Capability = z.infer<typeof CapabilitySchema>;

// -------- Primitive shapes ---------------------------------------------------

export const CellSchema = z.object({
    x: z.number(),
    y: z.number(),
    mass: z.number(),
    radius: z.number()
});
export type Cell = z.infer<typeof CellSchema>;

export const PlayerSnapshotSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    hue: z.number(),
    massTotal: z.number(),
    cells: z.array(CellSchema)
});
export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;

export const FoodSchema = z.object({
    x: z.number(),
    y: z.number(),
    hue: z.number(),
    radius: z.number()
});
export type Food = z.infer<typeof FoodSchema>;

export const MassFoodSchema = z.object({
    x: z.number(),
    y: z.number(),
    hue: z.number(),
    radius: z.number()
});
export type MassFood = z.infer<typeof MassFoodSchema>;

export const VirusSchema = z.object({
    x: z.number(),
    y: z.number(),
    radius: z.number()
});
export type Virus = z.infer<typeof VirusSchema>;

export const WorldSizeSchema = z.object({
    width: z.number().positive(),
    height: z.number().positive()
});
export type WorldSize = z.infer<typeof WorldSizeSchema>;

export const ScreenSchema = z.object({
    width: z.number().positive(),
    height: z.number().positive()
});
export type Screen = z.infer<typeof ScreenSchema>;

// -------- Handshake ----------------------------------------------------------

/** Nickname rules. Alphanumeric + underscore, 1..25 chars. The server
 *  additionally strips angle-bracket tags before persisting, but the
 *  wire-level schema is this. */
export const NameSchema = z.string().regex(/^\w+$/).min(1).max(25);

/** Shape-only schema for a subscribe payload. Semantic validation
 *  (combinations of capabilities + required fields) is applied via
 *  `validateSubscribe` after a successful parse so types stay
 *  non-circular. */
export const SubscribeSchema = z.object({
    protocol: z.literal(PROTOCOL_VERSION),
    capabilities: z
        .array(CapabilitySchema)
        .refine(
            (arr) => new Set(arr).size === arr.length,
            { message: 'capabilities must not contain duplicates' }
        ),
    name: NameSchema.optional(),
    screen: ScreenSchema.optional(),
    follow: z.string().optional()
});
export type Subscribe = z.infer<typeof SubscribeSchema>;

/** Shape of a subscribe payload for the capability validator. Matches
 *  Subscribe but intentionally does not reference it so there is no
 *  type cycle. */
interface SubscribeLike {
    capabilities: Capability[];
    name?: string;
    screen?: Screen;
    follow?: string;
}

/** Capability-set validator used by the server to accept/reject
 *  subscribes. Three valid shapes:
 *
 *    {}                                           full-map spectator
 *    {viewport} + follow                          follow viewer
 *    {steer, presence, viewport} + screen + name  player / bot
 */
export function validCapabilitySet(
    caps: Set<Capability>,
    payload: Pick<SubscribeLike, 'name' | 'screen' | 'follow'>
): { ok: true } | { ok: false; message: string } {
    const has = (c: Capability) => caps.has(c);
    // Mutual-exclusion rules.
    if (has('steer') && !has('presence')) {
        return { ok: false, message: 'steer requires presence' };
    }
    if (has('presence') && !has('viewport')) {
        return { ok: false, message: 'presence requires viewport' };
    }
    if (has('presence') && !payload.name) {
        return { ok: false, message: 'presence requires name' };
    }
    if (has('viewport')) {
        // Follow viewer: has viewport and follow, no presence.
        // Player / bot: has viewport and screen and presence.
        if (has('presence')) {
            if (!payload.screen) {
                return { ok: false, message: 'presence subscriber needs screen' };
            }
            if (payload.follow) {
                return { ok: false, message: 'presence subscriber cannot also follow' };
            }
        } else {
            // viewport without presence => must be follow viewer
            if (!payload.follow) {
                return { ok: false, message: 'viewport without presence requires follow' };
            }
            if (payload.screen) {
                return { ok: false, message: 'viewport+follow does not take screen' };
            }
        }
    } else {
        // No viewport. Must be full-map spectator; nothing else allowed.
        if (payload.screen || payload.follow) {
            return { ok: false, message: 'screen/follow require viewport capability' };
        }
    }
    return { ok: true };
}

/** Parse + semantic-validate a subscribe payload. Returns either the
 *  typed value or a structured error with the matching reject code,
 *  so the server has a single call site for the handshake decision. */
export function parseSubscribe(raw: unknown):
    | { ok: true; value: Subscribe }
    | { ok: false; code: 'INVALID_PAYLOAD' | 'UNSUPPORTED_PROTOCOL' | 'INVALID_CAPABILITIES' | 'INVALID_NAME'; message: string }
{
    const shape = SubscribeSchema.safeParse(raw);
    if (!shape.success) {
        // Distinguish the three predictable shape failures with
        // issue-codes so the server can emit a tight reject message.
        const issue = shape.error.issues[0];
        if (issue && issue.path.length === 1 && issue.path[0] === 'protocol') {
            return { ok: false, code: 'UNSUPPORTED_PROTOCOL', message: issue.message };
        }
        if (issue && issue.path.length >= 1 && issue.path[0] === 'name') {
            return { ok: false, code: 'INVALID_NAME', message: issue.message };
        }
        return { ok: false, code: 'INVALID_PAYLOAD', message: issue ? issue.message : 'invalid subscribe payload' };
    }
    const parsed = shape.data;
    const combo = validCapabilitySet(new Set(parsed.capabilities), parsed);
    if (!combo.ok) {
        // name-required-for-presence is a NAME problem; everything
        // else is a CAPABILITIES problem.
        const code: 'INVALID_NAME' | 'INVALID_CAPABILITIES' =
            combo.message === 'presence requires name' ? 'INVALID_NAME' : 'INVALID_CAPABILITIES';
        return { ok: false, code, message: combo.message };
    }
    return { ok: true, value: parsed };
}

export const RejectCodeSchema = z.enum([
    'UNSUPPORTED_PROTOCOL',
    'INVALID_PAYLOAD',
    'INVALID_CAPABILITIES',
    'INVALID_NAME',
    'SERVER_FULL',
    'NAME_TAKEN'
]);
export type RejectCode = z.infer<typeof RejectCodeSchema>;

export const RejectSchema = z.object({
    code: RejectCodeSchema,
    message: z.string()
});
export type Reject = z.infer<typeof RejectSchema>;

/** Self payload returned on welcome for a presence subscriber. The
 *  initial cell is not yet in place; the next tick will carry the
 *  server-authoritative position. */
export const WelcomeSelfSchema = z.object({
    id: z.string(),
    name: z.string(),
    hue: z.number()
});
export type WelcomeSelf = z.infer<typeof WelcomeSelfSchema>;

export const WelcomeSchema = z.object({
    protocol: z.literal(PROTOCOL_VERSION),
    subscriberId: z.string(),
    world: WorldSizeSchema,
    self: WelcomeSelfSchema.nullable()
});
export type Welcome = z.infer<typeof WelcomeSchema>;

// -------- HTTP probe (dual-mode detection) -----------------------------------

/** Response from GET /protocol on the game server. Used by cells-mcp
 *  to decide which wire to speak before opening a socket.
 *  A pre-1.0 server does not expose this route and 404s. */
export const ProtocolProbeSchema = z.object({
    protocol: z.literal(PROTOCOL_VERSION),
    server: z.string(),
    version: z.string()
});
export type ProtocolProbe = z.infer<typeof ProtocolProbeSchema>;

// -------- Tick + leaderboard -------------------------------------------------

/** tick.self semantics are context-sensitive:
 *
 *    presence subscriber   -> their own player, including dead state
 *                             (self != null) UNTIL `died` is emitted,
 *                             after which self is null until respawn.
 *    viewport.follow       -> the followed player if present, else
 *                             null (and the tick is unculled full-map).
 *    full-map spectator    -> always null.
 *
 *  self.cells is the live cell array; mass/radius come straight from
 *  the server. Follow viewers see the followed player's cells as self;
 *  players see their own. */
export const TickSchema = z.object({
    self: PlayerSnapshotSchema.nullable(),
    players: z.array(PlayerSnapshotSchema),
    food: z.array(FoodSchema),
    mass: z.array(MassFoodSchema),
    viruses: z.array(VirusSchema)
});
export type Tick = z.infer<typeof TickSchema>;

export const LeaderboardEntrySchema = z.object({
    id: z.string(),
    name: z.string().nullable()
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSchema = z.object({
    players: z.number(),
    leaderboard: z.array(LeaderboardEntrySchema)
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;

// -------- Chat and lifecycle events ------------------------------------------

export const ClientChatSchema = z.object({
    message: z.string().max(200)
});
export type ClientChat = z.infer<typeof ClientChatSchema>;

export const ServerChatSchema = z.object({
    sender: z.string(),
    message: z.string()
});
export type ServerChat = z.infer<typeof ServerChatSchema>;

export const PlayerJoinSchema = z.object({ name: z.string() });
export type PlayerJoin = z.infer<typeof PlayerJoinSchema>;

export const PlayerLeaveSchema = z.object({ name: z.string() });
export type PlayerLeave = z.infer<typeof PlayerLeaveSchema>;

export const PlayerDiedSchema = z.object({
    playerEatenName: z.string(),
    killerName: z.string().nullable()
});
export type PlayerDied = z.infer<typeof PlayerDiedSchema>;

export const KickSchema = z.object({ reason: z.string() });
export type Kick = z.infer<typeof KickSchema>;

// -------- Steering payloads --------------------------------------------------

export const HeartbeatSchema = z.object({
    x: z.number(),
    y: z.number()
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const WindowResizedSchema = ScreenSchema;
export type WindowResized = z.infer<typeof WindowResizedSchema>;

// -------- Event-name constants (string de-duplication) -----------------------

/** Client -> server event names. Server-side socket.on handlers
 *  key off these constants so a typo in one place is caught by the
 *  compiler everywhere. */
export const ClientEvent = {
    subscribe: 'subscribe',
    heartbeat: 'heartbeat',
    fireFood: 'fireFood',
    split: 'split',
    respawn: 'respawn',
    pingcheck: 'pingcheck',
    windowResized: 'windowResized',
    playerChat: 'playerChat'
} as const;
export type ClientEventName = typeof ClientEvent[keyof typeof ClientEvent];

/** Server -> client event names. */
export const ServerEvent = {
    welcome: 'welcome',
    reject: 'reject',
    tick: 'tick',
    leaderboard: 'leaderboard',
    pongcheck: 'pongcheck',
    kick: 'kick',
    died: 'died',
    playerJoin: 'playerJoin',
    playerDisconnect: 'playerDisconnect',
    playerDied: 'playerDied',
    serverSendPlayerChat: 'serverSendPlayerChat'
} as const;
export type ServerEventName = typeof ServerEvent[keyof typeof ServerEvent];
