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

import { FACTS } from '../../src/components/selector/Facts';

describe('the "1.11.16 vs docs" facts show what they say', () => {
  const runFact = (i: number) => {
    const f = FACTS[i];
    const [key, tag] = f.project.split('-');
    let p = loadProject(key, tag);
    if (f.demo) p = withDemoSelectors(p);
    const sc = f.scenario ? SCENARIOS.find((s) => s.id === f.scenario)!.build(p) : null;
    return runCommand(p, f.cmd, { previous: sc, clock: '00:00:00', shell: 'powershell' });
  };
  it('comma + space', () => {
    const r = runFact(0);
    expect(r.logs.map((l) => l.text)).toContain("The selection criterion 'tag:finance,' does not match any enabled nodes");
    expect(r.output).toEqual(['jaffle_dbt.marts.customer_segments', 'jaffle_dbt.marts.dim_customers']);
  });
  it('bare word and sources', () => expect(runFact(1).output).toEqual([]));
  it('selector: method', () => expect(runFact(2).error?.message).toBe("'selector' is not a valid method name"));
  it('--selector ignores --select/--exclude', () => expect(runFact(3).output).toContain('jaffle_dbt.marts.fct_orders'));
  it('CLI-style string', () => expect(runFact(4).output).toEqual([]));
  it('1+result:fail+', () => expect(runFact(5).output).toEqual([
    'jaffle_dbt.staging.jaffle_shop.stg_jaffle_shop__customers', 'jaffle_dbt.staging.jaffle_shop.stg_jaffle_shop__orders']));
  it('result:error+ after a failed test', () => expect(runFact(6).output).toEqual([]));
  it('group change not detected', () => expect(runFact(7).output).toEqual([]));
  it('new exposures are not state:modified', () => {
    expect(runFact(8).output).toEqual([]);
    const p = loadProject('jaffle', 'ch21');
    const r = runCommand(p, 'dbt ls -s state:new --state ../state --resource-type exposure', { previous: SCENARIOS[0].build(p) });
    expect(r.output.length).toBe(2);
  });
});

import { getCloseMatches, ratio } from '../../src/lib/selector/difflib';

describe('click usage errors (formats checked with real dbt 1.11.16)', () => {
  const p = loadProject('jaffle', 'ch16');
  const err = (line: string) => runCommand(p, line).terminal.join('\n');
  it('difflib = Python', () => {
    const ref = JSON.parse(readFileSync(`${SITE}tests/selector/fixtures/difflib.json`, 'utf8')) as [string, string[], string[], number[]][];
    for (const [w, ps, matches, ratios] of ref) {
      expect(getCloseMatches(w, ps)).toEqual(matches);
      ps.forEach((x, i) => expect(ratio(x, w)).toBeCloseTo(ratios[i], 5));
    }
  });
  it('no such option, with suggestions', () => {
    expect(err('dbt ls --selec x')).toBe("Usage: dbt ls [OPTIONS]\nTry 'dbt ls --help' for help.\n\nError: No such option '--selec'. (Did you mean one of: '--help', '--select', '--selector'?)");
    expect(err('dbt ls --foo')).toBe("Usage: dbt ls [OPTIONS]\nTry 'dbt ls --help' for help.\n\nError: No such option '--foo'.");
    expect(err('dbt run --resource-type model')).toContain("Usage: dbt run [OPTIONS]");
  });
  it('no such command, missing argument', () => {
    expect(err('dbt bild')).toBe("Usage: dbt [OPTIONS] [COMMAND] [ARGS]...\nTry 'dbt --help' for help.\n\nError: No such command 'bild'. Did you mean 'build'?");
    expect(err('dbt ls --select')).toBe("Error: Option '--select' requires an argument.");
    expect(err('dbt ls fct_orders')).toBe("Usage: dbt ls [OPTIONS]\nTry 'dbt ls --help' for help.\n\nError: Got unexpected extra argument (fct_orders)");
  });
});

describe('flags and warnings (outputs checked with real dbt 1.11.16 on tag ch16)', () => {
  const p = loadProject('jaffle', 'ch16');
  const t = (line: string) => runCommand(p, line, { clock: '00:00:00', shell: 'powershell' });
  it('--warn-error-options in YAML forms, silence wins over error all', () => {
    expect(t(`dbt ls -s nope --warn-error-options '{error: all}'`).error?.lines().join('\n')).toBe("Compilation Error\n  The selection criterion 'nope' does not match any enabled nodes");
    const b = t(`dbt ls -s nope --warn-error-options 'error: [NoNodesSelected]'`);
    expect(b.logs.map((l) => l.text)).toContain("The selection criterion 'nope' does not match any enabled nodes");
    expect(b.error?.lines().join('\n')).toBe('Compilation Error\n  No nodes selected!');
    const c = t(`dbt ls -s nope --warn-error-options '{"error": "all", "silence": ["NoNodesForSelectionCriteria", "NoNodesSelected"]}'`);
    expect(c.error).toBeNull();
    expect(c.logs).toEqual([]);
  });
  it('invalid --warn-error-options', () => {
    expect(t(`dbt ls -s nope --warn-error-options notyaml`).terminal.join('\n')).toBe("00:00:00  The YAML provided in the --warn-error-options argument is not valid.\nUsage: dbt ls [OPTIONS]\nTry 'dbt ls --help' for help.\n\nError: Invalid value for '--warn-error-options': String 'notyaml' is not valid YAML");
    expect(t(`dbt ls -s nope --warn-error --warn-error-options '{"error": "all"}'`).error?.message).toBe('warn_error_options: not allowed with argument warn_error');
    expect(t(`dbt ls -s nope --warn-error-options '{"error": ["Bogus"]}'`).error?.message).toBe('Bogus is not a valid dbt error name.');
  });
  it('--models deprecation: after "Running with", summary at the end; an error with --warn-error', () => {
    const r = t('dbt ls -m fct_orders');
    expect(r.terminal.slice(0, 5)).toEqual(['00:00:00  Running with dbt=1.11.16', '00:00:00  [WARNING]: Deprecated functionality',
      'Usage of `--models`, `--model`, and `-m` is deprecated in favor of `--select` or', '`-s`.', '00:00:00  Registered adapter: duckdb=1.11.0']);
    expect(r.terminal[r.terminal.length - 7]).toBe('00:00:00  [WARNING][DeprecationsSummary]: Deprecated functionality');
    expect(t('dbt ls --models=fct_orders').logs).toEqual([]);
    expect(t('dbt --warn-error ls -m fct_orders').error?.lines().join('\n')).toBe('Compilation Error\n  [WARNING]: Deprecated functionality\n  Usage of `--models`, `--model`, and `-m` is deprecated in favor of `--select` or\n  `-s`.');
  });
  it('duplicate flags, attached short values, show and defer checks', () => {
    expect(t('dbt --target prod ls --target dev').error?.message).toBe('target was provided both before and after the subcommand, it can only be set either before or after.');
    expect(t('dbt ls -sfct_orders').output).toEqual(['jaffle_dbt.marts.fct_orders']);
    expect(t('dbt show').error?.lines().join('\n')).toBe('Runtime Error\n  Either --select or --inline must be passed to show');
    expect(t('dbt compile --defer -s stg_stripe__payments').error?.message).toBe('--state or --defer-state are required for deferral, but neither was provided');
    expect(t('dbt compile -s stg_stripe__payments').execution).toEqual([]);
  });
  it('zsh passes # to dbt, bash treats it as a comment', () => {
    expect(runCommand(p, 'dbt ls -s fct_orders # mine', { shell: 'bash' }).output).toEqual(['jaffle_dbt.marts.fct_orders']);
    const z = runCommand(p, 'dbt ls -s fct_orders # mine', { shell: 'zsh' });
    expect(z.logs.map((l) => l.text)).toContain("The selection criterion '#' does not match any enabled nodes");
  });
});
