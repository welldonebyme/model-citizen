# 09 — Work plan

Big project: run it like the book — parallel workstreams, each with a writer/builder and an independent
reviewer, machine checks at every step, and a final integration QA. Keep a task list visible to the user.

## Phase 0 — Kickoff (with the user)
1. Ask the 4 questions of HANDOFF §4 (name, hosting OK, visual direction, exam date).
2. Build **2–3 visual mockups** (home/today, lesson + lab workspace, exam screen) with the `frontend-design`
   skill; let the user pick.
3. **Tech spikes** (parallel): Astro + React island + DuckDB-WASM loading the practice CSVs; Pyodide worker with
   jinja2 + pyyaml; **dbt in Pyodide** (time-boxed, see `06-labs.md`). Decide simulator vs real dbt.
4. Create `site/` (Astro), CI (lint, unit, converter acceptance, Playwright), `.claude/launch.json` for preview.

## Phase 1 — Content pipeline
- Converter: chapters/lessons/boxes/code/tables/figures (TikZ → SVG), questions (+ agent normalisation of keys
  + independent re-solve), mocks, traps, glossary, coverage, cheat sheets, study plan, practice data, reference
  repo exports (trees + diffs per tag), manifests per tag, kits (zips + git bundles), path rewrites for the web.
- Gate: content parity tests green (`07-quality.md` §1–2).

## Phase 2 — Site core
- Design system (tokens, light/dark, components for every box), layouts, navigation, path map, lesson player,
  OS switch, FR term tooltips, search, glossary, cheat sheets, traps library, coverage matrix, PDF download,
  progress store (Dexie) with export/import, Today page + 14-week planner, dashboard.

## Phase 3 — Exam engine
- Question components for the 7 formats (keyboard accessible), chapter quizzes with feedback, error notebook,
  mock simulator (exam/practice modes, timer, flags, navigator, DOMC rules, autosave), results analytics,
  attempt history, drills, readiness gate.

## Phase 4 — Labs
- SQL playground (DuckDB-WASM) + parity test; YAML and Jinja playgrounds (Pyodide); selection engine + DAG
  explorer (golden-tested); real-machine lab runner with Windows variants + paste-to-verify; reference/capstone
  viewers; capstone hub; dbt-in-browser or simulator (per spike decision).
- Windows CI job proving the kit works on `windows-latest`.

## Phase 5 — Delight
- Flashcards + spaced repetition, gamification (XP, streaks, badges, celebrations), Pomodoro, explain-it-back
  notes, exam-day page + countdown, friend challenge links, offline support.

## Phase 6 — QA and reviews
- All gates in `07-quality.md`; independent design, pedagogy (Windows beginner persona) and exam-realism
  reviews; fix everything; final screenshots for the user.

## Phase 7 — Launch (only with the user's explicit OK)
- Create the public repo, enable GitHub Pages (or the chosen host), publish, share the URL.
- Short "How to use this site" note for the friend (Windows): what to open first, how progress is saved,
  how to export it, where the practice kit is.

## Suggested parallel workstreams (agents)
Converter (lessons) · Converter (questions + re-solve) · Design system & layouts · Quiz/exam engine ·
SQL/YAML/Jinja playgrounds · Selection engine + DAG · Lab runner + Windows variants + kits · dbt spike/simulator ·
Progress/Today/dashboard · Delight features · QA automation · Reviewers (one per stream).
