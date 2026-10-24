# 11 — Book errata found while building the site

Errors found in `../dbt-bible` while converting and verifying it. Each one is fixed **in the book source** (then the PDF
is rebuilt with `../dbt-bible/build.sh` and the converter re-run), so book and site never diverge.

| # | Where | Problem | Fix | Status |
|---|---|---|---|---|
| 1 | `parts/part9/ch27-exam-strategy.tex:953` | Error message quoted as plain text: ``--state or --defer-state are required'' → TeX typesets `--` as an en dash ("–state") in the PDF | `\code{--state or --defer-state are required}` | to do |
| 2 | `../dbt-bible/tools/make_coverage.py` objective titles (`--empty`, `--sample`) | Fine in the source; the converter applied TeX ligatures to plain Python strings (site-side bug, not a book error) | converter fix requested | site |
