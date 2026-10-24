/** Building blocks checked against Python 3.12 / real dbt 1.11.16 reference data, on every tag. */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fnmatch } from '../../src/lib/selector/fnmatch';
import { VirtualFs } from '../../src/lib/selector/vfs';
import { jsonLine, runCommand } from '../../src/lib/selector/tasks';
import { parseCommandLine } from '../../src/lib/selector/cli';
import { compareLs, parseLsOutput } from '../../src/lib/selector/lsparse';
import { explain } from '../../src/lib/selector/explain';
import { SCENARIOS } from '../../src/lib/selector/scenarios';
import { loadProject, lsJsonFixture, SITE } from './load';

const ref = JSON.parse(readFileSync(`${SITE}tests/selector/fixtures/python-reference.json`, 'utf8')) as {
  fnmatch: [string, string, boolean][]; glob: Record<string, string[] | { error: string }>;
};

describe('fnmatch = Python fnmatch.fnmatch (POSIX)', () => {
  for (const [name, pat, want] of ref.fnmatch) {
    it(`${JSON.stringify(name)} ~ ${JSON.stringify(pat)}`, () => expect(fnmatch(name, pat)).toBe(want));
  }
});

describe('path globbing = Python 3.12 Path.glob (jaffle ch25 checkout)', () => {
  const p = loadProject('jaffle', 'ch25');
  for (const [pat, want] of Object.entries(ref.glob)) {
    it(pat, () => {
      if (!Array.isArray(want)) return; // Python raised (absolute, '**' inside a part): checked in the differential test
      let got: string[];
      try { got = [...p.fs.glob(pat)].sort(); } catch (e) { got = [`error: ${(e as Error).message}`]; }
      // the playground's file list is the git checkout (no .git folder): same as the archive used for the reference
      expect(got).toEqual(want.map((x) => x || '.'));
    });
  }
});

const tags = readdirSync(`${SITE}src/generated/dag`).filter((f) => /^(jaffle|shopflow)-\w+\.json$/.test(f)).map((f) => f.replace('.json', ''));

describe('every tag: dbt ls --resource-type all prints exactly what real dbt printed', () => {
  for (const id of tags) {
    it(id, () => {
      const [key, tag] = id.split('-');
      const p = loadProject(key, tag);
      const r = runCommand(p, 'dbt ls --resource-type all', { clock: '00:00:00' });
      expect(r.output).toEqual(p.dag.ls_all);
    });
  }
});

describe('every tag: the default `dbt ls --output json` line of every node is byte-exact', () => {
  for (const id of tags) {
    it(id, () => {
      const [key, tag] = id.split('-');
      const p = loadProject(key, tag);
      const fx = lsJsonFixture(key, tag);
      for (const [uid, line] of Object.entries(fx)) expect(jsonLine(p, uid, [], 'dev')).toBe(line);
    });
  }
});

describe('command line', () => {
  it('multi-value options eat words until the next option', () => {
    const c = parseCommandLine('dbt ls -s a b c --exclude d e --resource-type model test -q');
    expect(c.args.select).toEqual(['a', 'b', 'c']);
    expect(c.args.exclude).toEqual(['d', 'e']);
    expect(c.args.resourceTypes).toEqual(['model', 'test']);
    expect(c.args.quiet).toBe(true);
  });
  it('zsh stops on an unquoted star that matches no file', () => {
    const p = loadProject('jaffle', 'ch16');
    const r = runCommand(p, 'dbt ls -s stg_*');
    expect(r.error?.message).toBe('zsh: no matches found: stg_*');
    expect(runCommand(p, 'dbt ls -s "stg_*"').output.length).toBe(15);
    expect(runCommand(p, 'dbt ls -s stg_*', { shell: 'powershell' }).output.length).toBe(15);
  });
  it('env vars: DBT_ENGINE_ wins over DBT_, the CLI wins over both', () => {
    const p = loadProject('jaffle', 'ch19');
    const a = runCommand(p, 'DBT_EXCLUDE_RESOURCE_TYPES=unit_test DBT_ENGINE_EXCLUDE_RESOURCE_TYPES=test dbt ls -s +fct_orders --resource-type unit_test model');
    expect(a.output.some((l) => l.startsWith('unit_test:'))).toBe(true);
    const b = runCommand(p, 'DBT_ENGINE_INDIRECT_SELECTION=empty dbt ls -s stg_stripe__payments');
    expect(b.output).toEqual(['jaffle_dbt.staging.stripe.stg_stripe__payments']);
  });
  it('--warn-error turns "does not match" into a Compilation Error', () => {
    const p = loadProject('jaffle', 'ch16');
    const r = runCommand(p, 'dbt ls -s nothing_here --warn-error');
    expect(r.error?.lines().join('\n')).toBe("Compilation Error\n  The selection criterion 'nothing_here' does not match any enabled nodes");
  });
});

describe('build order (one thread) and resource types', () => {
  it('dbt build: unit tests right before their model, tests after it', () => {
    const p = loadProject('jaffle', 'ch24');
    const r = runCommand(p, 'dbt build -s +fct_orders');
    const order = r.execution.map((s) => s.uid);
    const ut = order.indexOf('unit_test.jaffle_dbt.fct_orders.test_fct_orders_incremental_keeps_only_new_rows');
    const m = order.indexOf('model.jaffle_dbt.fct_orders');
    expect(ut).toBeGreaterThanOrEqual(0);
    expect(m).toBe(ut + 1);
    const t = order.indexOf('test.jaffle_dbt.unique_fct_orders_order_id.3ec4e3b6b2');
    expect(t === -1 || t > m).toBe(true);
    expect(r.execution.find((s) => s.uid === 'model.jaffle_dbt.int_payments__successful')?.index).toBeNull();
  });
  it('dbt run ignores seeds: Nothing to do', () => {
    const p = loadProject('jaffle', 'ch16');
    const r = runCommand(p, 'dbt run -s country_regions');
    expect(r.logs.map((l) => l.text)).toContain('Nothing to do. Try checking your model configs and model specification args');
  });
});

describe('scenarios', () => {
  it('every scenario builds on its tag', () => {
    for (const s of SCENARIOS) {
      if (s.tag === '*') continue;
      const p = loadProject(s.key as string, s.tag);
      expect(s.build(p), s.id).not.toBeNull();
    }
  });
});

describe('paste-to-verify parser', () => {
  it('keeps node lines, drops logs', () => {
    const text = `$ dbt ls -s +fct_orders --resource-type model
22:27:31  Running with dbt=1.11.16
22:27:31  Registered adapter: duckdb=1.11.0
22:27:32  Found 14 models, 2 analyses, 1 seed, 14 data tests, 2 snapshots, 5 sources, 669 macros
jaffle_dbt.marts.fct_orders
jaffle_dbt.intermediate.int_orders__enriched
`;
    const p = parseLsOutput(text);
    expect(p.nodes).toEqual(['jaffle_dbt.marts.fct_orders', 'jaffle_dbt.intermediate.int_orders__enriched']);
    expect(p.format).toBe('selector');
    const c = compareLs(['jaffle_dbt.marts.fct_orders'], p.nodes);
    expect(c.ok).toBe(false);
    expect(c.extra).toEqual(['jaffle_dbt.intermediate.int_orders__enriched']);
  });
  it('JSON lines compare as objects', () => {
    expect(compareLs(['{"name": "a", "x": 1}'], ['{"x":1,"name":"a"}']).ok).toBe(true);
  });
});

describe('explanations', () => {
  it('names each part of the expression', () => {
    const p = loadProject('jaffle', 'ch16');
    const r = runCommand(p, 'dbt ls -s +fct_orders --exclude tag:staging --resource-type model');
    const lines = explain(p, r);
    expect(lines.find((l) => l.part === '+fct_orders')?.text).toContain('all its parents');
    expect(lines.some((l) => l.part === '--exclude')).toBe(true);
    expect(lines.some((l) => l.part.includes('--resource-type model'))).toBe(true);
  });
});

import { CHALLENGES, checkChallenge } from '../../src/lib/selector/challenges';

describe('challenges', () => {
  for (const c of CHALLENGES) {
    it(`${c.id}: the answer passes, the start fails`, () => {
      const [key, tag] = c.project.split('-');
      const p = loadProject(key, tag);
      expect(checkChallenge(p, c, c.answer)).toMatchObject({ ok: true });
      if (c.start) expect(checkChallenge(p, c, c.start).ok).toBe(false);
      expect(checkChallenge(p, c, '').ok).toBe(false);
    });
  }
  it('another correct expression is accepted', () => {
    const c = CHALLENGES.find((x) => x.id === 'parents-first-degree')!;
    const p = loadProject('jaffle', 'ch16');
    expect(checkChallenge(p, c, 'dbt ls -s 1+fct_orders').ok).toBe(true);
    expect(checkChallenge(p, c, 'fct_orders int_orders__enriched int_orders__payment_methods_pivoted').message).toContain('Right nodes, but');
  });
});

import { withDemoSelectors } from '../../src/lib/selector/demo-selectors';

describe('demo selectors (real dbt 1.11.16 on ch16 with the same selectors.yml lines)', () => {
  const p = withDemoSelectors(loadProject('jaffle', 'ch16'));
  const run = (s: string) => runCommand(p, `dbt ls --selector ${s} --resource-type model`, { clock: '00:00:00' });
  it('CLI-style strings with a space or a comma select nothing', () => {
    expect(run('cli_union').output).toEqual([]);
    expect(run('cli_union').logs.map((l) => l.text)).toContain('No nodes selected!');
    expect(run('cli_intersection').output).toEqual([]);
    expect(run('cli_union').notes.join(' ')).toContain('ONE criterion');
  });
  it('graph operators and the one-key form work', () => {
    expect(run('cli_parents').output).toEqual([
      'jaffle_dbt.marts.fct_orders', 'jaffle_dbt.intermediate.int_orders__enriched', 'jaffle_dbt.intermediate.int_orders__payment_methods_pivoted',
      'jaffle_dbt.intermediate.int_payments__successful', 'jaffle_dbt.staging.jaffle_shop.stg_jaffle_shop__customers',
      'jaffle_dbt.staging.jaffle_shop.stg_jaffle_shop__orders', 'jaffle_dbt.staging.stripe.stg_stripe__payments']);
    expect(run('one_key').output).toEqual(['jaffle_dbt.marts.fct_monthly_revenue', 'jaffle_dbt.marts.fct_order_items', 'jaffle_dbt.marts.fct_order_items_daily', 'jaffle_dbt.marts.fct_orders']);
  });
});

import { Project as ProjectClass } from '../../src/lib/selector/project';

describe('YAML selector forms vs real dbt 1.11.16 (tag ch18 + extra selectors)', () => {
  const fx = JSON.parse(readFileSync(`${SITE}tests/selector/fixtures/yaml-selectors-ch18.json`, 'utf8')) as {
    yml: string; selectors: { name: string; definition: unknown }[]; real: Record<string, string[]>;
  };
  const base = loadProject('jaffle', 'ch18');
  const selectors = { ...base.selectors };
  for (const s of fx.selectors) selectors[s.name] = s;
  const p = new ProjectClass({ ...base.dag, selectors, selectors_yml: (base.dag.selectors_yml ?? '') + fx.yml }, base.extras);
  for (const [name, lines] of Object.entries(fx.real)) {
    it(name, () => {
      const r = runCommand(p, `dbt -q ls --selector ${name}`, { clock: '00:00:00' });
      expect(r.error).toBeNull();
      expect(r.output).toEqual(lines);
    });
  }
});
