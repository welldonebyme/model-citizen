import { expect, test } from '@playwright/test';
import { foreign, pyReady, setEditor, trackErrors, trackRequests, writeReport } from './helpers';
import exercises from '../../src/lib/py/cases/yaml-exercises.json' with { type: 'json' };

test.describe('YAML playground', () => {
  test('live validation, line/column, dbt and PyYAML words, an exercise solved', async ({ page }) => {
    const errors = trackErrors(page);
    const urls = trackRequests(page);
    await page.goto('labs/yaml/');
    await pyReady(page);
    const tool = page.getByTestId('yaml-tool');
    // the first exercise is the Chapter 5 lab: yaml.safe_load words, line 5 column 38
    await expect(tool.getByTestId('yaml-message')).toHaveText(/yaml\.scanner\.ScannerError: mapping values are not allowed here\s+in "broken\.yml", line 5, column 38/);
    await expect(tool.getByTestId('yaml-state')).toHaveText('Line 5, column 38');
    await expect(tool.locator('.cm-line.mc-diag-line')).toHaveCount(1);
    await expect(tool.locator('.cm-line.mc-diag-line')).toContainText('description: Payments from Stripe: one row per payment');
    // same file, dbt words
    await tool.getByTestId('mode-dbt').click();
    await expect(tool.getByTestId('yaml-message')).toContainText('mapping values are not allowed in this context');
    await expect(tool.getByTestId('yaml-message')).toContainText('Parsing Error');
    await tool.getByTestId('mode-pyyaml').click();
    // fix it: solved
    const lab = exercises.exercises.find((e) => e.id === 'lab-broken-yml')!;
    await setEditor(page, 'yaml-editor', lab.solution);
    await expect(tool.getByTestId('exercise-check')).toHaveAttribute('data-solved', 'true');
    await expect(tool.getByTestId('yaml-ok')).toBeVisible();
    await expect(page.locator('[data-exercise="lab-broken-yml"] .mcl-ex-state')).toHaveAttribute('data-state', 'solved');
    expect(foreign(urls)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a book example: the dbt duplicate-key warning, as in the book', async ({ page }) => {
    await page.goto('labs/yaml/');
    await pyReady(page);
    await page.locator('.mcl-book-cases > summary').click();
    await page.locator('[data-case="ch05-m5-dupkey"]').click();
    const tool = page.getByTestId('yaml-tool');
    await expect(tool.getByTestId('case-grade')).toHaveAttribute('data-passed', 'true');
    await expect(tool.getByTestId('yaml-warning')).toContainText('[WARNING][DuplicateYAMLKeysDeprecation]: Deprecated functionality');
  });

  test('@long YAML parity: all book cases, every exercise (start fails, solution passes)', async ({ page, browserName }) => {
    test.setTimeout(300_000);
    await page.goto('labs/yaml/');
    await pyReady(page);
    const parity = await page.evaluate(async () => {
      const g = globalThis as unknown as { __mcPy: { validate(r: unknown): Promise<unknown> }; __mcYaml: { cases: { id: string }[]; request(c: unknown): unknown; grade(c: unknown, r: unknown): { id: string; passed: boolean; byteExact: boolean | null; detail?: string; book: string; got: string | null } } };
      const out = [];
      for (const c of g.__mcYaml.cases) out.push(g.__mcYaml.grade(c, await g.__mcPy.validate(g.__mcYaml.request(c))));
      return out;
    });
    const info = await page.evaluate(() => (globalThis as Record<string, unknown>).__mcPyInfo);
    const rows: { id: string; start: string; solution: string }[] = [];
    for (const ex of exercises.exercises) {
      await page.locator(`[data-exercise="${ex.id}"]`).click();
      const check = page.getByTestId('exercise-check');
      await expect(check).toHaveAttribute('data-solved', 'false');
      await setEditor(page, 'yaml-editor', ex.solution);
      await expect(check, ex.id).toHaveAttribute('data-solved', 'true');
      rows.push({ id: ex.id, start: 'not solved', solution: 'solved' });
    }
    writeReport(`yaml-parity-${browserName}.json`, { info, cases: parity, exercises: rows });
    const passed = parity.filter((r) => r.passed).length;
    console.log(`[${browserName}] YAML parity ${passed}/${parity.length} (byte-exact where compared: ${parity.filter((r) => r.byteExact).length}/${parity.filter((r) => r.byteExact !== null).length}); exercises ${rows.length}/${exercises.exercises.length}`);
    for (const r of parity) expect.soft(r.passed, `${r.id}: ${r.detail ?? ''} book=${r.book} got=${r.got}`).toBe(true);
    expect(parity).toHaveLength(37);
  });
});
