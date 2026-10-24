// Exam timer. Exam mode: countdown, warnings at 30, 10, 5 and 1 minutes, time-up callback.
// Practice mode: time used. It renders on its own so the question does not re-render every second.
import { useEffect, useRef, useState } from 'react';
import { clock, spoken } from '../../lib/exam/time';

interface Props {
  mode: 'exam' | 'practice';
  durationMs: number;
  getElapsed: () => number;
  onTimeUp: () => void;
  running: boolean;
}

const WARN_AT = [30, 10, 5, 1].map((m) => m * 60_000);

export function Timer({ mode, durationMs, getElapsed, onTimeUp, running }: Props) {
  const [elapsed, setElapsed] = useState(getElapsed());
  const [announce, setAnnounce] = useState('');
  const warned = useRef(new Set<number>());
  const fired = useRef(false);
  const cb = useRef(onTimeUp);
  cb.current = onTimeUp;

  useEffect(() => {
    if (!running) return;
    // thresholds already passed (a resumed attempt) are not announced again
    for (const w of WARN_AT) if (durationMs - getElapsed() <= w) warned.current.add(w);
    const tick = () => {
      const e = getElapsed();
      setElapsed(e);
      if (mode !== 'exam') return;
      const left = durationMs - e;
      for (const w of WARN_AT) {
        if (left <= w && left > 0 && !warned.current.has(w)) {
          WARN_AT.filter((x) => x >= w).forEach((x) => warned.current.add(x));
          setAnnounce(`${spoken(w)} left.`);
        }
      }
      if (left <= 0 && !fired.current) { fired.current = true; cb.current(); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [running, mode, durationMs, getElapsed]);

  if (mode === 'practice') {
    return (
      <span className="ex-timer" data-mode="practice">
        <span className="ex-timer-label">Time used</span>
        <span className="ex-timer-value">{clock(elapsed)}</span>
      </span>
    );
  }
  const left = Math.max(0, durationMs - elapsed);
  const level = left <= 5 * 60_000 ? 'low' : left <= 10 * 60_000 ? 'warn' : undefined;
  return (
    <span className="ex-timer" data-level={level}>
      <span className="visually-hidden">Time left: </span>
      <span className="ex-timer-value" role="timer" aria-label={`Time left: ${spoken(left)}`}>{clock(left)}</span>
      {level && <span className="ex-timer-note">{level === 'low' ? 'Less than 5 min' : 'Less than 10 min'}</span>}
      <span className="visually-hidden" aria-live="assertive">{announce}</span>
    </span>
  );
}
