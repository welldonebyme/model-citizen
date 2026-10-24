// Flashcards with spaced repetition (Leitner boxes 1, 3, 7, 21, 60 days).
// Decks: the 145 traps (confusion → truth), the glossary (English → French + chapter), and the questions you
// missed: those are answered again with the quiz player, and a right answer moves their card on (learning.ts).
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Inline as InlineT } from '../../lib/content-types';
import { Inline } from '../content/Inline';
import { db, today, logActivity, type SrsCard } from '../../lib/store/db';
import { newCard, review, isDue } from '../../lib/srs';
import type { Question } from '../../lib/content-types';
import { QuizRunner } from '../quiz/QuizRunner';
import { url } from '../../lib/url';
import '../quiz/quiz.css';

export interface CardData { id: string; kind: 'trap' | 'term'; front: InlineT[]; back: InlineT[]; where?: InlineT[]; tag?: string }

type Deck = 'due' | 'trap' | 'term' | 'questions';

export default function Flashcards({ cards }: { cards: CardData[] }) {
  const live = useLiveQuery(() => db().srs.toArray(), []);
  const srs = live ?? ([] as SrsCard[]);
  const [deck, setDeck] = useState<Deck>('due');
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [session, setSession] = useState({ ok: 0, again: 0 });
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const srsById = useMemo(() => new Map(srs.map((s) => [s.id, s])), [srs]);

  // The queue is a snapshot taken when a deck starts, so grading a card never shifts the next one.
  const [queue, setQueue] = useState<string[] | null>(null);
  function buildQueue(d: Deck, rows: SrsCard[]): string[] {
    const known = new Map(rows.map((r) => [r.id, r]));
    if (d === 'due') return rows.filter((r) => isDue(r) && byId.has(r.id)).sort((a, b) => a.due.localeCompare(b.due)).map((r) => r.id);
    const ids = cards.filter((c) => c.kind === d).map((c) => c.id);
    // new cards first (never studied), then the due ones of this deck; at most 20 per session
    return [...ids.filter((x) => !known.has(x)), ...ids.filter((x) => known.has(x) && isDue(known.get(x)!))].slice(0, 20);
  }
  useEffect(() => { if (live) { setQueue(buildQueue(deck, live)); setI(0); setShown(false); } }, [deck, live === undefined]);


  const id = queue?.[i];
  const card = id ? byId.get(id) : undefined;
  const dueCount = srs.filter((s) => isDue(s) && byId.has(s.id)).length;
  const dueQuestions = srs.filter((s) => s.kind === 'question' && isDue(s)).map((s) => s.id);
  // only missed questions are due today: open their deck first
  const [autoDeck, setAutoDeck] = useState(false);
  useEffect(() => {
    if (!live || autoDeck) return;
    setAutoDeck(true);
    if (dueCount === 0 && dueQuestions.length > 0) setDeck('questions');
  }, [live, autoDeck, dueCount, dueQuestions.length]);

  async function grade(remembered: boolean) {
    if (!card) return;
    const old = srsById.get(card.id) ?? newCard(card.id, card.kind, today());
    await db().srs.put(review(old, remembered));
    await logActivity(0);
    setSession((s) => ({ ok: s.ok + (remembered ? 1 : 0), again: s.again + (remembered ? 0 : 1) }));
    setShown(false);
    setI((n) => n + 1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (!card) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setShown(true); }
      else if (shown && (e.key === '1' || e.key.toLowerCase() === 'a')) grade(false);
      else if (shown && (e.key === '2' || e.key.toLowerCase() === 'g')) grade(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fc">
      <div className="seg fc-decks" role="group" aria-label="Deck">
        <button type="button" aria-pressed={deck === 'due'} onClick={() => setDeck('due')}>Due today ({dueCount})</button>
        <button type="button" aria-pressed={deck === 'trap'} onClick={() => setDeck('trap')}>Traps</button>
        <button type="button" aria-pressed={deck === 'term'} onClick={() => setDeck('term')}>Glossary</button>
        <button type="button" aria-pressed={deck === 'questions'} onClick={() => setDeck('questions')}>Missed questions ({dueQuestions.length})</button>
      </div>

      {deck === 'questions' ? <QuestionDeck ids={dueQuestions} /> : null}

      {deck === 'questions' ? null : !card ? (
        <div className="fc-empty panel">
          <h2>{deck === 'due' ? (dueCount === 0 ? 'Nothing is due today' : 'Session finished') : 'This deck is finished for today'}</h2>
          <p>{session.ok + session.again > 0 ? `This session: ${session.ok} remembered, ${session.again} to see again soon. ` : ''}
            {deck === 'due' ? 'Cards come back after 1, 3, 7, 21 and 60 days. Start a deck to add new cards.' : 'Come back tomorrow for the next cards.'}</p>
          {deck === 'due' && <div className="fc-row">{dueQuestions.length > 0 && <button type="button" className="btn btn-primary" onClick={() => setDeck('questions')}>Answer the {dueQuestions.length} missed {dueQuestions.length === 1 ? 'question' : 'questions'} due</button>}<button type="button" className={dueQuestions.length ? 'btn btn-quiet' : 'btn btn-primary'} onClick={() => setDeck('trap')}>Study the traps</button><button type="button" className="btn btn-quiet" onClick={() => setDeck('term')}>Study the glossary</button></div>}
        </div>
      ) : (
        <div className="fc-card panel" aria-live="polite">
          <p className="fc-meta">{card.kind === 'trap' ? 'Trap' : 'Term'} {card.tag && <span>{card.tag}</span>} <span className="fc-count">{i + 1} of {queue?.length ?? 0}</span></p>
          <div className="fc-front">
            {card.kind === 'trap' && <p className="fc-label">People often believe:</p>}
            <p className="fc-text"><Inline c={card.front} /></p>
          </div>
          {shown ? (
            <>
              <div className="fc-back">
                <p className="fc-label">{card.kind === 'trap' ? 'The truth' : 'In French'}</p>
                <p className="fc-text"><Inline c={card.back} /></p>
                {card.where && card.where.length > 0 && <p className="fc-where">Where: <Inline c={card.where} /></p>}
              </div>
              <div className="fc-row">
                <button type="button" className="btn btn-quiet" onClick={() => grade(false)}>Again <kbd className="mc-key">1</kbd></button>
                <button type="button" className="btn btn-primary" onClick={() => grade(true)}>I knew it <kbd className="mc-key">2</kbd></button>
              </div>
            </>
          ) : (
            <div className="fc-row"><button type="button" className="btn btn-ink" onClick={() => setShown(true)}>Show the answer <kbd className="mc-key">Space</kbd></button></div>
          )}
        </div>
      )}
    </div>
  );
}

/** Due question cards (chapter and mock questions you missed), answered again with the quiz player. */
function QuestionDeck({ ids }: { ids: string[] }) {
  const [snapshot] = useState(ids); // the session keeps its questions while their cards move on
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!snapshot.length) return;
    const files = new Set(snapshot.map((id) => {
      const ch = id.match(/^q-(ch\d+)-/), mk = id.match(/^m(\d)-q/);
      return ch ? url(`quiz/data/${ch[1]}.json`) : mk ? url(`exams/data/mock${mk[1]}.json`) : '';
    }).filter(Boolean));
    Promise.all([...files].map((f) => fetch(f).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))))
      .then((all: { questions: Question[] }[]) => {
        const byId = new Map(all.flatMap((d) => d.questions).map((q) => [q.id, q]));
        setQuestions(snapshot.map((id) => byId.get(id)).filter((q): q is Question => !!q));
      })
      .catch(() => setError('The questions could not be loaded. Check your connection, then reload the page.'));
  }, [snapshot]);
  if (!snapshot.length) return (
    <div className="fc-empty panel">
      <h2>No missed question is due</h2>
      <p>A question you miss in a quiz, a checkpoint, a drill or a mock comes back here after 1, 3, 7, 21 and 60 days, until you answer it right.</p>
    </div>
  );
  if (error) return <p className="qz-warn" role="alert">{error}</p>;
  if (!questions) return <p className="qz-muted">Loading the questions…</p>;
  return <QuizRunner questions={questions} mode="drill" title="Missed questions" domcExamLike={false} seed={snapshot.length * 7919} compact={false} moreHref={url('practice/notebook/')} moreLabel="Your error notebook" />;
}
