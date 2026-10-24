# 01 — Vision: what "great" means

## The promise
> "Open the site, do today's mission, and you are one step closer to passing — with proof that you are ready."

The website is a **personal coach** for the dbt Analytics Engineering Certification (dbt Core 1.11):
it teaches (lessons from the book), makes you **do** (labs in the browser and on your machine), **tests** you in
the real exam formats, **remembers** what you got wrong, and tells you **when you are ready** to book the exam.

## Who it is for
- **Adnane** (primary): beginner → certified, French-speaking, studies ~2 h/day for ~14 weeks, on a Mac.
- **His friend** (secondary): same goal, on **Windows**. Gets everything with a link; nothing to install to start
  reading, quizzing and doing in-browser labs; clear Windows instructions for real-machine labs.
- Both are non-native English readers: simple English, FR term tooltips, no idioms in the UI.

## Success criteria (measurable)
1. **Complete**: 100% of the book's content is on the site — every chapter, section, box, code block, figure,
   lab, quiz question (487), mock question (195), trap (145), glossary term (305), cheat sheet, the capstone.
   Machine-checked against `reference/content-inventory.json`.
2. **Interactive where it matters**: every SQL example runnable in the browser; every quiz question answerable
   in its real format (incl. DOMC, hotspot, drag-and-drop build lists, matching); YAML/Jinja/selection
   playgrounds; realistic timed mock exams.
3. **Correct**: no answer key changes meaning in the conversion; SQL results in the browser equal the book;
   selector playground equals real `dbt ls` on the golden set.
4. **Windows-proof**: every real-machine lab step has macOS + Windows (PowerShell) (+ WSL where useful)
   commands; the practice kit downloads and works without the book's local folder.
5. **Fast and friendly**: first lesson page loads in < 2 s on a normal connection; heavy engines
   (DuckDB-WASM, Pyodide) load only on lab pages with a progress indicator; works offline after first visit
   (nice to have).
6. **Beautiful**: a distinctive, calm, modern design with excellent typography, dark mode, and delightful
   but restrained motion. People should *want* to open it every day.
7. **Readiness you can trust**: dashboard with mastery per official objective (31 + prerequisites), mock
   history, and the book's rule: *book the exam after two timed mocks ≥ 80%*.

## Non-goals
- No user accounts, no server, no tracking/analytics by default.
- Not a copy of dbt Labs' courses or docs; no official sample questions.
- Not a native/mobile app (a responsive website; an installable PWA is optional and must not be required).
