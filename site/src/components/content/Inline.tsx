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

function InlineNode({ n }: { n: InlineT }): ReactNode {
  if (typeof n === 'string') return n;
  switch (n.t) {
    case 'code': return <code className="mc-ic">{n.v}</code>;
    case 'b': return <strong><Inline c={n.c} /></strong>;
    case 'i': return <em><Inline c={n.c} /></em>;
    case 'u': return <span className="mc-u"><Inline c={n.c} /></span>;
    case 'sf': return <Inline c={n.c} />;
    case 'term':
      return (
        <a className="mc-term" href={url(`reference/glossary/#${n.id}`)} data-fr={n.fr}>
          <Inline c={n.en} />
          <span className="mc-term-fr" role="tooltip"><span lang="fr">FR : {n.fr}</span></span>
        </a>
      );
    case 'key': return <kbd className="mc-key">{n.v}</kbd>;
    case 'obj': return <a className="mc-obj" href={url(`reference/coverage/#obj-${n.id}`)} title={`Exam objective ${n.id}`}>{n.id}</a>;
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
