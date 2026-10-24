/**
 * A tiny virtual file system of the project folder and Python 3.12 `pathlib.Path.glob` semantics,
 * which is what dbt's `path:` method uses (`root.glob(selector)`).
 *
 * - the pattern is split on "/", empty and "." parts are dropped; a trailing "/" keeps only directories
 * - "**" = this directory and every directory below it (directories only when it is the last part)
 * - other parts are fnmatch patterns, case-sensitive, matched against the entries of one directory
 *   ("*" never crosses a "/"; hidden entries are matched too)
 * - ".." parts and absolute patterns make dbt crash (we report an error)
 */
import { fnmatchRegExp } from './fnmatch';

export class GlobError extends Error {}

export class VirtualFs {
  /** directory path ('' = project root) -> entries */
  private dirs = new Map<string, Map<string, 'file' | 'dir'>>();

  constructor(files: Iterable<string>) {
    this.dirs.set('', new Map());
    for (const f of files) this.addFile(f);
  }

  addFile(path: string): void {
    const parts = path.split('/').filter((p) => p && p !== '.');
    let cur = '';
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const entries = this.dirs.get(cur)!;
      const name = parts[i];
      const child = cur ? `${cur}/${name}` : name;
      if (isLast) {
        if (!entries.has(name)) entries.set(name, 'file');
      } else {
        entries.set(name, 'dir');
        if (!this.dirs.has(child)) this.dirs.set(child, new Map());
      }
      cur = child;
    }
  }

  isDir(p: string): boolean {
    return this.dirs.has(p);
  }

  private entries(dir: string): [string, 'file' | 'dir'][] {
    const e = this.dirs.get(dir);
    return e ? [...e.entries()] : [];
  }

  /** Entries of one directory, sorted by name. */
  list(dir: string): [string, 'file' | 'dir'][] {
    return this.entries(dir).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  private walkDirs(dir: string): string[] {
    const out = [dir];
    for (const [name, kind] of this.entries(dir)) {
      if (kind === 'dir') out.push(...this.walkDirs(dir ? `${dir}/${name}` : name));
    }
    return out;
  }

  /**
   * Root-relative paths matched by `Path(root).glob(pattern)`; the root itself is returned as '.'.
   * Throws GlobError for the patterns Python rejects.
   */
  glob(pattern: string): Set<string> {
    if (!pattern) throw new GlobError(`Unacceptable pattern: ''`);
    if (pattern.startsWith('/')) throw new GlobError('Non-relative patterns are unsupported');
    const parts = pattern.split('/').filter((x) => x && x !== '.');
    if (pattern.endsWith('/')) parts.push('');
    if (parts.length === 0) throw new GlobError('tuple index out of range');
    for (const p of parts) {
      if (p !== '**' && p.includes('**')) throw new GlobError("Invalid pattern: '**' can only be an entire path component");
    }
    const out = new Set<string>();
    // `text` keeps what Python yields ('..' stays in the path); `real` is the folder really listed.
    // A path with '..' never equals a node file or folder, so such patterns select nothing.
    const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
    const select = (idx: number, text: string, real: string | null) => {
      if (idx >= parts.length || parts[idx] === '') {
        out.add(text === '' ? '.' : text);
        return;
      }
      const pat = parts[idx];
      if (pat === '..') {
        const up = real === null || real === '' ? null : real.split('/').slice(0, -1).join('/');
        select(idx + 1, join(text, '..'), up);
        return;
      }
      if (real === null) return; // outside the project folder: unknown, nothing that dbt could match
      if (pat === '**') {
        let next = idx + 1;
        while (next < parts.length && parts[next] === '**') next++;
        for (const d of this.walkDirs(real)) select(next, text + d.slice(real.length) .replace(/^\//, text ? '/' : ''), d);
        return;
      }
      const dirOnly = idx + 1 < parts.length;
      const re = fnmatchRegExp(pat);
      for (const [name, kind] of this.entries(real)) {
        if (dirOnly && kind !== 'dir') continue;
        if (re.test(name)) select(idx + 1, join(text, name), join(real, name));
      }
    };
    select(0, '', '');
    return out;
  }
}

/** Normalised relative path (like PurePosixPath(str)). */
export function normPath(p: string): string {
  const parts = p.split('/').filter((x) => x && x !== '.');
  return parts.length ? parts.join('/') : '.';
}

/** Path(p).parents for a relative path: 'a/b/c.sql' -> ['a/b', 'a', '.'] */
export function parentsOf(p: string): string[] {
  const parts = normPath(p).split('/');
  const out: string[] = [];
  for (let i = parts.length - 1; i > 0; i--) out.push(parts.slice(0, i).join('/'));
  if (normPath(p) !== '.') out.push('.');
  return out;
}
