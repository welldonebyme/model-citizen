/**
 * Public API of the selection engine (dbt-core 1.11.16 node selection, ported to TypeScript).
 *
 *   const project = new Project(dag, extras)               // or: await loadProject('jaffle-ch16') in the browser
 *   select(project, { select: ['+fct_orders'], exclude: ['tag:x'], resourceTypes: ['model'] })  -> unique ids
 *   runCommand(project, 'dbt ls -s +fct_orders --exclude tag:x')   -> output lines, logs, errors, execution order
 *   parseLsOutput(pastedText) / compareLs(expected, pasted)         -> paste-to-verify
 */
export { Project, pySort, type PNode, type Target } from './project';
export { runCommand, select, executionOrder, describeNode, canonical, jsonLine, lsLine, type CommandResult, type ExecStep, type RunOptions } from './tasks';
export { parseCommandLine, buildCommandLine, type ParsedCommand, type DbtArgs, type Shell } from './cli';
export { parseLsOutput, compareLs, detectFormat, type ParsedLs, type LsComparison } from './lsparse';
export { explain, describeMethod, describeOperators, type ExplainLine } from './explain';
export { SCENARIOS, scenariosFor, type Scenario } from './scenarios';
export { previousTagState, simulateState, simulateRunResults, type StateSimulation, type RunSimulation } from './state';
export { DbtError } from './errors';
export type { PreviousState } from './methods';
export type { Dag, DagNode, Extras } from './types';
