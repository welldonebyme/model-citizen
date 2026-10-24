// Study time: one minute is counted for each minute a page of the site is visible and was used (a key, a click,
// a scroll or a touch) in the last two minutes. Several open tabs count a minute once. While the focus timer
// runs a focus period, it counts the minutes itself (lib/pomodoro.ts), so they are not counted twice.
// Also keeps the computer choice (macOS / Windows / WSL) in the settings, so it travels in the progress file.
import { POMO_KEY, isRunning, sanitize } from './pomodoro';

const IDLE_MS = 2 * 60_000;
const MINUTE_KEY = 'mc:activity-minute';
let lastInput = 0;

const mark = () => { lastInput = Date.now(); };
for (const ev of ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) addEventListener(ev, mark, { passive: true, capture: true });
addEventListener('focus', mark);

function focusTimerRunning(): boolean {
  try {
    const s = sanitize(JSON.parse(localStorage.getItem(POMO_KEY) ?? 'null'));
    return s.phase === 'focus' && isRunning(s);
  } catch { return false; }
}

async function tick() {
  const now = Date.now();
  if (document.visibilityState !== 'visible' || now - lastInput > IDLE_MS || focusTimerRunning()) return;
  const minute = String(Math.floor(now / 60_000));
  try {
    if (localStorage.getItem(MINUTE_KEY) === minute) return; // another tab counted this minute
    localStorage.setItem(MINUTE_KEY, minute);
  } catch { /* storage blocked: count in this tab only */ }
  try {
    const { logActivity } = await import('./store/db');
    await logActivity(1);
  } catch { /* progress cannot be saved in this browser */ }
}
setInterval(tick, 60_000);

// The OS switch writes localStorage (read before the first paint); copy it into the settings too.
document.addEventListener('mc:os', async (e) => {
  const os = (e as CustomEvent<string>).detail;
  if (os !== 'mac' && os !== 'win' && os !== 'wsl') return;
  try { const { saveSettings } = await import('./store/db'); await saveSettings({ os }); } catch { /* not saved */ }
});
// A browser that has no OS choice yet (for example after importing a progress file elsewhere) uses the saved one.
(async () => {
  try {
    if (localStorage.getItem('mc:os')) return;
    const { getSettings } = await import('./store/db');
    const os = (await getSettings()).os;
    if (os) { localStorage.setItem('mc:os', os); document.documentElement.dataset.os = os; }
  } catch { /* storage blocked */ }
})();
