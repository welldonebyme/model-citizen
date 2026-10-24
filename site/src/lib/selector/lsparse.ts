/**
 * Paste-to-verify for `dbt ls`: read what a learner pasted from the terminal and compare it with the
 * expected list. Tolerant of log lines (time stamps), "Found ..." lines, warnings, blank lines, prompts.
 */

export type LsFormat = 'selector' | 'name' | 'path' | 'json' | 'unknown';

export interface ParsedLs {
  /** node lines, in the pasted order */
  nodes: string[];
  /** log and warning lines that were skipped */
  logs: string[];
  format: LsFormat;
  noNodesSelected: boolean;
  errors: string[];
}

const TS = /^\s*\d{1,2}:\d{2}:\d{2}(\.\d+)?\s+/;
const PROMPT = /^\s*(\$|%|>|PS [^>]*>)\s*dbt\b/;

export function parseLsOutput(text: string): ParsedLs {
  const nodes: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let noNodes = false;
  let inError = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (PROMPT.test(line) || /^\s*dbt\s+(-q\s+)?(ls|list)\b/.test(line)) { logs.push(line); continue; }
    if (TS.test(line)) {
      const msg = line.replace(TS, '');
      logs.push(msg);
      if (/No nodes selected!/.test(msg)) noNodes = true;
      if (/Encountered an error/.test(msg)) inError = true;
      continue;
    }
    if (inError) { errors.push(line.trim()); continue; }
    if (/^(Running with dbt|Registered adapter|Found \d+)/.test(line.trim()) || /^\[WARNING\]/.test(line.trim())) { logs.push(line.trim()); continue; }
    nodes.push(line.trim());
  }
  return { nodes, logs, format: detectFormat(nodes), noNodesSelected: noNodes, errors };
}

export function detectFormat(lines: string[]): LsFormat {
  if (!lines.length) return 'unknown';
  if (lines.every((l) => l.startsWith('{'))) return 'json';
  if (lines.every((l) => /\.(sql|py|yml|yaml|csv)$/.test(l) && l.includes('/'))) return 'path';
  if (lines.some((l) => /^(source|exposure|unit_test|metric|saved_query|semantic_model):/.test(l)) || lines.every((l) => l.includes('.'))) return 'selector';
  return 'name';
}

export interface LsComparison {
  ok: boolean;
  missing: string[];
  extra: string[];
  sameOrder: boolean;
}

/** Compare as sets (dbt ls order is stable, but learners may sort or copy partially). JSON lines compare as objects. */
export function compareLs(expected: string[], pasted: string[]): LsComparison {
  const norm = (s: string) => {
    if (s.startsWith('{')) {
      try { return JSON.stringify(sortKeys(JSON.parse(s))); } catch { return s; }
    }
    return s.trim();
  };
  const e = expected.map(norm);
  const p = pasted.map(norm);
  const missing = expected.filter((_, i) => !p.includes(e[i]));
  const extra = pasted.filter((_, i) => !e.includes(p[i]));
  return { ok: !missing.length && !extra.length, missing, extra, sameOrder: JSON.stringify(e) === JSON.stringify(p) };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
