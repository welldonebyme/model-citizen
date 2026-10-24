# 03 — Design direction

Load the `frontend-design` skill before designing. Then produce **2–3 real mockups** (home/today, a lesson
with a lab workspace, the exam screen) and let the user choose before building the full design system.

## Personality
Calm, confident, modern, focused — "a premium course you want to open every day". Inspirations:
Codecademy (split-pane lessons with a live workspace), Duolingo (path, streaks, small wins),
Linear / Vercel / Stripe docs (typography, spacing, restraint), Brilliant (interactive explanations).
Avoid generic template looks: commit to a clear visual idea.

## Brand
- **Original identity** (name chosen with the user). No dbt logo, no dbt Labs marks, and do not use dbt's
  brand orange (#FF694B) as the main accent. Footer disclaimer (see HANDOFF §3).
- The book uses navy ink `#1F2A44` + coral `#E8573F`; you may keep a family resemblance with the PDF, but the
  accent should be distinct from dbt's orange (propose options in the mockups).

## Semantic colours (keep the book's meaning, consistent everywhere)
| Book box | Meaning | Suggested hue |
|---|---|---|
| Why this matters | motivation | blue |
| The idea in 3 sentences / Analogy | key idea | amber |
| Hands-on lab | do it | green |
| Exam trap | danger | red |
| Tip | help | cyan |
| Going deeper | optional | grey (collapsed) |
| Where you will meet this in dbt | bridge | brand accent |
| Exam objectives | official tags | navy |
| Check yourself / answers | quiz | violet |
| Summary | recap | accent tint |
Define all colours as tokens with light and dark values; check WCAG AA contrast.

## Typography and code
- A highly readable text face (for example Inter, Source Sans 3 or IBM Plex Sans) and a code face with clear
  `0/O`, `1/l` (for example JetBrains Mono, Fira Code or IBM Plex Mono). 16–18 px body, generous line height.
- Code blocks: titled file headers, terminal style (dark) for shell, result style (light paper) for outputs,
  line numbers where a hotspot or a reference to "line N" exists.

## Layout
- Desktop: left course navigation (collapsible), centre content (max ~72ch), right workspace on lab steps
  (SQL / YAML / Jinja / selector / terminal). Mobile: one column, workspace in a bottom sheet or tab.
- Exam mode: a deliberately **plain, proctored-exam-like** screen (timer, question, options, flag, navigator)
  so the real exam feels familiar.

## Interaction and motion
- Immediate, clear feedback on answers (colour + icon + short message + explanation reveal).
- Small celebrations (step done, chapter done, mock passed) — tasteful, never noisy; respect
  `prefers-reduced-motion`.
- Drag-and-drop formats must have keyboard and tap alternatives.

## Accessibility
- Full keyboard navigation, visible focus, ARIA for custom widgets, alt text for figures, captions for
  diagrams, no information by colour alone. Target: axe-core with zero serious/critical violations.
