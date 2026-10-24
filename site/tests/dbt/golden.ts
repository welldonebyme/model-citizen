// Compare dbt outputs captured in the browser terminal with the golden builder logs (reference/builder-logs/chNN.md).
// Port of spikes/dbt-pyodide/tools/compare.py. Normalisation (only what may differ): timestamps, durations, the
// "N of M" start index and its dot padding, the home folder, thread interleaving (lines compared as a multiset;
// the order is reported apart) and the item order of the "Found ..." line.
import fs from 'node:fs';

export interface GoldenBlock { command: string; lines: string[] }

/** Every ```bash $ <cmd> ``` + ```text``` pair whose command contains exactly one dbt part. */
export function goldenBlocks(file: string): GoldenBlock[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: GoldenBlock[] = [];
  const re = /```bash\n\$ ([^\n]*)\n```\n(?:\(builder[^\n]*\n\n)?```text\n([\s\S]*?)```/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const parts = m[1].trim().split(/&&|;/).map((p) => p.trim());
    const dbt = parts.filter((p) => /^(\w+=\S+ )*dbt /.test(p));
    if (dbt.length !== 1) continue;
    out.push({ command: dbt[0], lines: m[2].replace(/\n$/, '').split('\n') });
  }
  return out;
}

const TS = /^\d\d:\d\d:\d\d {2}/;
export function normalize(line: string): string {
  let l = line.replace(TS, '');
  l = l.replace(/ in \d+\.\d+s\]/g, ' in Ns]');
  l = l.replace(/in 0 hours \d+ minutes and \d+\.\d+ seconds \(\d+\.\d+s\)/g, 'in T');
  l = l.replace(/^\d+ of (\d+) /, '# of $1 ');
  l = l.replace(/ \.{3,} /g, ' ... ');
  l = l.split('/home/pyodide').join('/Users/adnane');
  const m = l.match(/^Found (.*)$/);
  if (m) l = 'Found ' + m[1].split(', ').sort().join(', ');
  return l.replace(/\s+$/, '');
}

export interface CompareResult {
  command: string;
  status: 'match' | 'diff' | 'no-golden';
  sameOrder: boolean;
  goldenOnly: string[];
  browserOnly: string[];
}

function multisetDiff(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = counts.get(x) ?? 0;
    if (n > 0) counts.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

/** Compare captured blocks (in order) with the golden blocks: each command is matched with the first unused golden block. */
export function compare(golden: GoldenBlock[], captured: { command: string; lines: string[] }[]): CompareResult[] {
  const used = new Set<number>();
  return captured.map((c) => {
    const idx = golden.findIndex((g, i) => g.command === c.command && !used.has(i));
    if (idx < 0) return { command: c.command, status: 'no-golden', sameOrder: false, goldenOnly: [], browserOnly: [] };
    used.add(idx);
    const g = golden[idx].lines.map(normalize).filter((l) => l !== '');
    const s = c.lines.map(normalize).filter((l) => l !== '');
    const goldenOnly = multisetDiff(g, s);
    const browserOnly = multisetDiff(s, g);
    const same = !goldenOnly.length && !browserOnly.length;
    return { command: c.command, status: same ? 'match' : 'diff', sameOrder: same && g.join('\n') === s.join('\n'), goldenOnly, browserOnly };
  });
}

export function report(results: CompareResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.status === 'match' ? 'MATCH' : r.status === 'diff' ? 'DIFF ' : '??   '} ${r.status === 'match' ? (r.sameOrder ? '(same order)   ' : '(order differs)') : '               '} ${r.command}`);
    for (const l of r.goldenOnly) lines.push(`      golden only:  ${l.slice(0, 200)}`);
    for (const l of r.browserOnly) lines.push(`      browser only: ${l.slice(0, 200)}`);
  }
  const ok = results.filter((r) => r.status === 'match').length;
  lines.push(`== ${ok}/${results.length} commands match the golden output (multiset of normalised lines)`);
  return lines.join('\n');
}
