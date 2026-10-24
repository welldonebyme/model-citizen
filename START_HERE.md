# START HERE — next session: build the training website

## 1. Open the next session in this folder
Open the new Claude Code session with the working folder **`/Users/mac/Documents/Adnane`**
(the parent folder, so the session can read both `dbt-academy/` and `dbt-bible/`).

## 2. Paste this message
```text
Read /Users/mac/Documents/Adnane/dbt-academy/HANDOFF.md, then every file in
/Users/mac/Documents/Adnane/dbt-academy/docs/ in order (01 to 09). Then build the interactive
dbt certification training website they describe, using my verified book in
/Users/mac/Documents/Adnane/dbt-bible as the single source of content.

I want something great: Codecademy-level interactive lessons and labs, realistic timed mock exams
(all 7 exam formats, real DOMC), a beautiful original design, and it must work perfectly for my
friend on Windows. It is a website I will share by link, not an app.

Start with the kickoff in docs/09-workplan.md: ask me the HANDOFF section 4 questions (show me
2-3 real design mockups to choose from), run the tech spikes, then build phase by phase.
Use a workflow / multi-agent orchestration wherever it helps - quality matters more than time.
Verify everything the way the book was verified, keep a task list I can follow, and do not create
any public repo or publish anything online until I explicitly say OK.
```

## 3. What is in this folder
| Path | What it is |
|---|---|
| `HANDOFF.md` | The full brief: user, goal, assets, decisions already made, questions to ask, how to work |
| `docs/01-vision.md` … `docs/09-workplan.md` | Vision, features, design, architecture, content pipeline, labs (incl. Windows), QA gates, dbt facts, work plan |
| `reference/content-inventory.md` / `.json` | Exact counts of everything in the book (converter acceptance test) — `python3 tools/inventory.py` |
| `reference/book-briefs/` | The specs and rules used to write the book |
| `reference/builder-logs/` | Real dbt commands + outputs for every chapter (golden data), DuckDB support matrix |
| `reference/capstone-logs/` | Real outputs for every capstone milestone |
| `reference/mock-verification/` | How each mock question was verified |
| `tools/setup_verification_env.sh` | Recreates the exact dbt 1.11.16 + DuckDB 1.5.6 environment |
| `tools/inventory.py` | Regenerates the content inventory from the book |

Nothing of the website exists yet: the next session creates `site/` and `converter/` here.
