# HANDOFF — Build the interactive dbt certification training website

You (the next Claude session) are building a **great, interactive training website** that turns an existing,
fully verified 1,191-page study book into a Codecademy-style course with labs and realistic mock exams.
Read this file completely, then the documents in `docs/` in order. Everything you need is in this folder or in
`../dbt-bible/`.

---

## 1. The user and the goal

- **Adnane**, French-speaking, reads English well (not native). Starting point: beginner. Goal: pass the
  **dbt Analytics Engineering Certification** (dbt Core **1.11**, 2026 study guide) with a top score.
- He wants a **website, not an app**: he will send the link to a **friend who uses Windows**. Both must be able
  to use it from a browser (Edge/Chrome on Windows, Safari/Chrome on macOS, and ideally on a phone).
- He wants it to be his "best friend until the cert": step by step, interactive elements, labs he actually
  applies, all the examples, realistic mock exams — "something great, great", with great features and great
  design. **Time is not a constraint; quality is.**
- His Mac: macOS, zsh, Homebrew, Node 25, npm, Bun, Deno, uv, Python 3.14 (use 3.12 venvs), tectonic, git 2.50,
  **GitHub CLI logged in as `welldonebyme`**. No pandoc, no DuckDB CLI installed.

## 2. What already exists (the content is DONE and VERIFIED — do not rewrite it, convert it)

| Asset | Where | Notes |
|---|---|---|
| The book (LaTeX sources + PDF) | `../dbt-bible/` (`main.tex`, `parts/`, `appendices/`, `dbt-bible.pdf`) | 37 chapter-level files: Part 0–IX + 3 appendices. Single source of truth. |
| Content inventory | `reference/content-inventory.md` / `.json` (`tools/inventory.py`) | 118 labs, 487 chapter quiz questions, 195 mock questions, 145 traps, 305 glossary terms, 1,927 code blocks, 64 TikZ figures. Use as the **acceptance test** of your converter. |
| Practice dataset | `../dbt-bible/labs/data/*.csv`, `labs/setup.sql`, `labs/updates/` | jaffle_shop + stripe, deterministic, small (~1.4k rows). Perfect for DuckDB-WASM. |
| Reference practice project | `../dbt-bible/labs/practice-project/jaffle_dbt` | Git repo, one tag per chapter `ch06`…`ch25` (the student's project state after each chapter). |
| Debugging bug patches | `../dbt-bible/labs/practice-project/bugs/` | 9 patches with their real error messages (Chapter 22). |
| Capstone "ShopFlow" | `../dbt-bible/labs/capstone/` | Data generator, setup, updates, and solution repo `shopflow_dbt` with tags `m00`…`m14`. |
| Real dbt outputs | `reference/builder-logs/chNN.md`, `reference/capstone-logs/mNN.md` | Every command + real output from dbt-core 1.11.16 / dbt-duckdb 1.11.0 / DuckDB 1.5.6. Golden data for tests and simulators. |
| DuckDB support matrix | `reference/builder-logs/duckdb_support.md` | What works / errors on dbt-duckdb (grants, clone, strategies…). |
| Book briefs and specs | `reference/book-briefs/` | STYLE (writing rules, objective IDs, tested dbt observations), PROJECT_SPEC, MOCK_BLUEPRINT, CAPSTONE_SPEC, WRITER/REVIEWER briefs. |
| Mock verification logs | `reference/mock-verification/` | How each mock question was verified (some entries predate later rewrites). |
| Book tools | `../dbt-bible/tools/` | `run_sql.py`, `build_practice_db.py`, `make_glossary.py` (term extraction), `make_coverage.py` (objective→chapter/lab/mock mapping). Reuse their parsing logic. |
| Verification env | `tools/setup_verification_env.sh` | Recreates dbt-core 1.11.16 + dbt-duckdb 1.11.0 + duckdb 1.5.6 (+pandas, pyyaml, jinja2). |

The book was written by many agents, then **every chapter was independently reviewed and its labs replayed
from scratch**; all 31 official sub-objectives have a chapter, a lab and ≥3 mock questions (machine-checked).
Treat the book as correct. If you find an error, fix it **in the book source** too (then rebuild with
`../dbt-bible/build.sh`) so book and website never diverge.

## 3. Decisions already made (do not re-ask)

1. **A static website** (no install, no server code required to run it). Shared by URL.
2. **No accounts, no backend.** Each visitor's progress lives in their own browser (IndexedDB), with
   **export/import** of a progress file (to move between computers or show a friend).
3. **Works great on Windows** (Edge/Chrome), macOS, and is usable on phones (reading, quizzes, flashcards).
4. **Content comes from the book through a converter** (never retype 1,191 pages). Book = source of truth.
5. **English UI**, with **French translations** of key terms as tooltips (from `\term{EN}{FR}`) and a FR glossary.
6. **Original brand.** Not dbt Labs branding, no dbt logo, no dbt brand orange as the main color. Footer
   disclaimer: "Unofficial study guide. Not affiliated with or endorsed by dbt Labs. dbt is a trademark of dbt Labs, Inc."
7. **Every lab must work for a Windows learner** (the friend): OS switch macOS / Windows (PowerShell) / WSL, and a
   downloadable **practice kit** replacing the book's local paths (`~/Documents/Adnane/dbt-bible/labs/...`).
8. **Quality bar = the book's**: everything verified (real runs, automated checks, independent reviews).

## 4. Ask the user at the very start (keep it to these; propose defaults)

1. **Name** of the site — propose 4–5 original names (e.g. "Model Citizen", "The DAG Path", "Analytics Engineer
   Dojo", "Ref & Run", "Lineage Academy") and let him pick or invent.
2. **Hosting**: default **GitHub Pages** from a new **public** repo under `welldonebyme` (free; anyone with the
   link can open it). Alternatives: Cloudflare Pages / Netlify. Creating the repo and publishing are
   outward-facing actions: **get his explicit OK before pushing or publishing**.
3. **Visual direction**: show 2–3 quick, real mockups (home + lesson + exam screen) and let him choose.
4. Optional: his **target exam date** (for the countdown and the daily plan).

## 5. Read next (in order)

1. `docs/01-vision.md` — what "great" means here, success criteria.
2. `docs/02-features.md` — the full feature spec with priorities (P0/P1/P2).
3. `docs/03-design.md` — design direction and UX principles.
4. `docs/04-architecture.md` — stack, hosting, performance, persistence.
5. `docs/05-content-pipeline.md` — exact LaTeX → website mapping, IDs, data files, acceptance tests.
6. `docs/06-labs.md` — in-browser labs, real-machine labs, Windows, the dbt-in-the-browser spike.
7. `docs/07-quality.md` — the QA gates that must pass before launch.
8. `docs/08-dbt-facts.md` — verified dbt 1.11 facts and pitfalls (needed for labs, simulators, content fixes).
9. `docs/09-workplan.md` — phases, milestones, how to split the work across agents.

## 6. How to work

- Use the `frontend-design` skill for design work (and `dataviz` for charts). Build real mockups early.
- Large scope: split into parallel workstreams with independent reviewers, exactly like the book was built
  (writer → reviewer → fix, with machine checks). Use workflows / sub-agents when the user has opted in.
- Preview the site in the built-in browser pane by declaring the dev server in `.claude/launch.json` and
  starting it with `preview_start` (not with a background shell command). For automated checks and
  screenshots across browsers, use Playwright (Chromium = Edge/Chrome on Windows, WebKit = Safari, Firefox).
- Never break the book. Never publish without the user's OK. Never copy dbt Labs content or official sample
  questions. Keep the Windows friend in mind on every lab page.
