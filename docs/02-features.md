# 02 — Feature spec

Priorities: **P0** = launch blocker, **P1** = core of the "Codecademy" experience (build right after P0),
**P2** = delight and polish (build before final launch if possible — the user wants "great").

## A. Learning flow

### A1. Today page (P0)
- "Today's mission" generated from the **14-week plan** (Part 0, Section "Your 14-week study plan"): which
  lesson steps to read, which lab, which quiz, which spaced reviews are due (day 3 / 7 / 21 rule from Part 0).
- Big **Continue** button (resume exactly where you left off: page + step + scroll).
- Streak, today's time studied, readiness gauge, next mock suggestion, countdown to the exam date (if set).
- Rhythm switch: Standard 14 weeks / Intensive 8 / Relaxed ~25 (from Part 0) — re-plans the calendar.

### A2. Learning path map (P0)
- Visual journey: Parts 0–IX → chapters → lessons (one lesson per book section). Duolingo-like path with
  progress rings, estimated minutes per lesson, lab and quiz markers, capstone and mock milestones.
- Nothing is hard-locked (adults learn in any order), but the recommended next step is always obvious.

### A3. Lesson player (P0)
- Each book **section** becomes a lesson, shown as a sequence of **steps** (cards): the why, the idea, then
  content blocks; long sections split at subsections.
- Book boxes become styled components: Why this matters, The idea in 3 sentences, Analogy, Exam trap, Tip,
  Going deeper (collapsed by default), Where you will meet this in dbt, Exam objectives, Summary.
- Code blocks with copy button, file-title header, terminal style for `bashcode`, result style for `outputcode`.
- **OS switch** (macOS / Windows PowerShell / WSL) remembered per user, swapping command blocks where variants
  exist (see `06-labs.md`).
- `\term` words show the French translation on hover/tap and link to the glossary.
- "I understood this" per step; inline **checkpoint questions** (questions from the chapter quiz mapped to
  the section they test; the full quiz stays at the end of the chapter).
- Layout: Codecademy-style split view on lab steps (lesson left, interactive workspace right); single column
  for reading; mobile stacks panes.

### A4. Chapter quiz (P0)
- The chapter's "Check yourself" (487 questions in total) in the **real exam formats** (see C1), with instant
  feedback, the book's explanation, "why each wrong option is wrong", and a link back to the lesson step.
- Wrong answers go to the **error notebook** and the **spaced-repetition** queue automatically.

## B. Labs (the "do" part — see `06-labs.md` for the technical plan)

### B1. SQL playground (P1) — in the browser, real DuckDB (DuckDB-WASM)
- Practice database preloaded (jaffle_shop + stripe). Every SQL example of the book is a runnable,
  editable cell with the book's result shown as "Expected" and a **result checker** (compares result sets).
- Chapter 4 becomes fully hands-on; SQL challenges with auto-grading; "reset data" and "apply day 2" buttons
  (runs `labs/updates/day2.sql` in the browser).

### B2. YAML playground (P1)
- Editor with live validation; shows dbt/PyYAML-style error messages with line/column (Chapter 5 & 22 errors).
- Exercises: fix the broken file (hotspot-style), quote the Jinja, indentation traps.

### B3. Jinja playground (P1)
- Render templates live (jinja2 in Pyodide) with a dbt-like context: `ref`, `source`, `config`, `var`, `target`,
  `this`, `is_incremental` stubs → shows the compiled SQL, then **runs** it in DuckDB-WASM.
- Exercises from Chapters 5 and 11 (pivot loop, trailing comma, whitespace control, macros).

### B4. Node-selection & lineage playground (P1)
- The real DAG of the reference project at each chapter tag (from `manifest.json`), interactive graph.
- Type `--select` / `--exclude` expressions (`+fct_orders`, `1+x`, `@x`, `tag:a,tag:b`, `path:`, `resource_type:`…)
  → nodes light up + the list `dbt ls` would print. Golden-tested against real `dbt ls` outputs.
- Challenges: "select only the first-degree parents of fct_orders", "build everything an exposure needs".

### B5. Real-machine lab runner (P0)
- For labs that must run on the learner's computer (install, git, dbt CLI): step checklist, OS-specific
  commands, copy buttons, expected output (collapsible), troubleshooting accordions, "mark done".
- **Paste-to-verify**: the learner pastes their terminal output; the site parses it (dbt summary line
  `PASS=.. WARN=.. ERROR=..`, row counts, `dbt ls` lists, versions) and tells them if it matches. Codecademy-like
  checks with no backend.
- **Practice kit download** (zip): data, setup.sql, updates, bug patches, and links to the reference repos.

### B6. Compare-with-reference viewer (P1)
- Browse the reference project at any chapter tag; side-by-side **diff** between consecutive tags
  (what this chapter changed); same for the capstone milestones (solutions hidden until the learner chooses).

### B7. dbt in the browser (P1 stretch — spike first)
- Goal: run real `dbt run / build / test / ls / compile / show` in a browser terminal on a virtual copy of the
  project (Pyodide + dbt-core + dbt-duckdb). If the spike fails, build a clearly labelled **dbt simulator**
  driven by the golden outputs and a small engine (see `06-labs.md`). Either way, labs that need a real
  install still exist (B5): the exam rewards real experience.

## C. Exam training

### C1. Question engine (P0) — all 7 formats
- Multiple choice, multiple select (choose N), fill in the blank (normalised compare + accepted variants),
  matching (drag lines or dropdowns, keyboard accessible), hotspot (click the line in a code block),
  build list (drag to order, keyboard accessible), **DOMC** (one option at a time, YES/NO, no going back, early
  end like Caveon's DOMC, optional "extra option after decided" to mimic the real exam).
- Each question carries: id, format, objective, difficulty, source (chapter/mock), stem, options, key,
  explanation, why-wrong, review link.

### C2. Mock exam simulator (P0)
- Mocks 1–3 (65 questions each). **Exam mode**: 120:00 timer, one question per screen, flag for review,
  navigator grid, no feedback until the end, autosave/resume, DOMC rules enforced. **Practice mode**: feedback
  per question.
- Results: score %, pass line 65%, the book's 80% target, per-topic and per-objective breakdown, time per
  question, "weakest objectives → go to these lessons/labs" (uses the coverage matrix), full review with
  explanations. History chart of all attempts.

### C3. Drills (P1)
- Custom quizzes from all 682 questions by topic / objective / format / difficulty / "my mistakes" /
  "never seen". "DOMC training" mode. "Speed round" (1:50 per question pacing from Part 0).

### C4. Traps library (P0) and flashcards (P2)
- 145 traps (Chapter 27) filterable by topic; flashcard mode (confusion → reveal the truth).
- Spaced repetition (SM-2 or Leitner) over traps, glossary terms, cheat-sheet facts and missed questions.

## D. Reference

- **Search** (P0) across lessons, glossary, traps, cheat sheets (Pagefind or similar static index).
- **Glossary EN↔FR** (P0) with chapter links. **Cheat sheets** (P0) as clean, printable pages.
- **Coverage matrix** (P0) as an interactive table: objective → lessons, labs, mock questions + your mastery.
- **Download the PDF** (P0): full book (and per-part PDFs if cheap to produce).

## E. Progress, motivation, sharing

- **Dashboard** (P0): mastery heatmap of the 31 objectives + prerequisites, chapters/labs/quizzes done,
  study time, mock history, readiness gauge with the "two mocks ≥ 80%" gate.
- **Progress file** export/import (P0); optional "copy my progress link" (encoded summary) (P2).
- **Gamification** (P2): XP, levels, streaks, badges (first model built, DOMC master, 7-day streak,
  mock ≥ 80%, capstone done…), tasteful celebrations.
- **Study tools** (P2): Pomodoro timer tied to the daily plan; error notebook (auto + personal notes);
  "explain it back" notes per chapter (Feynman, from Part 0).
- **Capstone hub** (P1): 15 milestones as a project board; requirements checklist; progressive hints;
  checkpoint verifiers (paste outputs); solution viewer per milestone tag.
- **Exam-day** (P2): last-7-days plan, check-in checklist (Talview, ID, room, browser), countdown.
- **Friend challenge** (P2): share a seeded quiz link (same questions for both), results stay local.

## F. Quality-of-life

- Dark/light themes, adjustable font size, keyboard shortcuts, focus mode, print styles.
- Works offline after first visit (P2, service worker), no account needed, privacy-first (no trackers).
- Clear "unofficial" disclaimer and credits.
