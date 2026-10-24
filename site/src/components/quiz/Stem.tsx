// Renders a question stem with the shared content renderer, with two hooks:
// - fill in the blank: every inline blank node becomes an input (renderBlank);
// - hotspot: the code block named by the question becomes a clickable code block (renderCode).
// Code blocks in stems never show "Run in workspace"; in exam mode they have no copy button.
import type { ReactNode } from 'react';
import type { Block, CodeBlock as CodeBlockT, Inline as InlineT } from '../../lib/content-types';
import { Blocks } from '../content/Blocks';
import { Inline } from '../content/Inline';
import { CodeBlock } from '../content/CodeBlock';

export interface StemProps {
  blocks: Block[];
  renderBlank?: (index: number) => ReactNode | null;
  renderCode?: (block: CodeBlockT) => ReactNode | null;
  hideCopy?: boolean;
}

const hasBlank = (c: InlineT[]): boolean =>
  c.some((n) => typeof n === 'object' && (n.t === 'blank' || ('c' in n && Array.isArray(n.c) && hasBlank(n.c as InlineT[]))));

export function Stem({ blocks, renderBlank, renderCode, hideCopy }: StemProps) {
  const counter = { n: 0 };

  const inline = (c: InlineT[]): ReactNode[] =>
    c.map((n, i) => {
      if (typeof n === 'object' && n.t === 'blank' && renderBlank) {
        const input = renderBlank(counter.n++);
        return input ? <span key={i} className="qz-blank-slot">{input}</span> : <Inline key={i} c={[n]} />;
      }
      if (typeof n === 'object' && (n.t === 'b' || n.t === 'i' || n.t === 'u') && renderBlank && hasBlank(n.c)) {
        const kids = inline(n.c);
        return n.t === 'b' ? <strong key={i}>{kids}</strong> : n.t === 'i' ? <em key={i}>{kids}</em> : <span key={i} className="mc-u">{kids}</span>;
      }
      return <Inline key={i} c={[n]} />;
    });

  const block = (b: Block, i: number): ReactNode => {
    if (b.t === 'code') {
      const custom = renderCode?.(b);
      if (custom) return <div key={i}>{custom}</div>;
      const { expected: _e, ...plainBlock } = b;
      void _e;
      return <CodeBlock key={i} block={plainBlock} hideCopy={hideCopy} />;
    }
    if (b.t === 'p' && renderBlank && hasBlank(b.c)) return <p key={i} className="mc-p">{inline(b.c)}</p>;
    if (b.t === 'list' && renderBlank) {
      const Tag = b.kind === 'ol' ? 'ol' : 'ul';
      return <Tag key={i} className={b.kind === 'ol' ? 'mc-ol' : 'mc-ul'}>{b.items.map((it, k) => <li key={k}>{it.blocks.map(block)}</li>)}</Tag>;
    }
    return <Blocks key={i} blocks={[b]} />;
  };

  return <div className="qz-stem">{blocks.map(block)}</div>;
}
