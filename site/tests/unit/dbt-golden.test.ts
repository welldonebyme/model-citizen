// The golden-log comparison used by the dbt e2e tests (tests/dbt/golden.ts).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compare, goldenBlocks, normalize } from '../dbt/golden';

const LOGS = path.resolve(__dirname, '..', '..', '..', 'reference', 'builder-logs');

describe('golden logs', () => {
  it('reads the dbt blocks of a chapter log', () => {
    const b = goldenBlocks(path.join(LOGS, 'ch07.md'));
    expect(b.map((x) => x.command)).toContain('dbt run');
    expect(b.find((x) => x.command === 'dbt run')!.lines.at(-1)).toMatch(/Done\. PASS=7 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=7$/);
  });
  it('normalises only what may differ', () => {
    expect(normalize('20:38:37  4 of 7 OK created sql view model dbt_adnane.stg_jaffle_shop__products .......... [OK in 0.07s]'))
      .toBe('# of 7 OK created sql view model dbt_adnane.stg_jaffle_shop__products ... [OK in Ns]');
    expect(normalize('20:38:37  Finished running 7 view models in 0 hours 0 minutes and 0.21 seconds (0.21s).')).toBe('Finished running 7 view models in T.');
    expect(normalize('12:00:00  Found 5 sources, 7 models, 500 macros')).toBe('Found 5 sources, 500 macros, 7 models');
    expect(normalize('Catalog written to /home/pyodide/dbt-course/jaffle_dbt/target/catalog.json')).toBe('Catalog written to /Users/adnane/dbt-course/jaffle_dbt/target/catalog.json');
    expect(normalize('Done. PASS=7 WARN=0')).not.toBe(normalize('Done. PASS=6 WARN=1'));
  });
  it('a log matches itself; a changed line is reported', () => {
    const g = goldenBlocks(path.join(LOGS, 'ch22.md'));
    const build = g.find((x) => x.command === 'dbt build')!;
    expect(compare(g, [{ command: 'dbt build', lines: [...build.lines].reverse() }])[0]).toMatchObject({ status: 'match', sameOrder: false });
    const bad = build.lines.map((l) => l.replace('PASS=66', 'PASS=65'));
    const r = compare(g, [{ command: 'dbt build', lines: bad }])[0];
    expect(r.status).toBe('diff');
    expect(r.browserOnly.join()).toContain('PASS=65');
  });
});
