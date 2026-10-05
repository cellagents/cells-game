// Canvas renderer shared by spectator, follow and player modes. Draws cells,
// food, viruses and mass food from the serverTellPlayerMove payload shape.
// Keeps zero state beyond the canvas, the current theme palette, and the
// last snapshot handed in via draw(); mode-specific camera logic lives in
// the caller.

import type { Camera, WorldSize } from './camera';

const FOOD_RADIUS = 10;

export interface RendererPalette {
    /** Canvas background. */
    background: string;
    /** World-boundary stroke; also used as the arena-edge accent. */
    boundary: string;
    /** Food pellet fill. */
    food: string;
    /** Ejected-mass fill. */
    mass: string;
    /** Virus fill and stroke. */
    virus: string;
    virusStroke: string;
}

const DEFAULT_PALETTE: RendererPalette = {
    background: '#0f1419',
    boundary: '#4a85f0',
    food: '#9eff6a',
    mass: '#d6ff6a',
    virus: '#33ff33',
    virusStroke: '#19D119'
};

export interface Snapshot {
    self?: { id: string; x: number; y: number; massTotal: number; hue: number; cells: Array<{ x: number; y: number; radius: number }> } | null;
    players?: Array<{ id: string; name?: string | null; hue?: number; cells: Array<{ x: number; y: number; radius: number }> }>;
    food?: Array<{ x: number; y: number }>;
    mass?: Array<{ x: number; y: number; radius?: number }>;
    viruses?: Array<{ x: number; y: number; radius?: number }>;
}

export class Renderer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    world: WorldSize;
    palette: RendererPalette;

    constructor(canvas: HTMLCanvasElement, palette: RendererPalette = DEFAULT_PALETTE) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        this.world = { width: 5000, height: 5000 };
        this.palette = palette;
    }

    setPalette(palette: RendererPalette): void {
        this.palette = palette;
    }

    setWorld(size: WorldSize): void {
        this.world = size;
    }

    resize(): void {
        this.canvas.width = this.canvas.clientWidth || window.innerWidth;
        this.canvas.height = this.canvas.clientHeight || window.innerHeight;
    }

    // camera: {x,y,scale}. Everything in world coords is drawn at
    // (worldX - camX) * scale + canvas.width/2, same for Y.
    draw(snapshot: Snapshot, camera: Camera): void {
        const { ctx, canvas } = this;
        ctx.save();
        ctx.fillStyle = this.palette.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const toScreen = (x: number, y: number) => ({
            x: (x - camera.x) * camera.scale + canvas.width / 2,
            y: (y - camera.y) * camera.scale + canvas.height / 2
        });

        // World boundary
        ctx.strokeStyle = this.palette.boundary;
        ctx.lineWidth = 2;
        const tl = toScreen(0, 0);
        ctx.strokeRect(tl.x, tl.y, this.world.width * camera.scale, this.world.height * camera.scale);

        // Food
        ctx.fillStyle = this.palette.food;
        for (const f of snapshot.food || []) {
            const p = toScreen(f.x, f.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, FOOD_RADIUS * camera.scale * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Mass food (ejected mass)
        ctx.fillStyle = this.palette.mass;
        for (const m of snapshot.mass || []) {
            const p = toScreen(m.x, m.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, (m.radius || 10) * camera.scale, 0, Math.PI * 2);
            ctx.fill();
        }

        // Viruses
        ctx.fillStyle = this.palette.virus;
        ctx.strokeStyle = this.palette.virusStroke;
        for (const v of snapshot.viruses || []) {
            const p = toScreen(v.x, v.y);
            const r = (v.radius || 60) * camera.scale;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = Math.max(1, 4 * camera.scale);
            ctx.stroke();
        }

        // Players + highlight self (if provided)
        for (const player of snapshot.players || []) {
            const hue = player.hue ?? 0;
            const isSelf = !!(snapshot.self && player.id === snapshot.self.id);
            for (const cell of player.cells || []) {
                const p = toScreen(cell.x, cell.y);
                const r = cell.radius * camera.scale;
                ctx.fillStyle = `hsl(${hue},80%,55%)`;
                ctx.strokeStyle = isSelf ? '#ffffff' : `hsl(${hue},80%,35%)`;
                ctx.lineWidth = Math.max(1, (isSelf ? 3 : 2) * camera.scale);
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                if (r > 14) {
                    ctx.fillStyle = '#fff';
                    ctx.font = `${Math.max(10, 14 * camera.scale)}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(player.name || '', p.x, p.y);
                }
            }
        }

        ctx.restore();
    }
}
