// Shared chat widget used by the game client and the admin console.
// Renders a scrollback list plus an optional input, and subscribes to
// the socket.io events it is configured for. ADMIN-sender messages are
// rendered in bold regardless of caller.

import type { Socket } from 'socket.io-client';

export interface ChatEvents {
    /** Player chat (serverSendPlayerChat). */
    chat?: boolean;
    /** Server system messages (serverMSG). */
    system?: boolean;
    /** Player joined (playerJoin). Empty-name events are filtered. */
    join?: boolean;
    /** Player disconnected (playerDisconnect). Empty-name filtered. */
    leave?: boolean;
    /** Player eaten (playerDied). */
    death?: boolean;
}

export interface ChatConfig {
    /** Container element the chat renders into. Will be emptied. */
    container: HTMLElement;
    /** The connected socket.io client to subscribe on. */
    socket: Socket;
    /** Which event streams to subscribe to. All default to false. */
    events: ChatEvents;
    /** The local user's display name, used to style their own messages. */
    selfName?: string;
    /** Max scrollback lines kept in the DOM. */
    maxLines?: number;
    /** If true, render an input row at the bottom. */
    enableInput?: boolean;
    /** Placeholder shown in the input. */
    inputPlaceholder?: string;
    /** Called when the user submits a message in the input. If omitted,
     *  the input is read-only even when enableInput is true. */
    onSendMessage?: (text: string) => void;
}

export interface ChatHandle {
    /** Append a system-style line. */
    addSystem(text: string): void;
    /** Append a chat-style line attributed to `sender`. */
    addChat(sender: string, message: string): void;
    /** Drop all socket subscriptions and clear the DOM. */
    destroy(): void;
    /** The input element (if any). */
    input: HTMLInputElement | null;
}

const DEFAULT_MAX_LINES = 50;

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

function nameOrUnnamed(name: string | null | undefined): string {
    return name && name.length > 0 ? name : 'An unnamed cell';
}

export function createChat(cfg: ChatConfig): ChatHandle {
    const maxLines = cfg.maxLines ?? DEFAULT_MAX_LINES;
    cfg.container.innerHTML = '';
    cfg.container.classList.add('chatbox');

    const list = document.createElement('ul');
    list.className = 'chat-list';
    cfg.container.appendChild(list);

    let input: HTMLInputElement | null = null;
    if (cfg.enableInput) {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'chat-input';
        input.placeholder = cfg.inputPlaceholder ?? 'Chat here...';
        input.maxLength = 200;
        cfg.container.appendChild(input);

        input.addEventListener('keypress', (ev) => {
            if ((ev as KeyboardEvent).key !== 'Enter') return;
            const text = (input!.value || '').replace(/(<([^>]+)>)/ig, '').trim();
            if (!text) return;
            if (cfg.onSendMessage) cfg.onSendMessage(text);
            input!.value = '';
        });
    }

    function trim(): void {
        while (list.children.length > maxLines) list.firstElementChild?.remove();
    }

    function appendLi(kind: string, html: string): void {
        const li = document.createElement('li');
        li.className = kind;
        li.innerHTML = html;
        list.appendChild(li);
        list.scrollTop = list.scrollHeight;
        trim();
    }

    function addChat(sender: string, message: string): void {
        const isAdmin = sender === 'ADMIN';
        const isMe = !isAdmin && cfg.selfName !== undefined && sender === cfg.selfName;
        const kind = isAdmin ? 'admin' : isMe ? 'me' : 'friend';
        const safeSender = escapeHtml(nameOrUnnamed(sender));
        const safeMessage = escapeHtml(message);
        appendLi(kind, `<b>${safeSender}</b>: ${safeMessage}`);
    }

    function addSystem(text: string): void {
        // text is rendered as-is because the existing game paths already
        // compose HTML (e.g. "<b>name</b> joined"). Callers should escape
        // untrusted substrings before passing them in; the convenience
        // emitters below do so.
        appendLi('system', text);
    }

    // Socket subscriptions
    const subscriptions: Array<() => void> = [];
    function sub(event: string, handler: (...args: any[]) => void): void {
        cfg.socket.on(event, handler);
        subscriptions.push(() => cfg.socket.off(event, handler));
    }

    if (cfg.events.chat) {
        sub('serverSendPlayerChat', (d: { sender: string; message: string }) => {
            addChat(d.sender, d.message);
        });
    }
    if (cfg.events.system) {
        // serverMSG is a deprecated channel; still subscribed for safety.
        sub('serverMSG', (data: string) => addSystem(escapeHtml(data)));
    }
    if (cfg.events.join) {
        sub('playerJoin', (d: { name: string }) => {
            if (!d || !d.name) return;
            addSystem(`<b>${escapeHtml(nameOrUnnamed(d.name))}</b> joined`);
        });
    }
    if (cfg.events.leave) {
        sub('playerDisconnect', (d: { name: string }) => {
            if (!d || !d.name) return;
            addSystem(`<b>${escapeHtml(nameOrUnnamed(d.name))}</b> disconnected`);
        });
    }
    if (cfg.events.death) {
        sub('playerDied', (d: { name?: string; playerEatenName?: string }) => {
            const who = d.playerEatenName ?? d.name ?? '';
            addSystem(`<b>${escapeHtml(nameOrUnnamed(who))}</b> was eaten`);
        });
    }

    function destroy(): void {
        for (const off of subscriptions) off();
        cfg.container.innerHTML = '';
        cfg.container.classList.remove('chatbox');
    }

    return { addChat, addSystem, destroy, input };
}
