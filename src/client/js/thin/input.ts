// Mouse / touch / keyboard input for the player canvas. Translates
// pointer position into a server-relative target vector and the
// keyboard commands (W to eject, SPACE to split) into the connector's
// sendFireFood / sendSplit calls. Lives in the thin stack so a future
// viewport can opt into controls (e.g. a demo mode) without
// re-implementing it.
//
// Direction keys (arrow keys) override the mouse: while any arrow is
// held the target is pinned to a cardinal direction, same semantics as
// the legacy client. On key release the target returns to following
// the pointer.

import type { GameHandle } from './connect';

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_DOWN = 40;
const KEY_SPACE = 32;
const KEY_W = 87;
const KEY_W_LOWER = 119;

export interface InputOptions {
    canvas: HTMLCanvasElement;
    game: GameHandle;
    /** Called when the user presses Enter so the host can focus the
     *  chat input. Optional. */
    onChatFocus?: () => void;
    /** Called when a direction/pointer target is updated. The host
     *  may use this to drive a prediction overlay. Optional. */
    onTargetChange?: (target: { x: number; y: number }) => void;
}

export interface InputHandle {
    /** Current target vector in canvas-relative coordinates. */
    target: { x: number; y: number };
    /** Resend target this frame regardless of change (used by the
     *  per-tick loop so the server treats us as alive). */
    reheartbeat(): void;
    /** Detach all listeners. */
    destroy(): void;
}

export function attachInput(opts: InputOptions): InputHandle {
    const { canvas, game, onChatFocus, onTargetChange } = opts;
    const target = { x: 0, y: 0 };
    let directions: number[] = [];
    let directionLock = false;
    let reenviar = true;

    function updateTargetFromDirections(): void {
        let dx = 0, dy = 0;
        for (const d of directions) {
            if (dx === 0) {
                if (d === KEY_LEFT) dx = -Number.MAX_VALUE;
                else if (d === KEY_RIGHT) dx = Number.MAX_VALUE;
            }
            if (dy === 0) {
                if (d === KEY_UP) dy = -Number.MAX_VALUE;
                else if (d === KEY_DOWN) dy = Number.MAX_VALUE;
            }
        }
        target.x = dx;
        target.y = dy;
        if (onTargetChange) onTargetChange(target);
    }

    function isDirectional(key: number): boolean {
        return key === KEY_LEFT || key === KEY_RIGHT || key === KEY_UP || key === KEY_DOWN;
    }

    function pushDirection(key: number): boolean {
        if (directions.indexOf(key) !== -1) return false;
        directions.push(key);
        return true;
    }

    function popDirection(key: number): boolean {
        const i = directions.indexOf(key);
        if (i === -1) return false;
        directions.splice(i, 1);
        return true;
    }

    function onMouseMove(ev: MouseEvent): void {
        if (directionLock) return;
        target.x = ev.clientX - canvas.width / 2;
        target.y = ev.clientY - canvas.height / 2;
        if (onTargetChange) onTargetChange(target);
    }

    function onMouseOut(): void {
        if (directionLock) return;
        target.x = 0;
        target.y = 0;
        if (onTargetChange) onTargetChange(target);
    }

    function onTouch(ev: TouchEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        if (directionLock) return;
        const t = ev.touches[0];
        target.x = t.clientX - canvas.width / 2;
        target.y = t.clientY - canvas.height / 2;
        if (onTargetChange) onTargetChange(target);
    }

    function onKeyDown(ev: KeyboardEvent): void {
        const key = ev.which || ev.keyCode;
        if (isDirectional(key)) {
            directionLock = true;
            if (pushDirection(key)) updateTargetFromDirections();
        }
    }

    function onKeyUp(ev: KeyboardEvent): void {
        reenviar = true;
        const key = ev.which || ev.keyCode;
        if (isDirectional(key)) {
            if (popDirection(key)) {
                updateTargetFromDirections();
                if (directions.length === 0) directionLock = false;
            }
        }
    }

    function onKeyPress(ev: KeyboardEvent): void {
        const key = ev.which || ev.keyCode;
        if ((key === KEY_W || key === KEY_W_LOWER) && reenviar) {
            game.sendFireFood();
            reenviar = false;
        } else if (key === KEY_SPACE && reenviar) {
            try { (document.getElementById('split-cell') as HTMLAudioElement | null)?.play(); } catch { /* audio play may fail without user gesture */ }
            game.sendSplit();
            reenviar = false;
        } else if (key === 13 /* Enter */ && onChatFocus) {
            onChatFocus();
        }
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseout', onMouseOut);
    canvas.addEventListener('touchstart', onTouch);
    canvas.addEventListener('touchmove', onTouch);
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('keypress', onKeyPress);

    return {
        target,
        reheartbeat(): void { game.sendTarget(target); },
        destroy(): void {
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('mouseout', onMouseOut);
            canvas.removeEventListener('touchstart', onTouch);
            canvas.removeEventListener('touchmove', onTouch);
            canvas.removeEventListener('keydown', onKeyDown);
            canvas.removeEventListener('keyup', onKeyUp);
            canvas.removeEventListener('keypress', onKeyPress);
        }
    };
}
