import { expect, test, type Page } from '@playwright/test';
import { foreign, pyReady, setEditor, trackErrors, trackRequests, writeReport } from './helpers';
import exercises from '../../src/lib/py/cases/jinja-exercises.json' with { type: 'json' };
import synthetic from './data/jinja-synthetic.json' with { type: 'json' };

type G = { id: string; passed: boolean; byteExact: boolean | null; detail?: string; book: string; got: string | null };

async function solve(page: Page, id: string) {
  const ex = exercises.exercises.find((e) => e.id === id)!;
  await page.locator(`[data-exercise="${id}"]`).click();
  await setEditor(page, 'jinja-editor', ex.solution.template);
  if (ex.solution.macros !== undefined) await setEditor(page, 'macros-editor', ex.solution.macros);
  await page.getByTestId('compile').click();
}

test.describe('Jinja playground', () => {
  test('render, fix the trailing comma, run the SQL in DuckDB', async ({ page }) => {
    const errors = trackErrors(page);
    const urls = trackRequests(page);
    await page.goto('labs/jinja/');
    await pyReady(page);
    const tool = page.getByTestId('jinja-tool');
    await tool.getByTestId('compile').click();
    await expect(tool.getByTestId('compiled-text')).toContainText('as gift_card_amount,\nfrom stripe.payments');
    await expect(tool.getByTestId('exercise-check')).toHaveAttribute('data-solved', 'false');
    // as the book says (Lesson 5.3), DuckDB accepts the trailing comma that other warehouses reject
    await tool.getByTestId('run-compiled').click();
    await expect(tool.getByTestId('result-grid')).toBeVisible();
    await solve(page, 'trailing-comma');
    await expect(tool.getByTestId('exercise-check')).toHaveAttribute('data-solved', 'true');
    await expect(tool.getByTestId('exercise-check')).toContainText('byte for byte');
    await tool.getByTestId('run-compiled').click();
    await expect(tool.getByTestId('result-grid').locator('thead th')).toHaveText(['order_id', 'credit_card_amount', 'coupon_amount', 'bank_transfer_amount', 'gift_card_amount']);
    await expect(tool.getByTestId('result-meta')).toContainText('rows');
    expect(foreign(urls)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('run_query answered by DuckDB-WASM: the execute guard exercise', async ({ page }) => {
    await page.goto('labs/jinja/');
    await pyReady(page);
    await page.locator('[data-exercise="execute-guard"]').click();
    const tool = page.getByTestId('jinja-tool');
    await tool.getByTestId('compile').click();
    await expect(tool.getByTestId('jinja-error')).toContainText("'None' has no attribute 'table'");
    await solve(page, 'execute-guard');
    await expect(tool.getByTestId('exercise-check')).toHaveAttribute('data-solved', 'true', { timeout: 90_000 });
    await expect(tool.getByTestId('compiled-text')).toContainText("sum(case when payment_method = 'bank_transfer' then amount else 0 end) as bank_transfer_amount");
    await tool.getByTestId('run-compiled').click();
    await expect(tool.getByTestId('result-grid').locator('thead th')).toHaveText(['order_id', 'bank_transfer_amount', 'coupon_amount', 'credit_card_amount', 'gift_card_amount']);
  });

  test('@long Jinja parity: all book cases, exercises, synthetic cases vs real dbt', async ({ page, browserName }) => {
    test.setTimeout(400_000);
    await page.goto('labs/jinja/');
    await pyReady(page);
    const parity = await page.evaluate(async (syn) => {
      const g = globalThis as unknown as {
        __mcPy: { render(r: unknown, o?: unknown): Promise<unknown> };
        __mcJinja: { cases: unknown[]; request(c: unknown): unknown; grade(c: unknown, r: unknown): G; ensureModels(): Promise<string[]> };
        __mcSqlEngine?: { run(sql: string): Promise<unknown> };
      };
      const models = await g.__mcJinja.ensureModels();
      const book: G[] = [];
      for (const c of g.__mcJinja.cases) book.push(g.__mcJinja.grade(c, await g.__mcPy.render(g.__mcJinja.request(c), { timeoutMs: 20_000 })));
      // synthetic cases (checked against real dbt): is_incremental() needs the model's table to exist
      await g.__mcSqlEngine!.run('create table if not exists "practice"."dbt_adnane"."syn_incr" as select 1 as x');
      const extra: G[] = [];
      for (const c of syn) extra.push(g.__mcJinja.grade(c, await g.__mcPy.render(g.__mcJinja.request(c), { timeoutMs: 20_000 })));
      return { models, book, extra };
    }, synthetic.cases);
    const rows: string[] = [];
    for (const ex of exercises.exercises) {
      await page.locator(`[data-exercise="${ex.id}"]`).click();
      await page.getByTestId('compile').click();
      const check = page.getByTestId('exercise-check');
      const unchanged = ex.template === ex.solution.template && (ex.macros ?? '') === (ex.solution.macros ?? '');
      await expect(check).toHaveAttribute('data-solved', unchanged ? 'true' : 'false');
      await solve(page, ex.id);
      await expect(check, ex.id).toHaveAttribute('data-solved', 'true');
      rows.push(ex.id);
    }
    const info = await page.evaluate(() => (globalThis as Record<string, unknown>).__mcPyInfo);
    writeReport(`jinja-parity-${browserName}.json`, { info, models: parity.models, cases: parity.book, synthetic: parity.extra, exercises: rows });
    const passed = parity.book.filter((r) => r.passed).length;
    const compared = parity.book.filter((r) => r.byteExact !== null);
    console.log(`[${browserName}] Jinja parity ${passed}/${parity.book.length} (byte-exact ${compared.filter((r) => r.byteExact).length}/${compared.length} of the cases with a text output); synthetic vs real dbt ${parity.extra.filter((r) => r.passed).length}/${parity.extra.length}; exercises ${rows.length}/${exercises.exercises.length}; models created: ${parity.models.length}`);
    for (const r of [...parity.book, ...parity.extra]) expect.soft(r.passed, `${r.id}: ${r.detail ?? ''} book=${r.book} got=${r.got}`).toBe(true);
    expect(parity.book).toHaveLength(41);
  });

  test('@long timeouts: soft deadline keeps the worker, hard timeout respawns it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('labs/jinja/');
    await pyReady(page);
    const r = await page.evaluate(async () => {
      const py = (globalThis as unknown as { __mcPy: { render(r: unknown, o?: unknown): Promise<{ status: string; compiled: string | null }>; stats: { spawns: number } } }).__mcPy;
      const t0 = performance.now();
      const soft = await py.render({ mode: 'plain', template: '{% for i in range(100000) %}{% for j in range(100000) %}{% endfor %}{% endfor %}', deadlineMs: 1500 }, { timeoutMs: 8000 });
      const softMs = Math.round(performance.now() - t0);
      const after = await py.render({ mode: 'plain', template: '{{ 1 + 1 }}' });
      const spawnsBefore = py.stats.spawns;
      const t1 = performance.now();
      let hard = '';
      try { await py.render({ mode: 'plain', template: '{{ 9 ** (9 ** 8) }}' }, { timeoutMs: 4000 }); } catch (e) { hard = (e as { code?: string }).code ?? String(e); }
      const hardMs = Math.round(performance.now() - t1);
      const t2 = performance.now();
      const again = await py.render({ mode: 'plain', template: '{{ "ok" }}' }, { timeoutMs: 60_000 });
      return { soft: soft.status, softMs, after: after.compiled, hard, hardMs, respawnMs: Math.round(performance.now() - t2), again: again.compiled, spawns: py.stats.spawns - spawnsBefore };
    });
    console.log(`timeouts: soft ${r.softMs} ms, hard ${r.hardMs} ms, respawn + render ${r.respawnMs} ms`);
    expect(r.soft).toBe('timeout');
    expect(r.softMs).toBeLessThan(4000);
    expect(r.after).toBe('2');
    expect(r.hard).toBe('TIMEOUT');
    expect(r.spawns).toBe(1);
    expect(r.again).toBe('ok');
  });
});
