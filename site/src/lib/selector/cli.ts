/**
 * Command line -> dbt arguments, the way a shell and dbt's click parser would do it.
 *
 *  - shell: quotes, backslashes, `VAR=value dbt ...`, a leading "$ ", `| wc -l`; unquoted * ? [ are
 *    expanded by zsh (macOS) against the project folder, and zsh stops with "no matches found" when
 *    nothing matches (bash keeps the word, PowerShell never expands for dbt)
 *  - dbt 1.11 click rules: multi-value options (--select a b c) eat words until the next "-..." word,
 *    global flags are accepted before or after the command, unknown options are usage errors
 */
import { getCloseMatches } from './difflib';
import { DbtError, usageError } from './errors';
import { fnmatchRegExp } from './fnmatch';
import type { Indirect } from './spec';
import type { VirtualFs } from './vfs';

export type Shell = 'zsh' | 'bash' | 'powershell';

export type CommandName =
  | 'ls' | 'build' | 'run' | 'test' | 'seed' | 'snapshot' | 'compile' | 'show' | 'clone' | 'source freshness'
  | 'docs generate' | 'parse' | 'retry' | 'run-operation' | 'deps' | 'debug' | 'clean' | 'init' | 'docs serve';

export interface DbtArgs {
  select: string[] | null;
  models: string[] | null;
  exclude: string[] | null;
  selector: string | null;
  resourceTypes: string[];
  excludeResourceTypes: string[];
  indirectSelection: Indirect;
  output: 'selector' | 'name' | 'path' | 'json';
  outputKeys: string[];
  state: string | null;
  deferState: string | null;
  defer: boolean;
  target: string | null;
  quiet: boolean;
  /** every other option, for display */
  other: Record<string, string | boolean>;
}

export interface ParsedCommand {
  raw: string;
  env: Record<string, string>;
  /** the dbt words after shell processing */
  argv: string[];
  command: CommandName;
  /** "list" was typed instead of "ls" */
  alias?: string;
  args: DbtArgs;
  pipe: string | null;
  /** deprecation and other log lines dbt prints before the selection */
  notices: string[];
}

const LIST_COMMANDS = new Set(['ls', 'list']);
const SELECTION_COMMANDS = new Set<CommandName>(['ls', 'build', 'run', 'test', 'seed', 'snapshot', 'compile', 'show', 'clone', 'source freshness', 'docs generate']);

const RESOURCE_TYPE_CHOICES = ['metric', 'semantic_model', 'saved_query', 'source', 'analysis', 'function', 'model', 'test', 'unit_test', 'exposure', 'snapshot', 'seed', 'default', 'all'];
const EXCLUDE_RESOURCE_TYPE_CHOICES = ['metric', 'semantic_model', 'saved_query', 'source', 'analysis', 'model', 'test', 'unit_test', 'exposure', 'snapshot', 'seed', 'function', 'default'];

// ------------------------------------------------------------------------------------------ tokenizer
interface Word { text: string; quotedGlob: boolean; hasGlob: boolean }

/** POSIX-like word splitting. Records whether glob characters appeared unquoted. */
export function shellWords(line: string): { words: Word[]; pipe: string | null } {
  const words: Word[] = [];
  let cur = '';
  let inWord = false;
  let unquotedGlob = false;
  let i = 0;
  let pipe: string | null = null;
  const push = () => {
    if (inWord) words.push({ text: cur, quotedGlob: !unquotedGlob && /[*?[]/.test(cur), hasGlob: unquotedGlob });
    cur = '';
    inWord = false;
    unquotedGlob = false;
  };
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) throw usageError('the command line has an unclosed quote (\')');
      cur += line.slice(i + 1, j);
      inWord = true;
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length && '"\\$`'.includes(line[j + 1])) { s += line[j + 1]; j += 2; } else { s += line[j]; j++; }
      }
      if (j >= line.length) throw usageError('the command line has an unclosed quote (")');
      cur += s;
      inWord = true;
      i = j + 1;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[i + 1];
      inWord = true;
      i += 2;
    } else if (c === ' ' || c === '\t' || c === '\n') {
      push();
      i++;
    } else if (c === '#' && !inWord) {
      // a comment (like in scripts and in the book's listings): the rest of the line is ignored
      push();
      break;
    } else if (c === '|' || c === ';' || (c === '&' && line[i + 1] === '&')) {
      push();
      pipe = line.slice(i).trim();
      break;
    } else {
      if (c === '*' || c === '?' || c === '[') unquotedGlob = true;
      cur += c;
      inWord = true;
      i++;
    }
  }
  push();
  return { words, pipe };
}

/** zsh filename generation in the project folder (the folder you run dbt from). */
function zshExpand(word: string, fs: VirtualFs | null): string[] | null {
  if (!fs) return null;
  const parts = word.split('/');
  let found: string[] = [''];
  for (let idx = 0; idx < parts.length; idx++) {
    const p = parts[idx];
    if (p === '') continue;
    const next: string[] = [];
    const last = idx === parts.length - 1;
    for (const dir of found) {
      const entries = fs.list(dir);
      if (!/[*?[]/.test(p)) {
        if (entries.some(([n, k]) => n === p && (last || k === 'dir'))) next.push(dir ? `${dir}/${p}` : p);
        continue;
      }
      const re = fnmatchRegExp(p);
      for (const [name, kind] of entries) {
        if (name.startsWith('.') && !p.startsWith('.')) continue; // zsh hides dot files unless asked
        if (!last && kind !== 'dir') continue;
        if (re.test(name)) next.push(dir ? `${dir}/${name}` : name);
      }
    }
    found = next;
  }
  return found.filter((f) => f !== '').sort((a, b) => a.localeCompare(b, 'en'));
}

// ------------------------------------------------------------------------------------------ options
type OptKind = 'multi' | 'value' | 'flag' | 'choice' | 'multichoice';
interface OptDef { names: string[]; key: string; kind: OptKind; choices?: string[]; global?: boolean; neg?: string[] }

const O = (names: string[], key: string, kind: OptKind, extra: Partial<OptDef> = {}): OptDef => ({ names, key, kind, ...extra });

const GLOBAL: OptDef[] = [
  O(['-q', '--quiet'], 'quiet', 'flag', { global: true, neg: ['--no-quiet'] }),
  O(['-d', '--debug'], 'debug', 'flag', { global: true, neg: ['--no-debug'] }),
  O(['--defer'], 'defer', 'flag', { global: true, neg: ['--no-defer'] }),
  O(['--defer-state'], 'defer_state', 'value', { global: true }),
  O(['--favor-state'], 'favor_state', 'flag', { global: true, neg: ['--no-favor-state'] }),
  O(['-x', '--fail-fast'], 'fail_fast', 'flag', { global: true, neg: ['--no-fail-fast'] }),
  O(['--indirect-selection'], 'indirect_selection', 'choice', { global: true, choices: ['eager', 'cautious', 'buildable', 'empty'] }),
  O(['--log-format'], 'log_format', 'value', { global: true }),
  O(['--log-format-file'], 'log_format_file', 'value', { global: true }),
  O(['--log-level'], 'log_level', 'value', { global: true }),
  O(['--log-level-file'], 'log_level_file', 'value', { global: true }),
  O(['--log-path'], 'log_path', 'value', { global: true }),
  O(['--partial-parse'], 'partial_parse', 'flag', { global: true, neg: ['--no-partial-parse'] }),
  O(['--populate-cache'], 'populate_cache', 'flag', { global: true, neg: ['--no-populate-cache'] }),
  O(['--print'], 'print', 'flag', { global: true, neg: ['--no-print'] }),
  O(['--printer-width'], 'printer_width', 'value', { global: true }),
  O(['--profile'], 'profile', 'value', { global: true }),
  O(['-r', '--record-timing-info'], 'record_timing_info', 'value', { global: true }),
  O(['--send-anonymous-usage-stats'], 'send_anonymous_usage_stats', 'flag', { global: true, neg: ['--no-send-anonymous-usage-stats'] }),
  O(['--single-threaded'], 'single_threaded', 'flag', { global: true, neg: ['--no-single-threaded'] }),
  O(['--show-all-deprecations'], 'show_all_deprecations', 'flag', { global: true, neg: ['--no-show-all-deprecations'] }),
  O(['--state'], 'state', 'value', { global: true }),
  O(['--static-parser'], 'static_parser', 'flag', { global: true, neg: ['--no-static-parser'] }),
  O(['-t', '--target'], 'target', 'value', { global: true }),
  O(['--use-colors'], 'use_colors', 'flag', { global: true, neg: ['--no-use-colors'] }),
  O(['--use-colors-file'], 'use_colors_file', 'flag', { global: true, neg: ['--no-use-colors-file'] }),
  O(['--use-experimental-parser'], 'use_experimental_parser', 'flag', { global: true, neg: ['--no-use-experimental-parser'] }),
  O(['-V', '-v', '--version'], 'version', 'flag', { global: true }),
  O(['--version-check'], 'version_check', 'flag', { global: true, neg: ['--no-version-check'] }),
  O(['--warn-error'], 'warn_error', 'flag', { global: true }),
  O(['--warn-error-options'], 'warn_error_options', 'value', { global: true }),
  O(['--write-json'], 'write_json', 'flag', { global: true, neg: ['--no-write-json'] }),
  O(['--use-fast-test-edges'], 'use_fast_test_edges', 'flag', { global: true, neg: ['--no-use-fast-test-edges'] }),
  O(['--cache-selected-only'], 'cache_selected_only', 'flag', { global: true, neg: ['--no-cache-selected-only'] }),
  O(['--partial-parse-file-diff'], 'partial_parse_file_diff', 'flag', { global: true, neg: ['--no-partial-parse-file-diff'] }),
  O(['--upload-to-artifacts-ingest-api'], 'upload', 'flag', { global: true, neg: ['--no-upload-to-artifacts-ingest-api'] }),
];

const P = {
  select: O(['-s', '--select', '-m', '--models', '--model'], 'select', 'multi'),
  rawSelect: O(['-s', '--select'], 'select', 'multi'),
  models: O(['-m', '--models', '--model'], 'models', 'multi'),
  exclude: O(['--exclude'], 'exclude', 'multi'),
  selector: O(['--selector'], 'selector', 'value'),
  resourceType: O(['--resource-types', '--resource-type'], 'resource_types', 'multichoice', { choices: RESOURCE_TYPE_CHOICES }),
  excludeResourceType: O(['--exclude-resource-types', '--exclude-resource-type'], 'exclude_resource_types', 'multichoice', { choices: EXCLUDE_RESOURCE_TYPE_CHOICES }),
  output: O(['--output'], 'output', 'choice', { choices: ['json', 'name', 'path', 'selector'] }),
  outputPath: O(['-o', '--output'], 'output_path', 'value'),
  outputKeys: O(['--output-keys'], 'output_keys', 'multi'),
  profilesDir: O(['--profiles-dir'], 'profiles_dir', 'value'),
  projectDir: O(['--project-dir'], 'project_dir', 'value'),
  targetPath: O(['--target-path'], 'target_path', 'value'),
  threads: O(['--threads'], 'threads', 'value'),
  vars: O(['--vars'], 'vars', 'value'),
  fullRefresh: O(['-f', '--full-refresh'], 'full_refresh', 'flag', { neg: ['--no-full-refresh'] }),
  empty: O(['--empty'], 'empty', 'flag', { neg: ['--no-empty'] }),
  sample: O(['--sample'], 'sample', 'value'),
  eventTimeStart: O(['--event-time-start'], 'event_time_start', 'value'),
  eventTimeEnd: O(['--event-time-end'], 'event_time_end', 'value'),
  storeFailures: O(['--store-failures'], 'store_failures', 'flag'),
  show: O(['--show'], 'show', 'flag'),
  exportSavedQueries: O(['--export-saved-queries'], 'export_saved_queries', 'flag', { neg: ['--no-export-saved-queries'] }),
  includeSavedQuery: O(['--include-saved-query'], 'include_saved_query', 'flag', { neg: ['--no-include-saved-query'] }),
  inline: O(['--inline'], 'inline', 'value'),
  limit: O(['--limit'], 'limit', 'value'),
  introspect: O(['--introspect'], 'introspect', 'flag', { neg: ['--no-introspect'] }),
  showOutputFormat: O(['--output'], 'output', 'choice', { choices: ['json', 'text'] }),
  args: O(['--args'], 'args', 'value'),
  sqlparse: O(['--sqlparse'], 'sqlparse', 'value'),
};

const COMMAND_OPTS: Partial<Record<CommandName, OptDef[]>> = {
  ls: [P.exclude, P.models, P.output, P.outputKeys, P.profilesDir, P.projectDir, P.resourceType, P.excludeResourceType, P.rawSelect, P.selector, P.targetPath, P.vars],
  build: [P.empty, P.eventTimeStart, P.eventTimeEnd, P.exclude, P.exportSavedQueries, P.fullRefresh, P.includeSavedQuery, P.profilesDir, P.projectDir, P.resourceType, P.excludeResourceType, P.sqlparse, P.sample, P.select, P.selector, P.show, P.storeFailures, P.targetPath, P.threads, P.vars],
  run: [P.exclude, P.fullRefresh, P.profilesDir, P.projectDir, P.empty, P.eventTimeStart, P.eventTimeEnd, P.sqlparse, P.sample, P.select, P.selector, P.targetPath, P.threads, P.vars],
  test: [P.exclude, P.resourceType, P.excludeResourceType, P.profilesDir, P.projectDir, P.sqlparse, P.select, P.selector, P.storeFailures, P.targetPath, P.threads, P.vars],
  seed: [P.exclude, P.fullRefresh, P.profilesDir, P.projectDir, P.sqlparse, P.select, P.selector, P.show, P.targetPath, P.threads, P.vars],
  snapshot: [P.empty, P.exclude, P.profilesDir, P.projectDir, P.sqlparse, P.select, P.selector, P.targetPath, P.threads, P.vars],
  compile: [P.exclude, P.fullRefresh, P.showOutputFormat, P.introspect, P.profilesDir, P.projectDir, P.empty, P.select, P.selector, P.inline, P.sqlparse, P.targetPath, P.threads, P.vars],
  show: [P.exclude, P.fullRefresh, P.showOutputFormat, P.limit, P.introspect, P.profilesDir, P.projectDir, P.select, P.selector, P.inline, P.sqlparse, P.targetPath, P.threads, P.vars],
  clone: [P.exclude, P.fullRefresh, P.profilesDir, P.projectDir, P.resourceType, P.excludeResourceType, P.select, P.selector, P.targetPath, P.threads, P.vars],
  'source freshness': [P.exclude, P.outputPath, P.sqlparse, P.profilesDir, P.projectDir, P.select, P.selector, P.targetPath, P.threads, P.vars],
  'docs generate': [P.exclude, P.sqlparse, P.profilesDir, P.projectDir, P.select, P.selector, P.targetPath, P.threads, P.vars],
  parse: [P.profilesDir, P.projectDir, P.targetPath, P.threads, P.vars],
  retry: [P.projectDir, P.profilesDir, P.vars, P.targetPath, P.threads, P.fullRefresh],
  'run-operation': [P.args, P.profilesDir, P.projectDir, P.targetPath, P.threads, P.vars],
  deps: [P.projectDir, P.vars], debug: [P.projectDir, P.vars], clean: [P.profilesDir, P.projectDir, P.targetPath, P.vars],
};

const COMMANDS = ['build', 'clean', 'clone', 'compile', 'debug', 'deps', 'docs', 'init', 'list', 'ls', 'parse', 'retry', 'run', 'run-operation', 'seed', 'show', 'snapshot', 'source', 'test'];

/** click: "Did you mean '--select'?" or "(Did you mean one of: '--select', '--selector'?)" */
function suggest(word: string, possibilities: string[]): string {
  const m = getCloseMatches(word, possibilities).sort();
  if (!m.length) return '';
  const list = m.map((x) => `'${x}'`).join(', ');
  return m.length === 1 ? ` Did you mean ${list}?` : ` (Did you mean one of: ${list}?)`;
}

function noSuchOption(word: string, defs: OptDef[]): DbtError {
  const name = word.split('=')[0];
  const longs = name.startsWith('--') ? [...new Set([...defs.flatMap((d) => [...d.names, ...(d.neg ?? [])]), '--help'].filter((n) => n.startsWith('--')))] : [];
  return usageError(`No such option '${name}'.${longs.length ? suggest(name, longs) : ''}`);
}

function envGet(env: Record<string, string>, name: string): string | undefined {
  // dbt 1.11: DBT_ENGINE_<X> is preferred, the old DBT_<X> still works
  const engine = name.replace(/^DBT_/, 'DBT_ENGINE_');
  return env[engine] ?? env[name];
}

function invalidChoice(opt: OptDef, value: string): DbtError {
  const label = opt.names.filter((n) => n.startsWith('--')).map((n) => `'${n}'`).join(' / ');
  return usageError(`Invalid value for ${label}: '${value}' is not one of ${opt.choices!.map((c) => `'${c}'`).join(', ')}.`);
}

export interface ParseOptions {
  shell?: Shell;
  fs?: VirtualFs | null;
}

/** Parse one command line. Throws DbtError (usage errors, shell errors as kind Usage with a shell hint). */
export function parseCommandLine(line: string, opts: ParseOptions = {}): ParsedCommand {
  const shell = opts.shell ?? 'zsh';
  const raw = line.trim().replace(/^\$\s*/, '');
  const { words: w0, pipe } = shellWords(raw);
  const env: Record<string, string> = {};
  let k = 0;
  while (k < w0.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w0[k].text)) {
    const eq = w0[k].text.indexOf('=');
    env[w0[k].text.slice(0, eq)] = w0[k].text.slice(eq + 1);
    k++;
  }
  // shell globbing of unquoted words
  const words: string[] = [];
  for (const w of w0.slice(k)) {
    if (w.hasGlob && shell !== 'powershell') {
      const m = zshExpand(w.text, opts.fs ?? null);
      if (m && m.length) { words.push(...m); continue; }
      if (shell === 'zsh' && m) throw new DbtError('Shell', `zsh: no matches found: ${w.text}`, 'zsh expanded the * (or ? or [) before dbt started. Put the selection in quotes.');
    }
    words.push(w.text);
  }
  if (words[0] !== 'dbt') throw usageError('Type a dbt command, for example: dbt ls -s +fct_orders');
  const argv = words.slice(1);
  const notices: string[] = [];
  const values: Record<string, unknown> = {};

  // global options before the command
  let i = 0;
  const takeOption = (defs: OptDef[], word: string, rest: string[]): number | null => {
    let name = word;
    let inlineVal: string | null = null;
    if (word.startsWith('--') && word.includes('=')) {
      name = word.slice(0, word.indexOf('='));
      inlineVal = word.slice(word.indexOf('=') + 1);
    }
    for (const d of defs) {
      if (d.neg?.includes(name)) { values[d.key] = false; return 0; }
      if (!d.names.includes(name)) continue;
      if (d.kind === 'flag') { values[d.key] = true; return 0; }
      let used = 0;
      let first: string;
      if (inlineVal !== null) first = inlineVal;
      else {
        if (rest.length === 0) throw new DbtError('UsageShort', `Option '${name}' requires an argument.`);
        first = rest[0];
        used = 1;
      }
      if (d.kind === 'value' || d.kind === 'choice') {
        if (d.kind === 'choice') {
          const v = d.choices!.find((c) => c.toLowerCase() === first.toLowerCase());
          if (!v) throw invalidChoice(d, first);
          values[d.key] = v;
        } else values[d.key] = first;
        return used;
      }
      // MultiOption: split on " ", then eat every following word that does not start with "-"
      const list = first.split(' ');
      while (used < rest.length && !rest[used].startsWith('-')) { list.push(rest[used]); used++; }
      if (d.kind === 'multichoice') {
        for (const v of list) if (!d.choices!.some((c) => c.toLowerCase() === v.toLowerCase())) throw invalidChoice(d, v);
      }
      values[d.key] = [...((values[d.key] as string[]) ?? []), ...list];
      if (d.key === 'models' || (d === P.select && ['-m', '--models', '--model'].includes(name))) values.__models_used = true;
      return used;
    }
    return null;
  };

  while (i < argv.length && argv[i].startsWith('-')) {
    const used = takeOption(GLOBAL, argv[i], argv.slice(i + 1));
    if (used === null) throw new DbtError('UsageTop', noSuchOption(argv[i], GLOBAL).message);
    i += 1 + used;
  }
  if (i >= argv.length) throw usageError('Missing command. Try: dbt ls, dbt build, dbt run, dbt test, dbt seed, dbt snapshot.');
  let cmdWord = argv[i];
  let alias: string | undefined;
  let command: CommandName;
  if (LIST_COMMANDS.has(cmdWord)) { command = 'ls'; if (cmdWord === 'list') alias = 'list'; }
  else if ((cmdWord === 'source' || cmdWord === 'docs') && argv[i + 1]) {
    const two = `${cmdWord} ${argv[i + 1]}`;
    if (two !== 'source freshness' && two !== 'docs generate' && two !== 'docs serve') throw usageError(`No such command '${argv[i + 1]}'.`);
    command = two as CommandName; cmdWord = two; i++;
  } else if (['build', 'run', 'test', 'seed', 'snapshot', 'compile', 'show', 'clone', 'parse', 'retry', 'run-operation', 'deps', 'debug', 'clean', 'init'].includes(cmdWord)) {
    command = cmdWord as CommandName;
  } else {
    throw new DbtError('UsageTop', `No such command '${cmdWord}'.${suggest(cmdWord, COMMANDS)}`);
  }
  i++;
  const cmdOpts = [...(COMMAND_OPTS[command] ?? []), ...GLOBAL];
  try {
    while (i < argv.length) {
      const word = argv[i];
      if (!word.startsWith('-') || word === '-') {
        if (command === 'run-operation' && values.macro === undefined) { values.macro = word; i++; continue; }
        throw usageError(`Got unexpected extra argument (${argv.slice(i).join(' ')})`);
      }
      const used = takeOption(cmdOpts, word, argv.slice(i + 1));
      if (used === null) throw noSuchOption(word, cmdOpts);
      i += 1 + used;
    }
  } catch (e) {
    if (e instanceof DbtError) e.cmd = cmdWord;
    throw e;
  }

  // environment variables (CLI wins)
  const rtEnv = envGet(env, 'DBT_RESOURCE_TYPES');
  const xrtEnv = envGet(env, 'DBT_EXCLUDE_RESOURCE_TYPES');
  const indEnv = envGet(env, 'DBT_INDIRECT_SELECTION');
  const stateEnv = envGet(env, 'DBT_STATE');
  const targetEnv = envGet(env, 'DBT_TARGET');
  const quietEnv = envGet(env, 'DBT_QUIET');
  const optsHere = new Set(cmdOpts.map((d) => d.key));
  let resourceTypes = (values.resource_types as string[]) ?? [];
  let excludeResourceTypes = (values.exclude_resource_types as string[]) ?? [];
  if (!values.resource_types && rtEnv && optsHere.has('resource_types')) resourceTypes = rtEnv.split(/\s+/).filter(Boolean);
  if (!values.exclude_resource_types && xrtEnv && optsHere.has('exclude_resource_types')) excludeResourceTypes = xrtEnv.split(/\s+/).filter(Boolean);
  let indirect = (values.indirect_selection as Indirect) ?? 'eager';
  if (!values.indirect_selection && indEnv) {
    const v = ['eager', 'cautious', 'buildable', 'empty'].find((c) => c === indEnv.toLowerCase());
    if (!v) throw invalidChoice(GLOBAL.find((d) => d.key === 'indirect_selection')!, indEnv);
    indirect = v as Indirect;
  }

  if (values.__models_used) {
    notices.push('[WARNING]: Deprecated functionality', 'Usage of `--models`, `--model`, and `-m` is deprecated in favor of `--select` or', '`-s`.');
  }

  const isLs = command === 'ls';
  const args: DbtArgs = {
    select: (values.select as string[]) ?? null,
    models: isLs ? ((values.models as string[]) ?? null) : null,
    exclude: (values.exclude as string[]) ?? null,
    selector: (values.selector as string) ?? null,
    resourceTypes,
    excludeResourceTypes,
    indirectSelection: indirect,
    output: isLs ? ((values.output as DbtArgs['output']) ?? 'selector') : 'selector',
    outputKeys: (values.output_keys as string[]) ?? [],
    state: (values.state as string) ?? stateEnv ?? null,
    deferState: (values.defer_state as string) ?? null,
    defer: !!values.defer,
    target: (values.target as string) ?? targetEnv ?? null,
    quiet: values.quiet === undefined ? ['1', 'true', 'True'].includes(quietEnv ?? '') : !!values.quiet,
    other: Object.fromEntries(Object.entries(values).filter(([kk]) => !['select', 'models', 'exclude', 'selector', 'resource_types', 'exclude_resource_types', 'indirect_selection', 'output', 'output_keys', 'state', 'defer_state', 'defer', 'target', 'quiet', '__models_used'].includes(kk))) as Record<string, string | boolean>,
  };
  void SELECTION_COMMANDS;
  return { raw, env, argv, command, alias, args, pipe, notices };
}

export function supportsSelection(c: CommandName): boolean {
  return SELECTION_COMMANDS.has(c);
}

/** Build a command line back from structured fields (the form view of the playground). */
export function buildCommandLine(f: {
  command: string; select?: string; exclude?: string; selector?: string; resourceTypes?: string[];
  excludeResourceTypes?: string[]; indirect?: string; output?: string; state?: boolean; target?: string;
}): string {
  const q = (s: string) => (/[\s*?[\]'"|&;$\\]/.test(s) || s === '' ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);
  const parts = ['dbt', f.command];
  if (f.select?.trim()) parts.push('--select', ...f.select.trim().split(/\s+/).map(q));
  if (f.exclude?.trim()) parts.push('--exclude', ...f.exclude.trim().split(/\s+/).map(q));
  if (f.selector?.trim()) parts.push('--selector', q(f.selector.trim()));
  for (const r of f.resourceTypes ?? []) parts.push('--resource-type', r);
  for (const r of f.excludeResourceTypes ?? []) parts.push('--exclude-resource-type', r);
  if (f.indirect && f.indirect !== 'eager') parts.push('--indirect-selection', f.indirect);
  if (f.output && f.output !== 'selector') parts.push('--output', f.output);
  if (f.state) parts.push('--state', 'state');
  if (f.target && f.target !== 'dev') parts.push('--target', f.target);
  return parts.join(' ');
}
