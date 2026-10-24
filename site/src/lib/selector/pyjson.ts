/**
 * Python's json.dumps() with default arguments (ensure_ascii=True, separators (', ', ': ')),
 * which is what `dbt ls --output json` uses. Floats exported as {"__f": "<repr>"} keep Python's repr.
 */

function escapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

export function pyJsonDumps(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  }
  if (typeof v === 'string') return escapeString(v);
  if (Array.isArray(v)) return '[' + v.map(pyJsonDumps).join(', ') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === '__f' && typeof o.__f === 'string') return o.__f;
    return '{' + keys.map((k) => `${escapeString(k)}: ${pyJsonDumps(o[k])}`).join(', ') + '}';
  }
  return escapeString(String(v));
}

/** repr(float) for a non-integer JS number (shortest round-trip, like Python). */
function pyFloatRepr(x: number): string {
  let s = String(x);
  if (s.includes('e')) {
    // Python: 1e-05, 1e+16
    const [m, e] = s.split('e');
    const exp = parseInt(e, 10);
    s = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return s;
}
