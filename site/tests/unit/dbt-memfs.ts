// In-memory Emscripten-like file system and a Session on it, for the dbt shell unit tests.
import { Session, type EmFS, type PyBridge } from '../../src/lib/dbt/session';
import type { Io, Note } from '../../src/lib/dbt/types';

export class MemFS implements EmFS {
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

export function setup() {
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

