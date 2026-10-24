# Book figures → themable SVGs

Builds the 64 TikZ figures of the book (`../dbt-bible`, read only) as SVGs for the site:

| Output (generated, never edit) | Content |
|---|---|
| `site/src/generated/figures/chNN-figK.svg` | one SVG per figure, text kept as text, colours as CSS variables |
| `site/src/generated/figures/figures.json` | `[{id, svg, file, line, sha1, width, height, alt, description?}]` in book order |
| `site/src/generated/figures/figures.css` | light + dark values of every `--fig-*` token (and font stacks) |
| `converter/figures/COLORS.md` | the colour → token mapping actually found in the figures, palette, text contrast |

## Palettes

The output uses the **site palette** by default (`colors.PALETTES["site"]`): the book's accent family is
re-based on the site accent (light `#B4237A`, dark `#F06AB4`; every tint such as `accent!15` is recomputed
from it), ink is `#16213B` in light mode, the dark paper is the site's dark surface `#17223A` (light paper
`#FFFFFF`); muted and the semantic colours (why/idea/lab/trap/tip/quiz) keep the book values.
`build.py --palette book` builds the book's own colours into `converter/figures/build/palette-book/`
(SVGs + figures.json + figures.css + COLORS.md; `contact.py --dir build/palette-book` to review it).
Token names never change (`--fig-accent` is the site accent in the site palette).

Hand-written input: `converter/overrides/figures.yaml` (alt text + optional long description per figure, keyed
by id, with the SHA-1 of the figure source; the build fails if a figure changed and its alt text was not
re-checked).

## Ids

`chNN-figK`: NN = chapter number exactly as `tools/inventory.py` counts chapters (Part 0 = 00, appendices
34–36), K = 1-based order of `\begin{tikzpicture}` inside the chapter across all its `\input` files (ch04 =
`ch04-sql.tex` + `ch04-sql-a.tex` + `ch04-sql-b.tex`). Lines starting with `%` are ignored, the title page in
`main.tex` is not counted. `build.py` checks the per-chapter counts against `reference/content-inventory.json`
(64). `file`/`line` in figures.json = book source file (relative to the book root) and line of
`\begin{tikzpicture}`; `sha1` = SHA-1 of the exact text from `\begin{tikzpicture}` to `\end{tikzpicture}`.
`width`/`height` are CSS px (1 pt = 4/3 px, i.e. the figure's physical size in the book).

## Run

```sh
cd converter/figures
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python pymupdf pyyaml   # once
.venv/bin/python build.py              # ~3 min the first time (64 tectonic runs), then cached: seconds
.venv/bin/python build.py --force      # recompile every PDF
.venv/bin/python figsrc.py             # list ids, source lines and sha1s
.venv/bin/python build.py --palette book   # the book's colours -> build/palette-book/
.venv/bin/python contrast.py           # WCAG contrast of every text span, light and dark (--palette book)
# review
npm install                            # once (Playwright 1.64.1; browsers already in ~/Library/Caches/ms-playwright
                                       #   or: npx playwright install chromium)
.venv/bin/python contact.py            # contact-sheet.html: book crop | SVG light | SVG dark, + alt text
node screenshot.mjs                    # screenshots/chromium-01..16.png (4 figures each)
node screenshot.mjs --all-browsers     # + firefox-*.png, webkit-*.png
node screenshot.mjs --only ch20-fig2   # 2x zoom of one row (--browsers chromium,webkit)
```
Needs `/opt/homebrew/bin/tectonic` with its bundle cached (the book is built with it). Re-running gives
byte-identical output (checked: `build.py --force` twice → same SHA-1 for all 67 generated files).
`build/` (tex, pdf, logs, fonts, book crops), `screenshots/` and `contact-sheet.html` are local only (gitignored).

## Pipeline

1. `figsrc.py` finds the figures (inventory rules), their enclosing environments and SHA-1.
2. `texbuild.py` writes `build/chNN-figK.tex`: `\documentclass[11pt,border=2pt]{standalone}` +
   `build/fig-preamble.tex` (generated from the book's `preamble.tex`: same fonts — TeX Gyre Pagella, Fira
   Sans, Fira Mono —, packages, TikZ libraries, colours, inline helpers; minus geometry, titlesec headings,
   fancyhdr, hyperref) + the chapter-local definitions still in effect at the figure (group-aware replay of
   `\tikzset`, `\tcbset`, `\newcommand`, `\renewcommand`, `\def`, `\raggedright` found before it) + the exact
   figure source. Compiled with tectonic; cached by a hash of the input.
3. `svgpost.py`: PDF → SVG with PyMuPDF/MuPDF (`text_as_path=False`, so **text stays text**), then:
   colours → `var(--fig-…, #book-colour)` (`colors.py`), fonts → `var(--fig-font-…, stack)`, one `<tspan x>`
   per word / TeX-placed run (word spaces restored so copy and find-in-page work), TeX long arrows (← + −) →
   `⟵`/`⟶`, ids prefixed with the figure id, MuPDF's fill + stroke path pairs merged, numbers rounded,
   no background (none in the PDFs: transparent), `viewBox` + `width`/`height` (override with CSS),
   `role="img"` + `<title>` (the alt text) + `aria-labelledby`, `data-figure`.
4. `build.py` writes the SVGs, figures.json, figures.css, COLORS.md.

## Using the SVGs on the site

- **Inline** the SVG markup (CSS variables do not cross an `<img>` boundary; through `<img>` the light
  fallbacks are used) and include `figures.css` (`prefers-color-scheme`, or `data-theme="light|dark"` on
  `<html>`). Make them responsive with `svg { max-width: 100%; height: auto; }`.
- **Fonts**: glyph runs are positioned for the book's fonts. Load Fira Sans (400, 600, 400 italic) and Fira
  Mono (400, 700) — e.g. `@fontsource/fira-sans`, `@fontsource/fira-mono` (SIL OFL) — for an exact match.
  Without them the stacks fall back to Helvetica/Arial/Menlo: still readable (checked), but word widths differ
  slightly, so some words sit closer together. Overriding `--fig-font-sans` with the site font works the same way.
- In dark mode, `--fig-paper` (white node fills, `#17223A`) must equal the background behind the figure: two
  figures use white to erase part of a shape (ch04-fig2 left anti, ch04-fig5 EXCEPT).
- Captions are not in the SVGs (ch14-fig1, ch14-fig2, ch26-fig1 have a `\caption` in the book: converter's job).

## Figures that needed special handling

- ch03-fig1…6: use the chapter-level `\tikzset{gcommit, gnew, gmerge, glabel, gmain, gfeat, ghead, garrow, gline}`
  (replayed). ch03-fig5/6 are two pictures in one `center` (separate figures).
- ch10-fig1/2: the chapter is inside `\begingroup\raggedright\tcbset{halign=flush left}` (replayed);
  ch22, ch23: `\renewcommand{\_}{\textunderscore\allowbreak}` (replayed); other chapter `\tcbset` code
  styles are replayed too (no effect on figures). `\def` inside ch04-fig2 / ch14-fig2 are part of the source.
- ch26-fig1: wrapped in `\resizebox{\linewidth}{!}{…}` in the book; the SVG is built at natural size
  (754×404 px; the book shows it at ~81 %).
- ch07-fig4: `$\longleftarrow$`/`$\longrightarrow$` (two overlapping glyphs in TeX) → single `⟵`/`⟶`
  characters (not in Fira: rendered by a fallback font from `--fig-font-math`).
- ch20-fig2 (sketch of the dbt docs lineage graph, xcolor `green!35!black`, `yellow!70!orange`,
  `blue!60!black`, `orange!60`): two hand-picked dark values (see COLORS.md); `yellow!70!orange` is CMYK in
  xcolor and is matched by alias.
- ch04-fig1: its note is in the book's serif font (no `\sffamily`) → `--fig-font-serif`.
- ch04-fig4: `tabular` inside nodes (works as is).
