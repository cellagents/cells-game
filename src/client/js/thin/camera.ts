// Camera helpers. fullMapCamera fits the entire world into the canvas;
// followCamera centers on a world point with a fixed zoom.

export interface Camera { x: number; y: number; scale: number; }
export interface WorldSize { width: number; height: number; }

export function fullMapCamera(canvas: HTMLCanvasElement, world: WorldSize): Camera {
    const sx = canvas.width / world.width;
    const sy = canvas.height / world.height;
    const scale = Math.min(sx, sy) * 0.95;
    return { x: world.width / 2, y: world.height / 2, scale };
}

export function followCamera(target: { x: number; y: number } | null, canvas: HTMLCanvasElement, world: WorldSize, zoom = 1): Camera {
    if (!target) return fullMapCamera(canvas, world);
    return { x: target.x, y: target.y, scale: zoom };
}
