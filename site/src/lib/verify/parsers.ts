// Paste-to-verify: parse terminal output that the learner copies from their own computer, and compare it
// with the book's expected output. Tolerant of timestamps, thread order, colours, Windows line endings,
// PowerShell or zsh prompts, and extra blank lines. Pure functions, no backend.

export type OutputKind = 'dbt_summary' | 'dbt_version' | 'dbt_ls' | 'file_list' | 'git_status' | 'git_status_short' | 'git_log_oneline' | 'table' | 'unknown';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const TS = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s{1,2}/;

export function clean(text: string): string[] {
  return text.replace(ANSI, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
}
const stripTs = (l: string) => l.replace(TS, '');

/* ---------- dbt run / build / test / seed / snapshot summary ---------- */
export interface DbtSummary {
  pass: number; warn: number; error: number; skip: number; no_op: number; total: number;
  completed: string | null; finished: string | null;
  nodes: { status: string; name: string }[];
}

export function parseDbtSummary(text: string): DbtSummary | null {
  const lines = clean(text).map(stripTs);
  let done: RegExpMatchArray | null = null;
  for (const l of lines) {
    const m = l.match(/Done\.\s+PASS=(\d+)\s+WARN=(\d+)\s+ERROR=(\d+)\s+SKIP=(\d+)(?:\s+NO-OP=(\d+))?\s+TOTAL=(\d+)/);
    if (m) done = m;
  }
  if (!done) return null;
  const completed = lines.find((l) => /^Completed (successfully|with \d+ )/.test(l.trim()))?.trim() ?? null;
  const finished = lines.find((l) => /^Finished running /.test(l.trim()))?.trim() ?? null;
  const nodes: DbtSummary['nodes'] = [];
  for (const l of lines) {
    // "12 of 27 OK created sql view model dbt_adnane.stg_x ..... [OK in 0.03s]" / "PASS not_null_x" / "ERROR creating ..."
    const m = l.match(/^\s*\d+ of \d+ (OK|PASS|WARN|ERROR|FAIL|SKIP|NO-OP)\b(?: \d+)?\s+(?:created |creating |loaded |snapshotted |relation )?(.*?)\s*\.{2,}.*\[/);
    if (m) nodes.push({ status: m[1], name: m[2].replace(/^(sql|python)\s+/, '').trim() });
  }
  return {
    pass: +done[1], warn: +done[2], error: +done[3], skip: +done[4], no_op: done[5] ? +done[5] : 0, total: +done[6],
    completed, finished, nodes,
  };
}

/* ---------- dbt --version ---------- */
export interface DbtVersion { core_installed: string | null; core_latest: string | null; plugins: Record<string, string> }
export function parseDbtVersion(text: string): DbtVersion | null {
  const lines = clean(text);
  const inst = lines.map((l) => l.match(/installed:\s*([\d.]+\S*)/)).find(Boolean);
  if (!inst) return null;
  const latest = lines.map((l) => l.match(/latest:\s*([\d.]+\S*)/)).find(Boolean);
  const plugins: Record<string, string> = {};
  let inPlugins = false;
  for (const l of lines) {
    if (/^Plugins:/.test(l.trim())) { inPlugins = true; continue; }
    const m = inPlugins && l.match(/^\s*-\s*([A-Za-z0-9_-]+):\s*([\d.]+\S*)/);
    if (m) plugins[m[1]] = m[2];
  }
  return { core_installed: inst[1], core_latest: latest?.[1] ?? null, plugins };
}

/* ---------- dbt ls (default output) ---------- */
export function parseDbtLs(text: string): string[] {
  return clean(text).map(stripTs).map((l) => l.trim())
    .filter((l) => l && !/^(Running with dbt|Registered adapter|Found \d|Unable to do partial|Concurrency|\$ |PS |>)/.test(l))
    .filter((l) => /^[A-Za-z0-9_:.\-]+$/.test(l) || /^(source|exposure|metric|semantic_model|saved_query|unit_test):/.test(l))
    .sort();
}

/* ---------- file listings: find | sort (macOS, WSL), Get-ChildItem -Recurse -Name | Sort-Object (PowerShell) ---------- */
// One path per line, with / or \. The book prints the macOS form ("jaffle_dbt", "jaffle_dbt/.gitignore", ...);
// PowerShell prints the same files relative to the folder ("analyses\.gitkeep"), sorted another way. So paths
// are compared as sets, with / for \, without "./", and without the folder the listing starts from.
const PROMPT_LINE = /^\s*(?:\([^)]*\)\s*)?(?:\$|%|>|PS\b[^>]*>)\s/;
const PATH_LINE = /^[\w.@+~-]+(?:[\\/][\w.@+~-]+)*[\\/]?$/;

/** The paths of a file listing, or null when the text is not one (a line that is not a path, or no folder at all). */
export function parseFileList(text: string): string[] | null {
  const lines = clean(text).map((l) => l.trim()).filter((l) => l && !PROMPT_LINE.test(l));
  if (!lines.length || !lines.every((l) => PATH_LINE.test(l)) || !lines.some((l) => /[\\/]./.test(l))) return null;
  return lines.map((l) => l.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '')).filter((l) => l && l !== '.');
}

/** The folder a listing starts from: find prints it on its own line ("jaffle_dbt"), then every path below it. */
function listRoot(paths: string[]): string | null {
  const root = paths.find((p) => !p.includes('/'));
  return root && paths.every((p) => p === root || p.startsWith(`${root}/`)) && paths.length > 1 ? root : null;
}
const underRoot = (paths: string[], root: string | null) =>
  root && paths.every((p) => p === root || p.startsWith(`${root}/`)) ? paths.filter((p) => p !== root).map((p) => p.slice(root.length + 1)) : paths;

/* ---------- git ---------- */
export interface GitStatus { branch: string | null; clean: boolean; sections: string[]; files: { state: string | null; path: string }[] }
export function parseGitStatus(text: string): GitStatus | null {
  const lines = clean(text);
  if (!lines.some((l) => /^On branch |^HEAD detached|nothing to commit|Changes |Untracked files/.test(l))) return null;
  const branch = lines.map((l) => l.match(/^On branch (\S+)/)).find(Boolean)?.[1] ?? null;
  const clean_ = lines.some((l) => /nothing to commit, working tree clean/.test(l));
  const sections: string[] = [];
  const files: GitStatus['files'] = [];
  let section = '';
  for (const l of lines) {
    const s = l.match(/^(Changes to be committed|Changes not staged for commit|Untracked files|Unmerged paths):/);
    if (s) { section = s[1]; sections.push(section); continue; }
    if (!section || !/^\t/.test(l)) continue;
    const m = l.trim().match(/^(new file|modified|deleted|renamed|both modified|typechange):\s+(.*)$/);
    files.push(m ? { state: m[1], path: m[2] } : { state: null, path: l.trim() });
  }
  return { branch, clean: clean_, sections, files };
}

export function parseGitStatusShort(text: string): { files: { xy: string; path: string }[]; clean: boolean } {
  const files = clean(text).map((l) => l.match(/^([ MADRCU?!]{2}) (.+)$/)).filter(Boolean).map((m) => ({ xy: m![1], path: m![2] }));
  return { files, clean: files.length === 0 };
}

export function parseGitLogOneline(text: string): { commits: { graph: string | null; hash: string; refs: string[]; subject: string }[]; graph: boolean } {
  const commits = [];
  let graph = false;
  for (const l of clean(text)) {
    const m = l.match(/^([*|\\/ ]*?)\s*([0-9a-f]{7,40})\s+(?:\(([^)]*)\)\s+)?(.*)$/);
    if (!m) continue;
    const g = m[1].trim() || null;
    if (g) graph = true;
    commits.push({ graph: g, hash: m[2], refs: m[3] ? m[3].split(',').map((x) => x.trim()) : [], subject: m[4] });
  }
  return { commits, graph };
}

/* ---------- result tables (DuckDB box format and dbt show) ---------- */
export interface Table { columns: string[]; rows: string[][] }
export function parseTable(text: string): Table | null {
  const lines = clean(text).map(stripTs).filter((l) => /^\s*[|│┃]/.test(l));
  if (lines.length < 2) return null;
  const cells = (l: string) => l.trim().replace(/^[|│┃]|[|│┃]$/g, '').split(/[|│┃]/).map((c) => c.trim());
  const [head, ...body] = lines.filter((l) => !/^\s*[|│┃]\s*[-─━]+/.test(l) && !/^\s*[|│┃](\s*[-─:]+\s*[|│┃])+\s*$/.test(l));
  const columns = cells(head);
  // DuckDB CLI prints a type row under the header (varchar, int32...) in its box format
  const rows = body.map(cells).filter((r) => !(r.every((c) => /^(varchar|int\d*|integer|bigint|double|decimal\(.*\)|date|timestamp.*|boolean|int128|uint\d*|float|hugeint)$/i.test(c) || c === '')));
  return { columns, rows };
}

export function detect(text: string): OutputKind {
  const t = clean(text).join('\n');
  if (/Done\.\s+PASS=\d+/.test(t)) return 'dbt_summary';
  if (/installed:\s*\d/.test(t) && /Core:/.test(t)) return 'dbt_version';
  if (/^On branch |nothing to commit|Untracked files:|Changes (not staged|to be committed)/m.test(t)) return 'git_status';
  if (/^[ MADRCU?!]{2} \S/m.test(t) && t.split('\n').every((l) => !l.trim() || /^[ MADRCU?!]{2} \S/.test(l))) return 'git_status_short';
  if (/^[*|\\/ ]*[0-9a-f]{7,40} \S/m.test(t) && t.split('\n').every((l) => !l.trim() || /^[*|\\/ ]*[0-9a-f]{7,40}( |$)|^[|\\/ ]+$/.test(l))) return 'git_log_oneline';
  if (parseTable(t)) return 'table';
  if (parseFileList(t)) return 'file_list';
  if (parseDbtLs(t).length && t.split('\n').filter((l) => l.trim()).length === parseDbtLs(t).length) return 'dbt_ls';
  return 'unknown';
}

/* ---------- comparison in plain English ---------- */
export interface Verdict { ok: boolean; kind: OutputKind; messages: string[] }

const norm = (v: string) => v.trim().replace(/^"(.*)"$/, '$1').replace(/^(-?\d+)\.0+$/, '$1').toLowerCase();

export function compareOutput(expectedText: string, actualText: string): Verdict {
  const kind = detect(expectedText);
  const msgs: string[] = [];
  const actualKind = detect(actualText);
  if (!actualText.trim()) return { ok: false, kind, messages: ['Paste the output of the command first.'] };
  switch (kind) {
    case 'dbt_summary': {
      const e = parseDbtSummary(expectedText)!;
      const a = parseDbtSummary(actualText);
      if (!a) return { ok: false, kind, messages: ['The pasted text has no "Done. PASS=… TOTAL=…" line. Copy everything from "Running with dbt" to the last line.'] };
      for (const k of ['pass', 'warn', 'error', 'skip', 'no_op', 'total'] as const) {
        if (e[k] !== a[k]) msgs.push(`${k.toUpperCase().replace('_', '-')}: the book has ${e[k]}, you have ${a[k]}.`);
      }
      const bad = a.nodes.filter((n) => n.status === 'ERROR' || n.status === 'FAIL').map((n) => n.name);
      const expBad = new Set(e.nodes.filter((n) => n.status === 'ERROR' || n.status === 'FAIL').map((n) => n.name));
      for (const b of bad) if (!expBad.has(b)) msgs.push(`${b} failed on your computer but not in the book. Read its error message above the summary.`);
      return { ok: msgs.length === 0, kind, messages: msgs.length ? msgs : [`Same result as the book: PASS=${a.pass} WARN=${a.warn} ERROR=${a.error} SKIP=${a.skip} TOTAL=${a.total}.`] };
    }
    case 'dbt_version': {
      const e = parseDbtVersion(expectedText)!;
      const a = parseDbtVersion(actualText);
      if (!a) return { ok: false, kind, messages: ['The pasted text has no "installed:" line. Run dbt --version and copy all its output.'] };
      const minor = (v: string | null) => (v ?? '').split('.').slice(0, 2).join('.');
      if (minor(a.core_installed) !== minor(e.core_installed)) msgs.push(`dbt Core ${a.core_installed} is installed; the course needs ${minor(e.core_installed)}.x (the exam version). Reinstall with dbt-core~=${minor(e.core_installed)}.0.`);
      for (const [p, v] of Object.entries(e.plugins)) {
        if (!a.plugins[p]) msgs.push(`The ${p} plugin is missing. Install dbt-${p} ${minor(v)}.x.`);
        else if (minor(a.plugins[p]) !== minor(v)) msgs.push(`The ${p} plugin is ${a.plugins[p]}; the course uses ${minor(v)}.x.`);
      }
      return { ok: msgs.length === 0, kind, messages: msgs.length ? msgs : [`dbt Core ${a.core_installed} with ${Object.entries(a.plugins).map(([k, v]) => `${k} ${v}`).join(', ')}: good.`] };
    }
    case 'dbt_ls': case 'unknown': {
      const e = new Set(parseDbtLs(expectedText));
      const a = new Set(parseDbtLs(actualText));
      if (!e.size) return { ok: actualKind !== 'unknown', kind, messages: ['This output cannot be checked automatically. Compare it with the book by eye.'] };
      const missing = [...e].filter((x) => !a.has(x));
      const extra = [...a].filter((x) => !e.has(x));
      if (missing.length) msgs.push(`Missing compared with the book: ${missing.join(', ')}.`);
      if (extra.length) msgs.push(`Not in the book: ${extra.join(', ')}.`);
      return { ok: !msgs.length, kind: 'dbt_ls', messages: msgs.length ? msgs : [`Same ${a.size} nodes as the book.`] };
    }
    case 'file_list': {
      const exp = parseFileList(expectedText)!;
      const got = parseFileList(actualText);
      if (!got) return { ok: false, kind, messages: ['The pasted text is not a plain list of files. Run the command exactly as shown (on Windows with -Name) and paste only what it printed.'] };
      const root = listRoot(exp);
      const e = new Set(underRoot(exp, root));
      const a = new Set(underRoot(got, root));
      const missing = [...e].filter((x) => !a.has(x));
      const extra = [...a].filter((x) => !e.has(x));
      if (missing.length) msgs.push(`Missing compared with the book: ${missing.join(', ')}.`);
      if (extra.length) msgs.push(`Not in the book: ${extra.join(', ')}.`);
      return { ok: !msgs.length, kind, messages: msgs.length ? msgs : [`Same ${e.size} files and folders as the book${root ? ` in ${root}` : ''}. The order and the \\ or / between folders do not matter.`] };
    }
    case 'table': {
      const e = parseTable(expectedText)!;
      const a = parseTable(actualText);
      if (!a) return { ok: false, kind, messages: ['The pasted text has no result table. Copy the table with its borders.'] };
      if (e.columns.map(norm).join('|') !== a.columns.map(norm).join('|')) msgs.push(`Columns: the book has ${e.columns.join(', ')}; you have ${a.columns.join(', ')}.`);
      const key = (r: string[]) => r.map(norm).join('\u0001');
      const ea = e.rows.map(key).sort(), aa = a.rows.map(key).sort();
      if (ea.length !== aa.length) msgs.push(`Rows: the book has ${ea.length}, you have ${aa.length}.`);
      else if (ea.some((r, i) => r !== aa[i])) msgs.push('Some values differ from the book. Check your filters and your data (did you apply day2.sql?).');
      return { ok: !msgs.length, kind, messages: msgs.length ? msgs : [`Same table as the book: ${a.columns.length} columns, ${a.rows.length} rows.`] };
    }
    case 'git_status': case 'git_status_short': {
      const ef = (kind === 'git_status' ? parseGitStatus(expectedText)?.files.map((f) => f.path) : parseGitStatusShort(expectedText).files.map((f) => f.path)) ?? [];
      const af = (actualKind === 'git_status' ? parseGitStatus(actualText)?.files.map((f) => f.path) : parseGitStatusShort(actualText).files.map((f) => f.path)) ?? [];
      const missing = ef.filter((p) => !af.includes(p)), extra = af.filter((p) => !ef.includes(p));
      if (missing.length) msgs.push(`Files the book shows but you do not: ${missing.join(', ')}.`);
      if (extra.length) msgs.push(`Files you have but the book does not: ${extra.join(', ')}.`);
      return { ok: !msgs.length, kind, messages: msgs.length ? msgs : ['Same files as the book.'] };
    }
    case 'git_log_oneline': {
      const e = parseGitLogOneline(expectedText).commits.map((c) => c.subject);
      const a = parseGitLogOneline(actualText).commits.map((c) => c.subject);
      if (a.length < e.length) msgs.push(`The book shows ${e.length} commits, you have ${a.length}.`);
      const missing = e.filter((s) => !a.includes(s));
      if (missing.length) msgs.push(`Commit messages not found: ${missing.map((s) => `"${s}"`).join(', ')}. Your messages can differ; the number of commits matters more.`);
      return { ok: a.length >= e.length, kind, messages: msgs.length ? msgs : ['Your history matches the book.'] };
    }
  }
}
