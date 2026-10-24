// Renders the converter's inline nodes. Used statically by Astro pages (no JS) and inside quiz islands.
import type { ReactNode } from 'react';
import type { Inline as InlineT } from '../../lib/content-types';
import { url } from '../../lib/url';

const ICONS: Record<string, string> = { check: '✓', checkbox: '☐', done: '✓', cross: '✗', warning: '⚠', arrow: '→' };
const href = (h: string) => (/^(https?:|mailto:|#)/.test(h) ? h : url(h));

export function Inline({ c }: { c: InlineT[] | undefined }): ReactNode {
  if (!c) return null;
  return c.map((n, i) => <InlineNode key={i} n={n} />);
}

/**
 * Inline code may wrap only at spaces and right after a separator (. / \ : , and a run of _), never inside a
 * name: "analytics.|crm.|accounts_v2", "stg_|jaffle_|shop__|orders". No break that leaves fewer than 3 characters
 * before it or fewer than 4 after it in the word, so "accounts_v2" and "schema.yml" stay whole. A part with a
 * hyphen stays on one line ("--resource-type", not "--|resource-type").
 * Identifier-like code (no space, at most 32 characters) gets mc-ic-id: table key columns keep it on one line.
 */
export function codeBreaks(v: string): ReactNode {
  const out: ReactNode[] = [];
  let k = 0;
  const part = (t: string) => out.push(t.includes('-') ? <span key={k++} className="mc-nw">{t}</span> : t);
  for (const word of v.split(/(\s+)/)) {
    if (!word) continue;
    if (/^\s/.test(word)) { out.push(word); continue; }
    let start = 0;
    for (let i = 0; word.length >= 8 && i < word.length; i++) {
      const c = word[i];
      if (!/[._/\\:,]/.test(c) || (c === '_' && word[i + 1] === '_')) continue;
      const end = i + 1;
      if (end - start >= 3 && word.length - end >= 4) {
        part(word.slice(start, end));
        out.push(<wbr key={k++} />);
        start = end;
      }
    }
    part(word.slice(start));
  }
  return out.length === 1 ? out[0] : out;
}

function InlineNode({ n }: { n: InlineT }): ReactNode {
  if (typeof n === 'string') return n;
  switch (n.t) {
    case 'code': return <code className={/^\S{1,32}$/.test(n.v) ? 'mc-ic mc-ic-id' : 'mc-ic'}>{codeBreaks(n.v)}</code>;
    case 'b': return <strong><Inline c={n.c} /></strong>;
    case 'i': return <em><Inline c={n.c} /></em>;
    case 'u': return <span className="mc-u"><Inline c={n.c} /></span>;
    case 'sf': return <Inline c={n.c} />;
    case 'term':
      return (
        <a className="mc-term" href={url(`reference/glossary/#${n.id}`)} data-fr={n.fr}>
          <Inline c={n.en} />
          <span className="mc-term-fr" role="tooltip" data-pagefind-ignore=""><span lang="fr">FR : {n.fr}</span><span className="mc-term-more">Tap the word again for the glossary.</span></span>
        </a>
      );
    case 'key': return <kbd className="mc-key">{n.v}</kbd>;
    case 'obj': return /^(CP0-[A-Z]+|\d+\.\d+)$/.test(n.id)
      ? <a className="mc-obj" href={url(`reference/coverage/#obj-${n.id}`)} title={`Exam objective ${n.id}`}>{n.id}</a>
      : <span className="mc-obj mc-obj-study" title={n.id === 'EXAM' ? 'About the exam itself' : 'Study method'}>{n.id === 'EXAM' ? 'Exam' : n.id === 'PLAN' ? 'Plan' : n.id === 'ALL' ? 'All' : n.id}</span>;
    case 'ref': return <a href={href(n.href)}>{n.text}</a>;
    case 'link': return <a href={n.href} rel="noopener" target="_blank"><Inline c={n.c} /></a>;
    case 'icon': return <span className="mc-icon" aria-hidden="true">{ICONS[n.name] ?? '•'}</span>;
    case 'blank': return <span className="mc-blank" aria-label="blank">{' '}</span>;
    case 'br': return <br />;
    default: return null;
  }
}

/** Plain text of inline content (for aria labels, search, sorting). */
export function inlineText(c: InlineT[] | undefined): string {
  if (!c) return '';
  return c.map((n) => {
    if (typeof n === 'string') return n;
    switch (n.t) {
      case 'code': case 'key': return n.v;
      case 'b': case 'i': case 'u': case 'sf': case 'link': return inlineText(n.c);
      case 'term': return inlineText(n.en);
      case 'obj': return n.id;
      case 'ref': return n.text;
      case 'blank': return '____';
      default: return '';
    }
  }).join('');
}
