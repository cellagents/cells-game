// Shared floating-button-chrome helpers used by every page that
// surfaces the top-right button stack (lobby, admin, player,
// spectator, follow, managed). Owns:
//   - fetching the per-view UI config
//   - pruning button DOM nodes when a view disables one
//   - applying the mobile-vs-desktop default visibility class
//     on body elements for the widget-style toggles
//
// This module is deliberately tiny and view-agnostic: each page knows
// which fields its own UiConfig has and wires action buttons itself.
// createViewport (canvas views) just happens to be the most involved
// consumer; lobby.ts and admin.ts each call fetchUiConfig + pruneButton
// directly for their short, straight-line setup.

export const MOBILE_MAX_WIDTH = 800;

/** The known view ids served by /ui-config. */
export type UiView = 'lobby' | 'admin' | 'player' | 'spectator' | 'follow' | 'managed';

export interface UiAction { button: boolean }
export interface UiWidget {
    button: boolean;
    defaultVisible: { desktop: boolean; mobile: boolean };
}

export interface LobbyUi { theme: UiAction }
export interface AdminUi { theme: UiAction; lock: UiAction }
export interface CanvasUi {
    exit: UiAction;
    theme: UiAction;
    chat: UiWidget;
    leaderboard: UiWidget;
    minimap: UiWidget;
}

export type UiConfigFor<V extends UiView> =
    V extends 'lobby' ? LobbyUi :
    V extends 'admin' ? AdminUi :
    CanvasUi;

const LOBBY_DEFAULT: LobbyUi = { theme: { button: true } };
const ADMIN_DEFAULT: AdminUi = { theme: { button: true }, lock: { button: true } };
const CANVAS_DEFAULT: CanvasUi = {
    exit: { button: true },
    theme: { button: true },
    chat: { button: true, defaultVisible: { desktop: true, mobile: false } },
    leaderboard: { button: true, defaultVisible: { desktop: true, mobile: false } },
    minimap: { button: true, defaultVisible: { desktop: true, mobile: false } }
};

/** Fetch the chrome config for a given view. On any error (endpoint
 *  missing, network failure, non-JSON response) we fall back to the
 *  shape's permissive defaults so the page still works. */
export async function fetchUiConfig<V extends UiView>(view: V): Promise<UiConfigFor<V>> {
    try {
        const r = await fetch(`/ui-config?view=${encodeURIComponent(view)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json() as UiConfigFor<V>;
    } catch {
        if (view === 'lobby') return LOBBY_DEFAULT as UiConfigFor<V>;
        if (view === 'admin') return ADMIN_DEFAULT as UiConfigFor<V>;
        return CANVAS_DEFAULT as UiConfigFor<V>;
    }
}

/** Remove a floating button from the DOM when its config disabled it.
 *  Removal (not just hiding) is intentional: the CSS stacks remaining
 *  buttons by class, so a hidden button would leave an awkward gap. */
export function pruneButton(id: string, keep: boolean): void {
    if (keep) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

/** Query the current viewport width class. Fixed at page load; the
 *  chrome does not reactively flip widgets if the user resizes the
 *  window because that would be surprising mid-session. */
export function isMobileViewport(): boolean {
    return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}
