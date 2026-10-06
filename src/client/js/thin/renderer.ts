// Canvas renderer shared by every viewport (player, spectator, follow,
// minimap). Draws from the serverTellPlayerMove payload shape against a
// Camera. Keeps zero state beyond the canvas, the current theme palette
// and the last snapshot handed in; mode-specific choices (which decor
// to include) are passed per draw call so a single Renderer instance
// can serve both a main viewport and a minimap.

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
    /** Grid lines inside the arena (player-mode decor). */
    grid: string;
    /** Shading applied outside the arena rectangle (player-mode decor). */
    outsideArena: string;
    /** Text and text-outline for cell labels. */
    labelText: string;
    labelOutline: string;
}

const DEFAULT_PALETTE: RendererPalette = {
    background: '#0f1419',
    boundary: '#4a85f0',
    food: '#9eff6a',
    mass: '#d6ff6a',
    virus: '#33ff33',
    virusStroke: '#19D119',
    grid: '#e6e8eb',
    outsideArena: 'rgba(0, 0, 0, 0.55)',
    labelText: '#ffffff',
    labelOutline: '#000000'
};

export interface Snapshot {
    self?: { id: string; x: number; y: number; massTotal: number; hue: number; cells: Array<{ x: number; y: number; radius: number; mass?: number }> } | null;
    players?: Array<{ id: string; name?: string | null; hue?: number; cells: Array<{ x: number; y: number; radius: number; mass?: number }> }>;
    food?: Array<{ x: number; y: number; hue?: number; radius?: number }>;
    mass?: Array<{ x: number; y: number; radius?: number; hue?: number }>;
    viruses?: Array<{ x: number; y: number; radius?: number }>;
}

export interface DrawOptions {
    /** Draw a grid inside the arena. Scrolls with the camera. */
    grid?: boolean;
    /** Shade the four strips outside the arena rectangle. */
    outsideArena?: boolean;
    /** Draw a stroked rectangle around the arena. */
    border?: boolean;
    /** Draw mass numbers below cell names. */
    showMass?: boolean;
    /** Use per-food hue instead of palette.food. Server-authored
     *  foods ship with a hue; thin spectator snapshots may or may not. */
    foodHues?: boolean;
    /** Draw cell names when labels are visible. */
    labels?: boolean;
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
    draw(snapshot: Snapshot, camera: Camera, opts: DrawOptions = {}): void {
        const { ctx, canvas } = this;
        const toScreen = (x: number, y: number) => ({
            x: (x - camera.x) * camera.scale + canvas.width / 2,
            y: (y - camera.y) * camera.scale + canvas.height / 2
        });

        ctx.save();
        // Background
        ctx.fillStyle = this.palette.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid (world-aligned, scales with camera). Drawn before everything
        // else so it sits under the entities and the out-of-arena shade.
        if (opts.grid) {
            const spacingWorld = this.world.height / 36;
            const spacing = spacingWorld * camera.scale;
            if (spacing > 4) {
                const tl = toScreen(0, 0);
                const br = toScreen(this.world.width, this.world.height);
                ctx.strokeStyle = this.palette.grid;
                ctx.globalAlpha = 0.15;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let x = tl.x; x <= br.x + 0.5; x += spacing) {
                    ctx.moveTo(x, tl.y);
                    ctx.lineTo(x, br.y);
                }
                for (let y = tl.y; y <= br.y + 0.5; y += spacing) {
                    ctx.moveTo(tl.x, y);
                    ctx.lineTo(br.x, y);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        }

        const tl = toScreen(0, 0);
        const br = toScreen(this.world.width, this.world.height);

        // Shade strips outside the arena rectangle so the edge of the
        // playfield is visually obvious even when the border is off.
        if (opts.outsideArena) {
            ctx.fillStyle = this.palette.outsideArena;
            if (tl.y > 0) ctx.fillRect(0, 0, canvas.width, tl.y);
            if (br.y < canvas.height) ctx.fillRect(0, br.y, canvas.width, canvas.height - br.y);
            if (tl.x > 0) {
                const t = Math.max(0, tl.y);
                const b = Math.min(canvas.height, br.y);
                if (b > t) ctx.fillRect(0, t, tl.x, b - t);
            }
            if (br.x < canvas.width) {
                const t = Math.max(0, tl.y);
                const b = Math.min(canvas.height, br.y);
                if (b > t) ctx.fillRect(br.x, t, canvas.width - br.x, b - t);
            }
        }

        // Arena boundary stroke
        if (opts.border !== false) {
            ctx.strokeStyle = this.palette.boundary;
            ctx.lineWidth = 2;
            ctx.strokeRect(tl.x, tl.y, this.world.width * camera.scale, this.world.height * camera.scale);
        }

        // Food
        const defaultFoodR = FOOD_RADIUS * camera.scale * 0.5;
        for (const f of snapshot.food || []) {
            const p = toScreen(f.x, f.y);
            const r = f.radius ? f.radius * camera.scale : defaultFoodR;
            if (opts.foodHues && typeof f.hue === 'number') {
                ctx.fillStyle = `hsl(${f.hue},100%,50%)`;
            } else {
                ctx.fillStyle = this.palette.food;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Mass food (ejected mass)
        for (const m of snapshot.mass || []) {
            const p = toScreen(m.x, m.y);
            const r = (m.radius || 10) * camera.scale;
            if (opts.foodHues && typeof m.hue === 'number') {
                ctx.fillStyle = `hsl(${m.hue},100%,50%)`;
            } else {
                ctx.fillStyle = this.palette.mass;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
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

        // Players + highlight self (if provided). Sort by cell mass so
        // smaller cells render under bigger ones, same as legacy client.
        const flatCells: Array<{
            x: number; y: number; r: number; mass: number;
            fill: string; stroke: string; name: string; isSelf: boolean;
        }> = [];
        for (const player of snapshot.players || []) {
            const hue = player.hue ?? 0;
            const isSelf = !!(snapshot.self && player.id === snapshot.self.id);
            for (const cell of player.cells || []) {
                flatCells.push({
                    x: cell.x, y: cell.y,
                    r: cell.radius * camera.scale,
                    mass: cell.mass ?? 0,
                    fill: `hsl(${hue},80%,55%)`,
                    stroke: isSelf ? this.palette.labelText : `hsl(${hue},80%,35%)`,
                    name: player.name || '',
                    isSelf
                });
            }
        }
        flatCells.sort((a, b) => a.mass - b.mass);

        const labels = opts.labels !== false;
        for (const cell of flatCells) {
            const p = toScreen(cell.x, cell.y);
            ctx.fillStyle = cell.fill;
            ctx.strokeStyle = cell.stroke;
            ctx.lineWidth = Math.max(1, (cell.isSelf ? 3 : 2) * camera.scale);
            ctx.beginPath();
            ctx.arc(p.x, p.y, cell.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            if (labels && cell.r > 14 && cell.name) {
                const fontSize = Math.max(12, cell.r / 3);
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = 3;
                ctx.miterLimit = 1;
                ctx.lineJoin = 'round';
                ctx.strokeStyle = this.palette.labelOutline;
                ctx.fillStyle = this.palette.labelText;
                ctx.strokeText(cell.name, p.x, p.y);
                ctx.fillText(cell.name, p.x, p.y);

                if (opts.showMass) {
                    const smallFont = Math.max(10, (fontSize / 3) * 2);
                    ctx.font = `bold ${smallFont}px sans-serif`;
                    const label = String(Math.round(cell.mass));
                    ctx.strokeText(label, p.x, p.y + fontSize);
                    ctx.fillText(label, p.x, p.y + fontSize);
                }
            }
        }

        ctx.restore();
    }

    /** Paint a full-screen message overlay. Used for respawn / kick /
     *  death screens where the game is paused but we still want the
     *  canvas to show something. */
    drawMessage(message: string): void {
        const { ctx, canvas } = this;
        ctx.save();
        ctx.fillStyle = '#333333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }
}
