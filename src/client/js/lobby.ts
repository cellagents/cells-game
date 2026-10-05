// Lobby page. Collects a nickname, routes the user to /player or
// /spectator. Theme toggle lives here too so the preference is set
// before the gameplay surface loads.

import { applyTheme, currentTheme, attachThemeToggle } from './theme';

applyTheme(currentTheme());
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) attachThemeToggle(themeBtn);

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
