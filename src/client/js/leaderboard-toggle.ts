// Wires the #leaderboardToggle floating button to a body.leaderboard-hidden
// class, and defaults the leaderboard off on narrow (mobile) viewports.
//
// The 800px breakpoint matches the existing mobile tweaks in main.css so
// the chat/leaderboard defaults flip at the same threshold.

const MOBILE_MAX_WIDTH = 800;

export function attachLeaderboardToggle(): void {
    if (window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches) {
        document.body.classList.add('leaderboard-hidden');
    }
    const btn = document.getElementById('leaderboardToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        document.body.classList.toggle('leaderboard-hidden');
    });
}
