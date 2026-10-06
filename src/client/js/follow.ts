// Follow mode. Renders exactly what the followed player sees
// (data=viewport). Camera centers on the followed self with a modest
// zoom. Chat is shown by default; disable with ?chat=off (also accepts
// 0/false/no).

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { followCamera } from './thin/camera';
import { createViewport } from './thin/viewport';

const params = new URLSearchParams(window.location.search);
const followId = params.get('player');
const managedRaw = params.get('managed');
const managed = managedRaw !== null && ['1', 'true', 'yes', 'on'].includes(managedRaw.toLowerCase());

// Without a target to follow there's nothing to render; bounce to
// /spectator so an embedding surface (harness iframe) still shows a
// sensible full-map view.
if (!followId) {
    window.location.href = managed ? '/spectator?managed=1' : '/spectator';
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

createViewport({
    game,
    renderer,
    onLeave: leaveToLobby,
    chat: chatEnabled() ? { chat: true, system: true, join: true, leave: true, death: true } : null,
    chatConfig: { maxLines: 50 },
    leaderboardEl: document.getElementById('leaderboard')
});

// Non-managed grace window: if the server has not emitted a snapshot
// whose self.id matches our followId within the last GRACE_MS,
// treat the target as gone and redirect to /spectator so the user
// sees the whole game instead of a stale frame. Managed mode leaves
// this to the parent surface (harness).
const GRACE_MS = 3000;
let lastMatchAt = Date.now();
let connected = false;
game.on('connect', () => { lastMatchAt = Date.now(); connected = true; });
game.on('disconnect', () => { connected = false; });
game.on('snapshot', (snap: any) => {
    if (snap && snap.self && snap.self.id === followId) lastMatchAt = Date.now();
});
if (!managed) {
    const graceCheck = window.setInterval(() => {
        if (connected && Date.now() - lastMatchAt > GRACE_MS) {
            window.clearInterval(graceCheck);
            window.location.href = '/spectator';
        }
    }, 500);
}

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
