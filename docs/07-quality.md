# 07 — Quality gates (all must pass before launch)

The book reached its quality through machine checks + independent reviewers. Do the same here.

## 1. Content parity (automated, CI)
- Converter acceptance tests vs `reference/content-inventory.json` (per chapter: sections, boxes by type, code
  blocks by language, figures, labs, quiz questions and formats, objective tags, terms) — exact match.
- Totals: 487 chapter questions, 195 mock questions (blueprint per mock intact: 26/7/8/5/9/4/6 by topic,
  formats 30/6/6/5/5/5/8), 145 traps, 305 terms, 118 labs, 31 objectives covered (≥ 1 lesson, ≥ 1 lab,
  ≥ 3 mock questions each).
- No raw LaTeX in output; every internal link and anchor resolves; every figure renders.

## 2. Question bank correctness (agents + automation)
- Every question has a key of the right shape for its format (MC 1 letter; MS exactly N; DOMC YES/NO per
  option; matching a bijection; build list a permutation; hotspot a line that exists; fill-in non-empty with
  variants).
- **Independent re-solve**: a second agent answers every question *in its web form* (without the key) and
  compares; any disagreement is investigated against the book PDF and fixed at the source.
- Explanations and "why wrong" texts present for every question.

## 3. Executable parity (automated)
- **SQL**: every book SQL block with a printed result runs in DuckDB-WASM (headless Playwright) and the result
  equals the book (formatting-insensitive). Report and resolve each difference (version effects).
- **Selection engine**: 100% match with all recorded real `dbt ls` outputs (golden set from logs + Chapter 16).
- **YAML / Jinja playgrounds**: outputs equal PyYAML/jinja2 results for every book example.
- **Paste-to-verify**: parsers tested on the real outputs in `reference/builder-logs` and `capstone-logs`.
- **dbt in browser / simulator** (if built): outputs equal golden logs (modulo timings/order) for the covered labs.

## 4. Windows
- Every real-machine lab step has a Windows (PowerShell) variant. Run the practice-kit setup script in a GitHub
  Actions `windows-latest` job (install uv + Python 3.12 + dbt 1.11 + DuckDB, build the practice DB, `dbt debug`,
  `dbt build` at tag ch07) — proof that the friend's path works. Same job on `macos-latest` and `ubuntu-latest`.
- Site tested in Chromium (Edge/Chrome), WebKit (Safari) and Firefox, desktop + mobile viewports.

## 5. UX, accessibility, performance
- Playwright e2e: lesson flow, every quiz format (mouse + keyboard), full mock in exam mode (time
  fast-forwarded), results/review, drills, export/import progress, OS switch, theme switch, search.
- axe-core: no serious/critical violations on every page type. Keyboard-only path through a full mock.
- Lighthouse: Performance ≥ 90 on reading pages, Accessibility ≥ 95; heavy engines lazy-loaded.
- No console errors; no layout shift; works offline after first visit (if implemented).

## 6. Human-style reviews (independent agents)
- Design review against `03-design.md` on real screenshots of each page type (light + dark, desktop + phone).
- Pedagogy review: a "beginner on Windows" persona follows Week 1 and Week 4 end to end and reports friction.
- Exam-realism review of the simulator (timer, DOMC rules, navigation, results) against Part 0's description.

## 7. Legal / brand
- Disclaimer present; no dbt Labs logo/marks; no copied official questions or course text.
