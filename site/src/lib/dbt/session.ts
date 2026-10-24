// The terminal session: a small shell around real dbt and the duckdb module, on Pyodide's virtual file system.
// No browser API here, so the same code runs in the Web Worker and in Node (preset checks, golden tests).
import { globToRegExp, parseLine, parsePowerShellEnv, quoteWord, splitList, type Pipeline, type SimpleCommand } from './shell.ts';
import type { Bundle, ExecContext, FileEntry, Io, Preset, ProjectInfo } from './types.ts';

/** The part of Emscripten's FS used here (Pyodide exposes it as pyodide.FS). */
export interface EmFS {
  analyzePath(path: string): { exists: boolean };
  stat(path: string): { mode: number; size: number; mtime: Date | number };
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  readdir(path: string): string[];
  readFile(path: string, opts?: { encoding?: 'utf8' | 'binary' }): Uint8Array | string;
  writeFile(path: string, data: string | Uint8Array): void;
  mkdir(path: string): void;
  mkdirTree(path: string): void;
  rmdir(path: string): void;
  unlink(path: string): void;
  rename(from: string, to: string): void;
  utime?(path: string, atime: number, mtime: number): void;
  chdir?(path: string): void;
  cwd?(): string;
}

/** Calls into Python (src/lib/dbt/runtime/mc_dbt.py). Output arrives through Session.pyOut / pyErr. */
export interface PyBridge {
  runDbt(argv: string[], env: Record<string, string>, cwd: string): number;
  duckdb(db: string, script: string, cwd: string, width: number, bail: boolean, readOnly: boolean): number;
  /** Load pandas + numpy (Python models). Resolves at once if already loaded. */
  ensurePandas(io: Io): Promise<void>;
}

export interface SessionOptions {
  fs: EmFS;
  py: PyBridge;
  home?: string;
  /** Fetch a preset bundle (path relative to presets/dbt/). */
  loadBundle: (rel: string) => Promise<Bundle>;
}

const KEEP_ON_CHECKOUT = new Set(['target', 'logs', 'dbt_packages', 'prod-artifacts', 'ci_db']);
const DBT_COMMANDS = new Set(['build', 'clean', 'clone', 'compile', 'debug', 'deps', 'docs', 'init', 'list', 'ls', 'parse',
  'retry', 'run', 'run-operation', 'seed', 'show', 'snapshot', 'source', 'test', 'environment', 'sl', 'invocation']);
const ON_MACHINE = new Set(['python', 'python3', 'pip', 'pip3', 'uv', 'brew', 'winget', 'code', 'source', 'sudo', 'apt',
  'apt-get', 'curl', 'wget', 'ssh', 'npm', 'node', 'docker', 'gh', 'zsh', 'bash', 'pwsh', 'powershell', 'vim', 'nano', 'nvim']);
const FILTERS = new Set(['grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'cat', 'select-string']);
const ANSI = /\x1b\[[0-9;]*m/g;

export function decodeBundleFile(v: string | { b64: string }): string | Uint8Array {
  if (typeof v === 'string') return v;
  const bin = atob(v.b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function pad(s: string, n: number, right = false) {
  return right ? s.padStart(n) : s.padEnd(n);
}

/** Capture lines written to an Io (pipes, redirections). */
function capture(base: Io, opts: { merge?: boolean } = {}) {
  const lines: string[] = [];
  const errs: string[] = [];
  const io: Io = {
    out: (l) => lines.push(l),
    err: (l) => (opts.merge ? lines.push(l) : errs.push(l)),
    note: (n) => base.note(n),
    cmd: base.cmd,
    clear: base.clear,
  };
  return { io, lines, errs };
}

export class Session {
  readonly fs: EmFS;
  readonly py: PyBridge;
  readonly home: string;
  readonly course: string;
  cwd: string;
  lastExit = 0;
  /** exported environment variables (export X=1, $env:X = "1") */
  env: Record<string, string> = {};
  /** shell-only variables (X=1 without export): dbt does not see them, like in a real shell */
  vars: Record<string, string> = {};
  project: ProjectInfo | null = null;
  private oldCwd: string | null = null;
  private sink: Io | null = null;
  private loadBundle: SessionOptions['loadBundle'];

  constructor(opts: SessionOptions) {
    this.fs = opts.fs;
    this.py = opts.py;
    this.home = opts.home ?? '/home/pyodide';
    this.course = this.home + '/dbt-course';
    this.cwd = this.course;
    this.loadBundle = opts.loadBundle;
  }

  // ---- output from Python (Pyodide stdout/stderr callbacks call these) ----------------------------------------
  pyOut(line: string) { this.sink ? this.sink.out(line) : undefined; }
  pyErr(line: string) { this.sink ? this.sink.err(line) : undefined; }

  // ---- paths and files -----------------------------------------------------------------------------------------
  resolve(p: string, from = this.cwd): string {
    if (p === '~') return this.home;
    if (p.startsWith('~/')) p = this.home + p.slice(1);
    return normalize(p.startsWith('/') ? p : from + '/' + p);
  }
  tilde(abs: string): string {
    return abs === this.home ? '~' : abs.startsWith(this.home + '/') ? '~' + abs.slice(this.home.length) : abs;
  }
  inHome(abs: string): boolean {
    return abs === this.home || abs.startsWith(this.home + '/');
  }
  exists(p: string): boolean {
    try { return this.fs.analyzePath(p).exists; } catch { return false; }
  }
  isDir(p: string): boolean {
    try { return this.fs.isDir(this.fs.stat(p).mode); } catch { return false; }
  }
  readdir(p: string): string[] {
    return this.fs.readdir(p).filter((n) => n !== '.' && n !== '..').sort();
  }
  readText(p: string): string {
    return this.fs.readFile(p, { encoding: 'utf8' }) as string;
  }
  readBytes(p: string): Uint8Array {
    return this.fs.readFile(p) as Uint8Array;
  }
  write(p: string, data: string | Uint8Array) {
    const dir = p.slice(0, p.lastIndexOf('/')) || '/';
    if (!this.exists(dir)) this.fs.mkdirTree(dir);
    this.fs.writeFile(p, data);
  }
  rmrf(p: string) {
    if (!this.exists(p)) return;
    // the process may still be "in" that folder (Python's os.chdir): leave it first, or rmdir fails (EBUSY)
    const pcwd = this.fs.cwd?.();
    if (pcwd && (pcwd === p || pcwd.startsWith(p + '/'))) this.fs.chdir?.(this.home);
    if (this.isDir(p)) {
      for (const n of this.readdir(p)) this.rmrf(p + '/' + n);
      this.fs.rmdir(p);
    } else this.fs.unlink(p);
  }
  copy(src: string, dst: string) {
    if (this.isDir(src)) {
      if (!this.exists(dst)) this.fs.mkdirTree(dst);
      for (const n of this.readdir(src)) this.copy(src + '/' + n, dst + '/' + n);
    } else this.write(dst, this.readBytes(src));
  }
  isText(p: string): boolean {
    try {
      const b = this.readBytes(p);
      if (b.length > 2_000_000) return false;
      new TextDecoder('utf-8', { fatal: true }).decode(b);
      return !b.subarray(0, 8000).includes(0);
    } catch {
      return false;
    }
  }
  list(dir: string): FileEntry[] {
    const abs = this.resolve(dir);
    return this.readdir(abs).map((name) => {
      const path = abs + '/' + name;
      const st = this.fs.stat(path);
      return { name, path, dir: this.fs.isDir(st.mode), size: st.size, mtime: +st.mtime };
    });
  }
  /** Directory of the dbt project that contains `from` (like dbt: the nearest dbt_project.yml upwards). */
  projectDir(from = this.cwd): string | null {
    let d = from;
    while (this.inHome(d)) {
      if (this.exists(d + '/dbt_project.yml')) return d;
      if (d === this.home) break;
      d = d.slice(0, d.lastIndexOf('/')) || '/';
    }
    return null;
  }

  async writeBundle(rel: string, dest: string) {
    const b = await this.loadBundle(rel);
    for (const [p, v] of Object.entries(b.files)) this.write(dest + '/' + p, decodeBundleFile(v));
    return b;
  }

  // ---- presets ---------------------------------------------------------------------------------------------------
  /** Replace the whole workspace by a preset: files, profile, then the preparation steps (real commands). */
  async applyPreset(preset: Preset, project: ProjectInfo, io: Io, ctx: ExecContext,
    onStep?: (i: number, n: number, label: string) => void): Promise<{ ok: boolean; failed?: string }> {
    this.project = project;
    this.rmrf(this.course);
    this.rmrf(this.home + '/.dbt');
    this.fs.mkdirTree(this.course + '/' + project.practiceDir);
    await this.writeBundle(project.practiceBundle, this.course + '/' + project.practiceDir);
    this.write(this.home + '/.dbt/profiles.yml', project.profiles[preset.profile] ?? '');
    this.cwd = this.course;
    this.env = {};
    this.vars = {};
    this.lastExit = 0;
    const n = preset.steps.length;
    for (let i = 0; i < n; i++) {
      const step = preset.steps[i];
      if ('checkout' in step) {
        const label = `git checkout ${step.checkout}`;
        onStep?.(i + 1, n, label);
        io.cmd?.(label + '   (files of the reference project at this tag)');
        const dir = this.course + '/' + project.dir;
        if (this.exists(dir)) for (const name of this.readdir(dir)) if (!KEEP_ON_CHECKOUT.has(name)) this.rmrf(dir + '/' + name);
        this.fs.mkdirTree(dir);
        await this.writeBundle(step.bundle, dir);
        continue;
      }
      onStep?.(i + 1, n, step.run);
      io.cmd?.(step.run);
      const code = await this.exec(step.run, io, ctx);
      if (code !== 0) return { ok: false, failed: step.run };
    }
    this.cwd = this.resolve(preset.cwd);
    this.lastExit = 0;
    return { ok: true };
  }

  // ---- the shell -------------------------------------------------------------------------------------------------
  private lookup(name: string): string | undefined {
    if (name === '?' || name === 'LASTEXITCODE') return String(this.lastExit);
    if (name === 'HOME') return this.home;
    if (name === 'PWD') return this.cwd;
    return this.env[name] ?? this.vars[name];
  }

  /** Run one line typed by the learner. Returns the exit code ($?). */
  async exec(line: string, io: Io, ctx: ExecContext): Promise<number> {
    const list = splitList(line);
    if (!list.ok) {
      io.err(list.error);
      return (this.lastExit = 2);
    }
    let code = this.lastExit;
    for (const item of list.items) {
      if (item.op === '&&' && code !== 0) continue;
      if (item.op === '||' && code === 0) continue;
      code = await this.execOne(item.text, io, ctx);
      this.lastExit = code;
    }
    return code;
  }

  /** One part of a list: variables are expanded now (after the previous parts ran). */
  private async execOne(text: string, io: Io, ctx: ExecContext): Promise<number> {
    const ps = parsePowerShellEnv(text);
    if (ps) {
      this.env[ps.name] = ps.value;
      return 0;
    }
    const parsed = parseLine(text, { home: this.home, vars: (n) => this.lookup(n) });
    if (!parsed.ok) {
      io.err(parsed.error);
      return 2;
    }
    let code = 0;
    for (const item of parsed.items) code = await this.runPipeline(item.pipeline, io, ctx);
    return code;
  }

  private async runPipeline(p: Pipeline, io: Io, ctx: ExecContext): Promise<number> {
    if (p.cmds.length === 1) return this.runSimple(p.cmds[0], io, ctx, undefined);
    let input: string | undefined;
    let code = 0;
    for (let i = 0; i < p.cmds.length; i++) {
      const c = p.cmds[i];
      const last = i === p.cmds.length - 1;
      if (i > 0 && !FILTERS.has((c.argv[0] ?? '').toLowerCase())) {
        io.err(`${c.argv[0]}: only grep, head, tail, sort, uniq and wc can come after | in this terminal.`);
        return 1;
      }
      if (last) {
        code = await this.runSimple(c, io, ctx, input);
      } else {
        const cap = capture(io, { merge: false });
        code = await this.runSimple(c, cap.io, ctx, input);
        for (const e of cap.errs) io.err(e);
        input = cap.lines.join('\n') + (cap.lines.length ? '\n' : '');
      }
    }
    return code;
  }

  private async runSimple(c: SimpleCommand, io: Io, ctx: ExecContext, stdin: string | undefined): Promise<number> {
    // variable assignments alone: shell variables (not exported, as in bash)
    if (c.argv.length === 0) {
      for (const [k, v] of c.assigns) this.vars[k] = v;
      return 0;
    }
    // redirections
    let outFile: { path: string; append: boolean } | null = null;
    let errFile: { path: string; append: boolean } | null = null;
    let merge = false;
    for (const r of c.redirects) {
      if (r.kind === 'in') {
        const abs = this.resolve(r.path);
        if (!this.inHome(abs) || !this.exists(abs) || this.isDir(abs)) {
          io.err(`${r.path}: No such file`);
          return 1;
        }
        stdin = this.readText(abs);
      } else if (r.kind === 'merge') merge = true;
      else if (r.fd === 1) outFile = { path: r.path, append: r.append };
      else errFile = { path: r.path, append: r.append };
    }
    if (!outFile && !errFile && !merge) return this.runCommand(c, io, ctx, stdin);
    const cap = capture(io, { merge });
    const code = await this.runCommand(c, cap.io, ctx, stdin);
    const flushTo = (f: { path: string; append: boolean } | null, lines: string[], fallback: (l: string) => void) => {
      if (!f) { lines.forEach(fallback); return; }
      if (f.path === '/dev/null' || f.path.toLowerCase() === '$null') return;
      const abs = this.resolve(f.path);
      if (!this.inHome(abs)) { io.err(`${f.path}: Permission denied`); return; }
      const text = lines.join('\n') + (lines.length ? '\n' : '');
      this.write(abs, f.append && this.exists(abs) ? this.readText(abs) + text : text);
    };
    flushTo(outFile, cap.lines, io.out);
    flushTo(errFile, cap.errs, io.err);
    return code;
  }

  private async runCommand(c: SimpleCommand, io: Io, ctx: ExecContext, stdin: string | undefined): Promise<number> {
    const [name0, ...args] = c.argv;
    const name = name0.toLowerCase();
    const onceEnv = Object.fromEntries(c.assigns);
    try {
      switch (name) {
        case 'dbt': return await this.dbt(args, { ...this.env, ...onceEnv }, io, ctx);
        case 'duckdb': return this.duckdb(args, io, ctx, stdin);
        case 'apply': return this.apply(args, io, ctx);
        case 'cd': case 'set-location': case 'chdir': return this.cd(args, io);
        case 'pwd': case 'get-location': io.out(this.cwd); return 0;
        case 'ls': case 'dir': case 'get-childitem': case 'gci': return this.ls(args, io, name !== 'ls');
        case 'cat': case 'type': case 'get-content': case 'gc': return this.cat(args, io, stdin, name.startsWith('get') || name === 'gc');
        case 'head': return this.headTail(args, io, stdin, 'head');
        case 'tail': return this.headTail(args, io, stdin, 'tail');
        case 'grep': case 'select-string': return this.grep(args, io, stdin, name === 'select-string');
        case 'wc': return this.wc(args, io, stdin);
        case 'sort': return this.sortUniq(args, io, stdin, 'sort');
        case 'uniq': return this.sortUniq(args, io, stdin, 'uniq');
        case 'sed': return this.sed(args, io);
        case 'find': return this.find(args, io);
        case 'echo': case 'write-output': case 'write-host': return this.echo(args, io);
        case 'export': return this.exportCmd(args, io);
        case 'unset': for (const a of args) { delete this.env[a]; delete this.vars[a]; } return 0;
        case 'env': case 'printenv': return this.printEnv(args, io);
        case 'mkdir': case 'md': return this.mkdir(args, io);
        case 'new-item': return this.newItem(args, io);
        case 'rm': case 'remove-item': case 'del': case 'rmdir': return this.rm(args, io, name !== 'rm' && name !== 'rmdir');
        case 'cp': case 'copy-item': case 'copy': return this.cp(args, io, name !== 'cp');
        case 'mv': case 'move-item': case 'move': return this.mv(args, io);
        case 'touch': return this.touch(args, io);
        case 'open': case 'start': case 'invoke-item': return this.open(args, io);
        case 'clear': case 'cls': case 'clear-host': io.clear?.(); return 0;
        case 'true': return 0;
        case 'false': return 1;
        case 'exit': io.note({ text: 'This terminal stays open. Use Stop or Reset if you want to start again.' }); return 0;
        case 'help': return this.help(io);
        case 'git': return this.git(io, ctx);
        default:
          if (ON_MACHINE.has(name) || name.includes('/') || name.includes('\\')) {
            io.note({ tone: 'warn', text: `${name0} runs on your computer, not in this browser terminal (a web page cannot start programs). dbt is already installed here: dbt-core 1.11.16 with dbt-duckdb 1.11.0.` });
            return 127;
          }
          io.err(`${name0}: command not found. Type help to see the commands of this terminal.`);
          return 127;
      }
    } catch (e) {
      io.err(`${name0}: ${(e as Error)?.message ?? String(e)}`);
      return 1;
    }
  }

  // ---- dbt -----------------------------------------------------------------------------------------------------------
  private subcommand(args: string[]): string | null {
    for (const a of args) if (DBT_COMMANDS.has(a)) return a;
    return null;
  }

  private hasPythonModels(proj: string): boolean {
    const walk = (d: string, depth: number): boolean => {
      if (depth > 8 || !this.exists(d)) return false;
      for (const n of this.readdir(d)) {
        const p = d + '/' + n;
        if (this.isDir(p)) { if (walk(p, depth + 1)) return true; } else if (n.endsWith('.py')) return true;
      }
      return false;
    };
    return walk(proj + '/models', 0);
  }

  private async dbt(args: string[], env: Record<string, string>, io: Io, ctx: ExecContext): Promise<number> {
    const sub = this.subcommand(args);
    const proj = this.projectDir();
    if (sub === 'deps' && proj) {
      const r = await this.depsFromBundle(proj, io);
      if (r !== null) return r;
    }
    if (sub === 'docs' && args.includes('serve')) {
      io.note({ tone: 'warn', text: 'dbt docs serve starts a small web server on your computer. A web page cannot do that.' });
      io.note({ text: 'Here, run dbt docs generate --static, then open target/static_index.html (one file with the whole documentation site).' });
      return 1;
    }
    if (sub === 'init' && !args.includes('--skip-profile-setup')) {
      io.note({ tone: 'warn', text: 'dbt init asks questions about your profile, and this terminal cannot answer them. Add --skip-profile-setup: the profile is already in ~/.dbt/profiles.yml.' });
      io.note({ text: 'Example: dbt init jaffle_dbt --skip-profile-setup' });
      return 1;
    }
    if (proj && sub && sub !== 'clean' && sub !== 'deps' && sub !== 'init' && this.hasPythonModels(proj)) {
      await this.py.ensurePandas(io);
    }
    let sawGitError = false;
    const sniff: Io = {
      ...io,
      out: (l) => { if (!sawGitError && sub === 'debug' && /- git \[.*ERROR/.test(l.replace(ANSI, ''))) sawGitError = true; io.out(l); },
    };
    const prev = this.sink;
    this.sink = sniff;
    let code: number;
    try {
      code = this.py.runDbt(args, env, this.cwd);
    } finally {
      this.sink = prev;
    }
    if (args.includes('--version') || args.includes('-v') || args[0] === 'version') {
      io.note({ tone: 'info', text: 'dbt --version cannot ask pypi.org for newer versions from a web page, so it prints "could not be determined". The installed versions above are the real ones.' });
    }
    if (sawGitError) {
      io.note({ tone: 'info', text: 'About "git [ERROR]": a web page cannot start programs, so dbt debug cannot find git here. On your computer git is installed (Chapter 3) and this check passes. The other checks are real.' });
    }
    return code;
  }

  /** dbt deps cannot reach hub.getdbt.com or GitHub from a web page (no CORS): install the saved copy instead. */
  private async depsFromBundle(proj: string, io: Io): Promise<number | null> {
    const file = ['packages.yml', 'dependencies.yml'].map((f) => proj + '/' + f).find((f) => this.exists(f));
    if (!file) return null; // nothing to install: real dbt deps (no network needed)
    const text = this.readText(file);
    const wanted = [...text.matchAll(/^\s*-?\s*package:\s*["']?([\w.-]+\/[\w.-]+)["']?/gm)].map((m) => m[1]);
    const gitOrTarball = /^\s*-?\s*(git|tarball|private):/m.test(text);
    if (!wanted.length && !gitOrTarball) return null; // only local packages: real dbt deps works offline
    const project = this.project;
    const installDir = (this.readText(proj + '/dbt_project.yml').match(/^packages-install-path:\s*["']?([^"'\n#]+)/m)?.[1] ?? 'dbt_packages').trim();
    io.note({ tone: 'info', text: 'dbt deps downloads packages from hub.getdbt.com and GitHub. A web page is not allowed to reach them, so this terminal installs a saved copy of the packages instead (the exact files dbt deps installs).' });
    if (!project) {
      io.note({ tone: 'error', text: 'No saved packages for this workspace.' });
      return 1;
    }
    const bundle = await this.loadBundle(project.packagesBundle);
    const available = new Map((bundle.packages ?? project.packages).map((p) => [p.package.toLowerCase(), p]));
    let missing = 0;
    const target = this.resolve(installDir, proj);
    for (const w of wanted) {
      const p = available.get(w.toLowerCase());
      if (!p) {
        io.note({ tone: 'error', text: `  ${w}: not available in this browser terminal (only ${[...available.keys()].join(', ')}).` });
        missing++;
        continue;
      }
      this.rmrf(target + '/' + p.name);
      const prefix = p.name + '/';
      for (const [path, v] of Object.entries(bundle.files)) if (path.startsWith(prefix)) this.write(target + '/' + path, decodeBundleFile(v));
      io.note({ tone: 'ok', text: `  Installed ${p.package} ${p.version} into ${installDir}/${p.name}` });
    }
    if (gitOrTarball) {
      io.note({ tone: 'error', text: '  git and tarball packages cannot be installed here.' });
      missing++;
    }
    io.note({ text: 'On your computer, dbt deps prints its own messages (Installing dbt-labs/dbt_utils, Installed from version ...) and writes package-lock.yml.' });
    return missing ? 1 : 0;
  }

  // ---- duckdb ----------------------------------------------------------------------------------------------------
  private duckdb(args: string[], io: Io, ctx: ExecContext, stdin: string | undefined): number {
    const sql: string[] = [];
    const pos: string[] = [];
    let readOnly = false;
    let bail = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-c' || a === '-cmd' || a === '--cmd') { if (args[i + 1] == null) { io.err('duckdb: -c needs SQL'); return 1; } sql.push(args[++i]); }
      else if (a === '-readonly' || a === '--readonly') readOnly = true;
      else if (a === '-bail') bail = true;
      else if (a === '-version' || a === '--version') { return this.duckdbScript(':memory:', 'select version() as version', io, ctx, true, false); }
      else if (a.startsWith('-')) { io.err(`duckdb: the option ${a} is not available in this browser terminal (use -c "<sql>" or < file.sql).`); return 1; }
      else pos.push(a);
    }
    const db = pos[0];
    if (pos.length > 1) sql.push(pos.slice(1).join(' '));
    if (!db) {
      io.note({ tone: 'warn', text: 'Give the database file, for example: duckdb ../practice/practice.duckdb -c "select count(*) from jaffle_shop.orders"' });
      return 1;
    }
    if (!sql.length && stdin == null) {
      io.note({ tone: 'warn', text: 'The interactive DuckDB shell is not available in this browser terminal. Run one query with -c, or a file with <:' });
      io.note({ text: `  duckdb ${db} -c "select count(*) from jaffle_shop.orders"` });
      io.note({ text: `  duckdb ${db} < file.sql` });
      return 1;
    }
    const abs = this.resolve(db);
    if (!this.inHome(abs)) { io.err(`duckdb: ${db}: Permission denied`); return 1; }
    const existed = this.exists(abs);
    const script = sql.length ? sql.join(';\n') : (stdin as string);
    const code = this.duckdbScript(abs, script, io, ctx, sql.length ? true : bail, readOnly);
    const practiceDb = this.course + '/' + (this.project?.practiceDir ?? 'practice') + '/' + (this.project?.database ?? 'practice.duckdb');
    if (!existed && this.exists(abs) && abs !== practiceDb) {
      io.note({ tone: 'warn', text: `duckdb created a new, empty database file ${this.tilde(abs)} (it did not exist). The practice database is ~/dbt-course/practice/practice.duckdb.` });
    }
    return code;
  }

  private duckdbScript(db: string, script: string, io: Io, ctx: ExecContext, bail: boolean, readOnly: boolean): number {
    const prev = this.sink;
    this.sink = io;
    try {
      return this.py.duckdb(db, script, this.cwd, Math.max(40, ctx.cols || 100), bail, readOnly);
    } finally {
      this.sink = prev;
    }
  }

  private apply(args: string[], io: Io, ctx: ExecContext): number {
    const what = (args[0] ?? '').replace(/\.sql$/, '').toLowerCase();
    const map: Record<string, string> = { day2: 'updates/day2.sql', fresh_load: 'updates/fresh_load.sql', fresh: 'updates/fresh_load.sql', setup: 'setup.sql', day1: 'setup.sql' };
    const file = map[what];
    if (!file) {
      io.err('Usage: apply day2 | apply fresh_load | apply setup   (runs a script of the practice kit on the practice database)');
      return 2;
    }
    const practice = this.course + '/' + (this.project?.practiceDir ?? 'practice');
    const db = this.project?.database ?? 'practice.duckdb';
    if (!this.exists(practice + '/' + file)) { io.err(`apply: ${file} not found in ~/dbt-course/practice`); return 1; }
    io.note({ text: `Same as: cd ~/dbt-course/practice && duckdb ${db} < ${file}` });
    const saved = this.cwd;
    this.cwd = practice;
    try {
      return this.duckdbScript(practice + '/' + db, this.readText(practice + '/' + file), io, ctx, false, false);
    } finally {
      this.cwd = saved;
    }
  }

  // ---- files -----------------------------------------------------------------------------------------------------------
  private checkPath(arg: string, io: Io, cmd: string): string | null {
    const abs = this.resolve(arg);
    if (!this.inHome(abs)) {
      io.err(`${cmd}: ${arg}: this terminal only works with the files in your home folder (~).`);
      return null;
    }
    return abs;
  }

  /** Expand * and ? in the last path segment of each argument (like the shell does). */
  private glob(args: string[]): string[] {
    const out: string[] = [];
    for (const a of args) {
      if (!/[*?]/.test(a)) { out.push(a); continue; }
      const i = a.lastIndexOf('/');
      const dirPart = i >= 0 ? a.slice(0, i) : '.';
      const re = globToRegExp(i >= 0 ? a.slice(i + 1) : a);
      const dirAbs = this.resolve(dirPart);
      if (/[*?]/.test(dirPart) || !this.isDir(dirAbs)) { out.push(a); continue; }
      const hits = this.readdir(dirAbs).filter((n) => re.test(n) && !n.startsWith('.'));
      if (!hits.length) out.push(a);
      for (const h of hits) out.push(i >= 0 ? `${a.slice(0, i)}/${h}` : h);
    }
    return out;
  }

  private cd(args: string[], io: Io): number {
    let target = args.filter((a) => a !== '-Path')[0] ?? '~';
    if (target === '-') {
      if (!this.oldCwd) { io.err('cd: no previous folder'); return 1; }
      target = this.oldCwd;
      io.out(this.tilde(target));
    }
    const abs = this.resolve(target);
    if (!this.inHome(abs)) { io.err(`cd: ${target}: this terminal only works in your home folder (~).`); return 1; }
    if (!this.exists(abs)) { io.err(`cd: no such file or directory: ${target}`); return 1; }
    if (!this.isDir(abs)) { io.err(`cd: not a directory: ${target}`); return 1; }
    this.oldCwd = this.cwd;
    this.cwd = abs;
    return 0;
  }

  private ls(args: string[], io: Io, powershell: boolean): number {
    let all = false;
    let long = false;
    const paths: string[] = [];
    for (const a of args) {
      if (powershell && /^-(force|hidden)$/i.test(a)) all = true;
      else if (powershell && /^-(recurse|name|file|directory)$/i.test(a)) continue;
      else if (/^-[alhAFG1R]+$/.test(a)) { all ||= /a|A/.test(a); long ||= a.includes('l'); }
      else if (a.startsWith('-')) { io.err(`ls: the option ${a} is not available here (use -a, -l or -la)`); return 1; }
      else paths.push(a);
    }
    const targets = this.glob(paths.length ? paths : ['.']);
    let code = 0;
    const files: string[] = [];
    const dirs: string[] = [];
    for (const t of targets) {
      const abs = this.checkPath(t, io, 'ls');
      if (!abs) { code = 1; continue; }
      if (!this.exists(abs)) { io.err(`ls: ${t}: No such file or directory`); code = 1; continue; }
      (this.isDir(abs) ? dirs : files).push(t);
    }
    const line = (abs: string, name: string) => {
      if (!long) return name;
      const st = this.fs.stat(abs);
      const d = new Date(+st.mtime);
      const mon = d.toLocaleString('en-US', { month: 'short' });
      const when = `${mon} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const kind = this.fs.isDir(st.mode) ? 'drwxr-xr-x' : '-rw-r--r--';
      return `${kind}  ${pad(String(st.size), 9, true)} ${when} ${name}`;
    };
    for (const f of files) io.out(line(this.resolve(f), f));
    dirs.forEach((d, i) => {
      const abs = this.resolve(d);
      if (targets.length > 1) { if (files.length || i > 0) io.out(''); io.out(d + ':'); }
      const names = this.readdir(abs).filter((n) => all || !n.startsWith('.'));
      if (long) io.out(`total ${names.length}`);
      for (const n of all ? ['.', '..', ...names] : names) io.out(line(n === '.' ? abs : n === '..' ? this.resolve('..', abs) : abs + '/' + n, n));
    });
    return code;
  }

  private cat(args: string[], io: Io, stdin: string | undefined, powershell: boolean): number {
    let count: number | null = null;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (powershell && /^-(totalcount|head|first)$/i.test(args[i])) { count = Number(args[++i]); continue; }
      if (powershell && /^-path$/i.test(args[i])) continue;
      if (/^-[nbsvetu]+$/.test(args[i]) && !powershell) continue;
      files.push(args[i]);
    }
    if (!files.length) {
      if (stdin != null) { this.emitText(stdin, io); return 0; }
      io.err('cat: give a file name, for example: cat dbt_project.yml');
      return 1;
    }
    let code = 0;
    for (const f of this.glob(files)) {
      const abs = this.checkPath(f, io, 'cat');
      if (!abs) { code = 1; continue; }
      if (!this.exists(abs)) { io.err(`cat: ${f}: No such file or directory`); code = 1; continue; }
      if (this.isDir(abs)) { io.err(`cat: ${f}: Is a directory`); code = 1; continue; }
      if (!this.isText(abs)) { io.note({ tone: 'warn', text: `${f} is not a text file (${this.fs.stat(abs).size} bytes), so it is not shown.` }); continue; }
      let text = this.readText(abs);
      if (count != null) text = text.split('\n').slice(0, count).join('\n') + '\n';
      this.emitText(text, io);
    }
    return code;
  }

  private emitText(text: string, io: Io) {
    const lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const MAX = 5000;
    lines.slice(0, MAX).forEach((l) => io.out(l));
    if (lines.length > MAX) io.note({ tone: 'warn', text: `${lines.length - MAX} more lines not shown. Open the file in the editor, or use head and tail.` });
  }

  private inputLines(files: string[], io: Io, stdin: string | undefined, cmd: string): string[] | null {
    if (!files.length) {
      if (stdin == null) { io.err(`${cmd}: give a file name (or use it after |)`); return null; }
      const l = stdin.split('\n');
      if (l[l.length - 1] === '') l.pop();
      return l;
    }
    const out: string[] = [];
    for (const f of this.glob(files)) {
      const abs = this.checkPath(f, io, cmd);
      if (!abs) return null;
      if (!this.exists(abs) || this.isDir(abs)) { io.err(`${cmd}: ${f}: No such file`); return null; }
      const l = this.readText(abs).split('\n');
      if (l[l.length - 1] === '') l.pop();
      out.push(...l);
    }
    return out;
  }

  private headTail(args: string[], io: Io, stdin: string | undefined, which: 'head' | 'tail'): number {
    let n = 10;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-n') n = Number(args[++i]);
      else if (/^-n\d+$/.test(a)) n = Number(a.slice(2));
      else if (/^-\d+$/.test(a)) n = Number(a.slice(1));
      else if (/^\+\d+$/.test(a) && which === 'tail') n = -Number(a.slice(1));
      else files.push(a);
    }
    const lines = this.inputLines(files, io, stdin, which);
    if (!lines) return 1;
    const sel = which === 'head' ? lines.slice(0, n) : n < 0 ? lines.slice(-n - 1) : lines.slice(Math.max(0, lines.length - n));
    sel.forEach((l) => io.out(l));
    return 0;
  }

  private grep(args: string[], io: Io, stdin: string | undefined, powershell: boolean): number {
    let invert = false, icase = powershell, num = false, count = false, only = false;
    let pattern: string | null = null;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (powershell && /^-pattern$/i.test(a)) { pattern = args[++i]; continue; }
      if (powershell && /^-path$/i.test(a)) { files.push(args[++i]); continue; }
      if (powershell && /^-casesensitive$/i.test(a)) { icase = false; continue; }
      if (!powershell && /^-[vinEcoFw]+$/.test(a)) {
        invert ||= a.includes('v'); icase ||= a.includes('i'); num ||= a.includes('n'); count ||= a.includes('c'); only ||= a.includes('o');
        continue;
      }
      if (a === '-e') { pattern = args[++i]; continue; }
      if (pattern == null) pattern = a;
      else files.push(a);
    }
    if (pattern == null) { io.err('grep: give a pattern, for example: grep -n "Binder Error" logs/dbt.log'); return 2; }
    let re: RegExp;
    try {
      // basic and extended regular expressions: \| and \( \) mean | and ( ) in grep's basic syntax
      re = new RegExp(pattern.replace(/\\\|/g, '|').replace(/\\([()])/g, '$1'), icase ? 'gi' : 'g');
    } catch {
      io.err(`grep: invalid pattern: ${pattern}`);
      return 2;
    }
    const lines = this.inputLines(files, io, stdin, 'grep');
    if (!lines) return 2;
    let hits = 0;
    lines.forEach((l, i) => {
      const plain = l.replace(ANSI, '');
      re.lastIndex = 0;
      const match = re.test(plain);
      if (match === invert) return;
      hits++;
      if (count) return;
      if (only && !invert) {
        re.lastIndex = 0;
        for (const m of plain.matchAll(re)) io.out((num ? `${i + 1}:` : '') + m[0]);
        return;
      }
      io.out((num ? `${i + 1}:` : '') + l);
    });
    if (count) io.out(String(hits));
    return hits ? 0 : 1;
  }

  private wc(args: string[], io: Io, stdin: string | undefined): number {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const files = args.filter((a) => !a.startsWith('-'));
    const lines = this.inputLines(files, io, stdin, 'wc');
    if (!lines) return 1;
    const text = lines.join('\n') + (lines.length ? '\n' : '');
    const n = lines.length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const bytes = new TextEncoder().encode(text).length;
    const name = files.length === 1 ? ' ' + files[0] : '';
    if (flags.includes('l')) io.out(`${pad(String(n), 8, true)}${name}`);
    else if (flags.includes('w')) io.out(`${pad(String(words), 8, true)}${name}`);
    else if (flags.includes('c')) io.out(`${pad(String(bytes), 8, true)}${name}`);
    else io.out(`${pad(String(n), 8, true)}${pad(String(words), 8, true)}${pad(String(bytes), 8, true)}${name}`);
    return 0;
  }

  private sortUniq(args: string[], io: Io, stdin: string | undefined, which: 'sort' | 'uniq'): number {
    const rev = args.includes('-r');
    const uniqueFlag = args.includes('-u');
    const countFlag = args.includes('-c');
    const files = args.filter((a) => !a.startsWith('-'));
    const lines = this.inputLines(files, io, stdin, which);
    if (!lines) return 1;
    if (which === 'sort') {
      let out = [...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (rev) out.reverse();
      if (uniqueFlag) out = out.filter((l, i) => i === 0 || l !== out[i - 1]);
      out.forEach((l) => io.out(l));
      return 0;
    }
    let prev: string | null = null;
    let n = 0;
    const flush = () => { if (prev !== null) io.out(countFlag ? `${pad(String(n), 7, true)} ${prev}` : prev); };
    for (const l of lines) {
      if (l === prev) { n++; continue; }
      flush();
      prev = l;
      n = 1;
    }
    flush();
    return 0;
  }

  private sed(args: string[], io: Io): number {
    const quiet = args[0] === '-n';
    const rest = quiet ? args.slice(1) : args;
    const m = quiet && rest[0]?.match(/^(\d+)(?:,(\d+|\$))?p$/);
    if (!m || rest.length < 2) {
      io.err("sed: only the form sed -n 'FIRST,LASTp' FILE (print some lines) is available here.");
      return 1;
    }
    const lines = this.inputLines(rest.slice(1), io, undefined, 'sed');
    if (!lines) return 1;
    const a = Number(m[1]);
    const b = m[2] === '$' ? lines.length : m[2] ? Number(m[2]) : a;
    lines.slice(a - 1, b).forEach((l) => io.out(l));
    return 0;
  }

  private find(args: string[], io: Io): number {
    const roots: string[] = [];
    let type: string | null = null;
    let nameRe: RegExp | null = null;
    let maxDepth = Infinity;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-type') type = args[++i];
      else if (a === '-name') nameRe = globToRegExp(args[++i] ?? '*');
      else if (a === '-maxdepth') maxDepth = Number(args[++i]);
      else if (a.startsWith('-')) { io.err(`find: ${a} is not available here (use -type, -name, -maxdepth)`); return 1; }
      else roots.push(a);
    }
    if (!roots.length) roots.push('.');
    let code = 0;
    for (const r of roots) {
      const abs = this.checkPath(r, io, 'find');
      if (!abs || !this.exists(abs)) { io.err(`find: ${r}: No such file or directory`); code = 1; continue; }
      const walk = (p: string, shown: string, depth: number) => {
        const dir = this.isDir(p);
        const name = shown.split('/').pop() ?? shown;
        if ((!type || (type === 'd') === dir) && (!nameRe || nameRe.test(name))) io.out(shown);
        if (dir && depth < maxDepth) for (const n of this.readdir(p)) walk(p + '/' + n, shown + '/' + n, depth + 1);
      };
      walk(abs, r.replace(/\/+$/, '') || r, 0);
    }
    return code;
  }

  private echo(args: string[], io: Io): number {
    const noNewline = args[0] === '-n';
    io.out((noNewline ? args.slice(1) : args).join(' '));
    return 0;
  }

  private exportCmd(args: string[], io: Io): number {
    if (!args.length) { this.printEnv([], io); return 0; }
    for (const a of args) {
      const m = a.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
      if (m) { this.env[m[1]] = m[2]; delete this.vars[m[1]]; }
      else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) { if (a in this.vars) { this.env[a] = this.vars[a]; delete this.vars[a]; } }
      else { io.err(`export: not a valid name: ${a}`); return 1; }
    }
    return 0;
  }

  private printEnv(args: string[], io: Io): number {
    const all: Record<string, string> = { HOME: this.home, ...this.env };
    if (args.length) { for (const a of args) if (all[a] != null) io.out(all[a]); return 0; }
    for (const k of Object.keys(all).sort()) io.out(`${k}=${all[k]}`);
    return 0;
  }

  private mkdir(args: string[], io: Io): number {
    const parents = args.includes('-p');
    let code = 0;
    for (const d of args.filter((a) => !a.startsWith('-'))) {
      const abs = this.checkPath(d, io, 'mkdir');
      if (!abs) { code = 1; continue; }
      if (this.exists(abs)) { if (!parents) { io.err(`mkdir: ${d}: File exists`); code = 1; } continue; }
      const parent = abs.slice(0, abs.lastIndexOf('/'));
      if (!parents && !this.exists(parent)) { io.err(`mkdir: ${d}: No such file or directory`); code = 1; continue; }
      this.fs.mkdirTree(abs);
    }
    return code;
  }

  private newItem(args: string[], io: Io): number {
    const lower = args.map((a) => a.toLowerCase());
    const t = lower.indexOf('-itemtype');
    const kind = t >= 0 ? lower[t + 1] : 'file';
    const skip = new Set<number>([t, t + 1]);
    const names = args.filter((a, i) => !skip.has(i) && !a.startsWith('-'));
    if (kind === 'directory') return this.mkdir(['-p', ...names], io);
    return this.touch(names, io);
  }

  private rm(args: string[], io: Io, powershell: boolean): number {
    const flags = args.filter((a) => a.startsWith('-')).join('').toLowerCase();
    const recursive = powershell ? /recurse/.test(flags) : /r/.test(flags);
    const force = powershell ? /force/.test(flags) : /f/.test(flags);
    let code = 0;
    const targets = this.glob(args.filter((a) => !a.startsWith('-')));
    for (const t of targets) {
      if (/^env:/i.test(t)) { delete this.env[t.slice(4)]; continue; } // PowerShell: Remove-Item Env:NAME
      const abs = this.checkPath(t, io, 'rm');
      if (!abs) { code = 1; continue; }
      if (abs === this.home || abs === this.course) { io.err(`rm: ${t}: this folder cannot be deleted here (use Reset to start again).`); code = 1; continue; }
      if (!this.exists(abs)) { if (!force) { io.err(`rm: ${t}: No such file or directory`); code = 1; } continue; }
      if (this.isDir(abs) && !recursive && !powershell) { io.err(`rm: ${t}: is a directory (use rm -r)`); code = 1; continue; }
      if (this.cwd === abs || this.cwd.startsWith(abs + '/')) this.cwd = abs.slice(0, abs.lastIndexOf('/'));
      this.rmrf(abs);
    }
    return code;
  }

  private cp(args: string[], io: Io, powershell: boolean): number {
    const flags = args.filter((a) => a.startsWith('-')).join('').toLowerCase();
    const recursive = powershell ? /recurse/.test(flags) : /r/i.test(flags);
    const paths = this.glob(args.filter((a) => !a.startsWith('-')));
    if (paths.length < 2) { io.err('cp: give a source and a destination'); return 1; }
    const dest = this.checkPath(paths[paths.length - 1], io, 'cp');
    if (!dest) return 1;
    const srcs = paths.slice(0, -1);
    const destIsDir = this.isDir(dest);
    if (srcs.length > 1 && !destIsDir) { io.err(`cp: ${paths[paths.length - 1]} is not a directory`); return 1; }
    let code = 0;
    for (const s of srcs) {
      const abs = this.checkPath(s, io, 'cp');
      if (!abs) { code = 1; continue; }
      if (!this.exists(abs)) { io.err(`cp: ${s}: No such file or directory`); code = 1; continue; }
      if (this.isDir(abs) && !recursive) { io.err(`cp: ${s} is a directory (not copied, use cp -r)`); code = 1; continue; }
      const to = destIsDir ? dest + '/' + abs.split('/').pop() : dest;
      this.copy(abs, to);
    }
    return code;
  }

  private mv(args: string[], io: Io): number {
    const paths = args.filter((a) => !a.startsWith('-'));
    if (paths.length !== 2) { io.err('mv: give a source and a destination'); return 1; }
    const src = this.checkPath(paths[0], io, 'mv');
    let dst = this.checkPath(paths[1], io, 'mv');
    if (!src || !dst) return 1;
    if (!this.exists(src)) { io.err(`mv: ${paths[0]}: No such file or directory`); return 1; }
    if (this.isDir(dst)) dst = dst + '/' + src.split('/').pop();
    this.copy(src, dst);
    this.rmrf(src);
    return 0;
  }

  private touch(args: string[], io: Io): number {
    for (const f of args.filter((a) => !a.startsWith('-'))) {
      const abs = this.checkPath(f, io, 'touch');
      if (!abs) return 1;
      if (this.exists(abs)) {
        const now = Date.now();
        this.fs.utime?.(abs, now, now);
      } else this.write(abs, '');
    }
    return 0;
  }

  private open(args: string[], io: Io): number {
    const f = args.filter((a) => !a.startsWith('-'))[0];
    if (!f) { io.err('open: give a file, for example: open target/static_index.html'); return 1; }
    const abs = this.checkPath(f, io, 'open');
    if (!abs) return 1;
    if (!this.exists(abs)) { io.err(`open: ${f}: No such file`); return 1; }
    if (!/\.html?$/i.test(abs)) {
      io.note({ tone: 'warn', text: 'open works for .html files here (for example target/static_index.html after dbt docs generate --static). Use cat, or the Files tab, for other files.' });
      return 1;
    }
    io.note({ text: `${this.tilde(abs)} is ready.`, openFile: abs });
    return 0;
  }

  private git(io: Io, ctx: ExecContext): number {
    io.note({ tone: 'warn', text: 'git runs on your computer, not in this browser terminal: a web page cannot start programs. Do the git steps of this lab in your own terminal.' });
    if (ctx.onMachineHref) io.note({ text: 'The on-machine steps of this lab:', link: { href: ctx.onMachineHref, label: 'open the lab steps' } });
    io.note({ text: 'Here you can still run dbt, look at the files (ls, cat) and edit them in the Files tab.' });
    return 1;
  }

  private help(io: Io): number {
    const rows: [string, string][] = [
      ['dbt <command>', 'real dbt-core 1.11.16 (run, build, test, ls, show, compile, seed, snapshot, docs generate ...)'],
      ['duckdb <file> -c "<sql>"', 'run SQL on a DuckDB file (also: duckdb <file> < script.sql)'],
      ['apply day2', 'load the next day of raw data (also: apply fresh_load, apply setup)'],
      ['ls  cat  head  tail  grep', 'look at files and outputs (grep, head, tail, wc, sort also after |)'],
      ['cd  pwd  mkdir  cp  mv  rm', 'move around and change files (only inside ~)'],
      ['export NAME=value', 'set an environment variable for dbt (PowerShell: $env:NAME = "value")'],
      ['open <file>.html', 'open an HTML file in a new tab (for example target/static_index.html)'],
      ['clear', 'clear the screen (or Ctrl+L)'],
    ];
    io.out('Commands of this terminal:');
    for (const [a, b] of rows) io.out(`  ${a.padEnd(28)}${b}`);
    io.out('');
    io.out('Up and Down: earlier commands. Ctrl+C or Stop: stop a long command. git, pip and other programs run on your computer.');
    return 0;
  }

  /** Display form of a command (for the preparation log). */
  static show(argv: string[]): string {
    return argv.map(quoteWord).join(' ');
  }
}
