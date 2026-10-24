// Friend challenge (/practice/challenge/): build a seeded set of questions, share the short link, and
// each person answers in their own browser. The questions come from the same index and files as the
// drills (practice/drills/index.json, then one file per chapter or mock), and run in the quiz runner.
// Results stay in this browser; the learner copies a "share your score" text (no network).
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { Format, Question } from '../../lib/content-types';
import {
  CHALLENGE_SIZES, FORMATS, challengeIds, challengePool, checksum, createChallenge, decodeChallenge, decodeScore, describeChallenge,
  encodeChallenge, encodeScore, minutesText, pct, shareText, type BankItem, type Challenge, type SharedScore,
} from '../../lib/challenge';
import { FORMAT_NAME } from '../../lib/exam/describe';
import { TOPICS, topicLabel, topicTitle } from '../../lib/exam/objectives';
import { questionTopic } from '../../lib/exam/results';
import { getSettings } from '../../lib/store/db';
import { loadQuestions } from '../quiz/DrillsApp';
import { QuizRunner, type QuizFinish } from '../quiz/QuizRunner';
import '../quiz/quiz.css';
import './delight.css';

export interface ChallengeAppProps {
  indexUrl: string;
  chapterDataBase: string;
  mockDataBase: string;
  chapters: { n: number; title: string; count: number }[];
  mocks: { n: number; count: number }[];
}

interface Result { code: string; right: number; total: number; minutes: number; at: number }
const RESULTS_KEY = 'mc:challenges';
const startKey = (code: string) => `mc:challenge-start:${code}`;
const DOMC_RULES = { earlyEnd: true, extraOption: true }; // the same rules for both people, like the real exam

function readResults(): Result[] {
  try { const r = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; }
}
function addResult(r: Result) {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify([...readResults(), r].slice(-40))); } catch { /* not kept */ }
}

function fromUrl(): { code: string | null; challenge: Challenge | null; score: SharedScore | null } {
  const q = new URLSearchParams(location.search);
  const code = q.get('c');
  const challenge = decodeChallenge(code);
  return { code, challenge, score: challenge ? decodeScore(q.get('s')) : null };
}

const linkFor = (code: string, score?: SharedScore) => `${location.origin}${location.pathname}?c=${code}${score ? `&s=${encodeScore(score)}` : ''}`;

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const TOPIC_LIST = [...TOPICS.map((t) => t.n), 0, 8];
const topicName = (n: number) => (n === 0 || n === 8 ? topicTitle(n) : `${topicLabel(n)}: ${TOPICS.find((t) => t.n === n)?.short ?? ''}`);

export default function ChallengeApp(p: ChallengeAppProps) {
  const uid = useId().replace(/:/g, '');
  const [bank, setBank] = useState<BankItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [url, setUrl] = useState(() => fromUrl());
  const [phase, setPhase] = useState<'build' | 'intro' | 'run'>(() => (url.challenge ? 'intro' : 'build'));
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState('');

  // builder
  const [n, setN] = useState<number>(10);
  const [chapters, setChapters] = useState<number[]>([]);
  const [mocks, setMocks] = useState<number[]>([]);
  const [topics, setTopics] = useState<number[]>([]);
  const [formats, setFormats] = useState<Format[]>([]);

  useEffect(() => {
    fetch(p.indexUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items: BankItem[] }) => setBank(d.items))
      .catch(() => setLoadError('The questions could not be loaded. Check your connection, then reload the page.'));
    setResults(readResults());
    getSettings().then((s) => setName(s.name ?? '')).catch(() => undefined);
    const onPop = () => { const u = fromUrl(); setUrl(u); setPhase(u.challenge ? 'intro' : 'build'); setResult(null); setQuestions(null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [p.indexUrl]);

  const filters = { chapters, mocks, topics, formats };
  const matching = useMemo(() => (bank ? challengePool(bank, filters).length : 0), [bank, chapters, mocks, topics, formats]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const c = url.challenge;
  const ids = useMemo(() => (bank && c ? challengeIds(bank, c) : []), [bank, c]);
  const mismatch = !!c && !!bank && c.check !== 0 && checksum(ids) !== c.check;
  const mine = results.filter((r) => r.code === url.code);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bank) return;
    if (!matching) { setMsg('No question matches these choices. Remove a filter.'); return; }
    const ch = createChallenge(bank, { n, ...filters });
    const code = encodeChallenge(ch);
    history.pushState({}, '', `?c=${code}`);
    setUrl({ code, challenge: ch, score: null });
    setPhase('intro');
    setMsg('');
    setCopied('');
    window.scrollTo({ top: 0 });
  };

  const start = async () => {
    if (!bank || !c || !url.code || starting) return;
    setStarting(true);
    setMsg('');
    try {
      const qs = await loadQuestions(ids, new Map(bank.map((q) => [q.id, q])), p.chapterDataBase, p.mockDataBase);
      if (!qs.length) throw new Error('empty');
      try { if (!localStorage.getItem(startKey(url.code))) localStorage.setItem(startKey(url.code), String(Date.now())); } catch { /* time not kept */ }
      setQuestions(qs);
      setResult(null);
      setPhase('run');
      window.scrollTo({ top: 0 });
    } catch {
      setMsg('The questions could not be loaded. Check your connection, then try again.');
    } finally {
      setStarting(false);
    }
  };

  const onFinish = useCallback((f: QuizFinish) => {
    if (f.roundNo !== 1 || !url.code) return;
    let started = Date.now();
    try { started = Number(localStorage.getItem(startKey(url.code))) || started; localStorage.removeItem(startKey(url.code)); } catch { /* ignore */ }
    const r: Result = { code: url.code, right: f.roundScore, total: f.roundTotal, minutes: Math.max(0, Math.round((Date.now() - started) / 60_000)), at: Date.now() };
    addResult(r);
    setResults(readResults());
    setResult(r);
  }, [url.code]);

  const doCopy = async (text: string, what: string) => {
    setCopied((await copy(text)) ? `${what} copied.` : 'Copy did not work here: select the text and press Ctrl+C (or ⌘+C on a Mac).');
  };

  if (loadError) return <p className="dl-error" role="alert">{loadError}</p>;

  // ---- a challenge from a link ----
  if (url.code && !c) {
    return (
      <section className="panel ch-card" aria-labelledby={`${uid}-bad`}>
        <h2 id={`${uid}-bad`}>This challenge link does not work</h2>
        <p>The link is incomplete or damaged. Ask for the link again (copy all of it), or create a new challenge.</p>
        <button type="button" className="btn btn-primary" onClick={() => { history.pushState({}, '', location.pathname); setUrl({ code: null, challenge: null, score: null }); setPhase('build'); }}>Create a new challenge</button>
      </section>
    );
  }

  if (c && url.code && phase === 'run' && questions) {
    const share = result ? shareText({ right: result.right, total: result.total, minutes: result.minutes, link: linkFor(url.code, result), name }) : '';
    return (
      <div className="ch-run">
        {result && (
          <section className="panel ch-result" aria-labelledby={`${uid}-res`}>
            <h2 id={`${uid}-res`}>Your challenge score: {result.right} of {result.total} ({pct(result.right, result.total)}%)</h2>
            <p>Time: {minutesText(result.minutes)}. {url.score ? <>The person who sent the link: <b>{url.score.right} of {url.score.total}</b> in {minutesText(url.score.minutes)}.</> : 'Send your score to your friend: they get the same questions in the same order.'}</p>
            <p className="dl-small dl-muted">Retrying the questions below does not change your challenge score.</p>
            <div className="ch-share">
              <label htmlFor={`${uid}-name`}>Your first name in the text <span className="dl-muted">(optional)</span></label>
              <input id={`${uid}-name`} type="text" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
              <label htmlFor={`${uid}-share`}>Share your score</label>
              <textarea id={`${uid}-share`} readOnly rows={3} value={share} onFocus={(e) => e.currentTarget.select()} />
              <div className="ch-share-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={() => doCopy(share, 'Your score')}>Copy the text</button>
                <span className="dl-small" role="status">{copied}</span>
              </div>
              <p className="dl-small dl-muted">Nothing is sent from this page. Paste the text in a message to your friend.</p>
            </div>
          </section>
        )}
        <QuizRunner
          key={url.code}
          questions={questions}
          mode="drill"
          title="Friend challenge"
          domcExamLike
          domcRules={DOMC_RULES}
          seed={c.seed}
          sessionKey={`challenge:${url.code}`}
          onFinish={onFinish}
          onExit={() => { setPhase('intro'); setQuestions(null); window.scrollTo({ top: 0 }); }}
          exitLabel="Back to the challenge"
        />
      </div>
    );
  }

  if (c && url.code && phase !== 'build') {
    const lines = describeChallenge(c, { formats: FORMAT_NAME, topics: topicName });
    const link = linkFor(url.code);
    return (
      <section className="panel ch-card" aria-labelledby={`${uid}-ch`}>
        <p className="ch-kicker">Friend challenge</p>
        <h2 id={`${uid}-ch`}>{bank ? `${ids.length} ${ids.length === 1 ? 'question' : 'questions'}` : `${c.n} questions`}</h2>
        <ul className="ch-facts">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <p>The same questions, in the same order, for everyone who opens this link. Each person answers in their own browser, with feedback after each question. Nobody sees the other person's answers.</p>
        {url.score && <p className="ch-sender"><b>The person who sent you this link scored {url.score.right} of {url.score.total} ({pct(url.score.right, url.score.total)}%)</b> in {minutesText(url.score.minutes)}.</p>}
        {mismatch && <p className="dl-warn" role="alert">This link was made with another version of the questions. You may not get the same questions as your friend. Reload the site on both computers, then make a new challenge.</p>}
        <div className="ch-link">
          <label htmlFor={`${uid}-link`}>Challenge link</label>
          <div className="ch-link-row">
            <input id={`${uid}-link`} type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-quiet btn-small" onClick={() => doCopy(link, 'The link')}>Copy the link</button>
          </div>
          <p className="dl-small" role="status">{copied}</p>
        </div>
        {mine.length > 0 && (
          <div className="ch-mine">
            <h3>Your results for this challenge</h3>
            <ul>{mine.slice().reverse().map((r) => <li key={r.at}><b>{r.right} of {r.total}</b> ({pct(r.right, r.total)}%) in {minutesText(r.minutes)}, {new Date(r.at).toLocaleDateString()}</li>)}</ul>
          </div>
        )}
        <div className="ch-actions">
          <button type="button" className="btn btn-primary" onClick={start} aria-disabled={!bank || starting || undefined}>{starting ? 'Loading the questions…' : !bank ? 'Loading…' : mine.length ? 'Take the challenge again' : 'Start the challenge'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => { history.pushState({}, '', location.pathname); setUrl({ code: null, challenge: null, score: null }); setPhase('build'); setCopied(''); }}>Create a new challenge</button>
        </div>
        {msg && <p className="dl-error" role="alert">{msg}</p>}
      </section>
    );
  }

  // ---- the builder ----
  return (
    <form className="ch-build" onSubmit={create} aria-describedby={`${uid}-count`}>
      <fieldset className="dr-box ch-box">
        <legend>Number of questions</legend>
        <div className="ch-sizes">
          {CHALLENGE_SIZES.map((s) => (
            <label key={s} className="dr-chip"><input type="radio" name={`${uid}-n`} checked={n === s} onChange={() => setN(s)} /><span>{s}</span></label>
          ))}
        </div>
      </fieldset>

      <fieldset className="dr-box ch-box">
        <legend>Chapter quizzes</legend>
        <div className="ch-quick">
          <button type="button" className="dl-linkbtn" onClick={() => setChapters(p.chapters.map((x) => x.n))}>Tick all</button>
          <button type="button" className="dl-linkbtn" onClick={() => setChapters([])}>Untick all</button>
        </div>
        <div className="ch-chapters">
          {p.chapters.map((ch) => (
            <label key={ch.n} className="dr-check ch-ch">
              <input type="checkbox" checked={chapters.includes(ch.n)} onChange={() => setChapters((x) => toggle(x, ch.n))} />
              <span><b>{ch.n}</b> {ch.title}</span>
              <span className="dr-n">{ch.count}</span>
            </label>
          ))}
        </div>
        <p className="dr-hint">None ticked, and no mock exam: questions from every chapter quiz and every mock exam.</p>
      </fieldset>

      <div className="ch-row">
        <fieldset className="dr-box ch-box">
          <legend>Mock exams</legend>
          <div className="dr-chips">
            {p.mocks.map((m) => (
              <label key={m.n} className="dr-chip"><input type="checkbox" checked={mocks.includes(m.n)} onChange={() => setMocks((x) => toggle(x, m.n))} /><span>Mock exam {m.n} <span className="dr-n">{m.count}</span></span></label>
            ))}
          </div>
        </fieldset>
        <fieldset className="dr-box ch-box">
          <legend>Formats</legend>
          <div className="dr-chips">
            {FORMATS.map((f) => (
              <label key={f} className="dr-chip"><input type="checkbox" checked={formats.includes(f)} onChange={() => setFormats((x) => toggle(x, f))} /><span>{FORMAT_NAME[f]}</span></label>
            ))}
          </div>
          <p className="dr-hint">None ticked: every format.</p>
        </fieldset>
      </div>

      <fieldset className="dr-box ch-box">
        <legend>Topics</legend>
        <div className="ch-topics">
          {TOPIC_LIST.map((t) => (
            <label key={t} className="dr-check">
              <input type="checkbox" checked={topics.includes(t)} onChange={() => setTopics((x) => toggle(x, t))} />
              <span>{t === 0 || t === 8 ? topicTitle(t) : `${t}. ${TOPICS.find((x) => x.n === t)?.title}`}</span>
              <span className="dr-n">{bank ? bank.filter((q) => questionTopic(q as Question) === t).length : ''}</span>
            </label>
          ))}
        </div>
        <p className="dr-hint">None ticked: every topic.</p>
      </fieldset>

      <div className="dr-start ch-start">
        <button type="submit" className="btn btn-primary" aria-disabled={!bank || matching === 0 || undefined}>Create the challenge</button>
        <p id={`${uid}-count`} className="dr-count" role="status">
          {bank === null ? 'Loading the questions…' : matching === 0 ? 'No question matches these choices.' : `${matching} ${matching === 1 ? 'question matches' : 'questions match'}. The challenge takes ${Math.min(n, matching)} of them, in a fixed random order.`}
        </p>
        {msg && <p className="dl-error" role="alert">{msg}</p>}
      </div>
      {results.length > 0 && (
        <details className="dl-more ch-history">
          <summary>Your earlier challenges</summary>
          <ul>{results.slice().reverse().slice(0, 10).map((r) => <li key={r.at}><a href={`?c=${r.code}`}>{r.right} of {r.total} ({pct(r.right, r.total)}%)</a>, {minutesText(r.minutes)}, {new Date(r.at).toLocaleDateString()}</li>)}</ul>
        </details>
      )}
    </form>
  );
}
