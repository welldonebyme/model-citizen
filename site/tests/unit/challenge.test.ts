import { describe, expect, it } from 'vitest';
import {
  challengeIds, challengePool, checksum, createChallenge, decodeChallenge, decodeScore, encodeChallenge, encodeScore,
  fromBase64Url, ranges, shareText, toBase64Url, type BankItem, type Challenge,
} from '../../src/lib/challenge';

const FMT = ['mc', 'ms', 'fill', 'match', 'hotspot', 'order', 'domc'] as const;
const bank: BankItem[] = [
  ...Array.from({ length: 60 }, (_, i): BankItem => ({ id: `q-ch${String(6 + (i % 4)).padStart(2, '0')}-${String(i).padStart(2, '0')}`, format: FMT[i % 7], source: { kind: 'chapter', chapter: 6 + (i % 4), n: i }, topic: 1 + (i % 3) })),
  ...Array.from({ length: 30 }, (_, i): BankItem => ({ id: `m2-q${i + 1}`, format: FMT[(i + 3) % 7], source: { kind: 'mock', mock: 2, n: i + 1 }, topic: 1 + (i % 7) })),
];

describe('challenge code', () => {
  it('round-trips every field in a short, URL-safe code', () => {
    const c: Challenge = { seed: 0xdeadbeef, n: 20, chapters: [0, 6, 7, 26, 31], mocks: [1, 3], topics: [0, 2, 8], formats: ['ms', 'domc'], check: 0xabcdef };
    const code = encodeChallenge(c);
    expect(code).toMatch(/^[A-Za-z0-9_-]{23}$/);
    expect(decodeChallenge(code)).toEqual(c);
  });
  it('rejects damaged or foreign codes', () => {
    const good = encodeChallenge({ seed: 1, n: 10, chapters: [], mocks: [], topics: [], formats: [], check: 0 });
    expect(decodeChallenge(good)).not.toBeNull();
    for (const bad of ['', 'abc', good.slice(1), good + 'A', good.replace(/^./, '!'), null, undefined]) expect(decodeChallenge(bad as string)).toBeNull();
    const b = fromBase64Url(good)!;
    b[0] = 2; // a newer version
    expect(decodeChallenge(toBase64Url(b))).toBeNull();
    const c = fromBase64Url(good)!;
    c[5] = 0; // zero questions
    expect(decodeChallenge(toBase64Url(c))).toBeNull();
  });
  it('base64url works for every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(fromBase64Url(toBase64Url(all))!)).toEqual(Array.from(all));
  });
});

describe('same questions, same order, for everyone', () => {
  it('two browsers with the same bank get the same ids, whatever the bank order', () => {
    const c = createChallenge(bank, { n: 10, chapters: [6, 7], mocks: [], topics: [], formats: [] }, 12345);
    const decoded = decodeChallenge(encodeChallenge(c))!;
    const a = challengeIds(bank, decoded);
    const b = challengeIds(bank.slice().reverse(), decoded);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    expect(new Set(a).size).toBe(10);
    expect(checksum(a)).toBe(decoded.check);
    expect(a.every((id) => /^q-ch0[67]-/.test(id))).toBe(true);
  });
  it('another seed gives another order', () => {
    const f = { n: 10, chapters: [], mocks: [], topics: [], formats: [] };
    expect(challengeIds(bank, createChallenge(bank, f, 1))).not.toEqual(challengeIds(bank, createChallenge(bank, f, 2)));
  });
  it('filters: chapters and mocks together, topics, formats', () => {
    const pool = challengePool(bank, { chapters: [8], mocks: [2], topics: [], formats: ['domc'] });
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((q) => q.format === 'domc' && (q.source.kind === 'mock' || q.source.chapter === 8))).toBe(true);
    expect(challengePool(bank, { chapters: [], mocks: [], topics: [3], formats: [] }).every((q) => q.topic === 3)).toBe(true);
  });
  it('asks for more questions than match: you get all of them', () => {
    const c = createChallenge(bank, { n: 30, chapters: [9], mocks: [], topics: [], formats: ['mc'] }, 7);
    expect(challengeIds(bank, c).length).toBe(challengePool(bank, c).length);
  });
  it('a changed bank changes the checksum', () => {
    const c = createChallenge(bank, { n: 5, chapters: [6], mocks: [], topics: [], formats: [] }, 99);
    const other = bank.filter((q) => q.id !== challengeIds(bank, c)[0]);
    expect(checksum(challengeIds(other, c))).not.toBe(c.check);
  });
});

describe('sharing a score', () => {
  it('encodes the sender score and checks it', () => {
    expect(decodeScore(encodeScore({ right: 17, total: 20, minutes: 24 }))).toEqual({ right: 17, total: 20, minutes: 24 });
    expect(decodeScore('21.20.3')).toBeNull();
    expect(decodeScore('17.20.3', 10)).toBeNull();
    expect(decodeScore('x')).toBeNull();
  });
  it('writes a plain share text without exclamation marks', () => {
    const t = shareText({ right: 17, total: 20, minutes: 24, link: 'https://example.org/model-citizen/practice/challenge/?c=abc' });
    expect(t).toContain('I scored 17 of 20 (85%) in 24 min.');
    expect(t).toContain('?c=abc');
    expect(t).not.toContain('!');
    expect(shareText({ right: 1, total: 2, minutes: 0, link: 'x', name: 'Adnane' })).toContain('Adnane scored 1 of 2 (50%) in less than 1 minute.');
  });
  it('ranges', () => {
    expect(ranges([1, 2, 3, 5, 7, 8])).toBe('1–3, 5, 7–8');
    expect(ranges([4])).toBe('4');
  });
});
