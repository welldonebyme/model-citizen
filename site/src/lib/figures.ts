// Build-time only: SVG markup of the figures used by a page (inlined so CSS variables theme them).
import type { Block } from './content-types';

const FIGS = import.meta.glob('../generated/figures/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function figureIds(blocks: Block[], out = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if (b.t === 'figure') out.add(b.id);
    else if (b.t === 'callout' || b.t === 'lab') figureIds(b.blocks, out);
    else if (b.t === 'list') b.items.forEach((it) => figureIds(it.blocks, out));
  }
  return out;
}

export function figuresFor(blocks: Block[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of figureIds(blocks)) {
    const svg = FIGS[`../generated/figures/${id}.svg`];
    if (svg) map[id] = svg;
  }
  return map;
}
