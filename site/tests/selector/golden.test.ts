import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGolden, runGolden, type Outcome } from './golden';
import { scenarioFor } from './scenarios';
import { SITE } from './load';

interface Note { id: string; verdict: 'golden-invalid' | 'not-reproducible' | 'out-of-scope'; reason: string; checked_with?: string }
const NOTES_PATH = `${SITE}tests/selector/golden-notes.json`;
const notes: Note[] = existsSync(NOTES_PATH) ? JSON.parse(readFileSync(NOTES_PATH, 'utf8')).entries : [];
const noted = new Map(notes.map((n) => [n.id, n]));

const entries = loadGolden();
const outcomes: (Outcome & { origin: string; kind: string; state: boolean; noted?: string })[] = [];

describe('golden set: real dbt 1.11.16 outputs', () => {
  for (const e of entries) {
    const scenario = e.state_dependent ? scenarioFor(e) : null;
    // book-ch24-001 is the "no --state" error: it runs with the scenario too (dbt ignores it without --state)
    const runnable = !e.state_dependent || scenario !== null;
    it.runIf(runnable)(`${e.id} ${e.dbt}`, () => {
      const { outcome } = runGolden(e, scenario?.previous ?? null, scenario?.tag);
      const n = noted.get(e.id);
      outcomes.push({ ...outcome, origin: e.origin, kind: e.kind, state: e.state_dependent, noted: n?.verdict });
      if (outcome.status === 'mismatch' && n) return; // documented in golden-notes.json
      expect(outcome.status, JSON.stringify(outcome)).not.toBe('mismatch');
    });
  }
  it('writes the report', () => {
    const by = (f: (o: (typeof outcomes)[number]) => string) => {
      const m: Record<string, Record<string, number>> = {};
      for (const o of outcomes) { const k = f(o); m[k] ??= {}; m[k][o.status] = (m[k][o.status] ?? 0) + 1; }
      return m;
    };
    const report = {
      total_entries: entries.length,
      state_dependent: entries.filter((e) => e.state_dependent).length,
      run: outcomes.length,
      by_status: by(() => 'all'),
      by_origin: by((o) => o.origin),
      by_kind: by((o) => o.kind),
      state_simulated: by((o) => (o.state ? 'state' : 'plain')),
      mismatches: outcomes.filter((o) => o.status === 'mismatch'),
    };
    if (process.env.GOLDEN_REPORT) writeFileSync(process.env.GOLDEN_REPORT, JSON.stringify(report, null, 1));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ...report, mismatches: report.mismatches.map((m) => `${m.id}${m.noted ? ` (${m.noted})` : ''}`) }, null, 1));
    expect(outcomes.length).toBeGreaterThan(0);
  });
});
