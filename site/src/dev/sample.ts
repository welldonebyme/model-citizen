// Hand-written sample content in the converter's schema (Chapter 4, section NULL) for the style guide.
// Real pages read site/src/generated/ produced by the converter.
import type { Block } from '../lib/content-types';

export const sampleBlocks: Block[] = [
  { t: 'objectives', items: [
    { id: '1.2', c: ['Understanding core materializations: ', { t: 'code', v: 'view' }, ', ', { t: 'code', v: 'table' }, ', ', { t: 'code', v: 'ephemeral' }, '.'] },
    { id: 'CP0-SQL', c: ['SQL prerequisites: joins, aggregations, CTEs, window functions.'] },
  ] },
  { t: 'callout', kind: 'why', blocks: [{ t: 'p', c: ['Five customers have no email address. Understanding NULL is understanding half of dbt testing.'] }] },
  { t: 'p', c: ['Five customers have no email address. In the table, their ', { t: 'code', v: 'email' }, ' is ', { t: 'term', en: ['NULL'], fr: 'NULL (valeur absente)', id: 'term-null' }, '. NULL means ', { t: 'i', c: ['unknown'] }, ' or ', { t: 'i', c: ['missing'] }, '. It is not zero, it is not an empty text ', { t: 'code', v: "''" }, ', it is "we do not know".'] },
  { t: 'callout', kind: 'analogy', blocks: [{ t: 'p', c: ['Imagine a form where somebody did not answer the question "What is your age?". You cannot say the age is 0. SQL reasons exactly like this.'] }] },
  { t: 'h', level: 3, c: ['Three-valued logic'], anchor: 'three-valued' },
  { t: 'code', id: 'ch04-c40', lang: 'sql', text: 'select null = null as a, null <> 1 as b, null is null as c, 1 + null as d;', expected: 'ch04-c41' },
  { t: 'code', id: 'ch04-c41', lang: 'output', text: '+------+------+------+------+\n| a    | b    | c    | d    |\n+------+------+------+------+\n| NULL | NULL | true | NULL |\n+------+------+------+------+\n(1 row)' },
  { t: 'table', head: [[{ c: ['Expression'] }, { c: ['Result'] }, { c: ['Why'] }]], rows: [
    [{ c: [{ t: 'code', v: 'true and null' }] }, { c: ['NULL'] }, { c: ['we need both; one is unknown'] }],
    [{ c: [{ t: 'code', v: 'false and null' }] }, { c: ['false'] }, { c: ['one is already false, so the whole is false'] }],
    [{ c: [{ t: 'code', v: 'true or null' }] }, { c: ['true'] }, { c: ['one is already true, so the whole is true'] }],
  ] },
  { t: 'callout', kind: 'trap', blocks: [{ t: 'p', c: [{ t: 'code', v: 'where email = null' }, ' runs without any error, and returns ', { t: 'b', c: ['zero rows'] }, '. A query that is wrong but does not fail is the most dangerous kind of bug. See ', { t: 'ref', label: 'sec:sql-joins', text: 'Section 4.8', href: 'learn/ch04/ch04-s8/' }, '.'] }] },
  { t: 'callout', kind: 'tip', blocks: [{ t: 'p', c: ['Press ', { t: 'key', v: 'Ctrl' }, ' + ', { t: 'key', v: 'Enter' }, ' to run a query in the workspace.'] }] },
  { t: 'callout', kind: 'dbt', blocks: [{ t: 'p', c: ["dbt's built-in ", { t: 'code', v: 'not_null' }, ' data test (Chapter 18) is just a query like ', { t: 'code', v: 'select * from my_model where my_column is null' }, '.'] }] },
  { t: 'callout', kind: 'deep', blocks: [{ t: 'p', c: ['DuckDB returns ', { t: 'code', v: 'inf' }, ' when you divide by zero with ', { t: 'code', v: '/' }, '. Most warehouses raise an error.'] }] },
  { t: 'code', id: 'ch04-c50', lang: 'dbt', title: 'models/marts/fct_orders.sql', text: "{{ config(materialized='table') }}\n\nwith orders as (\n    select * from {{ ref('stg_jaffle_shop__orders') }}\n),\n-- payments per order\npayments as (\n    select order_id, sum(amount) as amount\n    from {{ ref('stg_stripe__payments') }}\n    group by order_id\n)\nselect orders.*, coalesce(payments.amount, 0) as amount\nfrom orders left join payments using (order_id)" },
  { t: 'code', id: 'ch04-c51', lang: 'yaml', title: 'models/staging/stripe/_stripe__sources.yml', text: "sources:\n  - name: stripe\n    description: Raw payments loaded by setup.sql\n    tables:\n      - name: payments\n        identifier: payments  # the real table name\n        loaded_at_field: created_at\n        freshness:\n          warn_after: {count: 12, period: hour}" },
  { t: 'code', id: 'ch04-c52', lang: 'bash', text: '$ cd ~/dbt-course/jaffle_dbt\n$ source .venv/bin/activate\n$ dbt build --select stg_stripe__payments+\n16:02:11  Running with dbt=1.11.16\n16:02:13  Done. PASS=12 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=12', variants: { win: '$ cd $HOME\\dbt-course\\jaffle_dbt\n$ .venv\\Scripts\\Activate.ps1\n$ dbt build --select stg_stripe__payments+\n16:02:11  Running with dbt=1.11.16\n16:02:13  Done. PASS=12 WARN=0 ERROR=0 SKIP=0 NO-OP=0 TOTAL=12' } },
  { t: 'code', id: 'ch04-c53', lang: 'dbt', lineNumbers: true, text: "with orders as (\n    select * from {{ ref('stg_shop__orders') }}\n),\nfinal as (\n    select customer_id, count(*) as number_of_orders\n    from orders\n    group by customer_id\n)\nselect * from final;" },
  { t: 'code', id: 'ch04-c54', lang: 'python', title: 'models/marts/customer_segments.py', text: "def model(dbt, session):\n    dbt.config(materialized='table')\n    df = dbt.ref('dim_customers').df()\n    # three segments by number of orders\n    df['segment'] = df['number_of_orders'].apply(lambda n: 'new' if n <= 1 else 'loyal')\n    return df" },
  { t: 'lab', id: 'ch04-lab3', title: ['NULLs, functions and CASE'], objectives: ['CP0-SQL', '1.2'], blocks: [
    { t: 'list', kind: 'ol', items: [
      { blocks: [{ t: 'p', c: ['Count the customers without email with ', { t: 'code', v: 'count(*) - count(email)' }, '. Expected result: 5.'] }] },
      { blocks: [{ t: 'p', c: ['Replace the missing emails with ', { t: 'code', v: "coalesce(email, 'no email')" }, '.'] }] },
      { blocks: [{ t: 'p', c: ['Write a ', { t: 'code', v: 'case' }, ' expression that labels each order ', { t: 'code', v: 'small' }, ' or ', { t: 'code', v: 'large' }, '.'] }] },
    ] },
  ] },
  { t: 'list', kind: 'ul', items: [
    { blocks: [{ t: 'p', c: [{ t: 'code', v: 'count(*)' }, ' counts rows, whatever they contain.'] }] },
    { blocks: [{ t: 'p', c: [{ t: 'code', v: 'count(email)' }, ' counts rows where ', { t: 'code', v: 'email' }, ' is not NULL.'] }] },
  ] },
  { t: 'callout', kind: 'summary', blocks: [{ t: 'list', kind: 'ul', items: [{ blocks: [{ t: 'p', c: ['NULL means unknown; any comparison with NULL is unknown.'] }] }, { blocks: [{ t: 'p', c: ['Use ', { t: 'code', v: 'is null' }, ', never ', { t: 'code', v: '= null' }, '.'] }] }] }] },
];
