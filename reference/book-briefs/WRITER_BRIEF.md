# Brief for Part II–VII chapter writers (read fully before writing)

You write chapter(s) of "The dbt Analytics Engineering Bible", a LaTeX book that takes a beginner (Adnane: French-speaking,
reads English well, not native) from zero to passing the dbt Analytics Engineering Certification (dbt Core 1.11) with a
great score. Part 0 and Part I (foundations) are done; your chapter must feel like the same book.

## Read first (in this order)
1. scratchpad/STYLE.md — ALL of it (rules, LaTeX environments, objective IDs, addendum, gotchas, tested observations).
2. scratchpad/PROJECT_SPEC.md — the practice project the student builds.
3. scratchpad/a1/logs/INDEX.md, scratchpad/a1/logs/duckdb_support.md, scratchpad/a1/logs/matrix_tests.md (skim), and the
   logs of YOUR chapters: scratchpad/a1/logs/chNN.md (real commands + outputs to reuse).
4. The reference repo /Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt (README.md, then `git show chNN`,
   `git diff chPREV chNN` for your chapters). Model and file names in the book MUST match it exactly.
5. Style models: parts/part0/ch00-start-here.tex (anatomy section) and one Part I chapter, e.g. parts/part1/ch05-yaml-jinja-python.tex
   (skim to match tone, box usage, quiz format).
6. parts/part9/ch27-exam-strategy.tex (traps T1..T145): make sure your chapter teaches every trap that belongs to your topics
   (you may write "see trap T63 in Chapter 27").
(scratchpad = /private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad)

## What a chapter must contain
- The skeleton from STYLE.md: \chapter + \label (keep the stub's exact title/label), exambox (objective tags), whybox, ideabox (3 sentences),
  sections, labs, traps, dbtbox optional, Check yourself (15–20 exam-style questions, all 7 formats represented, labelled with
  `\item {[Format]}`), answerbox (answer + why each wrong option is wrong), summarybox.
- Start simple (why + analogy), then exact detail at exam level: config keys, defaults, allowed values, flags, edge cases.
  Give the warehouse-agnostic truth the exam expects; when DuckDB differs (see duckdb_support.md), say so clearly.
- Include the dbt platform view (Studio IDE, jobs, environments, Catalog) wherever the exam can ask about it.
- LABS: the student performs this chapter's project changes in ~/dbt-course/jaffle_dbt step by step, so that at the end their project
  matches the reference tag chNN. Each lab: `\labtag{...}` first line, numbered steps with the exact file contents/commands,
  "Expected result" from REAL runs, then "Compare with the reference" using the instructions in the reference repo README.
  Commit at the end of each chapter (git add/commit; push optional).
- Every dbt output you print is real (from the a1 logs or your own re-run). Re-run anything you change. Trim with "..." lines.
  Replace non-ASCII characters in outputs (e.g. the unit-test arrow) with ASCII inside code blocks.
- \term{EN}{FR} for each new key term (first use, body text only).
- Original writing only (no copying dbt Labs docs/courses/sample questions).

## How to verify
- Venv: V=scratchpad/v156/.venv (dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6, pandas). Use `--no-use-colors`.
- Make your own copy: `git clone /Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt <yourscratch>/dbt-course/jaffle_dbt`,
  build `<yourscratch>/dbt-course/practice/practice.duckdb` with `$V/bin/python -I /Users/mac/Documents/Adnane/dbt-bible/tools/build_practice_db.py <path>`,
  put a profiles.yml (see profiles.example.yml in the repo) in a folder and use `--profiles-dir` or DBT_PROFILES_DIR. Never touch ~/.dbt, ~/dbt-course
  or the user's global git config.
- Check doubtful facts on docs.getdbt.com (WebFetch). Never invent flags or keys.

## Finish
- Compile each chapter standalone (scratch test.tex: \documentclass[11pt,openany]{book}\input{/Users/mac/Documents/Adnane/dbt-bible/preamble}
  \begin{document}\setcounter{chapter}{N-1}\input{<file>}\end{document}); zero errors; look at 3–4 rendered pages (pdftoppm + Read).
- Edit ONLY your chapter file(s).
- Final report (concise): file(s), pages, objectives covered, labs and what they verify, facts you could not verify, any mismatch you
  found in the reference repo or other chapters (do not fix other files — report).
