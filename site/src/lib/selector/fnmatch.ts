/**
 * Python's fnmatch.fnmatchcase(), ported exactly (CPython 3.12 `fnmatch.translate`).
 *
 * dbt matches tags, names, packages, files... with `fnmatch`. On macOS/Linux `os.path.normcase` does nothing,
 * so matching is case-sensitive. Semantics:
 *   *      any characters, including "." and "/" (DOTALL)
 *   ?      exactly one character
 *   [abc]  one character of the set; [!abc] negation; ranges a-z; "]" first is literal; a "[" without a
 *          closing "]" is a literal "["
 * The whole name must match.
 */

const cache = new Map<string, RegExp>();

/** Escape one code point for use inside or outside a JS character class (unicode mode). */
function esc(ch: string): string {
  const cp = ch.codePointAt(0)!;
  return `\\u{${cp.toString(16)}}`;
}

/**
 * Port of CPython's `_translate`, producing a list of parts. Character classes are produced as
 * {cls: string} in the Python escaped form, then converted to a JS class.
 */
type Part = { star: true } | { any: true } | { lit: string } | { cls: string } | { never: true };

function translateParts(pat: string): Part[] {
  const res: Part[] = [];
  const chars = Array.from(pat); // code points, like Python str indexing
  const n = chars.length;
  let i = 0;
  while (i < n) {
    const c = chars[i];
    i += 1;
    if (c === '*') {
      const last = res[res.length - 1];
      if (!last || !('star' in last)) res.push({ star: true });
    } else if (c === '?') {
      res.push({ any: true });
    } else if (c === '[') {
      let j = i;
      if (j < n && chars[j] === '!') j += 1;
      if (j < n && chars[j] === ']') j += 1;
      while (j < n && chars[j] !== ']') j += 1;
      if (j >= n) {
        res.push({ lit: '[' });
      } else {
        let stuff: string;
        const slice = (a: number, b: number) => chars.slice(a, b).join('');
        if (!slice(i, j).includes('-')) {
          stuff = slice(i, j).replace(/\\/g, '\\\\');
        } else {
          const chunks: string[] = [];
          let k = chars[i] === '!' ? i + 2 : i + 1;
          for (;;) {
            // pat.find('-', k, j)
            let f = -1;
            for (let x = k; x < j; x++) if (chars[x] === '-') { f = x; break; }
            k = f;
            if (k < 0) break;
            chunks.push(slice(i, k));
            i = k + 1;
            k = k + 3;
          }
          const chunk = slice(i, j);
          if (chunk) chunks.push(chunk);
          else chunks[chunks.length - 1] += '-';
          // Remove empty ranges -- invalid in RE.
          for (let kk = chunks.length - 1; kk > 0; kk--) {
            const prev = Array.from(chunks[kk - 1]);
            const cur = Array.from(chunks[kk]);
            if (cmpCp(prev[prev.length - 1], cur[0]) > 0) {
              chunks[kk - 1] = prev.slice(0, -1).join('') + cur.slice(1).join('');
              chunks.splice(kk, 1);
            }
          }
          // Escape backslashes and hyphens for set difference (--).
          stuff = chunks.map((s) => s.replace(/\\/g, '\\\\').replace(/-/g, '\\-')).join('-');
        }
        // Escape set operations (&&, ~~ and ||).
        stuff = stuff.replace(/([&~|])/g, '\\$1');
        i = j + 1;
        if (!stuff) {
          res.push({ never: true });
        } else if (stuff === '!') {
          res.push({ any: true });
        } else {
          if (stuff[0] === '!') stuff = '^' + stuff.slice(1);
          else if (stuff[0] === '^' || stuff[0] === '[') stuff = '\\' + stuff;
          res.push({ cls: stuff });
        }
      }
    } else {
      res.push({ lit: c });
    }
  }
  return res;
}

function cmpCp(a: string | undefined, b: string | undefined): number {
  const x = a === undefined ? -1 : a.codePointAt(0)!;
  const y = b === undefined ? -1 : b.codePointAt(0)!;
  return x - y;
}

/** Convert a Python character-class body (escaped as Python's translate does) to a JS class body. */
function pyClassToJs(body: string): string {
  const cps = Array.from(body);
  let out = '';
  let idx = 0;
  if (cps[0] === '^') { out += '^'; idx = 1; }
  for (; idx < cps.length; idx++) {
    const c = cps[idx];
    if (c === '\\') {
      idx += 1;
      out += esc(cps[idx] ?? '\\');
    } else if (c === '-') {
      out += '-';
    } else {
      out += esc(c);
    }
  }
  return out;
}

export function fnmatchRegExp(pat: string): RegExp {
  let re = cache.get(pat);
  if (re) return re;
  const parts = translateParts(pat);
  let src = '';
  for (const p of parts) {
    if ('star' in p) src += '[^]*';
    else if ('any' in p) src += '[^]';
    else if ('never' in p) src += '(?!)';
    else if ('lit' in p) src += esc(p.lit);
    else src += `[${pyClassToJs(p.cls)}]`;
  }
  re = new RegExp(`^(?:${src})$`, 'u');
  if (cache.size > 2000) cache.clear();
  cache.set(pat, re);
  return re;
}

/** fnmatch.fnmatch(name, pat) on POSIX (case-sensitive). */
export function fnmatch(name: string, pat: string): boolean {
  return fnmatchRegExp(pat).test(name);
}

export function hasWildcard(s: string): boolean {
  return /[*?[\]]/.test(s);
}
