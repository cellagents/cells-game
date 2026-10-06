// Minimap: a small top-left canvas showing the whole world. Reuses the
// same Renderer and fullMapCamera the spectator view uses, so the
// minimap stays visually consistent with the rest of the game chrome
// (same palette, same food/virus/player colors, same cell outlines).
//
// Mounted via the <canvas id="minimap"> element in the viewport HTML
// and controlled by the #minimapToggle floating button; toggled with
// the body.minimap-hidden class and defaulted off on narrow viewports.

import { Renderer } from './renderer';
import type { GameHandle } from './connect';
import { fullMapCamera } from './camera';
import { currentTheme, onThemeChange, rendererPaletteFor } from '../theme';

const MOBILE_MAX_WIDTH = 800;

export interface MinimapOptions {
    /** Game connector shared with the main viewport. We read snapshot /
     *  world off it and don't subscribe to any new socket events. */
    game: GameHandle;
    /** Optional id of the canvas element. Defaults to 'minimap'. */
    canvasId?: string;
    /** Optional id of the toggle button. Defaults to 'minimapToggle'. */
    toggleId?: string;
}

export function attachMinimap(opts: MinimapOptions): void {
    const canvas = document.getElementById(opts.canvasId ?? 'minimap') as HTMLCanvasElement | null;
    const toggle = document.getElementById(opts.toggleId ?? 'minimapToggle');
    if (!canvas) return;

    // Default-hide on narrow viewports so the minimap doesn't fight the
    // chat overlay for screen real estate on phones.
    if (window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches) {
        document.body.classList.add('minimap-hidden');
    }
    if (toggle) {
        toggle.addEventListener('click', () => {
            document.body.classList.toggle('minimap-hidden');
        });
    }

    const renderer = new Renderer(canvas, rendererPaletteFor(currentTheme()));
    onThemeChange((t) => renderer.setPalette(rendererPaletteFor(t)));

    // The minimap uses the game's world size (updated via the main
    // viewport subscription on 'world'). We mirror from game.world on
    // each draw so a race on load doesn't leave us at the default.
    function loop(): void {
        if (!document.hidden
            && !document.body.classList.contains('minimap-hidden')
            && opts.game.snapshot) {
            renderer.world = opts.game.world;
            renderer.resize();
            renderer.draw(opts.game.snapshot, fullMapCamera(canvas!, opts.game.world), {
                // No decor on the minimap; it should read at a glance.
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
