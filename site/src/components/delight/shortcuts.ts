// Keyboard shortcuts for every page (tiny; the list itself loads on first use):
//   ?      shows the list of the site's keyboard shortcuts (also: document event 'mc:shortcuts-open')
//   J / K  lesson pages: next step / previous step
// One-letter shortcuts never fire while you type in a field, an editor or the terminal.
// Base layout: <script>import '../components/delight/shortcuts';</script>

const isTyping = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor, [role="textbox"]');

export function openShortcuts() {
  import('./shortcuts-dialog').then((m) => m.showShortcuts());
}

/** Lesson pages: moves to the next (1) or previous (-1) step, puts the focus on its heading. */
export function moveStep(dir: 1 | -1): boolean {
  const steps = Array.from(document.querySelectorAll<HTMLElement>('[data-step]'));
  if (!steps.length) return false;
  const line = 180; // reading line, below the sticky header and lesson bar
  let cur = -1;
  steps.forEach((s, i) => { if (s.getBoundingClientRect().top <= line) cur = i; });
  let i: number;
  if (dir === 1) i = cur + 1;
  else i = cur >= 0 && steps[cur].getBoundingClientRect().top < line - 60 ? cur : cur - 1;
  const target = steps[Math.max(0, Math.min(steps.length - 1, i))];
  if (!target || (dir === 1 && i >= steps.length)) return false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  const h = target.querySelector<HTMLElement>('h2, h3');
  if (h) {
    if (!h.hasAttribute('tabindex')) h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }
  return true;
}

if (typeof document !== 'undefined' && !(window as Window & { __mcKeys?: boolean }).__mcKeys) {
  (window as Window & { __mcKeys?: boolean }).__mcKeys = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === '?') {
      if (document.querySelector('dialog[open]:not(.mc-keys)')) return;
      e.preventDefault();
      openShortcuts();
      return;
    }
    if ((e.key === 'j' || e.key === 'k') && !e.shiftKey && !document.querySelector('dialog[open]')) {
      if (moveStep(e.key === 'j' ? 1 : -1)) e.preventDefault();
    }
  });
  document.addEventListener('mc:shortcuts-open', openShortcuts);
}
