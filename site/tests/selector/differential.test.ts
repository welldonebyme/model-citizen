/**
 * Differential test: ~1,370 `dbt ls` argument lists (fixtures/differential-cases.json, see tools/differential_cases.py)
 * were run with REAL dbt 1.11.16 on tags jaffle ch16, jaffle ch25 and shopflow m14 (tools/differential_run.py).
 * The engine must print the same lines (same order), the same selection warnings and the same errors.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../../src/lib/selector/tasks';
import { loadProject, SITE } from './load';

interface Case { args: string[]; lines: string[]; warnings: string[]; error: string | null }

const q = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
const WARN = /does not match any enabled nodes|No nodes selected!|Using default selector/;

for (const id of ['jaffle-ch16', 'jaffle-ch25', 'shopflow-m14']) {
  const cases: Case[] = JSON.parse(readFileSync(`${SITE}tests/selector/fixtures/differential-${id}.json`, 'utf8'));
  const [key, tag] = id.split('-');
  describe(`differential vs real dbt: ${id}`, () => {
    const project = loadProject(key, tag);
    for (const c of cases) {
      it(`dbt ls ${c.args.join(' ')}`, () => {
        const r = runCommand(project, `dbt ls ${c.args.map(q).join(' ')}`, { clock: '00:00:00' });
        const err = r.error ? r.error.lines('ls').join('\n') : null;
        expect({ error: err }).toEqual({ error: c.error });
        if (c.error) return;
        expect(r.output).toEqual(c.lines);
        expect(r.logs.map((l) => l.text).filter((t) => WARN.test(t))).toEqual(c.warnings.filter((t) => WARN.test(t)));
      });
    }
  });
}
