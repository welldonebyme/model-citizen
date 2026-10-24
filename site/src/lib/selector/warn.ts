/**
 * dbt_common's warn_or_error with --warn-error / --warn-error-options (WarnErrorOptionsV2, dbt-core 1.11.16):
 *   raise when --warn-error, or the event is named in `error` (and not in warn/silence), or error is all/*;
 *   say nothing when it is silenced; else print the warning. Deprecations follow "Deprecations".
 * The option value is YAML (a mapping): '{"error": "all"}', '{error: all}' or 'error: [NoNodesSelected]'.
 */
import eventNames from './data/event-names.json';
import { DbtError } from './errors';

const VALID = new Set<string>([...(eventNames as string[]), 'Deprecations']);

/** A tiny YAML reader for the shapes the option takes: a flow mapping or "key: value" lines, flow lists. */
export function parseYamlMapping(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try {
    const j = JSON.parse(t);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch { /* not JSON: YAML */ }
  const scalar = (s: string): unknown => {
    const v = s.trim();
    if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1);
    if (/^(null|~|)$/i.test(v)) return null;
    if (/^(true|yes|on)$/i.test(v)) return true;
    if (/^(false|no|off)$/i.test(v)) return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  };
  const splitTop = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    let q: string | null = null;
    for (const c of s) {
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
  };
  const value = (s: string): unknown => {
    const v = s.trim();
    if (v.startsWith('[') && v.endsWith(']')) return splitTop(v.slice(1, -1)).map(scalar);
    return scalar(v);
  };
  const pairs = (items: string[]): Record<string, unknown> | null => {
    const o: Record<string, unknown> = {};
    for (const it of items) {
      const i = it.indexOf(':');
      if (i < 0) return null;
      o[String(scalar(it.slice(0, i)))] = value(it.slice(i + 1));
    }
    return o;
  };
  if (t.startsWith('{') && t.endsWith('}')) return pairs(splitTop(t.slice(1, -1)));
  // block form: key: value lines, or key: followed by "- item" lines
  const o: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of t.split('\n')) {
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { (o[listKey] as unknown[]).push(scalar(item[1])); continue; }
    const i = line.indexOf(':');
    if (i < 0) return null;
    const k = String(scalar(line.slice(0, i)));
    const rest = line.slice(i + 1).trim();
    if (rest === '') { o[k] = []; listKey = k; } else { o[k] = value(rest); listKey = null; }
  }
  return Object.keys(o).length ? o : null;
}

export class WarnPolicy {
  private warnError = false;
  private error: string | string[] = [];
  private warn: string[] = [];
  private silence: string[] = [];

  /** throws the errors dbt raises while reading the flags */
  constructor(warnError: boolean, rawOptions: string | undefined, warnErrorGiven: boolean) {
    this.warnError = warnError;
    if (rawOptions === undefined) return;
    if (warnErrorGiven) throw new DbtError('Unhandled', 'warn_error_options: not allowed with argument warn_error');
    const o = parseYamlMapping(rawOptions);
    if (!o) {
      const e = new DbtError('Usage', `Invalid value for '--warn-error-options': String '${rawOptions}' is not valid YAML`);
      e.preface = 'The YAML provided in the --warn-error-options argument is not valid.';
      throw e;
    }
    // normalize_warn_error_options: include -> error, exclude -> warn (one or the other)
    const pick = (a: string, b: string) => {
      if (a in o && b in o) throw new DbtError('Unhandled', `Only \`${a}\` or \`${b}\` can be specified in \`warn_error_options\` config, not both`);
      return o[a] ?? o[b];
    };
    const err = pick('error', 'include');
    const wrn = pick('warn', 'exclude');
    this.error = err === null || err === undefined ? [] : (err as string | string[]);
    this.warn = (wrn ?? []) as string[];
    this.silence = (o.silence ?? []) as string[];
    // WarnErrorOptionsV2.__post_init__ (a ValidationError makes dbt crash with a Python traceback)
    if (typeof this.error === 'string' && !['all', '*'].includes(this.error)) throw new DbtError('Unhandled', "error must be one of ('all', '*') or a list of strings");
    if (this.warn.length && !(this.errorAll() || (Array.isArray(this.error) && this.error.includes('Deprecations')) || this.silence.includes('Deprecations'))) {
      throw new DbtError('Unhandled', "`warn` can only be specified if `error` is one of ('all', '*') or Deprecations is in `error` or silence.");
    }
    for (const list of [Array.isArray(this.error) ? this.error : [], this.warn, this.silence]) {
      for (const item of list) if (!VALID.has(item)) throw new DbtError('Unhandled', `${item} is not a valid dbt error name.`);
    }
  }

  private errorAll(): boolean {
    return typeof this.error === 'string' && ['all', '*'].includes(this.error);
  }

  /** true = raise (Compilation Error), false = print, null = silenced */
  decide(event: string, isDeprecation = false): boolean | null {
    if (this.warnError) return true;
    const errList = Array.isArray(this.error) ? this.error : [];
    const namedElsewhere = this.warn.includes(event) || this.silence.includes(event);
    const depElsewhere = isDeprecation && (this.warn.includes('Deprecations') || this.silence.includes('Deprecations'));
    if (errList.includes(event) && !namedElsewhere) return true;
    if (isDeprecation && errList.includes('Deprecations') && !(namedElsewhere || depElsewhere)) return true;
    if (this.errorAll() && !(namedElsewhere || depElsewhere)) return true;
    if (this.silence.includes(event)) return null;
    if (isDeprecation && this.silence.includes('Deprecations') && !errList.includes(event) && !this.warn.includes(event)) return null;
    return false;
  }
}

/** click's BoolParamType for env vars */
export function envBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'off', ''].includes(s)) return false;
  return undefined;
}
