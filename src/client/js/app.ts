import io from 'socket.io-client';
import * as render from './render';
import ChatClient from './chat-client';
import Canvas from './canvas';
import global from './global';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, canvasColorsFor } from './theme';

// Keep the canvas state in sync with the theme. The CSS swap and the
// canvas swap must move together or the dark-mode click leaves grid and
// background stuck on the light defaults.
onThemeChange((_t, colors) => {
    global.backgroundColor = colors.background;
    global.lineColor = colors.grid;
    global.borderColor = colors.border;
    global.outsideArenaColor = colors.outsideArena;
});
const initialTheme = currentTheme();
const initialColors = canvasColorsFor(initialTheme);
global.backgroundColor = initialColors.background;
global.lineColor = initialColors.grid;
global.borderColor = initialColors.border;
global.outsideArenaColor = initialColors.outsideArena;
applyTheme(initialTheme);
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) attachThemeToggle(themeBtn);

declare global {
    interface Window {
        chat: any;
        canvas: any;
        requestAnimFrame: (cb: FrameRequestCallback) => number;
        cancelAnimFrame: (handle: number) => void;
    }
}

const playerNameInput = document.getElementById('playerNameInput') as HTMLInputElement;
let socket: any;

const debug = (...args: unknown[]): void => {
    if (console && console.log) {
        console.log(...args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type: 'player' | 'spectator'): void {
    (global as any).playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    (global as any).playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    // Mark body as player-mode so the touch-control media query can
    // decide whether to show the on-screen split/eject buttons. Spectators
    // never get them (no actions to take).
    document.body.classList.toggle('player-mode', type === 'player');

    (document.getElementById('startMenuWrapper') as HTMLElement).style.maxHeight = '0px';
    (document.getElementById('gameAreaWrapper') as HTMLElement).style.opacity = '1';
    if (!socket) {
        socket = io({ query: { type } } as any);
        (global as any).socket = socket;
        window.chat = new ChatClient();
        setupSocket(socket);
    }
    if (!(global as any).animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
}

// Disconnect and return to the start screen. Triggered by the floating
// exit button or the ESC key (unless the user is typing in a text field).
function exitToMenu(): void {
    if (socket) {
        try { socket.close(); } catch { /* ignore */ }
        socket = undefined;
        (global as any).socket = undefined;
    }
    if (window.chat && window.chat.chat && typeof window.chat.chat.destroy === 'function') {
        window.chat.chat.destroy();
    }
    window.chat = undefined as any;
    global.gameStart = false;
    document.body.classList.remove('player-mode');
    (document.getElementById('gameAreaWrapper') as HTMLElement).style.opacity = '0';
    (document.getElementById('startMenuWrapper') as HTMLElement).style.maxHeight = '1000px';
    if ((global as any).animLoopHandle) {
        window.cancelAnimationFrame((global as any).animLoopHandle);
        (global as any).animLoopHandle = undefined;
    }
}

function validNick(): boolean {
    const regex = /^\w*$/;
    debug('Regex Test', regex.exec(playerNameInput.value) as any);
    return regex.exec(playerNameInput.value) !== null;
}

(window as any).onload = function (): void {
    const btn = document.getElementById('startButton') as HTMLButtonElement;
    const btnS = document.getElementById('spectateButton') as HTMLButtonElement;
    const nickErrorText = document.querySelector('#startMenu .input-error') as HTMLElement;

    btnS.onclick = () => startGame('spectator');

    btn.onclick = () => {
        if (validNick()) {
            nickErrorText.style.opacity = '0';
            startGame('player');
        } else {
            nickErrorText.style.opacity = '1';
        }
    };

    const exitBtn = document.getElementById('exitToMenu');
    if (exitBtn) exitBtn.addEventListener('click', () => { if (global.gameStart) exitToMenu(); });

    // Global ESC: return to menu. Ignore when the user is typing (chat
    // input, name input, any editable field) so ESC-to-clear in those
    // fields keeps working.
    window.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return;
        const t = ev.target as HTMLElement | null;
        const tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        if (global.gameStart) exitToMenu();
    });

    const settingsMenu = document.getElementById('settingsButton') as HTMLElement;
    const settings = document.getElementById('settings') as HTMLElement;

    settingsMenu.onclick = () => {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
        } else {
            settings.style.maxHeight = '300px';
        }
    };

    playerNameInput.addEventListener('keypress', (e: KeyboardEvent) => {
        const key = e.which || e.keyCode;
        if (key === global.KEY_ENTER) {
            if (validNick()) {
                nickErrorText.style.opacity = '0';
                startGame('player');
            } else {
                nickErrorText.style.opacity = '1';
            }
        }
    });
};

// TODO: Break out into GameControls.

const playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

let player: any = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
(global as any).player = player;

let foods: any[] = [];
let viruses: any[] = [];
let fireFood: any[] = [];
let users: any[] = [];
let leaderboard: any[] = [];
const target = { x: player.x, y: player.y };
(global as any).target = target;

window.canvas = new Canvas();
// chat is constructed in startGame() once we have a socket, because the
// shared chat module subscribes to socket events eagerly.

const visibleBorderSetting = document.getElementById('visBord') as HTMLInputElement;
visibleBorderSetting.onchange = (window as any).settings?.toggleBorder;

const showMassSetting = document.getElementById('showMass') as HTMLInputElement;
showMassSetting.onchange = (window as any).settings?.toggleMass;

const continuitySetting = document.getElementById('continuity') as HTMLInputElement;
continuitySetting.onchange = (window as any).settings?.toggleContinuity;

const roundFoodSetting = document.getElementById('roundFood') as HTMLInputElement;
roundFoodSetting.onchange = (window as any).settings?.toggleRoundFood;

const c = window.canvas.cv as HTMLCanvasElement;
const graph = c.getContext('2d') as CanvasRenderingContext2D;

// Wire the on-screen touch controls. `click` fires for both mouse and
// touch (via a synthesized click), which is enough; the CSS sets
// touch-action: manipulation to kill the 300ms iOS click delay.
document.getElementById('feed')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!socket) return;
    socket.emit('1');
    window.canvas.reenviar = false;
});
document.getElementById('split')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!socket) return;
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect(): void {
    socket.close();
    if (!global.kicked) {
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

function setupSocket(socket: any): void {
    socket.on('pongcheck', () => {
        const latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    socket.on('welcome', (playerSettings: any, gameSizes: any) => {
        player = playerSettings;
        player.name = (global as any).playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        (global as any).player = player;
        window.chat.player = player;
        socket.emit('gotit', player);
        global.gameStart = true;
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        if (global.mobile) {
            document.getElementById('gameAreaWrapper')!.removeChild(document.getElementById('chatbox')!);
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
    });

    // playerDied, playerDisconnect, playerJoin, serverMSG and
    // serverSendPlayerChat are now handled by the shared chat module.

    socket.on('leaderboard', (data: any) => {
        leaderboard = data.leaderboard;
        let status = '<span class="title">Leaderboard</span>';
        for (let i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            if (leaderboard[i].id == player.id) {
                if (leaderboard[i].name.length !== 0)
                    status += '<span class="me">' + (i + 1) + '. ' + leaderboard[i].name + "</span>";
                else
                    status += '<span class="me">' + (i + 1) + ". An unnamed cell</span>";
            } else {
                if (leaderboard[i].name.length !== 0)
                    status += (i + 1) + '. ' + leaderboard[i].name;
                else
                    status += (i + 1) + '. An unnamed cell';
            }
        }
        document.getElementById('status')!.innerHTML = status;
    });

    socket.on('serverTellPlayerMove', (playerData: any, userData: any, foodsList: any, massList: any, virusList: any) => {
        if ((global as any).playerType == 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            player.cells = playerData.cells;
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
    });

    socket.on('RIP', () => {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);
        window.setTimeout(exitToMenu, 2500);
    });

    socket.on('kick', (reason: string) => {
        global.gameStart = false;
        global.kicked = true;
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        } else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });
}

const isUnnamedCell = (name: string): boolean => name.length < 1;

const getPosition = (entity: { x: number; y: number }, player: { x: number; y: number }, screen: { width: number; height: number }) => ({
    x: entity.x - player.x + screen.width / 2,
    y: entity.y - player.y + screen.height / 2
});

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        (window as any).webkitRequestAnimationFrame ||
        (window as any).mozRequestAnimationFrame ||
        (window as any).msRequestAnimationFrame ||
        function (callback: FrameRequestCallback) {
            return window.setTimeout(callback as unknown as TimerHandler, 1000 / 60) as unknown as number;
        };
})();

window.cancelAnimFrame = (function () {
    return window.cancelAnimationFrame ||
        (window as any).mozCancelAnimationFrame;
})();

function animloop(): void {
    (global as any).animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop(): void {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);
        // Mute the area beyond the playfield so the arena edge is visible
        // even when the user hasn't opted into drawBorder.
        const arenaBorders = {
            left: global.screen.width / 2 - player.x,
            right: global.screen.width / 2 + global.game.width - player.x,
            top: global.screen.height / 2 - player.y,
            bottom: global.screen.height / 2 + global.game.height - player.y
        };
        render.drawOutsideArena(arenaBorders, global.outsideArenaColor, global.screen, graph);
        foods.forEach(food => {
            const position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });
        fireFood.forEach(fireFood => {
            const position = getPosition(fireFood, player, global.screen);
            render.drawFireFood(position, fireFood, playerConfig, graph);
        });
        viruses.forEach(virus => {
            const position = getPosition(virus, player, global.screen);
            render.drawVirus(position, virus, graph);
        });

        const borders = arenaBorders;
        if (global.borderDraw) {
            render.drawBorder(borders, global.borderColor, graph);
        }

        const cellsToDraw: any[] = [];
        for (let i = 0; i < users.length; i++) {
            const color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            const borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            for (let j = 0; j < users[i].cells.length; j++) {
                cellsToDraw.push({
                    color,
                    borderColor,
                    mass: users[i].cells[j].mass,
                    name: users[i].name,
                    radius: users[i].cells[j].radius,
                    x: users[i].cells[j].x - player.x + global.screen.width / 2,
                    y: users[i].cells[j].y - player.y + global.screen.height / 2
                });
            }
        }
        cellsToDraw.sort((obj1, obj2) => obj1.mass - obj2.mass);
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        socket.emit('0', window.canvas.target);
    }
}

window.addEventListener('resize', resize);

function resize(): void {
    if (!socket) return;

    player.screenWidth = c.width = global.screen.width = (global as any).playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = (global as any).playerType == 'player' ? window.innerHeight : global.game.height;

    if ((global as any).playerType == 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
    }

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}
