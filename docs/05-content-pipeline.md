# 05 — Content pipeline: book (LaTeX) → website

**Rule:** the book in `../dbt-bible/` is the single source of truth. A converter in `converter/` turns it into
structured content in `site/src/content/`. Re-running the converter must reproduce the site content exactly
(idempotent). If content must change, change the `.tex` file (and rebuild the PDF with `../dbt-bible/build.sh`).

## 1. Reading order and structure
- Order = `\input{...}` order in `../dbt-bible/main.tex` (Part 0 → Part IX → appendices A cheat sheets,
  B coverage matrix, C glossary). `ch04-sql.tex` inputs `ch04-sql-a.tex` and `ch04-sql-b.tex` (one chapter).
- Chapter = `\chapter{Title}\label{ch:slug}`; Part 0 is Chapter 0. Lessons = `\section{...}` (split very long
  sections at `\subsection`). Keep all `\label`s → stable anchors; resolve every `\ref{...}` to a site link
  ("Chapter 14", "Section 14.3").
- Stable IDs (never change once published): `ch14`, `ch14-s3` (section), `ch14-lab2`, `q-ch14-07`
  (chapter quiz question 7), `m2-q41` (mock 2 question 41), `trap-063`, `term-grain`.

## 2. Environments used in the book (from a full scan) → components
| LaTeX | Count | Website component |
|---|---|---|
| `outputcode` | 755 | `<Output>` (result/terminal output, "Result" header, optional title) |
| `bashcode` | 586 | `<Terminal>` — lines starting `$ ` are commands (copy button copies commands only); OS variants (see `06-labs.md`) |
| `yamlcode`, `sqlcode`, `dbtcode`, `jinjacode`, `pycode`, `plaincode` | 248, 137, 118, 18, 19, 46 | `<Code lang title>`; SQL with expected output → runnable cell (B1); YAML → validate button; dbt/Jinja → render button |
| `trapbox`, `tipbox`, `deepbox`, `analogybox`, `dbtbox`, `whybox`, `ideabox`, `summarybox` | 237, 82, 28, 43, 62, 29, 29, 28 | `<Callout kind=...>` (deepbox collapsed) |
| `exambox` | 29 | `<Objectives>` (renders `\objective{ID}` tags as chips linked to the coverage matrix) |
| `labbox{Title}` + `\labtag{...}` | 118 | `<Lab title objectives>`; inner `enumerate` → numbered steps with checkboxes; "Expected result" paragraphs → expected blocks |
| `quizbox` + `questions` + `choices`; `answerbox` + `answers` | 39/31/513 + 34/28 | Question objects (see §4) rendered by the quiz engine |
| `tikzpicture` (+ `scope`) | 64 | SVG: compile each figure standalone (tectonic → PDF → `pdftocairo -svg`), or re-implement key diagrams (DAGs, query order, git graphs) as interactive components |
| `tabularx`, `tabular`, `longtable`, `table`, `center`, `multicols`, `minipage` | 261, 11, 22, 1, 333, 2, 2 | HTML tables (responsive, scroll on mobile); layout wrappers dropped |
| `itemize`, `enumerate`, `description` | 489, 127, 2 | lists |
| `figure` | 3 | figure + caption |

## 3. Inline macros to handle
`\code{..}` (21,874!) → inline code; `\term{EN}{FR}` (348) → term with FR tooltip + glossary link;
`\key{..}` → keyboard key; `\objective{ID}` → chip; `\labtag{IDs}` → lab objectives; `\mockkey{q}{ID}{ans}`,
`\mockreview{..}` → mock answer data; `\cxxviitrap{confusion}{truth}{Chapter N}` (Chapter 27 local macro) →
trap objects; `\capscore` (capstone local macro); `\checkbox`, `\faCheck` and other FontAwesome icons → icons;
`\textbf \emph \textit \texttt \textsf \underline`, sizes (`\small \scriptsize \tiny \footnotesize`) → drop or map;
`\ldots \dots \rightarrow \geq \leq \times`, `\textasciitilde \textbackslash \textunderscore \textgreater`,
escapes `\_ \% \# \& \$ \{ \}`, `-{}-` (= `--` in prose), `\newline \par \medskip \enspace \quad \hspace \rule
\hrulefill \allowbreak \raggedright \sloppy \begingroup/\endgroup \setlength \emergencystretch` → layout, drop.
Chapter-local `\tcbset{c8small/...}` etc. only change font size of some code boxes → ignore.
Code environments may carry options: `[title={...}]`, `[]`, `listing options={...,numbers=left}` (hotspot
line numbers!) — parse them.

## 4. Questions (the most delicate part — 487 chapter questions + 195 mock questions)
- **Chapter quizzes**: `\begin{questions}` items, each starting with a format label written as
  `\item {[Format]}` or `\item \textbf{[Format]}` or `\item \textsf{\textbf{[Format]}}`. Formats:
  `Multiple choice`, `Multiple select — choose N`, `Fill in the blank`, `Matching`, `Hotspot — which line`,
  `Build list — put in order`, `DOMC — judge each option YES/NO independently`. Options in `choices` (A, B, C…).
  Answers are the same-index items of the `answers` list in the following `answerbox`; their text starts with
  the key in varied forms (`\textbf{B.}`, `\textbf{A and C.}`, `A: YES. B: NO.`, `1-c, 2-a`, `b, d, c, a, e`,
  `Line 9`, a word/command). Parse with a robust parser, then **have an agent normalise every key into a
  structured `correct` field**, and a **second independent agent re-solve every question in its web form** to
  catch conversion errors. Store the full explanation text too.
- **Mock exams**: questions in `ch28/30/32-*.tex` (65 each); answers in `ch29/31/33-*-answers.tex`, one per
  `\mockkey{n}{objective}{answer}` followed by the explanation, "why the others are wrong" list and
  `\mockreview{...}`. Distribution per mock is fixed (see `reference/book-briefs/MOCK_BLUEPRINT.md`).
- Hotspot questions: code with line numbers (listing option `numbers=left`) or numbered comments.
- DOMC: options are judged independently; the key is YES/NO per option; implement Caveon-style early ending.
- Quiz → section mapping for inline checkpoints: map each chapter question to the lesson it tests (objective
  + keywords, then agent review).

## 5. Other datasets to generate
| Dataset | Source | Notes |
|---|---|---|
| Traps (145) | `parts/part9/ch27-exam-strategy.tex` `\cxxviitrap{}{}{}` (skip the macro definition and comment lines) | id T1–T145 (numbering = order in the PDF), topic, confusion, truth, chapter refs |
| Glossary (305) | every `\term{EN}{FR}` (logic in `../dbt-bible/tools/make_glossary.py`) | first chapter of appearance |
| Coverage matrix | `../dbt-bible/tools/make_coverage.py` logic | objective → chapters, labs, mock questions |
| Objectives list | Part 0 table / `make_coverage.py` `OBJECTIVES` | 31 official + CP0 prerequisites |
| Cheat sheets | `appendices/cheatsheets.tex` | tables + YAML skeletons |
| Study plan | Part 0 "Your 14-week study plan" table | drives the Today page |
| Practice data | `../dbt-bible/labs/data/*.csv`, `labs/setup.sql`, `labs/updates/*.sql` | copy to `public/data` |
| Reference repo per tag | `git -C ../dbt-bible/labs/practice-project/jaffle_dbt show/ls-tree/diff chNN` | file trees + diffs JSON |
| Capstone per milestone | `../dbt-bible/labs/capstone/shopflow_dbt` tags `m00..m14` | solution viewer (hidden by default) |
| Golden dbt outputs | `reference/builder-logs/*.md`, `reference/capstone-logs/*.md` | for selector/simulator tests and paste-to-verify |
| Manifest per tag | run `dbt parse` at each tag with the verification env (`tools/setup_verification_env.sh`) | DAG + selection playground |

## 6. Paths that must change for the website
The book's labs point to `~/Documents/Adnane/dbt-bible/labs/...` and `/Users/mac/...`. On the website, replace
with the **practice kit download** (or a public git repo) and neutral paths (`~/dbt-course` on macOS/WSL,
`C:\Users\<you>\dbt-course` or `$HOME\dbt-course` on Windows). Do this in the converter with explicit,
tested rules, and keep the book unchanged (it is Adnane's personal edition).

## 7. Acceptance tests for the converter (must pass in CI)
- Per chapter, counts equal `reference/content-inventory.json`: sections, each box type, code blocks per
  language, TikZ figures (as SVGs or components), labs, quiz questions, formats, objective tags, terms.
- 195 mock keys, 145 traps, 305 terms, 31 objectives each with ≥ 1 lesson, ≥ 1 lab, ≥ 3 mock questions.
- No raw LaTeX left in generated content (scan for `\\[a-zA-Z]+` and stray braces).
- Every internal link resolves; every question has exactly one valid key of the right shape for its format.
