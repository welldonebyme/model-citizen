# 12 — Status (2026-10-24, end of the build and of the review fixes)

Nothing is published and no remote exists: the site, the kits and the git history are only on this Mac.
Quality-gate results are in `13-qa-report.md`; decisions in `10-decisions.md`; book corrections in
`11-book-errata.md` (originals saved in `reference/book-snapshot-2026-10-24/`).

## What the site has
- **Today**: first-visit setup, the book's plan (3 rhythms), today's mission, the four booking conditions,
  streak, exam countdown, mastery per objective, XP and badges, the course map.
- **Path, chapters, lessons** (311 lessons): steps with "I understood this", OS switch (macOS / Windows / WSL:
  every shell block has its Windows form, plus Windows notes wherever a lesson shows macOS-only output), 117 labs
  with ticks (every lab can be finished), a "Get the course files" box before lab 1.6, checkpoints from the
  question bank, French glossary tooltips, figures sized to be readable (and an Enlarge view), focus mode,
  explain it back.
- **Workspaces in lessons**: real dbt-core 1.11.16 in the browser on 134 lessons (Chapters 6-25 and the
  capstone milestones), DuckDB SQL on the 15 SQL lessons; "Run in workspace" / "Try in the browser terminal"
  buttons; paste-to-verify on terminal outputs and capstone checkpoints.
- **Labs**: dbt terminal, SQL, YAML and Jinja playgrounds, node selection and lineage (20 challenges),
  reference viewer (every chapter tag, capstone solutions behind a spoiler guard), capstone hub (15 milestones,
  requirement checklists, hints one at a time), practice and capstone kits (macOS, Windows, WSL).
- **Exams**: 27 chapter quizzes, 3 timed mocks (65 questions, 120 minutes, 7 formats, real DOMC rules),
  results with topic and time charts, drills, exam-day page.
- **Practice**: flashcards (Leitner), error notebook, top traps, drills, friend challenge.
- **Progress**: dashboard (readiness, totals, heatmap per objective, study time, mock history, chapters).
- **Reference**: glossary (305 terms), cheat sheets, coverage matrix, search (Pagefind).
- **Settings**: plan and dates, OS, theme, text size, progress file export/import, offline copy (opt-in).

## Needs Adnane's explicit OK (not done on purpose)
1. **Publishing** the site (GitHub Pages) and creating any repository, public or private.
2. **A repository for the Windows CI job** (`converter/reference/ci/kit-matrix.yml`): the only way to run the
   kits and the PowerShell replay on a real `windows-latest` machine before the friend does.
3. **Shipping the book PDF** with the site: it has Adnane's name and local paths. Build with
   `MC_INCLUDE_PDF=1` to include it; without it the Reference page simply does not offer the PDF.

## Not verified here (no device)
Windows PowerShell 5.1 itself, Edge on Windows, iOS Safari, phones beyond emulation, and whether GitHub Pages
serves `.wasm` compressed (affects the first start of the dbt and SQL labs, not correctness).

## Reviews
Four independent reviews (design, a Windows beginner on weeks 1 and 4, exam realism, functional) found 87
confirmed issues; 81 are fixed, 5 partly, 1 left (the book's week-1 time estimates). Details in
`13-qa-report.md` section 6.

## How to work on it
- Build: `npm --prefix site run build` (with search) or `build:fast` (no search index). Preview:
  `npm --prefix site run preview` (port 4322).
- Converter: `converter/.venv/bin/python -m converter build` then `check`.
- Tests: `npm --prefix site test`, `npm --prefix site run e2e`, `npm --prefix site run test:selector`,
  `npm --prefix site run e2e:labs`, `npm --prefix site run e2e:dbt`, `npm --prefix site run qa:links`.
- Several agents building at once: each builds into its own `--outDir` and port, then runs
  `node scripts/offline-manifest.mjs <outDir>` (and pagefind for search), never into `site/dist`.
- Kits: `converter/reference/run_all.sh`; the dbt presets come from the local `dbt-bible` repositories
  (`npm --prefix site run dbt:presets`), so they cannot be rebuilt in CI.
