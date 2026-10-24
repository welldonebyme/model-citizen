# 12 — Status (paused 2026-10-24, to continue next session)

Nothing is published; no remote exists. Local git repo in `dbt-academy/` (68 commits). Book edits are listed in
`11-book-errata.md`; the original book sources and PDF are saved in `reference/book-snapshot-2026-10-24/`.

## Done and verified
- Kickoff: name **Model Citizen**, design **A "Lineage"**, GitHub Pages at launch (after explicit OK), no exam date.
- Spikes (all GO, re-run by the lead): real dbt-core 1.11.16 in the browser (Pyodide), DuckDB-WASM SQL (69/69 Ch4
  parity), Pyodide YAML/Jinja (37/37, 41/41). See `10-decisions.md`.
- Converter: whole book → `site/src/generated/` (`converter check` ALL PASS; counts = inventory; 682/682 keys = PDF).
- Question bank: independent re-solve 670/671 agree; 11 flagged keys resolved (`converter/overrides/keys.yaml`).
- Question map: 487 chapter questions → lesson + objective (`converter/overrides/question-map.yaml`), wired into
  lessons as checkpoints.
- Figures: 64 themable SVGs, WCAG AA in both themes.
- Site: Today (planner, mission, readiness, streak, mastery), path map, chapter + lesson pages, settings/progress file,
  search, reference (glossary, traps, cheat sheets, coverage), practice (flashcards, notebook), labs hub, reference
  viewer, paste-to-verify, exam engine (7 formats, DOMC, 3 timed mocks, results, drills; 155 e2e tests pass).
- Kits: practice kit + capstone kit with setup.sh / setup.ps1 (35/35 macOS, 11/11 pwsh on macOS).
- Windows: 171 shell blocks with PowerShell variants, 27 Windows + 5 WSL notes (committed by the kit agent).

## In progress when paused (agents stopped mid-task; their uncommitted edits are still in the working tree)
- Kit/Windows agent: paths that match the kit layout (lessons point to `~/dbt-course/kit/labs/...`, the kit installs
  `~/dbt-course/practice/` and `~/dbt-course/reference/`), pwsh replay of the variants (`converter/golden/win-replay.json`
  untracked), site version of figure ch02-fig1 (book paths).
- dbt terminal agent: capstone presets / picker (uncommitted: `site/src/lib/dbt/*`, `site/scripts/dbt/build-presets.mjs`,
  `site/public/presets/dbt/*`).
- Selection engine agent: dbt-style usage errors (uncommitted: `site/src/lib/selector/*`).
- Playgrounds agent (SQL/YAML/Jinja): test helpers and specs.

## Next steps
1. Resume the four agents; review and commit their work.
2. Lead: mount the SQL workspace and the dbt workspace in lesson pages (right column on lab steps).
3. Check paths against the installed kit; then the full QA gates (`07-quality.md`): e2e on all browsers, axe,
   Lighthouse, design / pedagogy (Windows beginner persona) / exam-realism reviews.
4. Delight features (Phase 5) and final screenshots.
5. Ask Adnane: OK for a repo (private first?) to run the Windows CI job (`converter/reference/ci/kit-matrix.yml`), and
   whether the PDF with his name and local paths may be published.
