// Feedback after an answer: right or wrong (icon + colour + words), the correct answer, the book's
// explanation, why each wrong option is wrong, where to review, and the error-notebook entry.
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { Question } from '../../lib/content-types';
import type { Response } from '../../lib/scoring';
import { Blocks } from '../content/Blocks';
import { Inline } from '../content/Inline';
import { blocksText, describeKey } from '../../lib/exam/describe';
import { getNote, ruleOf, saveRule } from '../../lib/exam/learning';
import { url } from '../../lib/url';
import { IconCheck, IconCross } from './icons';
import { useFocusableScrollers } from './hooks';

export function reviewLinks(q: Question): { inline?: Question['review']; href?: string; text?: string } {
  if (q.review && q.review.length) return { inline: q.review };
  if (q.source.kind === 'chapter') {
    const id = `ch${String(q.source.chapter).padStart(2, '0')}`;
    return { href: url(`learn/${id}/`), text: `Chapter ${q.source.chapter}` };
  }
  return {};
}

/**
 * The book's explanation. When the question also has a structured "why the others are wrong" list, that
 * part of the explanation (a "Why the others are wrong." paragraph and the list after it) is shown once,
 * in its own section, not twice.
 */
export function explanationBlocks(q: Question): Question['explanation'] {
  if (!q.whyWrong?.length) return q.explanation;
  const i = q.explanation.findIndex((b) => b.t === 'p' && /^why the others? (options )?(are|is) wrong/i.test(blocksText([b])));
  if (i < 0) return q.explanation;
  const after = q.explanation[i + 1];
  return [...q.explanation.slice(0, i), ...q.explanation.slice(after && after.t === 'list' ? i + 2 : i + 1)];
}

export function Explanation({ q, showKey = true }: { q: Question; showKey?: boolean }) {
  const links = reviewLinks(q);
  const blocks = explanationBlocks(q);
  const ref = useRef<HTMLDivElement>(null);
  useFocusableScrollers(ref);
  return (
    <div className="qz-expl" ref={ref}>
      {showKey && <p className="qz-key-line">Correct answer: <b>{describeKey(q)}</b></p>}
      {blocks.length > 0 && (
        <>
          <h4>Explanation</h4>
          <Blocks blocks={blocks} />
        </>
      )}
      {q.whyWrong && q.whyWrong.length > 0 && (
        <>
          <h4>Why the other options are wrong</h4>
          <ul className="qz-why">
            {q.whyWrong.map((w) => (
              <li key={w.option}><span className="qz-letter" aria-hidden="true">{w.option}</span><span><span className="visually-hidden">{w.option}: </span><Inline c={w.c} /></span></li>
            ))}
          </ul>
        </>
      )}
      {(links.inline || links.href) && (
        <p className="qz-review-link">
          Review it in the course: {links.inline ? <Inline c={links.inline} /> : <a href={links.href}>{links.text}</a>}
        </p>
      )}
    </div>
  );
}

function NotebookEntry({ q, response }: { q: Question; response: Response | undefined }) {
  const [rule, setRule] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    let live = true;
    getNote(q.id).then((n) => { if (live) setRule(ruleOf(n)); }).catch(() => undefined);
    return () => { live = false; };
  }, [q.id]);
  const id = `note-${q.id}`;
  return (
    <form
      className="qz-note"
      onSubmit={async (e) => {
        e.preventDefault();
        try { await saveRule(q, response, rule); setStatus('Saved in your error notebook.'); }
        catch { setStatus('Could not save. Your browser may block storage for this site (private mode).'); }
      }}
    >
      <p className="qz-note-intro">This question is now in your error notebook and in your review queue. It comes back in your spaced reviews.</p>
      <label htmlFor={id}>The rule in your own words (optional)</label>
      <textarea id={id} rows={2} value={rule} onChange={(e) => { setRule(e.target.value); setStatus(''); }} placeholder="For example: sources never use the target schema." />
      <p className="qz-note-actions">
        <button type="submit" className="btn btn-quiet btn-small">Save in my notebook</button>
        <span role="status" className="qz-hint">{status}</span>
      </p>
    </form>
  );
}

interface Props { q: Question; response: Response | undefined; correct: boolean; timeUp?: boolean; notebook?: boolean }

export const Feedback = forwardRef<HTMLHeadingElement, Props>(function Feedback({ q, response, correct, timeUp, notebook = true }, ref) {
  return (
    <section className="qz-feedback" data-ok={correct || undefined} aria-label="Feedback">
      <h3 className="qz-fb-title" ref={ref} tabIndex={-1}>
        <span className="qz-fb-icon">{correct ? <IconCheck size={18} /> : <IconCross size={18} />}</span>
        {correct ? 'Correct' : timeUp && !response ? 'Time is up' : 'Not correct'}
      </h3>
      {!correct && (q.format === 'fill'
        // the blanks above already show what was typed next to the accepted answers: say it once
        ? <p className="qz-fb-sub">{timeUp && !response ? 'You did not answer in time. ' : ''}Compare what you typed with the accepted answer, just above.</p>
        : <p className="qz-fb-sub">{timeUp && !response ? 'You did not answer in time. ' : ''}The correct answer is shown above, and here: <b>{describeKey(q)}</b>.</p>)}
      {correct && <p className="qz-fb-sub">Well done. Read the explanation anyway: it often teaches a second rule.</p>}
      <Explanation q={q} showKey={false} />
      {!correct && notebook && <NotebookEntry q={q} response={response} />}
    </section>
  );
});
