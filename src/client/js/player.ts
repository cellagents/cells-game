// Active-player viewport. Reads ?name=X from the URL and auto-starts
// a Socket.IO session as a player. Shares the Renderer, StatusOverlay,
// chat widget and chrome helpers with /spectator and /follow; only
// the camera (follow-self at zoom 1), the input module and the chat
// command set are specific to this view.
//
// Exit button and ESC navigate back to the lobby at /, which tears
// everything down the browser way.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { followCamera } from './thin/camera';
import { attachInput } from './thin/input';
import { attachMinimap } from './thin/minimap';
import { createViewport } from './thin/viewport';
import { applyTheme, cycleTheme } from './theme';

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
const renderer = new Renderer(canvas);

// User-adjustable render switches controlled by chat commands.
const settings = { showBorder: false, showMass: false };

const game = connect({
    gameServerUrl: resolveGameServer(),
    role: 'player',
    playerName
});

function leaveToLobby(): void {
    setTimeout(() => { window.location.href = '/'; }, 0);
    try { game.disconnect(); } catch { /* ignore */ }
}

// Chat command set. Toggles the local render switches / theme and
// surfaces latency over the chat log. Keyed by name so new commands
// are just a one-liner.
interface Command { description: string; run: () => void }
const commands: Record<string, Command> = {
    ping: { description: 'Check your latency.', run: () => game.sendPing() },
    dark: {
        description: 'Toggle dark mode.',
        run: () => {
            const next = cycleTheme();
            applyTheme(next);
            vp.chat?.addSystem(next === 'dark' ? 'Dark mode enabled.' : 'Dark mode disabled.');
        }
    },
    border: {
        description: 'Toggle the arena border.',
        run: () => {
            settings.showBorder = !settings.showBorder;
            vp.chat?.addSystem(settings.showBorder ? 'Showing border.' : 'Hiding border.');
        }
    },
    mass: {
        description: 'Toggle mass numbers on cells.',
        run: () => {
            settings.showMass = !settings.showMass;
            vp.chat?.addSystem(settings.showMass ? 'Showing mass.' : 'Hiding mass.');
        }
    },
    help: {
        description: 'List the chat commands.',
        run: () => {
            for (const name of Object.keys(commands)) {
                vp.chat?.addSystem(`-${name}: ${commands[name].description}`);
            }
        }
    }
};

const vp = createViewport({
    game,
    renderer,
    onLeave: leaveToLobby,
    chat: { chat: true, system: true, join: true, leave: true, death: true },
    chatConfig: {
        selfName: playerName,
        maxLines: 10,
        enableInput: true,
        inputPlaceholder: 'Chat here...',
        onSendMessage: (text) => {
            if (text.startsWith('-')) {
                const parts = text.substring(1).split(' ');
                const cmd = commands[parts[0]];
                if (cmd) cmd.run();
                else vp.chat?.addSystem(`Unrecognized command: ${text}, type -help for the list.`);
                return;
            }
            game.sendChat(playerName, text);
            vp.chat?.addChat(playerName, text);
        }
    },
    leaderboardEl: document.getElementById('status'),
    highlightId: () => game.selfId
});

if (vp.chat?.input) {
    vp.chat.input.addEventListener('keyup', (ev) => {
        if ((ev as KeyboardEvent).key === 'Escape') {
            vp.chat!.input!.value = '';
            canvas.focus();
        }
    });
}

// Mobile touch controls. Visible on coarse pointers via CSS; harmless
// on desktop because the keyboard shortcuts cover the same actions.
document.getElementById('feed')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    game.sendFireFood();
});
document.getElementById('split')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    game.sendSplit();
});

// Resize: tell the server our new window size (keeps viewport culling
// accurate) and reset the canvas CSS dims so the next renderer.resize()
// picks up the new client box.
function onResize(): void {
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    game.sendWindowResized(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

game.on('connect', () => {
    vp.chat?.addSystem('Connected to the game!');
    vp.chat?.addSystem('Type <b>-help</b> for a list of commands.');
});

// Welcome: server sent us our canonical player row (id, hue, name...).
// Immediately request a respawn so the server places us into the world.
game.on('welcome', () => {
    game.sendRespawn();
    canvas.focus();
});

game.on('kick', (payload) => {
    const reason = payload as string;
    vp.overlay.show(reason ? `You were kicked: ${reason}` : 'You were kicked.', true);
});

game.on('died', () => {
    vp.overlay.show('You died.', true);
    // Keep the user on the page briefly so the message is readable,
    // then bounce back to the lobby for a clean restart. vp.leave()
    // is idempotent so clicking exit sooner is fine.
    window.setTimeout(() => vp.leave(), 2500);
});

game.on('pong', (ms) => vp.chat?.addSystem(`Ping: ${ms as number}ms`));

const input = attachInput({
    canvas,
    game,
    onChatFocus: () => vp.chat?.input?.focus()
});

attachMinimap({ game });

function loop(): void {
    if (!document.hidden && game.snapshot) {
        renderer.resize();
        const self = game.snapshot.self;
        const target = self ? { x: self.x, y: self.y } : null;
        renderer.draw(game.snapshot, followCamera(target, canvas, game.world, 1), {
            grid: true,
            outsideArena: true,
            border: settings.showBorder,
            showMass: settings.showMass,
            foodHues: true,
            labels: true
        });
        input.reheartbeat();
    }
    requestAnimationFrame(loop);
}
loop();
