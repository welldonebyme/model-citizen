// The PowerShell forms that the lessons show for Windows (Get-ChildItem, Select-String | ForEach-Object Line,
// Copy-Item a, b dest\, Measure-Object, Set-Content ...), on top of the session's file system.
//
// PowerShell pipes carry objects, this terminal carries lines. The few objects the lessons use travel as tagged
// lines (Select-String matches, Get-ChildItem items, Measure-Object results) and are displayed the way PowerShell
// displays them when they reach the screen or a file (renderLine).
import { globToRegExp } from './shell.ts';
import type { Session } from './session.ts';
import type { Io } from './types.ts';

const MATCH = '';
const MEASURE = '';
const ITEM = '';
const SEP = '';

interface Match { path: string; n: number; line: string; matches: string[] }
interface Item { full: string; rel: string; name: string; dir: boolean; size: number; mtime: number }

const encMatch = (m: Match) => MATCH + [m.path, m.n, m.line, m.matches.join('\u0000')].join(SEP);
function decMatch(l: string): Match | null {
  if (!l.startsWith(MATCH)) return null;
  const [path, n, line, matches] = l.slice(1).split(SEP);
  return { path, n: Number(n), line, matches: matches ? matches.split('\u0000') : [] };
}
const encItem = (it: Item) => ITEM + [it.full, it.rel, it.name, it.dir ? 1 : 0, it.size, it.mtime].join(SEP);
function decItem(l: string): Item | null {
  if (!l.startsWith(ITEM)) return null;
  const [full, rel, name, dir, size, mtime] = l.slice(1).split(SEP);
  return { full, rel, name, dir: dir === '1', size: Number(size), mtime: Number(mtime) };
}

/** How a line of a pipe is shown on the screen or written to a file. */
export function renderLine(l: string): string[] {
  const m = decMatch(l);
  if (m) return [m.path ? `${m.path}:${m.n}:${m.line}` : m.line];
  const it = decItem(l);
  if (it) return [it.rel];
  if (l.startsWith(MEASURE)) {
    const n = l.slice(1);
    return ['', `Count             : ${n}`, 'Average           : ', 'Sum               : ', 'Maximum           : ', 'Minimum           : ', 'Property          : ', ''];
  }
  return [l];
}

/** The text a line stands for (what Sort-Object compares, what ForEach-Object Line returns). */
const textOf = (l: string) => decMatch(l)?.line ?? decItem(l)?.rel ?? (l.startsWith(MEASURE) ? l.slice(1) : l);

export function renderingIo(io: Io): Io {
  return { ...io, out: (l) => renderLine(l).forEach((x) => io.out(x)) };
}

/** PowerShell lists: "a, b" and "a,b" are two items. */
function list(args: string[]): string[] {
  return args.flatMap((a) => a.split(',')).map((a) => a.trim()).filter(Boolean);
}

/** -Name value pairs and switches (case-insensitive), the rest positional. */
function opts(args: string[], valued: string[]) {
  const named: Record<string, string> = {};
  const flags = new Set<string>();
  const pos: string[] = [];
  const v = new Set(valued.map((x) => x.toLowerCase()));
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^-[A-Za-z]+$/.test(a)) {
      const k = a.slice(1).toLowerCase();
      if (v.has(k)) named[k] = args[++i] ?? '';
      else flags.add(k);
    } else pos.push(a);
  }
  return { named, flags, pos };
}

function lines(stdin: string | undefined): string[] {
  if (stdin == null) return [];
  const l = stdin.split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
function psDate(ms: number) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${String(d.getMonth() + 1).padStart(2)}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} ${String(h).padStart(2)}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export class PowerShell {
  private s: Session;
  constructor(session: Session) { this.s = session; }

  /** Runs a PowerShell cmdlet. Returns null when `name` is not one of those handled here. */
  async run(name: string, args: string[], io: Io, stdin: string | undefined, piped: boolean): Promise<number | null> {
    switch (name) {
      case 'get-childitem': case 'gci': case 'dir': return this.childItems(args, io, piped);
      case 'get-content': case 'gc': case 'type': return this.content(args, io, stdin);
      case 'select-string': case 'sls': return this.selectString(args, io, stdin);
      case 'select-object': return this.selectObject(args, io, stdin);
      case 'sort-object': case 'sort': return this.sortObject(args, io, stdin, name);
      case 'foreach-object': case '%': return this.forEach(args, io, stdin);
      case 'measure-object': return this.measure(io, stdin);
      case 'set-content': case 'add-content': case 'out-file': return this.setContent(name, args, io, stdin);
      case 'where-object': case '?': case 'convertfrom-json': case 'convertto-json':
        io.note({ tone: 'warn', text: `${name} is not available in this browser terminal (PowerShell objects are not supported here). On your computer it works as the lesson shows.` });
        return 1;
      case 'get-help': case 'get-command':
        io.note({ text: `${name} runs on your computer. This terminal has a short list of commands: type help.` });
        return 1;
      default: return null;
    }
  }

  private childItems(args: string[], io: Io, piped: boolean): number {
    const o = opts(args, ['filter', 'path', 'depth']);
    const names = o.flags.has('name');
    const recurse = o.flags.has('recurse') || o.flags.has('r');
    const all = o.flags.has('force') || o.flags.has('hidden');
    const onlyFiles = o.flags.has('file');
    const onlyDirs = o.flags.has('directory');
    const filter = o.named.filter ? globToRegExp(o.named.filter) : null;
    const targets = this.s.glob(list([...(o.named.path ? [o.named.path] : []), ...o.pos]));
    if (!targets.length) targets.push('.');
    let code = 0;
    const tables: { dir: string; items: Item[] }[] = [];
    const flat: Item[] = [];
    for (const t of targets) {
      const abs = this.s.checkPath(t, io, 'Get-ChildItem');
      if (!abs) { code = 1; continue; }
      if (!this.s.exists(abs)) { io.err(`Get-ChildItem: Cannot find path '${t}' because it does not exist.`); code = 1; continue; }
      if (!this.s.isDir(abs)) {
        const st = this.s.fs.stat(abs);
        const it = { full: abs, rel: abs.split('/').pop()!, name: abs.split('/').pop()!, dir: false, size: st.size, mtime: +st.mtime };
        flat.push(it);
        tables.push({ dir: abs.slice(0, abs.lastIndexOf('/')), items: [it] });
        continue;
      }
      const walk = (dir: string, rel: string) => {
        const here: Item[] = [];
        const subdirs: [string, string][] = [];
        for (const n of this.s.readdir(dir)) {
          if (!all && n.startsWith('.')) continue;
          const full = dir + '/' + n;
          const st = this.s.fs.stat(full);
          const isDir = this.s.fs.isDir(st.mode);
          const r = rel ? `${rel}/${n}` : n;
          const it = { full, rel: r, name: n, dir: isDir, size: isDir ? 0 : st.size, mtime: +st.mtime };
          const keep = (!filter || filter.test(n)) && (!onlyFiles || !isDir) && (!onlyDirs || isDir);
          if (keep) { here.push(it); flat.push(it); }
          if (isDir && recurse) subdirs.push([full, r]);
        }
        tables.push({ dir, items: here });
        for (const [f, r] of subdirs) walk(f, r);
      };
      walk(abs, '');
    }
    if (names || piped) {
      for (const it of flat) io.out(piped && !names ? encItem(it) : it.rel);
      return code;
    }
    for (const t of tables) {
      if (!t.items.length) continue;
      io.out('');
      io.out(`    Directory: ${t.dir}`);
      io.out('');
      io.out('Mode                 LastWriteTime         Length Name');
      io.out('----                 -------------         ------ ----');
      for (const it of t.items) io.out(`${it.dir ? 'd----' : '-a---'}         ${psDate(it.mtime).padStart(20)} ${pad(it.dir ? '' : it.size, 14)} ${it.name}`);
    }
    if (tables.some((t) => t.items.length)) io.out('');
    return code;
  }

  private content(args: string[], io: Io, stdin: string | undefined): number {
    const o = opts(args, ['totalcount', 'head', 'first', 'tail', 'last', 'path', 'encoding']);
    const files = this.s.glob(list([...(o.named.path ? [o.named.path] : []), ...o.pos]));
    if (!files.length) {
      if (stdin != null) { lines(stdin).forEach((l) => io.out(l)); return 0; }
      io.err('Get-Content: give a file name, for example: Get-Content dbt_project.yml');
      return 1;
    }
    const head = Number(o.named.totalcount ?? o.named.head ?? o.named.first ?? NaN);
    const tail = Number(o.named.tail ?? o.named.last ?? NaN);
    let code = 0;
    for (const f of files) {
      const abs = this.s.checkPath(f, io, 'Get-Content');
      if (!abs) { code = 1; continue; }
      if (!this.s.exists(abs) || this.s.isDir(abs)) { io.err(`Get-Content: Cannot find path '${f}' because it does not exist.`); code = 1; continue; }
      if (!this.s.isText(abs)) { io.note({ tone: 'warn', text: `${f} is not a text file, so it is not shown.` }); continue; }
      let l = this.s.readText(abs).split('\n');
      if (l[l.length - 1] === '') l.pop();
      if (!Number.isNaN(head)) l = l.slice(0, head);
      if (!Number.isNaN(tail)) l = l.slice(Math.max(0, l.length - tail));
      l.forEach((x) => io.out(x));
    }
    return code;
  }

  private selectString(args: string[], io: Io, stdin: string | undefined): number {
    const o = opts(args, ['pattern', 'path', 'context', 'encoding']);
    if (o.named.context !== undefined) {
      io.note({ tone: 'warn', text: 'Select-String -Context is not available in this browser terminal. Use grep -n, or open the file in the Files tab.' });
      return 1;
    }
    const pattern = o.named.pattern ?? o.pos.shift();
    if (pattern == null) { io.err('Select-String: give a pattern, for example: Select-String "Binder Error" logs\\dbt.log'); return 1; }
    const flags = o.flags.has('casesensitive') ? 'g' : 'gi';
    let re: RegExp;
    try {
      re = o.flags.has('simplematch') ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags) : new RegExp(pattern, flags);
    } catch {
      io.err(`Select-String: the pattern is not valid: ${pattern}`);
      return 1;
    }
    const not = o.flags.has('notmatch');
    const paths = this.s.glob(list([...(o.named.path ? [o.named.path] : []), ...o.pos]));
    const sources: { path: string; lines: string[] }[] = [];
    if (!paths.length) sources.push({ path: '', lines: lines(stdin).map(textOf) });
    for (const p of paths) {
      const abs = this.s.checkPath(p, io, 'Select-String');
      if (!abs) return 1;
      if (!this.s.exists(abs) || this.s.isDir(abs)) { io.err(`Select-String: Cannot find path '${p}' because it does not exist.`); return 1; }
      const l = this.s.readText(abs).split('\n');
      if (l[l.length - 1] === '') l.pop();
      sources.push({ path: p.replace(/\//g, '\\'), lines: l });
    }
    let hits = 0;
    for (const src of sources) {
      src.lines.forEach((line, i) => {
        const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
        re.lastIndex = 0;
        const found = [...plain.matchAll(re)].map((m) => m[0]);
        if ((found.length > 0) === not) return;
        hits++;
        io.out(encMatch({ path: src.path, n: i + 1, line: plain, matches: o.flags.has('allmatches') ? found : found.slice(0, 1) }));
      });
    }
    return hits ? 0 : 1;
  }

  private selectObject(args: string[], io: Io, stdin: string | undefined): number {
    const o = opts(args, ['first', 'last', 'skip', 'skiplast', 'expandproperty', 'property', 'index']);
    if (o.named.expandproperty !== undefined || o.named.property !== undefined || o.pos.length) {
      io.note({ tone: 'warn', text: 'Select-Object works here with -First, -Last and -Skip only.' });
      return 1;
    }
    let l = lines(stdin);
    if (o.named.skip) l = l.slice(Number(o.named.skip));
    if (o.named.skiplast) l = l.slice(0, Math.max(0, l.length - Number(o.named.skiplast)));
    if (o.named.first) l = l.slice(0, Number(o.named.first));
    if (o.named.last) l = l.slice(Math.max(0, l.length - Number(o.named.last)));
    l.forEach((x) => io.out(x));
    return 0;
  }

  private sortObject(args: string[], io: Io, stdin: string | undefined, name: string): number {
    const o = opts(args, ['property']);
    let l = lines(stdin);
    l.sort((a, b) => {
      const x = textOf(a).toLowerCase();
      const y = textOf(b).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    if (o.flags.has('descending')) l.reverse();
    if (o.flags.has('unique')) l = l.filter((x, i) => i === 0 || textOf(x).toLowerCase() !== textOf(l[i - 1]).toLowerCase());
    void name;
    l.forEach((x) => io.out(x));
    return 0;
  }

  private forEach(args: string[], io: Io, stdin: string | undefined): number {
    const raw = args.join(' ');
    const what = args.length === 1 ? args[0].toLowerCase() : null;
    const block = raw.trim().startsWith('{');
    const out = (f: (l: string) => string | string[] | null) => {
      for (const l of lines(stdin)) {
        const v = f(l);
        if (v == null) continue;
        (Array.isArray(v) ? v : [v]).forEach((x) => io.out(x));
      }
      return 0;
    };
    if (what === 'line') return out((l) => decMatch(l)?.line ?? textOf(l));
    if (what === 'linenumber') return out((l) => String(decMatch(l)?.n ?? ''));
    if (what === 'count') return out((l) => (l.startsWith(MEASURE) ? l.slice(1) : null));
    if (what === 'fullname') return out((l) => decItem(l)?.full ?? textOf(l));
    if (what === 'name') return out((l) => decItem(l)?.name ?? textOf(l));
    // the two script blocks of the lessons: { "$($_.LineNumber):$($_.Line)" } and { $_.Matches.Value }
    if (block && /LineNumber/.test(raw) && /\.Line\b/.test(raw.replace(/LineNumber/g, ''))) return out((l) => { const m = decMatch(l); return m ? `${m.n}:${m.line}` : textOf(l); });
    if (block && /Matches\.Value/.test(raw)) return out((l) => decMatch(l)?.matches ?? null);
    io.note({ tone: 'warn', text: 'This ForEach-Object form is not available in this browser terminal. Here it works with Line, LineNumber, Count, Name and FullName.' });
    return 1;
  }

  private measure(io: Io, stdin: string | undefined): number {
    io.out(MEASURE + lines(stdin).length);
    return 0;
  }

  private setContent(name: string, args: string[], io: Io, stdin: string | undefined): number {
    const o = opts(args, ['path', 'value', 'filepath', 'encoding']);
    const path = o.named.path ?? o.named.filepath ?? o.pos.shift();
    if (!path) { io.err(`${name}: give a file name`); return 1; }
    const abs = this.s.checkPath(path, io, name);
    if (!abs) return 1;
    const value = o.named.value ?? (o.pos.length ? o.pos.join(' ') : null);
    const text = value != null ? [value] : lines(stdin).flatMap(renderLine);
    const body = text.join('\n') + '\n';
    const append = name === 'add-content' || o.flags.has('append');
    const before = append && this.s.exists(abs) ? this.s.readText(abs) : '';
    this.s.write(abs, before && !before.endsWith('\n') ? before + '\n' + body : before + body);
    return 0;
  }
}
