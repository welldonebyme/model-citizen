// A small, predictable shell parser for the browser terminal (bash-like, with the few PowerShell forms the book's
// Windows steps use). Pure functions: no file system, no Python. Used by session.ts and the unit tests.
//
// Supported: words, 'single' and "double" quotes, backslash escapes, $VAR ${VAR} $? $env:VAR expansion, ~ at the
// start of a word, # comments, A=b prefixes, && || ; | < > >> 2> 2>&1, and a pasted "$ " or "PS> " prompt.

export type Redirect =
  | { kind: 'in'; path: string }
  | { kind: 'out'; fd: 1 | 2; path: string; append: boolean }
  | { kind: 'merge' }; // 2>&1

export interface SimpleCommand {
  assigns: Array<[string, string]>;
  argv: string[];
  redirects: Redirect[];
}
export interface Pipeline { cmds: SimpleCommand[] }
export interface ListItem { op: '&&' | '||' | ';' | null; pipeline: Pipeline }
export type ParseResult = { ok: true; items: ListItem[] } | { ok: false; error: string };

export interface ExpandContext {
  home: string;
  vars: (name: string) => string | undefined;
}

type Tok = { t: 'word'; v: string; quoted: boolean } | { t: 'op'; v: string };

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

/** Remove a prompt pasted with the command ("$ dbt run", "PS> dbt run"). */
export function stripPrompt(line: string): string {
  return line.replace(/^\s*(?:\$|PS>|PS [^>]*>|>)\s+/, '');
}

function readVar(s: string, i: number, ctx: ExpandContext): { value: string; next: number } | null {
  // s[i] === '$'
  const c = s[i + 1];
  if (c === '?') return { value: ctx.vars('?') ?? '0', next: i + 2 };
  if (c === '{') {
    const end = s.indexOf('}', i + 2);
    if (end < 0) return null;
    return { value: ctx.vars(s.slice(i + 2, end)) ?? '', next: end + 1 };
  }
  if (s.startsWith('env:', i + 1)) {
    NAME.lastIndex = i + 5;
    const m = NAME.exec(s);
    if (m) return { value: ctx.vars(m[0]) ?? '', next: i + 5 + m[0].length };
  }
  NAME.lastIndex = i + 1;
  const m = NAME.exec(s);
  if (m) return { value: ctx.vars(m[0]) ?? '', next: i + 1 + m[0].length };
  return null;
}

export function tokenize(input: string, ctx: ExpandContext): { ok: true; toks: Tok[] } | { ok: false; error: string } {
  const s = input;
  const toks: Tok[] = [];
  let i = 0;
  let cur: string | null = null;
  let quoted = false;
  const flush = () => {
    if (cur !== null) toks.push({ t: 'word', v: cur, quoted });
    cur = null;
    quoted = false;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { flush(); i++; continue; }
    if (c === '#' && cur === null) break; // comment (bash and PowerShell)
    // operators ("2>" only at the start of a word: in "a2>b", the 2 belongs to the word)
    const two = s.slice(i, i + 2);
    if (cur === null && two === '2>') {
      if (s.startsWith('2>&1', i)) { toks.push({ t: 'op', v: '2>&1' }); i += 4; continue; }
      if (s.startsWith('2>>', i)) { toks.push({ t: 'op', v: '2>>' }); i += 3; continue; }
      toks.push({ t: 'op', v: '2>' }); i += 2; continue;
    }
    if (two === '&&' || two === '||' || two === '>>') { flush(); toks.push({ t: 'op', v: two }); i += 2; continue; }
    if (c === ';' || c === '|' || c === '<' || c === '>') { flush(); toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '&') return { ok: false, error: 'Running a command in the background (&) is not available in this terminal.' };
    if (cur === null) cur = '';
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return { ok: false, error: 'Missing closing quote (\').' };
      cur += s.slice(i + 1, end);
      quoted = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      quoted = true;
      let closed = false;
      while (i < s.length) {
        const d = s[i];
        if (d === '"') { closed = true; i++; break; }
        if (d === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { cur += s[i + 1]; i += 2; continue; }
        if (d === '`' && i + 1 < s.length && s[i + 1] === '"') { cur += '"'; i += 2; continue; } // PowerShell escape
        if (d === '$') {
          const v = readVar(s, i, ctx);
          if (v) { cur += v.value; i = v.next; continue; }
        }
        cur += d;
        i++;
      }
      if (!closed) return { ok: false, error: 'Missing closing quote (").' };
      continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
    if (c === '$') {
      const v = readVar(s, i, ctx);
      if (v) { cur += v.value; i = v.next; continue; }
    }
    if (c === '~' && cur === '' && (i + 1 === s.length || s[i + 1] === '/' || s[i + 1] === ' ')) {
      cur += ctx.home;
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  flush();
  return { ok: true, toks };
}

const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

export function parseLine(line: string, ctx: ExpandContext): ParseResult {
  const tk = tokenize(stripPrompt(line), ctx);
  if (!tk.ok) return tk;
  const items: ListItem[] = [];
  let op: ListItem['op'] = null;
  let pipeline: Pipeline = { cmds: [] };
  let cmd: SimpleCommand = { assigns: [], argv: [], redirects: [] };
  const endCmd = () => {
    if (cmd.argv.length === 0 && cmd.assigns.length === 0 && cmd.redirects.length === 0) return false;
    pipeline.cmds.push(cmd);
    cmd = { assigns: [], argv: [], redirects: [] };
    return true;
  };
  const toks = tk.toks;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.t === 'word') {
      const m = cmd.argv.length === 0 ? tok.v.match(ASSIGN) : null;
      if (m) cmd.assigns.push([m[1], m[2]]);
      else cmd.argv.push(tok.v);
      continue;
    }
    const v = tok.v;
    if (v === '<' || v === '>' || v === '>>' || v === '2>' || v === '2>>') {
      const next = toks[i + 1];
      if (!next || next.t !== 'word') return { ok: false, error: `Missing file name after ${v}` };
      i++;
      if (v === '<') cmd.redirects.push({ kind: 'in', path: next.v });
      else cmd.redirects.push({ kind: 'out', fd: v.startsWith('2') ? 2 : 1, path: next.v, append: v.endsWith('>>') });
      continue;
    }
    if (v === '2>&1') { cmd.redirects.push({ kind: 'merge' }); continue; }
    if (v === '|') {
      if (!endCmd()) return { ok: false, error: 'A command is missing before |' };
      continue;
    }
    // && || ;
    const had = endCmd();
    if (!had && pipeline.cmds.length === 0) {
      if (v === ';' && items.length === 0) continue;
      return { ok: false, error: `A command is missing before ${v}` };
    }
    if (pipeline.cmds.length) items.push({ op, pipeline });
    pipeline = { cmds: [] };
    op = v as ListItem['op'];
  }
  endCmd();
  if (pipeline.cmds.length) items.push({ op, pipeline });
  else if (op === '&&' || op === '||') return { ok: false, error: `A command is missing after ${op}` };
  return { ok: true, items };
}

/** PowerShell `$env:NAME = "value"` (the book's Windows form of `export NAME=value`). */
export function parsePowerShellEnv(line: string): { name: string; value: string } | null {
  const m = stripPrompt(line).match(/^\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*;?\s*$/);
  if (!m) return null;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return { name: m[1], value: v };
}

/** Quote a word for display, so that a command shown in the terminal can be typed again. */
export function quoteWord(w: string): string {
  if (w === '') return "''";
  if (/^[A-Za-z0-9_\-./:=@+,%~^]+$/.test(w)) return w;
  return `'${w.replace(/'/g, `'\\''`)}'`;
}

/** Simple glob match for ls/cat arguments (* and ?), on one path segment. */
export function globToRegExp(glob: string): RegExp {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`);
}
