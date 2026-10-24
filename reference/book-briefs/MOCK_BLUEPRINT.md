# Mock exam blueprint (3 mocks x 65 questions)

Goal: three full-length, ORIGINAL practice exams for the dbt Analytics Engineering Certification (dbt Core 1.11, 2026 outline),
at least as hard as the real exam. Never copy or lightly rephrase the official sample questions or dbt Labs course content.

## Files (stubs exist; replace them completely; keep \chapter title + \label)
- Mock N questions: parts/part9/ch28-mock1.tex / ch30-mock2.tex / ch32-mock3.tex
- Mock N answers:   parts/part9/ch29-mock1-answers.tex / ch31-mock2-answers.tex / ch33-mock3-answers.tex

## Per-mock distribution (exactly 65; objective IDs from STYLE.md)
Topic 1 (26): 1.1 x2, 1.2 x2, 1.3 x2, 1.4 x3, 1.5 x2, 1.6 x2, 1.7 x2, 1.8 x1, 1.9 x1, 1.10 x2, 1.11 x2, 1.12 x2, 1.13 x1, 1.14 x2
Topic 2 (7):  2.1 x3, 2.2 x2 (one of them may be on model access/groups), 2.3 x2
Topic 3 (8):  3.1 x2, 3.2 x2, 3.3 x2, 3.4 x1 (git/PR workflow welcome here), 3.5 x1
Topic 4 (5):  4.1 x3, 4.2 x2
Topic 5 (9):  5.1 x4 (at least 1 unit test), 5.2 x3, 5.3 x2
Topic 6 (4):  6.1 x2, 6.2 x2
Topic 7 (6):  7.1 x4, 7.2 x2
Shuffle topics (like the real exam); do not group by topic.

## Formats per mock (exactly 65)
[Multiple choice] 30 | [Multiple select — choose N] 6 | [Fill in the blank] 6 | [Matching] 5 | [Hotspot — which line] 5 |
[Build list — put in order] 5 | [DOMC — judge each option YES/NO] 8
Print the format label at the start of every question, exactly as above.

## Style of questions
- Scenario-based like the real exam: short story + code/YAML/log/command, then the question. Plausible distractors that test a real
  misconception (no joke options). One unambiguous correct answer (or exact set for multiple select).
- Hotspot: show numbered lines (put line numbers as comments in the code, e.g. `-- 1`, or a numbered list) and ask which line.
- DOMC in print: list the options as A, B, C...; the reader covers them with a sheet and reveals one at a time; key gives YES/NO per option.
- Code inside questions: use the code environments (dbtcode, yamlcode, bashcode, outputcode...). ASCII only in code.
- Mock themes (to avoid overlap between mocks):
  * Mock 1 — standard difficulty, close to the official samples' level; scenarios use the book's practice project (jaffle_dbt: stg_jaffle_shop__orders,
    stg_stripe__payments, fct_orders, dim_customers, fct_monthly_revenue ... see PROJECT_SPEC.md).
  * Mock 2 — scenario-heavy (logs, compiled SQL, YAML errors, run_results); fictional company "RideNow" (trips, drivers, riders, fares, ratings).
  * Mock 3 — hardest: edge cases, combinations of features, precise defaults and precedence; fictional company "StreamBox" (subscriptions,
    devices, playback events, invoices).
- Every fact must be correct for dbt Core 1.11. VERIFY behaviour by running dbt in a scratch project (venv in STYLE.md) whenever possible
  (selection syntax results with `dbt ls`, YAML validity with `dbt parse`, test configs, snapshot/incremental configs, contract errors...),
  else check docs.getdbt.com (WebFetch). Keep a verification log in your scratch folder: one line per question (how verified).

## Questions file layout
```
\chapter{Mock Exam N}\label{ch:mockN}
Instructions box (tipbox): 120 minutes, no notes, answer everything, how to simulate DOMC, record answers on the sheet, then go to Chapter~\ref{ch:mockN-answers}.
\begin{questions} \item [Multiple choice] ... \begin{choices}\item ... \end{choices} ... (65 items) \end{questions}
\section*{Answer sheet}  % a table Q1..Q65 with blank space, 5 columns x 13 rows
```
(Do NOT wrap 65 questions in a quizbox; use the questions list directly. Use \newpage only if needed for long code.)

## Answers file layout
```
\chapter{Mock Exam N: Answers and Explanations}\label{ch:mockN-answers}
Score table: per topic, list of question numbers + space for "correct / total"; conversion: >= 80% ready, 65-79% review weak topics, < 65% redo parts.
For each question:
\mockkey{12}{1.11}{B}
Why B is correct (2-5 sentences, precise). Why the others are wrong (one line each).
\mockreview{Chapter~\ref{ch:incremental-microbatch}}
```
Objective in \mockkey must be ONE ID from the distribution (the coverage matrix is generated from these keys).

## Quality gate before you finish
- Count: 65 questions, distribution and formats exact (write a small script to count \mockkey objectives and format labels).
- Compile both files standalone (see STYLE.md) with no errors; render 3 pages to check layout.
- Report: counts table, verification log path, any question you could not fully verify.
