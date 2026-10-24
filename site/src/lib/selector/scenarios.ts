/**
 * "--state folders" the playground offers: the previous chapter tag (real) and the book's own experiments
 * (simulated on top of the tag, each one reproduces a real output of the book or the builder logs).
 */
import type { PreviousState } from './methods';
import type { Project } from './project';
import { previousTagState, simulateRunResults, simulateState, withFresher, withResults, type StateChange } from './state';

export interface Scenario {
  id: string;
  key: 'jaffle' | 'shopflow' | '*';
  tag: string | '*';
  title: string;
  /** one or two sentences, simple English */
  description: string;
  kind: 'state' | 'results' | 'freshness';
  /** where the book shows it */
  source: string;
  /** real = computed by dbt 1.11.16, simulated = rules of dbt 1.11.16 applied by this site */
  origin: 'real' | 'simulated';
  build(project: Project): PreviousState | null;
}

const J = (name: string) => `model.jaffle_dbt.${name}`;

const CONTRACT_ERROR = [
  'Breaking change to contract Error in model dim_customers (models/marts/dim_customers_v2.sql)',
  '  While comparing to previous project state, dbt detected a breaking change to an enforced contract.',
  '    - Columns were removed:',
  '      - email',
  '  Consider making an additive (non-breaking) change instead, if possible.',
  '  Otherwise, create a new model version: https://docs.getdbt.com/docs/collaborate/govern/model-versions',
].join('\n');

function ch24Prod(p: Project): PreviousState | null {
  const prev = previousTagState(p);
  if (!prev) return null;
  return { ...prev, label: 'prod-artifacts: the production manifest built before the change (= tag ch23), compared by real dbt 1.11.16' };
}

function ch24Demo(id: string, title: string, description: string, changes: StateChange[], extra: { macros?: string[]; errors?: Record<string, string> } = {}): Scenario {
  return {
    id, key: 'jaffle', tag: 'ch24', title, description, kind: 'state', source: 'Chapter 24, "The sub-selectors, one change at a time"', origin: 'simulated',
    build: (p) => simulateState(p, { base: ch24Prod(p), changes, label: `prod-artifacts + demo: ${title}`, ...extra }),
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'prev-tag', key: '*', tag: '*', kind: 'state', origin: 'real', source: 'every chapter tag',
    title: 'The previous chapter tag',
    description: 'The state folder holds the manifest of the reference project at the previous chapter. Every state: value was computed with real dbt 1.11.16.',
    build: (p) => previousTagState(p),
  },
  {
    id: 'ch16-comment', key: 'jaffle', tag: 'ch16', kind: 'state', origin: 'simulated', source: 'Chapter 16, "Preview: selecting by state and by result"',
    title: 'A comment added to stg_stripe__payments.sql',
    description: 'The manifest was saved, then one comment line was added to the SQL of stg_stripe__payments.',
    build: (p) => simulateState(p, { changes: [{ uid: J('stg_stripe__payments'), kinds: ['body'] }], label: '../state_ch16 (saved before a comment was added to stg_stripe__payments.sql)' }),
  },
  {
    id: 'ch16-build-staging', key: 'jaffle', tag: 'ch16', kind: 'results', origin: 'simulated', source: 'Chapter 16, "Preview: selecting by state and by result"',
    title: 'Run results of dbt build --select staging',
    description: 'run_results.json after a successful dbt build --select staging: the staging models are success, their tests are pass.',
    build: (p) => withResults(null, 'run_results.json of dbt build --select staging', simulateRunResults(p, { command: 'dbt build --select staging', label: '' })),
  },
  {
    id: 'ch20-docs', key: 'jaffle', tag: 'ch20', kind: 'state', origin: 'simulated', source: 'Chapter 20, "persist_docs and state:modified"',
    title: 'Two descriptions changed',
    description: 'The descriptions of fct_orders (persist_docs on) and stg_jaffle_shop__orders (persist_docs off) were changed. Only the persisted one counts.',
    build: (p) => simulateState(p, { changes: [{ uid: J('fct_orders'), kinds: ['persisted_descriptions'] }, { uid: J('stg_jaffle_shop__orders'), kinds: ['none'] }], label: '../state_docs (saved before two descriptions changed)' }),
  },
  {
    id: 'ch21-comment-revenue', key: 'jaffle', tag: 'ch21', kind: 'state', origin: 'simulated', source: 'Chapter 21, "Exposures in CI"',
    title: 'A comment added to fct_monthly_revenue.sql',
    description: 'The manifest was saved, then a harmless comment was added to fct_monthly_revenue.sql.',
    build: (p) => simulateState(p, { changes: [{ uid: J('fct_monthly_revenue'), kinds: ['body'] }], label: '../state (saved before a comment was added to fct_monthly_revenue.sql)' }),
  },
  {
    id: 'ch21-fresher-payments', key: 'jaffle', tag: 'ch21', kind: 'freshness', origin: 'simulated', source: 'builder log ch21, section 3',
    title: 'New payments arrived (first freshness cycle)',
    description: 'Between the two freshness runs, only stripe.payments got newer data (the orders source was not compared in this first cycle).',
    build: () => withFresher(null, 'sources.json: stripe.payments is fresher', ['source.jaffle_dbt.stripe.payments']),
  },
  {
    id: 'ch21-fresher-both', key: 'jaffle', tag: 'ch21', kind: 'freshness', origin: 'simulated', source: 'builder log ch21, section 3 (second cycle)',
    title: 'New orders and payments arrived',
    description: 'A full freshness check before and after a fresh load: jaffle_shop.orders and stripe.payments both have newer data.',
    build: () => withFresher(null, 'sources.json: orders and payments are fresher', ['source.jaffle_dbt.jaffle_shop.orders', 'source.jaffle_dbt.stripe.payments']),
  },
  {
    id: 'ch24-prod', key: 'jaffle', tag: 'ch24', kind: 'state', origin: 'real', source: 'Chapter 24, "Your first state comparison"',
    title: 'prod-artifacts (fct_monthly_revenue changed)',
    description: 'Production was built before the branch change: fct_monthly_revenue got a new column. Real dbt comparison of tag ch24 with tag ch23.',
    build: ch24Prod,
  },
  ch24Demo('ch24-config', 'fct_order_items becomes a view (config in YAML)', 'materialized: view added in the properties file of fct_order_items.', [{ uid: J('fct_order_items'), kinds: ['configs'] }]),
  ch24Demo('ch24-tag', 'A tag added to fct_order_items', 'tags: [finance] becomes [finance, daily]. Tags are not compared.', [{ uid: J('fct_order_items'), kinds: ['none'] }]),
  ch24Demo('ch24-group', 'fct_order_items moves to the marketing group', 'In dbt 1.11.16 a group change is not detected (the docs say it can be).', [{ uid: J('fct_order_items'), kinds: ['none'] }]),
  ch24Demo('ch24-description', 'The description of fct_orders changes', 'persist_docs is on for the marts, so the description is part of the database: modified.persisted_descriptions.', [{ uid: J('fct_orders'), kinds: ['persisted_descriptions'] }]),
  ch24Demo('ch24-macro', 'The macro cents_to_dollars changes', '/ 100 becomes / 100.0: every model that calls the macro is modified.', [], { macros: ['macro.jaffle_dbt.cents_to_dollars'] }),
  ch24Demo('ch24-alias-sql', 'An alias set with config() in fct_order_items.sql', 'The relation name changes (.relation) and the file changes too (.body).', [{ uid: J('fct_order_items'), kinds: ['relation', 'body'] }]),
  ch24Demo('ch24-alias-yml', 'An alias set in the YAML config of fct_order_items', 'Only the relation name changes (.relation).', [{ uid: J('fct_order_items'), kinds: ['relation'] }]),
  ch24Demo('ch24-contract-breaking', 'A column removed from the enforced contract of dim_customers v2', 'A breaking change: every command that compares contracts stops with an error.', [],
    { errors: { modified: CONTRACT_ERROR, unmodified: CONTRACT_ERROR, 'modified.contract': CONTRACT_ERROR } }),
  ch24Demo('ch24-contract-add', 'A column added to the enforced contract of dim_customers v2', 'Adding a column is not breaking: modified.contract selects v2.', [{ uid: 'model.jaffle_dbt.dim_customers.v2', kinds: ['contract', 'body'] }]),
  {
    id: 'ch24-typo', key: 'jaffle', tag: 'ch24', kind: 'results', origin: 'simulated', source: 'Chapter 24, "Result selectors: re-running what failed"',
    title: 'Run results: stg_jaffle_shop__products is broken',
    description: 'dbt build --exclude-resource-type unit_test after a typo (categoryy): the model errors, everything below it is skipped, the orphan-order relationships test warns.',
    build: (p) => withResults(null, '../last_run/run_results.json (typo in stg_jaffle_shop__products)', simulateRunResults(p, {
      command: 'dbt build --exclude-resource-type unit_test', errors: [J('stg_jaffle_shop__products')],
      warns: ['test.jaffle_dbt.relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_.3e222ebf00'], label: '',
    })),
  },
  {
    id: 'ch24-test-fail', key: 'jaffle', tag: 'ch24', kind: 'results', origin: 'simulated', source: 'builder log ch24, "result:fail and retry"',
    title: 'Run results: a relationships test fails',
    description: 'dbt test --select test_name:relationships --warn-error: the warning becomes a failure (status fail).',
    build: (p) => withResults(null, '../last_run/run_results.json (dbt test --select test_name:relationships --warn-error)', simulateRunResults(p, {
      command: 'dbt test --select test_name:relationships',
      fails: ['test.jaffle_dbt.relationships_stg_jaffle_shop__orders_customer_id__customer_id__ref_stg_jaffle_shop__customers_.3e222ebf00'], label: '',
    })),
  },
  {
    id: 'ch25-ci', key: 'jaffle', tag: 'ch25', kind: 'state', origin: 'simulated', source: 'builder log ch25, "Run the CI job locally"',
    title: 'Pull request: fct_orders changes',
    description: 'The CI job compares the pull request with the production manifest: only fct_orders.sql changed.',
    build: (p) => simulateState(p, { changes: [{ uid: J('fct_orders'), kinds: ['body'] }], label: 'prod-artifacts (production manifest of main) vs a pull request that changes fct_orders' }),
  },
  {
    id: 'm13-feature', key: 'shopflow', tag: 'm13', kind: 'state', origin: 'real', source: 'capstone log m13',
    title: 'Feature branch: fct_sessions gets is_bounce',
    description: 'Production = the milestone before the feature (m12). Real dbt comparison of m13 with m12.',
    build: (p) => {
      const prev = previousTagState(p);
      return prev ? { ...prev, label: 'prod-artifacts: production before the feature (= m12), compared by real dbt 1.11.16' } : null;
    },
  },
];

export function scenariosFor(project: Project): Scenario[] {
  return SCENARIOS.filter((s) => (s.key === '*' || s.key === project.key) && (s.tag === '*' || s.tag === project.tag) && (s.id !== 'prev-tag' || !!project.extras?.state_prev));
}
