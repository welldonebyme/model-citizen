// Capstone "Hints" steps: show the hints one at a time, so the learner takes only the help they need.
// Without JavaScript every hint stays visible. How many were opened is remembered per step in this browser.
const KEY = (id: string) => `mc:hints:${id}`;

document.querySelectorAll<HTMLElement>('[data-hints]').forEach((step) => {
  const list = step.querySelector<HTMLElement>('.step-body > ul, .step-body > ol');
  const items = list ? [...list.children] as HTMLElement[] : [];
  if (items.length < 2) return;
  let shown = 0;
  try { shown = Math.min(items.length, Number(localStorage.getItem(KEY(step.id)) ?? 0)); } catch { /* storage blocked */ }
  const bar = document.createElement('div');
  bar.className = 'mc-hints-bar';
  bar.innerHTML = '<button type="button" class="btn btn-quiet btn-small"></button><span class="mc-hints-note" aria-live="polite"></span>';
  list!.after(bar);
  const btn = bar.querySelector('button')!;
  const note = bar.querySelector<HTMLElement>('.mc-hints-note')!;
  const render = (focus = false) => {
    items.forEach((li, i) => { li.hidden = i >= shown; });
    btn.textContent = shown === 0 ? 'Show the first hint' : `Show hint ${shown + 1} of ${items.length}`;
    btn.hidden = shown >= items.length;
    note.textContent = shown === 0 ? `${items.length} hints. Try on your own first.` : shown >= items.length ? `All ${items.length} hints shown.` : `${shown} of ${items.length} hints shown.`;
    if (focus && shown > 0) { items[shown - 1].tabIndex = -1; items[shown - 1].focus(); }
  };
  btn.addEventListener('click', () => {
    shown++;
    try { localStorage.setItem(KEY(step.id), String(shown)); } catch { /* storage blocked */ }
    render(true);
  });
  render();
});
