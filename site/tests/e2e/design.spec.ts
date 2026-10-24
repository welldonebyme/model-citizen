// Design review fixes (scratchpad reviews/fix-design.md): inline code, figures, French tooltips, playground links,
// the lesson layout, search, the course map, J/K, the SQL engine download, the 404 page and the reference viewer.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const isPhone = (name: string) => name === 'mobile';
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('D1: inline code in the source properties table never breaks inside a name', async ({ page }) => {
  await page.goto('learn/ch07/ch07-s2/');
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('.mc-table .mc-ic')) {
      let prev: number | null = null;
      let text = '';
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
        for (let i = 0; i < n.data.length; i++) {
          const r = document.createRange();
          r.setStart(n, i); r.setEnd(n, i + 1);
          const top = r.getClientRects()[0]?.top;
          if (top !== undefined && prev !== null && top > prev + 4 && !/[\s._/\\:,]$/.test(text) && n.data[i] !== ' ') out.push(`${text}|${n.data.slice(i)}`);
          if (top !== undefined) prev = top;
          text += n.data[i];
        }
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('D2: figures are drawn larger than in the book, and Enlarge opens them on the whole screen', async ({ page }, info) => {
  await page.goto('learn/ch07/ch07-s2/');
  const fig = page.locator('figure.mc-fig').first();
  await fig.scrollIntoViewIfNeeded();
  const size = await fig.evaluate((f) => {
    const svg = f.querySelector('svg')!;
    const k = svg.getScreenCTM()!.a;
    const px = [...svg.querySelectorAll('text')].map((t) => parseFloat(getComputedStyle(t).fontSize) * k).sort((a, b) => a - b);
    return { min: px[0], width: svg.getBoundingClientRect().width, book: Number(svg.getAttribute('width')) };
  });
  expect(size.width).toBeGreaterThan(size.book);
  expect(size.min).toBeGreaterThanOrEqual(isPhone(info.project.name) ? 11.5 : 13);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await fig.getByRole('button', { name: 'Enlarge the figure' }).click();
  const box = page.locator('dialog.mc-figbox');
  await expect(box).toBeVisible();
  await expect(box.getByRole('button', { name: 'Close' })).toBeFocused();
  expect(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return ids.filter((id, i) => ids.indexOf(id) !== i); })).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  await expect(fig.getByRole('button', { name: 'Enlarge the figure' })).toBeFocused();
});

test('D6/F22: the French tooltips stay on the screen; on a phone the first tap shows the French', async ({ page }, info) => {
  for (const path of ['learn/ch05/ch05-s2/', 'learn/ch19/ch19-s1/', 'learn/ch04/ch04-s8/', 'learn/ch01/ch01-s2/']) {
    await page.goto(path);
    expect(await sideways(page), path).toBeLessThanOrEqual(1);
  }
  await page.goto('learn/ch05/ch05-s2/');
  const outside = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('a.mc-term')].flatMap((t) => {
    t.scrollIntoView({ block: 'center' });
    t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const r = t.querySelector('.mc-term-fr')!.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    return r.left < 0 || r.right > innerWidth ? [t.textContent] : [];
  }));
  expect(outside).toEqual([]);
  if (!isPhone(info.project.name)) return;
  await page.goto('learn/ch01/ch01-s6/');
  const term = page.locator('a.mc-term').first();
  await term.scrollIntoViewIfNeeded();
  await term.tap();
  const tip = term.locator('.mc-term-fr');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('FR : ');
  expect(new URL(page.url()).pathname).toContain('/learn/ch01/ch01-s6/');
  const r = await tip.boundingBox();
  expect(r!.x).toBeGreaterThanOrEqual(0);
  expect(r!.x + r!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await term.tap();
  await expect(page).toHaveURL(/reference\/glossary\/#term-/);
});

test('D4: the YAML and Jinja playgrounds are linked from the Labs hub and from Chapters 5 and 11', async ({ page }) => {
  await page.goto('labs/');
  await expect(page.locator('a.tool[href$="labs/yaml/"]')).toContainText('YAML playground');
  await expect(page.locator('a.tool[href$="labs/jinja/"]')).toContainText('Jinja playground');
  await page.goto('learn/ch05/ch05-s2/');
  await expect(page.locator('.mc-code-actions a[href$="labs/yaml/"]').first()).toHaveText('Try in the YAML playground');
  await expect(page.locator('.mc-lab-try a[href$="labs/yaml/"]').first()).toBeVisible();
  await page.goto('learn/ch11/ch11-s2/');
  await expect(page.locator('a[href$="labs/jinja/"]').first()).toBeVisible();
});

test('D5/D10/D23: the chapter outline stays reachable, and a jump to the workspace has a way back', async ({ page }, info) => {
  const outline = page.locator('#lesson-outline');
  const toggle = page.locator('[data-outline-toggle]');
  if (!isPhone(info.project.name)) {
    // a 1440 px laptop: outline, lesson and workspace side by side; the step dots are 24 px targets
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('learn/ch04/ch04-s3/');
    await expect(outline).toBeVisible();
    await expect(toggle).toBeHidden();
    const dot = await page.locator('.dots a').first().boundingBox();
    expect(dot!.height).toBeGreaterThanOrEqual(24);
    expect(dot!.width).toBeGreaterThanOrEqual(24);
    await page.setViewportSize({ width: 1180, height: 820 });
  } else {
    await page.goto('learn/ch04/ch04-s3/');
  }
  // narrower: the outline opens as a drawer from "Lessons" in the lesson bar
  await expect(outline).toBeHidden();
  await toggle.click();
  await expect(outline).toBeVisible();
  await expect(outline.locator('a[aria-current="page"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(outline).toBeHidden();
  await expect(toggle).toBeFocused();
  if (!isPhone(info.project.name)) return;
  // phone: the workspace sits below the lesson; "Workspace" jumps there and "Back" returns to the same place
  await page.locator('[data-step]').nth(1).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -200);
  const y = await page.evaluate(() => scrollY);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-work-jump]').click();
  const back = page.locator('[data-work-back]');
  await expect(back).toBeVisible();
  await back.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(10);
  await expect(back).toBeHidden();
  // a "Run in workspace" in a step comes back to that step (the SQL engine itself is not downloaded here)
  await page.route(/duckdb/, (r) => r.abort());
  await page.evaluate((top) => window.scrollTo(0, top), y);
  const run = page.locator('[data-step] [data-send-to-workspace]').first();
  await run.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await page.locator('#lesson-work astro-island:not([ssr])').first().waitFor({ state: 'attached' });
  await run.click();
  await expect(back).toBeVisible();
  await expect(back).toHaveText(/^Back to step \d+: /);
  await back.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before + 30);
  await expect(run).toBeFocused();
});

test('D11/F15: search snippets have no page chrome, and more than 12 results can be shown', async ({ page }) => {
  await page.goto('path/');
  await page.locator('[data-search-open]').first().click();
  const input = page.locator('.mc-search input');
  await input.fill('incremental');
  const items = page.locator('.mc-search-results li');
  await expect(items).toHaveCount(12);
  const text = (await items.allInnerTexts()).join(' ');
  expect(text).not.toMatch(/Exam objectives:|FR :|Step \d+ of \d+/);
  const more = page.locator('.mc-search-more');
  await expect(more).toBeVisible();
  await more.click();
  await expect(items).toHaveCount(24);
  await input.fill('xyzzy');
  await expect(page.locator('.mc-search-status')).toHaveText('1 result');
});

test('D8/D16: the course map shows all ten parts, labels clear of the ports', async ({ page }, info) => {
  await page.goto('path/');
  const svg = page.locator(isPhone(info.project.name) ? '.dag .dag-v' : '.dag .dag-h');
  await expect(svg).toBeVisible();
  const r = await svg.boundingBox();
  if (isPhone(info.project.name)) expect(r!.x + r!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(svg.locator('.node-link')).toHaveCount(10);
  const tight = await svg.evaluate((s) => [...s.querySelectorAll<SVGGElement>('.node')].flatMap((g) => {
    const w = Number(g.querySelector('.box')!.getAttribute('width'));
    return [...g.querySelectorAll<SVGTextElement>('text')].filter((t) => { const b = t.getBBox(); return b.x + b.width > w - 12; }).map((t) => t.textContent);
  }));
  expect(tight).toEqual([]);
});

test('F8: J and K move from step to step', async ({ page }, info) => {
  test.skip(isPhone(info.project.name), 'keyboard shortcuts');
  await page.goto('learn/ch07/ch07-s4/');
  await page.locator('h1').click();
  const at = () => page.evaluate(() => document.activeElement?.closest('[data-step]')?.id);
  const steps = await page.locator('[data-step]').evaluateAll((s) => s.map((e) => e.id));
  for (const id of steps) { await page.keyboard.press('j'); await expect.poll(at).toBe(id); }
  await page.keyboard.press('k');
  await expect.poll(at).toBe(steps[steps.length - 2]);
});

test('F16: a Chapter 4 lesson does not download the SQL engine before Start or Run', async ({ page }) => {
  const duck: string[] = [];
  page.on('request', (r) => { if (/duckdb/.test(r.url())) duck.push(r.url()); });
  await page.goto('learn/ch04/ch04-s2/');
  await page.locator('[data-testid="sql-workspace"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="start-engine"]')).toBeVisible();
  expect(duck).toEqual([]);
});

test('F23: an unknown address shows the site 404 page with the way back', async ({ page }) => {
  const res = await page.goto('learn/ch07/ch07-s99/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('This page is not here');
  await expect(page.getByRole('link', { name: 'Go to Today' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open your path' })).toBeVisible();
  await expect(page.locator('[data-nf-link]')).toContainText('Chapter 7');
  await page.getByRole('button', { name: 'Search the course', exact: true }).click();
  await expect(page.locator('dialog.mc-search')).toBeVisible();
  await page.keyboard.press('Escape');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('F7: the reference viewer fits a phone', async ({ page }) => {
  await page.goto('labs/reference/');
  await expect(page.locator('.rv-tags button').first()).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  const last = await page.locator('.rv-tags button').last().boundingBox();
  expect(last!.x + last!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('D18/F18: About and Reference describe only what the build ships', async ({ page }) => {
  await page.goto('reference/');
  const pdf = await page.locator('a[href$="pdf/dbt-bible.pdf"]').count();
  await expect(page.getByText(/Every official objective \(37 with the prerequisites\)/)).toBeVisible();
  await page.goto('about/');
  await expect(page.getByText('You can download the full book as a PDF')).toHaveCount(pdf ? 1 : 0);
});
