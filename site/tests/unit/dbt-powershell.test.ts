// Windows learners type the PowerShell forms the lessons show (review finding pedagogy F12).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPowerShellLine, splitList, tokenize } from '../../src/lib/dbt/shell';
import { commandsOf, dbtCommandLines } from '../../src/lib/dbt/commands';
import { setup } from './dbt-memfs';

const HOME = '/home/pyodide';
const P = HOME + '/dbt-course/jaffle_dbt';

function project() {
  const t = setup();
  t.fs.writeFile(P + '/logs/dbt.log', 'a\ngrant select on x\nBinder Error: one\nok\nBinder Error: two\n');
  t.fs.mkdirTree(P + '/target');
  t.fs.writeFile(P + '/target/manifest.json', '{}');
  t.fs.writeFile(P + '/target/run_results.json', '{}');
  t.fs.mkdirTree(P + '/data');
  t.fs.writeFile(P + '/data/orders.csv', 'id,status\n1,placed\n2,shipped\n3,placed\n');
  t.fs.writeFile(P + '/data/products.csv', 'id,name\n1,Coffee\n');
  return t;
}

describe('PowerShell forms of the lessons (F12)', () => {
  it('the reviewer\'s commands: backslash paths, New-Item, Get-ChildItem | Sort-Object, $LASTEXITCODE', async () => {
    const { sh, session } = project();
    session.cwd = HOME;
    expect((await sh('cd $HOME\\dbt-course\\jaffle_dbt')).code).toBe(0);
    expect(session.cwd).toBe(P);
    const ni = await sh('New-Item -ItemType Directory -Force $HOME\\.dbt');
    expect(ni.code).toBe(0);
    expect(ni.out.join('')).not.toMatch(/pyodide\.dbt/);
    const gci = await sh('Get-ChildItem -Recurse -Name models | Sort-Object');
    expect(gci.code).toBe(0);
    expect(gci.out).toEqual(['b.sql', 'staging', 'staging/a.sql'].filter((x) => x !== 'b.sql'));
    await sh('dbt run fail');
    expect((await sh('$LASTEXITCODE')).out).toEqual(['1']);
    expect((await sh('echo $LASTEXITCODE')).out).toEqual(['1']);
    await sh('dbt run');
    expect((await sh('$LASTEXITCODE')).out).toEqual(['0']);
    expect((await sh('$?')).out).toEqual(['True']);
  });

  it('Copy-Item lists, Remove-Item, Move-Item with $env:TEMP, Get-Content -Tail/-TotalCount', async () => {
    const { sh, fs: mem } = project();
    expect((await sh('New-Item -ItemType Directory -Force prod-artifacts')).code).toBe(0);
    expect((await sh('Copy-Item target\\manifest.json, target\\run_results.json prod-artifacts\\')).code).toBe(0);
    expect((await sh('Get-ChildItem -Name prod-artifacts')).out).toEqual(['manifest.json', 'run_results.json']);
    expect((await sh('Move-Item prod-artifacts\\manifest.json $env:TEMP\\')).code).toBe(0);
    expect(mem.analyzePath(HOME + '/.temp/manifest.json').exists).toBe(true);
    expect((await sh('Remove-Item -Recurse -Force prod-artifacts')).code).toBe(0);
    expect(mem.analyzePath(P + '/prod-artifacts').exists).toBe(false);
    expect((await sh('Get-Content data\\orders.csv -TotalCount 2')).out).toEqual(['id,status', '1,placed']);
    expect((await sh('Get-Content data\\orders.csv -Tail 1')).out).toEqual(['3,placed']);
  });

  it('Select-String with ForEach-Object Line, the LineNumber script block, Select-Object, (...).Count', async () => {
    const { sh } = project();
    expect((await sh("Select-String -CaseSensitive 'Binder Error' logs\\dbt.log | ForEach-Object { \"$($_.LineNumber):$($_.Line)\" } | Select-Object -Last 1")).out)
      .toEqual(['5:Binder Error: two']);
    expect((await sh("Select-String -CaseSensitive 'placed' data\\orders.csv | ForEach-Object Line | Select-Object -First 3")).out).toEqual(['1,placed', '3,placed']);
    expect((await sh("Select-String 'coffee' data\\products.csv")).out).toEqual(['data\\products.csv:2:1,Coffee']); // case-insensitive by default
    expect((await sh("(Select-String -CaseSensitive 'placed' data\\orders.csv).Count")).out).toEqual(['2']);
    expect((await sh("(Select-String 'grant ' logs\\dbt.log).Count")).out).toEqual(['1']);
    expect((await sh("dbt ls | Select-String -CaseSensitive 'dbt ls' | ForEach-Object Line")).out).toEqual(['dbt ls']);
    expect((await sh('dbt ls | Measure-Object | ForEach-Object Count')).out).toEqual(['1']);
  });

  it('PowerShell quoting: $env: values with Windows paths, $name = ..., quotes doubled, \\" at the end', async () => {
    const { sh, session, calls } = project();
    await sh('$env:DBT_DUCKDB_PATH = "$PWD\\ci_db\\practice.duckdb"');
    expect(session.env.DBT_DUCKDB_PATH).toBe(P + '/ci_db/practice.duckdb');
    await sh('$env:DBT_DUCKDB_PATH = "../practice/empty_check.duckdb"; dbt build --empty; Remove-Item Env:DBT_DUCKDB_PATH');
    expect(calls.at(-1)!.env.DBT_DUCKDB_PATH).toBe('../practice/empty_check.duckdb');
    expect(session.env.DBT_DUCKDB_PATH).toBeUndefined();
    await sh('$B = "$HOME\\dbt-course\\jaffle_dbt\\data"');
    expect((await sh('Get-ChildItem -Name $B')).out).toEqual(['orders.csv', 'products.csv']);
    await sh('$env:GITHUB_WORKSPACE = "$PWD"');
    expect((await sh('New-Item -ItemType Directory -Force "$env:GITHUB_WORKSPACE\\prod-artifacts"')).code).toBe(0);
    expect((await sh('Copy-Item target\\manifest.json "$env:GITHUB_WORKSPACE\\prod-artifacts\\"')).code).toBe(0);
    expect((await sh('Get-ChildItem -Name prod-artifacts')).out).toEqual(['manifest.json']);
    const t = tokenize("Select-String -AllMatches '''send_anonymous_usage_stats'': ''[A-Za-z]*'''", { home: HOME, vars: () => undefined });
    expect(t.ok && t.toks.map((x) => ('v' in x ? x.v : '')).at(-1)).toBe("'send_anonymous_usage_stats': '[A-Za-z]*'");
    await sh('Remove-Item Env:DBT_A, Env:DBT_B');
    await sh('Set-Content notes.txt "first line"');
    await sh('Add-Content notes.txt "second line"');
    expect((await sh('Get-Content notes.txt')).out).toEqual(['first line', 'second line']);
    expect((await sh('dbt --version | Add-Content notes.txt')).code).toBe(0);
    expect((await sh('Get-Content notes.txt')).out.at(-1)).toBe('dbt --version');
  });

  it('bash lines keep bash rules', async () => {
    const { sh } = project();
    expect(isPowerShellLine('dbt run --select "tag:a"')).toBe(false);
    expect(isPowerShellLine('Copy-Item a b')).toBe(true);
    expect((await sh('echo \\$HOME "a\\"b"')).out).toEqual(['$HOME a"b']);
    expect((await sh('cat models\\staging\\a.sql')).out).toEqual(['select 1']); // a Windows path in a bash line too
  });

  it('venv activation is not needed; the Windows pane gives its dbt lines to "Try in the browser terminal"', async () => {
    const { sh } = project();
    const a = await sh('..\\.venv\\Scripts\\Activate.ps1');
    expect(a.code).toBe(0);
    expect(a.notes.join(' ')).toContain('Not needed here');
    expect(dbtCommandLines('PS> cd $HOME\\dbt-course\\jaffle_dbt\nPS> dbt build\n12:00:00  Done.\nPS> $env:DBT_THREADS = "2"; dbt run -s x; Remove-Item Env:DBT_THREADS'))
      .toEqual(['dbt build', '$env:DBT_THREADS = "2"; dbt run -s x; Remove-Item Env:DBT_THREADS']);
    expect(dbtCommandLines('(.venv) $ dbt ls\n(.venv) $ git status')).toEqual(['dbt ls']);
  });
});

// Every Windows (PowerShell) command line of the generated lessons goes through the terminal without the
// confusing errors of F12: mangled paths, "command not found" for the cmdlets the lessons use, unsupported pipes.
describe('every Windows command line of the lessons', () => {
  const dir = path.resolve(__dirname, '..', '..', 'src', 'generated', 'chapters');
  const lines: string[] = [];
  const walk = (bs: any[]) => {
    for (const b of bs ?? []) {
      if (b.t === 'code' && b.lang === 'bash' && b.variants?.win) lines.push(...commandsOf(String(b.variants.win)));
      if (b.blocks) walk(b.blocks);
      if (b.t === 'list') for (const it of b.items) walk(it.blocks);
    }
  };
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      walk(c.intro);
      for (const l of c.lessons) for (const st of l.steps) walk(st.blocks);
    }
  }
  const unique = [...new Set(lines)];

  it(`parses all ${unique.length} lines and runs them without mangled paths`, async () => {
    expect(unique.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const line of unique) {
      expect(splitList(line).ok, line).toBe(true);
      const { sh } = project();
      const r = await sh(line);
      const text = [...r.out, ...r.notes].join('\n');
      if (/pyodide[A-Za-z]/.test(text) || /^(get|set|add|new|remove|copy|move|select|sort|foreach|measure)-\w+: command not found/im.test(text)
        || /can come after \| in this terminal/.test(text) || /Missing closing quote/.test(text)) bad.push(`${line}\n    -> ${text.slice(0, 160)}`);
    }
    expect(bad).toEqual([]);
  });
});
