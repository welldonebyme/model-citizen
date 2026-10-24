/**
 * Text comparison and grading of YAML / Jinja results against the book (port of the spike's
 * site/test-py/compare.py, yaml_parity.py and jinja_parity.py). Pure TypeScript: used by the playgrounds
 * (exercise checks, "Book examples") and by the parity suites.
 *
 * Tiers: exact = byte for byte; lines = same lines after stripping each line and dropping blank lines;
 * ws = same text after collapsing every run of whitespace. The playgrounds pass on `ws` (or `lines`) and say
 * when the result is also byte-exact.
 */
import type { RenderResult, ValidateResult } from './client.ts';

export interface TextMatch { exact: boolean; lines: boolean; ws: boolean }

const stripLines = (t: string) => t.replace(/\t/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean);
const collapse = (t: string) => t.replace(/\s+/g, ' ').trim();
function contiguous(needle: string[], hay: string[]): boolean {
  if (!needle.length) return true;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((l, k) => hay[i + k] === l)) return true;
  return false;
}

/** mode equal: whole text; within: the book shows a contiguous excerpt; segments: excerpts separated by "..." lines, in order. */
export function compareText(book: string, got: string | null | undefined, mode: 'equal' | 'within' | 'segments' = 'equal'): TextMatch {
  if (got === null || got === undefined) return { exact: false, lines: false, ws: false };
  if (mode === 'segments') {
    const segs = book.split(/^\.\.\.$/m).map((s) => s.replace(/^\n+|\n+$/g, '')).filter((s) => s.trim());
    const res: TextMatch = { exact: true, lines: true, ws: true };
    let posExact = 0;
    let posWs = 0;
    const hay = stripLines(got);
    let linePos = 0;
    const cg = collapse(got);
    for (const s of segs) {
      const i = got.indexOf(s, posExact);
      res.exact &&= i >= 0;
      if (i >= 0) posExact = i + s.length;
      const cs = collapse(s);
      const j = cg.indexOf(cs, posWs);
      res.ws &&= j >= 0;
      if (j >= 0) posWs = j + cs.length;
      const sl = stripLines(s);
      let found = -1;
      for (let k = linePos; k + sl.length <= hay.length; k++) if (sl.every((l, q) => hay[k + q] === l)) { found = k; break; }
      res.lines &&= found >= 0;
      if (found >= 0) linePos = found + sl.length;
    }
    return res;
  }
  if (mode === 'within') return { exact: got.includes(book), lines: contiguous(stripLines(book), stripLines(got)), ws: collapse(got).includes(collapse(book)) };
  return { exact: book === got, lines: JSON.stringify(stripLines(book)) === JSON.stringify(stripLines(got)), ws: collapse(book) === collapse(got) };
}

// ------------------------------------------------------------------------------------------- YAML
export interface YamlCase {
  id: string; ref: string; title: string; engine: 'dbt' | 'pyyaml'; text: string; project?: string; path?: string; filename?: string;
  reconstructed?: string;
  expect: { kind: 'dbt_block' | 'traceback' | 'contains' | 'warning' | 'value' | 'error_any' | 'valid'; book?: string; raw_error?: string; near_line?: number;
    skip_lines?: number; phrases?: string[]; line?: number; column?: number; expr?: string; print?: boolean };
}
export interface Graded { id: string; title: string; passed: boolean; byteExact: boolean | null; book: string; got: string | null; match: TextMatch | null; detail?: string }

/** The validate request a YAML case needs (path made relative to the project like dbt does). */
export function yamlRequest(c: YamlCase) {
  const path = c.path ? (c.path.startsWith('models/') ? c.path : 'models/' + c.path) : undefined;
  return {
    text: c.text, engine: c.engine, filename: c.filename, path,
    project: c.project === 'jaffle_practice' ? 'ch05' : 'ch11', project_name: c.project ?? 'my_project',
    ...(c.expect.kind === 'value' ? { exprs: [{ expr: c.expect.expr!, print: !!c.expect.print }] } : {}),
  };
}

export function gradeYaml(c: YamlCase, res: ValidateResult & { values?: { expr: string; text?: string; error?: string }[] }): Graded {
  const e = c.expect;
  const err = res.error;
  const out = (passed: boolean, book: string, got: string | null, match: TextMatch | null, byteExact: boolean | null, detail?: string): Graded =>
    ({ id: c.id, title: c.title, passed, byteExact, book, got, match, detail });
  switch (e.kind) {
    case 'dbt_block': {
      const book = e.book!.split('\n').slice(e.skip_lines ?? 0).join('\n');
      const raw = compareText(e.raw_error!, err?.message ?? null);
      const near = err?.problem_mark?.line === e.near_line;
      const block = compareText(book, err?.dbt_message ?? null, 'within');
      return out(raw.exact && near, book, err?.dbt_message ?? null, block, block.exact,
        `raw error ${raw.exact ? 'exact' : 'differs'}; line ${err?.problem_mark?.line} (book ${e.near_line}); whole block: ${block.exact ? 'exact' : block.lines ? 'same lines' : block.ws ? 'same words' : 'differs'}`);
    }
    case 'traceback': {
      const m = compareText(e.book!, err?.traceback_tail ?? null);
      return out(m.exact, e.book!, err?.traceback_tail ?? null, m, m.exact);
    }
    case 'contains': {
      const msg = err?.message ?? '';
      const phr = (e.phrases ?? []).every((p) => msg.includes(p));
      const pos = e.line === undefined || (err?.problem_mark?.line === e.line && err?.problem_mark?.column === e.column);
      const book = (e.phrases ?? []).join(' ... ') + (e.line !== undefined ? ` (line ${e.line}, column ${e.column})` : '');
      return out(!res.ok && phr && pos, book, msg || null, null, null, `phrases ${phr ? 'found' : 'missing'}${e.line !== undefined ? `, position ${pos ? 'same' : 'differs'}` : ''}`);
    }
    case 'warning': {
      const got = (res.warnings ?? []).map((w) => w.dbt_message).join('\n');
      const m = compareText(e.book!, got);
      return out(m.exact, e.book!, got, m, m.exact);
    }
    case 'value': {
      const v = res.values?.[0];
      const got = res.ok ? v?.text ?? null : null;
      const m = compareText(e.book!, got);
      return out(m.ws, e.book!, got, m, m.exact, v?.error);
    }
    case 'error_any':
      return out(!res.ok, '(an error)', err?.message ?? null, null, null);
    case 'valid':
      return out(res.ok, '(valid YAML)', res.ok ? 'valid YAML' : err?.message ?? null, null, null);
  }
}

// ------------------------------------------------------------------------------------------- Jinja
export interface JinjaCase {
  id: string; ref: string; title: string; mode: 'plain' | 'dbt'; template: string; project?: 'ch11' | 'ch05'; target?: string;
  node?: { name: string; resource_type: string; path?: string }; passes?: ('parse' | 'execute')[];
  extra_models?: Record<string, Record<string, unknown>>; extra_macro_files?: Record<string, string>; db?: boolean; note?: string; reconstructed?: string;
  expect: { kind: 'compiled' | 'error' | 'logs' | 'parents' | 'real_only'; cmp?: 'equal' | 'ws' | 'within' | 'segments'; book?: string | string[];
    phrases?: string[]; phase?: string; cmp_block?: string; compiled?: string; compiled_contains?: string };
}

export function jinjaRequest(c: JinjaCase) {
  return {
    mode: c.mode, template: c.template, project: c.project ?? 'ch11', target: c.target, node: c.node, passes: c.passes,
    extra_models: c.extra_models, extra_macro_files: c.extra_macro_files,
  };
}

export function gradeJinja(c: JinjaCase, res: RenderResult): Graded {
  const e = c.expect;
  const err = res.error;
  let got: string | null = res.compiled ?? null;
  if (res.status === 'need_query') got = `(needs a database: ${(res.pending_sql ?? '').slice(0, 80)}...)`;
  const out = (passed: boolean, book: string, g: string | null, match: TextMatch | null, byteExact: boolean | null, detail?: string): Graded =>
    ({ id: c.id, title: c.title, passed, byteExact, book, got: g, match, detail });
  switch (e.kind) {
    case 'compiled': {
      const mode = e.cmp === 'within' ? 'within' : e.cmp === 'segments' ? 'segments' : 'equal';
      const m = compareText(String(e.book), got, mode);
      const passed = e.cmp === 'ws' || e.cmp === 'segments' || e.cmp === 'within' ? m.ws : m.lines;
      return out(passed, String(e.book), got, m, m.exact, err ? err.message : undefined);
    }
    case 'error': {
      const msg = err?.message ?? '';
      const passed = !!err && (e.phrases ?? []).every((p) => msg.includes(p)) && (!e.phase || err.phase === e.phase);
      const m = e.cmp_block && err ? compareText(e.cmp_block, err.dbt_message ?? null, 'within') : null;
      return out(passed, (e.phrases ?? []).join(' / '), msg || got, m, null, err ? `phase ${err.phase}` : 'no error');
    }
    case 'logs': {
      const book = (e.book as string[]).join('\n');
      const gotLines = (res.logs ?? []).filter((l) => l.info).map((l) => l.msg).join('\n');
      const m = compareText(book, gotLines);
      let passed = m.lines;
      let byte = m.exact;
      let g = gotLines;
      let b = book;
      if (e.compiled !== undefined) {
        const m2 = compareText(e.compiled, res.compiled ?? null);
        passed &&= m2.lines;
        byte &&= m2.exact;
        g += '\n--- compiled ---\n' + String(res.compiled);
        b += '\n--- compiled ---\n' + e.compiled;
      }
      return out(passed, b, g, m, byte, err?.message);
    }
    case 'parents': {
      const parents = [...new Set((res.parse_refs ?? []).map((r) => r.name))].sort();
      const want = [...(e.book as string[])].sort();
      const passed = JSON.stringify(parents) === JSON.stringify(want) && (res.compiled ?? '').includes(e.compiled_contains ?? '');
      return out(passed, want.join(', '), parents.join(', '), { exact: passed, lines: passed, ws: passed }, passed);
    }
    case 'real_only':
      return out(true, '(compared with real dbt only)', got, null, null);
  }
}
