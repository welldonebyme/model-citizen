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
- question `q-ch07-07` (chapter quiz Q7), mock question `m2-q41` (two digits: `m1-q01`), trap `trap-063`, term `term-<slug>`
  (slug of make_glossary's sort key: `term-dbt-project-yml`)
- `\section*` also takes the next lesson number (only the mock chapters use it); a quiz section keeps its number
  (Chapter 4: lessons ch04-s1..s8, quiz section 9, lessons ch04-s10..s18, quiz section 19), so lesson numbers equal the
  printed section numbers

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
  objectives: string[]; minutes: number /* sum of lesson reading time */; labMinutes: number;
};
type Lesson = {
  id: string; number: string /* "7.3" */; title: Inline[]; titleText: string; label?: string; anchors: string[];
  steps: { id: string; number?: string /* "7.3.2" */; title: Inline[]; titleText: string; anchor?: string;
           blocks: Block[] }[];
  minutes: number;     // READING time only: words/130 (prose, callouts, tables, lab text, inline code) + code lines/8
                       // + output lines/20 + 1 per figure, rounded UP to the next 5 (min 5)
  labMinutes: number;  // hands-on effort: 10 per lab + 2 per numbered lab step, rounded up to 5 (0 without a lab)
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
       // hotspot 9 (line) | fill {accepted:["identifier"]} | several blanks {blanks:[[...],[...]], unordered?: true}
       // unordered: the blank values may be given in any order ("set X to ___ or ___")
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

## Converter v1: precisions and extensions (implemented, see converter/README.md)

These fields were added while converting the real book; each one carries content the original contract could not
hold. Optional fields are omitted when empty.

**Chapter** adds `printed` ("7", "A"), `kind` (`start | chapter | strategy | mock | mock-answers | appendix`),
`partLabel` ("Part II"), `mock?` (1-3 on mock chapters) and `quizSections`:
```ts
quizSections: { index: number /* section ordinal, like lesson ids */; number: string; title: Inline[]; titleText: string;
                label?: string; anchor?: string; blocks: Block[] /* text of the section + {t:"quiz"} where the
                quiz box was */; ids: string[]; kind?: "mock-answers" }[];
```
`number` is the inventory index for appendices (34-36; display `printed`). Lesson `number` is "" for `\section*`.
Mock chapters (28/30/32) put `{t:"quiz", ids:["m1-q01",...]}` where the questions list is; answer chapters (29/31/33)
have a quiz section (kind "mock-answers") for the answers part. Chapter 27's trap lists become `{t:"traps", ids}`.

**Blocks**
- `list.marker?`: the enumitem label as a template ("1." default for ol, "a.", "(a)", "A.", "T1"; ul: "checkbox");
  `start?` continues a numbering series.
- `code.textBook?` / `code.titleBook?`: original text when a path rewrite changed it (inline `{t:"code"}` too).
  Tabs are expanded like listings (tabsize 2); trailing empty lines are dropped (listings does not print them).
- `lab.anchor?` (its `\label`). `figure.anchor?`, `figure.description?` (long text from overrides/figures.yaml);
  `figure.alt` is "" until overrides/figures.yaml has an entry for the figure (checked against the source sha1).
- `objectives` (exambox): `items: {id: string | null, ids?: string[] /* several tags on one item */, c}[]`,
  `title?` (custom box title), `blocks?` (text after the list).
- `table.rules?: number[]`: body rows preceded by a `\midrule`/`\hline` (after the head). Cells: `c` is `Inline[]`
  unless the cell holds blocks; a `code` dict with `text` is a block, with `v` it is inline.
- `{t: "traps", ids: string[]}` (Chapter 27).
- callout `title?` keeps the book's custom title (it may start with an icon node).

**Inline**: `{t:"blank"}` is also used for write-in lines (`\rule`, `\hrulefill`); a blank inside `\code{}` splits the
code: `[{t:"code",v:"dbt seed "},{t:"blank"},{t:"code",v:" -s x"}]`. `{t:"sf"}` is kept for `\textsf`.

**Question**
- `source` adds `quiz` (quiz box number) and `printed` (number printed in the book) when a chapter has two quizzes
  (Chapter 4 restarts at Q1).
- `keyStatus`: `ok` (regular form, validated) | `override` (overrides/keys.yaml) | `todo` (not certain: see
  overrides/keys-todo.yaml; `key` may be null or a partial proposal; `keyNote` says why). The site must not grade
  a `todo` question as if its key were complete.
- fill-in: `blanks: number` (blanks counted in the stem: `\underline{\hspace}`, `___` in text, code or listings);
  `key` is `{accepted: string[]}` for one blank or `{blanks: string[][]}` (one accepted list per blank, in order).
- `match`: left ids "1".."n", right ids as printed ("a".. or "A.."); `titles?: {left, right}` (table head),
  `reuse?: true` when there are fewer right items than left items (a right item may be used several times; then
  the key need not be a bijection), `inline?: true` when the items were written "(1) ... (a) ..." in the stem.
- `hotspot`: `{codeId, lines, numbering: "listing" | "text", firstLine?, parts?: {codeId, from, to}[]}`; "text"
  means the line numbers are printed inside the code ("1| ..."), `parts` when they continue over several blocks.
- `options[].blocks?` when an option needs block content (not used by the current book).
- `explanation` is the complete answer text (mock answers: everything between `\mockkey` and `\mockreview`);
  `whyWrong` is a structured index of the "why the others are wrong" items already contained in it.
- `formatLabel` is the printed label without brackets ("Multiple select — choose 2").

**Routes** used in `ref.href` / labels.json: chapter `/learn/chNN/`, lesson `/learn/chNN/chNN-sK/`, anchors
`#sec-...`, `#lab-...`, `#fig-...`, `#tab-...` (label with ":" -> "-"); quiz section `/learn/chNN/quiz/` (plus
`#anchor` when the chapter has two); appendices `/learn/appA/`. `\ref{lab:..}` prints "Lab 22.1" (lab position in
its chapter; the PDF prints an unrelated counter there, see report.json bookErrors).

**Datasets**
- `traps.json`: `where` is Inline[] with `ref` nodes to the chapters ("Chapters 3" + " and " + "25").
- `glossary.json` occurrences: `{chapter: "ch07", lesson: id | null, anchor: step id | "intro" | "quiz" | "summary"}`.
- `objectives.json`: `{id, kind: official | prerequisite | meta, topic (0 for CP0), title, chapters, labs, mockQuestions}`;
  titles come from dbt-bible/tools/make_coverage.py (plain text, no TeX ligatures); `title` is null for tags the book
  never defines (CP0-CLI, CP0-DATA, CP0-YAML, CP0-JINJA, CP0-PY, EXAM, PLAN, ALL).
- `coverage.json`: `{objectives: {id: {chapters, lessons, labs, mockQuestions, chapterQuestions}}, gaps: []}`
  (make_coverage.py logic; chapterQuestions stays empty until an override maps chapter questions to objectives).
- `mocks/mockN.json`: `{id, mock, title, chapter, answersChapter, minutes: 120, questions, formats, topics}`.
- `plan.json`: `{source, intro, columns, weeks: [{week, bible, official, checkpoint}], rhythms: [{rhythm, how}],
  session: [{minutes, activity}], readiness: {intro, conditions: Block[][]}}`.
- `cheatsheets.json`: `{id: "appA", title, intro, sections: [{id, number, title, titleText, anchor, steps}]}`.
- `labels.json`: `{label: {href, text, kind, chapter, lesson?}}`.
- `report.json`: summary, acceptance results, flaggedKeys, overridesApplied, bookConsistency (book-internal
  cross-checks), bookErrors, figures (`{id, chapter, k, file, line, endLine, sha1}`; sha1 of the exact text from
  `\begin{tikzpicture}` to `\end{tikzpicture}`), pathRewrites, warnings, stats.
