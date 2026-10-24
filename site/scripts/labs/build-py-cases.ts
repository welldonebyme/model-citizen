#!/usr/bin/env node
/**
 * YAML and Jinja cases of the book (Chapters 5, 11 and 22) for the playgrounds and their parity suites.
 * Port of spikes/pyodide/tests/cases/{yaml,jinja}_cases.py: the same cases, but every book text is read from the
 * converter's output (src/generated/chapters/*.json and questions/*.json) by code block id instead of LaTeX line
 * numbers. The bug file of Chapter 22 is rebuilt from the reference repository (tag ch22 + bugs/02 patch).
 *
 *   node scripts/labs/build-py-cases.ts
 *
 * Writes src/lib/py/cases/yaml-cases.json and jinja-cases.json. When the spike's frozen cases exist
 * (spikes/pyodide/results/*_cases.json, extracted from the LaTeX), every case is compared with them and
 * differences are printed: that checks the converter's text against the book source.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');
const GEN = path.join(SITE, 'src', 'generated');
const OUT = path.join(SITE, 'src', 'lib', 'py', 'cases');
const BIBLE = path.resolve(process.env.DBT_BIBLE ?? path.join(SITE, '..', '..', 'dbt-bible'));
const REPO = path.join(BIBLE, 'labs', 'practice-project', 'jaffle_dbt');
const BUGS = path.join(BIBLE, 'labs', 'practice-project', 'bugs');
const SPIKE = path.join(SITE, '..', 'spikes', 'pyodide', 'results');

// ------------------------------------------------------------------------------------------- book blocks
interface Where { chapter: string; lessonId?: string; lessonNumber?: string; question?: string }
interface Code { id: string; text: string; lang: string; where: Where }
type AnyBlock = { t?: string; id?: string; lang?: string; text?: string; blocks?: AnyBlock[]; items?: { blocks: AnyBlock[] }[]; rows?: { c: unknown }[][] };
const codes = new Map<string, Code>();
function walk(blocks: AnyBlock[] | undefined, where: Where) {
  for (const b of blocks ?? []) {
    if (!b || typeof b !== 'object') continue;
    if (b.t === 'code' && b.id && !codes.has(b.id)) codes.set(b.id, { id: b.id, text: b.text ?? '', lang: b.lang ?? '', where });
    if (b.blocks) walk(b.blocks, where);
    for (const it of b.items ?? []) walk(it.blocks, where);
    for (const r of b.rows ?? []) for (const c of r) if (Array.isArray(c.c)) walk(c.c as AnyBlock[], where);
  }
}
for (const f of fs.readdirSync(path.join(GEN, 'chapters')).filter((x) => /^ch\d+\.json$/.test(x))) {
  const ch = JSON.parse(fs.readFileSync(path.join(GEN, 'chapters', f), 'utf8'));
  walk(ch.intro, { chapter: ch.id });
  for (const l of ch.lessons) for (const s of l.steps) walk(s.blocks, { chapter: ch.id, lessonId: l.id, lessonNumber: l.number });
  walk(ch.summary, { chapter: ch.id });
}
for (const f of fs.readdirSync(path.join(GEN, 'questions')).filter((x) => /^ch\d+\.json$/.test(x))) {
  for (const q of JSON.parse(fs.readFileSync(path.join(GEN, 'questions', f), 'utf8'))) {
    walk(q.stem, { chapter: f.replace('.json', ''), question: q.id });
    walk(q.explanation, { chapter: f.replace('.json', ''), question: q.id });
  }
}
const used = new Map<string, Where>();
function block(id: string): string {
  const c = codes.get(id);
  if (!c) throw new Error(`code block ${id} not found in the generated content`);
  used.set(id, c.where);
  return c.text;
}
const ref = (id: string) => id;

function rawErrorPart(dbtBlock: string): string {
  const lines = dbtBlock.split('\n');
  const i = lines.findIndex((l) => l.trim() === 'Raw Error:');
  const body = lines.slice(i + 2);
  const ind = Math.min(...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return body.map((l) => l.slice(ind)).join('\n').replace(/^\n+|\n+$/g, '');
}
function after(text: string, marker: string): string {
  const i = text.indexOf(marker);
  if (i < 0) throw new Error(`marker not found: ${marker}`);
  const rest = text.slice(i + marker.length);
  return rest.startsWith('\n') ? rest.replace(/^\n+/, '') : rest;
}
const TS = /^\d\d:\d\d:\d\d {2}/;
function logLines(text: string, skip = ['...', 'Running with', 'Registered adapter', 'Found ']): string[] {
  return text.split('\n').map((l) => l.replace(TS, '')).filter((l) => l.trim() && !skip.some((s) => l.trim().startsWith(s)));
}
function inlineFromBash(id: string): string {
  const m = /--inline "([\s\S]*)"/.exec(block(id));
  if (!m) throw new Error(`no --inline in ${id}`);
  return m[1];
}

// ------------------------------------------------------------------------------------------- bug patches
function git(...args: string[]): string {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });
}
/** Apply a one-file unified diff (the book's bug patches) to a text. */
function applyPatch(text: string, patch: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let pos = 0;
  const hunks = patch.split('\n@@').slice(1);
  for (const h of hunks) {
    const m = /^ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@.*\n([\s\S]*)$/.exec(h);
    if (!m) throw new Error('bad hunk');
    const start = Number(m[1]) - 1;
    while (pos < start) out.push(lines[pos++]);
    for (const l of m[2].split('\n')) {
      if (l.startsWith(' ')) { if (lines[pos] !== l.slice(1)) throw new Error(`patch context mismatch at line ${pos + 1}`); out.push(lines[pos++]); }
      else if (l.startsWith('-')) { if (lines[pos] !== l.slice(1)) throw new Error(`patch removal mismatch at line ${pos + 1}`); pos++; }
      else if (l.startsWith('+')) out.push(l.slice(1));
    }
  }
  while (pos < lines.length) out.push(lines[pos++]);
  return out.join('\n');
}
function bugFile(patchName: string, tag: string): { path: string; original: string; broken: string } {
  const patch = fs.readFileSync(path.join(BUGS, patchName), 'utf8');
  const file = /^\+\+\+ b\/(.+)$/m.exec(patch)![1];
  const original = git('show', `${tag}:${file}`);
  return { path: file, original, broken: applyPatch(original, patch) };
}

// ------------------------------------------------------------------------------------------- YAML cases
type Case = Record<string, unknown> & { id: string };
function yamlCases(): Case[] {
  const out: Case[] = [];
  const add = (c: Case) => out.push(c);
  const lab = block('ch05-c23') + '\n';

  const m1 = block('ch05-c11');
  add({ id: 'ch05-m1-tab', ref: ref('ch05-c11'), title: 'Mistake 1: a tab instead of spaces (dbt parse)', engine: 'dbt', project: 'jaffle_practice', path: 'staging/_stg_models.yml',
    text: 'version: 2\n\nmodels:\n  - name: stg_orders\n\tdescription: "Orders"\n', reconstructed: 'file rebuilt from the context lines; line 5 starts with a TAB',
    expect: { kind: 'dbt_block', book: m1, raw_error: rawErrorPart(m1), near_line: 5 } });
  const m2 = block('ch05-c12');
  add({ id: 'ch05-m2-nospace', ref: ref('ch05-c12'), title: 'Mistake 2: missing space after the colon (dbt parse)', engine: 'dbt', project: 'jaffle_practice', path: 'staging/_stg_models.yml',
    text: 'version: 2\n\nmodels:\n  - name:stg_orders\n    description: "Orders"\n', reconstructed: 'file rebuilt from the context lines',
    expect: { kind: 'dbt_block', book: m2, raw_error: rawErrorPart(m2), near_line: 5 } });
  const m3 = block('ch05-c13');
  add({ id: 'ch05-m3-jinja', ref: ref('ch05-c13'), title: 'Mistake 3: unquoted Jinja (dbt parse)', engine: 'dbt', project: 'jaffle_practice', path: 'staging/_stg_models.yml',
    text: 'version: 2\n\nmodels:\n  - name: stg_orders\n    config:\n      schema: {{ target.schema }}\n', reconstructed: 'file rebuilt from the context lines',
    expect: { kind: 'dbt_block', book: m3, raw_error: rawErrorPart(m3), near_line: 6 } });
  const m4 = 'version: 2\n\nmodels:\n  - name: stg_payments\n    description: Payments: from Stripe\n';
  const col = m4.split('\n')[4].indexOf(': from') + 1;
  add({ id: 'ch05-m4-colon-dbt', ref: 'ch05-c13+text', title: 'Mistake 4: a colon inside a value (dbt / libyaml words)', engine: 'dbt', project: 'jaffle_practice', path: 'staging/_stg_models.yml', text: m4,
    reconstructed: "book gives only the phrase and 'the column points at the second colon'",
    expect: { kind: 'contains', phrases: ['mapping values are not allowed in this context'], line: 5, column: col } });
  add({ id: 'ch05-m4-colon-pyyaml', ref: 'ch05-c13+text', title: 'Mistake 4 with yaml.safe_load (pure-Python words)', engine: 'pyyaml', filename: 'broken.yml', text: m4,
    expect: { kind: 'contains', phrases: ['mapping values are not allowed here'], line: 5, column: col } });
  add({ id: 'ch05-m5-dupkey', ref: ref('ch05-c15'), title: 'Mistake 5: duplicated key (dbt 1.11 warning)', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
    text: block('ch05-c14') + '\n', expect: { kind: 'warning', book: block('ch05-c15') } });
  add({ id: 'ch05-m5-dupkey-value', ref: ref('ch05-c14'), title: 'Mistake 5: a plain reader keeps the last value', engine: 'pyyaml', text: block('ch05-c14') + '\n',
    expect: { kind: 'value', expr: "data['models'][0]['description']", print: true, book: 'Second' } });

  add({ id: 'ch05-lab-step3', ref: ref('ch05-c25'), title: "Lab step 3: python -c yaml.safe_load(open('broken.yml'))", engine: 'pyyaml', filename: 'broken.yml', text: lab,
    expect: { kind: 'traceback', book: block('ch05-c25') } });
  const step4 = lab.replace('    description: Payments from Stripe: one row per payment', '    description: "Payments from Stripe: one row per payment"');
  add({ id: 'ch05-lab-step4', ref: ref('ch05-c26'), title: 'Lab step 4: after quoting the description', engine: 'pyyaml', filename: 'broken.yml', text: step4,
    expect: { kind: 'traceback', book: block('ch05-c26') } });
  const step5 = step4.replace('     - name: amount_usd', '      - name: amount_usd');
  add({ id: 'ch05-lab-step5', ref: ref('ch05-c27'), title: 'Lab step 5: valid YAML, but config is a text', engine: 'pyyaml', filename: 'broken.yml', text: step5,
    expect: { kind: 'value', expr: "data['models'][0]['config']", print: true, book: block('ch05-c27').split('\n')[1] } });
  const final = step5.replace('      schema:{{ target.schema }}', '      schema: "{{ target.schema }}"').replace('values: [success, fail]', "values: ['success', 'fail']");
  add({ id: 'ch05-lab-final', ref: ref('ch05-c28'), title: 'Lab expected result: config is a mapping', engine: 'pyyaml', filename: 'broken.yml', text: final,
    expect: { kind: 'value', expr: "data['models'][0]['config']", print: true, book: block('ch05-c28').split('\n').at(-1) } });
  add({ id: 'ch05-lab-final-valid', ref: ref('ch05-c28'), title: "Lab expected result: 'valid YAML'", engine: 'pyyaml', filename: 'broken.yml', text: final, expect: { kind: 'valid' } });

  add({ id: 'ch05-quiz2', ref: 'ch05-c58 (q-ch05-02)', title: 'Quiz 2: which line fails (answer: line 10, column 33)', engine: 'dbt', project: 'jaffle_practice', path: 'staging/_stg_models.yml',
    text: block('ch05-c58') + '\n', expect: { kind: 'contains', phrases: ['mapping values are not allowed in this context'], line: 10, column: 33 } });
  add({ id: 'ch05-quiz-folded', ref: 'q-ch05 answers', title: "Quiz: zip_code: >01234 'even causes a YAML error'", engine: 'pyyaml', text: 'vars:\n  zip_code: >01234\n', expect: { kind: 'error_any' } });
  add({ id: 'ch05-trap-jinja', ref: ref('ch05-c8'), title: 'Trap: schema: {{ target.schema }} is a parsing error', engine: 'pyyaml', text: block('ch05-c8') + '\n', expect: { kind: 'error_any' } });

  const scalars: [string, string][] = [
    ['status: completed', "'completed'"], ['count: 300', '300'], ['enabled: true', 'True'], ['enabled: yes', 'True'], ["answer: 'yes'", "'yes'"],
    ['version: 1.10', '1.1'], ['zip: 01234', '668'], ["zip: '01234'", "'01234'"], ['value: null', 'None'], ['value: ~', 'None'], ['value:', 'None'], ['enabled: no', 'False'],
  ];
  scalars.forEach(([line, repr], i) => add({ id: `ch05-scalar-${String(i).padStart(2, '0')}`, ref: i < 11 ? 'ch05 scalar table' : 'q-ch05 answers', title: `Scalar: ${line}`, engine: 'pyyaml', text: line + '\n',
    expect: { kind: 'value', expr: 'list(data.values())[0]', book: repr } }));
  add({ id: 'ch05-list-of-mappings', ref: ref('ch05-c5'), title: 'A list of mappings, printed by Python', engine: 'pyyaml', text: block('ch05-c4') + '\n',
    expect: { kind: 'value', expr: 'data', print: true, book: block('ch05-c5') } });
  add({ id: 'ch05-multiline', ref: ref('ch05-c9'), title: 'Literal | and folded > blocks', engine: 'pyyaml', text: block('ch05-c9') + '\n',
    expect: { kind: 'value', expr: "(data['literal'], data['folded'])", book: "('line one\\nline two\\n', 'line one line two\\n')" } });
  add({ id: 'ch05-anchor-merge', ref: ref('ch05-c10'), title: 'Anchor + merge key', engine: 'pyyaml', text: block('ch05-c10') + '\n',
    expect: { kind: 'value', expr: "data['model_a']", book: "{'materialized': 'view', 'schema': 'marts'}" } });

  const bug2 = block('ch22-c7');
  const bug2file = bugFile('02-yaml-bad-indentation.patch', 'ch22');
  add({ id: 'ch22-bug2-indent', ref: ref('ch22-c7'), title: 'Bug 2: 7 spaces instead of 8 (dbt parse)', engine: 'dbt', project: 'jaffle_dbt', path: 'staging/stripe/_stripe__models.yml',
    text: bug2file.broken, reconstructed: 'reference repo tag ch22 + bugs/02-yaml-bad-indentation.patch',
    expect: { kind: 'dbt_block', book: bug2, raw_error: rawErrorPart(bug2), near_line: 15, skip_lines: 1 } });
  add({ id: 'ch22-table-colon', ref: 'ch22 error table', title: 'Table: description: Status: paid', engine: 'dbt', project: 'jaffle_dbt', path: 'staging/stripe/_stripe__models.yml',
    text: 'version: 2\n\nmodels:\n  - name: stg_stripe__payments\n    columns:\n      - name: status\n        description: Status: paid\n', reconstructed: "minimal file around the book's example value",
    expect: { kind: 'contains', phrases: ['mapping values are not allowed in this context'] } });
  add({ id: 'ch22-table-flow', ref: 'ch22 error table', title: "Table: schema: {{ env_var('S', 'stripe') }}", engine: 'dbt', project: 'jaffle_dbt', path: 'staging/stripe/_stripe__sources.yml',
    text: "version: 2\n\nsources:\n  - name: stripe\n    schema: {{ env_var('S', 'stripe') }}\n    tables:\n      - name: payments\n", reconstructed: "minimal sources file around the book's example value",
    expect: { kind: 'contains', phrases: ['while parsing a flow mapping', "did not find expected ',' or '}'"] } });
  add({ id: 'ch22-table-tab', ref: 'ch22 error table', title: 'Table: a tab instead of spaces', engine: 'dbt', project: 'jaffle_dbt', path: 'staging/stripe/_stripe__models.yml',
    text: 'version: 2\n\nmodels:\n  - name: stg_stripe__payments\n\tdescription: One row per payment.\n', reconstructed: 'minimal file',
    expect: { kind: 'contains', phrases: ['found a tab character that violates indentation'] } });
  add({ id: 'ch22-shape-columns', ref: 'ch22 error table', title: 'dbt shape check: columns written as a dictionary', engine: 'dbt', project: 'jaffle_dbt', path: 'staging/stripe/_stripe__models.yml',
    text: 'version: 2\n\nmodels:\n  - name: stg_stripe__payments\n    columns:\n      payment_id:\n        description: Primary key.\n', reconstructed: "minimal file; this is dbt's JSON-schema check, not PyYAML",
    expect: { kind: 'contains', phrases: ["at path ['columns']", "is not of type 'array'"] } });
  add({ id: 'ch05-shape-config', ref: 'ch05-c27+text', title: 'dbt shape check: config is a text (lab step 5 file)', engine: 'dbt', project: 'jaffle_practice', path: 'staging/_stg_models.yml', text: step5,
    reconstructed: 'lab file after step 4; book paraphrases the message', expect: { kind: 'contains', phrases: ["at path ['config']", "is not of type 'object'"] } });
  const bug9 = bugFile('09-yaml-key-typo.patch', 'ch22');
  add({ id: 'ch22-bug9-typo', ref: 'ch22 bug 9', title: 'Bug 9: desciption: is valid YAML (silent on DuckDB)', engine: 'dbt', project: 'jaffle_dbt', path: 'marts/_marts__models.yml',
    text: 'version: 2\n\nmodels:\n  - name: fct_monthly_revenue\n    desciption: Monthly revenue per country.\n', reconstructed: 'minimal file', expect: { kind: 'valid' },
    bugFile: { path: bug9.path, broken: bug9.broken, original: bug9.original } });
  // keep the full bug-2 file pair for the "fix the broken file" exercise
  (out.find((c) => c.id === 'ch22-bug2-indent') as Case).bugFile = { path: bug2file.path, broken: bug2file.broken, original: bug2file.original };
  return out;
}

// ------------------------------------------------------------------------------------------- Jinja cases
function jinjaCases(): Case[] {
  const out: Case[] = [];
  const add = (c: Case) => out.push({ project: 'ch11', node: { name: 'inline_query', resource_type: 'sql_operation' }, ...c });
  // ids keep the spike's names (LaTeX line of the template) so that results can be compared with its report
  const plain: [string, string, string, number][] = [
    ['ch05-c29', 'ch05-c30', 'set + upper filter', 677], ['ch05-c31', 'ch05-c32', 'filters: join, length, default, replace, lower', 697],
    ['ch05-c33', 'ch05-c34', 'if / elif / else', 736], ['ch05-c35', 'ch05-c36', 'pivot_broken.sql: for loop, trailing comma', 772],
    ['ch05-c37', 'ch05-c38', 'pivot.sql: whitespace control + loop.last', 837], ['ch05-c39', 'ch05-c40', 'macro cents_to_dollars', 881],
  ];
  for (const [tpl, outId, title, line] of plain) {
    add({ id: `ch05-plain-${line}`, ref: ref(tpl), title, mode: 'plain', template: block(tpl) + '\n', expect: { kind: 'compiled', cmp: 'equal', book: block(outId) } });
  }
  add({ id: 'ch05-plain-set-in-loop', ref: ref('ch05-c43'), title: 'deepbox: set inside a loop -> total=0', mode: 'plain', template: block('ch05-c43') + '\n', expect: { kind: 'compiled', cmp: 'ws', book: 'total=0' } });
  add({ id: 'ch05-plain-namespace', ref: 'ch05-c43+text', title: 'deepbox: namespace() -> 6', mode: 'plain',
    template: '{% set ns = namespace(total=0) %}{% for x in [1, 2, 3] %}{% set ns.total = ns.total + x %}{% endfor %}{{ ns.total }}\n', expect: { kind: 'compiled', cmp: 'ws', book: '6' } });
  add({ id: 'ch05-plain-quiz9', ref: 'ch05-c59 (q-ch05-09)', title: 'quiz: set in loop renders 0', mode: 'plain', template: block('ch05-c59') + '\n', expect: { kind: 'compiled', cmp: 'ws', book: '0' } });
  add({ id: 'ch05-plain-tilde', ref: 'ch05 text', title: 'the ~ operator', mode: 'plain', template: "{{ 'stg_' ~ 'orders' }}\n", expect: { kind: 'compiled', cmp: 'equal', book: 'stg_orders' } });

  add({ id: 'ch05-dbt-source', ref: ref('ch05-c44'), title: 'stg_orders.sql: source() compiled', mode: 'dbt', project: 'ch05', node: { name: 'stg_orders', resource_type: 'model', path: 'models/staging/stg_orders.sql' },
    template: block('ch05-c44') + '\n', expect: { kind: 'compiled', cmp: 'equal', book: after(block('ch05-c45'), "Compiled node 'stg_orders' is:") } });
  add({ id: 'ch05-dbt-braces', ref: 'ch05 text', title: '{{ }} inside {% %}: compilation error', mode: 'dbt', project: 'ch05', template: "{% if {{ target.name }} == 'prod' %}select 1{% endif %}",
    expect: { kind: 'error', phrases: ["expected token ':', got '}'"] } });
  add({ id: 'ch05-dbt-undefined', ref: 'ch05 text', title: 'undefined variable renders as empty text', mode: 'dbt', project: 'ch05', template: 'select {{ my_colum }} from t', expect: { kind: 'compiled', cmp: 'equal', book: 'select  from t' } });
  add({ id: 'ch05-dbt-quiz10', ref: 'ch05-c60 (q-ch05-10)', title: "quiz: typo order_dat compiles 'select  from ...'", mode: 'dbt', project: 'ch05', template: block('ch05-c60'), expect: { kind: 'compiled', cmp: 'within', book: 'select  from' } });

  add({ id: 'ch11-context-inline', ref: ref('ch11-c1'), title: 'run_started_at, flags.WHICH, project_name, modules', mode: 'dbt', template: inlineFromBash('ch11-c1'),
    expect: { kind: 'compiled', cmp: 'equal', book: after(block('ch11-c2'), 'Compiled inline node is:') }, note: "run_started_at pinned to the book's date (2026-10-21)" });
  const thisOut = block('ch11-c5');
  const devPart = thisOut.split('...')[0];
  const tmpThis = { tmp_this_demo: { path: 'models/marts/tmp_this_demo.sql', materialized: 'table', schema: 'marts' } };
  add({ id: 'ch11-this-dev', ref: ref('ch11-c3'), title: '{{ this }} in dev', mode: 'dbt', node: { name: 'tmp_this_demo', resource_type: 'model', path: 'models/marts/tmp_this_demo.sql' }, extra_models: tmpThis,
    template: block('ch11-c3') + '\n', expect: { kind: 'compiled', cmp: 'equal', book: after(devPart, "Compiled node 'tmp_this_demo' is:").replace(/\n+$/, '') } });
  add({ id: 'ch11-this-prod', ref: ref('ch11-c3'), title: '{{ this }} with --target prod', mode: 'dbt', target: 'prod', node: { name: 'tmp_this_demo', resource_type: 'model', path: 'models/marts/tmp_this_demo.sql' }, extra_models: tmpThis,
    template: block('ch11-c3') + '\n', expect: { kind: 'compiled', cmp: 'equal', book: after(thisOut.split('...')[1], "Compiled node 'tmp_this_demo' is:").replace(/\n+$/, '') } });
  add({ id: 'ch11-log-twice', ref: ref('ch11-c6'), title: 'log() printed in both renderings', mode: 'dbt', template: inlineFromBash('ch11-c6'),
    expect: { kind: 'logs', book: logLines(block('ch11-c7')).filter((l) => l.startsWith('execute is')), compiled: after(block('ch11-c7'), 'Compiled inline node is:') } });
  add({ id: 'ch11-ref-in-sql-comment', ref: ref('ch11-c8'), title: 'ref() inside a SQL comment is a dependency', mode: 'dbt', node: { name: 'tmp_comment_demo', resource_type: 'model', path: 'models/marts/tmp_comment_demo.sql' },
    extra_models: { tmp_comment_demo: { path: 'models/marts/tmp_comment_demo.sql', materialized: 'table', schema: 'marts' } }, template: block('ch11-c8') + '\n',
    expect: { kind: 'parents', book: ['dim_customers'], compiled_contains: '-- old version: select * from "practice"."dbt_adnane"."dim_customers"' } });
  add({ id: 'ch11-duplicate-macro', ref: ref('ch11-c11'), title: 'two macros with the same name', mode: 'dbt', extra_macro_files: { 'macros/money.sql': '{% macro cents_to_dollars(x) %}{{ x }}{% endmacro %}\n' },
    template: 'select 1', expect: { kind: 'error', cmp_block: block('ch11-c11'), phrases: ['dbt found multiple macros named "cents_to_dollars"'] } });
  add({ id: 'ch11-macro-in-model', ref: 'ch11-c13', title: "{{ cents_to_dollars('amount') }} as amount,", mode: 'dbt', template: "{{ cents_to_dollars('amount') }} as amount,",
    expect: { kind: 'compiled', cmp: 'equal', book: 'cast(amount / 100 as decimal(16, 2)) as amount,' } });
  add({ id: 'ch11-unquoted-arg', ref: ref('ch11-c15'), title: 'unquoted argument -> empty text', mode: 'dbt', template: inlineFromBash('ch11-c15'), expect: { kind: 'compiled', cmp: 'equal', book: after(block('ch11-c16'), 'Compiled inline node is:') } });
  add({ id: 'ch11-too-many-args', ref: ref('ch11-c20'), title: 'too many arguments: parse error', mode: 'dbt', template: inlineFromBash('ch11-c20'), expect: { kind: 'error', phase: 'parse', phrases: [logLines(block('ch11-c21'))[1]] } });
  add({ id: 'ch11-missing-arg', ref: 'ch11 text', title: 'missing required argument is silent', mode: 'dbt', template: '{{ cents_to_dollars() }}', expect: { kind: 'compiled', cmp: 'equal', book: 'cast( / 100 as decimal(16, 2))' } });
  add({ id: 'ch11-namespace-call', ref: 'ch11 text', title: "jaffle_dbt.cents_to_dollars(column_name=..., scale=4)", mode: 'dbt', template: "{{ jaffle_dbt.cents_to_dollars(column_name='amount', scale=4) }}",
    expect: { kind: 'compiled', cmp: 'equal', book: 'cast(amount / 100 as decimal(16, 4))' } });
  add({ id: 'ch11-undefined-macro', ref: ref('ch11-c22'), title: 'typo in a macro name', mode: 'dbt', template: inlineFromBash('ch11-c22'), expect: { kind: 'error', phrases: [block('ch11-c23').split('\n').at(-1)!.trim()] } });
  add({ id: 'ch11-dateadd', ref: 'ch11 text', title: 'dbt.dateadd on DuckDB (real dbt-duckdb macro source)', mode: 'dbt', template: "{{ dbt.dateadd('day', 7, \"date '2026-01-01'\") }}",
    expect: { kind: 'compiled', cmp: 'ws', book: "(date '2026-01-01' + cast(7 as bigint) * interval 1 day)" } });
  add({ id: 'ch11-return', ref: ref('ch11-c24'), title: 'printing is not returning', mode: 'dbt', extra_macro_files: { 'macros/zz_demo.sql': block('ch11-c24') + '\n' }, template: inlineFromBash('ch11-c25'),
    expect: { kind: 'compiled', cmp: 'equal', book: after(block('ch11-c26'), 'Compiled inline node is:') } });
  const tmpMethods = { tmp_methods: { path: 'models/tmp_methods.sql', materialized: 'view' } };
  add({ id: 'ch11-run-query-no-guard', ref: ref('ch11-c31'), title: 'run_query without {% if execute %}', mode: 'dbt', node: { name: 'tmp_methods', resource_type: 'model', path: 'models/tmp_methods.sql' },
    extra_models: tmpMethods, extra_macro_files: { 'macros/get_payment_methods.sql': block('ch11-c31') + '\n' }, template: block('ch11-c32') + '\n',
    expect: { kind: 'error', phase: 'parse', phrases: ["'None' has no attribute 'table'"], cmp_block: block('ch11-c34').split('\n').slice(3).join('\n') } });
  add({ id: 'ch11-run-query-guarded', ref: ref('ch11-c35'), title: 'run_query with the execute guard (needs the DB)', mode: 'dbt', node: { name: 'tmp_methods', resource_type: 'model', path: 'models/tmp_methods.sql' },
    extra_models: tmpMethods, extra_macro_files: { 'macros/get_payment_methods.sql': block('ch11-c35') + '\n' }, template: block('ch11-c32') + '\n',
    expect: { kind: 'compiled', cmp: 'segments', book: after(block('ch11-c37'), "Compiled node 'tmp_methods' is:") }, db: true });
  add({ id: 'ch11-raise-compiler-error', ref: ref('ch11-c38'), title: 'exceptions.raise_compiler_error', mode: 'dbt', template: inlineFromBash('ch11-c38'), expect: { kind: 'error', phase: 'parse', phrases: [logLines(block('ch11-c39'))[1]] } });
  add({ id: 'ch11-adapter-describe', ref: ref('ch11-c40'), title: 'adapter.get_columns_in_relation / get_relation (run-operation)', mode: 'dbt', passes: ['execute'], extra_macro_files: { 'macros/zz_demo.sql': block('ch11-c40') + '\n' },
    template: "{{ describe_relation(model_name='stg_stripe__payments') }}", expect: { kind: 'logs', book: logLines(block('ch11-c42')) }, db: true });
  add({ id: 'ch11-print-row-counts', ref: ref('ch11-c44'), title: 'print_row_counts: graph + adapter + run_query', mode: 'dbt', passes: ['execute'], template: '{{ print_row_counts() }}', expect: { kind: 'logs', book: logLines(block('ch11-c45')) }, db: true });
  add({ id: 'ch11-print-row-counts-views', ref: ref('ch11-c46'), title: "print_row_counts --args '{materializations: [view]}'", mode: 'dbt', passes: ['execute'], template: "{{ print_row_counts(materializations=['view']) }}",
    expect: { kind: 'logs', book: logLines(block('ch11-c47')) }, db: true });
  add({ id: 'ch11-pivot-model', ref: ref('ch11-c66'), title: 'int_orders__payment_methods_pivoted (loop unrolled)', mode: 'dbt',
    node: { name: 'int_orders__payment_methods_pivoted', resource_type: 'model', path: 'models/intermediate/int_orders__payment_methods_pivoted.sql' }, template: block('ch11-c66') + '\n',
    expect: { kind: 'compiled', cmp: 'segments', book: block('ch11-c68') } });
  add({ id: 'ch11-get-column-values', ref: ref('ch11-c69'), title: 'dbt_utils.get_column_values (real dbt_utils source)', mode: 'dbt', template: /--inline "([\s\S]*)"$/.exec(block('ch11-c69'))![1],
    expect: { kind: 'compiled', cmp: 'equal', book: after(block('ch11-c70'), 'Compiled inline node is:') }, db: true });
  add({ id: 'ch11-surrogate-key', ref: ref('ch11-c73'), title: 'dbt_utils.generate_surrogate_key in fct_order_items', mode: 'dbt', node: { name: 'fct_order_items', resource_type: 'model', path: 'models/marts/fct_order_items.sql' },
    template: block('ch11-c73') + '\n', expect: { kind: 'compiled', cmp: 'within', book: block('ch11-c74') } });
  add({ id: 'ch11-star', ref: ref('ch11-c76'), title: 'dbt_utils.star (reads columns in the warehouse)', mode: 'dbt', template: inlineFromBash('ch11-c76'), expect: { kind: 'compiled', cmp: 'equal', book: after(block('ch11-c77'), 'Compiled inline node is:') }, db: true });
  add({ id: 'ch11-quiz-get-statuses', ref: 'ch11-c106 (q-ch11-08)', title: 'quiz hotspot: run_query unguarded in a macro', mode: 'dbt', node: { name: 'tmp_statuses', resource_type: 'model', path: 'models/tmp_statuses.sql' },
    extra_models: { tmp_statuses: { path: 'models/tmp_statuses.sql', materialized: 'view' } }, extra_macro_files: { 'macros/get_statuses.sql': block('ch11-c106') + '\n' },
    template: '{% set statuses = get_statuses() %}\nselect {{ statuses | length }} as n\n', expect: { kind: 'error', phase: 'parse', phrases: ["'None' has no attribute 'table'"] } });
  add({ id: 'ch11-quiz-deleted-ref', ref: 'q-ch11 answers', title: 'quiz: ref() of a deleted model inside -- comment', mode: 'dbt', node: { name: 'tmp_legacy', resource_type: 'model', path: 'models/tmp_legacy.sql' },
    extra_models: { tmp_legacy: { path: 'models/tmp_legacy.sql', materialized: 'view' } }, template: "-- select * from {{ ref('legacy_orders') }}\nselect 1 as x\n",
    expect: { kind: 'error', phrases: ["depends on a node named 'legacy_orders' which was not found"] } });
  add({ id: 'ch11-trap-macro-newline', ref: 'ch11 trap', title: "trap: a macro's leading newline escapes the -- comment", mode: 'dbt', extra_macro_files: { 'macros/tip_rule.sql': '{% macro tip_rule() %}\n    round(amount * 0.1, 2)\n{% endmacro %}\n' },
    template: "select\n    amount,\n    -- old rule: {{ tip_rule() }} as tip\nfrom {{ ref('stg_stripe__payments') }}", expect: { kind: 'compiled', cmp: 'within', book: '-- old rule:\nround(amount * 0.1, 2)\nas tip' },
    reconstructed: 'the macro source is not printed in the book' });
  return out;
}

// ------------------------------------------------------------------------------------------- exercises
// "Fix the broken file" and friends. Every start text comes from the book (or is derived from it, said in `derived`);
// the check is automatic: the file must load, and the parts that matter must read the way the book says.
interface YamlExercise {
  id: string; group: 'fix' | 'jinja' | 'indent' | 'values'; title: string; task: string; engine: 'dbt' | 'pyyaml';
  path?: string; filename?: string; project?: string; start: string; solution: string;
  checks: { values?: { expr: string; equals: string; print?: boolean; label: string }[]; noWarnings?: boolean; sameDataAsSolution?: boolean };
  hint: string; why: string; source: { codeId?: string; label: string }; derived?: string;
}
function yamlExercises(cases: Case[]): YamlExercise[] {
  const c = (id: string) => cases.find((x) => x.id === id)!;
  const labStart = block('ch05-c23') + '\n';
  const labSolution = labStart
    .replace('    description: Payments from Stripe: one row per payment', '    description: "Payments from Stripe: one row per payment"')
    .replace('     - name: amount_usd', '      - name: amount_usd')
    .replace('      schema:{{ target.schema }}', '      schema: "{{ target.schema }}"');
  const bug2 = c('ch22-bug2-indent').bugFile as { path: string; broken: string; original: string };
  const bug9 = c('ch22-bug9-typo').bugFile as { path: string; broken: string; original: string };
  return [
    { id: 'lab-broken-yml', group: 'fix', title: 'Fix a broken YAML file (the lab of Chapter 5)', engine: 'pyyaml', filename: 'broken.yml',
      task: 'This file has three mistakes. Fix them one by one: read the message, go to the line and column it gives, fix, check again. At the end, config must be a mapping with the key schema.',
      start: labStart, solution: labSolution,
      checks: { values: [{ expr: "data['models'][0]['config']", print: true, equals: block('ch05-c28').split('\n').at(-1)!, label: 'config of stg_payments' },
        { expr: "data['models'][0]['description']", print: true, equals: 'Payments from Stripe: one row per payment', label: 'the description' },
        { expr: "[c['name'] for c in data['models'][0]['columns']]", equals: "['payment_id', 'amount_usd', 'status']", label: 'the three columns' }] },
      hint: 'First error: a colon followed by a space inside the description. Put the whole description in double quotes.',
      why: 'YAML reads "key: value" pairs. A second ": " in a value, a list item one space out of line, or a missing space after a colon change what YAML sees.',
      source: { codeId: 'ch05-c23', label: 'Lesson 5.2, lab: fix a broken YAML file' } },
    { id: 'mistake-tab', group: 'indent', title: 'A tab instead of spaces', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
      task: 'Line 5 starts with a TAB character. YAML allows only spaces for indentation. Replace the tab by 4 spaces.',
      start: c('ch05-m1-tab').text as string, solution: (c('ch05-m1-tab').text as string).replace('\tdescription', '    description'),
      checks: { values: [{ expr: "data['models'][0]", equals: "{'name': 'stg_orders', 'description': 'Orders'}", label: 'the model' }] },
      hint: 'Delete the invisible character at the start of line 5, then type 4 spaces.', why: 'A tab looks like spaces in many editors, but YAML refuses it: "found a tab character that violates indentation".',
      source: { codeId: 'ch05-c11', label: 'Lesson 5.2, mistake 1' }, derived: 'file rebuilt from the lines the book prints' },
    { id: 'mistake-nospace', group: 'fix', title: 'A missing space after the colon', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
      task: 'dbt says "mapping values are not allowed in this context" on line 5. The real mistake is on line 4. Find it and fix it.',
      start: c('ch05-m2-nospace').text as string, solution: (c('ch05-m2-nospace').text as string).replace('name:stg_orders', 'name: stg_orders'),
      checks: { values: [{ expr: "data['models'][0]['name']", print: true, equals: 'stg_orders', label: 'the model name' }] },
      hint: 'Without a space, "name:stg_orders" is one text, not a key and a value.', why: 'YAML needs a space after the colon of a key. The error is reported where YAML gets lost (line 5), not where the mistake is.',
      source: { codeId: 'ch05-c12', label: 'Lesson 5.2, mistake 2' }, derived: 'file rebuilt from the lines the book prints' },
    { id: 'mistake-jinja', group: 'jinja', title: 'Quote the Jinja', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
      task: 'A value that starts with {{ must be in quotes, otherwise YAML reads { as the start of a mapping. Fix the schema line.',
      start: c('ch05-m3-jinja').text as string, solution: (c('ch05-m3-jinja').text as string).replace('schema: {{ target.schema }}', 'schema: "{{ target.schema }}"'),
      checks: { values: [{ expr: "data['models'][0]['config']['schema']", print: true, equals: '{{ target.schema }}', label: 'the schema value' }] },
      hint: 'Write schema: "{{ target.schema }}"', why: 'In YAML, { starts an inline mapping. dbt renders the Jinja later, but first the file must be valid YAML.',
      source: { codeId: 'ch05-c13', label: 'Lesson 5.2, mistake 3' }, derived: 'file rebuilt from the lines the book prints' },
    { id: 'mistake-colon', group: 'fix', title: 'A colon inside a value', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
      task: 'The description contains ": ". Make YAML read the whole text as the description.',
      start: c('ch05-m4-colon-dbt').text as string, solution: (c('ch05-m4-colon-dbt').text as string).replace('description: Payments: from Stripe', 'description: "Payments: from Stripe"'),
      checks: { values: [{ expr: "data['models'][0]['description']", print: true, equals: 'Payments: from Stripe', label: 'the description' }] },
      hint: 'Quote the value.', why: '": " (colon + space) means "a new key starts here", even in the middle of a sentence.', source: { label: 'Lesson 5.2, mistake 4' }, derived: 'file rebuilt from the book text' },
    { id: 'mistake-dupkey', group: 'fix', title: 'A key written twice', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
      task: 'This file is valid YAML, but dbt 1.11 warns: the same key appears twice and only the last value is kept. Keep only the description "First".',
      start: block('ch05-c14') + '\n', solution: (block('ch05-c14') + '\n').replace('\n    description: "Second"', ''),
      checks: { noWarnings: true, values: [{ expr: "data['models'][0]['description']", print: true, equals: 'First', label: 'the description' }] },
      hint: 'Delete the second description line.', why: 'A plain YAML reader silently keeps the last value. dbt 1.11 shows the DuplicateYAMLKeysDeprecation warning.',
      source: { codeId: 'ch05-c14', label: 'Lesson 5.2, mistake 5' } },
    { id: 'bug2-indent', group: 'indent', title: 'Seven spaces instead of eight (bug 2 of Chapter 22)', engine: 'dbt', project: 'jaffle_dbt', path: 'models/' + bug2.path.replace(/^models\//, ''),
      task: 'This is the real _stripe__models.yml of the reference project with bugs/02-yaml-bad-indentation.patch applied. Read the dbt message, find the line, fix the indentation.',
      start: bug2.broken, solution: bug2.original, checks: { sameDataAsSolution: true },
      hint: 'dbt says "Syntax error near line 15": count the spaces before description on that line.', why: 'Keys of the same mapping must start in the same column. One space less and YAML thinks the list item ended.',
      source: { codeId: 'ch22-c7', label: 'Lesson 22.2, bug 2' }, derived: 'reference project at tag ch22 + bugs/02-yaml-bad-indentation.patch' },
    { id: 'bug9-typo', group: 'fix', title: 'A typo in a key (bug 9 of Chapter 22)', engine: 'dbt', project: 'jaffle_dbt', path: 'models/' + bug9.path.replace(/^models\//, ''),
      task: 'This file is valid YAML and dbt on DuckDB says nothing, but one description is lost. Find the key with a typo and fix it.',
      start: bug9.broken, solution: bug9.original, checks: { sameDataAsSolution: true },
      hint: 'Look at the model fct_monthly_revenue.', why: 'YAML does not know dbt\'s keys: any key is valid YAML. dbt 1.11 checks keys only on some warehouses, not on DuckDB.',
      source: { label: 'Lesson 22.2, bug 9' }, derived: 'reference project at tag ch22 + bugs/09-yaml-key-typo.patch' },
    { id: 'flow-envvar', group: 'jinja', title: 'Jinja with a default value', engine: 'dbt', project: 'jaffle_dbt', path: 'models/staging/stripe/_stripe__sources.yml',
      task: "Make YAML read the schema as the text {{ env_var('S', 'stripe') }}.",
      start: c('ch22-table-flow').text as string, solution: (c('ch22-table-flow').text as string).replace("schema: {{ env_var('S', 'stripe') }}", "schema: \"{{ env_var('S', 'stripe') }}\""),
      checks: { values: [{ expr: "data['sources'][0]['schema']", print: true, equals: "{{ env_var('S', 'stripe') }}", label: 'the schema value' }] },
      hint: 'The value contains single quotes: put it in double quotes.', why: 'Unquoted, { starts a flow mapping and the comma inside the Jinja looks like a separator: "did not find expected \',\' or \'}\'".',
      source: { label: 'Lesson 22.2, error table' }, derived: 'minimal file around the value of the book' },
    { id: 'columns-list', group: 'indent', title: 'columns must be a list', engine: 'dbt', project: 'jaffle_dbt', path: 'models/staging/stripe/_stripe__models.yml',
      task: 'This is valid YAML, but dbt refuses it: columns is a mapping here, dbt wants a list of columns, each with a name. Rewrite it as a list.',
      start: c('ch22-shape-columns').text as string,
      solution: 'version: 2\n\nmodels:\n  - name: stg_stripe__payments\n    columns:\n      - name: payment_id\n        description: Primary key.\n',
      checks: { values: [{ expr: "data['models'][0]['columns']", equals: "[{'name': 'payment_id', 'description': 'Primary key.'}]", label: 'columns' }] },
      hint: 'Each column starts with "- name:".', why: 'dbt validates the shape of properties files: "at path [\'columns\'] ... is not of type \'array\'".',
      source: { label: 'Lesson 22.2, error table' }, derived: 'minimal file' },
    { id: 'quiz2-colon', group: 'fix', title: 'Which line fails? (quiz 2 of Chapter 5)', engine: 'dbt', project: 'jaffle_practice', path: 'models/staging/_stg_models.yml',
      task: 'Find the line YAML cannot read, and fix it so that the description keeps all its words.',
      start: block('ch05-c58') + '\n', solution: (block('ch05-c58') + '\n').replace('description: Primary key: unique per customer', 'description: "Primary key: unique per customer"'),
      checks: { values: [{ expr: "data['models'][0]['columns'][0]['description']", print: true, equals: 'Primary key: unique per customer', label: 'the column description' }] },
      hint: 'Line 10.', why: 'Same rule as mistake 4: ": " inside a value.', source: { codeId: 'ch05-c58', label: 'Chapter 5 quiz, question 2' } },
    { id: 'zip-code', group: 'values', title: 'A zip code that becomes a number', engine: 'pyyaml',
      task: 'Python reads zip: 01234 as the number 668 (an old octal rule). Make it read the text 01234.',
      start: 'customer:\n  name: Lina\n  zip: 01234\n', solution: "customer:\n  name: Lina\n  zip: '01234'\n",
      checks: { values: [{ expr: "data['customer']['zip']", equals: "'01234'", label: 'zip' }] },
      hint: 'Quote it.', why: 'YAML guesses types: numbers, booleans and dates are converted unless you quote them.', source: { label: 'Lesson 5.2, what YAML reads' }, derived: 'built on the scalar table of the book' },
    { id: 'yes-no', group: 'values', title: 'yes is not a text', engine: 'pyyaml',
      task: "The answer must be the text 'yes', not the boolean True.",
      start: 'survey:\n  question: Do you like dbt?\n  answer: yes\n', solution: "survey:\n  question: Do you like dbt?\n  answer: 'yes'\n",
      checks: { values: [{ expr: "data['survey']['answer']", equals: "'yes'", label: 'answer' }] },
      hint: 'Quote it.', why: 'PyYAML reads yes, no, on, off, true and false as booleans.', source: { label: 'Lesson 5.2, what YAML reads' }, derived: 'built on the scalar table of the book' },
    { id: 'version-number', group: 'values', title: 'Version 1.10 becomes 1.1', engine: 'pyyaml',
      task: 'Keep the version exactly as written: 1.10.',
      start: 'package:\n  name: dbt_utils\n  version: 1.10\n', solution: "package:\n  name: dbt_utils\n  version: '1.10'\n",
      checks: { values: [{ expr: "data['package']['version']", equals: "'1.10'", label: 'version' }] },
      hint: 'Quote it.', why: '1.10 is read as the decimal number 1.1. Versions are texts.', source: { label: 'Lesson 5.2, what YAML reads' }, derived: 'built on the scalar table of the book' },
  ];
}

interface JinjaExercise {
  id: string; title: string; task: string; mode: 'plain' | 'dbt'; project?: 'ch05' | 'ch11'; node?: { name: string; resource_type: string; path?: string };
  extra_models?: Record<string, Record<string, unknown>>; template: string; macros?: string; solution: { template: string; macros?: string };
  goal: { book: string; cmp: 'ws' | 'lines' | 'exact' | 'segments' | 'within' }; run?: boolean; hint: string; why: string; source: { codeId?: string; label: string }; derived?: string;
}
function jinjaExercises(): JinjaExercise[] {
  const pivot = block('ch05-c37') + '\n';
  const withComma = pivot.replace("        as {{ m }}_amount\n    {%- if not loop.last %},{% endif %}\n", '        as {{ m }}_amount,\n');
  if (withComma === pivot) throw new Error('pivot exercise: replacement failed');
  const noDash = pivot.replace(/\{%-/g, '{%').replace(/-%\}/g, '%}');
  const macroStart = block('ch05-c39').replace("    round({{ column_name }} / 100, {{ decimals }})", '    {# write the expression here #}');
  const guardMacro = block('ch11-c31') + '\n';
  return [
    { id: 'trailing-comma', title: 'Remove the trailing comma', mode: 'plain', template: withComma, solution: { template: pivot },
      task: 'The loop writes a comma after every column, also after the last one. PostgreSQL and most warehouses reject this trailing comma (DuckDB happens to accept it: try Run). Use loop.last so that the last column has no comma.',
      goal: { book: block('ch05-c38'), cmp: 'ws' }, run: true, hint: '{%- if not loop.last %},{% endif %}',
      why: 'Inside a for loop, Jinja gives you loop.first, loop.last and loop.index.', source: { codeId: 'ch05-c37', label: 'Lesson 5.3, pivot.sql' },
      derived: 'pivot.sql of the book with its loop.last test replaced by a plain comma' },
    { id: 'whitespace', title: 'Whitespace control', mode: 'plain', template: noDash, solution: { template: pivot },
      task: 'This template gives the right SQL, but with empty lines. Add - to the tags so that the output is exactly the book\'s output, line by line.',
      goal: { book: block('ch05-c38'), cmp: 'exact' }, run: true, hint: '{%- removes the spaces and new lines before the tag, -%} after it.',
      why: 'Every {% %} tag leaves its line in the output. dbt does not care, but readable compiled SQL helps you debug.', source: { codeId: 'ch05-c37', label: 'Lesson 5.3, pivot.sql' },
      derived: 'pivot.sql of the book without its - signs' },
    { id: 'macro-cents', title: 'Write the cents_to_dollars macro', mode: 'plain', template: macroStart + '\n', solution: { template: block('ch05-c39') + '\n' },
      task: 'Complete the macro: it must return round(<column> / 100, <decimals>).', goal: { book: block('ch05-c40'), cmp: 'ws' }, run: true,
      hint: 'Inside the macro, write round({{ column_name }} / 100, {{ decimals }})', why: 'A macro is a function that returns text. Arguments can have default values (decimals=2).',
      source: { codeId: 'ch05-c39', label: 'Lesson 5.3, macros' }, derived: 'the book\'s template with the macro body removed' },
    { id: 'namespace', title: 'A total inside a loop', mode: 'plain', template: block('ch05-c43') + '\n',
      solution: { template: '{% set ns = namespace(total=0) %}\n{% for x in [1, 2, 3] %}{% set ns.total = ns.total + x %}{% endfor %}\ntotal={{ ns.total }}\n' },
      task: 'This template prints total=0: a set inside a loop does not change the variable outside. Use namespace() to get total=6.', goal: { book: 'total=6', cmp: 'ws' },
      hint: "{% set ns = namespace(total=0) %} ... {% set ns.total = ns.total + x %}", why: 'Each loop iteration has its own scope. A namespace object is shared.',
      source: { codeId: 'ch05-c43', label: 'Lesson 5.3, deep dive' }, derived: 'the book says namespace() gives 6; the line total= is kept from its template' },
    { id: 'source-compile', title: 'Compile a staging model with source()', mode: 'dbt', project: 'ch05', node: { name: 'stg_orders', resource_type: 'model', path: 'models/staging/stg_orders.sql' },
      template: block('ch05-c44') + '\n', solution: { template: block('ch05-c44') + '\n' },
      task: 'Compile the model and look at what source() becomes. Then run the compiled SQL on the practice database.',
      goal: { book: after(block('ch05-c45'), "Compiled node 'stg_orders' is:"), cmp: 'ws' }, run: true, hint: 'Press Compile, then Run the compiled SQL.',
      why: 'source() becomes the full name database.schema.table, from the sources YAML file.', source: { codeId: 'ch05-c44', label: 'Lesson 5.3, Jinja in dbt' } },
    { id: 'macro-typo', title: 'Fix the macro call', mode: 'dbt', project: 'ch11', template: "select {{ cent_to_dollars('amount') }} as a from {{ ref('stg_stripe__payments') }}",
      solution: { template: "select {{ cents_to_dollars('amount') }} as a from {{ ref('stg_stripe__payments') }}" },
      task: "dbt cannot find the macro. Read the message and fix the call. The project's macro is cents_to_dollars (macros/cents_to_dollars.sql).",
      goal: { book: 'select cast(amount / 100 as decimal(16, 2)) as a from "practice"."dbt_adnane"."stg_stripe__payments"', cmp: 'ws' }, run: true,
      hint: 'Look at the spelling.', why: '"is undefined" means: no macro, variable or package with this name exists.', source: { codeId: 'ch11-c22', label: 'Lesson 11.2, calling macros' },
      derived: 'the expected text is the compiled form of the corrected call (the book shows the macro body)' },
    { id: 'execute-guard', title: 'Guard run_query with execute', mode: 'dbt', project: 'ch11', node: { name: 'tmp_methods', resource_type: 'model', path: 'models/tmp_methods.sql' },
      extra_models: { tmp_methods: { path: 'models/tmp_methods.sql', materialized: 'view' } },
      template: block('ch11-c32') + '\n', macros: guardMacro, solution: { template: block('ch11-c32') + '\n', macros: block('ch11-c35') + '\n' },
      task: "Compiling fails with 'None' has no attribute 'table'. The macro runs a query while dbt parses the project. Change the macro (Macros tab) so that it runs the query only when execute is true.",
      goal: { book: after(block('ch11-c37'), "Compiled node 'tmp_methods' is:"), cmp: 'segments' }, run: true,
      hint: '{% if execute %} ... {% else %}{% set methods = [] %}{% endif %}', why: 'dbt renders every model twice: first to find ref() and source() (execute is false, no database), then to compile.',
      source: { codeId: 'ch11-c35', label: 'Lesson 11.3, run_query' } },
    { id: 'pivot-model', title: 'The pivot model of the project', mode: 'dbt', project: 'ch11', node: { name: 'int_orders__payment_methods_pivoted', resource_type: 'model', path: 'models/intermediate/int_orders__payment_methods_pivoted.sql' },
      template: block('ch11-c66') + '\n', solution: { template: block('ch11-c66') + '\n' },
      task: 'Compile the model: the loop is unrolled and the ephemeral model int_payments__successful becomes a CTE. Then run it: one row per order with one column per payment method.',
      goal: { book: block('ch11-c68'), cmp: 'segments' }, run: true, hint: 'Press Compile, then Run the compiled SQL.',
      why: 'ref() to an ephemeral model does not read a table: dbt pastes its SQL as a CTE named __dbt__cte__<model>.', source: { codeId: 'ch11-c66', label: 'Lesson 11.6' } },
  ];
}

// ------------------------------------------------------------------------------------------- write + verify
fs.mkdirSync(OUT, { recursive: true });
const yaml = yamlCases();
const jinja = jinjaCases();
const where = Object.fromEntries([...used].map(([id, w]) => [id, w]));
for (const [name, data] of [['yaml-cases.json', yaml], ['jinja-cases.json', jinja]] as const) {
  const json = JSON.stringify({ $comment: 'Generated by scripts/labs/build-py-cases.ts from the converter output. Do not edit.', where, cases: data }, null, 1) + '\n';
  const file = path.join(OUT, name);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) fs.writeFileSync(file, json);
}
const exY = yamlExercises(yaml);
const exJ = jinjaExercises();
for (const [name, data] of [['yaml-exercises.json', exY], ['jinja-exercises.json', exJ]] as const) {
  const json = JSON.stringify({ $comment: 'Generated by scripts/labs/build-py-cases.ts. Do not edit.', where: Object.fromEntries([...used]), exercises: data }, null, 1) + '\n';
  const file = path.join(OUT, name);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) fs.writeFileSync(file, json);
}
console.log(`[labs:py-cases] ${yaml.length} YAML cases, ${jinja.length} Jinja cases (book cases only; the spike's synthetic cases are in the tests), ${exY.length} YAML and ${exJ.length} Jinja exercises`);

// fixture provenance: the Chapter 11 project fixture = the reference repository at tag ch11
const fixture = JSON.parse(fs.readFileSync(path.join(SITE, 'src', 'lib', 'py', 'fixtures', 'project_ch11.json'), 'utf8'));
let fixtureDiffs = 0;
for (const [name, m] of Object.entries(fixture.models) as [string, { path: string; raw_code: string }][]) {
  if (git('show', `ch11:${m.path}`).replace(/\n$/, '') !== m.raw_code) { fixtureDiffs++; console.log(`  fixture model ${name} differs from tag ch11`); }
}
for (const [p, f] of Object.entries(fixture.macro_files) as [string, { package: string; source: string }][]) {
  if (f.package === 'jaffle_dbt' && git('show', `ch11:${p}`) !== f.source) { fixtureDiffs++; console.log(`  fixture macro ${p} differs from tag ch11`); }
}
console.log(`[labs:py-cases] Chapter 11 fixture vs reference repo tag ch11: ${fixtureDiffs} differences (12 models, 3 project macros)`);

// compare with the spike's frozen cases (extracted from the LaTeX by line number)
const canon = (v: unknown): unknown => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !['ref', 'bugFile', 'real'].includes(k)).map(([k, x]) => [k, canon(x)])) : v);
for (const [name, mine] of [['yaml_cases.json', yaml], ['jinja_cases.json', jinja]] as const) {
  const f = path.join(SPIKE, name);
  if (!fs.existsSync(f)) { console.log(`  (spike file ${name} not found: no LaTeX cross-check)`); continue; }
  const theirs = new Map((JSON.parse(fs.readFileSync(f, 'utf8')) as Case[]).map((c) => [c.id, c]));
  let same = 0;
  const diffs: string[] = [];
  for (const c of mine) {
    const t = theirs.get(c.id);
    if (!t) { diffs.push(`${c.id}: not in the spike`); continue; }
    const a = canon(c) as Record<string, unknown>;
    const b = canon(t) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (keys.length === 0) same++;
    else diffs.push(`${c.id}: ${keys.join(', ')}`);
  }
  console.log(`[labs:py-cases] ${name}: ${same}/${mine.length} identical to the spike's LaTeX extraction${diffs.length ? '; differences: ' + diffs.join(' | ') : ''}`);
}
