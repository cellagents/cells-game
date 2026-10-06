// Shared chrome for the three canvas viewports (player, spectator,
// follow). Owns the pieces that look identical across all three:
// theme wiring, floating buttons, status overlay for connection
// state, renderer palette tracking, leaderboard rendering into
// #leaderboard or #status, and the chat module mount.
//
// Pages still own their own render loop and camera: those are the
// things that genuinely differ. Everything else happens here so a
// new viewport feature (toolbar button, overlay, etc.) can be added
// in one place.

import type { Socket } from 'socket.io-client';
import { Renderer } from './renderer';
import type { GameHandle } from './connect';
import type { DisconnectPayload } from './connect';
import { StatusOverlay } from './overlay';
import { createChat, ChatEvents, ChatHandle } from '../chat/chat';
import { applyTheme, currentTheme, attachThemeToggle, onThemeChange, rendererPaletteFor } from '../theme';
import { attachLeaderboardToggle } from '../leaderboard-toggle';

export interface ViewportOptions {
    /** The game connector handle; the chrome subscribes to connect /
     *  disconnect / world / leaderboard events on it. */
    game: GameHandle;
    /** Main canvas element. Used only to apply the theme-tracked
     *  renderer palette; the loop lives in the page. */
    renderer: Renderer;
    /** Called when the user clicks exit or presses ESC. If omitted
     *  AND no exit button exists, nothing special happens. */
    onLeave?: () => void;
    /** If true (default: honour `?managed=1`), exit + ESC are disabled
     *  so an embedding iframe stays in control. Spectator and follow
     *  use the query flag; player always sets this to false. */
    managed?: boolean;
    /** Which chat event streams to subscribe to. Omit to skip chat
     *  mounting entirely. */
    chat?: ChatEvents | null;
    /** Chat defaults appropriate for the viewport. */
    chatConfig?: {
        selfName?: string;
        maxLines?: number;
        enableInput?: boolean;
        inputPlaceholder?: string;
        onSendMessage?: (text: string) => void;
    };
    /** Element to render the leaderboard list into; typically #status
     *  on /player and #leaderboard on /spectator and /follow. Pass
     *  null to skip leaderboard rendering. */
    leaderboardEl?: HTMLElement | null;
    /** Highlight the self row in the leaderboard: when the server
     *  echoes a row with this id, it gets the .me class. Set via
     *  game.selfId on the player page. */
    highlightId?: () => string | null;
    /** Initial status overlay message; defaults to "Connecting...". */
    initialMessage?: string;
}

export interface ViewportHandle {
    overlay: StatusOverlay;
    chat: ChatHandle | null;
    /** True when `?managed=1` or the caller forced managed mode. */
    managed: boolean;
    /** Trigger the user-provided onLeave while marking the viewport
     *  as leaving so the disconnect handler doesn't flash a reconnect
     *  overlay. Safe to call multiple times (idempotent). */
    leave(): void;
}

export function createViewport(opts: ViewportOptions): ViewportHandle {
    // Theme first so the first paint is on the right palette.
    applyTheme(currentTheme());
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) attachThemeToggle(themeBtn);
    onThemeChange((t) => opts.renderer.setPalette(rendererPaletteFor(t)));
    opts.renderer.setPalette(rendererPaletteFor(currentTheme()));

    const managed = opts.managed ?? isManagedQuery();

    let leaving = false;
    const leave = (): void => {
        if (leaving) return;
        leaving = true;
        if (opts.onLeave) opts.onLeave();
    };

    // Floating buttons: exit (hidden in managed mode), chat toggle,
    // leaderboard toggle. The theme toggle is wired above.
    if (managed) {
        const exitEl = document.getElementById('exitToMenu');
        if (exitEl) exitEl.hidden = true;
    } else if (opts.onLeave) {
        const exitEl = document.getElementById('exitToMenu');
        if (exitEl) exitEl.addEventListener('click', (ev) => {
            ev.preventDefault();
            leave();
        });
        window.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (ev.key !== 'Escape') return;
            const t = ev.target as HTMLElement | null;
            const tag = t && t.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
            leave();
        });
    }

    const chatBtn = document.getElementById('chatToggle') as HTMLButtonElement | null;
    if (chatBtn) {
        chatBtn.addEventListener('click', () => {
            document.body.classList.toggle('chat-hidden');
        });
    }
    attachLeaderboardToggle();

    // Status overlay: connecting / reconnecting / terminal messages.
    const overlay = new StatusOverlay({ showExit: !managed });
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

    // World size tracking (keeps renderer in sync for camera math).
    opts.game.on('world', (world) => opts.renderer.setWorld(world as { width: number; height: number }));

    // Leaderboard rendering.
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

    // Chat mount.
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
            if (chatBtn) chatBtn.hidden = false;
        }
    }

    return { overlay, chat, managed, leave };
}

function isManagedQuery(): boolean {
    const raw = new URLSearchParams(window.location.search).get('managed');
    if (raw === null) return false;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}
