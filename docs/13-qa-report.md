# 13 — QA report (quality gates of 07-quality.md)

State on 2026-10-24 (after the review fixes), local build only (nothing published). Numbers are from runs made that day; each line says
how to run the check again.

## 1. Content parity
| Check | Result | How to rerun |
|---|---|---|
| Converter acceptance vs `reference/content-inventory.json` | ALL PASS | `converter/.venv/bin/python -m converter check` |
| Converter unit tests | 167 passed | `converter/.venv/bin/python -m pytest -q converter/tests` |
| Totals: 487 chapter questions, 195 mock questions, 145 traps, 305 terms, 118 lab boxes (117 labs: the Chapter 0 "example" box is an illustration) | equal to the inventory | part of `converter check` |
| 31 exam objectives: at least 1 lesson, 1 lab, 3 mock questions each | all 31 pass (minimum: 2 labs, 3 mock questions) | coverage script in the session log; data in `site/src/generated/coverage.json` |
| Every internal link and anchor resolves | 0 broken of 19,503 links on 408 pages | `npm --prefix site run qa:links` (after a build) |
| No private paths in anything shipped (site, kits, presets, reference data) | 0 hits | `converter check` (check_shipped) and a scan of `site/dist` |

## 2. Question bank
| Check | Result |
|---|---|
| Keys have the right shape for every format | pass (`converter check`) |
| Independent re-solve of all questions (agent, web form, no key) | 670/671 agreed; the disagreement and 10 other flagged keys resolved in `converter/overrides/keys.yaml` |
| Keys equal the answers printed in the PDF | 682 of 682 |
| Every chapter question mapped to its lesson and objective | 487 of 487 (`converter/overrides/question-map.yaml`) |

## 3. Executable parity
| Check | Result |
|---|---|
| SQL: book blocks with a result run in DuckDB-WASM | 70 of 70 checks match, in Chromium, WebKit and Firefox |
| YAML / Jinja playgrounds vs PyYAML / jinja2 | 37/37 and 41/41 |
| Selection engine vs recorded real `dbt ls` | 397 exact on the entry's own state + 8 at the neighbouring tag + 26 where the golden log was a temporary state (engine = real dbt at the tag); 1 out of scope (a cyclic project), 3 not simulated; plus 1,370 argument lists compared live with dbt 1.11.16 |
| Paste-to-verify parsers on the 292 golden outputs | all pass (unit tests) |
| dbt in the browser vs golden logs | ch07 12/12 and ch22 2/2 in Chromium, Firefox and WebKit (`Done. PASS=66 WARN=1 ERROR=0 SKIP=0 NO-OP=2 TOTAL=69`) |

## 4. Windows
| Check | Result |
|---|---|
| Shell blocks with a PowerShell variant | 572 of 572 in Windows mode (171 with rewritten commands, the rest with the `PS>` prompt); 0 lines without an OS rule; Windows notes wherever a lesson shows or explains macOS-only output |
| PowerShell replay of every Windows block (pwsh 7.6 on macOS, next to zsh) | 145 ok, 24 partly, 2 untested, 0 different; 1,032 commands compared |
| Practice and capstone kits | macOS 40/40, pwsh 15/15 (including the "Get the course files" commands exactly as shown); 51 paths shown by the site: 20 exist after setup, 31 are created by a lab step, 0 missing |
| `windows-latest` CI job | **written, never run**: it needs a GitHub repository (Adnane's OK needed) |
| Real Windows PowerShell 5.1, Edge on Windows, iOS Safari | **not tested** (no device here) |

## 5. UX, accessibility, performance
| Check | Result | How to rerun |
|---|---|---|
| End-to-end suite (Chromium, WebKit, Firefox, phone) on an isolated build | 740 passed, 0 failed, 4 skipped by design | `npm --prefix site run e2e` |
| axe on 41 page types, light and dark, 4 browsers, + no console errors + no sideways scroll on a phone | 328 of 328 (part of the suite above) | `npx playwright test tests/e2e/site-a11y.spec.ts` |
| Feature specs (dashboard, capstone, offline, delight, learning flow, design, exam, quiz, formats...) | all passed (part of the suite above) | same folder |
| Lighthouse (mobile profile) on 10 pages | Performance 92 to 100; Accessibility, Best practices, SEO 100; CLS at most 0.015 | Lighthouse 12.6.1 against the preview |
| Unit tests (site) | 555 passed; selector suite 2,884 passed; type check clean | `npm --prefix site test`, `npm --prefix site run test:selector`, `npx tsc --noEmit -p site` |

## 6. Human-style reviews
Run as a workflow of four independent reviewers, each followed by a skeptic who tried to reproduce and refute
every finding: design (about 300 screenshots, 22 page types, 3 sizes, light and dark), pedagogy ("Amal", a
Windows 11 beginner who followed weeks 1 and 4 end to end), exam realism (a full timed Mock 1, every format,
25 questions sampled against the book) and a functional bug hunt (every interactive feature, 3 browsers).

89 findings, 87 survived verification (2 blockers, 21 major, the rest minor or polish). Fixes were split by
file ownership between five owners (exam engine, content and Windows, dbt in the browser, design, lead), each
fix with its own test. Result: 81 fixed, 5 partly, 1 not fixed.
- **Blockers, fixed:** Mock 1 question 61 had one input for two blanks (every fill question is now checked:
  inputs = blanks); nothing told the learner to get the course files before lab 1.6 (a "Get the course files"
  box with the commands for macOS, Windows and WSL, and an item on Today's plan).
- **Major, fixed:** inline code broken mid-word; figures with 4-8 px text on a phone; French tooltips pushing
  17 lessons sideways; Today's course map never filled; YAML/Jinja playgrounds not linked; Windows blocks
  showing macOS output with no note; Unix-only commands in Windows lessons; "Check your output" refusing the
  Windows output; topic weights shown as "26% of the exam" (it is 40%); text written to the book's author
  ("Welcome, Adnane", "your Mac"); results counting retakes of one mock; chapter-quiz keys 70% "B" with no
  shuffling; missed questions counted as due but impossible to review; labs vanishing from the plan.
- **Partly:** the exam page still carries the key (a static site grades in the browser); every mock
  multiple-select asks for 2 answers (the book's questions are kept, a note says the real exam can ask for 2
  or 3); the workspace on a phone is reached with a jump link, not a bottom sheet; page widths aligned on most
  pages, the mock pages keep their deliberate exam look; Today's mastery legend has swatches but keeps its own
  colours (3 levels in the accent) while Progress uses a 5-step blue heatmap.
- **Not fixed:** week-1 time estimates (they are the book's; the Windows installs of lesson 2.9 are long).
Raw results: the review workflow's output in the session scratchpad (`reviews/result.json`, `fix-*.md`).

## 7. Legal / brand
Footer disclaimer on every page with the site chrome; no dbt Labs logo or marks; questions and texts come from
the author's book only.
