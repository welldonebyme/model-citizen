# Model Citizen

A free, interactive course to prepare the **dbt Analytics Engineering Certification** (dbt Core 1.11): 311 lessons,
117 labs, real dbt and DuckDB running in the browser, 27 chapter quizzes and three timed mock exams in all seven
exam formats (including DOMC). It works on Windows, macOS and Linux, in the browser, with no account: progress
stays in the learner's browser.

> Unofficial study guide. Not affiliated with or endorsed by dbt Labs. dbt is a trademark of dbt Labs, Inc.

## What is inside

| Folder | What it is |
|---|---|
| `site/` | The website: Astro + React, static, built for GitHub Pages (`/model-citizen/`) |
| `converter/` | Turns the course book (LaTeX) into the site's content, with acceptance checks against the book |
| `converter/reference/` | The practice and capstone kits (macOS, Windows, WSL setup scripts) and their tests |
| `reference/` | Verification material: content inventory, recorded dbt outputs used as golden tests |
| `docs/` | The specification (01-10), decisions, book errata, status (12) and the QA report (13) |

## Run it locally

Requires Node 24 and npm.

```bash
cd site
npm install
npm run build
npm run preview
```

Then open http://127.0.0.1:4322/model-citizen/. `npm run dev` starts a development server instead (port 4321).

The first build downloads the in-browser dbt engine (dbt-core 1.11.16 and dbt-duckdb on Pyodide), checked
against pinned SHA-256 sums; it is cached in `site/.cache/` and not stored in git.

## Tests

```bash
cd site
npm test                 # unit tests
npm run test:selector    # node selection engine vs recorded dbt ls outputs
npm run e2e              # end-to-end: Chromium, WebKit, Firefox and a phone, with axe accessibility checks
npm run qa:links         # every internal link and anchor of the built site
```

The results of the last full run are in [`docs/13-qa-report.md`](docs/13-qa-report.md).
