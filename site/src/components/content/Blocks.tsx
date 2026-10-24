// Renders the converter's blocks. Astro pages render it statically (zero JS); quiz islands reuse it.
import { createContext, useContext, type ReactNode } from 'react';
import type { Block, Cell } from '../../lib/content-types';
import { url } from '../../lib/url';
import { Inline } from './Inline';
import { CodeBlock } from './CodeBlock';
import { Callout } from './Callout';

/** Inline SVG markup for figures (so CSS variables theme them). Astro pages provide it; islands fall back to <img>. */
export const FigureContext = createContext<Record<string, string>>({});

export interface BlocksProps {
  blocks: Block[] | undefined;
  /** inside a lab: ordered lists become checkable steps */
  inLab?: boolean;
  /** the lab id, so steps can be saved */
  labId?: string;
}

const isBlocks = (c: Cell['c']): c is Block[] => {
  const f = Array.isArray(c) ? (c[0] as unknown) : undefined;
  if (!f || typeof f !== 'object') return false;
  const t = (f as { t?: string }).t;
  return t === 'p' || t === 'list' || t === 'table' || t === 'callout' || t === 'h' || (t === 'code' && 'lang' in (f as object));
};

function CellContent({ c }: { c: Cell['c'] }) {
  return isBlocks(c) ? <Blocks blocks={c} /> : <Inline c={c as never} />;
}

export function Blocks({ blocks, inLab, labId }: BlocksProps): ReactNode {
  if (!blocks) return null;
  const runnable = new Set(blocks.filter((b) => b.t === 'code' && b.expected).map((b) => (b as { id: string }).id));
  return blocks.map((b, i) => <BlockNode key={i} b={b} inLab={inLab} labId={labId} runnable={b.t === 'code' && runnable.has(b.id)} />);
}

function BlockNode({ b, inLab, labId, runnable }: { b: Block; inLab?: boolean; labId?: string; runnable: boolean }): ReactNode {
  const figs = useContext(FigureContext);
  switch (b.t) {
    case 'p': return <p className="mc-p"><Inline c={b.c} /></p>;
    case 'h': return b.level === 3
      ? <h3 className="mc-h" id={b.anchor}><Inline c={b.c} /></h3>
      : <h4 className="mc-h" id={b.anchor}><Inline c={b.c} /></h4>;
    case 'hr': return <hr />;
    case 'list':
      if (b.kind === 'dl') {
        return <dl className="mc-dl">{b.items.map((it, i) => (<div key={i}><dt><Inline c={it.term} /></dt><dd><Blocks blocks={it.blocks} /></dd></div>))}</dl>;
      }
      if (b.kind === 'ol' && inLab) {
        return (
          <ol className="mc-steps" start={b.start}>
            {b.items.map((it, i) => (
              <li key={i} className="mc-step">
                <label className="mc-tick" data-n={(b.start ?? 1) + i}>
                  <input type="checkbox" data-lab-step={labId ? `${labId}:${(b.start ?? 1) + i}` : undefined} />
                  <span className="visually-hidden">Step {(b.start ?? 1) + i} done</span>
                </label>
                <div className="mc-step-body"><Blocks blocks={it.blocks} /></div>
              </li>
            ))}
          </ol>
        );
      }
      return b.kind === 'ol'
        ? <ol className="mc-ol" start={b.start}>{b.items.map((it, i) => <li key={i}><Blocks blocks={it.blocks} /></li>)}</ol>
        : <ul className="mc-ul">{b.items.map((it, i) => <li key={i}><Blocks blocks={it.blocks} /></li>)}</ul>;
    case 'code': return <CodeBlock block={b} runnable={runnable} />;
    case 'callout': return <Callout kind={b.kind} title={b.title}><Blocks blocks={b.blocks} /></Callout>;
    case 'lab':
      return (
        <section className="mc-lab" id={b.id} data-lab={b.id} aria-labelledby={`${b.id}-t`}>
          <header className="mc-lab-head">
            <span className="mc-lab-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M6.5 2h5M7.5 2v5L3 14.5A1.5 1.5 0 0 0 4.3 16.7h9.4A1.5 1.5 0 0 0 15 14.5L10.5 7V2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M5 12h8" stroke="currentColor" strokeWidth="1.7" /></svg>
            </span>
            <div>
              <p className="mc-lab-kicker">Hands-on lab</p>
              <h3 id={`${b.id}-t`}><Inline c={b.title} /></h3>
            </div>
            {b.objectives.length > 0 && <p className="mc-lab-objs">{b.objectives.map((o) => <Inline key={o} c={[{ t: 'obj', id: o }]} />)}</p>}
          </header>
          <div className="mc-lab-body"><Blocks blocks={b.blocks} inLab labId={b.id} /></div>
        </section>
      );
    case 'objectives':
      return (
        <section className="mc-objectives" aria-label="Exam objectives covered">
          <h3>Exam objectives covered</h3>
          <ul>{b.items.map((it) => <li key={it.id}><Inline c={[{ t: 'obj', id: it.id }]} /><span><Inline c={it.c} /></span></li>)}</ul>
        </section>
      );
    case 'table':
      return (
        <div className="mc-table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="mc-table">
            {b.caption && <caption><Inline c={b.caption} /></caption>}
            {b.head && <thead>{b.head.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <th key={ci} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cell.align ? `mc-al-${cell.align}` : undefined}><CellContent c={cell.c} /></th>)}</tr>)}</thead>}
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className={b.groupRows?.includes(ri) ? 'mc-group' : undefined}>
                  {r.map((cell, ci) => cell.header
                    ? <th key={ci} scope="row" colSpan={cell.colspan} rowSpan={cell.rowspan}><CellContent c={cell.c} /></th>
                    : <td key={ci} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cell.align ? `mc-al-${cell.align}` : undefined}><CellContent c={cell.c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'figure': {
      const svg = figs[b.id];
      return (
        <figure className="mc-fig" id={b.id}>
          {svg
            ? <div className="mc-fig-svg" role="img" aria-label={b.alt} dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="mc-fig-svg"><img src={url(`figures/${b.id}.svg`)} alt={b.alt} loading="lazy" /></div>}
          {b.caption && <figcaption><Inline c={b.caption} /></figcaption>}
        </figure>
      );
    }
    case 'quiz': return null;
    default: return null;
  }
}
