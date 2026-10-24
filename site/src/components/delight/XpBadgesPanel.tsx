// XP, level and badges, for the Today page (compact) or the dashboard (full).
// Everything is computed from this browser's progress; nothing is stored or sent.
import { useId, useMemo } from 'react';
import { BADGES, EMPTY_FACTS, LEVELS, XP_RULES, computeGame, type BadgeState, type GameState } from '../../lib/gamification';
import { useGame } from './data';
import { BadgeNode } from './Glyphs';
import './delight.css';

export interface XpBadgesPanelProps {
  /** compact: level, XP bar and earned badges (Today side column). full: breakdown and every badge (dashboard). */
  variant?: 'compact' | 'full';
  /** id of the section (the celebration toast links to #badges) */
  id?: string;
  /** heading level of the panel title */
  headingLevel?: 2 | 3;
}

const nf = (n: number) => n.toLocaleString('en-GB');

function LevelPath({ n }: { n: number }) {
  const W = 26, GAP = 14, H = 16;
  const width = LEVELS.length * W + (LEVELS.length - 1) * GAP;
  return (
    <svg className="dl-path" viewBox={`-2 -2 ${width + 4} ${H + 4}`} aria-hidden="true" focusable="false">
      {LEVELS.slice(1).map((l, i) => {
        const x1 = i * (W + GAP) + W, x2 = x1 + GAP;
        return <path key={l.n} className="dl-path-edge" data-on={l.n <= n || undefined} d={`M${x1} ${H / 2}H${x2}`} />;
      })}
      {LEVELS.map((l, i) => (
        <rect key={l.n} className="dl-path-node" data-state={l.n < n ? 'done' : l.n === n ? 'now' : undefined} x={i * (W + GAP)} y="0" width={W} height={H} rx="5" />
      ))}
    </svg>
  );
}

function LevelHead({ game, H, titleId }: { game: GameState; H: 'h2' | 'h3'; titleId: string }) {
  const { level, xp } = game;
  const pct = Math.round(level.progress * 100);
  return (
    <div className="dl-level">
      <div className="dl-level-top">
        <H id={titleId} className="dl-level-name"><span className="dl-level-n">Level {level.n}</span> {level.name}</H>
        <p className="dl-xp"><b>{nf(xp)}</b> XP</p>
      </div>
      <p className="dl-level-line">{level.line}</p>
      <div className="dl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-label={level.next ? `Progress to level ${level.next.n}, ${level.next.name}` : 'Last level reached'}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="dl-bar-note">
        {level.next ? <>{nf(level.toNext)} XP to <b>{level.next.name}</b></> : 'You reached the last level.'}
      </p>
      <LevelPath n={level.n} />
    </div>
  );
}

function progressText(b: BadgeState): string {
  if (b.earned) return 'Earned';
  if (b.progress && b.progress.value > 0) return `${b.progress.value} of ${b.progress.target}`;
  return 'Not yet';
}

type Hx = 'h3' | 'h4' | 'h5';
function BadgeGrid({ badges, compact, T }: { badges: BadgeState[]; compact?: boolean; T: Hx }) {
  return (
    <ul className="dl-badges" data-compact={compact || undefined}>
      {badges.map((b) => (
        <li key={b.id} className="dl-badge" data-earned={b.earned || undefined}>
          <BadgeNode glyph={b.glyph} earned={b.earned} size={compact ? 38 : 44} />
          <div className="dl-badge-body">
            <T className="dl-badge-title">{b.title}</T>
            <p className="dl-badge-text">{b.text}</p>
            <p className="dl-badge-state">
              {!b.earned && b.progress && b.progress.value > 0 && (
                <span className="dl-mini" aria-hidden="true"><span style={{ width: `${(b.progress.value / b.progress.target) * 100}%` }} /></span>
              )}
              {progressText(b)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const PARTS: { key: keyof GameState['parts']; label: string }[] = [
  { key: 'lessons', label: 'Lessons' },
  { key: 'labs', label: 'Labs and capstone' },
  { key: 'questions', label: 'Questions' },
  { key: 'mocks', label: 'Mock exams' },
  { key: 'reviews', label: 'Flashcard reviews' },
  { key: 'habits', label: 'Study days, focus, explain it back' },
];

export default function XpBadgesPanel({ variant = 'compact', id = 'badges', headingLevel = 2 }: XpBadgesPanelProps) {
  const { game: live, data, storageError, factsFailed } = useGame();
  // Without the course facts (offline before the first visit), XP still counts; a few badges cannot be checked.
  const game = useMemo(() => live ?? (factsFailed && data ? computeGame(data, EMPTY_FACTS) : null), [live, factsFailed, data]);
  const uid = useId().replace(/:/g, '');
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const H1: Hx = headingLevel === 2 ? 'h3' : 'h4';
  const H2: Hx = headingLevel === 2 ? 'h4' : 'h5';
  const titleId = `${uid}-lvl`;

  if (storageError) {
    return <section className="dl-panel panel" id={id} aria-label="XP and badges"><p className="dl-muted">This browser does not let the site read your progress (private window or blocked storage), so there is no XP to show.</p></section>;
  }
  if (!game) {
    return <section className="dl-panel panel" id={id} aria-label="XP and badges" aria-busy="true"><p className="dl-muted">Loading your XP and badges…</p></section>;
  }

  const earned = game.badges.filter((b) => b.earned);
  const nextUp = game.badges.filter((b) => !b.earned).sort((a, b) => (b.progress ? b.progress.value / b.progress.target : 0) - (a.progress ? a.progress.value / a.progress.target : 0)).slice(0, 3);

  if (variant === 'compact') {
    return (
      <section className="dl-panel panel" id={id} aria-labelledby={titleId} data-variant="compact">
        <LevelHead game={game} H={H} titleId={titleId} />
        <div className="dl-earned">
          <p className="dl-earned-head"><b>Badges</b> <span>{earned.length} of {BADGES.length}</span></p>
          {earned.length > 0 ? (
            <ul className="dl-earned-row" aria-label="Badges earned">
              {earned.map((b) => <li key={b.id} title={`${b.title}: ${b.text}`}><BadgeNode glyph={b.glyph} earned size={34} /><span className="visually-hidden">{b.title}</span></li>)}
            </ul>
          ) : <p className="dl-muted dl-small">Your first badge comes with your first finished lesson.</p>}
          <details className="dl-more">
            <summary>All badges and how XP works</summary>
            <BadgeGrid badges={game.badges} compact T={H1} />
            <XpRules />
          </details>
        </div>
        {factsFailed && <p className="dl-muted dl-small">Some badges can be checked only online. Reload the page when you are connected.</p>}
      </section>
    );
  }

  const max = Math.max(1, ...Object.values(game.parts));
  return (
    <section className="dl-panel dl-full" id={id} aria-labelledby={titleId} data-variant="full">
      <div className="dl-full-grid">
        <div className="panel dl-full-level">
          <LevelHead game={game} H={H} titleId={titleId} />
          <H1 className="dl-sub">Where your XP comes from</H1>
          <ul className="dl-parts">
            {PARTS.map((p) => (
              <li key={p.key}>
                <span>{p.label}</span>
                <span className="dl-parts-bar" aria-hidden="true"><span style={{ width: `${(game.parts[p.key] / max) * 100}%` }} /></span>
                <b>{nf(game.parts[p.key])}</b>
              </li>
            ))}
          </ul>
          <p className="dl-muted dl-small">Streak: {game.streak.current} {game.streak.current === 1 ? 'day' : 'days'}. Best: {game.streak.best} {game.streak.best === 1 ? 'day' : 'days'}.</p>
          <details className="dl-more"><summary>How XP works</summary><XpRules /></details>
        </div>
        <div className="panel dl-full-badges">
          <div className="dl-badges-head">
            <H1 className="dl-sub">Badges</H1>
            <span className="dl-muted">{earned.length} of {BADGES.length} earned</span>
          </div>
          {nextUp.length > 0 && <p className="dl-muted dl-small">Closest next: {nextUp.map((b) => b.title).join(', ')}.</p>}
          <BadgeGrid badges={game.badges} T={H2} />
        </div>
      </div>
      {factsFailed && <p className="dl-muted dl-small">Some badges can be checked only online. Reload the page when you are connected.</p>}
    </section>
  );
}

function XpRules() {
  return (
    <div className="dl-rules">
      <p className="dl-small">XP comes only from real work, counted from your progress in this browser. Import your progress file on another computer and you get the same XP.</p>
      <table>
        <caption className="visually-hidden">XP for each kind of progress</caption>
        <thead><tr><th scope="col">What you do</th><th scope="col">XP</th></tr></thead>
        <tbody>{XP_RULES.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.xp}</td></tr>)}</tbody>
      </table>
      <p className="dl-small">Levels: {LEVELS.map((l) => `${l.name} (${nf(l.min)})`).join(', ')}.</p>
    </div>
  );
}
