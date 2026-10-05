// Shared light/dark theme utilities. Writes to a single localStorage key
// so game and admin pages apply the same preference. Also surfaces the
// canvas-color map so the game renderer can swap its grid/background in
// lockstep with the CSS theme classes (otherwise the HTML flips to dark
// but the canvas stays stuck on the light-mode defaults).

export type Theme = 'light' | 'dark';

const KEY = 'cellagents.theme';
const DEFAULT: Theme = 'light';

export interface CanvasColors {
    background: string;
    grid: string;
    border: string;
    outsideArena: string;
}

const CANVAS_COLORS: Record<Theme, CanvasColors> = {
    light: {
        background: '#f2fbff',
        grid: '#000000',
        border: '#000000',
        outsideArena: 'rgba(0, 0, 0, 0.18)'
    },
    dark: {
        background: '#181818',
        grid: '#ffffff',
        border: '#ffffff',
        outsideArena: 'rgba(0, 0, 0, 0.55)'
    }
};

export function canvasColorsFor(theme: Theme): CanvasColors {
    return CANVAS_COLORS[theme];
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
