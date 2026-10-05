// Shared light/dark theme utilities. Writes to a single localStorage key
// so game and admin pages apply the same preference.

export type Theme = 'light' | 'dark';

const KEY = 'cellagents.theme';
const DEFAULT: Theme = 'light';

export function currentTheme(): Theme {
    try {
        const stored = window.localStorage.getItem(KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* localStorage unavailable (e.g. sandboxed iframes) */ }
    return DEFAULT;
}

export function applyTheme(theme: Theme): void {
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    try { window.localStorage.setItem(KEY, theme); } catch { /* ignore */ }
}

export function cycleTheme(): Theme {
    return currentTheme() === 'light' ? 'dark' : 'light';
}

/** Wire a button to toggle the theme on click. */
export function attachThemeToggle(button: HTMLElement): void {
    button.addEventListener('click', () => applyTheme(cycleTheme()));
}
