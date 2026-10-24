// Shared behaviour for the three design mockups (screens, theme, timer, DOMC, SQL cell).
// Mockup only: the real site runs DuckDB in the browser; here the SQL result is canned from the book.

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- screens ----------
  function show(name) {
    $$('[data-screen]').forEach(s => (s.hidden = s.dataset.screen !== name));
    $$('[data-screen-btn]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.screenBtn === name)));
    document.documentElement.dataset.screenActive = name;
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  }
  $$('[data-screen-btn]').forEach(b => b.addEventListener('click', () => show(b.dataset.screenBtn)));
  $$('[data-go]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); show(b.dataset.go); }));
  show((location.hash || '#today').slice(1));
  window.addEventListener('hashchange', () => show((location.hash || '#today').slice(1)));

  // ---------- theme ----------
  const themeBtn = $('[data-theme-toggle]');
  if (themeBtn) {
    const sync = () => {
      const dark = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      themeBtn.textContent = dark ? 'Light mode' : 'Dark mode';
    };
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
      sync();
    });
    sync();
  }

  // ---------- OS switch ----------
  $$('[data-os-group]').forEach(group => {
    $$('button', group).forEach(btn => btn.addEventListener('click', () => {
      $$('button', group).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      $$('[data-os]').forEach(el => (el.hidden = el.dataset.os !== btn.dataset.osValue));
    }));
  });

  // ---------- exam timer ----------
  const timer = $('[data-timer]');
  if (timer) {
    let left = 1 * 3600 + 47 * 60 + 12;
    const fmt = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
    timer.textContent = fmt(left);
    setInterval(() => { left = Math.max(0, left - 1); timer.textContent = fmt(left); }, 1000);
  }

  // ---------- navigator grid ----------
  $$('[data-nav-grid]').forEach(grid => {
    for (let i = 1; i <= 65; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = i;
      const state = i < 8 ? (i === 5 ? 'flagged' : 'answered') : i === 8 ? 'current' : 'empty';
      b.dataset.state = state;
      b.setAttribute('aria-label', `Question ${i}, ${state}`);
      grid.appendChild(b);
    }
  });
  $$('[data-nav-toggle]').forEach(btn => btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    panel.toggleAttribute('data-open', open);
  }));
  $$('[data-flag]').forEach(btn => btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('[data-flag-label]').textContent = on ? 'Flagged for review' : 'Flag for review';
  }));

  // ---------- DOMC (Mock exam 1, question 8) ----------
  const DOMC = [
    'Every <code>ref()</code> and <code>source()</code> is replaced by a subquery that returns zero rows.',
    'A table name written by hand in the SQL, like <code>from practice.jaffle_shop.orders</code>, is also limited to zero rows.',
    'The SQL is still sent to the warehouse, so a wrong column name still makes the model fail.',
    'dbt still builds the tables and views of the models in the warehouse, with the right columns.',
    'It is a cheap way to check, in CI, that every model compiles and runs, without reading the large input tables.',
  ];
  $$('[data-domc]').forEach(box => {
    let i = 0;
    const text = $('[data-domc-text]', box);
    const label = $('[data-domc-label]', box);
    const trail = $('[data-domc-trail]', box);
    const card = $('[data-domc-card]', box);
    const done = $('[data-domc-done]', box);
    const render = () => {
      label.textContent = `Option ${String.fromCharCode(65 + i)}`;
      text.innerHTML = DOMC[i];
      card.classList.remove('domc-in');
      void card.offsetWidth;
      card.classList.add('domc-in');
    };
    const answer = yes => {
      const chip = document.createElement('li');
      chip.textContent = `${String.fromCharCode(65 + i)} answered`;
      trail.appendChild(chip);
      i++;
      if (i >= DOMC.length) { card.hidden = true; done.hidden = false; return; }
      render();
    };
    $('[data-domc-yes]', box).addEventListener('click', () => answer(true));
    $('[data-domc-no]', box).addEventListener('click', () => answer(false));
    $$('[data-domc-restart]', box).forEach(b => b.addEventListener('click', () => {
      i = 0; trail.innerHTML = ''; card.hidden = false; done.hidden = true; render();
    }));
    render();
  });

  // ---------- SQL cell (canned results from Chapter 4, section "NULL") ----------
  const ROWS = [[17, 'Leo', 'NULL'], [34, 'Leo', 'NULL'], [51, 'Lina', 'NULL'], [68, 'Ben', 'NULL'], [85, 'Hugo', 'NULL']];
  $$('[data-sql]').forEach(cell => {
    const ed = $('[data-sql-editor]', cell);
    const out = $('[data-sql-result]', cell);
    const status = $('[data-sql-status]', cell);
    const run = () => {
      const sql = ed.value.toLowerCase().replace(/\s+/g, ' ');
      const eqNull = /=\s*null/.test(sql) && !/is\s+null/.test(sql);
      const rows = eqNull ? [] : ROWS;
      const head = '<tr><th>id</th><th>first_name</th><th>email</th></tr>';
      const body = rows.map(r => `<tr><td class="num">${r[0]}</td><td>${r[1]}</td><td class="null">${r[2]}</td></tr>`).join('');
      out.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>` +
        (rows.length ? '' : '<p class="empty">0 rows. The query ran without an error.</p>');
      status.dataset.state = eqNull ? 'trap' : 'pass';
      status.innerHTML = eqNull
        ? '<strong>0 rows, and no error.</strong> This is the trap from the book: <code>= null</code> is never true. Change it back to <code>is null</code>.'
        : '<strong>Matches the book:</strong> 5 rows, same columns and values.';
      status.hidden = false;
      cell.dataset.ran = 'true';
    };
    $('[data-sql-run]', cell).addEventListener('click', run);
    ed.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
    $$('[data-sql-try]', cell).forEach(b => b.addEventListener('click', () => {
      ed.value = 'select id, first_name, email\nfrom jaffle_shop.customers\nwhere email = null;';
      run();
    }));
    $$('[data-sql-reset]', cell).forEach(b => b.addEventListener('click', () => {
      ed.value = 'select id, first_name, email\nfrom jaffle_shop.customers\nwhere email is null;';
      out.innerHTML = ''; status.hidden = true; cell.dataset.ran = 'false';
    }));
  });

  // ---------- step "I understood this" ----------
  $$('[data-understood]').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Understood' : 'I understood this';
  }));
})();
