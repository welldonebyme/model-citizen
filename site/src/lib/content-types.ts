// TypeScript mirror of converter/SCHEMA.md. Keep both in sync.

export type Inline = string | InlineNode;
export type InlineNode =
  | { t: 'code'; v: string }
  | { t: 'b' | 'i' | 'u' | 'sf'; c: Inline[] }
  | { t: 'term'; en: Inline[]; fr: string; id: string }
  | { t: 'key'; v: string }
  | { t: 'obj'; id: string }
  | { t: 'ref'; label: string; text: string; href: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'icon'; name: string }
  | { t: 'blank' }
  | { t: 'br' };

export type Lang = 'sql' | 'dbt' | 'yaml' | 'jinja' | 'python' | 'bash' | 'output' | 'plain';
export type CalloutKind = 'why' | 'idea' | 'analogy' | 'trap' | 'tip' | 'deep' | 'dbt' | 'summary' | 'quiz' | 'answer';
export type Cell = { c: Inline[] | Block[]; colspan?: number; rowspan?: number; align?: 'l' | 'c' | 'r'; header?: boolean };

export type CodeBlock = {
  t: 'code'; id: string; lang: Lang; text: string; title?: string; lineNumbers?: boolean; firstLine?: number;
  expected?: string; small?: boolean; textBook?: string;
  /** Windows / WSL variants of a shell block (from converter overrides). */
  variants?: { win?: string; wsl?: string };
};

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 3 | 4; c: Inline[]; anchor?: string }
  | { t: 'list'; kind: 'ul' | 'ol' | 'dl'; items: { term?: Inline[]; blocks: Block[] }[]; start?: number }
  | CodeBlock
  | { t: 'callout'; kind: CalloutKind; title?: Inline[]; blocks: Block[];
      /** OS note (converter/overrides/os-notes.yaml): shown only when the OS switch is one of these */
      os?: ('mac' | 'win' | 'wsl')[]; osNote?: string }
  | { t: 'lab'; id: string; anchor?: string; title: Inline[]; objectives: string[]; blocks: Block[] }
  | { t: 'objectives'; items: { id: string; c: Inline[] }[] }
  | { t: 'table'; anchor?: string; head?: Cell[][]; rows: Cell[][]; groupRows?: number[]; caption?: Inline[] }
  | { t: 'figure'; anchor?: string; id: string; src: string; alt: string; caption?: Inline[]; width?: number; height?: number }
  | { t: 'quiz'; ids: string[] }
  | { t: 'hr' };

export type Step = { id: string; title: Inline[]; titleText: string; anchor?: string; blocks: Block[] };
export type Lesson = {
  id: string; number: string; title: Inline[]; titleText: string; label?: string; anchors: string[];
  steps: Step[]; minutes: number; labMinutes?: number; labs: string[]; objectives: string[]; checkpoints: string[];
};
export type Chapter = {
  id: string; number: number; part: number; partTitle: string; title: string; label: string;
  intro: Block[]; lessons: Lesson[]; quiz: string[]; summary: Block[]; objectives: string[]; minutes: number;
};

export type Format = 'mc' | 'ms' | 'fill' | 'match' | 'hotspot' | 'order' | 'domc';
export type Question = {
  id: string;
  source: { kind: 'chapter'; chapter: number; n: number } | { kind: 'mock'; mock: 1 | 2 | 3; n: number };
  format: Format; formatLabel: string; choose?: number; objective?: string; topic?: number;
  stem: Block[];
  options?: { id: string; c: Inline[] }[];
  match?: { left: { id: string; c: Inline[] }[]; right: { id: string; c: Inline[] }[] };
  hotspot?: { codeId: string; lines: number };
  key: string | string[] | Record<string, string> | Record<string, boolean> | number | { accepted: string[] } | { blanks: string[][]; unordered?: boolean };
  keyRaw: string;
  /** fill in the blank with several blanks: their number (key is { blanks: accepted values per blank }) */
  blanks?: number;
  /** converter audit fields: 'ok' when the key was parsed with certainty */
  keyStatus?: string; keyNote?: string;
  explanation: Block[];
  whyWrong?: { option: string; c: Inline[] }[];
  review?: Inline[];
};
