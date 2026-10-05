// Admin console. Starts locked: the UI is hidden until the user types a
// valid bearer token into the login form. On successful auth the token
// plus an absolute expiry timestamp are stashed in sessionStorage so a
// page refresh skips the password prompt until the session times out.
// Any 401 from the API (bad or stale token) also drops back to login.

const TOKEN_KEY = 'cellagents.adminToken';
const EXPIRY_KEY = 'cellagents.adminExpiresAt';
const SERVER_KEY = 'cellagents.gameServer';
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour sliding

const loginView = document.getElementById('login-view') as HTMLElement;
const adminView = document.getElementById('admin-view') as HTMLElement;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginServerInput = document.getElementById('login-server') as HTMLInputElement;
const loginTokenInput = document.getElementById('login-token') as HTMLInputElement;
const loginStatusEl = document.getElementById('login-status') as HTMLElement;

const connectedServerEl = document.getElementById('connected-server') as HTMLElement;
const sessionExpiryEl = document.getElementById('session-expiry') as HTMLElement;
const broadcastInput = document.getElementById('broadcast-msg') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLElement;
const stateEl = document.getElementById('state') as HTMLElement;
const playersEl = document.getElementById('players') as HTMLElement;

let refreshTimer: number | null = null;
let expiryTimer: number | null = null;

function getToken(): string | null {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
    if (!token || !expiry || Date.now() > expiry) return null;
    return token;
}

function getServer(): string {
    const stored = sessionStorage.getItem(SERVER_KEY);
    return (stored || window.location.origin).replace(/\/$/, '');
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
}

function scheduleExpiry(expiry: number): void {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    const delay = Math.max(0, expiry - Date.now());
    expiryTimer = window.setTimeout(() => {
        showLogin('Session expired. Please unlock again.');
    }, delay);
}

function renderExpiry(expiry: number): void {
    const d = new Date(expiry);
    sessionExpiryEl.textContent = d.toLocaleTimeString();
}

function headers(): HeadersInit {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function setStatus(text: string, isError = false): void {
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
    loginServerInput.value = getServer();
    loginTokenInput.value = '';
    if (reason) setLoginStatus(reason);
    else loginStatusEl.hidden = true;
    loginTokenInput.focus();
}

function showAdmin(): void {
    loginView.hidden = true;
    adminView.hidden = false;
    connectedServerEl.textContent = getServer();
    const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
    if (expiry) { scheduleExpiry(expiry); renderExpiry(expiry); }
    if (refreshTimer === null) refreshTimer = window.setInterval(refreshState, 2000);
    refreshState();
}

// Attempt to probe /admin/state with a given token+server. Resolves true
// on 200, false on 401. Any other outcome throws.
async function verifyToken(server: string, token: string): Promise<boolean> {
    const res = await fetch(`${server}/admin/state`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) return false;
    if (!res.ok) throw new Error(`unexpected ${res.status}`);
    return true;
}

async function handleLoginSubmit(ev: Event): Promise<void> {
    ev.preventDefault();
    const server = loginServerInput.value.trim().replace(/\/$/, '');
    const token = loginTokenInput.value.trim();
    if (!server) { setLoginStatus('server URL required'); return; }
    if (!token) { setLoginStatus('token required'); return; }
    setLoginStatus('verifying...', false);
    try {
        const ok = await verifyToken(server, token);
        if (!ok) { setLoginStatus('invalid token'); return; }
        sessionStorage.setItem(SERVER_KEY, server);
        sessionStorage.setItem(TOKEN_KEY, token);
        touchSession();
        showAdmin();
    } catch (err) {
        setLoginStatus(`error: ${(err as Error).message}`);
    }
}

async function apiCall(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${getServer()}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
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
        if ((err as Error).message !== '401') {
            stateEl.textContent = `error: ${(err as Error).message}`;
        }
    }
}

interface PlayerRow { id: string; name: string | null; massTotal: number; cells: number; }

function renderPlayerList(players: PlayerRow[]): void {
    if (players.length === 0) {
        playersEl.innerHTML = '<em>no players</em>';
        return;
    }
    playersEl.innerHTML = players.map((p) => {
        const display = (p.name && p.name.length > 0) ? p.name : '(unnamed)';
        const safeName = String(p.name || '').replace(/"/g, '&quot;');
        return `<div class="player-row">
            <span>${escapeHtml(display)} · mass ${p.massTotal} · ${p.cells} cell(s)</span>
            <button class="danger kick-btn" data-name="${safeName}">kick</button>
        </div>`;
    }).join('');
    for (const btn of Array.from(playersEl.querySelectorAll<HTMLButtonElement>('.kick-btn'))) {
        btn.addEventListener('click', () => kick(btn.dataset.name || ''));
    }
}

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
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

async function broadcast(): Promise<void> {
    const message = broadcastInput.value.trim();
    if (!message) { setStatus('message required', true); return; }
    setStatus(`broadcasting...`);
    try {
        const res = await apiCall('/admin/broadcast', { method: 'POST', body: JSON.stringify({ message }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `${res.status}`);
        setStatus(`broadcast sent`);
        broadcastInput.value = '';
    } catch (err) {
        if ((err as Error).message !== '401') setStatus(`error: ${(err as Error).message}`, true);
    }
}

loginForm.addEventListener('submit', handleLoginSubmit);
document.getElementById('btn-logout')!.addEventListener('click', () => showLogin('Locked.'));
document.getElementById('btn-broadcast')!.addEventListener('click', () => broadcast());
document.getElementById('btn-refresh')!.addEventListener('click', () => refreshState());

// Boot: if the session is still valid, verify with the server; otherwise
// show login.
async function boot(): Promise<void> {
    const token = getToken();
    const server = getServer();
    if (!token) { showLogin(); return; }
    try {
        const ok = await verifyToken(server, token);
        if (ok) {
            touchSession();
            showAdmin();
        } else {
            showLogin('Stored token rejected. Please unlock again.');
        }
    } catch {
        showLogin('Could not reach the server. Please unlock again.');
    }
}

boot();
