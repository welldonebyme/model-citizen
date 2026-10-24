#!/usr/bin/env node
/**
 * Every SQL example of the book that has a printed result, for the SQL workspace, the SQL playground and
 * the parity suite. Reads the converter's output (src/generated/chapters/*.json, never edited) and writes
 * src/lib/sql/book-sql.json.
 *
 *   node scripts/labs/extract-sql.ts          (Node >= 22.18: TypeScript type stripping, no build step)
 *
 * Rules
 *  - a `sql`/`dbt` code block with `expected` (the converter links the Result block that follows it) is an
 *    example, if its SQL runs on the practice database (jaffle_shop + stripe) without dbt;
 *  - a block whose Result is printed after one or two sentences is listed too (it needs an override);
 *  - placeholders ("SELECT ...", "( ... the query above ... )") and derived checks are handled by the
 *    annotated OVERRIDES in src/lib/sql/overrides.ts (fingerprint-checked);
 *  - everything else is listed in `skipped` with the reason (dbt log instead of a result, dbt-built models,
 *    snapshots, Jinja).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTopLevelOrderBy, maskSql, tryParseBookOutput } from '../../src/lib/sql/compare.ts';
import { OVERRIDES, type BookCode, type ExampleSpec } from '../../src/lib/sql/overrides.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');
const CHAPTERS = path.join(SITE, 'src', 'generated', 'chapters');
const OUT = path.join(SITE, 'src', 'lib', 'sql', 'book-sql.json');
// slim index for the workspace island (texts come from the page DOM): options, overrides, skip reasons
const OUT_META = path.join(SITE, 'src', 'lib', 'sql', 'book-sql-meta.json');

type Inline = string | { t: string; v?: string; c?: Inline[]; en?: Inline[] };
const text = (c: Inline[] | undefined): string =>
  (c ?? []).map((n) => (typeof n === 'string' ? n : n.v ?? (n.c ? text(n.c) : n.en ? text(n.en) : ''))).join('');

interface Ctx {
  chapter: string; chapterNumber: number; chapterTitle: string;
  lessonId?: string; lessonNumber?: string; lessonTitle?: string;
  stepId?: string; stepTitle?: string; labId?: string; labTitle?: string;
}
interface Item { block: BookCode & { t: string }; ctx: Ctx }
interface AnyBlock { t: string; id?: string; lang?: string; text?: string; title?: Inline[] | string; expected?: string; blocks?: AnyBlock[]; items?: { blocks: AnyBlock[] }[] }

export interface BookSqlExample extends Ctx {
  id: string;
  codeId: string;
  title?: string;
  bookSql: string;
  sql: string;
  setup?: string;
  expectedId?: string;
  expectedRaw?: string;
  expectRowCount?: number;
  kind: 'table' | 'error' | 'rowCount';
  ordered: boolean;
  columnSubset?: boolean;
  rowPrefix?: boolean;
  needsModels?: string[];
  annotation?: string;
}
export interface BookSqlSkipped extends Ctx {
  codeId: string;
  title?: string;
  expectedId?: string;
  category: 'dbt-log' | 'snapshot' | 'dbt-models' | 'jinja' | 'not-sql';
  reason: string;
}

const items: Item[] = [];
/** every block in reading order (code blocks by id, other blocks by type): to measure "after a sentence" */
const order: { t: string; id?: string; chapter: string }[] = [];
const chapterMeta: { id: string; number: number; title: string }[] = [];
function walk(blocks: AnyBlock[] | undefined, ctx: Ctx) {
  for (const b of blocks ?? []) {
    if (!b || typeof b !== 'object') continue;
    order.push({ t: b.t, id: b.t === 'code' ? b.id : undefined, chapter: ctx.chapter });
    if (b.t === 'code' && b.id) items.push({ block: { t: 'code', id: b.id, lang: b.lang ?? '', text: b.text ?? '', title: typeof b.title === 'string' ? b.title : undefined, expected: b.expected }, ctx });
    if (b.t === 'lab') walk(b.blocks, { ...ctx, labId: b.id, labTitle: text(b.title as Inline[]) });
    else if (b.t === 'callout') walk(b.blocks, ctx);
    if (b.t === 'list') for (const it of b.items ?? []) walk(it.blocks, ctx);
  }
}
for (const f of fs.readdirSync(CHAPTERS).filter((f) => /^ch\d+\.json$/.test(f)).sort()) {
  const ch = JSON.parse(fs.readFileSync(path.join(CHAPTERS, f), 'utf8'));
  const base: Ctx = { chapter: ch.id, chapterNumber: ch.number, chapterTitle: ch.title };
  chapterMeta.push({ id: ch.id, number: ch.number, title: ch.title });
  walk(ch.intro, base);
  for (const l of ch.lessons) {
    for (const s of l.steps) walk(s.blocks, { ...base, lessonId: l.id, lessonNumber: l.number, lessonTitle: l.titleText, stepId: s.id, stepTitle: s.titleText });
  }
  walk(ch.summary, base);
}

const byId = new Map(items.map((i) => [i.block.id, i]));
const blocks = items.map((i) => i.block);
const lookup = (pred: (b: BookCode) => boolean, what: string): BookCode => {
  const hits = blocks.filter(pred);
  if (hits.length !== 1) throw new Error(`override lookup "${what}": ${hits.length} blocks match`);
  return hits[0];
};
/** the code block printed after `id` with at most two paragraphs in between ("result printed after a sentence") */
const nextCode = (id: string): BookCode | undefined => {
  const k = order.findIndex((o) => o.t === 'code' && o.id === id);
  let paragraphs = 0;
  for (let j = k + 1; j < order.length && order[j].chapter === order[k].chapter; j++) {
    if (order[j].t === 'code') return byId.get(order[j].id!)?.block;
    if (order[j].t !== 'p' || ++paragraphs > 2) return undefined;
  }
  return undefined;
};

/** precise, human reasons for skipped blocks (the generic detection below finds them; this only words them) */
const SKIP_NOTES: Record<string, string> = {
  'ch09-c2': 'a model file whose only line is a ref() in a comment; the Result is the dbt error "Found a cycle", not a query result',
  'ch13-c11': 'the Result is the snapshot row of order 301 after `dbt snapshot` (dbt_valid_from / dbt_valid_to are written by dbt)',
  'ch15-c31': 'reads information_schema for dim_customers and customer_segments, two models built by dbt (customer_segments is the Python model of Chapter 15)',
};

const DBT_SCHEMA = /\b(dbt_adnane|dbt_\w+)\s*\.|"dbt_adnane"|table_schema\s*=\s*'dbt_/i;
const examples: BookSqlExample[] = [];
const skipped: BookSqlSkipped[] = [];
const considered: { codeId: string; resultId: string; included: boolean; reason: string }[] = [];

function addExample(it: Item, spec: ExampleSpec) {
  const b = it.block;
  const expectedRaw = spec.expectedRaw ?? (b.expected ? byId.get(b.expected)?.block.text : undefined);
  const expectedId = spec.expectedRaw !== undefined ? spec.expectedId : b.expected;
  let kind: BookSqlExample['kind'] = 'rowCount';
  if (spec.expectRowCount === undefined) {
    const exp = expectedRaw === undefined ? null : tryParseBookOutput(expectedRaw);
    if (!exp) throw new Error(`${b.id}: the expected result does not parse`);
    kind = exp.kind;
  }
  examples.push({
    ...it.ctx, id: b.id + (spec.suffix ?? ''), codeId: b.id, title: b.title, bookSql: b.text, sql: spec.sql,
    ...(spec.setup ? { setup: spec.setup } : {}),
    ...(expectedId ? { expectedId } : {}), ...(expectedRaw !== undefined && spec.expectRowCount === undefined ? { expectedRaw } : {}),
    ...(spec.expectRowCount !== undefined ? { expectRowCount: spec.expectRowCount } : {}),
    kind, ordered: hasTopLevelOrderBy(spec.sql),
    ...(spec.columnSubset ? { columnSubset: true } : {}), ...(spec.rowPrefix ? { rowPrefix: true } : {}),
    ...(spec.needsModels ? { needsModels: spec.needsModels } : {}),
    ...(spec.annotation ? { annotation: spec.annotation } : {}),
  });
}

const used = new Set<string>();
for (let k = 0; k < items.length; k++) {
  const it = items[k];
  const b = it.block;
  if (b.lang !== 'sql' && b.lang !== 'dbt') continue;
  const ov = OVERRIDES[b.id];
  if (ov) {
    if (!b.text.includes(ov.fingerprint)) throw new Error(`override ${b.id}: fingerprint not found (book changed?)`);
    used.add(b.id);
    for (const spec of ov.make(b, lookup, nextCode)) addExample(it, spec);
    if (!b.expected) considered.push({ codeId: b.id, resultId: nextCode(b.id)?.id ?? '?', included: true, reason: 'override' });
    continue;
  }
  if (!b.expected) {
    // a Result printed after one or two sentences? (record it; it needs an override to be an example)
    const n = nextCode(b.id);
    if (n?.lang === 'output') {
      const parsed = tryParseBookOutput(n.text);
      const reason = !parsed ? 'the result after the sentence is dbt output (a log), not a query result'
        : DBT_SCHEMA.test(b.text) ? 'needs dbt-built objects (snapshots / models in dbt_adnane)'
        : /\{\{|\{%/.test(b.text) ? 'dbt SQL with Jinja' : 'result of another query';
      considered.push({ codeId: b.id, resultId: n.id, included: false, reason });
    }
    continue;
  }
  const exp = byId.get(b.expected)?.block;
  if (!exp) throw new Error(`${b.id}: expected block ${b.expected} not found`);
  const parsed = tryParseBookOutput(exp.text);
  const skip = (category: BookSqlSkipped['category'], reason: string) =>
    skipped.push({ ...it.ctx, codeId: b.id, title: b.title, expectedId: b.expected, category, reason });
  if (!parsed) { skip('dbt-log', SKIP_NOTES[b.id] ?? 'the Result is dbt output (a log), not a query result'); continue; }
  if (/\{\{|\{%/.test(b.text)) { skip('jinja', SKIP_NOTES[b.id] ?? 'dbt SQL with Jinja ({{ }}): it runs in dbt, not as plain SQL'); continue; }
  if (parsed.kind === 'table' && parsed.columns.some((c) => /^dbt_valid_(from|to)$/.test(c))) {
    skip('snapshot', SKIP_NOTES[b.id] ?? 'the Result comes from a dbt snapshot table (dbt_valid_from / dbt_valid_to are written by `dbt snapshot` runs)'); continue;
  }
  if (DBT_SCHEMA.test(maskSql(b.text)) || /table_schema\s*=\s*'dbt_adnane'/.test(b.text)) {
    const snap = /_snapshot\b/.test(b.text);
    if (snap) skip('snapshot', SKIP_NOTES[b.id] ?? 'queries dbt snapshot tables: dbt_valid_from is the time of each `dbt snapshot` run on the learner\'s machine');
    else skip('dbt-models', SKIP_NOTES[b.id] ?? 'needs models built by dbt in dbt_adnane');
    continue;
  }
  if (/\.\.\./.test(maskSql(b.text))) throw new Error(`${b.id}: placeholder "..." in SQL and no override`);
  addExample(it, { sql: b.text, annotation: '' });
}
for (const id of Object.keys(OVERRIDES)) if (!used.has(id)) throw new Error(`override ${id} was not used (block missing?)`);
for (const e of examples) if (!e.annotation) delete e.annotation;

// per-chapter summary (the parity report adds "matched")
const perChapter = chapterMeta.map((c) => ({
  chapter: c.id, number: c.number, title: c.title,
  blocksWithResult: items.filter((i) => i.ctx.chapter === c.id && (i.block.lang === 'sql' || i.block.lang === 'dbt') && (i.block.expected || considered.some((x) => x.codeId === i.block.id && x.included))).length,
  examples: examples.filter((e) => e.chapter === c.id).length,
  skipped: skipped.filter((s) => s.chapter === c.id).length,
})).filter((c) => c.blocksWithResult > 0);

const out = {
  $comment: 'Generated by scripts/labs/extract-sql.ts from src/generated/chapters/*.json and src/lib/sql/overrides.ts. Do not edit.',
  counts: { examples: examples.length, skipped: skipped.length, overrides: Object.keys(OVERRIDES).length },
  perChapter, examples, skipped, considered,
};
const json = JSON.stringify(out, null, 1) + '\n';
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== json) fs.writeFileSync(OUT, json);

const meta = {
  $comment: 'Generated by scripts/labs/extract-sql.ts. Do not edit. Per book code id: how the workspace runs and checks it.',
  examples: Object.fromEntries(examples.filter((e) => e.id === e.codeId).map((e) => [e.codeId, {
    lesson: e.lessonNumber ? `${e.lessonNumber} ${e.lessonTitle}` : `Chapter ${e.chapterNumber}`,
    kind: e.kind, ordered: e.ordered,
    ...(e.expectedId ? { expectedId: e.expectedId } : {}),
    ...(e.expectedId === undefined && e.expectedRaw !== undefined ? { expectedRaw: e.expectedRaw } : {}),
    ...(e.sql !== e.bookSql ? { sql: e.sql } : {}),
    ...(e.setup ? { setup: e.setup } : {}),
    ...(e.columnSubset ? { columnSubset: true } : {}), ...(e.rowPrefix ? { rowPrefix: true } : {}),
    ...(e.expectRowCount !== undefined ? { expectRowCount: e.expectRowCount } : {}),
    ...(e.needsModels ? { needsModels: e.needsModels } : {}),
    ...(e.annotation ? { annotation: e.annotation } : {}),
  }])),
  skipped: Object.fromEntries(skipped.map((x) => [x.codeId, { category: x.category, reason: x.reason }])),
};
const metaJson = JSON.stringify(meta) + '\n';
if (!fs.existsSync(OUT_META) || fs.readFileSync(OUT_META, 'utf8') !== metaJson) fs.writeFileSync(OUT_META, metaJson);
console.log(`[labs:sql] ${examples.length} examples, ${skipped.length} skipped, ${considered.length} results after prose considered`);
for (const c of perChapter) console.log(`  ${c.chapter}: ${c.blocksWithResult} blocks with a result -> ${c.examples} examples, ${c.skipped} skipped`);
for (const s of skipped) console.log(`  skip ${s.codeId} (${s.category}): ${s.reason}`);
for (const c of considered) console.log(`  after prose ${c.codeId} -> ${c.resultId}: ${c.included ? 'included (override)' : 'not included: ' + c.reason}`);
