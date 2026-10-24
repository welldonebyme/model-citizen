// Adds "Check your output" under every terminal block that the book follows with its result.
// The learner pastes what their own terminal printed; the parsers load on first use.

function enhance() {
  document.querySelectorAll<HTMLElement>('figure.mc-out').forEach((out) => {
    const prev = out.previousElementSibling as HTMLElement | null;
    if (!prev?.matches('figure.mc-term-block') || out.nextElementSibling?.matches('.mc-verify')) return;
    const expected = out.querySelector<HTMLElement>('[data-copy-text]')?.dataset.copyText ?? out.textContent ?? '';
    const d = document.createElement('details');
    d.className = 'mc-verify';
    const id = `${out.id || Math.random().toString(36).slice(2)}-verify`;
    d.innerHTML = `
      <summary>Check your output</summary>
      <label for="${id}">Run the command on your computer, then paste everything it printed:</label>
      <textarea id="${id}" rows="6" spellcheck="false" placeholder="Paste here"></textarea>
      <div class="mc-verify-row"><button type="button" class="btn btn-ink btn-small">Check</button><span class="mc-verify-note">Nothing leaves your browser.</span></div>
      <div class="mc-verify-result" role="status" aria-live="polite"></div>`;
    out.after(d);
    const ta = d.querySelector('textarea')!;
    const res = d.querySelector<HTMLElement>('.mc-verify-result')!;
    d.querySelector('button')!.addEventListener('click', async () => {
      const { compareOutput } = await import('./parsers');
      const v = compareOutput(expected, ta.value);
      res.dataset.ok = String(v.ok);
      res.innerHTML = `<p class="mc-verify-head">${v.ok ? 'Matches the book.' : 'Not the same as the book yet.'}</p><ul>${v.messages.map((m) => `<li>${m.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</li>`).join('')}</ul>`;
    });
  });
}
enhance();
