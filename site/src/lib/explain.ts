// "Explain it back" notes (the Feynman technique of Part 0: after each chapter, explain the main idea in
// simple words, in French or in English, as if to a friend who does not work with data; where you get
// stuck is exactly what to review). One note per chapter: notes table, id "explain:chNN", kind 'explain',
// ref "chNN". The text stays readable (and editable) in the error notebook: one "## " line per prompt.

export interface ExplainPrompt { id: string; label: string; help: string }

export const EXPLAIN_PROMPTS: ExplainPrompt[] = [
  { id: 'idea', label: 'The idea in simple words', help: 'Explain the main idea of this chapter in about three sentences, as if to a friend who does not work with data. French or English.' },
  { id: 'why', label: 'Why it matters', help: 'When would you use this in a dbt project, or meet it on the exam? Give one example.' },
  { id: 'stuck', label: 'Where I got stuck', help: 'Write what you could not explain simply. This is exactly what to review.' },
];

export const explainNoteId = (chapterId: string) => `explain:${chapterId}`;

export function explainHeader(chapterNumber: number, chapterTitle: string): string {
  return `Explain it back: Chapter ${chapterNumber}, ${chapterTitle}`;
}

/** The note text: a header line, then one "## label" line and the answer for each prompt. */
export function formatExplain(header: string, answers: Record<string, string>, prompts = EXPLAIN_PROMPTS): string {
  const parts = [header];
  for (const p of prompts) parts.push(`## ${p.label}`, (answers[p.id] ?? '').trim());
  return parts.join('\n').trim() + '\n';
}

/** Reads the answers back. Text without the prompt lines (edited in the notebook) goes to the first prompt. */
export function parseExplain(text: string | undefined, prompts = EXPLAIN_PROMPTS): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries(prompts.map((p) => [p.id, '']));
  if (!text) return out;
  const byLabel = new Map(prompts.map((p) => [p.label.toLowerCase(), p.id]));
  let cur: string | null = null;
  let found = false;
  const loose: string[] = [];
  const buf: Record<string, string[]> = {};
  for (const line of text.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && byLabel.has(m[1].toLowerCase())) { cur = byLabel.get(m[1].toLowerCase())!; found = true; continue; }
    if (!found && /^Explain it back:/.test(line)) continue;
    if (cur) (buf[cur] ??= []).push(line);
    else loose.push(line);
  }
  for (const [id, lines] of Object.entries(buf)) out[id] = lines.join('\n').trim();
  const rest = loose.join('\n').trim();
  if (rest) out[prompts[0].id] = [rest, out[prompts[0].id]].filter(Boolean).join('\n');
  return out;
}

export const hasWords = (answers: Record<string, string>) => Object.values(answers).some((v) => v.trim().length > 0);
