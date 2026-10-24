// Fill in the blank. The input sits inside the stem where the book prints the blank. A blank inside a
// code block (a run of ___) gets its input right under that code block. Blanks are numbered in reading
// order, whatever mix of sentence and code blanks the stem has (fill.ts).
import type { Question } from '../../lib/content-types';
import { grade, type Response } from '../../lib/scoring';
import { fillPlan } from '../../lib/exam/fill';
import { CodeBlock } from '../content/CodeBlock';
import { Stem } from './Stem';
import { Mark } from './icons';

type FillResponse = Extract<Response, { format: 'fill' }> & { parts?: string[] };

interface Props {
  q: Question;
  response: Response | undefined;
  onResponse: (r: Response | undefined) => void;
  locked?: boolean;
  review?: boolean;
  name: string;
  hideCopy?: boolean;
  onEnter?: () => void;
}

export function partsOf(r: Response | undefined, count: number): string[] {
  const f = r?.format === 'fill' ? (r as FillResponse) : undefined;
  const parts = f?.parts ?? (f?.text ? (count > 1 ? f.text.split(/\s*,\s*/) : [f.text]) : []);
  return Array.from({ length: count }, (_, i) => parts[i] ?? '');
}

export function FillBlank({ q, response, onResponse, locked, review, name, hideCopy, onEnter }: Props) {
  const plan = fillPlan(q);
  const count = plan.count;
  const parts = partsOf(response, count);
  const g = review ? grade(q, response) : null;
  const key = q.key as { accepted?: string[]; blanks?: string[][] };

  const set = (i: number, v: string) => {
    if (locked) return;
    const next = parts.map((p, k) => (k === i ? v : p));
    if (next.every((p) => !p.trim())) { onResponse(undefined); return; }
    const r: FillResponse = { format: 'fill', text: count > 1 ? next.map((p) => p.trim()).join(', ') : next[0], parts: next };
    onResponse(r);
  };

  const label = (i: number) => (count > 1 ? `Blank ${i + 1} of ${count}` : 'Your answer for the blank');
  const partOk = (i: number) => (g ? (count > 1 && g.parts ? !!g.parts[String(i + 1)] : g.correct) : undefined);

  const input = (i: number, cls = '') => (
    <input
      className={`qz-fill ${cls}`}
      id={`${name}-b${i}`}
      type="text"
      value={parts[i]}
      aria-label={label(i)}
      autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      readOnly={locked}
      data-state={g ? (partOk(i) ? 'right' : 'wrong') : undefined}
      size={Math.max(10, parts[i].length + 2)}
      onChange={(e) => set(i, e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
    />
  );

  const rows = (indices: number[], where: string) => (
    <div className="qz-fill-list">
      {indices.map((i) => (
        <p key={i} className="qz-fill-row">
          <label htmlFor={`${name}-b${i}`}>{count > 1 ? `Blank ${i + 1}` : 'Your answer'}{where && <span className="qz-muted"> {where}</span>}</label>
          {input(i)}
        </p>
      ))}
    </div>
  );

  return (
    <div className="qz-fill-q">
      <Stem
        blocks={q.stem}
        hideCopy={hideCopy}
        renderBlank={(k) => { const i = plan.inline[k]; return i !== undefined && i >= 0 ? input(i, 'qz-fill-inline') : null; }}
        renderCode={(b) => {
          const indices = plan.code[b.id];
          if (!indices?.length) return null;
          const { expected: _e, ...block } = b;
          void _e;
          return (
            <>
              <CodeBlock block={block} hideCopy={hideCopy} />
              {rows(indices, indices.length > 1 || count > 1 ? '(in the code above)' : '')}
              {indices.length > 1 && <p className="qz-hint">The blanks are marked <code className="mc-ic">___</code> in the code, from left to right.</p>}
            </>
          );
        }}
      />
      {plan.extra.length > 0 && rows(plan.extra, '')}
      {plan.sameWord && <p className="qz-hint">The same answer goes in every blank.</p>}
      {review && g && (
        <div className="qz-fill-review">
          <Mark ok={g.correct} label={g.correct ? (count > 1 ? 'Every blank is accepted' : 'Your answer is accepted') : (count > 1 ? 'Not every blank is accepted' : 'Your answer is not accepted')} />
          {key.blanks ? (
            <ul className="qz-fill-blanks">
              {key.blanks.map((acc, i) => (
                <li key={i}>
                  <span>Blank {i + 1}: you typed <code className="mc-ic">{parts[i]?.trim() || '(nothing)'}</code>.</span>
                  {' '}<span>Accepted: {acc.map((a, k) => <span key={a}>{k > 0 && ' or '}<code className="mc-ic">{a}</code></span>)}.</span>
                  {' '}{g.parts && <Mark ok={!!g.parts[String(i + 1)]} />}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>You typed: <code className="mc-ic">{response?.format === 'fill' && response.text.trim() ? response.text : '(nothing)'}</code></p>
              <p>{(key.accepted ?? []).length > 1 ? 'Accepted answers: ' : 'Accepted answer: '}{(key.accepted ?? []).map((a, k) => <span key={a}>{k > 0 && ' or '}<code className="mc-ic">{a}</code></span>)}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
