// Golden comparison @long: the chapter scenarios run in the real browser terminal and are compared with the
// builder logs (reference/builder-logs/chNN.md), ignoring timestamps, durations and thread order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { compare, goldenBlocks, report } from './golden';
import { run, startWorkspace } from './helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.resolve(HERE, '..', '..', '..', 'reference', 'builder-logs');
const OUT = path.resolve(HERE, '..', '..', 'test-results', 'dbt-golden');

// the commands of the chapters' golden logs, in the same order (spikes/dbt-pyodide/scenarios/)
const SCENARIOS: { chapter: string; preset: string; commands: string[] }[] = [
  {
    chapter: 'ch07',
    preset: 'ch07-end',
    commands: [
      'dbt run',
      'dbt build',
      'dbt compile',
      'dbt compile --select stg_stripe__payments',
      'dbt ls',
      'dbt ls --resource-type source',
      'dbt ls --select +dim_customers',
      'dbt show --select dim_customers --limit 10',
      `dbt show --inline "select customer_id, number_of_orders, lifetime_value from {{ ref('dim_customers') }} order by customer_id" --limit 10`,
      `dbt show --inline "select count(*) as n_customers, sum(number_of_orders) as total_orders, sum(lifetime_value) as total_lifetime_value, count(*) filter (where number_of_orders = 0) as customers_without_orders from {{ ref('dim_customers') }}"`,
      `dbt show --inline "select count(*) as n_orders, sum(amount) as total_amount from {{ ref('fct_orders') }}"`,
      'dbt docs generate',
    ],
  },
  {
    chapter: 'ch22',
    preset: 'ch22-end',
    commands: ['dbt parse --no-partial-parse', 'dbt build'],
  },
];

for (const sc of SCENARIOS) {
  test(`${sc.chapter} golden log matches the browser terminal @long`, async ({ page, browserName }) => {
    const info = await startWorkspace(page, sc.preset);
    const captured = [];
    for (const c of sc.commands) captured.push(await run(page, c));
    const results = compare(goldenBlocks(path.join(GOLDEN, `${sc.chapter}.md`)), captured);
    const text = report(results);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${browserName}-${sc.chapter}.txt`), `${browserName} ${sc.chapter} (preset ${sc.preset})\nboot: ${JSON.stringify(info)}\n\n${text}\n`);
    fs.writeFileSync(path.join(OUT, `${browserName}-${sc.chapter}.log`), captured.map((c) => `$ ${c.command}\n${c.lines.join('\n')}\n[exit ${c.code}]`).join('\n'));
    console.log(`${browserName} ${sc.chapter}\n${text}`);
    expect(results.filter((r) => r.status !== 'match').map((r) => r.command)).toEqual([]);
  });
}
