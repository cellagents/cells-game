// Spectator mode. Requests {omniscient, follow}: full-map view by
// default, with a view-toggle (follow a leaderboard pick) that
// swaps the camera via `setFollow` without reconnecting. Chat is
// shown by default; disable with ?chat=off.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { followCamera, fullMapCamera } from './thin/camera';
import { createViewport } from './thin/viewport';
import { attachMinimap } from './thin/minimap';
import { USER_AGENT } from './thin/userAgent';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// {omniscient, follow} gives the server the right to send full-map
// ticks AND to accept setFollow(target) to swap the camera. Follow
// starts null; the user picks a target later.
const game = connect({
    gameServerUrl: resolveGameServer(),
    userAgent: USER_AGENT,
    capabilities: ['omniscient', 'follow']
});

/** Current camera target id, or null for full-map. The spectator
 *  UI mutates this (e.g. via a leaderboard click handler) and
 *  calls game.sendSetFollow() to swap the server's cull. */
let followTarget: string | null = null;
(window as unknown as { spectatorSetFollow?: (id: string | null) => void }).spectatorSetFollow = (id) => {
    followTarget = id;
    game.sendSetFollow(id);
};

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
        if (followTarget && game.snapshot.self) {
            // Server already culled around the target; use its self
            // (= followed player's PlayerMeta) as the camera anchor.
            renderer.draw(
                game.snapshot,
                followCamera({ x: game.snapshot.self.x, y: game.snapshot.self.y }, canvas, game.world, 1.5)
            );
        } else {
            renderer.draw(game.snapshot, fullMapCamera(canvas, game.world));
        }
    }
    requestAnimationFrame(loop);
}
loop();
