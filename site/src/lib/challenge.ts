// Friend challenge: a seeded set of questions encoded in a short link (?c=<code>), so two people get
// exactly the same questions in the same order, each in their own browser. Nothing is sent anywhere:
// the code holds the seed and the filters, and both browsers pick the questions from the same bank.
//
// Code layout (17 bytes, base64url, 23 characters):
//   0      version (1)
//   1..4   seed (uint32)
//   5      number of questions (1..65)
//   6..9   chapter quizzes (bit n = chapter n, 0..31)
//   10     mock exams (bit 0..2 = mock 1..3)
//   11..12 topics (bit n = topic n, 0..8)
//   13     formats (bit i = FORMATS[i])
//   14..16 checksum of the picked question ids (24 bits), to notice a different question bank
// Empty chapter and mock sets mean "every source"; an empty topic or format set means "all".
import type { Format, Question } from './content-types';
import { EMPTY_FILTER, filterBank, pick } from './exam/bank';

export const FORMATS: Format[] = ['mc', 'ms', 'fill', 'match', 'hotspot', 'order', 'domc'];
export const CHALLENGE_SIZES = [5, 10, 15, 20, 30] as const;
export const MAX_QUESTIONS = 65;
const VERSION = 1;
const BYTES = 17;

export interface Challenge {
  seed: number;
  n: number;
  chapters: number[];
  mocks: number[];
  topics: number[];
  formats: Format[];
  /** 24-bit checksum of the picked ids (0 when unknown) */
  check: number;
}

/** What the challenge needs from each question (the drills index rows have it). */
export type BankItem = Pick<Question, 'id' | 'format' | 'source' | 'objective' | 'topic'>;

const NO_HISTORY = { seen: new Set<string>(), mistakes: new Set<string>() };

function mask(list: number[], max: number): number {
  let m = 0;
  for (const n of list) if (Number.isInteger(n) && n >= 0 && n <= max) m = (m | (1 << n)) >>> 0;
  return m >>> 0;
}
function unmask(m: number, max: number): number[] {
  const out: number[] = [];
  for (let n = 0; n <= max; n++) if ((m >>> n) & 1) out.push(n);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** FNV-1a over the ids, folded to 24 bits. */
export function checksum(ids: string[]): number {
  let h = 0x811c9dc5;
  const s = ids.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ((h >>> 24) ^ h) & 0xffffff;
}

export function encodeChallenge(c: Challenge): string {
  const b = new Uint8Array(BYTES);
  const dv = new DataView(b.buffer);
  dv.setUint8(0, VERSION);
  dv.setUint32(1, c.seed >>> 0);
  dv.setUint8(5, Math.max(1, Math.min(MAX_QUESTIONS, Math.round(c.n))));
  dv.setUint32(6, mask(c.chapters, 31));
  dv.setUint8(10, mask(c.mocks.map((m) => m - 1), 2));
  dv.setUint16(11, mask(c.topics, 8));
  dv.setUint8(13, mask(c.formats.map((f) => FORMATS.indexOf(f)).filter((i) => i >= 0), 6));
  dv.setUint8(14, (c.check >>> 16) & 0xff);
  dv.setUint16(15, c.check & 0xffff);
  return toBase64Url(b);
}

/** The challenge in a code, or null when the code is damaged or comes from a newer version. */
export function decodeChallenge(code: string | null | undefined): Challenge | null {
  if (!code) return null;
  const b = fromBase64Url(code.trim());
  if (!b || b.length !== BYTES) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint8(0) !== VERSION) return null;
  const n = dv.getUint8(5);
  if (n < 1 || n > MAX_QUESTIONS) return null;
  if (dv.getUint8(10) > 0b111 || dv.getUint16(11) > 0x1ff || dv.getUint8(13) > 0x7f) return null;
  return {
    seed: dv.getUint32(1),
    n,
    chapters: unmask(dv.getUint32(6), 31),
    mocks: unmask(dv.getUint8(10), 2).map((m) => m + 1),
    topics: unmask(dv.getUint16(11), 8),
    formats: unmask(dv.getUint8(13), 6).map((i) => FORMATS[i]),
    check: (dv.getUint8(14) << 16) | dv.getUint16(15),
  };
}

type Filters = Pick<Challenge, 'chapters' | 'mocks' | 'topics' | 'formats'>;

/** The questions that match the filters, in a fixed order (by id), so every browser has the same list. */
export function challengePool<T extends BankItem>(bank: T[], f: Filters): T[] {
  const anySource = f.chapters.length === 0 && f.mocks.length === 0;
  const ch = new Set(f.chapters);
  const mk = new Set(f.mocks);
  const matched = filterBank(bank as unknown as Question[], { ...EMPTY_FILTER, topics: f.topics, formats: f.formats }, NO_HISTORY) as unknown as T[];
  return matched
    .filter((q) => anySource || (q.source.kind === 'chapter' ? ch.has(q.source.chapter) : mk.has(q.source.mock)))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The ids of the challenge's questions, in the order everyone gets them. */
export function challengeIds(bank: BankItem[], c: Challenge): string[] {
  const pool = challengePool(bank, c);
  return pick(pool as unknown as Question[], Math.min(c.n, pool.length), c.seed).map((q) => q.id);
}

/** A new challenge: a random seed, the filters, and the checksum of the questions it picks. */
export function createChallenge(bank: BankItem[], f: Filters & { n: number }, seed = Math.floor(Math.random() * 2 ** 32) >>> 0): Challenge {
  const base: Challenge = { seed: seed >>> 0, n: Math.max(1, Math.min(MAX_QUESTIONS, f.n)), chapters: [...f.chapters].sort((a, b) => a - b), mocks: [...f.mocks].sort(), topics: [...f.topics].sort((a, b) => a - b), formats: FORMATS.filter((x) => f.formats.includes(x)), check: 0 };
  return { ...base, check: checksum(challengeIds(bank, base)) };
}

/** The sender's score carried in the link (&s=17.20.21: right, total, minutes). */
export interface SharedScore { right: number; total: number; minutes: number }
export function encodeScore(s: SharedScore): string {
  return `${s.right}.${s.total}.${s.minutes}`;
}
export function decodeScore(text: string | null | undefined, total?: number): SharedScore | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/.exec(text ?? '');
  if (!m) return null;
  const s = { right: Number(m[1]), total: Number(m[2]), minutes: Number(m[3]) };
  if (s.total < 1 || s.total > MAX_QUESTIONS || s.right > s.total || (total !== undefined && s.total !== total)) return null;
  return s;
}

export const pct = (right: number, total: number) => (total ? Math.round((right / total) * 100) : 0);

export function minutesText(min: number): string {
  if (min < 1) return 'less than 1 minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The text the learner copies to share a score (no exclamation marks, no network). */
export function shareText(o: { right: number; total: number; minutes: number; link: string; name?: string }): string {
  const who = o.name?.trim() ? `${o.name.trim()} scored` : 'I scored';
  return [
    `Model Citizen challenge: ${who} ${o.right} of ${o.total} (${pct(o.right, o.total)}%) in ${minutesText(o.minutes)}.`,
    `The same ${o.total} questions, in the same order, for you: ${o.link}`,
  ].join('\n');
}

/** A short description of the filters, for the challenge card. */
export function describeChallenge(c: Filters, names: { formats: Record<Format, string>; topics: (n: number) => string }): string[] {
  const out: string[] = [];
  if (!c.chapters.length && !c.mocks.length) out.push('Every chapter quiz and mock exam');
  else {
    const parts: string[] = [];
    if (c.chapters.length) parts.push(`${c.chapters.length === 1 ? 'Chapter' : 'Chapters'} ${ranges(c.chapters)}`);
    if (c.mocks.length) parts.push(`${c.mocks.length === 1 ? 'mock exam' : 'mock exams'} ${c.mocks.join(', ')}`);
    out.push(parts.join(' and '));
  }
  out.push(c.topics.length ? c.topics.map(names.topics).join(', ') : 'All topics');
  out.push(c.formats.length ? c.formats.map((f) => names.formats[f]).join(', ') : 'All formats');
  return out;
}

/** 1,2,3,5,7,8 -> "1–3, 5, 7–8" */
export function ranges(ns: number[]): string {
  const s = [...new Set(ns)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`);
    i = j;
  }
  return out.join(', ');
}
