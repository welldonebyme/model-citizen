// "Explain it back" for a chapter (Part 0, "How to study so it sticks": explain the main idea in simple
// words, as if to a friend who does not work with data; where you get stuck is what to review).
// Three prompts, saved as one note (notes table, id "explain:chNN", kind 'explain', ref "chNN"), which
// also shows in the error notebook. After writing, the learner can compare with the book's boxes.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Block } from '../../lib/content-types';
import { db } from '../../lib/store/db';
import { EXPLAIN_PROMPTS, explainHeader, explainNoteId, formatExplain, hasWords, parseExplain } from '../../lib/explain';
import { url } from '../../lib/url';
import { Blocks } from '../content/Blocks';
import { Callout } from '../content/Callout';
import './delight.css';

export interface ExplainBackProps {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  /** the chapter's "The idea in 3 sentences" box, to compare with */
  idea?: Block[];
  /** the chapter's "Why this matters" box */
  why?: Block[];
  headingLevel?: 2 | 3;
}

const REVEAL: Record<string, { kind: 'idea' | 'why'; key: 'idea' | 'why' }> = { idea: { kind: 'idea', key: 'idea' }, why: { kind: 'why', key: 'why' } };

export default function ExplainBackApp({ chapterId, chapterNumber, chapterTitle, idea, why, headingLevel = 2 }: ExplainBackProps) {
  const uid = useId().replace(/:/g, '');
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const [answers, setAnswers] = useState<Record<string, string>>(() => parseExplain(''));
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: number }>({ kind: 'idle' });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(answers);
  latest.current = answers;
  const dirty = useRef(false);
  const id = explainNoteId(chapterId);

  useEffect(() => {
    let live = true;
    db().notes.get(id)
      .then((n) => { if (!live) return; if (n) { setAnswers(parseExplain(n.text)); setStatus({ kind: 'saved', at: n.updatedAt }); } setLoaded(true); })
      .catch(() => { if (live) { setLoaded(true); setStatus({ kind: 'error' }); } });
    return () => { live = false; };
  }, [id]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const a = latest.current;
    try {
      const old = await db().notes.get(id);
      if (!old && !hasWords(a)) { setStatus({ kind: 'idle' }); return; }
      const now = Date.now();
      await db().notes.put({ id, kind: 'explain', ref: chapterId, text: formatExplain(explainHeader(chapterNumber, chapterTitle), a), createdAt: old?.createdAt ?? now, updatedAt: now });
      setStatus({ kind: 'saved', at: now });
    } catch {
      setStatus({ kind: 'error' });
    }
  }, [id, chapterId, chapterNumber, chapterTitle]);

  // save when leaving the page too
  useEffect(() => {
    const onHide = () => { if (dirty.current) void save(); };
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); clearTimeout(timer.current); };
  }, [save]);

  const change = (key: string, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    dirty.current = true;
    setStatus({ kind: 'saving' });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  };

  const boxes = { idea, why };
  const time = status.at ? new Date(status.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const day = status.at ? new Date(status.at).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';

  return (
    <section className="dl-explain panel" aria-labelledby={`${uid}-h`}>
      <div className="dl-explain-head">
        <span className="dl-explain-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 20 20"><path d="M4.5 4.5h11a1.6 1.6 0 0 1 1.6 1.6v6.2a1.6 1.6 0 0 1-1.6 1.6H10l-3.6 2.8v-2.8H4.5a1.6 1.6 0 0 1-1.6-1.6V6.1a1.6 1.6 0 0 1 1.6-1.6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M6.5 8h7M6.5 10.6h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </span>
        <div>
          <H id={`${uid}-h`}>Explain it back</H>
          <p className="dl-explain-lead">Explain the main idea of Chapter {chapterNumber} in simple words, in French or in English, as if to a friend who does not work with data. If you get stuck, you found exactly what to review. This is the Feynman technique from Part 0.</p>
        </div>
      </div>

      <div className="dl-explain-fields" aria-busy={!loaded || undefined}>
        {EXPLAIN_PROMPTS.map((p) => {
          const box = REVEAL[p.id] ? boxes[REVEAL[p.id].key] : undefined;
          const fid = `${uid}-${p.id}`;
          return (
            <div key={p.id} className="dl-explain-field">
              <label htmlFor={fid}>{p.label}</label>
              <p id={`${fid}-help`} className="dl-small dl-muted">{p.help}</p>
              <textarea id={fid} aria-describedby={`${fid}-help`} rows={p.id === 'idea' ? 5 : 3} value={answers[p.id] ?? ''} disabled={!loaded}
                onChange={(e) => change(p.id, e.target.value)} onBlur={() => void save()} spellCheck />
              {box && box.length > 0 && (
                <>
                  <button type="button" className="dl-linkbtn" aria-expanded={!!open[p.id]} aria-controls={`${fid}-book`}
                    onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                    {open[p.id] ? 'Hide the book' : 'Compare with the book'}
                  </button>
                  <div id={`${fid}-book`} hidden={!open[p.id]} className="dl-explain-book">
                    {open[p.id] && <Callout kind={REVEAL[p.id].kind}><Blocks blocks={box} /></Callout>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="dl-explain-foot">
        <p className="dl-small" role="status">
          {status.kind === 'saving' ? 'Saving…'
            : status.kind === 'saved' ? `Saved in this browser (${day}, ${time}).`
            : status.kind === 'error' ? 'This browser cannot save notes (private window or blocked storage). Copy your text somewhere else.'
            : 'Your text is saved in this browser as you type.'}
        </p>
        <p className="dl-small dl-muted">Day 7 after the chapter: explain the three-sentence idea out loud, without notes. Your answers are also in your <a href={url('practice/notebook/')}>error notebook</a>.</p>
      </div>
    </section>
  );
}
