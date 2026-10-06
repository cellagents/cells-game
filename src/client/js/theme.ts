// Shared light/dark theme utilities. Writes to a single localStorage key
// so game and admin pages apply the same preference. Also surfaces the
// canvas-color map so the game renderer can swap its grid/background in
// lockstep with the CSS theme classes (otherwise the HTML flips to dark
// but the canvas stays stuck on the light-mode defaults).

export type Theme = 'light' | 'dark';

const KEY = 'cellagents.cells.theme';
const DEFAULT: Theme = 'light';

export interface CanvasColors {
    background: string;
    grid: string;
    border: string;
    outsideArena: string;
    /** Fill for food pellets (spectator/follow thin renderer). */
    food: string;
    /** Fill for ejected mass (thin renderer). */
    mass: string;
    /** Fill/stroke for viruses (thin renderer). The dedicated game
     *  client reads virus colors per-entity from the server payload, so
     *  these are only consumed by the thin renderer. */
    virus: string;
    virusStroke: string;
}

const CANVAS_COLORS: Record<Theme, CanvasColors> = {
    light: {
        background: '#fafaf7',
        grid: '#1f2328',
        border: '#2f6feb',
        outsideArena: 'rgba(31, 35, 40, 0.18)',
        food: '#4a9f2d',
        mass: '#8ca82f',
        virus: '#1a9f1a',
        virusStroke: '#0d5f0d'
    },
    dark: {
        background: '#0f1419',
        grid: '#e6e8eb',
        border: '#4a85f0',
        outsideArena: 'rgba(0, 0, 0, 0.55)',
        food: '#9eff6a',
        mass: '#d6ff6a',
        virus: '#33ff33',
        virusStroke: '#19D119'
    }
};

export function canvasColorsFor(theme: Theme): CanvasColors {
    return CANVAS_COLORS[theme];
}

/** Build a RendererPalette from a theme. Centralised so every viewport
 *  gets the same mapping and the palette extends in lockstep when new
 *  draw features are added. */
export function rendererPaletteFor(theme: Theme): import('./thin/renderer').RendererPalette {
    const c = CANVAS_COLORS[theme];
    return {
        background: c.background,
        boundary: c.border,
        food: c.food,
        mass: c.mass,
        virus: c.virus,
        virusStroke: c.virusStroke,
        grid: c.grid,
        outsideArena: c.outsideArena,
        labelText: theme === 'dark' ? '#ffffff' : '#ffffff',
        labelOutline: '#000000'
    };
}

export function currentTheme(): Theme {
    try {
        const stored = window.localStorage.getItem(KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* localStorage unavailable (e.g. sandboxed iframes) */ }
    return DEFAULT;
}

type ThemeListener = (theme: Theme, colors: CanvasColors) => void;
const listeners = new Set<ThemeListener>();

export function onThemeChange(cb: ThemeListener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function applyTheme(theme: Theme): void {
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    try { window.localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    const colors = CANVAS_COLORS[theme];
    for (const cb of listeners) cb(theme, colors);
}

export function cycleTheme(): Theme {
    return currentTheme() === 'light' ? 'dark' : 'light';
}

/** Wire a button to toggle the theme on click. */
export function attachThemeToggle(button: HTMLElement): void {
    button.addEventListener('click', () => applyTheme(cycleTheme()));
}
