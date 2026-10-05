// Follow mode. Renders exactly what the followed player sees
// (data=viewport). Camera centers on the followed self with a modest zoom.

import { Renderer } from './thin/renderer';
import { connect, resolveGameServer } from './thin/connect';
import { followCamera } from './thin/camera';

const params = new URLSearchParams(window.location.search);
const followId = params.get('player');
if (!followId) {
    document.body.innerHTML = '<p style="color:#fff;font-family:sans-serif;padding:20px">follow mode requires ?player=&lt;player_id&gt;</p>';
    throw new Error('missing player param');
}

const canvas = document.getElementById('cvs') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const info = document.getElementById('info');

const game = connect({ gameServerUrl: resolveGameServer(), data: 'viewport', follow: followId });

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
