// Canvas renderer shared by every viewport (player, spectator, follow,
// minimap). Draws from the protocol-1.0 Tick payload against a
// Camera. Keeps zero state beyond the canvas, the current theme palette
// and the last snapshot handed in; mode-specific choices (which decor
// to include) are passed per draw call so a single Renderer instance
// can serve both a main viewport and a minimap.

import type { Entity, Tick } from '@cellagents/game-protocol/wire';
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

/** The renderer draws straight from a protocol Tick. */
export type Snapshot = Tick;

/** Hue lookup: player id → hue. Derived from Tick.players for cell
 *  colouring. */
function hueMap(tick: Tick): Map<string, number> {
    const m = new Map<string, number>();
    for (const p of tick.players) m.set(p.id, p.hue);
    return m;
}

/** Name lookup: player id → name. */
function nameMap(tick: Tick): Map<string, string> {
    const m = new Map<string, string>();
    for (const p of tick.players) if (p.name) m.set(p.id, p.name);
    return m;
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

        // Entities are one flat list in protocol 1.0; split by kind
        // for the three visual layers (food/mass under, cells and
        // viruses over). Unknown kinds fall through to a plain-circle
        // rendering so a 1.0 client stays visually valid against a
        // future 1.x server that adds, say, `portal`.
        const defaultFoodR = FOOD_RADIUS * camera.scale * 0.5;
        const foods: Entity[] = [];
        const ejected: Entity[] = [];
        const viruses: Entity[] = [];
        const cells: Entity[] = [];
        const unknowns: Entity[] = [];
        for (const e of snapshot.entities || []) {
            switch (e.kind) {
                case 'food': foods.push(e); break;
                case 'ejected': ejected.push(e); break;
                case 'virus': viruses.push(e); break;
                case 'cell': cells.push(e); break;
                default: unknowns.push(e); break;
            }
        }

        for (const f of foods) {
            const p = toScreen(f.x, f.y);
            const r = f.radius ? f.radius * camera.scale : defaultFoodR;
            const hue = (f as { hue?: number }).hue;
            if (opts.foodHues && typeof hue === 'number') {
                ctx.fillStyle = `hsl(${hue},100%,50%)`;
            } else {
                ctx.fillStyle = this.palette.food;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const m of ejected) {
            const p = toScreen(m.x, m.y);
            const r = (m.radius || 10) * camera.scale;
            const hue = (m as { hue?: number }).hue;
            if (opts.foodHues && typeof hue === 'number') {
                ctx.fillStyle = `hsl(${hue},100%,50%)`;
            } else {
                ctx.fillStyle = this.palette.mass;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = this.palette.virus;
        ctx.strokeStyle = this.palette.virusStroke;
        for (const v of viruses) {
            const p = toScreen(v.x, v.y);
            const r = (v.radius || 60) * camera.scale;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = Math.max(1, 4 * camera.scale);
            ctx.stroke();
        }

        // Players + cells. Group by owner for labelling + colouring.
        const hues = hueMap(snapshot);
        const names = nameMap(snapshot);
        const selfId = snapshot.self?.id ?? null;
        // Which players are invulnerable right now? Rendered as a
        // subtle extra ring so humans and bots alike can see it.
        const invulnerable = new Set<string>();
        for (const p of snapshot.players) {
            if (!p.effects) continue;
            for (const eff of p.effects) {
                if (eff.type === 'invulnerable' && (eff.until === undefined || eff.until > snapshot.time)) {
                    invulnerable.add(p.id);
                    break;
                }
            }
        }

        const flatCells: Array<{
            x: number; y: number; r: number; mass: number;
            fill: string; stroke: string; name: string; isSelf: boolean;
            ownerId: string; noMerge: boolean; invuln: boolean;
        }> = [];
        for (const c of cells) {
            const owner = (c as { owner?: string }).owner;
            if (!owner) continue;
            const hue = hues.get(owner) ?? 0;
            const isSelf = owner === selfId;
            const noMerge = !!c.effects?.some((e) =>
                e.type === 'noMerge' && (e.until === undefined || e.until > snapshot.time));
            flatCells.push({
                x: c.x, y: c.y,
                r: c.radius * camera.scale,
                mass: c.mass,
                fill: `hsl(${hue},80%,55%)`,
                stroke: isSelf ? this.palette.labelText : `hsl(${hue},80%,35%)`,
                name: names.get(owner) || '',
                isSelf,
                ownerId: owner,
                noMerge,
                invuln: invulnerable.has(owner)
            });
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

            // Effect decor. `invulnerable` on the owner → extra
            // dashed ring just outside the cell; `noMerge` on this
            // cell → faint second ring, matching the "cells recently
            // split can't rejoin yet" state so humans and bots see
            // it the same.
            if (cell.invuln) {
                ctx.save();
                ctx.setLineDash([Math.max(2, 4 * camera.scale), Math.max(2, 4 * camera.scale)]);
                ctx.lineWidth = Math.max(1, 2 * camera.scale);
                ctx.strokeStyle = this.palette.labelText;
                ctx.globalAlpha = 0.75;
                ctx.beginPath();
                ctx.arc(p.x, p.y, cell.r + Math.max(3, 5 * camera.scale), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
            if (cell.noMerge) {
                ctx.save();
                ctx.globalAlpha = 0.4;
                ctx.lineWidth = Math.max(1, 1.5 * camera.scale);
                ctx.strokeStyle = cell.stroke;
                ctx.beginPath();
                ctx.arc(p.x, p.y, cell.r + Math.max(2, 3 * camera.scale), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

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

        // Unknown-kind entities: honest grey circle, radius from
        // the wire. Keeps a future server's new kinds visible
        // instead of invisible (forward-compat rule 1).
        if (unknowns.length) {
            ctx.save();
            ctx.fillStyle = '#999';
            ctx.strokeStyle = '#555';
            ctx.lineWidth = Math.max(1, 2 * camera.scale);
            for (const u of unknowns) {
                const p = toScreen(u.x, u.y);
                const r = (u.radius || 10) * camera.scale;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
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
