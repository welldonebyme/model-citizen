// Saving and loading mock exam attempts (IndexedDB, table examAttempts).
import { db } from '../store/db';
import type { Attempt } from './engine';

export async function saveAttempt(a: Attempt): Promise<void> {
  await db().examAttempts.put({ ...a, updatedAt: Date.now() });
}

export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return (await db().examAttempts.get(id)) as Attempt | undefined;
}

/** The attempt in progress for a mock (the most recent one), if any. */
export async function activeAttempt(mock: number): Promise<Attempt | undefined> {
  const list = (await db().examAttempts.where('mock').equals(mock).toArray()) as Attempt[];
  return list.filter((a) => a.status === 'active').sort((a, b) => b.startedAt - a.startedAt)[0];
}

export async function listAttempts(): Promise<Attempt[]> {
  const list = (await db().examAttempts.toArray()) as Attempt[];
  return list.sort((a, b) => a.startedAt - b.startedAt);
}

export async function abandonAttempt(id: string): Promise<void> {
  const a = await getAttempt(id);
  if (a && a.status === 'active') await db().examAttempts.put({ ...a, status: 'abandoned', updatedAt: Date.now() });
}

/** Debounced saver: call `push(a)` on every change; it writes at most every `ms`, and `flush()` writes now. */
export function makeSaver(ms = 400) {
  let pending: Attempt | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const write = () => {
    timer = null;
    const a = pending;
    pending = null;
    if (a) chain = chain.then(() => saveAttempt(a)).catch(() => undefined);
    return chain;
  };
  return {
    push(a: Attempt) {
      pending = a;
      if (!timer) timer = setTimeout(write, ms);
    },
    flush(): Promise<void> {
      if (timer) { clearTimeout(timer); timer = null; }
      return write();
    },
  };
}
