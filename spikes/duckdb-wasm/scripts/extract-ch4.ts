/**
 * Extract the Chapter 4 SQL examples that have a printed result from the book sources
 * (read-only) and write src/data/ch4-examples.json.
 *
 *   npm run extract                      # BOOK_DIR defaults to ../../../../dbt-bible (next to dbt-academy)
 *   BOOK_DIR=/path/to/dbt-bible npm run extract
 *
 * A `sqlcode` block followed (after blank lines only) by an `outputcode` block is an example.
 * A few examples need an annotation (placeholders like "SELECT ..." or a result printed after a
 * sentence): they are handled by OVERRIDES below, and every override is labelled in the JSON.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTopLevelOrderBy, maskSql, parseBookOutput } from '../src/lib/compare.ts';

const here = dirname(fileURLToPath(import.meta.url));
const BOOK_DIR = resolve(process.env.BOOK_DIR ?? join(here, '../../../../dbt-bible'));
const FILES = ['parts/part1/ch04-sql-a.tex', 'parts/part1/ch04-sql-b.tex'];
const OUT = join(here, '../src/data/ch4-examples.json');

interface Block { id: string; file: string; line: number; sql: string; output: string | null; gapOutput: string | null }

export interface Example {
  id: string;
  file: string;
  line: number;
  sql: string;
  expectedRaw: string;
  ordered: boolean;
  columnSubset?: boolean;
  rowPrefix?: boolean;
  /** why this example is not a verbatim book block (override / derived) */
  annotation?: string;
}

function readBlocks(file: string): Block[] {
  const text = readFileSync(join(BOOK_DIR, file), 'utf8');
  const lines = text.split('\n');
  const short = file.split('/').pop()!.replace(/\.tex$/, '');
  const blocks: Block[] = [];
  const readEnv = (start: number, env: string): [string, number] => {
    let j = start + 1;
    while (j < lines.length && !lines[j].trim().startsWith(`\\end{${env}}`)) j++;
    return [lines.slice(start + 1, j).join('\n'), j];
  };
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('\\begin{sqlcode}')) continue;
    const [sql, end] = readEnv(i, 'sqlcode');
    let k = end + 1;
    while (k < lines.length && lines[k].trim() === '') k++;
    let output: string | null = null;
    let gapOutput: string | null = null;
    if (lines[k]?.trim().startsWith('\\begin{outputcode}')) {
      output = readEnv(k, 'outputcode')[0];
    } else {
      // an output printed after one or two sentences of prose (recorded, used only by an override)
      let prose = 0;
      for (let m = k; m < lines.length && prose <= 2; m++) {
        const t = lines[m].trim();
        if (t.startsWith('\\begin{outputcode}')) { gapOutput = readEnv(m, 'outputcode')[0]; break; }
        if (t.startsWith('\\begin') || t.startsWith('\\section') || t.startsWith('\\subsection')) break;
        if (t !== '') prose++;
      }
    }
    blocks.push({ id: `${short}:${i + 1}`, file: short, line: i + 1, sql, output, gapOutput });
    i = end;
  }
  return blocks;
}

const stripOrderBy = (sql: string) => sql.replace(/\s*;?\s*$/, '').replace(/\s+order\s+by\s+[^()]*$/i, '');

const blocks = FILES.flatMap(readBlocks);
const byId = new Map(blocks.map((b) => [b.id, b]));
const need = (id: string) => { const b = byId.get(id); if (!b) throw new Error(`block ${id} not found (book changed?)`); return b; };

type Override = (b: Block) => Example[];
const OVERRIDES: Record<string, Override> = {
  // Step 6 of the refactoring lab: the result is printed after one sentence, first 10 rows only,
  // and with the name columns hidden.
  'ch04-sql-b:1676': (b) => [{
    id: b.id, file: b.file, line: b.line, sql: b.sql, expectedRaw: b.gapOutput!, ordered: hasTopLevelOrderBy(b.sql),
    columnSubset: true, rowPrefix: true,
    annotation: 'output printed after a sentence; first 10 rows only, name columns hidden (columnSubset + rowPrefix)',
  }],
  // "with report as ( ... the query above, without the order by ... )"
  'ch04-sql-b:1780': (b) => {
    const report = stripOrderBy(need('ch04-sql-b:1676').sql);
    const sql = b.sql.replace(/\(\s*\.\.\. the query above, without the order by \.\.\.\s*\)/, `(\n${report}\n)`);
    if (sql === b.sql) throw new Error('placeholder not found in ch04-sql-b:1780');
    return [{ id: b.id, file: b.file, line: b.line, sql, expectedRaw: b.output!, ordered: hasTopLevelOrderBy(sql),
      annotation: 'placeholder "( ... the query above ... )" replaced by ch04-sql-b:1676 without its order by' }];
  },
  // Step 7: legacy vs refactored views (placeholders "SELECT ... ;" and "with ... ;")
  'ch04-sql-b:1598': (b) => {
    const legacy = stripOrderBy(need('ch04-sql-b:1471').sql);
    const refactored = stripOrderBy(need('ch04-sql-b:1529').sql);
    const setup = [
      'create schema scratch;',
      `create view scratch.legacy_result as\n${legacy};`,
      `create view scratch.refactored_result as\n${refactored};`,
    ].join('\n');
    const counts = b.sql.match(/select\s*\n\s*\(select count\(\*\) from scratch\.legacy_result\)[\s\S]*?;/i)?.[0];
    if (!counts) throw new Error('count query not found in ch04-sql-b:1598');
    const out = parseBookOutput(b.output!);
    const tableOnly = b.output!.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    return [
      { id: b.id, file: b.file, line: b.line, sql: `${setup}\n\n${counts}`, expectedRaw: tableOnly, ordered: false,
        annotation: 'placeholders replaced by ch04-sql-b:1471 (legacy) and ch04-sql-b:1529 (refactored), without order by' },
      { id: `${b.id}#except`, file: b.file, line: b.line,
        sql: 'select\n    (select count(*) from (select * from scratch.legacy_result except select * from scratch.refactored_result)) as legacy_only,\n    (select count(*) from (select * from scratch.refactored_result except select * from scratch.legacy_result)) as refactored_only;',
        expectedRaw: '+-------------+-----------------+\n| legacy_only | refactored_only |\n+-------------+-----------------+\n|           0 |               0 |\n+-------------+-----------------+',
        ordered: false,
        annotation: `derived from the book note "${out.notes.join(' ')}"` },
    ];
  },
};

const examples: Example[] = [];
const skipped: { id: string; reason: string }[] = [];
for (const b of blocks) {
  const ov = OVERRIDES[b.id];
  if (ov) { examples.push(...ov(b)); continue; }
  if (b.output === null) continue; // no printed result: not an auto-checked example
  if (/\.\.\./.test(maskSql(b.sql))) { skipped.push({ id: b.id, reason: 'placeholder "..." in SQL and no override' }); continue; }
  parseBookOutput(b.output); // fail fast on an unparseable block
  examples.push({ id: b.id, file: b.file, line: b.line, sql: b.sql, expectedRaw: b.output, ordered: hasTopLevelOrderBy(b.sql) });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: FILES, generatedFrom: BOOK_DIR, count: examples.length, skipped, examples }, null, 2) + '\n');
console.log(`blocks: ${blocks.length}, with output: ${blocks.filter((b) => b.output).length}, examples written: ${examples.length}, skipped: ${skipped.length}`);
for (const s of skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
