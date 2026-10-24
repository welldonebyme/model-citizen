# Writer's guide — The dbt Analytics Engineering Bible

Book root: /Users/mac/Documents/Adnane/dbt-bible  (LaTeX, compiled with `tectonic main.tex`)
Styles:   preamble.tex (DO NOT EDIT preamble.tex or main.tex — report needed changes instead)
Python:   /private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/.venv/bin/python  (3.12, duckdb 2.0, pyyaml, dbt-core 1.11.16, dbt-duckdb 1.11, jinja2)
SQL check: `$PY -I tools/run_sql.py "select ..."` (run from book root) → ASCII table to paste into `outputcode`.
Practice DB: labs/practice.duckdb (built by labs/setup.sql from labs/data/*.csv). NEVER modify labs/data or setup.sql. For DDL/DML experiments copy the db to your own scratch folder first and use `--db`.

## Reader
Adnane: starting from zero, French-speaking, reads English well but is not native. Goal: pass the dbt Analytics
Engineering Certification (dbt Core 1.11) with a great score.
- Short sentences, short paragraphs, simple words. No idioms. Define every new word the first time.
- Explain WHY before HOW. Use concrete analogies (kitchen, library, post office, recipe...).
- Step by step: show the command/code, then the real output, then explain the output line by line when useful.
- Original writing only. Do NOT copy text or questions from dbt Labs courses, docs or the official sample
  questions. Paraphrase facts in your own words. Short facts (flag names, config keys) are fine.

## Chapter skeleton (mandatory order)
```
\chapter{Title}\label{ch:<slug>}
\begin{exambox} itemize of what this chapter prepares, each item starting with \objective{ID} \end{exambox}
\begin{whybox} the story: why this matters for an analytics engineer and for the exam \end{whybox}
\begin{ideabox} exactly 3 sentences \end{ideabox}
\section{...} ... (explanations, code, outputs, figures)
   - labbox after major sections (numbered steps + "Expected result")
   - trapbox for every exam-relevant pitfall
   - dbtbox: "where you will meet this in dbt" (Part I chapters: at least 3 per chapter)
   - tipbox / deepbox / analogybox as needed
\section{Check yourself}  -> quizbox (questions) then answerbox (answers + WHY each wrong option is wrong)
\begin{summarybox} 6-10 bullet points \end{summarybox}
```

## Quiz style (exam-like)
Mix the real exam formats, label the format in brackets at the start of each question:
[Multiple choice], [Multiple select — choose 2], [Fill in the blank], [Matching], [Build list — put in order],
[Hotspot — which line], [DOMC — judge each option YES/NO independently].
Answers: give the correct answer AND one line on why each distractor is wrong.

## Exam objective IDs (use in \objective{...})
CP0-SQL (SQL prerequisites: joins, aggregations, CTEs, window functions)  CP0-GIT (branching, basic commands, PRs)
CP0-CLI, CP0-YAML, CP0-JINJA, CP0-PY, CP0-DATA (foundations used everywhere)
1.1 raw object dependencies | 1.2 core materializations | 1.3 modularity & DRY | 1.4 commands build/run/test/docs/show/snapshot/seed
1.5 logical flow & clean DAGs | 1.6 dbt_project.yml configs | 1.7 packages | 1.8 Python models | 1.9 grants
1.10 snapshots in YAML | 1.11 choosing incremental strategy | 1.12 --empty dry runs | 1.13 --sample | 1.14 microbatch
2.1 contracts | 2.2 versions & deprecation | 2.3 constraints in YAML
3.1 logged errors | 3.2 compiled code | 3.3 .yml compilation errors | 3.4 fix & test before merge | 3.5 flags
4.1 failure points in the DAG | 4.2 dbt clone
5.1 generic/singular/custom/custom generic/unit tests | 5.2 testing assumptions | 5.3 testing steps in workflow
6.1 exposures | 6.2 source freshness
7.1 state & state selection | 7.2 dbt retry

## LaTeX rules
- Environments available: whybox, ideabox, labbox{Title}, trapbox, tipbox, deepbox, analogybox, dbtbox, exambox,
  quizbox, answerbox, summarybox; lists: questions / choices / answers (enumerate-like, see preamble).
- Code: sqlcode, dbtcode (SQL+Jinja), yamlcode, jinjacode, pycode, bashcode (terminal, start lines with `$ `),
  outputcode (results), plaincode. Optional title: `\begin{sqlcode}[title={queries/q1.sql}]`.
  Inside code environments content is verbatim: NO escaping, but ASCII ONLY (no accents, no unicode arrows/quotes/emoji).
  Never put a code environment inside a macro argument; inside boxes (whybox, labbox...) is fine.
- Inline code: \code{stg\_orders} (escape _ % # & $ { } ~ ^ \ in normal text: \_ \% \# \& \$ \{ \} \textasciitilde{}).
- Key terms (first important use only, body text only, never in headings/captions): \term{data warehouse}{entrepôt de données}
  (UTF-8 French with accents is fine in normal text). These feed the EN/FR glossary automatically.
- Keys: \key{Ctrl+C}. Tables: tabularx + booktabs, column type L = ragged X. Figures: TikZ (libraries in preamble).
- Labels: \label{ch:slug}, \label{sec:slug-topic}; refer with Chapter~\ref{...} / Section~\ref{...}.
  Future chapters do not exist yet: refer to them as "Chapter 14 (Incremental models)" in plain text.
- Use UTF-8 typographic text normally (é, —, ’ are fine in prose).

## Book map (for cross-references)
Part 0 Start Here: Ch0. Part I Foundations: Ch1 Data world, Ch2 Command line, Ch3 Git & GitHub, Ch4 SQL, Ch5 YAML/Jinja/Python.
Part II Building with dbt: Ch6 Install & first project, Ch7 Models/ref/source/DAG, Ch8 Materializations, Ch9 Modularity & refactoring,
Ch10 Configuration, Ch11 Jinja/macros/packages, Ch12 Seeds & analyses, Ch13 Snapshots, Ch14 Incremental models, Ch15 Python models,
Ch16 Commands & node selection. Part III Ch17 Governance. Part IV Ch18 Data tests, Ch19 Unit tests. Part V Ch20 Docs, Ch21 Freshness & exposures.
Part VI Ch22 Debugging, Ch23 Pipelines & clone. Part VII Ch24 State/defer/retry, Ch25 Environments/jobs/CI. Part VIII Capstone. Part IX Exam mastery.

## Student workspace conventions (use these exact paths in instructions)
- Bible folder: ~/Documents/Adnane/dbt-bible (contains labs/data/*.csv and labs/setup.sql)
- Student workspace: ~/dbt-course  (created in Ch2)
  - ~/dbt-course/.venv  -> Python 3.12 venv made with `uv venv --python 3.12` (dbt-core~=1.11.0, dbt-duckdb~=1.11.0 installed in Ch2)
  - ~/dbt-course/practice/ -> copy of labs/data + setup.sql; practice.duckdb built with `duckdb practice.duckdb < setup.sql`
  - DuckDB CLI installed with `brew install duckdb`; open with `duckdb practice.duckdb`
  - The venv's Python duckdb library is PINNED to the CLI version (`uv pip install "duckdb==<cli version>"`, Ch2 sec:cli-duckdb-version),
    so files created by dbt can be opened by the CLI. Book outputs were produced with duckdb 2.0; avoid version-specific error text.
  - ~/dbt-course/practice becomes a git repo in Ch3 (pushed to the student's GitHub as `dbt-course-practice`)
- Machine: macOS, zsh, Homebrew available. Add short Windows notes (WSL) only where it really differs.

## Practice data (schemas jaffle_shop and stripe — mirrors the shape used in the official dbt Fundamentals course)
jaffle_shop.customers(id, first_name, last_name, email, country, signup_date)      100 rows; 5 NULL emails; 9 upper-case emails;
                                                                                   customers 96-100 never ordered (11 customers total have no orders)
jaffle_shop.orders(id, user_id, order_date, status, _loaded_at)                    300 rows, ids grow with date (2025-01-05..2025-12-31);
                                                                                   statuses completed/shipped/returned/return_pending/placed;
                                                                                   order 159 has user_id 101 (orphan: no such customer)
jaffle_shop.order_items(id, order_id, product_id, quantity)                        606 rows
jaffle_shop.products(id, name, category, price_cents)                              12 rows; categories coffee/tea/food/merch
stripe.payments(id, orderid, paymentmethod, status, amount, created, _loaded_at)   341 rows; amount in CENTS; status success/fail;
                                                                                   'placed' orders have no payment; some orders split coupon+card
Note: in DuckDB `/` on integers returns a decimal (double); `//` is integer division. Mention that other warehouses differ.

## dbt facts to respect (dbt Core 1.11)
- Product names: "dbt platform" (formerly dbt Cloud), "dbt Studio" (the in-browser IDE, formerly Cloud IDE), dbt Core (open source CLI),
  Fusion engine (new engine, out of exam scope). The exam still sometimes says "dbt Cloud IDE".
- Tests are configured under `data_tests:` (since 1.8; `tests:` still accepted). Unit tests under `unit_tests:`.
- Snapshots can be defined in YAML (1.9+). Microbatch incremental strategy (1.9+). `--empty` (1.8+), `--sample` (1.10+).
- If unsure about a dbt fact, check docs.getdbt.com (WebFetch) rather than guess.

## Verification (mandatory before you finish)
1. Every SQL result shown comes from actually running it (tools/run_sql.py). Every git/shell output comes from actually
   running it in a temp folder under the scratchpad (git outputs: use realistic names, e.g. user "Adnane").
2. Compile: create <scratch>/<your-slug>/test.tex:
   \documentclass[11pt,openany]{book}\input{/Users/mac/Documents/Adnane/dbt-bible/preamble}\begin{document}\input{<your file>}\end{document}
   then `tectonic test.tex` (run inside that folder). Fix ALL errors. Then render 2-3 pages with
   `pdftoppm -r 60 -png -f N -l N test.pdf out` and look at them (Read the PNG) to check layout (overfull code lines, boxes, figures).
3. Only write your own assigned file(s). Final report: file path(s), page count, list of \term entries, anything you could not verify.

# ======================= PART II-IX ADDENDUM (read this too) =======================

## Environments (UPDATED)
- dbt work: use the venv /private/tmp/claude-501/-Users-mac-Documents-Adnane/01c25d17-e9ca-4e1a-939f-b5b3904f7a5e/scratchpad/v156/.venv
  (dbt-core 1.11.16, dbt-duckdb 1.11.0, duckdb 1.5.6, pandas). This mirrors the student's machine (DuckDB CLI 1.5.6 from Homebrew,
  Python library pinned to the same version). Use `$V/bin/dbt`, `$V/bin/python`. Always pass `--no-use-colors` (or DBT_USE_COLORS=false)
  so outputs have no ANSI codes.
- SQL checks: `$V/bin/python -I tools/run_sql.py "..."` (labs/practice.duckdb is now DuckDB 1.5.6 format, opened read-only).
- Build a fresh practice DB anywhere: `$V/bin/python -I tools/build_practice_db.py <dest.duckdb>`; apply update scripts with
  `--sql labs/updates/day2.sql` etc.
- NEVER touch ~/dbt-course, ~/.dbt or the user's global git config. Work only in your own scratch subfolder.

## Reference practice project
- Spec: scratchpad/PROJECT_SPEC.md. Reference implementation (after it is built): /Users/mac/Documents/Adnane/dbt-bible/labs/practice-project/jaffle_dbt
  (git repo, one tag per chapter: ch06 ... ch25) and captured command logs in scratchpad/a1/logs/chNN.md.
- Chapter writers: copy the repo into your scratch folder, `git checkout chNN`, recreate the dbt-course layout
  (<scratch>/dbt-course/practice/practice.duckdb built with build_practice_db.py + <scratch>/dbt-course/jaffle_dbt) and re-run what you show.
  Every dbt output printed in the book must come from a real run (yours or the builder's log). You may trim long outputs with "..." lines.
- Model/file names in the book MUST match the reference repo exactly.

## Extra macros (in preamble)
- \labtag{1.11, 1.14}  -> FIRST line inside every labbox: the objective IDs that lab trains (use CP0-... or exam IDs).
- \mockkey{12}{1.11}{B} and \mockreview{Chapter 14, Section~\ref{...}} -> mock answer keys only.
- Code blocks: if a code environment has no options and its first line starts with `{` (Jinja), write `\begin{dbtcode}[]` — otherwise LaTeX fails.
- TikZ: never name a style `step` (built-in key). Prefix your own styles with your chapter number (e.g. `c14box`) to avoid clashes.

## Chapter files (already exist as stubs — replace the whole stub; keep the \chapter title and \label exactly as in the stub)
part2: ch06-first-project (ch:first-project), ch07-models-sources-dag (ch:models-sources-dag), ch08-materializations (ch:materializations),
ch09-modularity-refactoring (ch:modularity-refactoring), ch10-configuration (ch:configuration), ch11-jinja-macros-packages (ch:jinja-macros-packages),
ch12-seeds-analyses (ch:seeds-analyses), ch13-snapshots (ch:snapshots), ch14-incremental-microbatch (ch:incremental-microbatch),
ch15-python-models (ch:python-models), ch16-commands-selection (ch:commands-selection)
part3: ch17-governance (ch:governance) | part4: ch18-data-tests (ch:data-tests), ch19-unit-tests (ch:unit-tests)
part5: ch20-documentation (ch:documentation), ch21-freshness-exposures (ch:freshness-exposures)
part6: ch22-debugging (ch:debugging), ch23-pipelines-clone (ch:pipelines-clone)
part7: ch24-state-defer-retry (ch:state-defer-retry), ch25-environments-ci (ch:environments-ci)
part8: ch26-capstone (ch:capstone) | part9: ch27-exam-strategy (ch:exam-strategy), ch28-mock1 .. ch33-mock3-answers
appendices: cheatsheets (app:cheatsheets), coverage (app:coverage), glossary (app:glossary)
Part I labels: ch:start, ch:data-world, ch:cli, ch:git, ch:sql, ch:yaml-jinja-python. Cross-ref with Chapter~\ref{ch:...}.
To compile your chapter standalone, set the chapter counter so numbers match the book: \setcounter{chapter}{N-1} before \input.

## Depth for Part II-VII chapters
- Exam-level precision: exact config keys, defaults, allowed values, command flags, what happens on edge cases.
  Every claim about dbt behaviour must be verified (run it, or docs.getdbt.com via WebFetch). If DuckDB behaves differently from
  warehouses like Snowflake/BigQuery/Databricks, say so explicitly and explain what the exam expects (warehouse-agnostic dbt behaviour).
- Include the platform view where relevant (dbt platform / Studio IDE / jobs) — the exam is not CLI-only.
- Quiz: 15-20 exam-style questions per chapter (all formats represented), answers with why-wrong explanations.
- Typical length 22-35 pages per chapter. At least 2 labs (with \labtag and verified expected results), several trapbox, a summarybox.

## LaTeX gotcha (added)
- NEVER write `\item [Multiple choice] ...` — `\item [x]` replaces the question number. Write `\item {[Multiple choice]} ...`
  or `\item \textsf{\textbf{[Multiple choice]}} ...`.
- Long inline \code{...} can overflow the margin: prefer short inline code, or wrap a long passage in {\raggedright ... \par}.

## Tested dbt 1.11 observations from other writers (re-verify before relying on them in your chapter)
- Generic test arguments outside `arguments:` -> MissingArgumentsPropertyInGenericTestDeprecation warning.
- accepted_values returns one row per DISTINCT wrong value, so warn_if/error_if thresholds count distinct values, not bad rows.
- tags / schema / alias / database / meta changes were not detected by state:modified config comparison in a test; a description-only
  change is not state:modified unless persist_docs is on. (Verify in your own run before teaching.)
- A failed TEST has status `fail`, so `result:error+` selects nothing after a build where only a test failed; `dbt retry` re-runs it.
- Breaking contract change on an unversioned model -> WARNING; on a versioned model -> ERROR.
- A model that refs itself with ref() is not reported as a cycle in 1.11. DuckDB accepts a trailing comma in SELECT lists.
- DuckDB SQL errors appear as "Runtime Error ... Binder Error" (other warehouses: "Database Error"). Say so when showing them.
- (Mock 3 writer, tested) tags and group are excluded from state comparison; alias/schema/database count only for state:modified.relation;
  meta and materialized count for state:modified.configs.
- Unit test on a model using is_incremental(): `overrides: macros: is_incremental: true|false` is REQUIRED (else Parsing Error);
  with true, an `input: this` is also required.
- `dbt compile` between a failed build and `dbt retry` makes retry print "Nothing to do"; `dbt show` / `dbt docs generate` in between make retry CRASH in 1.11.16; dbt ls is harmless. Retry reuses --target/--defer/--state; only --threads/--vars can be overridden; --warn-error is not kept.
- --empty: run, build, compile, snapshot (not seed). --sample: run and build only; units hour/day/month/year (not week); a view built
  with --sample keeps the sample filter in its definition. --event-time-start requires --event-time-end. Microbatch default lookback = 1.
  Unit tests still run under `dbt build --empty`.
- on-run-start hook failure does not stop models by default (flag skip_nodes_if_on_run_start_fails defaults to false).
- Freshness: a table-level block overrides only the keys it sets (others inherited from the source level).
- (Strategy writer, tested) After `dbt run --empty`, an incremental model whose filter is `loaded_at > (select max(loaded_at) from {{ this }})`
  inserts 0 rows on the next normal run (max over an empty table is NULL). Teach the trap and the fix (coalesce to a very old date, or full refresh).
- On a brand-new schema, the first `dbt build` fails on a unit test that uses `input: this` for an incremental model (table does not exist yet).
- Contracts on ephemeral models are silently ignored in 1.11.16 (docs: not supported) — say "not supported", do not claim an error.
- Chapter 27 (exam strategy) numbers traps T1..T145; cheat sheets appendix = app:cheatsheets. Chapters may point to them.
- (Builder, final) From tag ch19 on, on a brand-new database a plain `dbt build` FAILS EVERY TIME (fct_orders unit test mocking `this`
  errors -> fct_orders skipped, never created). Always run `dbt build --exclude-resource-type unit_test` once first on a fresh DB, then
  `dbt build` passes (PASS=66, WARN=1 = relationships on order 159, by design). Taught in Ch19; later chapters must follow this order.
- concurrent_batches=False on fct_order_items_daily is in the repo from tag ch20 (persist_docs + parallel microbatch = write-write conflict).
- Reference tags ch20..ch25 were re-tagged after the move; commit hashes in logs ch14..ch25 are stale: always use TAG names.
