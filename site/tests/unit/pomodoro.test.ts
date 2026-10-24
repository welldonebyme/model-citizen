import { describe, expect, it } from 'vitest';
import { DEFAULT_POMO, advance, clockText, pause, remaining, resume, sanitize, setDurations, startFocus, stop, isRunning } from '../../src/lib/pomodoro';
import { daysOfLabel, daysUntil, planDayLabel, toggle } from '../../src/lib/exam-day';
import { EXPLAIN_PROMPTS, formatExplain, parseExplain } from '../../src/lib/explain';

const MIN = 60_000;
const T0 = new Date(2026, 9, 24, 9, 0).getTime();

describe('focus timer', () => {
  it('25/5 by default, sound and notifications off', () => {
    expect(DEFAULT_POMO).toMatchObject({ focusMin: 25, breakMin: 5, sound: false, notify: false, phase: 'idle' });
    expect(remaining(DEFAULT_POMO, T0)).toBe(25 * MIN);
  });
  it('runs on the wall clock: a closed page does not stop it', () => {
    const s = startFocus(DEFAULT_POMO, T0, { title: 'Read 7.3' });
    expect(isRunning(s)).toBe(true);
    expect(remaining(s, T0 + 10 * MIN)).toBe(15 * MIN);
    const { state, events } = advance(s, T0 + 26 * MIN);
    expect(events).toEqual([{ type: 'focus-done', id: s.id, minutes: 25, at: T0 + 25 * MIN }]);
    expect(state.phase).toBe('break');
    expect(remaining(state, T0 + 26 * MIN)).toBe(4 * MIN); // the break started when the focus ended
    expect(state.done.count).toBe(1);
    expect(state.task?.title).toBe('Read 7.3');
  });
  it('a long absence finishes the focus and the break, once', () => {
    const s = startFocus(DEFAULT_POMO, T0);
    const r = advance(s, T0 + 3 * 60 * MIN);
    expect(r.events.map((e) => e.type)).toEqual(['focus-done', 'break-done']);
    expect(r.state.phase).toBe('idle');
    expect(advance(r.state, T0 + 4 * 60 * MIN).events).toEqual([]);
  });
  it('pause keeps the time left; resume continues', () => {
    let s = startFocus(DEFAULT_POMO, T0);
    s = pause(s, T0 + 5 * MIN);
    expect(remaining(s, T0 + 50 * MIN)).toBe(20 * MIN);
    expect(advance(s, T0 + 50 * MIN).events).toEqual([]);
    s = resume(s, T0 + 50 * MIN);
    expect(remaining(s, T0 + 60 * MIN)).toBe(10 * MIN);
    expect(advance(s, T0 + 70 * MIN).events[0]).toMatchObject({ type: 'focus-done', at: T0 + 70 * MIN });
  });
  it('stop counts the whole minutes of focus already done', () => {
    const s = startFocus(DEFAULT_POMO, T0);
    expect(stop(s, T0 + 12.7 * MIN).minutes).toBe(12);
    expect(stop(s, T0 + 30 * 1000).minutes).toBe(0);
    expect(stop(s, T0 + 12 * MIN).state.phase).toBe('idle');
  });
  it('durations come from the offered choices', () => {
    expect(setDurations(DEFAULT_POMO, 50, 10)).toMatchObject({ focusMin: 50, breakMin: 10, durationMs: 50 * MIN });
    expect(setDurations(DEFAULT_POMO, 7, 99)).toMatchObject({ focusMin: 25, breakMin: 5 });
  });
  it('a damaged saved state falls back to safe values', () => {
    expect(sanitize('nope')).toEqual(DEFAULT_POMO);
    expect(sanitize({ phase: 'focus', runStart: 'x', durationMs: -1, focusMin: 45, sound: 'yes' })).toMatchObject({ phase: 'focus', focusMin: 45, sound: false, runStart: null, durationMs: 45 * MIN });
    const s = startFocus(DEFAULT_POMO, T0, { title: 'Lab' });
    expect(sanitize(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('clock text', () => {
    expect(clockText(25 * MIN)).toBe('25:00');
    expect(clockText(59_001)).toBe('1:00');
    expect(clockText(0)).toBe('0:00');
  });
});

describe('exam day dates', () => {
  it('counts calendar days to the exam', () => {
    expect(daysUntil('2026-10-31', '2026-10-24')).toBe(7);
    expect(daysUntil('2026-10-24', '2026-10-24')).toBe(0);
    expect(daysUntil('2026-10-20', '2026-10-24')).toBe(-4);
    expect(daysUntil('2026-11-02', '2026-10-24')).toBe(9); // across the end of summer time in Europe
  });
  it('maps days to the book labels and back', () => {
    expect(planDayLabel(7)).toBe('D−7');
    expect(planDayLabel(0)).toBe('D0');
    expect(planDayLabel(8)).toBeNull();
    expect(planDayLabel(-1)).toBeNull();
    expect(daysOfLabel('D−7')).toBe(7);
    expect(daysOfLabel('D0')).toBe(0);
    expect(daysOfLabel('D-2')).toBe(2);
    expect(daysOfLabel('Day')).toBeNull();
  });
  it('toggles saved ids', () => {
    expect(toggle(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggle(['a'], 'a', true)).toEqual(['a']);
  });
});

describe('explain it back notes', () => {
  it('round-trips the answers through readable text', () => {
    const a = { idea: 'A model is a select.\ndbt builds it.', why: 'Every project.', stuck: '' };
    const text = formatExplain('Explain it back: Chapter 7, Models', a);
    expect(text).toContain('## The idea in simple words\nA model is a select.');
    expect(parseExplain(text)).toEqual(a);
  });
  it('text edited without the prompt lines goes to the first prompt', () => {
    expect(parseExplain('just my words')).toEqual({ idea: 'just my words', why: '', stuck: '' });
    expect(Object.keys(parseExplain(undefined))).toEqual(EXPLAIN_PROMPTS.map((p) => p.id));
  });
});
