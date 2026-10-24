# ShopFlow capstone kit (Chapter 26)

Everything you need to build the **ShopFlow** capstone project of Chapter 26 on macOS, Linux, WSL or Windows.

> **Warning: the solution is inside this kit.** `shopflow_dbt.bundle` is the reference solution: a git
> repository with one tag per milestone (`m00` ... `m14`). Do each milestone yourself first (45 to 90
> minutes, with a timer). Look at the solution only after your own attempt, to compare.

## 1. What is in the kit

| Item | What it is |
|---|---|
| `data/*.csv` | Day-1 raw data: 9 tables in 4 schemas (504 customers, 3000 orders, 25444 web events, ...) |
| `setup.sql` | Creates the raw database `shopflow.duckdb` from `data/`. Run it again to RESET (your dbt schemas are kept). |
| `updates/day2.sql` | Loading day 2026-01-01 (milestone m08, snapshots) |
| `updates/day3.sql` | Loading day 2026-01-02 with late web events (milestone m09, incremental) |
| `updates/fresh_load.sql` | Marks one row of each freshness table as loaded "now" |
| `seeds/*.csv` | `exchange_rates.csv` and `country_regions.csv`: copy them into your project in milestone m03 |
| `shopflow_dbt.bundle` | **The solution** (tags `m00` ... `m14`) |
| `profiles/profiles.yml` | The solution's `shopflow` profile (dev, ci, prod) |
| `tools/duck.py` | Runs SQL with the DuckDB library of your venv (no DuckDB CLI needed) |
| `setup.sh` / `setup.ps1` | Installs the kit in `~/dbt-course/kit/capstone` and builds `~/dbt-course/shopflow-data` (milestone m00, first step) |

You need the course folder of the practice kit first (`~/dbt-course` with its `.venv`, Chapter 2).

## 2. Setup (milestone m00, first step)

macOS / Linux / WSL:

```bash
cd ~/Downloads/shopflow-capstone-kit
bash setup.sh
```

Windows PowerShell:

```powershell
cd $HOME\Downloads\shopflow-capstone-kit
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

The setup installs the kit in `~/dbt-course/kit/capstone` (the book's `labs/capstone` folder: `data/`, `seeds/`,
`setup.sql`, `updates/`, `shopflow_dbt.bundle`, `profiles/`, this README and a ready-made `shopflow.duckdb`), then
does the first step of milestone m00 for you: it copies `data/`, `updates/` and `setup.sql` into
`~/dbt-course/shopflow-data` and builds `shopflow.duckdb` there with the venv's DuckDB library (same result as
`duckdb shopflow.duckdb < setup.sql`). It does **not** clone the solution. Expected row counts (day 1): customers 504, addresses 637, products 33, orders 3000,
order_items 5883, payments 3170, refunds 196, events 25444, shipments 2646.

```text
~/dbt-course/
  .venv/               the Python environment from Chapter 2 (reused)
  practice/            raw data of jaffle_dbt
  shopflow-data/       NEW: data/  updates/  setup.sql  shopflow.duckdb
  shopflow_dbt/        your capstone project: you create it in m00 with dbt init
  kit/capstone/        the capstone kit: data/ seeds/ setup.sql updates/ shopflow_dbt.bundle profiles/ README.md shopflow.duckdb
```

## 3. Update scripts (apply each one ONCE, only when a milestone says so)

| Milestone | macOS / Linux / WSL (DuckDB CLI) | Windows PowerShell (DuckDB CLI) |
|---|---|---|
| m08 | `duckdb shopflow.duckdb < updates/day2.sql` | `duckdb shopflow.duckdb -c ".read updates/day2.sql"` |
| m09 | `duckdb shopflow.duckdb < updates/day3.sql` | `duckdb shopflow.duckdb -c ".read updates/day3.sql"` |
| freshness | `duckdb shopflow.duckdb < updates/fresh_load.sql` | `duckdb shopflow.duckdb -c ".read updates/fresh_load.sql"` |
| reset | `duckdb shopflow.duckdb < setup.sql` | `duckdb shopflow.duckdb -c ".read setup.sql"` |

Run them from `~/dbt-course/shopflow-data`. Without the DuckDB CLI (venv active):
`python ../kit/tools/duck.py shopflow.duckdb -f updates/day2.sql` (Windows: `python ..\kit\tools\duck.py shopflow.duckdb -f updates\day2.sql`).
Close every DuckDB session before you run dbt: DuckDB accepts only one writer.

Row counts after each script: customers 510 / 510, products 35 / 35, orders 3040 / 3070,
order_items 5962 / 6020, payments 3209 / 3241, events 25721 / 26042, shipments 2711 / 2745 (after day2 / after day3).

## 4. Compare with the solution (the book's "solution" remote)

The book adds the solution as a second remote of YOUR repository, with its tags renamed `solution/m00` ...
Use the bundle file instead of the book's folder path:

```bash
cd ~/dbt-course/shopflow_dbt
git remote add --no-tags solution ~/dbt-course/kit/capstone/shopflow_dbt.bundle
git fetch --no-tags solution "refs/tags/*:refs/tags/solution/*"
git diff --stat solution/m03 solution/m04     # what the solution changed in m04
git diff solution/m04 -- models/marts         # your files compared with the solution
git show solution/m04:models/marts/finance/fct_orders.sql
```

(Windows: the same commands, with `$HOME\dbt-course\kit\capstone\shopflow_dbt.bundle`.)

To RUN the solution, clone it into its own folder and give it its own schema, otherwise it overwrites your
models in `dbt_adnane` (same profile, same database file): add an output `solution` (schema `dbt_solution`)
to your `shopflow` profile, then:

```bash
git clone ~/dbt-course/kit/capstone/shopflow_dbt.bundle ~/dbt-course/shopflow_solution
cd ~/dbt-course/shopflow_solution
git checkout m04
dbt deps            # from m05 on (dbt_utils; internet needed)
dbt build --target solution
```

## 5. Rules that keep your checkpoints equal to the book

* Start from a fresh raw database and apply the update scripts only when a milestone says so
  (`day2.sql` in m08, `day3.sql` in m09).
* Run every dbt command from the `shopflow_dbt` folder (the database path in the profile is relative).
* Close the DuckDB CLI before you run dbt.
* The venv's DuckDB library and the DuckDB CLI must have the same version (Chapter 2; the kit uses 1.5.6).
* Timestamps written by dbt itself (snapshot validity, microbatch batch dates) depend on the day you run.
