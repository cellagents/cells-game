// In-game surface. Reads ?name=X from the URL and auto-starts a
// Socket.IO session as a player. Exit button and ESC navigate back to
// the lobby at /, which tears everything down the browser way.

import io from 'socket.io-client';
import * as render from './render';
import ChatClient from './chat-client';
import Canvas from './canvas';
import global from './global';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, canvasColorsFor } from './theme';

// Keep the canvas state in sync with the theme (same wiring as before).
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

const debug = (...args: unknown[]): void => {
    if (console && console.log) console.log(...args);
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

// Read nickname from URL (?name=X). Lobby page validates it before
// redirecting here, so anything that reaches this page without a name
// is treated as "go back to the lobby".
const params = new URLSearchParams(window.location.search);
const rawName = params.get('name');
if (!rawName || !/^\w+$/.test(rawName)) {
    window.location.href = '/';
    throw new Error('missing or invalid ?name= param; redirecting to lobby');
}
const playerName = rawName.substring(0, 25);
(global as any).playerName = playerName;
(global as any).playerType = 'player';

global.screen.width = window.innerWidth;
global.screen.height = window.innerHeight;

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
const c = window.canvas.cv as HTMLCanvasElement;
const graph = c.getContext('2d') as CanvasRenderingContext2D;

const playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

const socket: any = io({ query: { type: 'player' } } as any);
(global as any).socket = socket;
window.chat = new ChatClient();
window.chat.socket = socket;
window.chat.registerFunctions();
window.canvas.socket = socket;

// Set to true the instant we start navigating away so disconnect-driven
// side effects (drawing "Disconnected!" on canvas, socket close noise)
// don't fire a confusing last-frame while the browser is unloading.
let leaving = false;
function leaveToLobby(): void {
    if (leaving) return;
    leaving = true;
    try { socket.close(); } catch { /* ignore */ }
    window.location.assign('/');
}

// Floating buttons
const exitBtn = document.getElementById('exitToMenu');
if (exitBtn) exitBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    leaveToLobby();
});
const chatBtn = document.getElementById('chatToggle');
if (chatBtn) chatBtn.addEventListener('click', () => {
    document.body.classList.toggle('chat-hidden');
});

// ESC: return to lobby. Ignore when typing in a text field so chat
// input ESC keeps clearing the field.
window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    const t = ev.target as HTMLElement | null;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    leaveToLobby();
});

// Mobile touch controls
document.getElementById('feed')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    socket.emit('1');
    window.canvas.reenviar = false;
});
document.getElementById('split')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect(): void {
    if (leaving) return; // navigating away deliberately; don't paint anything
    try { socket.close(); } catch { /* ignore */ }
    if (!global.kicked) {
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

socket.on('pongcheck', () => {
    const latency = Date.now() - global.startPingTime;
    debug('Latency: ' + latency + 'ms');
    window.chat.addSystemLine('Ping: ' + latency + 'ms');
});

socket.on('connect_error', handleDisconnect);
socket.on('disconnect', handleDisconnect);

socket.on('welcome', (playerSettings: any, gameSizes: any) => {
    player = playerSettings;
    player.name = playerName;
    player.screenWidth = global.screen.width;
    player.screenHeight = global.screen.height;
    player.target = window.canvas.target;
    (global as any).player = player;
    window.chat.player = player;
    socket.emit('gotit', player);
    global.gameStart = true;
    window.chat.addSystemLine('Connected to the game!');
    window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
    c.focus();
    global.game.width = gameSizes.width;
    global.game.height = gameSizes.height;
    resize();
});

socket.emit('respawn');

// playerDied, playerDisconnect, playerJoin, serverMSG and
// serverSendPlayerChat are now handled by the shared chat module.

socket.on('leaderboard', (data: any) => {
    leaderboard = data.leaderboard;
    let status = '<span class="title">Leaderboard</span>';
    for (let i = 0; i < leaderboard.length; i++) {
        status += '<br />';
        const name = leaderboard[i].name;
        const label = name && name.length !== 0 ? name : 'An unnamed cell';
        if (leaderboard[i].id == player.id) {
            status += `<span class="me">${i + 1}. ${label}</span>`;
        } else {
            status += `${i + 1}. ${label}`;
        }
    }
    document.getElementById('status')!.innerHTML = status;
});

socket.on('serverTellPlayerMove', (playerData: any, userData: any, foodsList: any, massList: any, virusList: any) => {
    player.x = playerData.x;
    player.y = playerData.y;
    player.hue = playerData.hue;
    player.massTotal = playerData.massTotal;
    player.cells = playerData.cells;
    users = userData;
    foods = foodsList;
    viruses = virusList;
    fireFood = massList;
});

socket.on('RIP', () => {
    global.gameStart = false;
    render.drawErrorMessage('You died!', graph, global.screen);
    window.setTimeout(() => { window.location.href = '/'; }, 2500);
});

socket.on('kick', (reason: string) => {
    global.gameStart = false;
    global.kicked = true;
    render.drawErrorMessage(
        reason ? 'You were kicked for: ' + reason : 'You were kicked!',
        graph, global.screen
    );
    socket.close();
});

const getPosition = (entity: { x: number; y: number }, p: { x: number; y: number }, screen: { width: number; height: number }) => ({
    x: entity.x - p.x + screen.width / 2,
    y: entity.y - p.y + screen.height / 2
});

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        (window as any).webkitRequestAnimationFrame ||
        (window as any).mozRequestAnimationFrame ||
        (window as any).msRequestAnimationFrame ||
        function (cb: FrameRequestCallback) {
            return window.setTimeout(cb as unknown as TimerHandler, 1000 / 60) as unknown as number;
        };
})();

window.cancelAnimFrame = (function () {
    return window.cancelAnimationFrame || (window as any).mozCancelAnimationFrame;
})();

function animloop(): void {
    (global as any).animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop(): void {
    if (!global.gameStart) return;
    graph.fillStyle = global.backgroundColor;
    graph.fillRect(0, 0, global.screen.width, global.screen.height);

    render.drawGrid(global, player, global.screen, graph);
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
    fireFood.forEach(ff => {
        const position = getPosition(ff, player, global.screen);
        render.drawFireFood(position, ff, playerConfig, graph);
    });
    viruses.forEach(virus => {
        const position = getPosition(virus, player, global.screen);
        render.drawVirus(position, virus, graph);
    });

    if (global.borderDraw) {
        render.drawBorder(arenaBorders, global.borderColor, graph);
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
    cellsToDraw.sort((a, b) => a.mass - b.mass);
    render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, arenaBorders, graph);

    socket.emit('0', window.canvas.target);
}

animloop();

window.addEventListener('resize', resize);
function resize(): void {
    player.screenWidth = c.width = global.screen.width = window.innerWidth;
    player.screenHeight = c.height = global.screen.height = window.innerHeight;
    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}
