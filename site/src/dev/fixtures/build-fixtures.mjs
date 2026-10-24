// Builds questions.json: real questions transcribed by hand from the book (../dbt-bible), in the
// converter's schema (converter/SCHEMA.md). Used only until the converter writes src/generated/.
// Multi-blank fill questions use the converter's form: blanks: N, key: { blanks: [[accepted...], ...] }.
// Sources: Chapter 7 quiz + answers, Chapter 16 quiz + answers, Mock Exam 1 Q1-Q11 (ch28) + answers (ch29).
// Run: node src/dev/fixtures/build-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const c = (v) => ({ t: 'code', v });
const b = (...x) => ({ t: 'b', c: x });
const i = (...x) => ({ t: 'i', c: x });
const blank = { t: 'blank' };
const p = (...x) => ({ t: 'p', c: x });
const code = (id, lang, text, extra = {}) => ({ t: 'code', id, lang, text, ...extra });
const ul = (...items) => ({ t: 'list', kind: 'ul', items: items.map((it) => ({ blocks: [p(...it)] })) });
const ref = (label, text, href) => ({ t: 'ref', label, text, href });
const opts = (...list) => list.map((x, k) => ({ id: String.fromCharCode(65 + k), c: Array.isArray(x) ? x : [x] }));
const chap = (chapter, n) => ({ id: `q-ch${String(chapter).padStart(2, '0')}-${String(n).padStart(2, '0')}`, source: { kind: 'chapter', chapter, n } });
const mock = (m, n, objective) => ({ id: `m${m}-q${String(n).padStart(2, '0')}`, source: { kind: 'mock', mock: m, n }, objective, topic: Number(objective.split('.')[0]) });
const ww = (option, ...x) => ({ option, c: x });

const DOMC_CH = 'DOMC — judge each option YES/NO independently';
const DOMC_MOCK = 'DOMC — judge each option YES/NO';

const questions = [
  // ------------------------------------------------------------------ Chapter 7
  {
    ...chap(7, 1), format: 'mc', formatLabel: 'Multiple choice',
    stem: [
      p('This file is the only declaration of the source ', c('crm'), '. The target database is ', c('analytics'), '. What does ', c("{{ source('crm', 'accounts') }}"), ' compile to (ignoring quotes)?'),
      code('ch07-c57', 'yaml', 'sources:\n  - name: crm\n    tables:\n      - name: accounts\n        identifier: accounts_v2'),
    ],
    options: opts([c('analytics.crm.accounts')], [c('analytics.crm.accounts_v2')], [c('analytics.dbt_adnane.accounts_v2')], [c('crm.accounts.accounts_v2')]),
    key: 'B', keyRaw: 'B.',
    explanation: [p('Without ', c('schema'), ', the schema is the source name (', c('crm'), '); without ', c('database'), ', the target database (', c('analytics'), '); the ', c('identifier'), ' replaces the table name. A forgets the identifier. C uses the target schema, which sources never do. D puts the names in the wrong places.')],
  },
  {
    ...chap(7, 2), format: 'fill', formatLabel: 'Fill in the blank',
    stem: [p(c('source()'), ' takes two arguments: the source name and the ', blank, ' name, both as written in the YAML file.')],
    key: { accepted: ['table'] }, keyRaw: 'table.',
    explanation: [p('For example ', c("source('stripe', 'payments')"), ': source ', c('stripe'), ', table ', c('payments'), '.')],
  },
  {
    ...chap(7, 3), format: 'hotspot', formatLabel: 'Hotspot — which line',
    stem: [
      p('Which line creates ', i('no'), ' dependency in the DAG?'),
      code('ch07-c58', 'dbt', "with orders as (\n    select * from {{ ref('stg_shop__orders') }}\n),\nrefunds as (\n    select * from raw_payments.refunds\n),\ncustomers as (\n    select * from {{ source('shop', 'customers') }}\n)\nselect ...", { lineNumbers: true }),
    ],
    hotspot: { codeId: 'ch07-c58', lines: 10 },
    key: 5, keyRaw: 'Line 5.',
    explanation: [p(c('raw_payments.refunds'), ' is plain text for dbt. Line 2 (', c('ref'), ') and line 8 (', c('source'), ') both create edges.')],
  },
  {
    ...chap(7, 5), format: 'ms', formatLabel: 'Multiple select — choose 2', choose: 2,
    stem: [p('Which two practices belong in a staging model?')],
    options: opts(
      ['Renaming ', c('id'), ' to ', c('customer_id'), '.'],
      'Joining orders with payments to compute revenue.',
      'Converting an amount in cents to a decimal amount in dollars.',
      'Aggregating payments per customer.',
      ['Reading another staging model with ', c('ref()'), ' to enrich it.'],
    ),
    key: ['A', 'C'], keyRaw: 'A and C.',
    explanation: [p('Renaming and casting are the job of staging. B and D are business logic and aggregation (marts or intermediate models). E: staging models read one source table each, not other staging models.')],
  },
  {
    ...chap(7, 6), format: 'match', formatLabel: 'Matching',
    stem: [p('Match each file with its role in our project.')],
    match: {
      left: [
        { id: '1', c: [c('_stripe__sources.yml')] },
        { id: '2', c: [c('_stripe__models.yml')] },
        { id: '3', c: [c('stg_stripe__payments.sql')] },
        { id: '4', c: [c('fct_orders.sql')] },
      ],
      right: [
        { id: 'a', c: ['One row per order, built from two staging models'] },
        { id: 'b', c: ['Declares the raw Stripe tables'] },
        { id: 'c', c: ['Descriptions and tests of the Stripe staging model'] },
        { id: 'd', c: ['The only model that reads ', c("source('stripe', 'payments')")] },
      ],
    },
    key: { 1: 'b', 2: 'c', 3: 'd', 4: 'a' }, keyRaw: '1-b, 2-c, 3-d, 4-a.',
    explanation: [],
  },
  {
    ...chap(7, 7), format: 'order', formatLabel: 'Build list — put in order',
    stem: [p('A new raw table ', c('stripe.refunds'), ' has arrived. Put the steps in a sensible order.')],
    options: opts(
      ['Write ', c('stg_stripe__refunds.sql'), ' with ', c("source('stripe', 'refunds')"), '.'],
      ['Add ', c('refunds'), ' under ', c('tables:'), ' in ', c('_stripe__sources.yml'), '.'],
      ['Run ', c('dbt build --select stg_stripe__refunds'), '.'],
      ['Check it with ', c("dbt show --inline \"select count(*) from {{ source('stripe', 'refunds') }}\""), '.'],
      ['Add ', c('unique'), ' and ', c('not_null'), ' on ', c('refund_id'), ' in ', c('_stripe__models.yml'), '.'],
    ),
    key: ['B', 'D', 'A', 'E', 'C'], keyRaw: 'B, D, A, E, C.',
    explanation: [p('Declare the table, verify it exists through ', c('source()'), ', write the staging model, add its tests, build it (models and tests). D could also come after A, but checking the declaration before writing SQL saves time.')],
  },
  {
    ...chap(7, 8), format: 'domc', formatLabel: DOMC_CH,
    stem: [p('Statements about ', c('ref()'), ':')],
    options: opts(
      'It creates an edge between two nodes of the DAG.',
      'It compiles to the relation of that model in the current environment (target).',
      ['It is the right function to read a raw table declared under ', c('sources:'), '.'],
      ['dbt finds dependencies by reading the ', c('from'), ' clauses of the SQL.'],
    ),
    key: { A: true, B: true, C: false, D: false }, keyRaw: 'YES, YES, NO, NO.',
    explanation: [p('B: ', c('ref()'), ' becomes the relation built for the target of this command (', c('dbt_adnane'), ' in dev, ', c('prod'), ' with ', c('--target prod'), '). Raw tables are read with ', c('source()'), '. dbt finds dependencies from ', c('ref()'), ' and ', c('source()'), ' calls during parsing, not from ', c('from'), ' clauses (that is why hard-coded names are invisible).')],
  },
  {
    ...chap(7, 17), format: 'domc', formatLabel: DOMC_CH,
    stem: [p('Statements about lineage in the dbt platform:')],
    options: opts(
      'The Studio IDE shows a Lineage tab for the open model.',
      'Catalog needs at least one successful job run in a production or staging environment.',
      ['A model that reads ', c('analytics.fct_orders'), ' by name appears connected to ', c('fct_orders'), ' in Catalog.'],
      'Catalog was formerly called dbt Explorer.',
    ),
    key: { A: true, B: true, C: false, D: true }, keyRaw: 'YES, YES, NO, YES.',
    explanation: [p('A hard-coded name creates no edge, so Catalog cannot connect the two models.')],
  },

  // ------------------------------------------------------------------ Chapter 16
  {
    ...chap(16, 4), format: 'fill', formatLabel: 'Fill in the blank',
    stem: [p('In ', c('dbt ls -s "tag:finance,config.materialized:table"'), ', the comma between the two methods means ', blank, ': only the nodes that match both are kept.')],
    key: { accepted: ['Intersection'] }, keyRaw: 'Intersection ("and").', boldKey: ['Intersection'],
    explanation: [p('("and"). A space would mean union ("or"); the comma must not be followed by a space.')],
  },
  {
    ...chap(16, 5), format: 'match', formatLabel: 'Matching',
    stem: [p('Match each indirect selection mode with its rule.')],
    match: {
      left: [
        { id: '1', c: [c('eager')] },
        { id: '2', c: [c('buildable')] },
        { id: '3', c: [c('cautious')] },
        { id: '4', c: [c('empty')] },
      ],
      right: [
        { id: 'a', c: ['No test is added to the selection.'] },
        { id: 'b', c: ['A test is added only if ', i('all'), ' its parents are selected.'] },
        { id: 'c', c: ['A test is added if ', i('at least one'), ' of its parents is selected.'] },
        { id: 'd', c: ['A test is added if all its parents are selected or are ancestors of the selection.'] },
      ],
    },
    key: { 1: 'c', 2: 'd', 3: 'b', 4: 'a' }, keyRaw: '1-c, 2-d, 3-b, 4-a.',
    explanation: [p('Eager is the most inclusive and the default; cautious is the most exclusive one that still adds tests; empty adds none.')],
  },
  {
    ...chap(16, 6), format: 'order', formatLabel: 'Build list — put in order',
    stem: [p(c('fct_orders'), ' has one unit test and one data test. Put these events of ', c('dbt build -s +fct_orders'), ' in the order they happen for this chain:')],
    options: opts(
      ['the data test on ', c('fct_orders'), ' runs'],
      ['the unit test of ', c('fct_orders'), ' runs'],
      [c('int_orders__enriched'), ' is built'],
      [c('fct_orders'), ' is built'],
      [c('stg_jaffle_shop__orders'), ' is built and its data tests run'],
    ),
    key: ['E', 'C', 'B', 'D', 'A'], keyRaw: 'e, c, b, d, a.',
    explanation: [p('Parents first (with their data tests right after them), then the unit test of ', c('fct_orders'), ' ', i('before'), ' the model, the model, and finally its data test.')],
  },
  {
    ...chap(16, 7), format: 'hotspot', formatLabel: 'Hotspot — which line',
    stem: [
      p('A CI script runs these commands one after the other. Which line stops the script with a usage error, before anything runs?'),
      code('ch16-c89', 'plain', 'dbt deps\ndbt parse\ndbt seed --empty\ndbt build --empty --exclude-resource-type snapshot\ndbt build -s state:modified+ --defer --state prod-artifacts', { lineNumbers: true }),
    ],
    hotspot: { codeId: 'ch16-c89', lines: 5 },
    key: 3, keyRaw: 'Line 3.',
    explanation: [p(c('dbt seed'), ' has no ', c('--empty'), ' option: "No such option ', c("'--empty'"), '". Lines 1, 2 and 4 are valid (line 4 is the safe empty build). Line 5 is valid syntax; it needs the artifacts folder to exist.')],
  },
  {
    ...chap(16, 8), format: 'domc', formatLabel: DOMC_CH,
    stem: [p('Statements about ', c('dbt build --empty'), ':')],
    options: opts(
      'It creates the selected models in the warehouse, with their columns and zero rows.',
      'It loads the seeds with zero rows.',
      ['A table name hard-coded in a model (not ', c('ref'), ' or ', c('source'), ') is read in full.'],
      'The data tests fail, because the tables are empty.',
      'The unit tests are skipped.',
    ),
    key: { A: true, B: false, C: true, D: false, E: false }, keyRaw: 'YES, NO, YES, NO, NO.',
    explanation: [p('Objects are created with 0 rows. Seeds load fully (', c('INSERT 6'), '). Only ', c('ref'), ' and ', c('source'), ' are limited, so a hard-coded table is read in full. The usual data tests pass on empty tables (no failing rows); only a test that expects rows would fail. Unit tests still run with their fake rows.')],
  },
  {
    ...chap(16, 15), format: 'fill', formatLabel: 'Fill in the blank',
    stem: [p('The one-letter short form of ', c('--fail-fast'), ' is ', blank, '.')],
    key: { accepted: ['-x'] }, keyRaw: '-x', boldKey: [c('-x')],
    explanation: [p('(', c('dbt build -x'), '). It stops the whole command at the first failure.')],
  },
  {
    ...chap(16, 18), format: 'domc', formatLabel: DOMC_CH,
    stem: [p('Statements about ', c('dbt build'), ':')],
    options: opts(
      ['It runs ', c('dbt source freshness'), ' before the models.'],
      'It runs the unit tests of a model before building that model.',
      ['A failing test with ', c('severity: warn'), ' skips the children of the tested model.'],
      'It loads the seeds.',
    ),
    key: { A: false, B: true, C: false, D: true }, keyRaw: 'NO, YES, NO, YES.',
    explanation: [p('Freshness is a separate command. Unit tests run before their model. A ', c('warn'), ' test reports a warning and nothing is skipped. Seeds are part of ', c('dbt build'), '.')],
  },

  // ------------------------------------------------------------------ Mock Exam 1 (ch28 + ch29)
  {
    ...mock(1, 1, '1.2'), format: 'mc', formatLabel: 'Multiple choice',
    stem: [p('In ', c('jaffle_dbt'), ', the model ', c('int_payments__successful'), ' has ', c("{{ config(materialized='ephemeral') }}"), ' at the top of its file. Only ', c('fct_orders'), ' references it with ', c('ref()'), '. Adnane runs ', c('dbt run'), ', then looks in the warehouse and in the ', c('target/'), ' folder. Which statement is true?')],
    options: opts(
      ['The warehouse has a view ', c('dbt_adnane.int_payments__successful'), ', and ', c('fct_orders'), ' selects from this view.'],
      ['dbt creates a temporary table for ', c('int_payments__successful'), ' during the run, and drops it at the end of the run.'],
      [c('dbt run'), ' fails, because an ephemeral model must be referenced by at least two models.'],
      ['There is no ', c('int_payments__successful'), ' object in the warehouse. The compiled SQL of ', c('fct_orders'), ' starts with ', c('with __dbt__cte__int_payments__successful as (...)'), '.'],
    ),
    key: 'D', keyRaw: 'D',
    explanation: [p(b('Why D is correct.'), ' An ephemeral model is never created in the warehouse. When another model uses ', c('ref()'), ' on it, dbt pastes its SQL into that model as a CTE (a ', c('with'), ' block) whose name starts with ', c('__dbt__cte__'), '. In the practice project, the compiled ', c('fct_orders'), ' starts with ', c('with __dbt__cte__int_payments__successful as (...)'), ', and no object with that name exists in the schema.')],
    whyWrong: [
      ww('A', 'This describes the ', c('view'), ' materialization, not ', c('ephemeral'), '.'),
      ww('B', 'dbt creates no temporary table; the code only lives inside the CTE.'),
      ww('C', 'One ', c('ref()'), ' is enough. Ephemeral is even recommended for light logic used by only one or two models.'),
    ],
    review: [ref('ch:materializations', 'Chapter 8', '/learn/ch08/')],
  },
  {
    ...mock(1, 2, '5.2'), format: 'ms', formatLabel: 'Multiple select — choose 2', choose: 2,
    stem: [p('The finance team gives Adnane two rules about ', c('stg_stripe__payments'), ': (1) ', c('payment_method'), ' must only contain ', c('credit_card'), ', ', c('coupon'), ', ', c('bank_transfer'), ' or ', c('gift_card'), '; (2) every ', c('order_id'), ' must exist in ', c('stg_jaffle_shop__orders.order_id'), '. Which ', b('two'), ' built-in generic data tests express these two rules?')],
    options: opts(
      [c('unique'), ' on ', c('payment_method')],
      [c('accepted_values'), ' on ', c('payment_method'), ', with the four values'],
      [c('not_null'), ' on ', c('order_id')],
      [c('relationships'), ' on ', c('order_id'), ', with ', c("to: ref('stg_jaffle_shop__orders')"), ' and ', c('field: order_id')],
      ['a unit test with fixed input rows for ', c('stg_stripe__payments')],
    ),
    key: ['B', 'D'], keyRaw: 'B, D',
    explanation: [p(b('Why B and D are correct.'), ' ', c('accepted_values'), ' fails when a column contains a value that is not in the list you give. ', c('relationships'), ' fails when a value has no matching value in another model (here: a payment whose order does not exist). In dbt 1.10 and later, the parameters of these tests go under ', c('arguments:'), ' (', c('values:'), ', ', c('to:'), ', ', c('field:'), ').')],
    whyWrong: [
      ww('A', c('unique'), ' would fail: many payments share the same payment method.'),
      ww('C', c('not_null'), ' only checks for NULL; it says nothing about the orders table.'),
      ww('E', 'A unit test checks SQL logic on invented rows, not the real data.'),
    ],
    review: [ref('ch:data-tests', 'Chapter 18', '/learn/ch18/')],
  },
  {
    ...mock(1, 3, '1.1'), format: 'fill', formatLabel: 'Fill in the blank',
    stem: [
      p('A teammate declared this source in ', c('jaffle_dbt'), ':'),
      code('ch28-c1', 'yaml', 'sources:\n  - name: shop\n    database: practice\n    schema: jaffle_shop\n    tables:\n      - name: orders_raw\n        identifier: orders'),
      p('Complete the two blanks so that the model reads the raw table ', b('through this source declaration'), ' and compiles to ', c('select * from "practice"."jaffle_shop"."orders"'), '.'),
      code('ch28-c2', 'dbt', "select * from {{ source('_______', '_______') }}"),
    ],
    blanks: 2, key: { blanks: [['shop'], ['orders_raw']] }, keyRaw: '\\code{shop}, \\code{orders\\_raw}',
    explanation: [
      p(b('Why.'), ' The full call is ', c("{{ source('shop', 'orders_raw') }}"), '. The first argument is the ', c('name'), ' of the source (', c('shop'), '), not its schema. The second is the ', c('name'), ' of the table in the YAML (', c('orders_raw'), '), not its ', c('identifier'), '. dbt then builds the real address from ', c('database'), ', ', c('schema'), ' and ', c('identifier'), ': ', c('"practice"."jaffle_shop"."orders"'), '. We checked this with ', c('dbt compile'), '.'),
      p(b('Typical wrong answers.')),
      ul(
        [c("source('jaffle_shop', 'orders')"), ': it uses the schema and the identifier, not the names declared in ', i('this'), ' YAML block. With only this declaration, dbt would not find such a source.'],
        [c("source('shop', 'orders')"), ': ', c('orders'), ' is the identifier, not the table name.'],
      ),
    ],
    review: [ref('ch:models-sources-dag', 'Chapter 7', '/learn/ch07/')],
  },
  {
    ...mock(1, 4, '7.1'), format: 'mc', formatLabel: 'Multiple choice',
    stem: [
      p('The folder ', c('prod-artifacts/'), ' contains the ', c('manifest.json'), ' of the last production run. In this question, the models of ', c('jaffle_dbt'), ' depend on each other like this (an arrow means "is used by"):'),
      code('ch28-c3', 'plain', 'stg_jaffle_shop__orders    -> fct_orders\nstg_stripe__payments       -> int_payments__successful -> fct_orders\nfct_orders                 -> dim_customers, int_orders__enriched\nstg_jaffle_shop__customers -> dim_customers, int_orders__enriched\nint_orders__enriched       -> fct_monthly_revenue\ndim_customers              -> customer_segments'),
      p('Adnane changes only the SQL of ', c('stg_jaffle_shop__orders'), '. Then he runs:'),
      code('ch28-c4', 'bash', '$ dbt ls -s state:modified+ --state prod-artifacts --resource-type model'),
      p('Which models are listed?'),
    ],
    options: opts(
      ['Only ', c('stg_jaffle_shop__orders'), '.'],
      'All the models of the project, because state comparison always adds the parents of the modified model.',
      [c('stg_jaffle_shop__orders'), ', ', c('fct_orders'), ', ', c('dim_customers'), ', ', c('int_orders__enriched'), ', ', c('fct_monthly_revenue'), ' and ', c('customer_segments'), '.'],
      [c('stg_jaffle_shop__orders'), ', ', c('stg_stripe__payments'), ', ', c('int_payments__successful'), ' and ', c('fct_orders'), '.'],
    ),
    key: 'C', keyRaw: 'C',
    explanation: [p(b('Why C is correct.'), ' ', c('state:modified'), ' compares the current project with the manifest in ', c('prod-artifacts/'), ' and selects only ', c('stg_jaffle_shop__orders'), '. The ', c('+'), ' after the selector adds all its ', i('descendants'), ': ', c('fct_orders'), ', then ', c('dim_customers'), ' and ', c('int_orders__enriched'), ', then ', c('fct_monthly_revenue'), ' and ', c('customer_segments'), '. We ran this exact command and got these 6 models (plus their tests when ', c('--resource-type'), ' is not used).')],
    whyWrong: [
      ww('A', 'This would be ', c('state:modified'), ' without the ', c('+'), '.'),
      ww('B', 'A ', c('+'), ' ', i('after'), ' the selector adds children, not parents.'),
      ww('D', c('stg_stripe__payments'), ' and ', c('int_payments__successful'), ' did not change and are not descendants of the modified model.'),
    ],
    review: [ref('ch:state-defer-retry', 'Chapter 24', '/learn/ch24/')],
  },
  {
    ...mock(1, 5, '3.3'), format: 'hotspot', formatLabel: 'Hotspot — which line',
    stem: [
      p('After Adnane edits ', c('models/staging/stripe/_stripe__models.yml'), ', ', c('dbt parse'), ' stops with a ', c('Parsing Error'), ' for this file. Which line causes the error?'),
      code('ch28-c5', 'yaml', 'models:\n  - name: stg_stripe__payments\n    description: One row per payment attempt.\n    columns:\n      - name: payment_id\n        data_tests:\n          - unique\n          - not_null\n       - name: payment_method\n        data_tests:\n          - accepted_values:\n              arguments:\n                values: [credit_card, coupon, bank_transfer, gift_card]', { lineNumbers: true }),
    ],
    hotspot: { codeId: 'ch28-c5', lines: 13 },
    key: 9, keyRaw: 'Line 9',
    explanation: [
      p(b('Why line 9.'), ' ', c('- name: payment_method'), ' starts with 7 spaces, but the other item of the same list (line 5) starts with 6. In YAML, all items of one list must start at the same column. dbt shows ', c('Syntax error near line 9'), ', and the raw YAML error says ', c("did not find expected '-' indicator ... line 9, column 8"), '.'),
      p(b('Why the other lines are fine.'), ' Line 12 (', c('arguments:'), ') is the correct syntax for test parameters since dbt 1.10. Line 13 is a valid YAML list of plain strings. The error message points to the line where the parser got lost; always check the indentation of that line and of the line just before it.'),
    ],
    review: [ref('ch:debugging', 'Chapter 22', '/learn/ch22/'), ' and ', ref('ch:yaml-jinja-python', 'Chapter 5', '/learn/ch05/')],
  },
  {
    ...mock(1, 6, '1.6'), format: 'order', formatLabel: 'Build list — put in order',
    stem: [p('The ', c('materialized'), ' config of ', c('fct_orders'), ' is set in four places at the same time, with four different values. Put the four places in order, from the ', b('lowest'), ' priority (always overridden) to the ', b('highest'), ' priority (the value dbt finally uses).')],
    options: opts(
      ['A ', c('config:'), ' block for ', c('fct_orders'), ' in a properties file (', c('_marts__models.yml'), ')'],
      [c('+materialized'), ' directly under ', c('models: jaffle_dbt:'), ' in ', c('dbt_project.yml')],
      [c('{{ config(materialized=...) }}'), ' at the top of ', c('fct_orders.sql')],
      [c('+materialized'), ' under ', c('models: jaffle_dbt: marts:'), ' in ', c('dbt_project.yml')],
    ),
    key: ['B', 'D', 'A', 'C'], keyRaw: 'B, D, A, C',
    explanation: [p(b('Why.'), ' The more specific the place, the higher the priority. A value at the root of ', c('models: jaffle_dbt:'), ' (B) is overridden by a value for the ', c('marts'), ' folder (D). A ', c('config:'), ' block in a properties YAML file (A) overrides ', c('dbt_project.yml'), '. The ', c('config()'), ' call inside the SQL file (C) wins over everything. We checked it: with all four places set, dbt used the SQL value; after removing it, the YAML value; then the folder value; then the root value.')],
    review: [ref('ch:configuration', 'Chapter 10', '/learn/ch10/')],
  },
  {
    ...mock(1, 7, '2.1'), format: 'mc', formatLabel: 'Multiple choice',
    stem: [
      p(c('dim_customers'), ' has an enforced contract with 9 columns in its YAML file. Adnane adds the line ', c('c.signup_date,'), ' to the SELECT of ', c('dim_customers.sql'), ', but he does not change the YAML. He runs ', c('dbt run -s dim_customers'), ':'),
      code('ch28-c6', 'output', "Compilation Error in model dim_customers (models/marts/dim_customers.sql)\n  This model has an enforced contract that failed.\n  Please ensure the name, data_type, and number of columns in your contract\n  match the columns in your model's definition.\n\n  | column_name | definition_type | contract_type | mismatch_reason     |\n  | ----------- | --------------- | ------------- | ------------------- |\n  | signup_date | DATE            |               | missing in contract |"),
      p('Which statement is correct?'),
    ],
    options: opts(
      ['dbt did not build the new version of ', c('dim_customers'), '. Adnane must add ', c('signup_date'), ' with ', c('data_type: date'), ' to the YAML (or remove it from the SQL), then run the model again.'],
      'dbt built the table with the new column and only printed a warning.',
      ['The warehouse rejected a row because of a constraint. Adnane must remove the ', c('not_null'), ' constraint on ', c('customer_id'), '.'],
      ['A contract only checks data types, so Adnane must cast ', c('signup_date'), ' to ', c('varchar'), '.'],
    ),
    key: 'A', keyRaw: 'A',
    explanation: [p(b('Why A is correct.'), ' With an enforced contract, dbt compares the columns returned by the query with the columns in the YAML ', i('before'), ' it builds the model. Here the query returns one column (', c('signup_date'), ') that the contract does not list, so dbt stops with a compilation error and builds nothing. The old table stays exactly as it was (we checked: still 9 columns). To fix it, declare the column with its ', c('data_type'), ', or remove it from the SQL.')],
    whyWrong: [
      ww('B', 'A contract failure is an error, not a warning.'),
      ww('C', 'No row was inserted; the message is about the column list (', c('missing in contract'), '), not a constraint.'),
      ww('D', 'A contract checks column names, data types ', i('and'), ' the number of columns.'),
    ],
    review: [ref('ch:governance', 'Chapter 17', '/learn/ch17/')],
  },
  {
    ...mock(1, 8, '1.12'), format: 'domc', formatLabel: DOMC_MOCK,
    stem: [p('In the CI job of ', c('jaffle_dbt'), ', Adnane runs ', c('dbt build --empty'), '. For each statement, answer YES (true) or NO (false).')],
    options: opts(
      ['Every ', c('ref()'), ' and ', c('source()'), ' is replaced by a subquery that returns zero rows.'],
      ['A table name written by hand in the SQL, like ', c('from practice.jaffle_shop.orders'), ', is also limited to zero rows.'],
      'The SQL is still sent to the warehouse, so a wrong column name still makes the model fail.',
      'dbt still builds the tables and views of the models in the warehouse, with the right columns.',
      'It is a cheap way to check, in CI, that every model compiles and runs, without reading the large input tables.',
    ),
    key: { A: true, B: false, C: true, D: true, E: true }, keyRaw: 'A-YES, B-NO, C-YES, D-YES, E-YES',
    explanation: [{
      t: 'list', kind: 'ul', items: [
        { blocks: [p(b('A YES'), ': each ', c('ref()'), '/', c('source()'), ' becomes ', c('(select * from ... where false limit 0)'), '.')] },
        { blocks: [p(b('B NO'), ': dbt only changes what it renders. A hard-coded table name is plain text: in our test, a model reading ', c('practice.jaffle_shop.orders'), ' directly still returned 300 rows.')] },
        { blocks: [p(b('C YES'), ': the SQL still runs in the warehouse, so a wrong column (', c('Referenced column ... not found'), ') still fails. That is the point of the flag.')] },
        { blocks: [p(b('D YES'), ': the models are really built, only with zero rows. In our test, ', c('fct_orders'), ' was a real table with its 5 columns and 0 rows, and each staging view was created with the ', c('where false limit 0'), ' subquery inside. The data tests also run (on empty models they pass).')] },
        { blocks: [p(b('E YES'), ': it validates SQL and dependencies cheaply, which is why it is popular as a first step in CI.')] },
      ],
    }],
    review: [ref('ch:commands-selection', 'Chapter 16', '/learn/ch16/')],
  },
  {
    ...mock(1, 9, '4.1'), format: 'mc', formatLabel: 'Multiple choice',
    stem: [
      p('Use the same model dependencies as in Question 4. The ', c('not_null'), ' test on ', c('stg_jaffle_shop__customers.email'), ' has the default severity (', c('error'), '). Five customers have no email. Adnane runs ', c('dbt build'), ' and sees:'),
      code('ch28-c7', 'output', '12 of 27 FAIL 5 not_null_stg_jaffle_shop__customers_email ...... [FAIL 5 in 0.03s]'),
      p('Which models does ', c('dbt build'), ' skip?'),
    ],
    options: opts(
      'Every node that comes after node 12 in the log, because dbt stops at the first failure.',
      ['Only ', c('stg_jaffle_shop__customers'), ', because the test belongs to this model.'],
      [c('dim_customers'), ', ', c('int_orders__enriched'), ', ', c('fct_monthly_revenue'), ' and ', c('customer_segments'), '. ', c('fct_orders'), ' is still built.'],
      'None. A failing test only changes the exit code; tests never cause models to be skipped.',
    ),
    key: 'C', keyRaw: 'C',
    explanation: [p(b('Why C is correct.'), ' In ', c('dbt build'), ', a failing test (severity ', c('error'), ') blocks every node downstream of the tested model. The tested model is ', c('stg_jaffle_shop__customers'), '. Its children are ', c('dim_customers'), ' and ', c('int_orders__enriched'), '; their children are ', c('customer_segments'), ' and ', c('fct_monthly_revenue'), '. All four are skipped. ', c('fct_orders'), ' does not depend on the customers model, so it is built normally.')],
    whyWrong: [
      ww('A', 'dbt only stops everything with ', c('--fail-fast'), '.'),
      ww('B', 'The model itself was already built: tests run ', i('after'), ' their model.'),
      ww('D', 'In ', c('dbt build'), ', tests do cause downstream nodes to be skipped.'),
    ],
    review: [ref('ch:pipelines-clone', 'Chapter 23', '/learn/ch23/'), ' and ', ref('ch:data-tests', 'Chapter 18', '/learn/ch18/')],
  },
  {
    ...mock(1, 10, '6.2'), format: 'mc', formatLabel: 'Multiple choice',
    stem: [
      p('The source table ', c('jaffle_shop.orders'), ' has this freshness configuration:'),
      code('ch28-c8', 'yaml', '      - name: orders\n        loaded_at_field: _loaded_at\n        freshness:\n          warn_after: {count: 12, period: hour}\n          error_after: {count: 24, period: hour}'),
      p('The most recent value of ', c('_loaded_at'), ' is 15 hours old. What does ', c('dbt source freshness'), ' report for this table?'),
    ],
    options: opts(
      [c('PASS'), ', because 15 hours is less than ', c('error_after'), '.'],
      [c('WARN')],
      [c('ERROR STALE')],
      ['Nothing: freshness is only checked inside ', c('dbt build'), '.'],
    ),
    key: 'B', keyRaw: 'B',
    explanation: [p(b('Why B is correct.'), ' dbt takes the most recent ', c('_loaded_at'), ' and compares its age with the thresholds. 15 hours is older than ', c('warn_after'), ' (12 hours) but younger than ', c('error_after'), ' (24 hours), so the status is ', c('WARN'), '. We reproduced it: ', c('WARN freshness of jaffle_shop.orders'), ', and ', c('target/sources.json'), ' shows the status ', c('warn'), '.')],
    whyWrong: [
      ww('A', 'The warning threshold is already passed.'),
      ww('C', c('ERROR STALE'), ' needs data older than 24 hours.'),
      ww('D', 'Freshness has its own command, ', c('dbt source freshness'), '; ', c('dbt build'), ' does not check it.'),
    ],
    review: [ref('ch:freshness-exposures', 'Chapter 21', '/learn/ch21/')],
  },
  {
    ...mock(1, 11, '1.4'), format: 'match', formatLabel: 'Matching',
    stem: [p('Match each command (1–6) with what it does (A–F).')],
    match: {
      left: [
        { id: '1', c: [c('dbt seed')] },
        { id: '2', c: [c('dbt snapshot')] },
        { id: '3', c: [c('dbt show')] },
        { id: '4', c: [c('dbt docs generate')] },
        { id: '5', c: [c('dbt compile')] },
        { id: '6', c: [c('dbt build')] },
      ],
      right: [
        { id: 'A', c: ['Renders the Jinja of the models into plain SQL files in ', c('target/compiled'), ', without creating any table or view.'] },
        { id: 'B', c: ['Runs models, tests, seeds and snapshots in DAG order, in one command.'] },
        { id: 'C', c: ['Loads the CSV files of the ', c('seeds/'), ' folder into tables.'] },
        { id: 'D', c: ['Compares the current source rows with the stored history and records the changed rows with validity dates.'] },
        { id: 'E', c: ['Runs the query of one model and prints a few rows in the terminal; nothing is created.'] },
        { id: 'F', c: ['Writes ', c('catalog.json'), ' (and the files of the documentation website) by asking the warehouse for column information.'] },
      ],
    },
    key: { 1: 'C', 2: 'D', 3: 'E', 4: 'F', 5: 'A', 6: 'B' }, keyRaw: '1-C, 2-D, 3-E, 4-F, 5-A, 6-B',
    explanation: [{
      t: 'list', kind: 'ul', items: [
        { blocks: [p(b('1-C'), ' ', c('dbt seed'), ' loads the CSV files of ', c('seeds/'), ' (', c('country_regions.csv'), ' became a table).')] },
        { blocks: [p(b('2-D'), ' ', c('dbt snapshot'), ' records changes over time, with ', c('dbt_valid_from'), ' and ', c('dbt_valid_to'), '.')] },
        { blocks: [p(b('3-E'), ' ', c('dbt show'), ' runs the query and prints rows; it creates nothing.')] },
        { blocks: [p(b('4-F'), ' ', c('dbt docs generate'), ' writes ', c('catalog.json'), ' and ', c('index.html'), ' in ', c('target/'), '.')] },
        { blocks: [p(b('5-A'), ' ', c('dbt compile'), ' only renders Jinja into ', c('target/compiled'), '.')] },
        { blocks: [p(b('6-B'), ' ', c('dbt build'), ' runs models, tests, seeds and snapshots (and unit tests) in DAG order.')] },
      ],
    }],
    review: [ref('ch:commands-selection', 'Chapter 16', '/learn/ch16/')],
  },
];

// Like the converter, a chapter answer keeps its key in bold at the start of the explanation.
for (const q of questions) {
  if (q.source.kind !== 'chapter') continue;
  const lead = q.boldKey ?? [q.keyRaw];
  delete q.boldKey;
  if (q.explanation.length && q.explanation[0].t === 'p') {
    const [head, ...rest] = q.explanation[0].c;
    q.explanation[0].c = typeof head === 'string' ? [b(...lead), ' ' + head, ...rest] : [b(...lead), ' ', head, ...rest];
  }
  else q.explanation.unshift(p(b(...lead)));
}

// Like the converter, a mock explanation also keeps the "Why the others are wrong." list of the book.
for (const q of questions) {
  if (q.source.kind !== 'mock' || !q.whyWrong) continue;
  q.explanation.push(p(b('Why the others are wrong.')));
  q.explanation.push({ t: 'list', kind: 'ul', items: q.whyWrong.map((w) => ({ blocks: [p(b(w.option), ' — ', ...w.c)] })) });
}

const out = fileURLToPath(new URL('./questions.json', import.meta.url));
writeFileSync(out, JSON.stringify(questions, null, 1) + '\n');
console.log(`wrote ${questions.length} questions to ${out}`);
