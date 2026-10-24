// The "Keyboard shortcuts" dialog (loaded on first use by shortcuts.ts). Lists only shortcuts that exist
// on the site. A native <dialog>: Esc closes it, the focus returns to where it was.

interface Key { keys: string[][]; what: string; then?: boolean }
interface Group { title: string; items: Key[] }

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const GROUPS: Group[] = [
  { title: 'Everywhere', items: [
    { keys: [['?']], what: 'Show this list' },
    { keys: [['Ctrl', 'K']], what: 'Search the course' },
    { keys: [['Esc']], what: 'Close a dialog, the search or this list' },
  ] },
  { title: 'Lessons', items: [
    { keys: [['J']], what: 'Go to the next step' },
    { keys: [['K']], what: 'Go back to the previous step' },
  ] },
  { title: 'Questions: quizzes, drills, mock exams', items: [
    { keys: [['Y'], ['N']], what: 'DOMC: answer YES or NO to the option shown' },
    { keys: [['Enter']], what: 'Fill in the blank: check your answer (quizzes and drills)' },
    { keys: [['↑'], ['↓']], what: 'Hotspot: move between the lines of code' },
    { keys: [['↑'], ['↓'], ['Home'], ['End']], what: 'Build list: move the item whose handle has the focus' },
    { keys: [['←'], ['→'], ['↑'], ['↓']], what: 'Mock exam, "All questions": move between the questions' },
  ] },
  { title: 'Flashcards', items: [
    { keys: [['Space'], ['Enter']], what: 'Show the answer' },
    { keys: [['1'], ['A']], what: 'Again' },
    { keys: [['2'], ['G']], what: 'I knew it' },
  ] },
  { title: 'SQL and Jinja workspaces', items: [
    { keys: [['Ctrl', 'Enter']], what: 'Run the query, or compile the template' },
    { keys: [['Esc'], ['Tab']], what: 'Leave the code editor', then: true },
  ] },
  { title: 'dbt in the browser', items: [
    { keys: [['Ctrl', 'S']], what: 'Save the file' },
    { keys: [['Enter']], what: 'Run the command' },
    { keys: [['↑'], ['↓']], what: 'Earlier commands' },
    { keys: [['Ctrl', 'L']], what: 'Clear the terminal' },
    { keys: [['Control', 'C']], what: 'Stop the running command (when no text is selected)' },
  ] },
  { title: 'Selector playground', items: [
    { keys: [['←'], ['→'], ['↑'], ['↓']], what: 'Move between the models of the graph' },
    { keys: [['Enter']], what: 'Select the model' },
    { keys: [['+'], ['-']], what: 'Zoom in or out' },
  ] },
];

const KEY_NAME: Record<string, string> = { '↑': 'Up arrow', '↓': 'Down arrow', '←': 'Left arrow', '→': 'Right arrow', '?': 'Question mark', '+': 'Plus', '-': 'Minus', Esc: 'Escape' };

const CSS = `
.mc-keys { width: min(760px, calc(100vw - 24px)); max-height: min(86vh, 860px); padding: 0; border: 1px solid var(--line); border-radius: var(--r-panel); background: var(--surface); color: var(--text); box-shadow: var(--shadow-pop); }
.mc-keys::backdrop { background: rgba(10, 16, 32, .45); }
.mc-keys-in { display: grid; grid-template-rows: auto 1fr; max-height: inherit; }
.mc-keys-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 12px; border-bottom: 1px solid var(--line); }
.mc-keys-head h2 { font-size: var(--fs-lg); margin: 0; }
.mc-keys-head p { margin: 2px 0 0; color: var(--muted); font-size: var(--fs-sm); }
.mc-keys-close { margin-left: auto; align-self: start; display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); color: var(--muted); }
.mc-keys-close:hover { color: var(--ink); border-color: var(--line-strong); }
.mc-keys-body:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
.mc-keys-body { overflow-y: auto; padding: 8px 20px 20px; columns: 2 300px; column-gap: 32px; }
.mc-keys-group { break-inside: avoid; padding-top: 12px; }
.mc-keys-group h3 { font-size: var(--fs-sm); text-transform: none; color: var(--accent-strong); margin: 0 0 6px; }
.mc-keys-group dl { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; align-items: baseline; }
.mc-keys-group dl > div { display: contents; }
.mc-keys-group dt { white-space: nowrap; }
.mc-keys-group dd { margin: 0; font-size: var(--fs-sm); color: var(--text); }
.mc-keys kbd { display: inline-block; min-width: 1.7em; padding: 1px 6px; margin: 0 2px 2px 0; font: 600 var(--fs-xs)/1.5 var(--mono); text-align: center; color: var(--ink); background: var(--paper); border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 5px; }
.mc-keys .or { color: var(--muted); font-size: var(--fs-xs); margin: 0 3px; }
@media (max-width: 560px) { .mc-keys-body { columns: 1; padding-inline: 16px; } .mc-keys-head { padding-inline: 16px; } }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}

/** "Ctrl" is ⌘ on a Mac (the site accepts both); "Control" is the Ctrl key on every computer. */
function keyCombo(combo: string[], mac: boolean): HTMLElement {
  const span = el('span', { class: 'mc-keys-combo' });
  const shown = (k: string) => (k === 'Ctrl' && mac ? '⌘' : k === 'Control' ? 'Ctrl' : k);
  const spoken = (k: string) => (k === 'Ctrl' && mac ? 'Command' : k === 'Control' ? 'Control' : KEY_NAME[k] ?? k);
  span.append(el('span', { class: 'visually-hidden' }, combo.map(spoken).join(' + ')));
  combo.forEach((k) => span.append(el('kbd', { 'aria-hidden': 'true' }, shown(k))));
  return span;
}

let dialog: HTMLDialogElement | null = null;

function build(): HTMLDialogElement {
  if (!document.getElementById('mc-keys-css')) document.head.append(el('style', { id: 'mc-keys-css' }, CSS));
  const mac = isMac();
  const d = el('dialog', { class: 'mc-keys', 'aria-labelledby': 'mc-keys-h' });
  const close = el('button', { type: 'button', class: 'mc-keys-close', 'aria-label': 'Close the list of shortcuts' });
  close.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  close.addEventListener('click', () => d.close());
  const head = el('div', { class: 'mc-keys-head' },
    el('div', {}, el('h2', { id: 'mc-keys-h' }, 'Keyboard shortcuts'),
      el('p', {}, mac ? 'On this Mac, the list shows ⌘ (Command) where Windows uses Ctrl. ' : 'On a Mac, use ⌘ (Command) instead of Ctrl, except to stop a dbt command. ', 'One-letter shortcuts work when you are not typing in a field.')),
    close);
  const body = el('div', { class: 'mc-keys-body', tabindex: '0', role: 'group', 'aria-label': 'List of shortcuts' });
  for (const g of GROUPS) {
    const dl = el('dl');
    for (const it of g.items) {
      const dt = el('dt');
      it.keys.forEach((combo, i) => {
        if (i) dt.append(el('span', { class: 'or' }, it.then ? 'then' : 'or'));
        dt.append(keyCombo(combo, mac));
      });
      dl.append(el('div', {}, dt, el('dd', {}, it.what)));
    }
    body.append(el('div', { class: 'mc-keys-group' }, el('h3', {}, g.title), dl));
  }
  d.append(el('div', { class: 'mc-keys-in' }, head, body));
  // a click on the backdrop closes the dialog
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  return d;
}

export function showShortcuts() {
  dialog ??= build();
  if (dialog.open) { dialog.close(); return; }
  dialog.showModal();
  dialog.querySelector<HTMLElement>('.mc-keys-close')?.focus();
}
