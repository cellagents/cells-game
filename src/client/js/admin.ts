// Admin console. Minimal server-control UI backed by the /admin/* HTTP
// endpoints. The bearer token is cached in sessionStorage so a refresh
// doesn't require re-entering it; it never leaves the browser beyond the
// Authorization header.

const tokenInput = document.getElementById('token') as HTMLInputElement;
const serverInput = document.getElementById('server') as HTMLInputElement;
const broadcastInput = document.getElementById('broadcast-msg') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLElement;
const stateEl = document.getElementById('state') as HTMLElement;
const playersEl = document.getElementById('players') as HTMLElement;

const stored = sessionStorage.getItem('cellagents.adminToken');
if (stored) tokenInput.value = stored;
const storedServer = sessionStorage.getItem('cellagents.gameServer');
if (storedServer) serverInput.value = storedServer;
else if (!serverInput.value) serverInput.value = window.location.origin;

tokenInput.addEventListener('change', () => sessionStorage.setItem('cellagents.adminToken', tokenInput.value));
serverInput.addEventListener('change', () => sessionStorage.setItem('cellagents.gameServer', serverInput.value));

function headers(): HeadersInit {
    return { 'Authorization': `Bearer ${tokenInput.value.trim()}`, 'Content-Type': 'application/json' };
}

function serverBase(): string {
    return serverInput.value.trim().replace(/\/$/, '');
}

function setStatus(text: string, isError = false): void {
    statusEl.textContent = text;
    statusEl.className = isError ? 'status error' : 'status';
}

async function refreshState(): Promise<void> {
    const token = tokenInput.value.trim();
    const server = serverBase();
    if (!token || !server) return;
    try {
        const res = await fetch(`${server}/admin/state`, { headers: headers() });
        if (!res.ok) throw new Error(`${res.status}`);
        const body = await res.json();
        stateEl.textContent = JSON.stringify(body, null, 2);
        renderPlayerList(body.players || []);
    } catch (err) {
        stateEl.textContent = `error: ${(err as Error).message}`;
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
        const res = await fetch(`${serverBase()}/admin/kick`, {
            method: 'POST', headers: headers(), body: JSON.stringify({ name })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `${res.status}`);
        setStatus(`kicked ${name}`);
        refreshState();
    } catch (err) {
        setStatus(`error: ${(err as Error).message}`, true);
    }
}

async function broadcast(): Promise<void> {
    const message = broadcastInput.value.trim();
    if (!message) { setStatus('message required', true); return; }
    setStatus(`broadcasting...`);
    try {
        const res = await fetch(`${serverBase()}/admin/broadcast`, {
            method: 'POST', headers: headers(), body: JSON.stringify({ message })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `${res.status}`);
        setStatus(`broadcast sent`);
        broadcastInput.value = '';
    } catch (err) {
        setStatus(`error: ${(err as Error).message}`, true);
    }
}

document.getElementById('btn-broadcast')!.addEventListener('click', () => broadcast());
document.getElementById('btn-refresh')!.addEventListener('click', () => refreshState());

refreshState();
setInterval(refreshState, 2000);
