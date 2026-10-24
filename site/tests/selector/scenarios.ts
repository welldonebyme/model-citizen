/** State-dependent golden entries reproduced with the playground's --state scenarios (src/lib/selector/scenarios.ts). */
import type { PreviousState } from '../../src/lib/selector/methods';
import { SCENARIOS } from '../../src/lib/selector/scenarios';
import type { GoldenEntry } from './golden';
import { loadProject } from './load';

/** golden id -> scenario id (from the log / book section the entry comes from) */
export const STATE_MAP: Record<string, string> = {
  'log-ch16-050': 'ch16-comment', 'log-ch16-051': 'ch16-comment', 'book-ch16-070': 'ch16-comment', 'book-ch16-071': 'ch16-comment',
  'log-ch16-053': 'ch16-build-staging', 'log-ch16-054': 'ch16-build-staging', 'book-ch16-072': 'ch16-build-staging',
  'book-ch20-002': 'ch20-docs',
  'log-ch21-001': 'ch21-fresher-payments', 'log-ch21-002': 'ch21-fresher-payments', 'log-ch21-003': 'ch21-fresher-both',
  'book-ch21-004': 'ch21-comment-revenue',
  'log-ch24-001': 'ch24-prod', 'log-ch24-002': 'ch24-prod', 'log-ch24-003': 'ch24-prod', 'log-ch24-004': 'ch24-prod', 'log-ch24-005': 'ch24-prod',
  'log-ch24-024': 'ch24-prod', 'log-ch24-025': 'ch24-prod',
  'book-ch24-001': 'ch24-prod', 'book-ch24-002': 'ch24-prod', 'book-ch24-003': 'ch24-prod', 'book-ch24-004': 'ch24-prod', 'book-ch24-005': 'ch24-prod', 'book-ch24-009': 'ch24-prod',
  'log-ch24-006': 'ch24-config', 'log-ch24-007': 'ch24-config', 'log-ch24-008': 'ch24-config',
  'log-ch24-009': 'ch24-tag', 'log-ch24-010': 'ch24-tag', 'log-ch24-011': 'ch24-group',
  'log-ch24-012': 'ch24-description', 'log-ch24-013': 'ch24-description',
  'log-ch24-014': 'ch24-macro', 'log-ch24-015': 'ch24-macro',
  'log-ch24-016': 'ch24-alias-sql', 'log-ch24-017': 'ch24-alias-sql', 'log-ch24-018': 'ch24-alias-sql',
  'log-ch24-021': 'ch24-contract-breaking', 'log-ch24-022': 'ch24-contract-add',
  'log-ch24-027': 'ch24-typo', 'log-ch24-028': 'ch24-typo', 'log-ch24-029': 'ch24-typo',
  'book-ch24-006': 'ch24-typo', 'book-ch24-007': 'ch24-typo', 'book-ch24-008': 'ch24-typo',
  'log-ch24-031': 'ch24-test-fail',
  'log-ch25-001': 'ch25-ci', 'log-ch25-002': 'ch25-ci', 'log-ch25-003': 'ch25-ci',
  'cap-m13-002': 'm13-feature', 'cap-m13-003': 'm13-feature', 'cap-m13-004': 'm13-feature', 'cap-m13-005': 'm13-feature', 'cap-m13-006': 'm13-feature',
};

/**
 * Entries recorded before the end state of their tag. Evidence: the "Found ..." line of the log.
 * log-ch21-00x: "Found ... 5 sources, 670 macros, 2 groups, 5 unit tests" = no exposures yet (they are added later in
 * Chapter 21), so the graph is the ch21 graph without its 2 exposures, which is exactly the graph of tag ch20.
 */
export const STATE_TAG: Record<string, { tag: string; why: string }> = {
  'log-ch21-001': { tag: 'ch20', why: 'log taken before the exposures were added (its Found line has no exposures): graph of tag ch20' },
  'log-ch21-002': { tag: 'ch20', why: 'log taken before the exposures were added (its Found line has no exposures): graph of tag ch20' },
  'log-ch21-003': { tag: 'ch20', why: 'log taken before the exposures were added (its Found line has no exposures): graph of tag ch20' },
};

/** State entries that cannot be simulated, with the reason (reported in golden-notes.json). */
export const STATE_NOT_SIMULATED: Record<string, string> = {
  'log-ch24-019': 'a NEW model fct_daily_revenue is added for the demo: the node does not exist in any tag, so no data',
  'log-ch24-020': 'a NEW model fct_daily_revenue is added for the demo: the node does not exist in any tag, so no data',
  'cap-m13-008': 'run with the CI profiles folder (schema ci_pr_<PR_NUMBER>); the relation names come from a profile the data does not have',
};

export function scenarioFor(e: GoldenEntry): { previous: PreviousState; tag?: string; scenario: string } | null {
  const id = STATE_MAP[e.id];
  if (!id) return null;
  const s = SCENARIOS.find((x) => x.id === id)!;
  const tag = STATE_TAG[e.id]?.tag ?? e.tag;
  const p = loadProject(e.project, tag);
  const prev = s.build(p);
  if (!prev) return null;
  return { previous: prev, scenario: id, tag: STATE_TAG[e.id] ? tag : undefined };
}
