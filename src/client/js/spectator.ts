// Spectator mode. Full-map view for projector + side overlay with
// leaderboard. Chat is shown by default; disable with ?chat=off (also
// accepts 0/false/no).

import { Renderer, RendererPalette } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { fullMapCamera } from './thin/camera';
import { createChat } from './chat/chat';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, canvasColorsFor } from './theme';

function paletteFor(theme: 'light' | 'dark'): RendererPalette {
    const c = canvasColorsFor(theme);
    return { background: c.background, boundary: c.border };
}

applyTheme(currentTheme());
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) attachThemeToggle(themeBtn);

// Managed mode: embedded in a parent surface (harness panel) that
// owns navigation. The × exit button and the ESC-to-exit handler
// both go away so the student can't accidentally yank the viewport
// out from under the harness.
const managed = isManaged();
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

function isManaged(): boolean {
    const raw = new URLSearchParams(window.location.search).get('managed');
    if (raw === null) return false;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const canvas = document.getElementById('cvs') as HTMLCanvasElement;
const renderer = new Renderer(canvas, paletteFor(currentTheme()));
onThemeChange((t) => renderer.setPalette(paletteFor(t)));
const leaderboardEl = document.getElementById('leaderboard') as HTMLElement;

const game = connect({ gameServerUrl: resolveGameServer(), data: 'full' });

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
    const raw = new URLSearchParams(window.location.search).get('chat');
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
game.on('leaderboard', (lb) => renderLeaderboard(lb as Array<{ name: string | null }>));

function renderLeaderboard(lb: Array<{ name: string | null }>): void {
    leaderboardEl.innerHTML = '<div class="title">Leaderboard</div>' + lb.slice(0, 10)
        .map((p, i) => `<div>${i + 1}. ${escapeHtml(p.name || '-')}</div>`).join('');
}

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

function loop(): void {
    if (game.snapshot) {
        renderer.resize();
        const cam = fullMapCamera(canvas, game.world);
        renderer.draw(game.snapshot, cam);
    }
    requestAnimationFrame(loop);
}
loop();
