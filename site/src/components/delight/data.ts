// Shared data for the delight islands: the course facts (delight/facts.json, loaded once per page) and a
// live view of the learner's progress (Dexie liveQuery: updates when any tab writes progress).
import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Settings } from '../../lib/store/db';
import { computeGame, type GameData, type GameFacts, type GameState } from '../../lib/gamification';
import { url } from '../../lib/url';

let factsPromise: Promise<GameFacts> | null = null;

/** The course facts; rejects when they cannot be loaded (offline before the first visit). */
export function loadFacts(): Promise<GameFacts> {
  if (!factsPromise) {
    factsPromise = fetch(url('delight/facts.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((f: GameFacts) => {
        if (!f || f.v !== 1 || typeof f.formats !== 'object') throw new Error('bad facts');
        return f;
      })
      .catch((e) => { factsPromise = null; throw e; });
  }
  return factsPromise;
}

export async function readGameData(): Promise<GameData> {
  const d = db();
  return d.transaction('r', [d.progress, d.answers, d.examAttempts, d.srs, d.notes, d.activity, d.settings], async () => ({
    progress: await d.progress.toArray(),
    answers: await d.answers.toArray(),
    attempts: await d.examAttempts.toArray(),
    srs: await d.srs.toArray(),
    notes: await d.notes.toArray(),
    activity: await d.activity.toArray(),
    settings: (await d.settings.get('settings')) as Partial<Settings> | undefined,
  }));
}

/** Any live Dexie query, with errors reported instead of thrown (private windows, blocked storage). */
export function useLive<T>(query: () => Promise<T>, deps: unknown[] = []): { value: T | undefined; error: boolean } {
  const [state, setState] = useState<{ value: T | undefined; error: boolean }>({ value: undefined, error: false });
  useEffect(() => {
    let sub: { unsubscribe: () => void } | undefined;
    try {
      sub = liveQuery(query).subscribe({
        next: (value) => setState({ value, error: false }),
        error: () => setState((s) => ({ ...s, error: true })),
      });
    } catch {
      setState((s) => ({ ...s, error: true }));
    }
    return () => sub?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useFacts(): { facts: GameFacts | null; failed: boolean } {
  const [s, setS] = useState<{ facts: GameFacts | null; failed: boolean }>({ facts: null, failed: false });
  useEffect(() => {
    let live = true;
    loadFacts().then((facts) => live && setS({ facts, failed: false })).catch(() => live && setS({ facts: null, failed: true }));
    return () => { live = false; };
  }, []);
  return s;
}

/** XP, level and badges, live. `game` stays null until both the progress and the facts are loaded. */
export function useGame(): { game: GameState | null; data: GameData | undefined; storageError: boolean; factsFailed: boolean } {
  const { value: data, error } = useLive(readGameData);
  const { facts, failed } = useFacts();
  const game = useMemo(() => (data && facts ? computeGame(data, facts) : null), [data, facts]);
  return { game, data, storageError: error, factsFailed: failed };
}

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
