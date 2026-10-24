// Small progressive enhancements shared by every page: theme, menu, OS switch, copy buttons, search shortcut.
// Reading pages work without this script; it only adds conveniences.

const root = document.documentElement;

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the preference just does not persist */
  }
}

function isDark() {
  return root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
}

document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    store('mc:theme', next);
  });
});

const menuBtn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const mobileNav = document.getElementById('mobile-nav');
menuBtn?.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  if (mobileNav) mobileNav.hidden = !open;
});

// OS switch: every [data-os-switch] group shows the same choice; blocks marked data-os-only show for one OS.
function applyOs(os: string) {
  root.dataset.os = os;
  document.querySelectorAll<HTMLButtonElement>('[data-os-switch] button[data-os-value]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.osValue === os));
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-os-switch] button[data-os-value]').forEach((b) => {
  b.addEventListener('click', () => {
    const os = b.dataset.osValue!;
    applyOs(os);
    store('mc:os', os);
    document.dispatchEvent(new CustomEvent('mc:os', { detail: os }));
  });
});
applyOs(root.dataset.os || 'mac');

// Copy buttons on code blocks. For shell blocks, only the commands are copied (lines after "$ ").
document.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!btn) return;
  const block = btn.closest('[data-code]');
  if (!block) return;
  const os = root.dataset.os || 'mac';
  const sources = Array.from(block.querySelectorAll<HTMLElement>('[data-copy-source]'));
  const src = sources.find((s) => !s.dataset.osOnly || s.dataset.osOnly.split(' ').includes(os)) ?? sources[0];
  if (!src) return;
  const text = src.dataset.copyText ?? src.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    btn.dataset.done = 'true';
    setTimeout(() => { btn.textContent = old; delete btn.dataset.done; }, 1600);
  } catch {
    btn.textContent = 'Select and copy';
  }
});

// Search: the dialog and the index load on first use.
document.addEventListener('mc:search-open', () => { import('./search').then((m) => m.openSearch()); });

// Ctrl/Cmd + K opens search.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('mc:search-open'));
  }
});
document.querySelectorAll('[data-search-open]').forEach((b) =>
  b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('mc:search-open'))),
);

// Code and figures that scroll sideways must be reachable with the keyboard (WCAG 2.1.1). Only the ones that
// really overflow get a tab stop, so the keyboard path does not go through every code block of a lesson.
function scrollStops() {
  document.querySelectorAll<HTMLElement>('.mc-code-body, .mc-fig-svg, .rv-hunk').forEach((el) => {
    const over = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
    const fig = el.matches('.mc-fig-svg');
    // a figure keeps its description (role img, the book's alt text) when it becomes a scroll stop, and gets it back
    if (fig && el.dataset.alt === undefined) { el.dataset.alt = el.getAttribute('aria-label') ?? ''; el.dataset.role = el.getAttribute('role') ?? ''; }
    if (over && !el.hasAttribute('tabindex')) {
      el.tabIndex = 0;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', fig ? `Figure${el.dataset.alt ? `: ${el.dataset.alt}` : ''}. Scroll sideways to see all of it.` : 'Code, scroll sideways to see all of it');
      el.dataset.scrollStop = '';
    } else if (!over && el.dataset.scrollStop !== undefined) {
      el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label');
      if (fig && el.dataset.role) el.setAttribute('role', el.dataset.role);
      if (fig && el.dataset.alt) el.setAttribute('aria-label', el.dataset.alt);
      delete el.dataset.scrollStop;
    }
  });
}
let scrollTimer = 0;
const queueScrollStops = () => { clearTimeout(scrollTimer); scrollTimer = window.setTimeout(scrollStops, 150); };
scrollStops();
window.addEventListener('resize', queueScrollStops);
document.addEventListener('mc:os', queueScrollStops);
document.addEventListener('mc:content', queueScrollStops); // an island drew new code (the reference viewer)
document.addEventListener('toggle', queueScrollStops, true); // code inside <details> has no width until it opens

// Glossary terms: the French tooltip opens on hover, keyboard focus or a tap, and always stays on the screen
// (content.css clamps its width; here it moves back inside the window, or below the word under the sticky bars).
// On a touch screen the first tap shows the French and the second tap opens the glossary.
function placeTip(term: HTMLElement) {
  const tip = term.querySelector<HTMLElement>('.mc-term-fr');
  if (!tip) return;
  term.style.removeProperty('--dx');
  delete term.dataset.below;
  const r = tip.getBoundingClientRect();
  if (!r.width) return;
  const vw = document.documentElement.clientWidth;
  const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0;
  if (dx) term.style.setProperty('--dx', `${Math.round(dx)}px`);
  const bars = Array.from(document.querySelectorAll<HTMLElement>('.site-header, .lessonbar'))
    .filter((b) => /sticky|fixed/.test(getComputedStyle(b).position)).map((b) => b.getBoundingClientRect().bottom);
  if (r.top < Math.max(0, ...bars) + 4) term.dataset.below = '';
}
function openTip(term: HTMLElement, how: 'hover' | 'focus' | 'tap') {
  if (how === 'tap') document.querySelectorAll<HTMLElement>('.mc-term[data-open="tap"]').forEach((t) => { if (t !== term) delete t.dataset.open; });
  if (term.dataset.open === 'tap' && how !== 'tap') return;
  term.dataset.open = how;
  placeTip(term);
}
function closeTip(term: HTMLElement, how?: string) {
  if (!how || term.dataset.open === how) delete term.dataset.open;
}
const termOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.mc-term') : null);
let touchedTerm: HTMLElement | null = null;
document.addEventListener('mouseover', (e) => { const t = termOf(e.target); if (t && !t.dataset.open) openTip(t, 'hover'); });
document.addEventListener('mouseout', (e) => { const t = termOf(e.target); if (t && !t.contains(e.relatedTarget as Node | null)) closeTip(t, 'hover'); });
document.addEventListener('focusin', (e) => { const t = termOf(e.target); if (t?.matches(':focus-visible')) openTip(t, 'focus'); });
document.addEventListener('focusout', (e) => { const t = termOf(e.target); if (t) closeTip(t, 'focus'); });
document.addEventListener('pointerdown', (e) => {
  touchedTerm = e.pointerType === 'touch' ? termOf(e.target) : null;
  if (!termOf(e.target)) document.querySelectorAll<HTMLElement>('.mc-term[data-open="tap"]').forEach((t) => closeTip(t));
}, true);
document.addEventListener('click', (e) => {
  const t = termOf(e.target);
  if (!t || t !== touchedTerm || t.dataset.open === 'tap') return;
  e.preventDefault();
  openTip(t, 'tap');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll<HTMLElement>('.mc-term[data-open]').forEach((t) => closeTip(t));
});

// Figures: "Enlarge" (or a click on the figure) opens it on the whole screen, larger, still themed (a copy of
// the inline SVG with its ids renamed). On a phone held upright it scrolls both ways; sideways it fits the width.
let figDialog: HTMLDialogElement | null = null;
let figOpener: HTMLElement | null = null;
function figureDialog(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'mc-figbox';
  d.setAttribute('aria-labelledby', 'mc-figbox-t');
  d.innerHTML = `
    <div class="mc-figbox-head"><p id="mc-figbox-t"></p><button type="button" class="btn btn-quiet btn-small" data-figbox-close>Close</button></div>
    <div class="mc-figbox-body" tabindex="0" role="group" aria-label="Enlarged figure, scroll to see all of it"></div>
    <p class="mc-figbox-hint">Turn your phone sideways to see the figure larger.</p>`;
  document.body.appendChild(d);
  d.querySelector('[data-figbox-close]')!.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => { d.querySelector('.mc-figbox-body')!.innerHTML = ''; figOpener?.focus({ preventScroll: true }); figOpener = null; });
  return d;
}
function openFigure(fig: HTMLElement, opener: HTMLElement) {
  const box = fig.querySelector<HTMLElement>('.mc-fig-svg');
  const svg = box?.querySelector('svg');
  if (!box || !svg) return;
  figDialog ??= figureDialog();
  const body = figDialog.querySelector<HTMLElement>('.mc-figbox-body')!;
  body.setAttribute('style', fig.getAttribute('style') ?? '');
  body.innerHTML = svg.outerHTML
    .replace(/\bid="([^"]+)"/g, 'id="$1-big"')
    .replace(/url\(#([^)]+)\)/g, 'url(#$1-big)')
    .replace(/\baria-(labelledby|describedby)="([^"]+)"/g, (_m, a: string, ids: string) => `aria-${a}="${ids.split(/\s+/).map((i) => `${i}-big`).join(' ')}"`);
  figDialog.querySelector('#mc-figbox-t')!.textContent = fig.querySelector('figcaption')?.textContent?.trim() || box.dataset.alt || box.getAttribute('aria-label') || 'Figure';
  figOpener = opener;
  figDialog.showModal();
  figDialog.querySelector<HTMLElement>('[data-figbox-close]')!.focus();
}
document.querySelectorAll<HTMLButtonElement>('[data-fig-zoom]').forEach((b) => { b.hidden = false; });
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  const btn = t.closest<HTMLElement>('[data-fig-zoom]');
  const fig = (btn ?? t.closest('.mc-fig-svg'))?.closest<HTMLElement>('figure.mc-fig');
  if (!fig || !fig.querySelector('[data-fig-zoom]')) return;
  if (!btn && !(window.getSelection()?.isCollapsed ?? true)) return; // selecting text in the figure
  openFigure(fig, btn ?? fig.querySelector<HTMLElement>('[data-fig-zoom]')!);
});
