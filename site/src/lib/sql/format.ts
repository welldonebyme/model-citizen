/**
 * Convert an Apache Arrow table returned by DuckDB-WASM into display strings that look like the
 * book's output (DuckDB CLI / Python `str()` style): 5.0 for a whole DOUBLE, 2025-01-05 for a DATE,
 * 2025-01-06 02:51:00 for a TIMESTAMP, exact DECIMAL / HUGEINT digits, NULL as null.
 * Ported from spikes/duckdb-wasm/src/lib/format.ts.
 *
 * Duck-typed on the Arrow `Type` ids so that it does not import apache-arrow itself.
 */
import type { Cell } from './compare.ts';

// apache-arrow `Type` enum values (stable across Arrow JS versions)
const T = {
  Null: 1, Int: 2, Float: 3, Binary: 4, Utf8: 5, Bool: 6, Decimal: 7, Date: 8, Time: 9, Timestamp: 10,
  Interval: 11, List: 12, Struct: 13, Union: 14, FixedSizeBinary: 15, FixedSizeList: 16, Map: 17,
  Duration: 18, LargeBinary: 19, LargeUtf8: 20,
} as const;

interface ArrowFieldLike { name: string; type: { typeId: number; scale?: number; unit?: number; timezone?: string | null; children?: ArrowFieldLike[]; toString(): string } }
interface ArrowVectorLike { get(i: number): unknown; length: number }
export interface ArrowTableLike {
  numRows: number;
  schema: { fields: ArrowFieldLike[] };
  getChildAt(i: number): ArrowVectorLike | null;
}

export interface ResultSet { columns: string[]; types: string[]; rows: Cell[][]; numeric: boolean[] }

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  return `${y < 0 ? '-' : ''}${pad(Math.abs(y), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatTimestamp(ms: number, micros?: number): string {
  const d = new Date(Math.floor(ms));
  let s = `${formatDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const us = micros ?? Math.round((ms - Math.floor(ms / 1000) * 1000) * 1000);
  if (us > 0) s += '.' + String(us).padStart(6, '0');
  return s;
}

function formatFloat(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1); // Python: str(5.0) == '5.0'
  return String(x);
}

function formatDecimal(v: unknown, scale: number): string {
  // Arrow JS returns a BN (Uint32Array subclass) whose toString() is the unscaled integer
  let digits = typeof v === 'bigint' ? v.toString() : String(v);
  if (scale <= 0) return digits;
  const neg = digits.startsWith('-');
  if (neg) digits = digits.slice(1);
  digits = digits.padStart(scale + 1, '0');
  return `${neg ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function formatTime(v: unknown, unit: number): string {
  // Arrow JS returns the raw value in the column's unit (DuckDB uses microseconds)
  const us = unit === 0 ? Number(v) * 1e6 : unit === 1 ? Number(v) * 1e3 : unit === 2 ? Number(v) : Number(v) / 1e3;
  const total = Math.floor(us / 1e6);
  const frac = Math.round(us % 1e6);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}${frac ? '.' + String(frac).padStart(6, '0') : ''}`;
}

function formatValue(v: unknown, f: ArrowFieldLike): Cell {
  if (v === null || v === undefined) return null;
  const t = f.type;
  switch (t.typeId) {
    case T.Int:
      return typeof v === 'bigint' ? v.toString() : String(v);
    case T.Float:
      return formatFloat(Number(v));
    case T.Decimal:
      return formatDecimal(v, t.scale ?? 0);
    case T.Bool:
      return v ? 'true' : 'false';
    case T.Utf8:
    case T.LargeUtf8:
      return String(v);
    case T.Date:
      return formatDate(v instanceof Date ? v.getTime() : Number(v));
    case T.Timestamp: {
      const ms = v instanceof Date ? v.getTime() : Number(v);
      const s = formatTimestamp(ms);
      return t.timezone ? `${s}+00` : s;
    }
    case T.Time:
      return formatTime(v, t.unit ?? 2);
    case T.Binary:
    case T.LargeBinary:
    case T.FixedSizeBinary:
      return Array.from(v as Uint8Array, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
    default:
      return stringifyNested(v);
  }
}

/** Best effort for LIST / STRUCT / MAP / INTERVAL ... (DuckDB-like: [1, 2], {'a': 1}) */
function stringifyNested(v: unknown): string {
  const inner = (x: unknown): string => {
    if (x === null || x === undefined) return 'NULL';
    if (typeof x === 'string') return `'${x}'`;
    if (typeof x === 'bigint' || typeof x === 'number' || typeof x === 'boolean') return String(x);
    const anyX = x as { toArray?: () => unknown[]; toJSON?: () => unknown };
    if (typeof anyX.toArray === 'function' && !(x instanceof Uint8Array)) {
      const arr = anyX.toArray();
      if (Array.isArray(arr) || ArrayBuffer.isView(arr)) return '[' + Array.from(arr as ArrayLike<unknown>, inner).join(', ') + ']';
    }
    if (typeof anyX.toJSON === 'function') {
      const j = anyX.toJSON();
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        return '{' + Object.entries(j).map(([k, val]) => `'${k}': ${inner(val)}`).join(', ') + '}';
      }
      return inner(j);
    }
    if (Array.isArray(x) || ArrayBuffer.isView(x)) return '[' + Array.from(x as ArrayLike<unknown>, inner).join(', ') + ']';
    return String(x);
  };
  return inner(v);
}

const NUMERIC = new Set<number>([T.Int, T.Float, T.Decimal]);

export function arrowToResultSet(table: ArrowTableLike, maxRows = Infinity): ResultSet {
  const fields = table.schema.fields;
  const n = Math.min(table.numRows, maxRows);
  const cols = fields.map((_, i) => table.getChildAt(i));
  const rows: Cell[][] = [];
  for (let r = 0; r < n; r++) {
    rows.push(fields.map((f, c) => formatValue(cols[c]?.get(r), f)));
  }
  return {
    columns: fields.map((f) => f.name),
    types: fields.map((f) => String(f.type)),
    numeric: fields.map((f) => NUMERIC.has(f.type.typeId)),
    rows,
  };
}

/** JSON-friendly value for Python (the Jinja worker's run_query): numbers stay numbers, dates become text. */
export type JsonCell = string | number | boolean | null;

function jsonValue(v: unknown, f: ArrowFieldLike): JsonCell {
  if (v === null || v === undefined) return null;
  switch (f.type.typeId) {
    case T.Int: {
      if (typeof v === 'bigint') return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
      return Number(v);
    }
    case T.Float: return Number(v);
    case T.Decimal: return Number(formatDecimal(v, f.type.scale ?? 0));
    case T.Bool: return Boolean(v);
    default: return formatValue(v, f);
  }
}

export function arrowToJson(table: ArrowTableLike, maxRows = 10_000): { columns: string[]; rows: JsonCell[][] } {
  const fields = table.schema.fields;
  const cols = fields.map((_, i) => table.getChildAt(i));
  const rows: JsonCell[][] = [];
  for (let r = 0; r < Math.min(table.numRows, maxRows); r++) rows.push(fields.map((f, c) => jsonValue(cols[c]?.get(r), f)));
  return { columns: fields.map((f) => f.name), rows };
}
