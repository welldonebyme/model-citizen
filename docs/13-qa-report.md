# 13 — QA report (quality gates of 07-quality.md)

State on 2026-10-24, local build only (nothing published). Numbers are from runs made that day; each line says
how to run the check again.

## 1. Content parity
| Check | Result | How to rerun |
|---|---|---|
| Converter acceptance vs `reference/content-inventory.json` | ALL PASS | `converter/.venv/bin/python -m converter check` |
| Converter unit tests | 159 passed | `converter/.venv/bin/python -m pytest -q converter/tests` |
| Totals: 487 chapter questions, 195 mock questions, 145 traps, 305 terms, 118 labs | equal to the inventory | part of `converter check` |
| 31 exam objectives: at least 1 lesson, 1 lab, 3 mock questions each | all 31 pass (minimum: 2 labs, 3 mock questions) | coverage script in the session log; data in `site/src/generated/coverage.json` |
| Every internal link and anchor resolves | 0 broken of 18,676 links on 407 pages | `npm --prefix site run qa:links` (after a build) |
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
| Shell blocks with a PowerShell variant | 171 of 572 (every block that needs one; 0 lines without an OS rule) |
| PowerShell replay of every Windows block (pwsh 7.6 on macOS, next to zsh) | 145 ok, 24 partly, 2 untested, 0 different; 1,032 commands compared |
| Practice and capstone kits | macOS 35/35, pwsh 11/11; 51 paths shown by the site: 20 exist after setup, 31 are created by a lab step, 0 missing |
| `windows-latest` CI job | **written, never run**: it needs a GitHub repository (Adnane's OK needed) |
| Real Windows PowerShell 5.1, Edge on Windows, iOS Safari | **not tested** (no device here) |

## 5. UX, accessibility, performance
| Check | Result | How to rerun |
|---|---|---|
| End-to-end suite (Chromium, WebKit, Firefox, phone) on an isolated build | 567 passed, 0 failed | `npm --prefix site run e2e` |
| axe on 37 page types, light and dark, 4 browsers, + no console errors + no sideways scroll on a phone | 296 of 296 | `npx playwright test tests/e2e/site-a11y.spec.ts` |
| Dashboard, capstone, offline, delight specs | 12 + 20 + 1 + 84, all passed | same folder |
| Lighthouse (mobile profile) on 8 pages | Performance 97 to 100; Accessibility, Best practices, SEO 100; CLS at most 0.014 | Lighthouse 12.6.1 against the preview |
| Unit tests (site) | 519 passed; selector suite 2,884 passed | `npm --prefix site test`, `npm --prefix site run test:selector` |

## 6. Human-style reviews
Run as a workflow of independent agents (design, Windows-beginner pedagogy for weeks 1 and 4, exam realism,
functional bug hunt), each finding re-checked by a skeptic before any fix. Results and fixes: see below.

## 7. Legal / brand
Footer disclaimer on every page with the site chrome; no dbt Labs logo or marks; questions and texts come from
the author's book only.
