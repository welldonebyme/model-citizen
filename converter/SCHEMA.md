# Content schema: book (LaTeX) → website JSON

This is the contract between `converter/` (writes) and `site/` (reads). All generated files live in
`site/src/generated/` and are **never edited by hand**. Change the book, a rule file, or an override file,
then re-run the converter. Output must be byte-identical on re-runs (sorted keys where order is not
meaningful, stable ids, no timestamps).

Hand-curated inputs that are not in the book live in `converter/overrides/` (YAML). Every override entry
stores a short hash of the book text it applies to; if the book text changes, the converter fails with a
clear message instead of applying a stale override.

## Files

| File | Content |
|---|---|
| `book.json` | Parts → chapters → lessons (ids, numbers, titles, labels, minutes, flags) — the navigation tree |
| `chapters/chNN.json` | One chapter: intro blocks, lessons with steps, quiz question ids, summary |
| `questions/chNN.json` | Chapter quiz questions (`Question[]`) |
| `mocks/mockN.json` | Mock exam: meta + 65 `Question` (stem from ch28/30/32, key/explanations from ch29/31/33) |
| `traps.json` | 145 traps `{id: "trap-001", n: 1, topic, confusion: Inline[], truth: Inline[], where: Inline[], chapters: [n]}` |
| `glossary.json` | 305 terms `{id: "term-grain", en, fr, chapter, occurrences: [{lesson, anchor}]}` |
| `objectives.json` | 31 official + CP0 prerequisites + PLAN `{id, topic, title, chapters, labs, mockQuestions}` |
| `coverage.json` | objective → lesson ids, lab ids, question ids (chapter + mock) |
| `cheatsheets.json` | Appendix A as chapter-like JSON (blocks) |
| `plan.json` | 14-week plan rows + rhythms + typical session + readiness conditions (Part 0) |
| `labels.json` | every `\label` → `{href, text}` ("Chapter 14", "Section 14.3", "Lab 14.2"...) |
| `figures/` | `chNN-figK.svg` (themable, see Figures) |
| `report.json` | converter stats + acceptance-test results (counts vs `reference/content-inventory.json`) |

## Ids (stable, never renumber once published)

- chapter `ch07` (Part 0 = `ch00`, appendices `appA` cheat sheets, `appB` coverage, `appC` glossary)
- lesson `ch07-s3` = 3rd `\section` of the chapter (the "Check yourself" section is the quiz, not a lesson)
- step `ch07-s3-1` = step index inside the lesson (step 0 = section text before the first `\subsection`)
- lab `ch07-lab2` (order in chapter), code block `ch07-c12` (order in chapter, all code envs), figure `ch07-fig1`
- question `q-ch07-07` (chapter quiz Q7), mock question `m2-q41`, trap `trap-063`, term `term-<slug>`

## Inline nodes (`Inline = string | InlineNode`)

Plain strings are text (LaTeX escapes and ligatures already resolved: `-{}-` → `--`, `\ldots` → `…`,
`''`/``` `` ``` → `"`, `\,` → thin space, `~` → no-break space, `$\rightarrow$` → `→`, `$\geq$` → `≥`).

```ts
type InlineNode =
  | { t: "code"; v: string }                       // \code, \texttt
  | { t: "b" | "i" | "u" | "sf"; c: Inline[] }     // \textbf, \emph/\textit, \underline, \textsf (keep sf only if meaningful)
  | { t: "term"; en: Inline[]; fr: string; id: string }   // \term{EN}{FR}
  | { t: "key"; v: string }                        // \key{Ctrl+C}
  | { t: "obj"; id: string }                       // \objective{1.11}
  | { t: "ref"; label: string; text: string; href: string }  // \ref, Chapter~\ref{..}, Section~\ref{..}
  | { t: "link"; href: string; c: Inline[] }       // \href, \url
  | { t: "icon"; name: string }                    // \faCheck, \checkbox, \done ...
  | { t: "blank" }                                 // \underline{\hspace{..}} in fill-in-the-blank stems
  | { t: "br" };                                   // \\ or \newline inside a paragraph/cell
```
`\ref` resolution: the visible text keeps the book's words ("Chapter~\ref{ch:sql}" → `{t:"ref", text:"Chapter 4"}`
replacing the whole phrase), `href` is the site route (`/learn/ch04/` , `/learn/ch14/ch14-s3/#anchor`).

## Block nodes

```ts
type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 3 | 4; c: Inline[]; anchor?: string }           // \subsubsection, \paragraph
  | { t: "list"; kind: "ul" | "ol" | "dl"; items: { term?: Inline[]; blocks: Block[] }[]; start?: number }
  | { t: "code"; id: string; lang: Lang; text: string; title?: string; lineNumbers?: boolean;
      firstLine?: number; expected?: string /* id of the output block that follows a sql/dbt block */;
      small?: boolean }
  | { t: "callout"; kind: CalloutKind; title?: Inline[]; blocks: Block[] }
  | { t: "lab"; id: string; title: Inline[]; objectives: string[]; blocks: Block[] }
  | { t: "objectives"; items: { id: string; c: Inline[] }[] }        // exambox
  | { t: "table"; head?: Cell[][]; rows: Cell[][]; groupRows?: number[]; caption?: Inline[] }
  | { t: "figure"; id: string; src: string; alt: string; caption?: Inline[]; width?: number; height?: number }
  | { t: "quiz"; ids: string[] }                                       // where the chapter quiz sits
  | { t: "hr" };

type Lang = "sql" | "dbt" | "yaml" | "jinja" | "python" | "bash" | "output" | "plain";
type CalloutKind = "why" | "idea" | "analogy" | "trap" | "tip" | "deep" | "dbt" | "summary" | "quiz" | "answer";
type Cell = { c: Inline[] | Block[]; colspan?: number; rowspan?: number; align?: "l" | "c" | "r"; header?: boolean };
```
- `bash` code keeps the raw text; the site treats lines starting with `$ ` as commands.
- `lineNumbers: true` when listing options contain `numbers=left` (hotspot questions, "line N" references).
- `small: true` for chapter-local small styles (`c8small`, `c14out`…): purely visual.
- Path rewrites for the web (book's `~/Documents/Adnane/dbt-bible/labs/...`, `/Users/mac/...`) are applied by
  `converter/rules/paths.yaml` with unit tests; the original text is kept in `textBook` when changed.

## Chapter / lesson

```ts
type Chapter = {
  id: string; number: number; part: number; partTitle: string; title: string; label: string;
  intro: Block[];                // exambox, whybox, ideabox... before the first \section
  lessons: Lesson[];
  quiz: string[];                // question ids (questions/chNN.json)
  summary: Block[];              // summarybox (usually after the answers)
  objectives: string[]; minutes: number;
};
type Lesson = {
  id: string; number: string /* "7.3" */; title: Inline[]; titleText: string; label?: string; anchors: string[];
  steps: { id: string; title: Inline[]; titleText: string; anchor?: string; blocks: Block[] }[];
  minutes: number;              // reading estimate (words/180 + code lines/12 + labs*10), rounded to 5
  labs: string[]; objectives: string[]; checkpoints: string[] /* question ids mapped to this lesson (override file) */;
};
```

## Questions (chapter quizzes and mocks share one shape)

```ts
type Format = "mc" | "ms" | "fill" | "match" | "hotspot" | "order" | "domc";
type Question = {
  id: string;
  source: { kind: "chapter"; chapter: number; n: number } | { kind: "mock"; mock: 1 | 2 | 3; n: number };
  format: Format; formatLabel: string;     // label as printed, e.g. "Multiple select — choose 2"
  choose?: number;                          // ms
  objective?: string;                       // mocks: from \mockkey; chapters: from coverage/override
  topic?: number;                           // 1..7 (mocks: blueprint)
  stem: Block[];                            // may contain code blocks / tables; hotspot code has lineNumbers
  options?: { id: string; c: Inline[] }[];  // mc, ms, domc, order (A, B, C...)
  match?: { left: { id: string; c: Inline[] }[]; right: { id: string; c: Inline[] }[] };
  hotspot?: { codeId: string; lines: number };
  key: string | string[] | Record<string, string> | Record<string, boolean> | number | { accepted: string[] };
       // mc "B" | ms ["A","C"] | order ["B","D","A","E","C"] | match {"1":"b",...} | domc {"A":true,...}
       // hotspot 9 (line) | fill {accepted:["identifier"]}
  keyRaw: string;                           // the key exactly as written in the book (for audits)
  explanation: Block[];                     // full book explanation
  whyWrong?: { option: string; c: Inline[] }[];  // mocks: "why the others are wrong" items when present
  review?: Inline[];                        // mocks: \mockreview{...} resolved to links
};
```
Key normalisation: the parser handles the regular forms; anything ambiguous is resolved in
`converter/overrides/keys.yaml` (agent-normalised, then independently re-solved — see docs/07 §2).
Validation (hard errors): mc 1 valid letter; ms exactly `choose` letters; order a permutation of all options;
match a bijection left→right; domc a boolean for every option; hotspot an existing line; fill ≥ 1 accepted value.

## Figures

TikZ figures are compiled standalone (book preamble colours) to SVG, then post-processed so the book
palette maps to CSS variables (`#1F2A44` ink → `var(--fig-ink)`, `#E8573F` accent → `var(--fig-accent)`,
code background → `var(--fig-code-bg)`, white fills → `var(--fig-paper)`…) for light/dark themes. Text stays
text where possible (search, accessibility). Each figure gets alt text (written once in
`converter/overrides/figures.yaml`, keyed by figure id + source hash).

## Acceptance tests (must pass; see docs/05 §7 and docs/07 §1)

Per chapter, counts equal `reference/content-inventory.json`: sections, each box type, code blocks per
language, TikZ figures, labs (+ objective tags), quiz questions and formats, objective tags, terms.
Totals: 487 chapter questions, 195 mock keys, 145 traps, 305 glossary terms, 118 labs, 64 figures.
No raw LaTeX in any generated string (`\\[a-zA-Z]+`, unbalanced braces, `$` math left over).
Every `ref` resolves; every question key validates.
