// Minimap: a small top-left canvas showing the whole world. Reuses the
// same Renderer and fullMapCamera the spectator view uses, so the
// minimap stays visually consistent with the rest of the game chrome
// (same palette, same food/virus/player colors, same cell outlines).
//
// Mounted via the <canvas id="minimap"> element in the viewport HTML
// and controlled by the body.minimap-hidden class owned by the
// viewport chrome (createViewport prunes the toggle button and sets
// the initial visibility per config). This module just skips painting
// when the body class is on and wires the toggle button to flip it.

import { Renderer } from './renderer';
import type { GameHandle } from './connect';
import { fullMapCamera } from './camera';
import { currentTheme, onThemeChange, rendererPaletteFor } from '../theme';

export interface MinimapOptions {
    /** Game connector shared with the main viewport. We read snapshot /
     *  world off it and don't subscribe to any new socket events. */
    game: GameHandle;
    /** Optional id of the canvas element. Defaults to 'minimap'. */
    canvasId?: string;
    /** Optional id of the toggle button. Defaults to 'minimap-toggle'.
     *  If the viewport chrome pruned the button, no wiring happens. */
    toggleId?: string;
}

export function attachMinimap(opts: MinimapOptions): void {
    const canvas = document.getElementById(opts.canvasId ?? 'minimap') as HTMLCanvasElement | null;
    if (!canvas) return;

    const toggle = document.getElementById(opts.toggleId ?? 'minimap-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            document.body.classList.toggle('minimap-hidden');
        });
    }

    const renderer = new Renderer(canvas, rendererPaletteFor(currentTheme()));
    onThemeChange((t) => renderer.setPalette(rendererPaletteFor(t)));

    function loop(): void {
        if (!document.hidden
            && !document.body.classList.contains('minimap-hidden')
            && opts.game.snapshot) {
            renderer.world = opts.game.world;
            renderer.resize();
            renderer.draw(opts.game.snapshot, fullMapCamera(canvas!, opts.game.world), {
                grid: false,
                outsideArena: false,
                border: true,
                labels: false,
                showMass: false,
                foodHues: false
            });
        }
        requestAnimationFrame(loop);
    }
    loop();
}
