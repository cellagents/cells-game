// Spectator mode. Full-map view for projector + side overlay with
// leaderboard. Chat is shown by default; disable with ?chat=off (also
// accepts 0/false/no).

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { fullMapCamera } from './thin/camera';
import { createViewport } from './thin/viewport';
import { attachMinimap } from './thin/minimap';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const game = connect({ gameServerUrl: resolveGameServer(), data: 'full' });

function leaveToLobby(): void {
    try { game.disconnect(); } catch { /* ignore */ }
    setTimeout(() => { window.location.href = '/'; }, 0);
}

void createViewport({
    view: 'spectator',
    game,
    renderer,
    onLeave: leaveToLobby,
    chat: chatEnabled() ? { chat: true, system: true, join: true, leave: true, death: true } : null,
    chatConfig: { maxLines: 50 },
    leaderboardEl: document.getElementById('leaderboard')
});

attachMinimap({ game });

function chatEnabled(): boolean {
    const raw = new URLSearchParams(window.location.search).get('chat');
    if (raw === null) return true;
    return !['off', '0', 'false', 'no'].includes(raw.toLowerCase());
}

function loop(): void {
    if (!document.hidden && game.snapshot) {
        renderer.resize();
        renderer.draw(game.snapshot, fullMapCamera(canvas, game.world));
    }
    requestAnimationFrame(loop);
}
loop();
