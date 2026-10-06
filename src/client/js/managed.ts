// Managed viewport. Served at /managed for embedding inside the
// harness iframe. Camera semantics:
//   /managed              — spectator-equivalent, full-map camera
//   /managed?player=<id>  — follow-equivalent, follow-camera at 1.5x
//
// Chrome is deliberately minimal: by default (config.client.managed.ui)
// all five floating buttons are pruned and all widgets locked to
// hidden, so the embedding parent is in control. The read-only chat
// subscriber still runs so chat events are delivered to listeners
// that the harness might wire in later; the chat UI itself only
// appears if the operator overrides managed.ui.chat.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { fullMapCamera, followCamera } from './thin/camera';
import { createViewport } from './thin/viewport';
import { attachMinimap } from './thin/minimap';

const params = new URLSearchParams(window.location.search);
const followId = params.get('player');

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// Follow-camera uses the viewport-slice stream so the server doesn't
// ship entities the followed player can't see. Full-map uses the
// full stream so the whole arena renders.
const game = followId
    ? connect({ gameServerUrl: resolveGameServer(), data: 'viewport', follow: followId })
    : connect({ gameServerUrl: resolveGameServer(), data: 'full' });

// Grace redirect: if the followed id never produces a snapshot, fall
// back to full-map by stripping ?player= and reloading. Only applies
// when a follow target was requested in the first place.
if (followId) {
    const GRACE_MS = 3000;
    let lastMatchAt = Date.now();
    let connected = false;
    game.on('connect', () => { lastMatchAt = Date.now(); connected = true; });
    game.on('disconnect', () => { connected = false; });
    game.on('snapshot', (snap: unknown) => {
        const s = snap as { self?: { id?: string } } | null;
        if (s && s.self && s.self.id === followId) lastMatchAt = Date.now();
    });
    const graceCheck = window.setInterval(() => {
        if (connected && Date.now() - lastMatchAt > GRACE_MS) {
            window.clearInterval(graceCheck);
            window.location.href = '/managed';
        }
    }, 500);
}

void createViewport({
    view: 'managed',
    game,
    renderer,
    // No onLeave: managed views have no self-escape; the parent owns
    // navigation. StatusOverlay also drops its back-to-lobby link
    // because ui.exit.button is off.
    chat: { chat: true, system: true, join: true, leave: true, death: true },
    chatConfig: { maxLines: 50, enableInput: false },
    leaderboardEl: document.getElementById('leaderboard')
});

attachMinimap({ game });

function loop(): void {
    if (!document.hidden && game.snapshot) {
        renderer.resize();
        if (followId) {
            const target = game.snapshot.self && game.snapshot.self.cells && game.snapshot.self.cells.length > 0
                ? game.snapshot.self
                : null;
            renderer.draw(game.snapshot, followCamera(target, canvas, game.world, 1.5));
        } else {
            renderer.draw(game.snapshot, fullMapCamera(canvas, game.world));
        }
    }
    requestAnimationFrame(loop);
}
loop();
