# converter — the book (LaTeX) → website JSON

Turns `../dbt-bible` (read only) into the structured content of `site/src/generated/` described in
[`SCHEMA.md`](SCHEMA.md). Nothing in `site/src/generated/` owned by the converter is edited by hand.

## Run

```bash
uv venv --python 3.12 converter/.venv && uv pip install --python converter/.venv/bin/python pyyaml pytest
converter/.venv/bin/python -m converter build     # book -> site/src/generated (idempotent, ~4 s)
converter/.venv/bin/python -m converter check     # acceptance tests on the files on disk (+ PDF checks)
converter/.venv/bin/python -m pytest converter/tests -q
```

`build` rewrites only files whose content changed and removes stale files only in the folders it owns
(`chapters/`, `questions/`, `mocks/` and the top-level files listed in `config.py`); other agents' folders
(`dag/`, `figures/`, ...) are never touched. Running it twice gives byte-identical output (sorted keys, no
timestamps, stable ids). It also writes `converter/overrides/keys-todo.yaml`.

Developer tools (need poppler's `pdftotext`; Playwright only for screenshots):

| Command | What it does |
|---|---|
| `python -m converter.tools.verify_keys_pdf` | re-prints every parsed key in the book's style and matches it with the answer printed in the PDF |
| `python -m converter.tools.pdf_parity [chNN] [--min 8]` | per chapter, the runs of PDF words missing from the JSON (figure labels, running heads, box titles and FR translations are expected noise) |
| `python -m converter.tools.spotcheck 30` | random questions as converted next to the PDF text (result kept in `preview/spotcheck-30.txt`) |
| `python -m converter.tools.preview ch04-s4 ...` | plain HTML of a lesson in `converter/preview/` |

## Architecture

```
tex/source.py      main.tex reading order (\part, \input, \appendix); nested \input spliced in place
tex/parser.py      hand-written parser: TeX space rules (states N/M/S), comments, groups, $math$, \begin/\end,
                   arguments by signature; code listings read verbatim, tikzpicture kept as raw source
tex/macros.py      THE explicit table of every macro and environment (signature + category:
                   render / symbol / math / layout / decl / struct / table / define). Anything else = hard error
tex/definitions.py every \newcommand/\renewcommand/\tcbset/\tikzset/\setlength of the chapters, matched verbatim
render/inline.py   nodes -> Inline[] (ligatures, escapes, \code, \term, \ref resolution, icons, blanks ...)
render/blocks.py   nodes -> Block[] (paragraphs, lists + enumitem labels, code + options, boxes, labs, exambox,
                   figures, figure/table floats); render/tables.py (colspecs, booktabs, \multicolumn, longtable)
build/structure.py pass 1: chapters / sections / subsections, ids, numbers, every \label -> labels.json
build/chapters.py  pass 2: intro, lessons and steps, quiz sections, summary, mock question lists, trap lists
build/questions.py quiz items -> stem / options / matching / hotspot / blanks; answers -> explanations
build/keys.py      answer-key parsers (regular forms only) + SCHEMA validation rules
build/mocks.py     \mockkey / \mockreview segments -> keys, objectives, explanations, whyWrong, review
build/datasets.py  glossary (make_glossary.py logic), objectives + coverage (make_coverage.py logic), plan, cheat sheets
build/output.py    assembles every document, key overrides, keys-todo, path rewrites, book consistency checks
check.py           acceptance tests (they read only the generated files, the inventory and the book via the parser)
rewrite.py         path rewrites (rules/paths.yaml)
```

## Rules worth knowing

- **No silent drops.** Unknown macro, environment, definition, list/code/box option, column type, question format,
  math symbol: hard error with `file:line`. Content that a builder would ignore (text after `\mockreview`, text
  inside an answer box next to the answers list, `\labtag` not on the first line ...) is also an error.
- **Reading order** = `\input` order of `main.tex`; chapter numbers = inventory numbers (appendices 34-36, ids appA-C).
- **Text** follows TeX: spaces after a control word are dropped, `--`/`---` become en/em dashes in prose, quotes
  `` `` ''`` become `"` (SCHEMA), nothing changes inside `\code`, code-box titles or listings. Exception: a CLI flag
  written in prose (`--empty` outside `\code`) keeps two hyphens on the web (the PDF prints "–empty"; each case is
  listed in `report.json` `bookErrors`). Strings from the book's Python tools are plain text (no ligatures).
- **Code listings** keep their text exactly (tabs expanded with tabsize 2 like listings, trailing empty lines
  dropped like listings). `numbers=left` -> `lineNumbers`; a smaller font (`basicstyle` scriptsize, chapter styles
  `c8small` ... `c16fn`) -> `small`; a sql/dbt block directly followed by an output block gets `expected`.
- **Figures**: `chNN-figK`, K = order of `\begin{tikzpicture}` in the chapter (same as tools/inventory.py and
  converter/figures/figsrc.py); `report.json.figures` has file, line, endLine and the sha1 of the exact source
  text. Alt text and descriptions come from `overrides/figures.yaml` (figure agent), checked against that sha1.
- **References**: `Chapter~\ref{..}` becomes one ref node "Chapter 4" (the label word is absorbed); every ref and
  every labels.json href is checked against the generated routes.
- **Reading time** (`minutes`): words/130 + code lines/8 + output lines/20 + 1 per figure, rounded up to 5;
  `labMinutes`: 10 per lab + 2 per numbered lab step.

## Answer keys

`build/keys.py` accepts only the regular forms of the book, for example `\textbf{B.}`, `\textbf{A and C.}`,
`\textbf{b, d, c, a.}`, `\textbf{1-b, 2-c.}`, `\textbf{YES, NO, YES.}` / `A: YES. B: NO.`, `\textbf{Line 9.}`,
fill-in values in bold or `\code`, and the `\mockkey` forms (`B, D`, `A-YES, B-NO`, `A:N B:Y`, `1-c 2-a`, `3 ; 2026-10-19`).
Build lists written as words ("Read, Do, Test, Review.") are matched exactly against the options listed in the stem.
Everything else is **not guessed**: it goes to `overrides/keys-todo.yaml` with the stem, options, explanation and a
hash, and the question gets `keyStatus: "todo"`. To resolve one, write

```yaml
# converter/overrides/keys.yaml
keys:
  q-ch26-16: {hash: <hash from keys-todo.yaml>, key: <structured key>, note: why}
```

The override is applied only while the hash still matches the book text (stem, options, key as written); then the key
is validated like any other (`keyStatus: "override"`). Every parsed key is also compared with the answer printed in
the PDF (`check`, with pdftotext).

## Paths for the web

`rules/paths.yaml` (tested in `tests/test_paths.py`) maps every path of the author's Mac to the layout that the
practice kit's setup installs (header of the file): the book folder `~/Documents/Adnane/dbt-bible` and its `labs/`
folder become the kit folder `~/dbt-course/kit` (`labs/data` -> `kit/data`, `labs/practice-project/bugs` ->
`kit/bugs`, `labs/practice-project/jaffle_dbt` -> `kit/jaffle_dbt.bundle`, `labs/capstone` -> `kit/capstone`,
`labs/capstone/shopflow_dbt` -> `kit/capstone/shopflow_dbt.bundle`, `tools/run_sql.py` -> `kit/tools/run_sql.py`),
relative `labs/...` paths and the words "bible folder" in the prose follow, and `/Users/mac` -> `/Users/you`.
The book text is kept in `textBook` / `titleBook`. `report.json.pathRewrites` lists every occurrence in the book
(`bookOccurrences`, with the text after the rules) and every rewrite applied. `check` fails if an occurrence is
left unmapped (except `unmapped_allowed`: the TikZ source of ch02-fig1, replaced by a site figure), if a rule is
never used, or if any generated text still names the author's folders.
`python -m converter.tools.check_kit_paths` installs both kits (their `setup.sh`) in a temporary HOME and checks
that every home path shown on the site exists there, or is listed in `created_by_labs` with the lab step that
creates it (result: `converter/golden/kit-paths.json`).

## Windows and WSL

- **Variants** (`build/oscmd.py`): every shell block of the chapters gets `variants.win` (PowerShell) and, when it
  differs from macOS, `variants.wsl`, from the machine sections of `overrides/os-commands.yaml` (generated by
  `converter/reference/os_commands.py` from `reference/os_transforms.py`, with the human rule table, the scan of the
  book's commands and the pwsh test result of each rule). `check` recomputes them and fails on a stale variant or on
  a command line without a rule (`report.json.osVariants.unhandled`). Tests: `tests/test_oscmd.py`.
- **OS notes** (`build/osnotes.py`, `overrides/os-notes.yaml`): short callouts with `os: ["win"]` / `["wsl"]` after
  the macOS-specific paragraphs (hash-anchored).
- **Replay** (`python -m converter.tools.win_replay`): installs the kits twice in temporary HOMEs and replays every
  chapter that has Windows variants, end to end: the book's commands under zsh, the Windows variants under pwsh, and
  compares each command (both succeed or both fail). Result per block in `converter/golden/win-replay.json`
  (ok / partly / differs / untested, with the reasons). `--win-only --home $HOME --real-duckdb` is the windows-latest
  CI mode (converter/reference/ci/kit-matrix.yml), compared with the recorded macOS results.

## Overrides

| File | Owner | Purpose |
|---|---|---|
| `overrides/figures.yaml` | figure agent | alt text + description per figure, keyed by id + sha1 |
| `figures/overrides/<id>.tex` | converter | site version of a figure's TikZ source (ch02-fig1: the kit's folders), used while the book figure keeps its `% book-sha1` |
| `overrides/keys.yaml` | reviewers | resolved answer keys (hash-protected); absent = none |
| `overrides/keys-todo.yaml` | generated | keys the converter could not parse with certainty |
| `overrides/os-notes.yaml` | converter | Windows / WSL notes after macOS-specific paragraphs (hash-anchored) |
| `overrides/os-commands.yaml` | generated (`reference/os_commands.py`) | macOS -> PowerShell / WSL rules + machine transforms for `variants` |
| `overrides/question-map.yaml` | reviewers | chapter question -> lesson + objective (487; `check` requires all) -> `Question.objective`, `Lesson.checkpoints`, `coverage.chapterQuestions` |

## Checks (`check`)

Per chapter vs `reference/content-inventory.json`: sections, every box type, code blocks per language, figures, labs
and their objective tags, quiz questions and formats, mock keys, objective tags, terms. Totals (487 / 195 / 145 / 305 /
118 / 64), traps T1-T145, key validation, mock blueprint (formats, topics, objectives), coverage (each objective >= 1
lesson, >= 1 lab, >= 3 mock questions), refs and routes, no `\command` in prose, no TeX ligature artefacts, and an
exact accounting of `{ } $ \` (each one in rendered text must come from an escape in the book). With pdftotext:
keys vs printed answers (hard) and text parity (informational). `build` also cross-checks the book with itself
(glossary vs Appendix C, coverage vs Appendix B, mock score tables and Mock 3's quick answer key vs `\mockkey`) and
reports problems in `report.json.bookConsistency`.
