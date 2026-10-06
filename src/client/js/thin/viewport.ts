// Shared chrome for the canvas viewports (player, spectator, follow,
// managed). Owns the pieces that look identical across all of them:
// theme wiring, floating buttons, status overlay for connection state,
// renderer palette tracking, leaderboard rendering, and the chat
// module mount. Pages still own their own render loop and camera
// because those are the things that genuinely differ.
//
// Chrome shape is config-driven: the caller passes a `view` name,
// createViewport fetches /ui-config?view=<view>, and the result
// decides which floating buttons are present and what the initial
// visibility of each toggleable widget is (split by desktop/mobile).
// A button whose config says `button: false` is removed from the DOM
// entirely so operators can hard-off entire chrome elements for
// embedded harness surfaces.

import type { Socket } from 'socket.io-client';
import { Renderer } from './renderer';
import type { GameHandle } from './connect';
import type { DisconnectPayload } from './connect';
import { StatusOverlay } from './overlay';
import { createChat, ChatEvents, ChatHandle } from '../chat/chat';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, rendererPaletteFor } from '../theme';

export type UiView = 'player' | 'spectator' | 'follow' | 'managed';

interface UiAction { button: boolean }
interface UiWidget { button: boolean; defaultVisible: { desktop: boolean; mobile: boolean } }
export interface UiConfig {
    exit: UiAction;
    theme: UiAction;
    chat: UiWidget;
    leaderboard: UiWidget;
    minimap: UiWidget;
}

export interface ViewportOptions {
    /** View name; drives the /ui-config fetch and some ergonomic
     *  defaults (chat events, status messages). */
    view: UiView;
    /** The game connector handle; the chrome subscribes to connect /
     *  disconnect / world / leaderboard events on it. */
    game: GameHandle;
    /** Main canvas renderer; its palette is kept in sync with the
     *  active theme (not the canvas itself; the loop lives in the page). */
    renderer: Renderer;
    /** Called when the user clicks exit or presses ESC. If omitted the
     *  button and ESC handler are both no-ops. */
    onLeave?: () => void;
    /** Chat event streams to subscribe to. Null skips chat mounting
     *  even if the chat button is configured on; useful for views
     *  where chat is structurally absent (none today). */
    chat?: ChatEvents | null;
    /** Chat defaults appropriate for the viewport. */
    chatConfig?: {
        selfName?: string;
        maxLines?: number;
        enableInput?: boolean;
        inputPlaceholder?: string;
        onSendMessage?: (text: string) => void;
    };
    /** Element to render the leaderboard list into. Pass null to
     *  skip leaderboard rendering (also silences the leaderboard
     *  button, since there's nothing to toggle). */
    leaderboardEl?: HTMLElement | null;
    /** Returns the current self id so the leaderboard can highlight
     *  the local player's row with the .me class. */
    highlightId?: () => string | null;
    /** Initial status overlay message; defaults to "Connecting...". */
    initialMessage?: string;
}

export interface ViewportHandle {
    overlay: StatusOverlay;
    chat: ChatHandle | null;
    ui: UiConfig;
    /** Trigger the user-provided onLeave while marking the viewport
     *  as leaving so the disconnect handler doesn't flash a reconnect
     *  overlay. Safe to call multiple times (idempotent). */
    leave(): void;
}

const MOBILE_MAX_WIDTH = 800;
const BUTTON_IDS = {
    exit: 'exitToMenu',
    theme: 'themeToggle',
    chat: 'chatToggle',
    leaderboard: 'leaderboardToggle',
    minimap: 'minimapToggle'
} as const;
const BODY_HIDDEN_CLASS = {
    chat: 'chat-hidden',
    leaderboard: 'leaderboard-hidden',
    minimap: 'minimap-hidden'
} as const;

export async function createViewport(opts: ViewportOptions): Promise<ViewportHandle> {
    // Theme first so the first paint is on the right palette. Applied
    // even if the theme button is disabled; the preference persists
    // across pages via localStorage so a managed iframe still inherits
    // whatever the user picked in the lobby.
    applyTheme(currentTheme());
    onThemeChange((t) => opts.renderer.setPalette(rendererPaletteFor(t)));
    opts.renderer.setPalette(rendererPaletteFor(currentTheme()));

    const ui = await fetchUiConfig(opts.view);
    const isMobile = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;

    // Apply initial widget visibility BEFORE any paint. The body
    // classes gate CSS display: none, so there's no visual flash of
    // a chatbox that will immediately be hidden.
    for (const name of ['chat', 'leaderboard', 'minimap'] as const) {
        const w = ui[name];
        const visible = isMobile ? w.defaultVisible.mobile : w.defaultVisible.desktop;
        if (!visible) document.body.classList.add(BODY_HIDDEN_CLASS[name]);
    }

    // Prune floating buttons: `button: false` removes the element from
    // the DOM entirely so the stack doesn't leave a gap where it used
    // to live. The CSS positions each button by class so remaining
    // buttons re-stack automatically.
    pruneButton(BUTTON_IDS.exit, ui.exit.button);
    pruneButton(BUTTON_IDS.theme, ui.theme.button);
    pruneButton(BUTTON_IDS.chat, ui.chat.button);
    pruneButton(BUTTON_IDS.leaderboard, ui.leaderboard.button);
    pruneButton(BUTTON_IDS.minimap, ui.minimap.button);

    // Wire buttons that survived.
    const themeBtn = ui.theme.button ? document.getElementById(BUTTON_IDS.theme) : null;
    if (themeBtn) attachThemeToggle(themeBtn);

    let leaving = false;
    const leave = (): void => {
        if (leaving) return;
        leaving = true;
        if (opts.onLeave) opts.onLeave();
    };

    if (ui.exit.button && opts.onLeave) {
        const exitEl = document.getElementById(BUTTON_IDS.exit);
        if (exitEl) exitEl.addEventListener('click', (ev) => {
            ev.preventDefault();
            leave();
        });
    }
    // ESC handler is tied to the exit action, not the button: if the
    // view's config has exit.button:true, ESC also leaves. (A view
    // that wants keyboardless exit can still set exit.button:true
    // and ignore the glyph via CSS; the inverse is handled by the
    // config saying button:false.)
    if (ui.exit.button && opts.onLeave) {
        window.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (ev.key !== 'Escape') return;
            const t = ev.target as HTMLElement | null;
            const tag = t && t.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
            leave();
        });
    }

    const chatBtn = ui.chat.button ? document.getElementById(BUTTON_IDS.chat) as HTMLButtonElement | null : null;
    if (chatBtn) {
        chatBtn.hidden = false;
        chatBtn.addEventListener('click', () => {
            document.body.classList.toggle(BODY_HIDDEN_CLASS.chat);
        });
    }

    const leaderboardBtn = ui.leaderboard.button
        ? document.getElementById(BUTTON_IDS.leaderboard) : null;
    if (leaderboardBtn) {
        leaderboardBtn.addEventListener('click', () => {
            document.body.classList.toggle(BODY_HIDDEN_CLASS.leaderboard);
        });
    }
    // Minimap button is wired by attachMinimap() since the module
    // owns the canvas; nothing to do here beyond ensuring the button
    // either exists or doesn't per the pruneButton call above.

    // Status overlay. "Session ended" is shown with the back-to-lobby
    // link only when the exit action is available; otherwise there's
    // nowhere to go from an embedded surface so we leave the link out.
    const overlay = new StatusOverlay({ showExit: ui.exit.button });
    overlay.show(opts.initialMessage ?? 'Connecting to server...');
    opts.game.on('connect', () => overlay.hide());
    opts.game.on('disconnect', (payload) => {
        if (leaving) return;
        const d = payload as DisconnectPayload;
        if (d.deliberate) {
            overlay.show(`Session ended: ${d.reason}`, true);
        } else {
            overlay.show('Reconnecting to server...');
        }
    });

    // World size tracking keeps the renderer in sync for camera math.
    opts.game.on('world', (world) => opts.renderer.setWorld(world as { width: number; height: number }));

    // Leaderboard rendering. We subscribe even when the widget starts
    // hidden; the DOM is updated regardless so revealing it mid-session
    // shows live content, not stale placeholder.
    if (opts.leaderboardEl) {
        const el = opts.leaderboardEl;
        opts.game.on('leaderboard', (lb) => {
            const rows = lb as Array<{ id: string; name: string | null }>;
            const self = opts.highlightId ? opts.highlightId() : null;
            let html = '<span class="title">Leaderboard</span>';
            for (let i = 0; i < rows.length; i++) {
                const name = rows[i].name;
                const label = name && name.length > 0 ? name : 'An unnamed cell';
                const safe = escapeHtml(label);
                if (self && rows[i].id === self) {
                    html += `<br /><span class="me">${i + 1}. ${safe}</span>`;
                } else {
                    html += `<br />${i + 1}. ${safe}`;
                }
            }
            el.innerHTML = html;
        });
    }

    // Chat mount. We mount even when the chat button is off, so the
    // configured defaultVisible for mobile:true / desktop:true still
    // lets operators show a read-only chat on a kiosk. Pages that
    // don't want chat at all pass chat:null.
    let chat: ChatHandle | null = null;
    if (opts.chat) {
        const container = document.getElementById('chatbox') as HTMLElement | null;
        if (container) {
            chat = createChat({
                container,
                socket: opts.game.socket as Socket,
                events: opts.chat,
                selfName: opts.chatConfig?.selfName,
                maxLines: opts.chatConfig?.maxLines ?? 50,
                enableInput: opts.chatConfig?.enableInput ?? false,
                inputPlaceholder: opts.chatConfig?.inputPlaceholder,
                onSendMessage: opts.chatConfig?.onSendMessage
            });
        }
    }

    return { overlay, chat, ui, leave };
}

function pruneButton(id: string, keep: boolean): void {
    if (keep) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

async function fetchUiConfig(view: UiView): Promise<UiConfig> {
    try {
        const r = await fetch(`/ui-config?view=${encodeURIComponent(view)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json() as UiConfig;
    } catch {
        // Non-fatal: if the config endpoint is unavailable (e.g. the
        // server didn't ship this build with the endpoint, or the
        // request raced the socket) we fall back to permissive
        // defaults so the page still works.
        return {
            exit: { button: true },
            theme: { button: true },
            chat: { button: true, defaultVisible: { desktop: true, mobile: false } },
            leaderboard: { button: true, defaultVisible: { desktop: true, mobile: false } },
            minimap: { button: true, defaultVisible: { desktop: true, mobile: false } }
        };
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}
