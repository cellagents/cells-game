// Lobby page. Collects a nickname, routes the user to /player or
// /spectator. The theme-toggle button is gated by the same per-view
// UI config that drives the canvas-page chrome; the operator can
// disable it per deployment.

import { applyTheme, currentTheme, attachThemeToggle } from './theme';
import { fetchUiConfig, pruneButton } from './thin/chrome';

applyTheme(currentTheme());

fetchUiConfig('lobby').then((ui) => {
    pruneButton('themeToggle', ui.theme.button);
    const themeBtn = ui.theme.button ? document.getElementById('themeToggle') : null;
    if (themeBtn) attachThemeToggle(themeBtn);
});

const nameInput = document.getElementById('playerNameInput') as HTMLInputElement;
const nickErrorText = document.querySelector('#startMenu .input-error') as HTMLElement;
const playBtn = document.getElementById('startButton') as HTMLButtonElement;
const spectateBtn = document.getElementById('spectateButton') as HTMLButtonElement;

function validNick(value: string): boolean {
    return /^\w+$/.test(value);
}

function play(): void {
    const raw = nameInput.value.trim();
    if (!validNick(raw)) {
        nickErrorText.style.opacity = '1';
        return;
    }
    nickErrorText.style.opacity = '0';
    const name = raw.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    window.location.href = `/player?name=${encodeURIComponent(name)}`;
}

playBtn.addEventListener('click', play);
spectateBtn.addEventListener('click', () => { window.location.href = '/spectator'; });
nameInput.addEventListener('keypress', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') play();
});

// Operator-configured extra links. Rendered as menu-styled anchors
// below Play/Spectate so a deployment can surface links (official
// site, docs, Discord) without rebuilding the client. The server
// already shape-checks the config; we still treat label/href as
// untrusted strings here.
interface LobbyLink { label: string; href: string }
interface LobbyConfigResponse { extraLinks: LobbyLink[] }

fetch('/lobby-config')
    .then((r) => r.ok ? r.json() as Promise<LobbyConfigResponse> : null)
    .then((cfg) => {
        if (!cfg) return;
        renderLinks(document.getElementById('lobbyExtraLinks'), cfg.extraLinks);
    })
    .catch(() => { /* non-fatal: lobby still works without extras */ });

function renderLinks(host: HTMLElement | null, links: LobbyLink[] | undefined): void {
    if (!host || !links || links.length === 0) return;
    for (const l of links) {
        const a = document.createElement('a');
        a.className = 'btn btn-secondary';
        a.textContent = l.label;
        a.href = l.href;
        host.appendChild(a);
    }
}
