// Full-text search with Pagefind (static index built after `astro build`). Loaded on first use only.
import { url } from './url';

type PFResult = { id: string; data: () => Promise<{ url: string; excerpt: string; meta: { title?: string; section?: string } }> };
type PF = { search: (q: string) => Promise<{ results: PFResult[] }>; init?: () => Promise<void>; options?: (o: { baseUrl: string }) => Promise<void> };

const PAGE = 12;
let pf: PF | null = null;
let dialog: HTMLDialogElement | null = null;

async function load(): Promise<PF | null> {
  if (pf) return pf;
  try {
    pf = (await import(/* @vite-ignore */ url('pagefind/pagefind.js'))) as PF;
    await pf.options?.({ baseUrl: url('') });
    await pf.init?.();
    return pf;
  } catch {
    return null;
  }
}

function build(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'mc-search';
  d.setAttribute('aria-label', 'Search the course');
  d.innerHTML = `
    <form method="dialog" class="mc-search-box" role="search">
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <input type="search" name="q" placeholder="Search lessons, terms, traps, commands" autocomplete="off" aria-controls="mc-search-results" />
      <button type="submit" class="mc-search-close" value="close" aria-label="Close search">Esc</button>
    </form>
    <p class="mc-search-status" role="status" aria-live="polite"></p>
    <div class="mc-search-list">
      <ol id="mc-search-results" class="mc-search-results"></ol>
      <button type="button" class="btn btn-quiet btn-small mc-search-more" hidden></button>
    </div>`;
  document.body.appendChild(d);
  const input = d.querySelector('input')!;
  const list = d.querySelector('ol')!;
  const status = d.querySelector('.mc-search-status')!;
  let timer = 0;
  let seq = 0;
  const more = d.querySelector<HTMLButtonElement>('.mc-search-more')!;
  let results: PFResult[] = [];
  let shown = 0;
  // 12 results at a time; "Show more results" adds the next ones (their data loads only then)
  const page = async (my: number) => {
    const next = await Promise.all(results.slice(shown, shown + PAGE).map((r) => r.data()));
    if (my !== seq) return;
    list.insertAdjacentHTML('beforeend', next.map((r, i) => `<li><a href="${r.url}" data-i="${shown + i}"><b>${escapeHtml(r.meta.title ?? r.url)}</b>${r.meta.section ? `<span class="mc-search-sec">${escapeHtml(r.meta.section)}</span>` : ''}<span class="mc-search-ex">${r.excerpt}</span></a></li>`).join(''));
    shown += next.length;
    more.hidden = shown >= results.length;
    if (!more.hidden) more.textContent = `Show more results (${results.length - shown} more)`;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) { list.innerHTML = ''; status.textContent = ''; more.hidden = true; return; }
      const engine = await load();
      if (!engine) { status.textContent = 'Search is available on the published site (the index is built with the site).'; return; }
      const res = await engine.search(q);
      if (my !== seq) return;
      results = res.results;
      shown = 0;
      list.innerHTML = '';
      more.hidden = true;
      status.textContent = results.length ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : `No results for "${q}". Try a shorter word, or the English name of a command.`;
      await page(my);
    }, 120);
  });
  more.addEventListener('click', async () => {
    const first = shown;
    await page(seq);
    (list.querySelector(`a[data-i="${first}"]`) as HTMLElement | null)?.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); (list.querySelector('a') as HTMLElement | null)?.focus(); }
  });
  list.addEventListener('keydown', (e) => {
    const a = document.activeElement as HTMLElement;
    const li = a?.closest('li');
    if (e.key === 'ArrowDown') { e.preventDefault(); ((li?.nextElementSibling?.querySelector('a') as HTMLElement | null) ?? (more.hidden ? null : more))?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); const prev = li?.previousElementSibling?.querySelector('a') as HTMLElement | null; (prev ?? input).focus(); }
  });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  return d;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function openSearch() {
  dialog ??= build();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input')?.focus();
  load();
}
