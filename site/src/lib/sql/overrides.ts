/**
 * Annotated overrides for book SQL examples that cannot run verbatim (placeholders like "SELECT ...",
 * a result printed after a sentence, a result given only as a dbt log). Used by scripts/labs/extract-sql.ts.
 * The generated chapter files are never edited: every change is described here, with its reason, and the
 * extractor checks a fingerprint of the book text so that an override cannot silently apply to another block.
 *
 * Each override receives the book block and a lookup for other blocks, and returns the runnable example(s).
 */

export interface BookCode {
  id: string;
  lang: string;
  text: string;
  title?: string;
  expected?: string;
}

export interface ExampleSpec {
  /** runnable SQL (may differ from the book text: see annotation) */
  sql: string;
  /** the result text to compare with: default = the book's Result block linked to this block */
  expectedRaw?: string;
  /** compare only the number of rows (the book gives the result as a dbt log such as "FAIL 2") */
  expectRowCount?: number;
  /** id of the book block holding expectedRaw (absent when derived) */
  expectedId?: string;
  columnSubset?: boolean;
  rowPrefix?: boolean;
  /** SQL run before `sql`, not shown as the example (e.g. creating the views a placeholder refers to) */
  setup?: string;
  /** dbt models that must exist in practice.dbt_adnane (compiled from the Chapter 11 project in the browser) */
  needsModels?: string[];
  /** why this example is not the verbatim book block */
  annotation: string;
  /** suffix of the example id for extra derived checks ("#except") */
  suffix?: string;
}

export interface Override {
  /** the book text must contain this (guards against renumbered blocks) */
  fingerprint: string;
  make(block: BookCode, lookup: (pred: (b: BookCode) => boolean, what: string) => BookCode, next: (id: string) => BookCode | undefined): ExampleSpec[];
}

const stripOrderBy = (sql: string) => sql.replace(/\s*;?\s*$/, '').replace(/\s+order\s+by\s+[^()]*$/i, '');

export const OVERRIDES: Record<string, Override> = {
  // Lab "refactor a legacy query", step 6: the result is printed after one sentence, first 10 rows only,
  // with the name columns hidden.
  'ch04-c155': {
    fingerprint: '-- 1. import CTEs: one per raw table, only the columns we need',
    make: (b, _lookup, next) => {
      const out = next(b.id);
      if (!out || out.lang !== 'output') throw new Error('ch04-c155: no result block after the sentence');
      return [{
        sql: b.text, expectedRaw: out.text, expectedId: out.id, columnSubset: true, rowPrefix: true,
        annotation: 'The book prints this result after a sentence, shows the first 10 rows only and hides the name columns: compared on the columns and rows it shows.',
      }];
    },
  },
  // "with report as ( ... the query above, without the order by ... )"
  'ch04-c157': {
    fingerprint: '( ... the query above, without the order by ... )',
    make: (b, lookup) => {
      const report = stripOrderBy(lookup((x) => x.id === 'ch04-c155', 'the customer_orders query').text);
      const sql = b.text.replace(/\(\s*\.\.\. the query above, without the order by \.\.\.\s*\)/, `(\n${report}\n)`);
      if (sql === b.text) throw new Error('placeholder not found in ch04-c157');
      return [{
        sql, annotation: 'The book writes "( ... the query above, without the order by ... )": the workspace puts the query of the previous step there (without its ORDER BY).',
      }];
    },
  },
  // Lab step 7: compare the legacy and the refactored query with two views ("SELECT ... ;" and "with ... ;").
  'ch04-c153': {
    fingerprint: 'create view scratch.legacy_result as SELECT ... ;',
    make: (b, lookup) => {
      const legacy = stripOrderBy(lookup((x) => x.lang === 'sql' && (x.title ?? '').startsWith('legacy/revenue_by_country.sql'), 'legacy/revenue_by_country.sql').text);
      const refactored = stripOrderBy(lookup((x) => x.lang === 'sql' && (x.title ?? '').startsWith('refactored/revenue_by_country.sql'), 'refactored/revenue_by_country.sql').text);
      const setup = [
        'create schema scratch;',
        `create view scratch.legacy_result as\n${legacy};`,
        `create view scratch.refactored_result as\n${refactored};`,
      ].join('\n');
      const counts = b.text.match(/select\s*\n\s*\(select count\(\*\) from scratch\.legacy_result\)[\s\S]*?;/i)?.[0];
      if (!counts) throw new Error('count query not found in ch04-c153');
      return [
        {
          sql: `${setup}\n\n${counts}`, annotation: 'The book writes the two views with placeholders ("SELECT ... ;" for the legacy query, "with ... ;" for the refactored one): the workspace puts the two queries of the lab there (without their ORDER BY).',
        },
        {
          suffix: '#except',
          setup: setup.replace('create schema scratch;', 'create schema if not exists scratch;').replace(/create view /g, 'create or replace view '),
          sql: 'select\n    (select count(*) from (select * from scratch.legacy_result except select * from scratch.refactored_result)) as legacy_only,\n    (select count(*) from (select * from scratch.refactored_result except select * from scratch.legacy_result)) as refactored_only;',
          expectedRaw: '+-------------+-----------------+\n| legacy_only | refactored_only |\n+-------------+-----------------+\n|           0 |               0 |\n+-------------+-----------------+',
          annotation: 'Derived check of the note under the result ("both EXCEPT queries return 0 rows"): both counts must be 0.',
        },
      ];
    },
  },
  // Chapter 18: the compiled accepted_values test. The book shows the dbt log "FAIL 2" = the query returns 2 rows.
  'ch18-c8': {
    fingerprint: "'placed','shipped','completed'",
    make: (b) => [{
      sql: b.text,
      needsModels: ['stg_jaffle_shop__orders'],
      expectRowCount: 2,
      annotation: 'The book shows the dbt log "FAIL 2": a failing test is a query that returns rows, so the check is "this query returns 2 rows". The model stg_jaffle_shop__orders is compiled from the reference project (same file at tags ch11 and ch18) and created as a view in the browser.',
    }],
  },
};
