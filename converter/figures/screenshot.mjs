// Screenshot contact-sheet.html in groups of rows (book | SVG light | SVG dark).
//   node screenshot.mjs                 -> screenshots/chromium-01.png ...
//   node screenshot.mjs --all-browsers  -> also firefox-*.png and webkit-*.png
//   node screenshot.mjs --per 4         -> rows per image (default 4)
//   node screenshot.mjs --browsers chromium,webkit --only ch03-fig2,ch10-fig1   -> 2x zooms of some rows
import { chromium, firefox, webkit } from "playwright";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const per = Number(args[args.indexOf("--per") + 1]) || 4;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null; // e.g. --only ch08-fig1,ch20-fig2
const all = { chromium, firefox, webkit };
const browsers = args.includes("--browsers")       // e.g. --browsers chromium,webkit
  ? Object.fromEntries(args[args.indexOf("--browsers") + 1].split(",").map((b) => [b, all[b]]))
  : args.includes("--all-browsers") ? all : { chromium };
const outDir = join(here, "screenshots");
mkdirSync(outDir, { recursive: true });
if (!only) for (const f of readdirSync(outDir)) if (f.endsWith(".png")) unlinkSync(join(outDir, f));

for (const [name, type] of Object.entries(browsers)) {
  const browser = await type.launch();
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: only ? 2 : 1 });
  await page.goto(pathToFileURL(join(here, "contact-sheet.html")).href);
  await page.evaluate(() => document.fonts.ready);
  const boxes = await page.$$eval(".row", (rows) =>
    rows.map((r) => { const b = r.getBoundingClientRect(); return { y: b.top + window.scrollY, h: b.height, id: r.id }; }));
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  // font check: which families actually rendered?
  const fontsOk = await page.evaluate(() => ["Fira Sans", "Fira Mono"].map((f) => `${f}:${document.fonts.check(`12px '${f}'`)}`));
  console.log(name, "fonts", fontsOk.join(" "));
  if (only) {
    for (const id of only) {
      const file = join(outDir, `zoom-${name}-${id}.png`);
      await page.locator(`#${id} .cols`).screenshot({ path: file });
      console.log(file);
    }
    await browser.close();
    continue;
  }
  for (let i = 0; i < boxes.length; i += per) {
    const grp = boxes.slice(i, i + per);
    const y = grp[0].y - 4, h = grp.at(-1).y + grp.at(-1).h - y + 4;
    const file = join(outDir, `${name}-${String(i / per + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width, height: h } });
    console.log(file, grp.map((g) => g.id).join(" "));
  }
  await browser.close();
}
