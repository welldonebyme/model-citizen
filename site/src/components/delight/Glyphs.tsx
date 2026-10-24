// Badge glyphs and the small "node" they sit in (the DAG motif of the site: nodes, ports, edges).
import type { Glyph } from '../../lib/gamification';

const TEXT: Partial<Record<Glyph, string>> = { seven: '7', thirty: '30', perfect: '100', domc: '20', mock: '80' };

const PATHS: Partial<Record<Glyph, string>> = {
  lesson: '<path d="M3 5.6c2.4-1 4.6-1 7 .6 2.4-1.6 4.6-1.6 7-.6v9.8c-2.4-1-4.6-1-7 .6-2.4-1.6-4.6-1.6-7-.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 6.4v9.6" stroke="currentColor" stroke-width="1.6"/>',
  explain: '<path d="M4.5 4.5h11a1.6 1.6 0 0 1 1.6 1.6v6.2a1.6 1.6 0 0 1-1.6 1.6H10l-3.6 2.8v-2.8H4.5a1.6 1.6 0 0 1-1.6-1.6V6.1a1.6 1.6 0 0 1 1.6-1.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.5 8h7M6.5 10.6h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  model: '<rect x="5" y="6" width="10" height="8" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="10" r="1.6" fill="currentColor"/><circle cx="15" cy="10" r="1.6" fill="currentColor"/><path d="M8 10h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  build: '<circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10.3l2.1 2.1 4-4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  formats: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" fill="currentColor"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" fill="currentColor"/><rect x="11" y="11" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  memory: '<rect x="6.5" y="3.5" width="10" height="11.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 6.5v9.2A1.8 1.8 0 0 0 5.8 17.5H13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M9 7.5h5M9 10h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  focus: '<circle cx="10" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 7.6V11l2.4 1.6M8 2.8h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  capstone: '<path d="M5.5 17.5V3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M5.5 3.8h9.5l-2.3 3.3 2.3 3.3H5.5" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  notebook: '<rect x="4.5" y="3" width="11" height="14" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 3v14M10 7h3M10 9.8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ready: '<rect x="3.5" y="4.5" width="13" height="12" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 8h13M7 3v3M13 3v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7.4 12.2l1.8 1.8 3.5-3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function GlyphSvg({ glyph, size = 20 }: { glyph: Glyph; size?: number }) {
  const text = TEXT[glyph];
  if (text) {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <text x="10" y="14.2" textAnchor="middle" fontSize={text.length > 2 ? 8.6 : text.length > 1 ? 10.5 : 13} fontWeight="800" fill="currentColor" fontFamily="var(--sans)">{text}</text>
      </svg>
    );
  }
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: PATHS[glyph] ?? '' }} />;
}

/** A badge as a node of the graph: filled and ringed when earned, dashed when not yet. */
export function BadgeNode({ glyph, earned, size = 44 }: { glyph: Glyph; earned: boolean; size?: number }) {
  return (
    <span className="dl-node" data-earned={earned || undefined} style={{ width: size, height: size }} aria-hidden="true">
      <GlyphSvg glyph={glyph} size={Math.round(size * 0.5)} />
      {earned && (
        <span className="dl-node-check">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2l2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
    </span>
  );
}
