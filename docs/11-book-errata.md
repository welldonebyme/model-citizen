# 11 — Book errata found while building the site

Errors found in `../dbt-bible` while converting and verifying it. Each one is fixed **in the book source** (then the PDF
is rebuilt with `../dbt-bible/build.sh` and the converter re-run), so book and site never diverge.

| # | Where | Problem | Fix | Status |
|---|---|---|---|---|
| 1 | `parts/part9/ch27-exam-strategy.tex:953` | Error message quoted as plain text: ``--state or --defer-state are required'' → TeX typesets `--` as an en dash ("–state") in the PDF | `\code{--state or --defer-state are required}` | done |
| 2 | `../dbt-bible/tools/make_coverage.py` objective titles (`--empty`, `--sample`) | Fine in the source; the converter applied TeX ligatures to plain Python strings (site-side bug, not a book error) | converter fix requested | site |
| 3 | `parts/part2/ch10-configuration.tex:1009` and `parts/part9/ch33-mock3-answers.tex:344,353,776,861` | Flags written outside `\code` (`--vars`, `--empty`, `--sample`) print as en dashes | `-{}-vars` in the heading; `\code{...}` in the mock 3 answers | done |
| 4 | `tools/make_coverage.py` → `appendices/coverage.tex` rows 1.12, 1.13, 3.4, 7.1 | The generator stripped `-{}-` from lab titles and wrote objective names as-is, so `--empty`, `--sample`, `--defer` printed as en dashes | generator keeps `-{}-` and protects `--` in names; appendix regenerated (4 lines changed) | done |
| 5 | `parts/part6/ch22-debugging.tex:186,234,1144`, `parts/part6/ch23-pipelines-clone.tex:568,582` | `Lab~\ref{lab:...}`: labs have no counter, so the reference printed the enclosing subsection number ("Lab 22.2.6") | name the lab by its title and point to its section | done |
| 6 | `parts/part8/ch26-capstone.tex:2109` (Chapter 26 quiz Q16) | "[Hotspot --- which part]" with no code to click and an open question; the only one of its kind in the book | rewritten as "[Hotspot --- which line]" over the compiled SQL (verified with dbt 1.11.16 compile at m05 with the original macro); answer starts with "Line 5." | done |
