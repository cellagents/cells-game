// Shared chrome for the canvas viewports (player, spectator, follow,
// managed). Owns the pieces that look identical across all of them:
// theme wiring, floating buttons, status overlay for connection state,
// renderer palette tracking, leaderboard rendering, and the chat
// module mount. Pages still own their own render loop and camera
// because those are the things that genuinely differ.
//
// Chrome shape is config-driven: createViewport fetches the view's UI
// config via fetchUiConfig (see thin/chrome.ts) and prunes any button
// flagged `button: false` from the DOM. Lobby and admin pages share
// the same fetch helper but wire their own small chrome inline.

import type { Socket } from 'socket.io-client';
import { Renderer } from './renderer';
import type { GameHandle } from './connect';
import type { DisconnectPayload } from './connect';
import { StatusOverlay } from './overlay';
import { createChat, ChatEvents, ChatHandle } from '../chat/chat';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, rendererPaletteFor } from '../theme';
import { CanvasUi, fetchUiConfig, isMobileViewport, pruneButton } from './chrome';

/** Canvas viewport ids (see UiView in chrome.ts for the full set). */
export type CanvasView = 'player' | 'spectator' | 'follow' | 'managed';

export interface ViewportOptions {
    view: CanvasView;
    /** Game connector handle; chrome subscribes to connect / disconnect
     *  / world / leaderboard events on it. */
    game: GameHandle;
    /** Main canvas renderer; its palette is kept in sync with the
     *  active theme. */
    renderer: Renderer;
    /** Called when the user clicks exit or presses ESC. If omitted
     *  the button and ESC handler are both no-ops. */
    onLeave?: () => void;
    /** Chat event streams to subscribe to. Null skips chat mounting
     *  even if the chat button is configured on. */
    chat?: ChatEvents | null;
    chatConfig?: {
        selfName?: string;
        maxLines?: number;
        enableInput?: boolean;
        inputPlaceholder?: string;
        onSendMessage?: (text: string) => void;
    };
    /** Element to render the leaderboard list into. Pass null to
     *  skip leaderboard rendering. */
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
    ui: CanvasUi;
    /** Trigger the user-provided onLeave while marking the viewport
     *  as leaving so the disconnect handler doesn't flash a reconnect
     *  overlay. Safe to call multiple times (idempotent). */
    leave(): void;
}

const BUTTON_IDS = {
    exit: 'exit-to-menu',
    theme: 'theme-toggle',
    chat: 'chat-toggle',
    leaderboard: 'leaderboard-toggle',
    minimap: 'minimap-toggle'
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
    const isMobile = isMobileViewport();

    // Apply initial widget visibility BEFORE any paint. The body
    // classes gate CSS display: none, so there's no visual flash of
    // a chatbox that will immediately be hidden.
    for (const name of ['chat', 'leaderboard', 'minimap'] as const) {
        const w = ui[name];
        const visible = isMobile ? w.defaultVisible.mobile : w.defaultVisible.desktop;
        if (!visible) document.body.classList.add(BODY_HIDDEN_CLASS[name]);
    }

    // Prune floating buttons: `button: false` removes the element from
    // the DOM entirely so remaining buttons re-stack via CSS classes.
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
        // ESC is tied to the same exit action.
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
    // owns the canvas; nothing to do here beyond pruneButton above.

    // Status overlay. "Session ended" shows the back-to-lobby link
    // only when the exit action is available.
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

    opts.game.on('world', (world) => opts.renderer.setWorld(world as { width: number; height: number }));

    // Leaderboard. We subscribe even when the widget starts hidden so
    // the DOM is live if the user reveals it mid-session.
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

    // Chat mount. Mount even when the chat button is off so operators
    // can show a read-only chat on a kiosk. Pages that don't want
    // chat at all pass chat:null.
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

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}
