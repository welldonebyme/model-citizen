// Renders the converter's blocks. Astro pages render it statically (zero JS); quiz islands reuse it.
import { createContext, Fragment, useContext, type CSSProperties, type ReactNode } from 'react';
import type { Block, Cell } from '../../lib/content-types';
import { url } from '../../lib/url';
import { Inline } from './Inline';
import { CodeBlock } from './CodeBlock';
import { Callout } from './Callout';
import { isCapstoneLab, labStepRefs } from '../../lib/lab-steps';

/** Inline SVG markup for figures (so CSS variables theme them). Astro pages provide it; islands fall back to <img>. */
export const FigureContext = createContext<Record<string, string>>({});
/** Static pages turn on the links to the YAML and Jinja playgrounds (labs/yaml/, labs/jinja/); islands do not. */
export const PlaygroundContext = createContext(false);

type Playground = { href: string; label: string; name: string };
const YAML_PG: Playground = { href: 'labs/yaml/', label: 'Try in the YAML playground', name: 'YAML playground' };
const JINJA_PG: Playground = { href: 'labs/jinja/', label: 'Try in the Jinja playground', name: 'Jinja playground' };
/** The playground that trains a book code block: YAML of Chapters 5 and 22, Jinja of Chapters 5 and 11. */
export function playgroundFor(b: Block): Playground | undefined {
  if (b.t !== 'code') return undefined;
  const ch = b.id.match(/^(ch\d+)-/)?.[1];
  if (b.lang === 'yaml' && (ch === 'ch05' || ch === 'ch22')) return YAML_PG;
  if ((b.lang === 'jinja' || (b.lang === 'dbt' && /\{[{%]/.test(b.text))) && (ch === 'ch05' || ch === 'ch11')) return JINJA_PG;
  return undefined;
}
function playgroundsIn(bs: Block[], out = new Set<Playground>()): Set<Playground> {
  for (const b of bs) {
    const p = playgroundFor(b);
    if (p) out.add(p);
    if (b.t === 'callout' || b.t === 'lab') playgroundsIn(b.blocks, out);
    if (b.t === 'list') b.items.forEach((it) => playgroundsIn(it.blocks, out));
  }
  return out;
}

export interface BlocksProps {
  blocks: Block[] | undefined;
  /** inside a lab: ordered lists become checkable steps */
  inLab?: boolean;
  /** the lab id, so steps can be saved */
  labId?: string;
}

/**
 * The book's figures are drawn at PDF size (text of 5 to 10 units in a viewBox about 400 wide). The sizes below
 * are where the figure's typical (median) text reaches a given px size: content.css draws figures up to 16 px
 * text on computers (never smaller than in the book), at 12 px text in a sideways scroll box on phones, and the
 * enlarged view (chrome.ts) at up to 18 px.
 */
export function figureSize(svg: string): CSSProperties | undefined {
  const vb = svg.match(/viewBox="[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/);
  const w = svg.match(/<svg\b[^>]*?\swidth="([\d.]+)"/);
  const fonts = [...svg.matchAll(/font-size(?:="|:\s*)([\d.]+)/g)].map((m) => Number(m[1])).filter((n) => n > 0).sort((a, b) => a - b);
  if (!vb || !w || !fonts.length) return undefined;
  const vbW = Number(vb[1]), vbH = Number(vb[2]), book = Number(w[1]);
  const med = fonts[Math.floor(fonts.length / 2)];
  const at = (px: number) => Math.round((vbW * px) / med);
  return {
    '--fig-max': `${Math.max(book, Math.min(at(16), book * 2))}px`,
    '--fig-phone': `${Math.max(book, at(12))}px`,
    '--fig-big': `${Math.max(book, at(18))}px`,
    '--fig-ratio': (vbW / vbH).toFixed(3),
  } as CSSProperties;
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
  const links = useContext(PlaygroundContext);
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
      if (b.kind === 'ul' && inLab && labId && isCapstoneLab(labId)) {
        // capstone milestone: the requirements are a checklist (ticks saved like lab steps)
        return (
          <ul className="mc-steps mc-reqs">
            {b.items.map((it, i) => (
              <li key={i} className="mc-step">
                <label className="mc-tick" data-n="">
                  <input type="checkbox" data-lab-step={`${labId}:r${i + 1}`} />
                  <span className="visually-hidden">Requirement {i + 1} done</span>
                </label>
                <div className="mc-step-body"><Blocks blocks={it.blocks} /></div>
              </li>
            ))}
          </ul>
        );
      }
      return b.kind === 'ol'
        ? <ol className="mc-ol" start={b.start}>{b.items.map((it, i) => <li key={i}><Blocks blocks={it.blocks} /></li>)}</ol>
        : <ul className="mc-ul">{b.items.map((it, i) => <li key={i}><Blocks blocks={it.blocks} /></li>)}</ul>;
    case 'code': {
      const pg = links ? playgroundFor(b) : undefined;
      return <CodeBlock block={b} runnable={runnable} playground={pg && { href: url(pg.href), label: pg.label }} />;
    }
    case 'callout': return <Callout kind={b.kind} title={b.title} os={b.os} anchor={b.anchor}><Blocks blocks={b.blocks} /></Callout>;
    case 'lab':
      return (
        <section className="mc-lab" id={b.id} data-lab={b.id} aria-labelledby={`${b.id}-t`}>
          {b.anchor && b.anchor !== b.id && <span className="mc-anchor" id={b.anchor} />}
          <header className="mc-lab-head">
            <span className="mc-lab-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M6.5 2h5M7.5 2v5L3 14.5A1.5 1.5 0 0 0 4.3 16.7h9.4A1.5 1.5 0 0 0 15 14.5L10.5 7V2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M5 12h8" stroke="currentColor" strokeWidth="1.7" /></svg>
            </span>
            <div>
              <p className="mc-lab-kicker">Hands-on lab</p>
              <h3 id={`${b.id}-t`}><Inline c={b.title} /></h3>
            </div>
            {b.objectives.length > 0 && <p className="mc-lab-objs" data-pagefind-ignore="">{b.objectives.map((o) => <Inline key={o} c={[{ t: 'obj', id: o }]} />)}</p>}
            {links && playgroundsIn(b.blocks).size > 0 && (
              <p className="mc-lab-try">Also in your browser: {[...playgroundsIn(b.blocks)].map((p, i) => <Fragment key={p.href}>{i > 0 && ' and '}<a href={url(p.href)}>the {p.name}</a></Fragment>)}, with exercises from this chapter.</p>
            )}
          </header>
          <div className="mc-lab-body">
            <Blocks blocks={b.blocks} inLab labId={b.id} />
            {labStepRefs(b)[0] === `${b.id}:done` && (
              <label className="mc-lab-done"><input type="checkbox" data-lab-step={`${b.id}:done`} /> <span>I did this lab</span></label>
            )}
          </div>
        </section>
      );
    case 'objectives':
      return (
        <section className="mc-objectives" aria-label="Exam objectives covered">
          <h3>Exam objectives covered</h3>
          <ul>{b.items.map((it, i) => <li key={i}>{it.id ? <Inline c={[{ t: 'obj', id: it.id }]} /> : <span className="mc-obj-none" aria-hidden="true" />}<span><Inline c={it.c} /></span></li>)}</ul>
        </section>
      );
    case 'table':
      // a space at the end of each cell keeps the words of two cells apart in the search index ("Item Rule")
      return (
        <div className="mc-table-wrap" tabIndex={0} role="region" aria-label="Table" id={b.anchor}>
          <table className="mc-table">
            {b.caption && <caption><Inline c={b.caption} /></caption>}
            {b.head && <thead>{b.head.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <th key={ci} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cell.align ? `mc-al-${cell.align}` : undefined}><CellContent c={cell.c} />{' '}</th>)}</tr>)}</thead>}
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className={b.groupRows?.includes(ri) ? 'mc-group' : undefined}>
                  {r.map((cell, ci) => cell.header
                    ? <th key={ci} scope="row" colSpan={cell.colspan} rowSpan={cell.rowspan}><CellContent c={cell.c} />{' '}</th>
                    : <td key={ci} colSpan={cell.colspan} rowSpan={cell.rowspan} className={cell.align ? `mc-al-${cell.align}` : undefined}><CellContent c={cell.c} />{' '}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'figure': {
      const svg = figs[b.id];
      return (
        <figure className="mc-fig" id={b.id} style={svg ? figureSize(svg) : undefined}>
          {b.anchor && b.anchor !== b.id && <span className="mc-anchor" id={b.anchor} />}
          {svg
            ? <>
                <div className="mc-fig-svg" role="img" aria-label={b.alt} dangerouslySetInnerHTML={{ __html: svg }} />
                <button type="button" className="mc-fig-zoom" data-fig-zoom={b.id} hidden>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 4.5V1h3.5M7.5 1H11v3.5M11 7.5V11H7.5M4.5 11H1V7.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                  Enlarge<span className="visually-hidden"> the figure</span>
                </button>
              </>
            : <div className="mc-fig-svg"><img src={url(`figures/${b.id}.svg`)} alt={b.alt} loading="lazy" /></div>}
          {b.caption && <figcaption><Inline c={b.caption} /></figcaption>}
        </figure>
      );
    }
    case 'quiz': return null;
    default: return null;
  }
}
