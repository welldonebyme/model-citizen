/**
 * Selection challenges in the style of Chapter 16: the learner writes a selection, the engine checks that it
 * selects exactly the same nodes as the reference answer (any correct expression is accepted).
 */
import type { Project } from './project';
import { SCENARIOS } from './scenarios';
import { runCommand } from './tasks';

export interface Challenge {
  id: string;
  /** project-tag id of the DAG, e.g. "jaffle-ch16" */
  project: string;
  title: string;
  /** the task, simple English */
  prompt: string;
  /** a broken selection to start from ("why does this select nothing?") */
  start?: string;
  /** arguments added to the learner's selection and to the answer (shown to the learner) */
  fixed?: string;
  /** one correct selection (what goes after `dbt ls`) */
  answer: string;
  /** the learner must use this operator or method (e.g. "1+"), so that listing names is not enough */
  require?: { pattern: string; message: string };
  /** --state folder of the playground (scenario id) */
  scenario?: string;
  hints: string[];
  /** shown after success */
  explain: string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'parents-all', project: 'jaffle-ch16', title: 'Everything above a mart',
    prompt: 'Select fct_orders and every model it depends on, directly or not.',
    fixed: '--resource-type model', answer: '+fct_orders', require: { pattern: '\\+fct_orders', message: 'Use a graph operator on fct_orders.' },
    hints: ['The + goes on the side of the DAG you want.', 'Parents are on the left: +fct_orders.'],
    explain: '+fct_orders walks up the DAG: both intermediate models, the ephemeral model and three staging models.',
  },
  {
    id: 'parents-first-degree', project: 'jaffle-ch16', title: 'First-degree parents only',
    prompt: 'Select fct_orders and only its direct (first-degree) parents.',
    fixed: '--resource-type model', answer: '1+fct_orders', require: { pattern: '1\\+', message: 'Use a number with the + operator.' },
    hints: ['"Direct", "first-degree" or "immediate" means a depth of 1.', 'The number goes on the outside of the +.'],
    explain: '1+fct_orders = fct_orders and its parents one level up: int_orders__enriched and int_orders__payment_methods_pivoted.',
  },
  {
    id: 'children-first-degree', project: 'jaffle-ch16', title: 'Direct children',
    prompt: 'Select fct_orders and its direct children only.',
    fixed: '--resource-type model', answer: 'fct_orders+1', require: { pattern: '\\+1', message: 'Use a number with the + operator.' },
    hints: ['Children are on the right side of the +.'],
    explain: 'fct_orders+1 adds one level down: dim_customers. customer_segments is two levels down.',
  },
  {
    id: 'two-levels', project: 'jaffle-ch16', title: 'Two levels up',
    prompt: 'Select dim_customers and its parents up to two levels up.',
    fixed: '--resource-type model', answer: '2+dim_customers', require: { pattern: '2\\+', message: 'Use the depth 2.' },
    hints: ['Any number works: 3+x, x+2...'],
    explain: 'Level 1: fct_orders and stg_jaffle_shop__customers (and the seed, not a model). Level 2: the two intermediate models. stg_jaffle_shop__orders is three levels up.',
  },
  {
    id: 'at-operator', project: 'jaffle-ch16', title: 'Build the children in an empty schema',
    prompt: 'In an empty CI schema you must rebuild int_orders__enriched, all its children, and every other parent those children need. Select those models.',
    fixed: '--resource-type model', answer: '@int_orders__enriched',
    hints: ['+x+ is not enough: a child can have another parent.', 'One operator adds the parents of the children.'],
    explain: '@int_orders__enriched also brings int_orders__payment_methods_pivoted: it is not an ancestor of int_orders__enriched, but fct_orders needs it.',
  },
  {
    id: 'intersection', project: 'jaffle-ch16', title: 'Only what the mart really needs',
    prompt: 'Select the staging models (tag staging) that fct_monthly_revenue really needs.',
    fixed: '--resource-type model', answer: 'tag:staging,+fct_monthly_revenue', require: { pattern: ',', message: 'Use an intersection (a comma).' },
    hints: ['A comma means AND.', 'Combine a tag with the parents of fct_monthly_revenue.'],
    explain: 'tag:staging,+fct_monthly_revenue keeps the nodes that are in both sets: three staging models.',
  },
  {
    id: 'exclude-downstream', project: 'jaffle-ch16', title: 'Marts, minus a branch',
    prompt: 'Select every mart (tag marts) except fct_orders and everything below it.',
    fixed: '--resource-type model', answer: 'tag:marts --exclude fct_orders+',
    hints: ['--exclude accepts graph operators too.'],
    explain: '--exclude fct_orders+ removes fct_orders, dim_customers and customer_segments from the six marts.',
  },
  {
    id: 'fix-depth', project: 'jaffle-ch16', title: 'Why does this select nothing? (1)',
    prompt: 'This selection prints "does not match any enabled nodes". Fix it: you want fct_orders and its direct parents.',
    start: '+1fct_orders', fixed: '--resource-type model', answer: '1+fct_orders',
    hints: ['Read the warning: which node name does dbt look for?', 'The number goes outside the +.'],
    explain: 'dbt read "+1fct_orders" as "all ancestors of a node called 1fct_orders". No such node: nothing is selected, and the exit code is still 0.',
  },
  {
    id: 'fix-comma-space', project: 'jaffle-ch16', title: 'Why does this select the wrong nodes? (2)',
    prompt: 'You want the models that have BOTH tags finance and marts. This selection is wrong. Fix it.',
    start: 'tag:finance, tag:marts', fixed: '--resource-type model', answer: 'tag:finance,tag:marts',
    hints: ['Look at the warning: which criterion matches nothing?', 'A space after a comma splits the selection in two.'],
    explain: '"tag:finance, tag:marts" is two items: "tag:finance," (an intersection with an empty item: nothing) and "tag:marts". Never put a space after the comma.',
  },
  {
    id: 'fix-fqn-source', project: 'jaffle-ch16', title: 'Why does this select nothing? (3)',
    prompt: 'You want every model that reads the stripe source, directly or not. This selection selects nothing. Fix it.',
    start: 'stripe+', fixed: '--resource-type model', answer: 'source:stripe+',
    hints: ['A bare word uses the fqn: method.', 'fqn: never matches sources.'],
    explain: 'A bare word is fqn:, which never matches a source. source:stripe+ selects the stripe source table and the 8 models below it.',
  },
  {
    id: 'path-sources', project: 'jaffle-ch16', title: 'Sources declared in a folder',
    prompt: 'List only the sources that are declared in the folder models/staging/jaffle_shop.',
    fixed: '--resource-type source', answer: 'path:models/staging/jaffle_shop',
    hints: ['path: selects every resource of a folder, sources included.'],
    explain: 'path: also selects the sources declared in the YAML files of the folder.',
  },
  {
    id: 'file-python', project: 'jaffle-ch16', title: 'A model by its file',
    prompt: 'Select the Python model by its file name, with its tests.',
    answer: 'file:customer_segments.py',
    hints: ['A value that ends with .py uses the file: method by default.'],
    explain: 'file:customer_segments.py (or just customer_segments.py) selects the model; indirect selection adds its two tests.',
  },
  {
    id: 'config-incremental', project: 'jaffle-ch16', title: 'By configuration',
    prompt: 'Select every incremental model.',
    answer: 'config.materialized:incremental',
    hints: ['config.<key>:<value> reads a config value.'],
    explain: 'config.materialized:incremental: fct_orders and the microbatch model fct_order_items_daily (microbatch is an incremental strategy).',
  },
  {
    id: 'flag-vs-method', project: 'jaffle-ch16', title: 'Seeds and snapshots, without tests',
    prompt: 'List the seed and the snapshots, but not the tests of the seed.',
    answer: '--resource-type seed snapshot',
    hints: ['resource_type: is a selection method: indirect selection adds the tests.', 'The --resource-type flag is a final filter.'],
    explain: 'The flag removes every other type from the result, tests included. The method resource_type:seed would add the two tests of the seed.',
  },
  {
    id: 'generic-tests-of', project: 'jaffle-ch16', title: 'The generic tests of one model',
    prompt: 'Select only the generic tests of stg_stripe__payments.',
    answer: 'test_type:generic,stg_stripe__payments',
    hints: ['Intersect a test method with the model.'],
    explain: 'stg_stripe__payments selects the model and its tests (indirect selection); the intersection with test_type:generic keeps the tests.',
  },
  {
    id: 'no-tests', project: 'jaffle-ch18', title: 'A model without any test',
    prompt: 'Select fct_orders alone: no test must come with it, without using --resource-type.',
    answer: 'fct_orders --indirect-selection empty', require: { pattern: 'indirect-selection', message: 'Change the indirect selection mode.' },
    hints: ['Which indirect selection mode adds no test at all?'],
    explain: '--indirect-selection empty adds no test. eager (the default) adds every test that touches fct_orders, even relationships tests defined on other models.',
  },
  {
    id: 'exposure-needs', project: 'jaffle-ch25', title: 'Everything an exposure needs',
    prompt: 'Select every model that the dashboard monthly_revenue_dashboard needs.',
    fixed: '--resource-type model', answer: '+exposure:monthly_revenue_dashboard',
    hints: ['exposure: is a method; the graph operators work on it.'],
    explain: '+exposure:monthly_revenue_dashboard walks up from the exposure: the marts it uses and all their parents.',
  },
  {
    id: 'latest-versions', project: 'jaffle-ch25', title: 'Latest versions',
    prompt: 'Select the latest version of each versioned model.',
    fixed: '--resource-type model', answer: 'version:latest',
    hints: ['A method selects versions: latest, old, prerelease, none.'],
    explain: 'version:latest selects dim_customers.v2 (latest_version: 2). version:old would select v1.',
  },
  {
    id: 'slim-ci', project: 'jaffle-ch24', title: 'Slim CI',
    prompt: 'The --state folder holds the production manifest. Select what changed and everything downstream of it.',
    scenario: 'ch24-prod', answer: 'state:modified+ --state prod-artifacts', require: { pattern: 'state:', message: 'Use the state: method.' },
    hints: ['state:modified = new + changed nodes.', 'Add the descendants with +. Do not forget --state.'],
    explain: 'state:modified+ selects fct_monthly_revenue, its test and the exposure below it: the CI job builds only that.',
  },
  {
    id: 'failed-test-model', project: 'jaffle-ch24', title: 'Re-run after a failed test',
    prompt: 'A relationships test failed in the last run. result:error+ selects nothing. Select the failed test and the model it checks.',
    scenario: 'ch24-test-fail', start: 'result:error+ --state ../last_run', answer: '1+result:fail --state ../last_run',
    hints: ['A failed test has the status fail, not error.', 'The model a test checks is its parent.'],
    explain: 'Tests end with fail; models end with error. 1+result:fail adds the parents of the failed test. A test has no children, so a + after it adds nothing in dbt 1.11.16.',
  },
];

export interface ChallengeCheck {
  ok: boolean;
  /** what to tell the learner */
  message: string;
  missing: string[];
  extra: string[];
  error?: string;
}

/** Strip a leading "dbt ls" or "dbt list" (the learner may type the whole command). */
export function selectionPart(text: string): string {
  return text.trim().replace(/^\$\s*/, '').replace(/^dbt\s+(-q\s+)?(ls|list)\b/, '').trim();
}

export function challengeCommand(c: Challenge, selection: string): string {
  const sel = selectionPart(selection);
  const asArgs = sel.startsWith('-') ? sel : sel ? `-s ${sel}` : '';
  return `dbt ls ${asArgs}${c.fixed ? ' ' + c.fixed : ''}`.replace(/\s+/g, ' ').trim();
}

export function checkChallenge(project: Project, c: Challenge, selection: string): ChallengeCheck {
  const scen = c.scenario ? SCENARIOS.find((s) => s.id === c.scenario)?.build(project) ?? null : null;
  // no shell globbing here: the learner types a selection, not a shell line
  const want = runCommand(project, challengeCommand(c, c.answer), { previous: scen, clock: '00:00:00', shell: 'powershell' });
  const got = runCommand(project, challengeCommand(c, selection), { previous: scen, clock: '00:00:00', shell: 'powershell' });
  if (got.error) return { ok: false, message: 'dbt stops with an error. Read it, then fix your selection.', missing: [], extra: [], error: got.error.lines('ls').join('\n') };
  const w = new Set(want.output);
  const g = new Set(got.output);
  const missing = want.output.filter((x) => !g.has(x));
  const extra = got.output.filter((x) => !w.has(x));
  if (missing.length || extra.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`${missing.length} node${missing.length === 1 ? ' is' : 's are'} missing`);
    if (extra.length) parts.push(`${extra.length} node${extra.length === 1 ? ' is' : 's are'} too many`);
    return { ok: false, message: `Not yet: ${parts.join(', ')}.`, missing, extra };
  }
  if (c.require && !new RegExp(c.require.pattern).test(selectionPart(selection))) {
    return { ok: false, message: `Right nodes, but: ${c.require.message}`, missing: [], extra: [] };
  }
  return { ok: true, message: 'Correct: your selection gives exactly the expected nodes.', missing: [], extra: [] };
}
