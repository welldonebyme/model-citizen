# 04 — Architecture

## Constraints that drive everything
- **Static site** (any static host; default GitHub Pages under `welldonebyme`). No server code, no accounts.
- **Windows + macOS + phone browsers**: Chromium (Edge/Chrome), Safari/WebKit, Firefox.
- **Heavy engines in the browser** (DuckDB-WASM, Pyodide) must be lazy-loaded only where needed.
- **Content is generated** from `../dbt-bible` by a converter; generated files are never hand-edited.

## Recommended stack (validate with a 1-day spike, then commit)
| Concern | Recommendation | Why / notes |
|---|---|---|
| Site framework | **Astro** (static output, content collections, MDX) with **React islands** | Content-heavy site with interactive islands; zero JS on pure reading pages. Alternatives: Next.js static export, SvelteKit static. |
| Styling | CSS custom properties (design tokens) + Tailwind or vanilla CSS modules | Tokens for light/dark; semantic box colours. |
| Code editor | **CodeMirror 6** | Lighter than Monaco, good mobile support; SQL/YAML/Jinja modes. |
| SQL engine | **@duckdb/duckdb-wasm** (`eh`/`mvp` bundle) | Real DuckDB in the browser. The `coi` (threads) bundle needs COOP/COEP headers that GitHub Pages cannot send — use `eh` (or add `coi-serviceworker` only if really needed). Load the practice CSVs from `public/data`. |
| Python in browser | **Pyodide** in a Web Worker | `jinja2` + `pyyaml` for the Jinja/YAML playgrounds with the same messages as the book; dbt-in-browser spike (see `06-labs.md`). |
| Graph / DAG | Cytoscape.js (+ dagre/ELK layout) or React Flow + ELK | Lineage explorer and selection playground. |
| Drag & drop | dnd-kit (React) with keyboard sensors | Build list, matching. |
| Charts | small custom SVG or a light library (follow the `dataviz` skill) | Mastery heatmap, mock history. |
| Persistence | **IndexedDB via Dexie** | Progress, answers, attempts, SRS queue, notes, settings. Versioned schema + migrations; export/import JSON. |
| Search | **Pagefind** (static index at build time) | Full-text search without a server. |
| Tests | Vitest (unit), **Playwright** (e2e on chromium/webkit/firefox, mobile viewport), axe-core, Lighthouse CI | See `07-quality.md`. |
| Converter | Python 3.12 (reuse `../dbt-bible/tools` parsing) or Node/TypeScript | Must be idempotent and covered by acceptance tests. |

Node: local machine has Node 25 (current). Pin an LTS (22 or 24) in `.nvmrc`/CI for reproducible builds.

## Proposed repository layout (inside this folder)
```
dbt-academy/
  HANDOFF.md  docs/  reference/  tools/          # this handoff (keep)
  site/                                          # the website project (Astro)
    astro.config.mjs  package.json
    src/
      content/            # GENERATED from the book (lessons, questions, traps, glossary, coverage)
      components/         # Callout, CodeBlock, Lab, Quiz/*, Exam/*, Playgrounds/*, Graph, ...
      layouts/  pages/    # /, /today, /path, /learn/[chapter]/[lesson], /quiz/[chapter], /exam/[mock], ...
      lib/                # progress store (Dexie), SRS, scoring, selectors engine, verifiers
      workers/            # duckdb.worker, pyodide.worker
    public/
      data/               # practice CSVs + setup.sql + updates (for DuckDB-WASM)
      kits/               # practice kit zip, capstone kit zip, bug patches
      reference/          # exported reference repo trees/diffs per tag (JSON)
      pdf/dbt-bible.pdf
  converter/              # book -> site/src/content (+ tests against reference/content-inventory.json)
```

## Persistence model (IndexedDB)
- `settings` (os, theme, font size, rhythm, exam date, name)
- `progress` (per lesson step / lab / chapter: status, timestamps)
- `answers` (per question attempt: chosen, correct, time, mode)
- `examAttempts` (mock id, mode, start/end, answers, flags, score breakdown)
- `srs` (card id, box/ease, due date)
- `notes` (error notebook entries, explain-it-back notes)
- Export = one JSON file with a schema version; import validates and merges.

## Performance budget
- Reading pages: ≤ 100 KB JS (gzip) excluding fonts; LCP < 2 s on 4G.
- Lab pages: show the lesson immediately; load DuckDB-WASM / Pyodide in a worker with a progress bar;
  cache them (HTTP cache + optional service worker).
- Images: figures as SVG; no layout shift.

## Hosting & deploy
- Default: **GitHub Pages** via GitHub Actions from a **public** repo (free plan requirement). Configure Astro
  `site` and `base` for project pages (`https://welldonebyme.github.io/<repo>/`).
- Alternatives: Cloudflare Pages / Netlify (also free, custom headers possible).
- Publishing and repo creation are outward-facing: ask the user first; show what will be public.
- Also publish the **reference repos** (practice project with tags, capstone solution) so the Windows friend can
  `git clone` them — or ship them as zips in `public/kits/`. Ask the user which.
