// Spectator mode. Full-map view for projector + side overlay with
// leaderboard.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { fullMapCamera } from './thin/camera';

const canvas = document.getElementById('cvs') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const leaderboardEl = document.getElementById('leaderboard') as HTMLElement;

const game = connect({ gameServerUrl: resolveGameServer(), data: 'full' });

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
