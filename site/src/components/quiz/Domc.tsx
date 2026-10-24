// DOMC (Discrete Option Multiple Choice), like the real exam: the stem, then one option at a time.
// YES / NO buttons, or the Y and N keys. A judged option is locked and hidden. The question may end
// early (rules from Settings), and one extra option may still appear after that.
// In exam mode the options come in a seeded random order and have no letters; the review shows the
// book letters and each judgment against the key.
import { useEffect, useRef, useState } from 'react';
import type { Question } from '../../lib/content-types';
import { Inline } from '../content/Inline';
import { domcCurrent, domcShown, type DomcRules, type DomcState } from '../../lib/exam/domc';
import { plain } from '../../lib/exam/describe';
import { Mark } from './icons';

interface Props {
  q: Question;
  state: DomcState;
  rules: DomcRules;
  onJudge: (yes: boolean) => void;
  /** show the book letters (A, B, C...) while answering */
  letters: boolean;
  /** listen to the Y and N keys */
  keys?: boolean;
  locked?: boolean;
  name: string;
}

const isTyping = (el: Element | null) => !!el && (el.matches('input, textarea, select, [contenteditable="true"]'));

export function Domc({ q, state, rules, onJudge, letters, keys = true, locked, name }: Props) {
  const cur = domcCurrent(q, state, rules);
  const option = cur ? q.options?.find((o) => o.id === cur.option) : undefined;
  const shown = domcShown(state);
  const position = shown + 1;
  const [announce, setAnnounce] = useState('');
  const yesRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const judgeRef = useRef(onJudge);
  judgeRef.current = onJudge;

  const label = option ? (letters ? `Option ${option.id}` : `Option ${position}`) : '';

  // Announce each new option to screen readers.
  const lastShown = useRef(shown);
  useEffect(() => {
    if (shown === lastShown.current) return;
    lastShown.current = shown;
    if (option) setAnnounce(`${label}: ${plain(option.c)}`);
    else {
      setAnnounce('This question is finished.');
      doneRef.current?.focus();
    }
  }, [shown, option, label]);

  useEffect(() => {
    if (!keys || locked || !cur) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement)) return;
      const k = e.key.toLowerCase();
      if (k === 'y' || k === 'n') { e.preventDefault(); judgeRef.current(k === 'y'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keys, locked, cur]);

  const trail = Array.from({ length: shown }, (_, i) => i);

  return (
    <div className="qz-domc">
      <ol className="qz-domc-trail" aria-label="Options already answered">
        {trail.map((i) => {
          const id = i < Object.keys(state.judgments).length ? Object.keys(state.judgments)[i] : state.extra?.option;
          return <li key={i}>{letters && id ? `${id} answered` : `Option ${i + 1} answered`}</li>;
        })}
      </ol>
      {option ? (
        <div className="qz-domc-card" data-option={letters ? option.id : undefined}>
          <div className="qz-domc-in" key={option.id}>
            <p className="qz-domc-label" id={`${name}-lab`}>{label}</p>
            <div className="qz-domc-text" id={`${name}-opt`}><Inline c={option.c} /></div>
          </div>
          <div className="qz-yn" role="group" aria-labelledby={`${name}-lab`}>
            <button ref={yesRef} type="button" className="qz-yn-btn" aria-describedby={`${name}-opt`} disabled={locked} onClick={() => onJudge(true)}>
              Yes <kbd aria-hidden="true">Y</kbd>
            </button>
            <button type="button" className="qz-yn-btn" aria-describedby={`${name}-opt`} disabled={locked} onClick={() => onJudge(false)}>
              No <kbd aria-hidden="true">N</kbd>
            </button>
          </div>
          <p className="qz-domc-note">You cannot go back to an option once you answer it, like on the real exam.<span className="qz-keys-hint"> Keys: Y for yes, N for no.</span></p>
        </div>
      ) : (
        <p className="qz-domc-done" ref={doneRef} tabIndex={-1}>
          This question is finished: you answered {shown === 1 ? '1 option' : `${shown} options`}.
          {' '}{rules.earlyEnd ? 'A question can end before you see every option.' : ''}
        </p>
      )}
      <p className="visually-hidden" aria-live="polite">{announce}</p>
    </div>
  );
}

/** Review of a finished DOMC question: every option in book order, with the judgment and the key. */
export function DomcReview({ q, state }: { q: Question; state: DomcState }) {
  const key = q.key as Record<string, boolean>;
  const yn = (v: boolean) => (v ? 'YES' : 'NO');
  return (
    <ol className="qz-domc-review" aria-label="All options, with the correct answers">
      {(q.options ?? []).map((o) => {
        const judged = o.id in state.judgments;
        const extra = state.extra?.option === o.id;
        const yours = judged ? state.judgments[o.id] : extra ? state.extra!.yes : undefined;
        const ok = judged ? yours === key[o.id] : undefined;
        const step = state.order.indexOf(o.id) + 1;
        return (
          <li key={o.id} className="qz-domc-row" data-state={judged ? (ok ? 'right' : 'wrong') : 'unseen'}>
            <span className="qz-letter" aria-hidden="true">{o.id}</span>
            <div className="qz-domc-row-body">
              <div className="qz-domc-row-text"><span className="visually-hidden">Option {o.id}. </span><Inline c={o.c} /></div>
              <p className="qz-domc-row-meta">
                <span className="qz-key-pill" data-yes={key[o.id] || undefined}>Correct answer: {yn(key[o.id])}</span>
                {judged && <><span>You answered {yn(yours!)} (shown {ordinal(step)})</span><Mark ok={!!ok} label={ok ? 'Right' : 'Wrong'} /></>}
                {extra && <span>Extra option, not scored: you answered {yn(yours!)}</span>}
                {!judged && !extra && <span className="qz-muted">Not shown: the question ended before this option.</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
