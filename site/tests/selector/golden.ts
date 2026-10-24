/**
 * Golden comparison: run one entry of converter/golden/dbt-ls.json through the engine and compare with what
 * real dbt printed. Rules (the same as converter/reference/golden_verify.py):
 *   dbt ls (selector / name / path): the printed lines, in order; a "partial" entry (elided output) must be
 *     a subset of the engine's lines
 *   dbt ls --output json: the JSON lines (exact strings; parsed objects reported on mismatch)
 *   count entries (`| wc -l`): the number of printed lines
 *   run/build/test/seed/snapshot: the set of nodes of the "N of M" lines, canonicalised
 *     (rel:<schema>.<alias>, test:<name>, unit_test:<model>::<name>, exposure:<name>)
 */
import { readFileSync } from 'node:fs';
import { canonical, runCommand, type CommandResult } from '../../src/lib/selector/tasks';
import type { PreviousState } from '../../src/lib/selector/methods';
import { ACADEMY, hasTag, loadProject } from './load';

export interface GoldenEntry {
  id: string; source: string; origin: string; section: string; project: 'jaffle' | 'shopflow'; tag: string;
  command: string; dbt: string; kind: string; global_flags: string[]; args: Record<string, unknown>;
  env: Record<string, string>; state_dependent: boolean; output_format: string; selected: string[] | null;
  selected_canon?: string[]; count: number | null; partial: boolean; error?: string | null; warnings?: string[];
  notes: string; total?: number | null; output_keys?: string[];
  verification?: {
    status: string; matched_tag?: string; reason?: string; missing?: string[]; extra?: string[]; demo_edit?: string;
    bug_patch_applied?: string; annotation?: string; tag_run?: string;
  };
}

const RERUNS: Record<string, { tag: string; ran: string; real: string[]; real_ordered?: boolean }> =
  JSON.parse(readFileSync(new URL('./fixtures/real-reruns.json', import.meta.url), 'utf8')).entries;

export function loadGolden(): GoldenEntry[] {
  return JSON.parse(readFileSync(`${ACADEMY}converter/golden/dbt-ls.json`, 'utf8'));
}

export interface Outcome {
  id: string;
  /** match = same as the golden; match-real = the golden is not what real dbt prints at that tag (verifier),
   *  and the engine prints what real dbt prints there */
  status: 'match' | 'match-real' | 'mismatch' | 'skipped';
  evaluatedOn?: string;
  reason?: string;
  tagRun?: string;
  missing?: string[];
  extra?: string[];
  orderDiffers?: boolean;
  errorExpected?: string | null;
  errorActual?: string | null;
}

const PATH_ENV = new Set(['DBT_DUCKDB_PATH', 'SHOPFLOW_DB_PATH', 'DBT_PROFILES_DIR', 'GITHUB_WORKSPACE', 'DBT_PROJECT_DIR']);

function shQuote(s: string): string {
  return /^[A-Za-z0-9_./:=+-]*$/.test(s) ? s : `'${s.replace(/'/g, `'"'"'`)}'`;
}

export function commandLine(e: GoldenEntry): string {
  const env = Object.entries(e.env ?? {}).filter(([k]) => !PATH_ENV.has(k)).map(([k, v]) => `${k}=${shQuote(v)}`);
  // `command` is what was typed in zsh (unquoted stars matter); `dbt` is the dbt part re-quoted by the extractor
  const typed = e.command.startsWith('dbt ') && !e.command.includes('&&') ? e.command : e.dbt;
  return [...env, typed].join(' ');
}

/** Which project state the entry must be evaluated on (the verifier re-ran it there with real dbt). */
export function evalState(e: GoldenEntry): { tag: string; why: string } {
  const v = e.verification;
  if (v?.demo_edit) return { tag: `${e.tag}+${v.demo_edit}`, why: `tag ${e.tag} + documented demo edit ${v.demo_edit}` };
  if (v?.status === 'ok_other_tag') {
    if (v.matched_tag) return { tag: v.matched_tag, why: `real dbt reproduced it at tag ${v.matched_tag}` };
    const m = /commit ([0-9a-f]{7,40})/.exec(v.reason ?? '');
    if (m) return { tag: m[1], why: `real dbt reproduced it at commit ${m[1]}` };
  }
  return { tag: e.tag, why: `tag ${e.tag}` };
}

function unitKey(c: string): string {
  // SKIP lines of unit tests omit the model ("unit_test test_x"); keep only the test part
  if (c.startsWith('unit_test:')) return 'unit_test:' + c.slice(10).split('::').pop();
  return c;
}

export function engineCanon(r: CommandResult): string[] {
  return r.execution.filter((s) => s.index !== null).map((s) => canonical(s.desc));
}

export function runGolden(e: GoldenEntry, previous: PreviousState | null = null, tagOverride?: string): { outcome: Outcome; result: CommandResult | null } {
  const r = runGoldenRaw(e, previous, tagOverride);
  const rerun = RERUNS[e.id];
  if (r.outcome.status === 'mismatch' && r.result && rerun) {
    const got = e.kind === 'ls' ? r.result.output : engineCanon(r.result).map(unitKey);
    const real = rerun.real.map((x) => (e.kind === 'ls' ? x : unitKey(x)));
    const same = rerun.real_ordered ? JSON.stringify(got) === JSON.stringify(real) : got.length === real.length && real.every((x) => got.includes(x));
    if (same && !r.result.error) return { outcome: { ...r.outcome, status: 'match-real', reason: `not reproducible at ${rerun.tag}; equals real dbt re-run by hand: ${rerun.ran}`, missing: undefined, extra: undefined }, result: r.result };
    return r;
  }
  const v = e.verification;
  if (r.outcome.status !== 'mismatch' || !r.result || v?.status !== 'mismatch' || (!v.missing && !v.extra)) return r;
  // real dbt (verifier) at this tag printed: golden - missing + extra
  const isLs = e.kind === 'ls';
  const exp = isLs ? (e.selected ?? []) : (e.selected_canon ?? []).filter((c) => !c.startsWith('other:hook')).map(unitKey);
  const miss = new Set((v.missing ?? []).map((x) => (isLs ? x : unitKey(x))));
  const real = new Set([...exp.filter((x) => !miss.has(x)), ...(v.extra ?? []).map((x) => (isLs ? x : unitKey(x)))]);
  const got = new Set(isLs ? r.result.output : engineCanon(r.result).map(unitKey));
  const same = real.size === got.size && [...real].every((x) => got.has(x));
  if (same && !r.result.error) return { outcome: { ...r.outcome, status: 'match-real', reason: v.annotation ?? v.reason ?? 'not reproducible at the tag', missing: undefined, extra: undefined }, result: r.result };
  return r;
}

function runGoldenRaw(e: GoldenEntry, previous: PreviousState | null = null, tagOverride?: string): { outcome: Outcome; result: CommandResult | null } {
  const tag = tagOverride ?? evalState(e).tag;
  if (!hasTag(e.project, tag)) return { outcome: { id: e.id, status: 'skipped', reason: `no DAG for ${e.project} ${tag}` }, result: null };
  const project = loadProject(e.project, tag);
  const r = runCommand(project, commandLine(e), { previous, clock: '00:00:00' });
  const o: Outcome = { id: e.id, status: 'match', tagRun: tag, evaluatedOn: tagOverride ? `scenario on ${tag}` : evalState(e).why };
  const expErr = e.error ?? null;
  const gotErr = r.error ? r.error.lines(r.command ?? 'ls').join('\n') : null;
  if (expErr || gotErr) {
    if (!expErr || !gotErr) return { outcome: { ...o, status: 'mismatch', errorExpected: expErr, errorActual: gotErr }, result: r };
    // the first lines dbt printed after "Encountered an error:" (logs can be cut with "... (N more lines)")
    const norm = (t: string) => t.split('\n').map((l) => l.replace(/^\d\d:\d\d:\d\d\s+/, '').trim())
      .filter((l) => l && l !== 'Encountered an error:' && !/^\.\.\. \(\d+ more lines\)$/.test(l) && !l.startsWith('Traceback') && !l.startsWith('File "'));
    const want = norm(expErr).slice(0, 3);
    const have = norm(gotErr);
    const same = want.every((l) => have.includes(l));
    if (!same) return { outcome: { ...o, status: 'mismatch', errorExpected: expErr, errorActual: gotErr }, result: r };
    return { outcome: o, result: r };
  }
  if (e.kind === 'ls') {
    // warnings dbt printed (no-match criteria, "No nodes selected!") must also be in the engine's logs
    const keys = ['does not match any enabled nodes', 'No nodes selected', 'Using default selector'];
    const expW = (e.warnings ?? []).filter((w) => keys.some((k) => w.includes(k)));
    const gotW = r.logs.map((l) => l.text);
    const missingW = expW.filter((w) => !gotW.some((g) => g.includes(w.replace(/^\S+\s+/, '').trim()) || w.includes(g)));
    if (e.output_format === 'count') {
      const n = r.output.length;
      if (n !== e.count) return { outcome: { ...o, status: 'mismatch', reason: `count ${n} != ${e.count}` }, result: r };
      return { outcome: o, result: r };
    }
    const exp = e.selected ?? [];
    const got = r.output;
    let ok: boolean;
    if (e.partial) ok = exp.every((x) => got.includes(x));
    else ok = exp.length === got.length && exp.every((x, i) => x === got[i]);
    if (!ok) {
      const missing = exp.filter((x) => !got.includes(x));
      const extra = e.partial ? [] : got.filter((x) => !exp.includes(x));
      return { outcome: { ...o, status: 'mismatch', missing, extra, orderDiffers: !missing.length && !extra.length }, result: r };
    }
    if (missingW.length) return { outcome: { ...o, status: 'mismatch', reason: `missing warning(s): ${missingW.join(' | ')}` }, result: r };
    return { outcome: o, result: r };
  }
  // run-like
  const exp = [...new Set((e.selected_canon ?? []).filter((c) => !c.startsWith('other:hook')).map(unitKey))];
  const got = [...new Set(engineCanon(r).map(unitKey))];
  const ok = e.partial ? exp.every((x) => got.includes(x)) : exp.length === got.length && exp.every((x) => got.includes(x));
  if (!ok) {
    return { outcome: { ...o, status: 'mismatch', missing: exp.filter((x) => !got.includes(x)), extra: e.partial ? [] : got.filter((x) => !exp.includes(x)) }, result: r };
  }
  return { outcome: o, result: r };
}
