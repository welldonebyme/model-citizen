// Hotspot: choose the line in a code block. Mouse/touch: click a line. Keyboard: Tab into the code,
// Up/Down (or Home/End) to move between lines, Enter or Space to choose.
import { useEffect, useRef } from 'react';
import type { CodeBlock as CodeBlockT, Question } from '../../lib/content-types';
import type { Response } from '../../lib/scoring';
import { CodeBlock } from '../content/CodeBlock';
import { Stem } from './Stem';
import { Mark } from './icons';

interface Props {
  q: Question;
  response: Response | undefined;
  onResponse: (r: Response | undefined) => void;
  locked?: boolean;
  review?: boolean;
  name: string;
  hideCopy?: boolean;
}

function HotspotCode({ block, line, onLine, locked, lineState, label }: {
  block: CodeBlockT; line: number | null; onLine: (n: number) => void; locked?: boolean; lineState?: Record<number, 'right' | 'wrong'>; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Roving tabindex: only one line is in the tab order (the chosen one, else the first).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const lines = Array.from(root.querySelectorAll<HTMLButtonElement>('button.mc-ln'));
    const active = lines.find((b) => b.getAttribute('aria-pressed') === 'true') ?? lines[0];
    for (const b of lines) {
      b.tabIndex = b === active ? 0 : -1;
      if (locked) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    }
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const root = ref.current;
    const t = e.target as HTMLElement;
    if (!root || !t.matches('button.mc-ln')) return;
    const lines = Array.from(root.querySelectorAll<HTMLButtonElement>('button.mc-ln'));
    const i = lines.indexOf(t as HTMLButtonElement);
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(lines.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = lines.length - 1;
    if (j < 0) return;
    e.preventDefault();
    lines.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; });
    lines[j].focus();
  };

  return (
    <div ref={ref} className="qz-hotspot" role="group" aria-label={label} onKeyDown={onKeyDown}>
      <CodeBlock
        block={{ ...block, lineNumbers: true, expected: undefined }}
        onLine={(n) => { if (!locked) onLine(n); }}
        selectedLine={line}
        lineState={lineState}
        hideCopy
      />
    </div>
  );
}

/** The hotspot data, with the converter's optional fields (several code blocks, numbers printed in the text). */
type HotspotData = { codeId: string; lines: number; numbering?: 'text' | 'listing'; parts?: { codeId: string; from: number; to: number }[] };

/** "1| select", " 2    - name: x": the book printed the line numbers in the code; the site shows them in the gutter. */
export function stripPrintedNumbers(text: string): string {
  return text.split('\n').map((l) => l.replace(/^\s*\d+(?:\|\s?|\s{2}|\s*$)/, '')).join('\n');
}

export function Hotspot({ q, response, onResponse, locked, review, hideCopy }: Props) {
  const line = response?.format === 'hotspot' ? response.line : null;
  const key = q.key as number;
  const lineState: Record<number, 'right' | 'wrong'> | undefined = review
    ? { ...(line != null && line !== key ? { [line]: 'wrong' as const } : {}), [key]: 'right' as const }
    : undefined;
  const hs = q.hotspot as HotspotData | undefined;
  const codeId = hs?.codeId;
  // a hotspot can span several code blocks (for example a macro, lines 1-6, and the model that calls it,
  // lines 7-12): every part is clickable and keeps its global line numbers
  const parts = hs?.parts?.length ? hs.parts : codeId ? [{ codeId, from: 0, to: 0 }] : [];
  const hasCode = q.stem.some((b) => b.t === 'code' && parts.some((p) => p.codeId === b.id));
  const label = `Code lines. Use the arrow keys to move, Enter to choose a line.${line != null ? ` Line ${line} is chosen.` : ''}`;

  return (
    <div className="qz-hotspot-q">
      <Stem
        blocks={q.stem}
        hideCopy={hideCopy}
        renderCode={(b) => {
          const part = parts.find((p) => p.codeId === b.id);
          if (!part && (hasCode || !b.lineNumbers)) return null;
          const block = {
            ...b,
            text: hs?.numbering === 'text' ? stripPrintedNumbers(b.text) : b.text,
            firstLine: part && part.from > 0 ? part.from : b.firstLine,
          };
          return <HotspotCode block={block} line={line} locked={locked} lineState={lineState} label={label} onLine={(n) => onResponse({ format: 'hotspot', line: n })} />;
        }}
      />
      <p className="qz-hint" aria-live="polite">{line != null ? <>You chose <b>line {line}</b>.</> : 'No line chosen yet.'}</p>
      {review && (
        <div className="qz-fill-review">
          <Mark ok={line === key} label={line === key ? 'Right line' : line == null ? 'No line chosen' : `Line ${line} is not the answer`} />
          <p>Correct answer: <b>line {key}</b>.</p>
        </div>
      )}
    </div>
  );
}
