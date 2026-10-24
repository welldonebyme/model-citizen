# Brief for chapter reviewers (Part II–VII)

You are an independent, adversarial technical reviewer of chapter(s) of "The dbt Analytics Engineering Bible", a LaTeX book that
takes a beginner from zero to passing the dbt Analytics Engineering Certification (dbt Core 1.11). A false statement, a wrong quiz key,
a lab that does not work, or an exam fact the book never teaches will cost the student points. Find and fix all of them.

## Read first
- scratchpad/STYLE.md (all of it), scratchpad/WRITER_BRIEF.md (what the writer was asked to do), scratchpad/PROJECT_SPEC.md.
- The builder's logs for your chapters: scratchpad/a1/logs/chNN.md, INDEX.md, duckdb_support.md.
- Reference repo: /Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt (tags ch06..ch25).
(scratchpad = /private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad)

## Your checks (in priority order)
1. **Technical truth.** Every claim about dbt behaviour, configs, defaults, flags, error messages, platform features must be correct for
   dbt Core 1.11. Re-run testable claims in your own scratch copy (venv V=scratchpad/v156/.venv; `--no-use-colors`; build a practice DB with
   tools/build_practice_db.py; never touch ~/.dbt, ~/dbt-course or global git config). Check platform-specific facts on docs.getdbt.com.
   Over-generalisations ("always", "never", "all warehouses") must be qualified.
2. **Labs actually work.** Replay every lab exactly as written, from the previous chapter's tag (`git checkout chPREV` in a clone), on a fresh
   practice DB (apply labs/updates scripts when the chapter says). On a fresh DB, run `dbt build --exclude-resource-type unit_test` before any plain
   build from tag ch19 on (see STYLE.md). Expected results printed in the book must match your run (row counts, PASS/WARN/ERROR counts, outputs).
   At the end, `git diff chNN` (reference tag) must show no meaningful difference. Fix the text where it differs.
3. **Exam alignment.** (a) Find every mock-exam question whose answer key points to your chapter:
   `grep -n "mockreview" /Users/mac/Documents/Adnane/dbt-bible/parts/part9/ch29-mock1-answers.tex ch31-mock2-answers.tex ch33-mock3-answers.tex`
   and keep those whose \mockreview names your chapter label. For each, check that your chapter teaches the fact the question tests; if not, ADD a
   concise explanation (paragraph, table row or trap box) to the chapter. (b) Same for every trap in parts/part9/ch27-exam-strategy.tex that cites
   your chapter number. (c) Every official sub-objective in your chapter's exambox is fully taught.
4. **Quiz.** Re-solve every question before reading the key; fix wrong keys, ambiguous stems, distractors that are also correct. Formats labelled
   as `\item {[Format]}`; all 7 formats present.
5. **Pedagogy & consistency.** Simple why first; terms defined before use; consistent with earlier chapters (names, paths ~/dbt-course/jaffle_dbt,
   commands); cross-references use existing labels; no copied dbt Labs text.
6. **LaTeX.** Compile standalone with the right chapter counter (\setcounter{chapter}{N-1}); zero errors; no overfull boxes > 5pt; look at 3–4 rendered
   pages (pdftoppm + Read).

Edit ONLY your chapter file(s). Final report (concise): edits made (where, before -> after, evidence), labs replayed and results, mock questions /
traps aligned (list of added facts), anything still uncertain, and mismatches in OTHER files (report, do not fix).
