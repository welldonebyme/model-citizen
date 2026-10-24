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
