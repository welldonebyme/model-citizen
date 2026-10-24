import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ModelCitizenDB, streakFrom } from '../../src/lib/store/db';
import { exportProgress, importProgress, validateProgressFile, ImportError } from '../../src/lib/store/transfer';
import { newCard, review, addDays } from '../../src/lib/srs';

describe('progress file', () => {
  it('round-trips and merges without duplicates', async () => {
    const a = new ModelCitizenDB('test-a');
    await a.progress.put({ id: 'step:ch07-s3-1', kind: 'step', ref: 'ch07-s3-1', status: 'understood', firstAt: 1, updatedAt: 10 });
    await a.answers.add({ qid: 'q-ch07-01', mode: 'quiz', response: { format: 'mc', choice: 'B' }, correct: true, at: 100 });
    const file = validateProgressFile(JSON.parse(JSON.stringify(await exportProgress(a))));

    const b = new ModelCitizenDB('test-b');
    await b.progress.put({ id: 'step:ch07-s3-1', kind: 'step', ref: 'ch07-s3-1', status: 'seen', firstAt: 1, updatedAt: 5 });
    const s1 = await importProgress(file, b);
    expect(s1).toEqual({ added: 1, updated: 1, skipped: 0 });
    expect((await b.progress.get('step:ch07-s3-1'))?.status).toBe('understood');
    const s2 = await importProgress(file, b); // importing twice changes nothing
    expect(s2.added).toBe(0);
    expect(await b.answers.count()).toBe(1);
  });
  it('rejects foreign files with a clear message', () => {
    expect(() => validateProgressFile({ hello: 1 })).toThrow(ImportError);
    expect(() => validateProgressFile({ app: 'model-citizen', schema: 99, data: {} })).toThrow(/newer version/);
  });
});

describe('streaks and SRS', () => {
  it('counts consecutive days ending today or yesterday', () => {
    const now = new Date(2026, 9, 24);
    expect(streakFrom(['2026-10-24', '2026-10-23', '2026-10-22', '2026-10-20'], now)).toBe(3);
    expect(streakFrom(['2026-10-23', '2026-10-22'], now)).toBe(2);
    expect(streakFrom(['2026-10-21'], now)).toBe(0);
  });
  it('Leitner boxes follow 1, 3, 7, 21, 60 days', () => {
    let c = newCard('trap-001', 'trap', '2026-10-24');
    expect(c.due).toBe('2026-10-25');
    c = review(c, true, '2026-10-25'); expect(c.box).toBe(2); expect(c.due).toBe(addDays('2026-10-25', 3));
    c = review(c, false, '2026-10-28'); expect(c.box).toBe(1); expect(c.lapses).toBe(1);
  });
});
