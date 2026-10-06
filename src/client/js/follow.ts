// Follow mode. Renders exactly what the followed player sees
// (data=viewport). Camera centers on the followed self with a modest
// zoom. Chat is shown by default; disable with ?chat=off (also accepts
// 0/false/no).
//
// For the embedded-iframe harness surface, use /managed instead:
// it shares this stack but with chrome locked off via config.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { followCamera } from './thin/camera';
import { createViewport } from './thin/viewport';
import { attachMinimap } from './thin/minimap';

const params = new URLSearchParams(window.location.search);
const followId = params.get('player');

// Without a target to follow there's nothing to render; bounce to
// /spectator so the user sees the whole game instead of a dead page.
if (!followId) {
    window.location.href = '/spectator';
    throw new Error('redirecting: no ?player= on /follow');
}

const canvas = document.getElementById('cvs') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const info = document.getElementById('info');

const game = connect({ gameServerUrl: resolveGameServer(), data: 'viewport', follow: followId });

function leaveToLobby(): void {
    try { game.disconnect(); } catch { /* ignore */ }
    setTimeout(() => { window.location.href = '/'; }, 0);
}

void createViewport({
    view: 'follow',
    game,
    renderer,
    onLeave: leaveToLobby,
    chat: chatEnabled() ? { chat: true, system: true, join: true, leave: true, death: true } : null,
    chatConfig: { maxLines: 50 },
    leaderboardEl: document.getElementById('leaderboard')
});

attachMinimap({ game });

// Grace window: if the server hasn't emitted a snapshot whose self.id
// matches our followId within the last GRACE_MS, treat the target as
// gone and redirect to /spectator so the user sees the whole game
// instead of a stale frame.
const GRACE_MS = 3000;
let lastMatchAt = Date.now();
let connected = false;
game.on('connect', () => { lastMatchAt = Date.now(); connected = true; });
game.on('disconnect', () => { connected = false; });
game.on('snapshot', (snap: any) => {
    if (snap && snap.self && snap.self.id === followId) lastMatchAt = Date.now();
});
const graceCheck = window.setInterval(() => {
    if (connected && Date.now() - lastMatchAt > GRACE_MS) {
        window.clearInterval(graceCheck);
        window.location.href = '/spectator';
    }
}, 500);

function chatEnabled(): boolean {
    const raw = params.get('chat');
    if (raw === null) return true;
    return !['off', '0', 'false', 'no'].includes(raw.toLowerCase());
}

function loop(): void {
    if (!document.hidden && game.snapshot) {
        renderer.resize();
        const target = game.snapshot.self && game.snapshot.self.cells && game.snapshot.self.cells.length > 0
            ? game.snapshot.self
            : null;
        renderer.draw(game.snapshot, followCamera(target, canvas, game.world, 1.5));
        if (info) {
            const mass = game.snapshot.self?.massTotal ?? 0;
            info.textContent = `following ${followId!.slice(0, 8)} · mass ${Math.round(mass)}`;
        }
    }
    requestAnimationFrame(loop);
}
loop();
