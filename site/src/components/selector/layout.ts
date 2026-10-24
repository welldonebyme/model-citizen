/**
 * A small layered DAG layout (left to right) for < 200 nodes, no dependency:
 *  1. layers: sources first; every other node one layer after its latest parent; nodes without parents
 *     (seeds) move right next to their first child
 *  2. long edges get invisible "dummy" points, one per crossed layer
 *  3. order inside each layer: barycenter sweeps (down and up) to reduce crossings
 *  4. y positions: each node moves toward the mean y of its neighbours, without overlapping
 */

export interface LayoutInput {
  id: string;
  /** smaller box for tests */
  small?: boolean;
  /** force the first column (sources) */
  first?: boolean;
}

export interface Placed {
  id: string;
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  small: boolean;
}

export interface RoutedEdge {
  from: string;
  to: string;
  /** points from the right port of `from` to the left port of `to` */
  points: { x: number; y: number }[];
}

export interface Layout {
  nodes: Map<string, Placed>;
  edges: RoutedEdge[];
  width: number;
  height: number;
  layers: string[][];
}

export const BOX_W = 184;
export const TEST_W = 164;
export const BOX_H = 46;
export const SMALL_H = 28;
const COL_GAP = 64;
const ROW_GAP = 14;
const PAD = 24;

export function layoutDag(inputs: LayoutInput[], edgesIn: [string, string][]): Layout {
  const ids = inputs.map((n) => n.id);
  const known = new Set(ids);
  const meta = new Map(inputs.map((n) => [n.id, n]));
  const edges = edgesIn.filter(([a, b]) => known.has(a) && known.has(b) && a !== b);
  const parents = new Map<string, string[]>(ids.map((i) => [i, []]));
  const children = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const [a, b] of edges) { parents.get(b)!.push(a); children.get(a)!.push(b); }

  // 1. longest-path layering of the main nodes (tests are placed after, in half columns)
  const isSmall = (id: string) => !!meta.get(id)?.small;
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const mainParents = (id: string) => parents.get(id)!.filter((p) => !isSmall(p));
  const mainChildren = (id: string) => children.get(id)!.filter((c) => !isSmall(c));
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = mainParents(id);
    const l = meta.get(id)?.first || ps.length === 0 ? 0 : Math.max(...ps.map(depth)) + 1;
    visiting.delete(id);
    layer.set(id, l);
    return l;
  };
  ids.filter((i) => !isSmall(i)).forEach(depth);
  // roots that are not sources (seeds): just before their first child
  for (const id of ids) {
    if (isSmall(id) || meta.get(id)?.first || mainParents(id).length) continue;
    const cs = mainChildren(id);
    if (cs.length) layer.set(id, Math.max(0, Math.min(...cs.map((c) => layer.get(c)!)) - 1));
  }
  // tests: in the half column right after their latest parent
  const anySmall = ids.some(isSmall);
  if (anySmall) {
    for (const id of ids) if (!isSmall(id)) layer.set(id, layer.get(id)! * 2);
    for (const id of ids) {
      if (!isSmall(id)) continue;
      const ps = parents.get(id)!.filter((p) => !isSmall(p));
      layer.set(id, ps.length ? Math.max(...ps.map((p) => layer.get(p)!)) + 1 : 1);
    }
  }

  // 2. dummies
  type V = { id: string; dummy: boolean };
  const vparents = new Map<string, string[]>();
  const vchildren = new Map<string, string[]>();
  const vlayer = new Map<string, number>(layer);
  const addV = (id: string) => { if (!vparents.has(id)) { vparents.set(id, []); vchildren.set(id, []); } };
  ids.forEach(addV);
  const chains = new Map<string, string[]>(); // edge key -> vertex chain
  let dn = 0;
  for (const [a, b] of edges) {
    const la = layer.get(a)!;
    const lb = layer.get(b)!;
    const chain = [a];
    for (let l = la + 1; l < lb; l++) { const d = `__d${dn++}`; addV(d); vlayer.set(d, l); chain.push(d); }
    chain.push(b);
    for (let i = 0; i < chain.length - 1; i++) { vchildren.get(chain[i])!.push(chain[i + 1]); vparents.get(chain[i + 1])!.push(chain[i]); }
    chains.set(`${a}\u0000${b}`, chain);
  }
  const maxLayer = Math.max(0, ...vlayer.values());
  const layers: V[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const [id, l] of vlayer) layers[l].push({ id, dummy: id.startsWith('__d') });
  // initial order: by name (stable), sources by name
  for (const L of layers) L.sort((x, y) => (x.dummy === y.dummy ? (x.id < y.id ? -1 : 1) : x.dummy ? 1 : -1));

  // 3. barycenter sweeps
  const pos = new Map<string, number>();
  const index = () => layers.forEach((L) => L.forEach((v, i) => pos.set(v.id, i)));
  index();
  const bary = (id: string, nb: Map<string, string[]>) => {
    const ns = nb.get(id)!;
    if (!ns.length) return pos.get(id)!;
    return ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length;
  };
  for (let iter = 0; iter < 8; iter++) {
    const down = iter % 2 === 0;
    const order = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).reverse().slice(1);
    for (const li of order) {
      const nb = down ? vparents : vchildren;
      const L = layers[li];
      const keyed = L.map((v) => ({ v, k: bary(v.id, nb) }));
      keyed.sort((a, b) => a.k - b.k || pos.get(a.v.id)! - pos.get(b.v.id)!);
      layers[li] = keyed.map((x) => x.v);
      layers[li].forEach((v, i) => pos.set(v.id, i));
    }
  }

  // 4. y positions
  const h = (id: string) => (id.startsWith('__d') ? 4 : meta.get(id)?.small ? SMALL_H : BOX_H);
  const y = new Map<string, number>();
  for (const L of layers) {
    let cur = 0;
    for (const v of L) { y.set(v.id, cur + h(v.id) / 2); cur += h(v.id) + ROW_GAP; }
  }
  const centre = (id: string) => y.get(id)!;
  for (let iter = 0; iter < 12; iter++) {
    for (const L of layers) {
      const want = L.map((v) => {
        const ns = [...vparents.get(v.id)!, ...vchildren.get(v.id)!];
        return ns.length ? ns.reduce((s, n) => s + centre(n), 0) / ns.length : centre(v.id);
      });
      // place in order, as close as possible to `want`, keeping the gaps (forward then backward pass)
      const n = L.length;
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const min = i === 0 ? h(L[i].id) / 2 : out[i - 1] + h(L[i - 1].id) / 2 + ROW_GAP + h(L[i].id) / 2;
        out[i] = Math.max(min, (want[i] + centre(L[i].id)) / 2);
      }
      for (let i = n - 2; i >= 0; i--) {
        const max = out[i + 1] - h(L[i + 1].id) / 2 - ROW_GAP - h(L[i].id) / 2;
        if (out[i] > max) out[i] = Math.max(i === 0 ? h(L[i].id) / 2 : -Infinity, max);
      }
      L.forEach((v, i) => y.set(v.id, out[i]));
    }
  }
  // normalise so that the smallest top edge is at PAD
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (const [id, cy] of y) { minTop = Math.min(minTop, cy - h(id) / 2); maxBottom = Math.max(maxBottom, cy + h(id) / 2); }
  const shift = PAD - minTop;

  // column x: each layer is as wide as its widest box (a layer with only edge points has no width)
  const colW = layers.map((L) => Math.max(0, ...L.filter((v) => !v.dummy).map((v) => (isSmall(v.id) ? TEST_W : BOX_W))));
  const colX: number[] = [];
  let cx0 = PAD;
  for (let l = 0; l < layers.length; l++) {
    colX.push(cx0);
    cx0 += colW[l] + (colW[l] > 0 ? COL_GAP : COL_GAP / 2);
  }
  const placed = new Map<string, Placed>();
  for (const id of ids) {
    const l = layer.get(id)!;
    const small = isSmall(id);
    const hh = small ? SMALL_H : BOX_H;
    placed.set(id, { id, layer: l, x: colX[l], y: y.get(id)! + shift - hh / 2, w: small ? TEST_W : BOX_W, h: hh, small });
  }
  const routed: RoutedEdge[] = edges.map(([a, b]) => {
    const chain = chains.get(`${a}\u0000${b}`)!;
    const pa = placed.get(a)!;
    const pb = placed.get(b)!;
    const pts = [{ x: pa.x + pa.w, y: pa.y + pa.h / 2 }];
    for (const d of chain.slice(1, -1)) {
      const l = vlayer.get(d)!;
      const cx = colX[l];
      pts.push({ x: cx, y: y.get(d)! + shift });
      if (colW[l] > 0) pts.push({ x: cx + colW[l], y: y.get(d)! + shift });
    }
    pts.push({ x: pb.x, y: pb.y + pb.h / 2 });
    return { from: a, to: b, points: pts };
  });
  return {
    nodes: placed,
    edges: routed,
    width: cx0 - COL_GAP + PAD,
    height: maxBottom - minTop + PAD * 2,
    layers: layers.map((L) => L.filter((v) => !v.dummy).map((v) => v.id)),
  };
}

/** SVG path through the points: horizontal tangents at each point (the curved "lineage" style). */
export function edgePath(points: { x: number; y: number }[]): string {
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.abs(a.y - b.y) < 0.5) { d += ` L${b.x.toFixed(1)} ${b.y.toFixed(1)}`; continue; }
    const dx = Math.max(24, (b.x - a.x) / 2);
    d += ` C${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)}, ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}
