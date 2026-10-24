/**
 * The book's selector experiments (Chapter 16), added to the project's selectors.yml on request.
 * Real dbt 1.11.16 results (run on tag ch16 with these lines appended to selectors.yml):
 *   cli_union        -> No nodes selected!   (a CLI-style string holds ONE criterion: the space is not a union)
 *   cli_intersection -> No nodes selected!   (the comma is not an intersection either)
 *   cli_parents      -> the 7 models of +fct_orders (graph operators work in the string)
 *   one_key          -> the 4 finance marts  (the one-key form {tag: finance})
 */
import { Project } from './project';
import type { SelectorDef } from './types';

export const DEMO_SELECTORS: SelectorDef[] = [
  { name: 'cli_union', description: 'Book demo: a CLI-style string with a space.', definition: 'tag:finance+ tag:marketing+' },
  { name: 'cli_intersection', description: 'Book demo: a CLI-style string with a comma.', definition: 'tag:finance,config.materialized:table' },
  { name: 'cli_parents', description: 'Book demo: a CLI-style string with a graph operator.', definition: '+fct_orders' },
  { name: 'one_key', description: 'Book demo: the one-key form.', definition: { tag: 'finance' } },
];

export const DEMO_YML = `
  - name: cli_union
    description: Book demo - a CLI-style string with a space.
    definition: 'tag:finance+ tag:marketing+'

  - name: cli_intersection
    description: Book demo - a CLI-style string with a comma.
    definition: 'tag:finance,config.materialized:table'

  - name: cli_parents
    description: Book demo - a CLI-style string with a graph operator.
    definition: '+fct_orders'

  - name: one_key
    description: Book demo - the one-key form.
    definition:
      tag: finance
`;

/** A copy of the project with the demo selectors appended to selectors.yml (only when it has one). */
export function withDemoSelectors(p: Project): Project {
  if (!p.dag.selectors_yml) return p;
  const selectors = { ...p.selectors };
  for (const s of DEMO_SELECTORS) selectors[s.name] = s;
  return new Project({ ...p.dag, selectors, selectors_yml: p.dag.selectors_yml + DEMO_YML }, p.extras);
}
