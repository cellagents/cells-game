export interface VirusConfig {
    fill: string;
    stroke: string;
    strokeWidth: number;
    defaultMass: { from: number; to: number };
    splitMass: number;
    uniformDisposition: boolean;
}

export interface SqlInfo {
    fileName: string;
}

export interface Config {
    host: string;
    port: number;
    logpath: string;
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
    logChat: number;
    networkUpdateFactor: number;
    maxHeartbeatInterval: number;
    foodUniformDisposition: boolean;
    newPlayerInitialPosition: string;
    massLossRate: number;
    minMassLoss: number;
    sqlinfo: SqlInfo;
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

const config: Config = {
    host: envStr('HOST', "0.0.0.0"),
    port: envInt('PORT', 3000),
    logpath: "logger.php",
    foodMass: 1,
    fireFood: 20,
    limitSplit: 16,
    defaultPlayerMass: 10,
    virus: {
        fill: "#33ff33",
        stroke: "#19D119",
        strokeWidth: 20,
        defaultMass: {
            from: 100,
            to: 150
        },
        splitMass: 180,
        uniformDisposition: false,
    },
    gameWidth: 5000,
    gameHeight: 5000,
    adminPass: envStr('ADMIN_PASS', "DEFAULT"),
    gameMass: 20000,
    maxFood: 1000,
    maxVirus: 50,
    slowBase: 4.5,
    logChat: 0,
    networkUpdateFactor: 40,
    // Set MAX_HEARTBEAT_INTERVAL=0 to disable the server-side kick for
    // stalled clients (useful for test harnesses and automated agents
    // that may pause between heartbeats).
    maxHeartbeatInterval: envInt('MAX_HEARTBEAT_INTERVAL', 5000),
    foodUniformDisposition: true,
    newPlayerInitialPosition: "farthest",
    massLossRate: 1,
    minMassLoss: 50,
    sqlinfo: {
        fileName: "db.sqlite3",
    }
};

export default config;
module.exports = config;
