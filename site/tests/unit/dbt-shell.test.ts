// The browser terminal's shell: parsing (shell.ts) and the session's builtins on an in-memory file system.
import { describe, expect, it } from 'vitest';
import { parseLine, parsePowerShellEnv, splitList, stripPrompt, tokenize } from '../../src/lib/dbt/shell';
import { Session, type EmFS, type PyBridge } from '../../src/lib/dbt/session';
import { parseAnsi, stripAnsi } from '../../src/lib/dbt/ansi';
import { dbtCommands } from '../../src/components/content/CodeBlock';
import type { Io, Note } from '../../src/lib/dbt/types';

const ctx = { home: '/home/pyodide', vars: (n: string) => ({ X: 'x1', HOME: '/home/pyodide', '?': '3' } as Record<string, string>)[n] };
const words = (s: string) => { const t = tokenize(s, ctx); if (!t.ok) throw new Error(t.error); return t.toks.map((x) => (x.t === 'word' ? x.v : `<${x.v}>`)); };

describe('tokenize', () => {
  it('quotes, escapes and expansion', () => {
    expect(words(`dbt show --inline "select * from {{ ref('a') }}" --limit 10`)).toEqual(['dbt', 'show', '--inline', "select * from {{ ref('a') }}", '--limit', '10']);
    expect(words(`echo '$X' "$X" $X \\$X`)).toEqual(['echo', '$X', 'x1', 'x1', '$X']);
    expect(words('echo ${X}y $? $env:X')).toEqual(['echo', 'x1y', '3', 'x1']);
    expect(words('cd ~/dbt-course && ls ~')).toEqual(['cd', '/home/pyodide/dbt-course', '<&&>', 'ls', '/home/pyodide']);
    expect(words('a~b "~/x"')).toEqual(['a~b', '~/x']);
    expect(words('dbt run # a comment')).toEqual(['dbt', 'run']);
    expect(words('echo a#b')).toEqual(['echo', 'a#b']);
    expect(words('echo ""')).toEqual(['echo', '']);
  });
  it('operators and redirections', () => {
    expect(words('dbt ls > out.txt 2>&1')).toEqual(['dbt', 'ls', '<>>', 'out.txt', '<2>&1>']);
    expect(words('duckdb p.duckdb < setup.sql')).toEqual(['duckdb', 'p.duckdb', '<<>', 'setup.sql']);
    expect(words('dbt debug 2>/dev/null | grep -E "path:|OK"')).toEqual(['dbt', 'debug', '<2>>', '/dev/null', '<|>', 'grep', '-E', 'path:|OK']);
    expect(words('echo a2>b')).toEqual(['echo', 'a2', '<>>', 'b']);
  });
  it('errors in simple English', () => {
    expect(tokenize('echo "abc', ctx)).toEqual({ ok: false, error: 'Missing closing quote (").' });
    expect(tokenize('dbt run &', ctx).ok).toBe(false);
  });
});

describe('parseLine', () => {
  it('assignments, pipelines, lists', () => {
    const r = parseLine('DBT_DUCKDB_PATH=../x.duckdb dbt build --select +fct_orders | head -n 5', ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    const [a, b] = r.items[0].pipeline.cmds;
    expect(a.assigns).toEqual([['DBT_DUCKDB_PATH', '../x.duckdb']]);
    expect(a.argv).toEqual(['dbt', 'build', '--select', '+fct_orders']);
    expect(b.argv).toEqual(['head', '-n', '5']);
    expect(parseLine('dbt run && dbt test || echo failed; ls', ctx)).toMatchObject({ ok: true, items: [{ op: null }, { op: '&&' }, { op: '||' }, { op: ';' }] });
    expect(parseLine('&& ls', ctx).ok).toBe(false);
    expect(parseLine('ls |', ctx).ok).toBe(true);
  });
  it('splitList keeps operators inside quotes', () => {
    const r = splitList(`dbt show --inline "select 1 && 2; 3" && echo 'a || b'; ls # x && y`);
    expect(r).toEqual({ ok: true, items: [
      { op: null, text: 'dbt show --inline "select 1 && 2; 3" ' },
      { op: '&&', text: " echo 'a || b'" },
      { op: ';', text: ' ls ' }, // the comment is dropped
    ] });
    expect(splitList('a &&').ok).toBe(false);
  });
  it('pasted prompts and PowerShell env', () => {
    expect(stripPrompt('$ dbt run')).toBe('dbt run');
    expect(stripPrompt('PS> dbt run')).toBe('dbt run');
    expect(stripPrompt('(.venv) $ dbt run')).toBe('dbt run');
    expect(stripPrompt('PS C:\\Users\\a\\jaffle_dbt> dbt run')).toBe('dbt run');
    expect(parsePowerShellEnv('$env:DBT_DUCKDB_PATH = "../practice/x.duckdb"')).toEqual({ name: 'DBT_DUCKDB_PATH', value: '../practice/x.duckdb' });
    expect(parsePowerShellEnv('dbt run')).toBeNull();
  });
});

describe('ansi and code blocks', () => {
  it('parses dbt colours', () => {
    const l = '\x1b[0m03:21:39  1 of 7 OK created sql view model x ... [\x1b[32mOK\x1b[0m in 0.03s]';
    expect(stripAnsi(l)).toBe('03:21:39  1 of 7 OK created sql view model x ... [OK in 0.03s]');
    expect(parseAnsi(l)).toEqual([{ text: '03:21:39  1 of 7 OK created sql view model x ... [' }, { text: 'OK', cls: 't-green' }, { text: ' in 0.03s]' }]);
  });
  it('dbtCommands picks the dbt command lines of a shell block', () => {
    expect(dbtCommands('$ cd ~/dbt-course/jaffle_dbt\n$ dbt build\n12:00:00  output\n$ DBT_X=1 dbt run -s a\n$ git status')).toEqual(['dbt build', 'DBT_X=1 dbt run -s a']);
    expect(dbtCommands('$ git add .')).toEqual([]);
    expect(dbtCommands('(.venv) $ dbt run\n12:00:00  Done.\n(.venv) $ dbt show --select x')).toEqual(['dbt run', 'dbt show --select x']);
    expect(dbtCommands('(.venv) PS> dbt build')).toEqual(['dbt build']);
    expect(dbtCommands('dbt run')).toEqual(['dbt run']);
  });
});

// ---- session builtins on an in-memory file system ----------------------------------------------------------------
class MemFS implements EmFS {
  nodes = new Map<string, { dir: boolean; data?: Uint8Array; mtime: number }>([['/', { dir: true, mtime: 0 }]]);
  private pcwd = '/';
  analyzePath(p: string) { return { exists: this.nodes.has(p) }; }
  stat(p: string) { const n = this.nodes.get(p); if (!n) throw new Error('ENOENT ' + p); return { mode: n.dir ? 0o40000 : 0o100000, size: n.data?.length ?? 0, mtime: n.mtime }; }
  isDir(m: number) { return (m & 0o170000) === 0o40000; }
  isFile(m: number) { return (m & 0o170000) === 0o100000; }
  readdir(p: string) { const pre = p === '/' ? '/' : p + '/'; return ['.', '..', ...[...this.nodes.keys()].filter((k) => k.startsWith(pre) && k !== p && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length))]; }
  readFile(p: string, o?: { encoding?: string }) { const n = this.nodes.get(p); if (!n || n.dir) throw new Error('ENOENT ' + p); return o?.encoding === 'utf8' ? new TextDecoder().decode(n.data) : n.data!; }
  writeFile(p: string, d: string | Uint8Array) { this.nodes.set(p, { dir: false, data: typeof d === 'string' ? new TextEncoder().encode(d) : d, mtime: Date.now() }); }
  mkdir(p: string) { this.nodes.set(p, { dir: true, mtime: Date.now() }); }
  mkdirTree(p: string) { let cur = ''; for (const seg of p.split('/').filter(Boolean)) { cur += '/' + seg; if (!this.nodes.has(cur)) this.mkdir(cur); } }
  rmdir(p: string) { if (this.pcwd === p) throw new Error('EBUSY'); this.nodes.delete(p); }
  unlink(p: string) { this.nodes.delete(p); }
  rename(a: string, b: string) { const n = this.nodes.get(a)!; this.nodes.delete(a); this.nodes.set(b, n); }
  chdir(p: string) { this.pcwd = p; }
  cwd() { return this.pcwd; }
}

function setup() {
  const fs = new MemFS();
  const calls: { argv: string[]; env: Record<string, string>; cwd: string }[] = [];
  let session: Session;
  const py: PyBridge = {
    runDbt: (argv, env, cwd) => { calls.push({ argv, env, cwd }); session.pyOut(`dbt ${argv.join(' ')}`); return argv.includes('fail') ? 1 : 0; },
    duckdb: () => 0,
    ensurePandas: async () => {},
  };
  session = new Session({ fs, py, loadBundle: async () => ({ files: {} }) });
  fs.mkdirTree('/home/pyodide/dbt-course/jaffle_dbt/models/staging');
  fs.writeFile('/home/pyodide/dbt-course/jaffle_dbt/dbt_project.yml', "name: 'jaffle_dbt'\nmodel-paths: [\"models\"]\n");
  fs.writeFile('/home/pyodide/dbt-course/jaffle_dbt/models/staging/a.sql', 'select 1\n');
  session.cwd = '/home/pyodide/dbt-course/jaffle_dbt';
  const out: string[] = [];
  const noteList: Note[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => out.push('ERR ' + l), note: (n) => noteList.push(n) };
  const sh = async (line: string) => { out.length = 0; noteList.length = 0; const code = await session.exec(line, io, { cols: 80, onMachineHref: '/lab' }); return { code, out: [...out], notes: noteList.map((n) => n.text) }; };
  return { fs, session, calls, sh };
}

describe('session', () => {
  it('cd, pwd, ls, cat, redirections, grep, pipes', async () => {
    const { sh } = setup();
    expect((await sh('pwd')).out).toEqual(['/home/pyodide/dbt-course/jaffle_dbt']);
    expect((await sh('ls')).out).toEqual(['dbt_project.yml', 'models']);
    expect((await sh('cd models/staging && pwd')).out).toEqual(['/home/pyodide/dbt-course/jaffle_dbt/models/staging']);
    expect((await sh('cd ../..')).code).toBe(0);
    expect((await sh('cd /etc')).code).toBe(1);
    expect((await sh('echo "select 2 as y" > models/b.sql && cat models/b.sql')).out).toEqual(['select 2 as y']);
    expect((await sh('echo more >> models/b.sql; cat models/b.sql | wc -l')).out).toEqual(['       2']);
    expect((await sh('cat models/staging/*.sql')).out).toEqual(['select 1']);
    expect((await sh('grep -n jaffle dbt_project.yml')).out).toEqual(["1:name: 'jaffle_dbt'"]);
    expect((await sh('grep -c nothing dbt_project.yml')).out).toEqual(['0']);
    expect((await sh('ls | grep -v models')).out).toEqual(['dbt_project.yml']);
    expect((await sh('ls | dbt run')).code).toBe(1); // only filters after |
    expect((await sh('find models -name "*.sql" | sort')).out).toEqual(['models/b.sql', 'models/staging/a.sql']);
    expect((await sh("sed -n '1,1p' dbt_project.yml")).out).toEqual(["name: 'jaffle_dbt'"]);
  });

  it('variables: export, one-shot, shell-only, $?, PowerShell', async () => {
    const { sh, calls } = setup();
    await sh('export DBT_DUCKDB_PATH=../a.duckdb && echo $DBT_DUCKDB_PATH');
    expect((await sh('echo $DBT_DUCKDB_PATH')).out).toEqual(['../a.duckdb']);
    await sh('dbt run');
    expect(calls.at(-1)!.env).toEqual({ DBT_DUCKDB_PATH: '../a.duckdb' });
    await sh('DBT_TARGET_PATH=t2 dbt ls');
    expect(calls.at(-1)!.env).toEqual({ DBT_DUCKDB_PATH: '../a.duckdb', DBT_TARGET_PATH: 't2' });
    await sh('ONLY_SHELL=1');
    expect((await sh('echo $ONLY_SHELL')).out).toEqual(['1']);
    await sh('dbt ls');
    expect(calls.at(-1)!.env.ONLY_SHELL).toBeUndefined(); // not exported, like bash
    await sh('dbt run fail');
    expect((await sh('echo $?')).out).toEqual(['1']);
    await sh('$env:DBT_X = "win"');
    expect((await sh('echo $env:DBT_X')).out).toEqual(['win']);
    await sh('Remove-Item Env:DBT_X');
    expect((await sh('echo "[$env:DBT_X]"')).out).toEqual(['[]']);
    expect((await sh('dbt run fail && echo no || echo yes')).out).toEqual(['dbt run fail', 'yes']);
  });

  it('cp, mv, rm, mkdir stay inside the home folder', async () => {
    const { sh, fs } = setup();
    await sh('mkdir -p prod-artifacts && cp dbt_project.yml models/staging/a.sql prod-artifacts/');
    expect((await sh('ls prod-artifacts')).out).toEqual(['a.sql', 'dbt_project.yml']);
    await sh('mv prod-artifacts/a.sql prod-artifacts/c.sql');
    expect((await sh('ls prod-artifacts')).out).toEqual(['c.sql', 'dbt_project.yml']);
    expect((await sh('rm prod-artifacts')).code).toBe(1); // a directory needs -r
    expect((await sh('rm -r prod-artifacts')).code).toBe(0);
    expect(fs.analyzePath('/home/pyodide/dbt-course/jaffle_dbt/prod-artifacts').exists).toBe(false);
    expect((await sh('rm -rf ~')).code).toBe(1);
    expect((await sh('cp dbt_project.yml /tmp/x')).code).toBe(1);
    expect((await sh('New-Item -ItemType Directory -Force ci_db')).code).toBe(0);
    expect(fs.analyzePath('/home/pyodide/dbt-course/jaffle_dbt/ci_db').exists).toBe(true);
  });

  it('sandbox messages: git, programs, docs serve, init, deps without packages', async () => {
    const { sh, calls } = setup();
    const g = await sh('git status');
    expect(g.code).toBe(1);
    expect(g.notes.join(' ')).toContain('git runs on your computer');
    expect((await sh('pip install dbt-core')).notes.join(' ')).toContain('runs on your computer');
    expect((await sh('dbt docs serve')).notes.join(' ')).toContain('dbt docs generate --static');
    expect((await sh('dbt init x')).notes.join(' ')).toContain('--skip-profile-setup');
    const n = calls.length;
    await sh('dbt deps'); // no packages.yml: the real dbt deps runs (nothing to download)
    expect(calls.length).toBe(n + 1);
    expect((await sh('nope')).out).toEqual(['ERR nope: command not found. Type help to see the commands of this terminal.']);
  });
});
