// Follow mode. Renders exactly what the followed player sees
// (data=viewport). Camera centers on the followed self with a modest
// zoom. Chat is shown by default; disable with ?chat=off (also accepts
// 0/false/no).

import { Renderer, RendererPalette } from './thin/renderer';
import { connect, resolveGameServer, DisconnectPayload } from './thin/connect';
import { followCamera } from './thin/camera';
import { createChat } from './chat/chat';
import { StatusOverlay } from './thin/overlay';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, canvasColorsFor } from './theme';

function paletteFor(theme: 'light' | 'dark'): RendererPalette {
    const c = canvasColorsFor(theme);
    return { background: c.background, boundary: c.border };
}

applyTheme(currentTheme());
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) attachThemeToggle(themeBtn);

const params = new URLSearchParams(window.location.search);
const followId = params.get('player');
const managedRaw = params.get('managed');
const managed = managedRaw !== null && ['1', 'true', 'yes', 'on'].includes(managedRaw.toLowerCase());

// If there is no player to follow we cannot do anything useful here;
// go to /spectator and preserve the managed flag so an embedding
// surface (harness iframe) still shows a sensible full-map view.
if (!followId) {
    window.location.href = managed ? '/spectator?managed=1' : '/spectator';
    throw new Error('redirecting: no ?player= on /follow');
}

// Managed mode: embedded in a parent surface (harness panel) that
// owns navigation. The × exit button and the ESC-to-exit handler
// both go away so the student can't accidentally yank the viewport
// out from under the harness. The harness also owns the "player
// gone" response - we just keep rendering whatever snapshots the
// server sends (which falls back to full-map when the target is
// gone), and the harness swaps our iframe src when it decides.
if (managed) {
    const exitEl = document.getElementById('exitToMenu');
    if (exitEl) exitEl.hidden = true;
} else {
    window.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return;
        const t = ev.target as HTMLElement | null;
        const tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        window.location.href = '/';
    });
}

const canvas = document.getElementById('cvs') as HTMLCanvasElement;
const renderer = new Renderer(canvas, paletteFor(currentTheme()));
onThemeChange((t) => renderer.setPalette(paletteFor(t)));
const info = document.getElementById('info');

const game = connect({ gameServerUrl: resolveGameServer(), data: 'viewport', follow: followId });

// Status overlay for connection state.
const overlay = new StatusOverlay({ showExit: !managed });
overlay.show('Connecting to server...');
game.on('connect', () => overlay.hide());
game.on('disconnect', (payload) => {
    const d = payload as DisconnectPayload;
    if (d.deliberate) {
        overlay.show(`Session ended: ${d.reason}`, true);
    } else {
        overlay.show('Reconnecting to server...');
    }
});

// Non-managed grace window: if the server has not emitted a snapshot
// whose self.id matches our followId within the last GRACE_MS,
// treat the target as gone and redirect to /spectator so the user
// sees the whole game instead of a stale frame or a confusing
// full-map fallback. Covers:
//   - bad id in URL (never matched at all)
//   - target joined but hasn't moved yet (short delay before first
//     matching snapshot - 3s is well above typical join latency)
//   - target left mid-session (matched then stopped matching)
// Managed mode leaves all of this to the parent surface (harness).
const GRACE_MS = 3000;
let lastMatchAt = Date.now();
let connected = false;
game.on('connect', () => {
    // Reset the grace clock whenever we reconnect so a long disconnect
    // doesn't instantly fire the redirect once the socket comes back.
    lastMatchAt = Date.now();
    connected = true;
});
game.on('disconnect', () => { connected = false; });
game.on('snapshot', (snap: any) => {
    if (snap && snap.self && snap.self.id === followId) {
        lastMatchAt = Date.now();
    }
});
if (!managed) {
    const graceCheck = window.setInterval(() => {
        // Only count time spent connected: being disconnected is the
        // overlay's job, not the follow-redirect's.
        if (connected && Date.now() - lastMatchAt > GRACE_MS) {
            window.clearInterval(graceCheck);
            window.location.href = '/spectator';
        }
    }, 500);
}

if (chatEnabled()) {
    mountChat();
    const chatBtn = document.getElementById('chatToggle') as HTMLButtonElement | null;
    if (chatBtn) {
        chatBtn.hidden = false;
        chatBtn.addEventListener('click', () => {
            document.body.classList.toggle('chat-hidden');
        });
    }
}

function chatEnabled(): boolean {
    const raw = params.get('chat');
    if (raw === null) return true;
    return !['off', '0', 'false', 'no'].includes(raw.toLowerCase());
}

function mountChat(): void {
    const container = document.getElementById('chatbox') as HTMLElement;
    if (!container) return;
    createChat({
        container,
        socket: game.socket,
        events: { chat: true, system: true, join: true, leave: true, death: true },
        maxLines: 50
    });
}

game.on('world', (world) => renderer.setWorld(world as { width: number; height: number }));

function loop(): void {
    if (game.snapshot) {
        renderer.resize();
        const target = game.snapshot.self && game.snapshot.self.cells && game.snapshot.self.cells.length > 0
            ? game.snapshot.self
            : null;
        const cam = followCamera(target, canvas, game.world, 1.5);
        renderer.draw(game.snapshot, cam);
        if (info) {
            const mass = game.snapshot.self?.massTotal ?? 0;
            info.textContent = `following ${followId!.slice(0, 8)} · mass ${Math.round(mass)}`;
        }
    }
    requestAnimationFrame(loop);
}
loop();
