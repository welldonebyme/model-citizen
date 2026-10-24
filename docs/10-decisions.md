# 10 — Decision log

Decisions taken while building the site, with the reason and the evidence. Newest last.

| Date | Decision | Why / evidence |
|---|---|---|
| 2026-10-24 | Name: **Model Citizen** | Adnane's choice among 4 proposals (kickoff). |
| 2026-10-24 | Design: direction **A "Lineage"** (`mockups/a-lineage.html`) | Adnane's choice among 3 working mockups. Course drawn as a DAG; navy ink `#16213B`, magenta accent `#B4237A` (dark `#F06AB4`), cool paper `#F3F5F9`; Atkinson Hyperlegible Next + Mono (self-hosted via @fontsource, no third-party font requests). |
| 2026-10-24 | Hosting at launch: **GitHub Pages**, new public repo under `welldonebyme` | Adnane's choice. Nothing is created or published before his explicit OK at launch. Base path `/model-citizen/` used in dev too. |
| 2026-10-24 | Exam date: not set | Adnane's answer; settable in Settings. |
| 2026-10-24 | Stack: **Astro 7.3.8 + React 19 islands**, TypeScript, Dexie (IndexedDB), Pagefind, Vitest, Playwright | Content-heavy static site with interactive islands. Pinned versions ≥ 2 weeks old. Node: `.nvmrc` 24. |
| 2026-10-24 | One React content renderer (`components/content/*.tsx`) used both statically and in islands | Quiz islands must render the same book content (code, tables, terms); Astro renders it to HTML with zero JS on reading pages. |
| 2026-10-24 | Search dialog in vanilla TS, loaded on first use | Keeps React off reading pages. |
| 2026-10-24 | **Real dbt in the browser** (Pyodide 314.0.7, dbt-core 1.11.16, dbt-duckdb 1.11.0, DuckDB 1.5.1), no simulator | Spike `spikes/dbt-pyodide/REPORT.md`: ch07 11/12, ch14 21/22, ch16 63/69, ch19 6/10, ch22 2/2 vs golden logs (all remaining diffs explained). Lead re-ran ch22 in WebKit: `PASS=66 WARN=1 ERROR=0 SKIP=0 NO-OP=2 TOTAL=69` = golden. Cost: ~23 MB gzip (30 MB with pandas), loaded only on demand. Limits shown to learners: one thread, no git, no `dbt deps`. Real-machine labs (type B) stay. |
