// Active-player viewport. Reads ?name=X from the URL and auto-starts
// a Socket.IO session as a player. Shares the same Renderer, Camera,
// StatusOverlay, chat widget and chrome helpers as /spectator and
// /follow; only the camera (follow-self at zoom 1) and the input
// hookup are specific to this view.
//
// Exit button and ESC navigate back to the lobby at /, which tears
// everything down the browser way.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer, DisconnectPayload } from './thin/connect';
import { followCamera } from './thin/camera';
import { attachInput } from './thin/input';
import { StatusOverlay } from './thin/overlay';
import { createChat, ChatHandle } from './chat/chat';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, rendererPaletteFor, cycleTheme } from './theme';
import { attachLeaderboardToggle } from './leaderboard-toggle';

applyTheme(currentTheme());
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) attachThemeToggle(themeBtn);

// Nickname validation. Lobby already enforces this, so a direct hit on
// /player without a name is treated as "go back to the lobby".
const params = new URLSearchParams(window.location.search);
const rawName = params.get('name');
if (!rawName || !/^\w+$/.test(rawName)) {
    window.location.href = '/';
    throw new Error('missing or invalid ?name= param; redirecting to lobby');
}
const playerName = rawName.substring(0, 25);

const canvas = document.getElementById('cvs') as HTMLCanvasElement;
const renderer = new Renderer(canvas, rendererPaletteFor(currentTheme()));
onThemeChange((t) => renderer.setPalette(rendererPaletteFor(t)));

// User-adjustable render switches controlled by chat commands. Kept
// local; nothing persists across reloads.
const settings = {
    showBorder: false,
    showMass: false
};

const game = connect({
    gameServerUrl: resolveGameServer(),
    role: 'player',
    playerName
});

// Status overlay drives connection + death feedback. Shows connecting
// at load; reconnecting on transport drops; a terminal message on
// server kick or RIP (with a return-to-lobby button).
const overlay = new StatusOverlay({ showExit: true });
overlay.show('Connecting to server...');

let leaving = false;
function leaveToLobby(): void {
    leaving = true;
    setTimeout(() => { window.location.href = '/'; }, 0);
    try { game.disconnect(); } catch { /* ignore */ }
}

const exitBtn = document.getElementById('exitToMenu');
if (exitBtn) exitBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    leaveToLobby();
});

// ESC returns to the lobby. Skip when the user is typing in a text
// field so chat input ESC can clear it instead.
window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    const t = ev.target as HTMLElement | null;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    leaveToLobby();
});

const chatBtn = document.getElementById('chatToggle');
if (chatBtn) chatBtn.addEventListener('click', () => {
    document.body.classList.toggle('chat-hidden');
});
attachLeaderboardToggle();

// Mobile touch controls. The buttons are only visible on coarse
// pointers (phones/tablets) via CSS; the clicks still work on desktop
// if the elements are hovered but are harmless because the keyboard
// shortcuts exist for the same actions.
document.getElementById('feed')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    game.sendFireFood();
});
document.getElementById('split')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    game.sendSplit();
});

// Resize handling: tell the server our new window size so viewport
// culling stays accurate, and reset the canvas CSS size so the next
// renderer.resize() picks up the new client dimensions.
function onResize(): void {
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    game.sendWindowResized(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

// Chat. The shared widget handles the socket subscriptions; local
// commands (leading dash) are intercepted here and never leave the
// client.
interface Command { description: string; run: (args: string[]) => void }
const commands: Record<string, Command> = {
    ping: { description: 'Check your latency.', run: () => game.sendPing() },
    dark: {
        description: 'Toggle dark mode.',
        run: () => {
            const next = cycleTheme();
            applyTheme(next);
            chat?.addSystem(next === 'dark' ? 'Dark mode enabled.' : 'Dark mode disabled.');
        }
    },
    border: {
        description: 'Toggle the arena border.',
        run: () => {
            settings.showBorder = !settings.showBorder;
            chat?.addSystem(settings.showBorder ? 'Showing border.' : 'Hiding border.');
        }
    },
    mass: {
        description: 'Toggle mass numbers on cells.',
        run: () => {
            settings.showMass = !settings.showMass;
            chat?.addSystem(settings.showMass ? 'Showing mass.' : 'Hiding mass.');
        }
    },
    help: {
        description: 'List the chat commands.',
        run: () => {
            for (const name of Object.keys(commands)) {
                chat?.addSystem(`-${name}: ${commands[name].description}`);
            }
        }
    }
};

let chat: ChatHandle | null = null;
// Chat is suppressed on mobile viewports via CSS (the chatbox is
// hidden and the toggle button is hidden too), but we still mount
// the module so system messages have somewhere to go that we can
// surface later if the user widens the window.
const chatContainer = document.getElementById('chatbox') as HTMLElement | null;
if (chatContainer) {
    chat = createChat({
        container: chatContainer,
        socket: game.socket,
        events: { chat: true, system: true, join: true, leave: true, death: true },
        selfName: playerName,
        maxLines: 10,
        enableInput: true,
        inputPlaceholder: 'Chat here...',
        onSendMessage: (text) => {
            if (text.startsWith('-')) {
                const parts = text.substring(1).split(' ');
                const cmd = commands[parts[0]];
                if (cmd) {
                    cmd.run(parts.slice(1));
                } else {
                    chat?.addSystem(`Unrecognized command: ${text}, type -help for the list.`);
                }
                return;
            }
            game.sendChat(playerName, text);
            chat?.addChat(playerName, text);
        }
    });
    if (chat.input) {
        chat.input.addEventListener('keyup', (ev) => {
            if ((ev as KeyboardEvent).key === 'Escape') {
                chat!.input!.value = '';
                canvas.focus();
            }
        });
    }
}

game.on('connect', () => {
    overlay.hide();
    chat?.addSystem('Connected to the game!');
    chat?.addSystem('Type <b>-help</b> for a list of commands.');
});
game.on('disconnect', (payload) => {
    if (leaving) return;
    const d = payload as DisconnectPayload;
    if (d.deliberate) {
        overlay.show(`Session ended: ${d.reason}`, true);
    } else {
        overlay.show('Reconnecting to server...');
    }
});

// Welcome: server sent us our canonical player row (id, hue, name...).
// Immediately request a respawn so the server places us into the world.
game.on('welcome', () => {
    game.sendRespawn();
    canvas.focus();
});

game.on('world', (world) => renderer.setWorld(world as { width: number; height: number }));

game.on('kick', (payload) => {
    const reason = payload as string;
    overlay.show(reason ? `You were kicked: ${reason}` : 'You were kicked.', true);
});

game.on('died', () => {
    overlay.show('You died.', true);
    // Keep the user on the page briefly so the message is readable, then
    // bounce back to the lobby for a clean restart (matches 2.x behaviour).
    window.setTimeout(() => { if (!leaving) leaveToLobby(); }, 2500);
});

game.on('pong', (ms) => chat?.addSystem(`Ping: ${ms as number}ms`));

// Leaderboard renders into #status to match the pre-port markup.
const leaderboardEl = document.getElementById('status') as HTMLElement | null;
game.on('leaderboard', (lb) => {
    const rows = lb as Array<{ id: string; name: string | null }>;
    if (!leaderboardEl) return;
    let html = '<span class="title">Leaderboard</span>';
    for (let i = 0; i < rows.length; i++) {
        const name = rows[i].name;
        const label = name && name.length > 0 ? name : 'An unnamed cell';
        const safe = escapeHtml(label);
        if (rows[i].id === game.selfId) {
            html += `<br /><span class="me">${i + 1}. ${safe}</span>`;
        } else {
            html += `<br />${i + 1}. ${safe}`;
        }
    }
    leaderboardEl.innerHTML = html;
});

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

// Input module. The canvas is tab-focusable and will handle its own
// mouse/touch/keyboard; direction keys override the pointer. Enter
// focuses the chat input so the user can type without reaching for
// the mouse.
const input = attachInput({
    canvas,
    game,
    onChatFocus: () => chat?.input?.focus()
});

function loop(): void {
    // Skip paint while hidden: the connector coalesces incoming state
    // and the first paint on return will be fresh.
    if (!document.hidden && game.snapshot) {
        renderer.resize();
        // Camera follows self at unit scale. The snapshot's self row is
        // the server's canonical view of our player (position after
        // the latest tick); using it directly keeps the view glued
        // under the cursor regardless of which cells happen to be in
        // the players array this frame.
        const self = game.snapshot.self;
        const target = self ? { x: self.x, y: self.y } : null;
        const cam = followCamera(target, canvas, game.world, 1);
        renderer.draw(game.snapshot, cam, {
            grid: true,
            outsideArena: true,
            border: settings.showBorder,
            showMass: settings.showMass,
            foodHues: true,
            labels: true
        });
        // Send our target vector every tick, acting as both input and
        // heartbeat; the server kicks sockets that go silent.
        input.reheartbeat();
    }
    requestAnimationFrame(loop);
}

loop();
