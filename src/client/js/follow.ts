// Follow mode. Renders exactly what the followed player sees
// (data=viewport). Camera centers on the followed self with a modest
// zoom. Chat is shown by default; disable with ?chat=off (also accepts
// 0/false/no).

import { Renderer, RendererPalette } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { followCamera } from './thin/camera';
import { createChat } from './chat/chat';
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
if (!followId) {
    document.body.innerHTML = '<p style="color:#fff;font-family:sans-serif;padding:20px">follow mode requires ?player=&lt;player_id&gt;</p>';
    throw new Error('missing player param');
}

// Managed mode: embedded in a parent surface (harness panel) that
// owns navigation. The × exit button and the ESC-to-exit handler
// both go away so the student can't accidentally yank the viewport
// out from under the harness.
const managedRaw = params.get('managed');
const managed = managedRaw !== null && ['1', 'true', 'yes', 'on'].includes(managedRaw.toLowerCase());
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
