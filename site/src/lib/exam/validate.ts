// Can a question be shown and graded? (docs/07 §2: every key must have the right shape for its format.)
// Questions whose key is still being checked by the converter (key null, keyStatus "todo") are left out
// of quizzes and exams instead of breaking them.
import type { Question } from '../content-types';

export function playableReason(q: Question): string | null {
  const k = q.key as unknown;
  const ids = (q.options ?? []).map((o) => o.id);
  if (k === null || k === undefined) return 'no answer key yet';
  switch (q.format) {
    case 'mc':
      return typeof k === 'string' && ids.includes(k) ? null : 'the key is not one of the options';
    case 'ms':
      return Array.isArray(k) && k.length > 0 && k.every((x) => ids.includes(x)) ? null : 'the key is not a set of options';
    case 'order':
      return Array.isArray(k) && k.length === ids.length && [...k].sort().join() === [...ids].sort().join() ? null : 'the key is not an order of all the items';
    case 'domc':
      return typeof k === 'object' && ids.length > 0 && ids.every((id) => typeof (k as Record<string, unknown>)[id] === 'boolean') ? null : 'the key has no YES/NO for every option';
    case 'match': {
      const left = q.match?.left ?? [];
      const right = new Set((q.match?.right ?? []).map((r) => r.id));
      return typeof k === 'object' && left.length > 0 && left.every((l) => right.has((k as Record<string, string>)[l.id])) ? null : 'the key does not match every item';
    }
    case 'hotspot': {
      if (!q.hotspot || typeof k !== 'number') return 'no code line to choose';
      const code = q.stem.find((b) => b.t === 'code' && b.id === q.hotspot!.codeId);
      const parts = (q.hotspot as { parts?: { codeId: string }[] }).parts ?? [];
      if (!parts.every((p) => q.stem.some((b) => b.t === 'code' && b.id === p.codeId))) return 'a code block of the hotspot is missing';
      return code && k >= 1 ? null : 'the code block of the hotspot is missing';
    }
    case 'fill': {
      const f = k as { accepted?: unknown; blanks?: unknown };
      if (Array.isArray(f.blanks)) return f.blanks.length > 0 && f.blanks.every((b) => Array.isArray(b) && b.length > 0) ? null : 'a blank has no accepted value';
      return Array.isArray(f.accepted) && f.accepted.length > 0 ? null : 'no accepted value';
    }
    default:
      return 'unknown format';
  }
}

export const isPlayable = (q: Question) => playableReason(q) === null;
