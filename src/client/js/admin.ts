// Admin console. Starts locked: the UI is hidden until the user types a
// valid bearer token into the login form. On successful auth the token
// plus an absolute expiry timestamp are stashed in sessionStorage so a
// page refresh skips the password prompt until the session times out.
// Any 401 from the API (bad or stale token) also drops back to login.

import { io, Socket } from 'socket.io-client';
import { createChat, ChatHandle } from './chat/chat';
import { applyTheme, currentTheme, attachThemeToggle } from './theme';

const TOKEN_KEY = 'cellagents.adminToken';
const EXPIRY_KEY = 'cellagents.adminExpiresAt';
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour sliding
// The admin UI is only served by its own game server, so target it directly.
// No field surfaces this; cross-origin admin is intentionally not supported.
const SERVER_BASE = window.location.origin.replace(/\/$/, '');
const ADMIN_SENDER = 'ADMIN';

const loginView = document.getElementById('login-view') as HTMLElement;
const adminView = document.getElementById('admin-view') as HTMLElement;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginTokenInput = document.getElementById('login-token') as HTMLInputElement;
const loginStatusEl = document.getElementById('login-status') as HTMLElement;

const sessionExpiryEl = document.getElementById('session-expiry') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const stateEl = document.getElementById('state') as HTMLElement;
const playersEl = document.getElementById('players') as HTMLElement;
const chatboxEl = document.getElementById('chatbox') as HTMLElement;

let refreshTimer: number | null = null;
let expiryTimer: number | null = null;
let logSocket: Socket | null = null;
let chat: ChatHandle | null = null;

applyTheme(currentTheme());
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) attachThemeToggle(themeBtn);

function getToken(): string | null {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
    if (!token || !expiry || Date.now() > expiry) return null;
    return token;
}

function touchSession(): void {
    const expiry = Date.now() + IDLE_TIMEOUT_MS;
    sessionStorage.setItem(EXPIRY_KEY, String(expiry));
    scheduleExpiry(expiry);
    renderExpiry(expiry);
}

function clearSession(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
    if (refreshTimer !== null) { clearInterval(refreshTimer); refreshTimer = null; }
    if (expiryTimer !== null) { clearTimeout(expiryTimer); expiryTimer = null; }
    tearDownChat();
}

function scheduleExpiry(expiry: number): void {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    const delay = Math.max(0, expiry - Date.now());
    expiryTimer = window.setTimeout(() => {
        showLogin('Session expired. Please unlock again.');
    }, delay);
}

function renderExpiry(expiry: number): void {
    sessionExpiryEl.textContent = new Date(expiry).toLocaleTimeString();
}

function tearDownChat(): void {
    if (chat) { chat.destroy(); chat = null; }
    if (logSocket) { logSocket.disconnect(); logSocket = null; }
}

function connectChat(): void {
    if (chat) return;
    // Admin joins as a spectator so the server includes it in io.emit().
    logSocket = io(SERVER_BASE, { query: { type: 'spectator', data: 'full' }, reconnection: true });
    logSocket.on('welcome', () => logSocket && logSocket.emit('gotit'));

    chat = createChat({
        container: chatboxEl,
        socket: logSocket,
        events: { chat: true, system: true, join: true, leave: true, death: true },
        selfName: ADMIN_SENDER,
        maxLines: 100,
        enableInput: true,
        inputPlaceholder: 'Broadcast as ADMIN...',
        onSendMessage: (text) => broadcastAsAdmin(text)
    });
}

async function broadcastAsAdmin(message: string): Promise<void> {
    try {
        const res = await apiCall('/admin/broadcast', { method: 'POST', body: JSON.stringify({ message }) });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `${res.status}`);
        }
        // The server echoes the broadcast as serverSendPlayerChat, so the
        // sent line appears via the socket subscription. No local append.
    } catch (err) {
        if ((err as Error).message !== '401') setStatus(`broadcast failed: ${(err as Error).message}`, true);
    }
}

function headers(): HeadersInit {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function setStatus(text: string, isError = false): void {
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.className = isError ? 'status error' : 'status';
}

function setLoginStatus(text: string, isError = true): void {
    loginStatusEl.hidden = false;
    loginStatusEl.textContent = text;
    loginStatusEl.className = isError ? 'status error' : 'status';
}

function showLogin(reason?: string): void {
    clearSession();
    adminView.hidden = true;
    loginView.hidden = false;
    loginTokenInput.value = '';
    if (reason) setLoginStatus(reason);
    else loginStatusEl.hidden = true;
    loginTokenInput.focus();
}

function showAdmin(): void {
    loginView.hidden = true;
    adminView.hidden = false;
    const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
    if (expiry) { scheduleExpiry(expiry); renderExpiry(expiry); }
    if (refreshTimer === null) refreshTimer = window.setInterval(refreshState, 2000);
    refreshState();
    connectChat();
}

async function verifyToken(token: string): Promise<boolean> {
    const res = await fetch(`${SERVER_BASE}/admin/state`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) return false;
    if (!res.ok) throw new Error(`unexpected ${res.status}`);
    return true;
}

async function handleLoginSubmit(ev: Event): Promise<void> {
    ev.preventDefault();
    const token = loginTokenInput.value.trim();
    if (!token) { setLoginStatus('token required'); return; }
    setLoginStatus('verifying...', false);
    try {
        const ok = await verifyToken(token);
        if (!ok) { setLoginStatus('invalid token'); return; }
        sessionStorage.setItem(TOKEN_KEY, token);
        touchSession();
        showAdmin();
    } catch (err) {
        setLoginStatus(`error: ${(err as Error).message}`);
    }
}

async function apiCall(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${SERVER_BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
    if (res.status === 401) {
        showLogin('Session rejected. Please unlock again.');
        throw new Error('401');
    }
    if (res.ok) touchSession();
    return res;
}

async function refreshState(): Promise<void> {
    try {
        const res = await apiCall('/admin/state');
        if (!res.ok) throw new Error(`${res.status}`);
        const body = await res.json();
        stateEl.textContent = JSON.stringify(body, null, 2);
        renderPlayerList(body.players || []);
    } catch (err) {
        if ((err as Error).message !== '401') stateEl.textContent = `error: ${(err as Error).message}`;
    }
}

interface PlayerRow { id: string; name: string | null; massTotal: number; cells: number; }

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

function renderPlayerList(players: PlayerRow[]): void {
    if (players.length === 0) { playersEl.innerHTML = '<em>no players</em>'; return; }
    playersEl.innerHTML = players.map((p) => {
        const display = (p.name && p.name.length > 0) ? p.name : '(unnamed)';
        const safeName = String(p.name || '').replace(/"/g, '&quot;');
        return `<div class="player-row">
            <span>${escapeHtml(display)} · mass ${p.massTotal} · ${p.cells} cell(s)</span>
            <button class="kick-btn" data-name="${safeName}">kick</button>
        </div>`;
    }).join('');
    for (const btn of Array.from(playersEl.querySelectorAll<HTMLButtonElement>('.kick-btn'))) {
        btn.addEventListener('click', () => kick(btn.dataset.name || ''));
    }
}

async function kick(name: string): Promise<void> {
    if (!name) return;
    setStatus(`kicking ${name}...`);
    try {
        const res = await apiCall('/admin/kick', { method: 'POST', body: JSON.stringify({ name }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `${res.status}`);
        setStatus(`kicked ${name}`);
        refreshState();
    } catch (err) {
        if ((err as Error).message !== '401') setStatus(`error: ${(err as Error).message}`, true);
    }
}

loginForm.addEventListener('submit', handleLoginSubmit);
document.getElementById('btn-logout')!.addEventListener('click', () => showLogin('Locked.'));
document.getElementById('btn-refresh')!.addEventListener('click', () => refreshState());

async function boot(): Promise<void> {
    const token = getToken();
    if (!token) { showLogin(); return; }
    try {
        const ok = await verifyToken(token);
        if (ok) { touchSession(); showAdmin(); }
        else showLogin('Stored token rejected. Please unlock again.');
    } catch {
        showLogin('Could not reach the server. Please unlock again.');
    }
}

boot();
