// The 7 official topics and 31 sub-objectives (+ prerequisites), as numbered in the book (Part 0,
// "The official topics, and where to learn them"), with the chapters that teach them.
// Used for the per-topic and per-objective breakdowns and for "what to review" links.

export const TOPICS: { n: number; title: string; short: string; blueprint: number }[] = [
  { n: 1, title: 'Developing and optimizing dbt models', short: 'Developing models', blueprint: 26 },
  { n: 2, title: 'Managing dbt model governance', short: 'Governance', blueprint: 7 },
  { n: 3, title: 'Debugging data modeling errors', short: 'Debugging', blueprint: 8 },
  { n: 4, title: 'Troubleshooting and optimizing dbt pipelines', short: 'Pipelines', blueprint: 5 },
  { n: 5, title: 'Implementing dbt tests', short: 'Tests', blueprint: 9 },
  { n: 6, title: 'Implementing and maintaining external dependencies', short: 'External dependencies', blueprint: 4 },
  { n: 7, title: 'Leveraging dbt state', short: 'dbt state', blueprint: 6 },
];

export interface Objective { id: string; topic: number; title: string; chapters: number[] }

export const OBJECTIVES: Objective[] = [
  { id: 'CP0-SQL', topic: 0, title: 'SQL: joins, aggregations, CTEs, window functions', chapters: [4] },
  { id: 'CP0-GIT', topic: 0, title: 'Git: branching strategies, basic commands, pull requests', chapters: [3] },
  { id: '1.1', topic: 1, title: 'Identifying and verifying raw object dependencies (sources)', chapters: [7, 21] },
  { id: '1.2', topic: 1, title: 'Understanding core materializations', chapters: [8] },
  { id: '1.3', topic: 1, title: 'Modularity and DRY principles', chapters: [9, 11] },
  { id: '1.4', topic: 1, title: 'Using commands: build, run, test, docs, show, snapshot, seed', chapters: [16, 6, 12, 13, 20] },
  { id: '1.5', topic: 1, title: 'A logical flow of models and clean DAGs', chapters: [7, 9] },
  { id: '1.6', topic: 1, title: 'Configurations in dbt_project.yml', chapters: [10] },
  { id: '1.7', topic: 1, title: 'Using dbt packages', chapters: [11] },
  { id: '1.8', topic: 1, title: 'Creating Python models', chapters: [15] },
  { id: '1.9', topic: 1, title: 'Giving users access to models with the grants config', chapters: [10] },
  { id: '1.10', topic: 1, title: 'Creating snapshots in YAML', chapters: [13] },
  { id: '1.11', topic: 1, title: 'Choosing the best incremental strategy for a dataset', chapters: [14] },
  { id: '1.12', topic: 1, title: 'Dry runs with the --empty flag', chapters: [16, 25] },
  { id: '1.13', topic: 1, title: 'Running models in sample mode with --sample', chapters: [16] },
  { id: '1.14', topic: 1, title: 'Advanced materializations such as microbatch', chapters: [14] },
  { id: '2.1', topic: 2, title: 'Model contracts', chapters: [17] },
  { id: '2.2', topic: 2, title: 'Model versions and deprecating old versions', chapters: [17] },
  { id: '2.3', topic: 2, title: 'Constraints in YAML enforced by the data platform', chapters: [17] },
  { id: '3.1', topic: 3, title: 'Understanding logged error messages', chapters: [22] },
  { id: '3.2', topic: 3, title: 'Troubleshooting with compiled code', chapters: [22] },
  { id: '3.3', topic: 3, title: 'Troubleshooting .yml compilation errors', chapters: [22, 5] },
  { id: '3.4', topic: 3, title: 'Developing a fix and testing it before merging', chapters: [22, 25, 3] },
  { id: '3.5', topic: 3, title: 'Managing dbt behaviour with flags', chapters: [22] },
  { id: '4.1', topic: 4, title: 'Troubleshooting and managing failure points in the DAG', chapters: [23] },
  { id: '4.2', topic: 4, title: 'Using dbt clone', chapters: [23] },
  { id: '5.1', topic: 5, title: 'Generic, singular, custom and unit tests', chapters: [18, 19] },
  { id: '5.2', topic: 5, title: 'Testing assumptions about models and sources', chapters: [18] },
  { id: '5.3', topic: 5, title: 'Placing testing steps in the workflow', chapters: [18, 25] },
  { id: '6.1', topic: 6, title: 'Exposures', chapters: [21] },
  { id: '6.2', topic: 6, title: 'Source freshness', chapters: [21] },
  { id: '7.1', topic: 7, title: 'Understanding state and state selection', chapters: [24] },
  { id: '7.2', topic: 7, title: 'Using dbt retry', chapters: [24] },
];

const BY_ID = new Map(OBJECTIVES.map((o) => [o.id, o]));
export const objective = (id: string | undefined): Objective | undefined => (id ? BY_ID.get(id) : undefined);

/** "1.11" → 1, "CP0-SQL" → 0, unknown → undefined. */
export function topicOf(objectiveId: string | undefined): number | undefined {
  if (!objectiveId) return undefined;
  const o = BY_ID.get(objectiveId);
  if (o) return o.topic;
  const m = objectiveId.match(/^(\d)\./);
  return m ? Number(m[1]) : undefined;
}

export const topicTitle = (n: number) => (n === 0 ? 'Prerequisites (SQL and Git)' : TOPICS.find((t) => t.n === n)?.title ?? `Topic ${n}`);

/** Objectives taught by a chapter (from the table above). */
export function objectivesOfChapter(chapter: number): string[] {
  return OBJECTIVES.filter((o) => o.chapters.includes(chapter)).map((o) => o.id);
}

/** Sort objectives in book order: CP0 first, then 1.1, 1.2, ..., 1.10, 1.11 ... */
export function compareObjectives(a: string, b: string): number {
  const ia = OBJECTIVES.findIndex((o) => o.id === a);
  const ib = OBJECTIVES.findIndex((o) => o.id === b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
}

export const CHAPTER_TITLES: Record<number, string> = {
  0: 'Start Here', 1: 'The Data World in Simple Words', 2: 'The Command Line from Zero', 3: 'Git and GitHub from Zero',
  4: 'SQL from Zero to Exam Level', 5: 'YAML, Jinja and Just Enough Python', 6: 'Installing dbt and Your First Project',
  7: 'Models, ref, Sources and the DAG', 8: 'Materializations', 9: 'Modularity, DRY and Refactoring', 10: 'Configuration',
  11: 'Jinja, Macros and Packages', 12: 'Seeds and Analyses', 13: 'Snapshots', 14: 'Incremental Models and Microbatch',
  15: 'Python Models', 16: 'Commands and Node Selection', 17: 'Governance: Contracts, Constraints, Versions and Access',
  18: 'Data Tests', 19: 'Unit Tests', 20: 'Documentation', 21: 'Source Freshness and Exposures', 22: 'Debugging',
  23: 'Pipelines, Failures and dbt clone', 24: 'State, Defer and dbt retry', 25: 'Environments, Jobs and CI/CD',
  26: 'Capstone Project: ShopFlow', 27: 'Exam Strategy and the Top Traps', 28: 'Mock Exam 1', 29: 'Mock Exam 1: Answers and Explanations',
  30: 'Mock Exam 2', 31: 'Mock Exam 2: Answers and Explanations', 32: 'Mock Exam 3', 33: 'Mock Exam 3: Answers and Explanations',
};
