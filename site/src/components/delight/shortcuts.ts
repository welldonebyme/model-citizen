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
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const line = pad + 100; // reading line, a little below where a step starts after a jump
  let cur = -1;
  steps.forEach((s, i) => { if (s.getBoundingClientRect().top <= line) cur = i; });
  // K inside a step (its start already scrolled away) goes back to its start; at its start, to the previous one
  const i = dir === 1 ? cur + 1 : cur >= 0 && steps[cur].getBoundingClientRect().top < pad - 24 ? cur : cur - 1;
  if (i < 0 || i >= steps.length) return false;
  const target = steps[i];
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
