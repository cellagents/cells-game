// Shared mutable state and keyboard constants for the client.
// Fields are added/read ad-hoc across modules; typed loosely on purpose
// to keep the TS migration a straight port of the JS behaviour.

export interface ClientGlobal {
    KEY_ESC: number;
    KEY_ENTER: number;
    KEY_CHAT: number;
    KEY_FIREFOOD: number;
    KEY_SPLIT: number;
    KEY_LEFT: number;
    KEY_UP: number;
    KEY_RIGHT: number;
    KEY_DOWN: number;
    borderDraw: boolean;
    mobile: boolean;
    screen: { width: number; height: number };
    game: { width: number; height: number };
    gameStart: boolean;
    disconnected: boolean;
    kicked: boolean;
    continuity: boolean;
    startPingTime: number;
    toggleMassState: number;
    backgroundColor: string;
    lineColor: string;
    borderColor: string;
    outsideArenaColor: string;
    [key: string]: unknown;
}

const global: ClientGlobal = {
    KEY_ESC: 27,
    KEY_ENTER: 13,
    KEY_CHAT: 13,
    KEY_FIREFOOD: 119,
    KEY_SPLIT: 32,
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    borderDraw: false,
    mobile: false,
    screen: {
        width: window.innerWidth,
        height: window.innerHeight
    },
    game: {
        width: 0,
        height: 0
    },
    gameStart: false,
    disconnected: false,
    kicked: false,
    continuity: false,
    startPingTime: 0,
    toggleMassState: 0,
    backgroundColor: '#f2fbff',
    lineColor: '#000000',
    borderColor: '#000000',
    outsideArenaColor: 'rgba(0, 0, 0, 0.18)',
};

export default global;
