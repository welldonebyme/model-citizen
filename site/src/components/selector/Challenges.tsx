import { useEffect, useMemo, useState } from 'react';
import { CHALLENGES, challengeCommand, checkChallenge, selectionPart, type ChallengeCheck } from '../../lib/selector/challenges';
import { loadProject } from '../../lib/selector/data';
import type { Project } from '../../lib/selector/project';

const KEY = 'mc:selector:solved';

function readSolved(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function writeSolved(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode: progress is not kept */ }
}

function tagLabel(id: string): string {
  const [key, tag] = id.split('-');
  return key === 'jaffle' ? `Chapter ${Number(tag.slice(2))} project` : `Capstone ${tag}`;
}

interface Props {
  /** open a command in the playground above: project id, command line, --state scenario */
  onOpen: (projectId: string, command: string, scenario?: string) => void;
}

export default function Challenges({ onOpen }: Props) {
  const [active, setActive] = useState(CHALLENGES[0].id);
  const [solved, setSolved] = useState<string[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [answer, setAnswer] = useState('');
  const [check, setCheck] = useState<ChallengeCheck | null>(null);
  const [hints, setHints] = useState(0);
  const c = CHALLENGES.find((x) => x.id === active)!;

  useEffect(() => { setSolved(readSolved()); }, []);
  useEffect(() => {
    let live = true;
    setProject(null);
    loadProject(c.project).then((p) => { if (live) setProject(p); }, () => {});
    setAnswer(c.start ?? '');
    setCheck(null);
    setHints(0);
    return () => { live = false; };
  }, [c]);

  const run = () => {
    if (!project) return;
    const r = checkChallenge(project, c, answer);
    setCheck(r);
    if (r.ok && !solved.includes(c.id)) {
      const next = [...solved, c.id];
      setSolved(next);
      writeSolved(next);
    }
  };
  const done = useMemo(() => new Set(solved), [solved]);

  return (
    <section className="msl-panel" aria-labelledby="msl-ch-h">
      <div className="msl-pad" style={{ paddingBottom: 0 }}>
        <h2 id="msl-ch-h">Challenges</h2>
        <p className="msl-muted" style={{ margin: '4px 0 0' }}>Write a selection that selects exactly the right nodes. Any correct expression is accepted: the site runs it like dbt 1.11 and compares the nodes. {done.size} of {CHALLENGES.length} solved.</p>
      </div>
      <div className="msl-ch-grid msl-pad">
        <ol className="msl-ch-list" aria-label="Challenges">
          {CHALLENGES.map((x, i) => (
            <li key={x.id}>
              <button type="button" aria-current={x.id === active} onClick={() => setActive(x.id)}>
                <span className={`msl-ch-mark${done.has(x.id) ? ' done' : ''}`} aria-hidden="true">{done.has(x.id) ? '✓' : i + 1}</span>
                <span>{x.title}<span className="msl-ch-tag">{tagLabel(x.project)}{done.has(x.id) ? ', solved' : ''}</span></span>
              </button>
            </li>
          ))}
        </ol>
        <div className="msl-ch-body">
          <h3>{c.title}</h3>
          <p style={{ margin: 0 }}>{c.prompt}</p>
          <p className="msl-ch-fixed" style={{ margin: 0 }}>
            Project: {tagLabel(c.project)} (tag {c.project.split('-')[1]}).
            {c.fixed && <> Added for you: <code className="mc-ic">{c.fixed}</code>.</>}
            {c.scenario && <> The --state folder is set for you.</>}
          </p>
          <form className="msl-cmd" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <label htmlFor="msl-ch-in" className="visually-hidden">Your selection</label>
            <span className="msl-mono msl-muted" style={{ alignSelf: 'center' }} aria-hidden="true">dbt ls</span>
            <input id="msl-ch-in" className="msl-input" value={answer} onChange={(e) => { setAnswer(e.target.value); setCheck(null); }} placeholder="-s ...   or just the selection" spellCheck={false} autoCapitalize="off" autoComplete="off" />
            <button type="submit" className="msl-btn msl-btn-accent" disabled={!project}>Check</button>
          </form>
          <div aria-live="polite">
            {check && (
              <div className={`msl-feedback ${check.ok ? 'ok' : 'bad'}`}>
                <b>{check.message}</b>
                {check.error && <pre>{check.error}</pre>}
                {check.missing.length > 0 && <pre>{`Missing:\n${check.missing.join('\n')}`}</pre>}
                {check.extra.length > 0 && <pre>{`Too many:\n${check.extra.join('\n')}`}</pre>}
                {check.ok && <p style={{ margin: '6px 0 0' }}>{c.explain}</p>}
              </div>
            )}
          </div>
          <div className="msl-row">
            <button type="button" className="msl-btn msl-btn-small" onClick={() => setHints((h) => Math.min(c.hints.length, h + 1))} disabled={hints >= c.hints.length}>
              {hints >= c.hints.length ? 'No more hints' : `Show a hint (${hints + 1} of ${c.hints.length})`}
            </button>
            <button type="button" className="msl-btn msl-btn-small" onClick={() => onOpen(c.project, challengeCommand(c, selectionPart(answer) || c.start || ''), c.scenario)}>Open my selection in the playground</button>
            {check?.ok && <button type="button" className="msl-btn msl-btn-small" onClick={() => {
              const i = CHALLENGES.findIndex((x) => x.id === c.id);
              setActive(CHALLENGES[(i + 1) % CHALLENGES.length].id);
            }}>Next challenge</button>}
          </div>
          {hints > 0 && <ul className="msl-small" style={{ margin: 0, paddingLeft: 18 }}>{c.hints.slice(0, hints).map((h) => <li key={h}>{h}</li>)}</ul>}
        </div>
      </div>
    </section>
  );
}
