/** Python difflib.SequenceMatcher.ratio() and get_close_matches(), ported (no junk: words are short). */

function longest(a: string, b: string, alo: number, ahi: number, blo: number, bhi: number, b2j: Map<string, number[]>): [number, number, number] {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      next.set(j, k);
      if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
    }
    j2len = next;
  }
  return [besti, bestj, bestsize];
}

export function ratio(a: string, b: string): number {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) { const l = b2j.get(b[j]) ?? []; l.push(j); b2j.set(b[j], l); }
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(a, b, alo, ahi, blo, bhi, b2j);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  const t = a.length + b.length;
  return t ? (2 * matches) / t : 1;
}

/** difflib.get_close_matches(word, possibilities, n, cutoff): best first (score, then string, descending). */
export function getCloseMatches(word: string, possibilities: string[], n = 3, cutoff = 0.6): string[] {
  const scored = possibilities.map((x) => ({ x, s: ratio(x, word) })).filter((r) => r.s >= cutoff);
  scored.sort((p, q) => q.s - p.s || (q.x > p.x ? 1 : q.x < p.x ? -1 : 0));
  return scored.slice(0, n).map((r) => r.x);
}
