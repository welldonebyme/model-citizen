// Delight islands on the test page /test/delight/ (mounted like the lead will mount them):
// XP and badges, a celebration when a badge is earned through real progress, the focus timer
// (survives a reload, logs minutes to the activity table), "explain it back" notes, keyboard shortcuts.
import { expect, test, type Page } from '@playwright/test';
import { idb } from './helpers';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const compact = (page: Page) => page.getByTestId('compact');
const toast = (page: Page) => page.locator('.dl-toast');

async function open(page: Page) {
  await page.goto('test/delight/');
  await expect(compact(page).locator('.dl-level-name')).toHaveText('Level 1 Seed');
}

test('XP and badges start at zero, then an "explain it back" note earns a badge and a calm celebration', async ({ page }) => {
  await open(page);
  await expect(compact(page).locator('.dl-xp')).toHaveText('0 XP');
  await expect(compact(page).getByText('0 of 15')).toBeVisible();
  await expect(page.getByTestId('full').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await page.waitForTimeout(400); // the celebration host records the badges already earned (none)

  const idea = page.getByLabel('The idea in simple words');
  await idea.scrollIntoViewIfNeeded();
  await idea.fill('A model is a select statement in a file. dbt runs it in the right order, thanks to ref().');
  await expect(page.getByText(/Saved in this browser/)).toBeVisible();

  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toContainText('Badge earned');
  await expect(toast(page)).toContainText('Explained it back');
  await expect(toast(page)).not.toHaveAttribute('data-anim', /.*/); // the e2e config asks for reduced motion
  await expect(compact(page).getByText('1 of 15')).toBeVisible();
  await expect(compact(page).locator('.dl-xp')).toHaveText('15 XP');

  const notes = await idb<{ id: string; kind: string; ref: string; text: string }>(page, 'notes');
  expect(notes).toEqual([expect.objectContaining({ id: 'explain:ch07', kind: 'explain', ref: 'ch07' })]);
  expect(notes[0].text).toContain('## The idea in simple words\nA model is a select statement');

  await toast(page).getByRole('button', { name: 'Close this message' }).click();
  await expect(toast(page)).toHaveCount(0);
  // a reload shows the saved text and does not celebrate the same badge again
  await page.reload();
  await expect(compact(page).getByText('1 of 15')).toBeVisible();
  await page.getByLabel('The idea in simple words').scrollIntoViewIfNeeded();
  await expect(page.getByLabel('The idea in simple words')).toHaveValue(/A model is a select statement/);
  await page.waitForTimeout(800);
  await expect(toast(page)).toHaveCount(0);
});

test('"Compare with the book" shows the chapter\'s own box', async ({ page }) => {
  await open(page);
  const btn = page.getByRole('button', { name: 'Compare with the book' }).first();
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(page.getByRole('button', { name: 'Hide the book' }).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.dl-explain-book .mc-callout').first()).toContainText('The idea in 3 sentences');
});

test.describe('celebrations with motion', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('a node lights up; a custom celebration closes by itself', async ({ page }) => {
    await page.clock.install();
    await open(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('mc:celebrate', { detail: { title: 'Chapter 7 done', text: 'Take the quiz with the book closed.' } })));
    await expect(toast(page)).toContainText('Chapter 7 done');
    await expect(toast(page)).toHaveAttribute('data-anim', '');
    await page.clock.fastForward('00:10');
    await expect(toast(page)).toHaveCount(0);
  });
});

test.describe('focus timer', () => {
  test('25/5 by default, sound and notifications off, survives a reload, logs the minutes', async ({ page }) => {
    await page.clock.install();
    await open(page);
    const launcher = page.getByRole('button', { name: /^Focus timer/ });
    await launcher.click();
    const panel = page.getByRole('dialog', { name: 'Focus timer' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('timer')).toHaveText('25:00');
    await panel.getByText('Timer settings').click();
    await expect(panel.getByLabel(/Play a soft sound/)).not.toBeChecked();
    await expect(panel.getByLabel(/Show a notification/)).not.toBeChecked();
    await expect(panel.locator('.dl-pomo-settings select').nth(0)).toHaveValue('25');
    await expect(panel.locator('.dl-pomo-settings select').nth(1)).toHaveValue('5');

    await panel.getByRole('button', { name: 'Start 25 minutes of focus' }).click();
    await expect(panel.getByText(/Working on: This page/)).toBeVisible();
    await page.clock.fastForward('10:00');
    await expect(panel.getByRole('timer')).toHaveText(/^15:00|^14:5\d/);

    // another page load: the timer goes on from the saved state
    await page.reload();
    await expect(launcher).toHaveAttribute('aria-label', /focus, 1[45] minutes left/);
    await page.clock.fastForward('16:00');
    await expect(launcher).toHaveAttribute('aria-label', /break, [45] minutes? left/);
    await expect.poll(async () => (await idb<{ date: string; minutes: number }>(page, 'activity')).find((a) => a.date === today())?.minutes).toBe(25);
    await page.clock.fastForward('05:00');
    await expect(launcher).toHaveAttribute('aria-label', 'Focus timer');
    // the 25 minutes were logged once, even after the break
    expect((await idb<{ date: string; minutes: number }>(page, 'activity')).find((a) => a.date === today())?.minutes).toBe(25);
  });

  test('stop counts the whole minutes; Escape closes and gives the focus back', async ({ page }) => {
    await page.clock.install();
    await open(page);
    const launcher = page.getByRole('button', { name: /^Focus timer/ });
    await launcher.click();
    const panel = page.getByRole('dialog', { name: 'Focus timer' });
    await panel.getByRole('button', { name: /^Start/ }).click();
    await page.clock.fastForward('12:30');
    await panel.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(async () => (await idb<{ date: string; minutes: number }>(page, 'activity')).find((a) => a.date === today())?.minutes).toBe(12);
    await expect(panel.getByText(/12 minutes studied today/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();
  });

  test("offers today's mission from the Today page", async ({ page }) => {
    await open(page);
    await page.evaluate((d) => localStorage.setItem('mc:mission', JSON.stringify({ date: d, items: [{ title: '7.3 The ref function', minutes: 20, href: '/model-citizen/learn/ch07/ch07-s3/', kind: 'read' }] })), today());
    await page.getByRole('button', { name: /^Focus timer/ }).click();
    const select = page.getByRole('dialog', { name: 'Focus timer' }).getByLabel('What will you work on?');
    await expect(select.locator('optgroup[label="Today\'s mission"] option')).toHaveCount(1);
    expect(await select.locator('optgroup[label="Today\'s mission"] option').allTextContents()).toEqual(['7.3 The ref function (20 min)']);
    await expect(select).toHaveValue('m0');
  });
});

test.describe('keyboard shortcuts', () => {
  test('"?" opens the list, Esc closes it; not while typing', async ({ page }) => {
    await open(page);
    await page.locator('h1').click();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    for (const t of ['Search the course', 'DOMC: answer YES or NO', 'Show the answer', 'Run the query, or compile the template', 'Go to the next step']) await expect(dialog).toContainText(t);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const idea = page.getByLabel('The idea in simple words');
    await idea.scrollIntoViewIfNeeded();
    await idea.click();
    await page.keyboard.type('Why? ');
    await expect(idea).toHaveValue('Why? ');
    await expect(dialog).toBeHidden();
  });

  test('J and K move between the steps of a lesson', async ({ page }) => {
    await open(page);
    await page.locator('h1').click();
    await page.keyboard.press('j');
    await expect(page.getByRole('heading', { name: 'First step' })).toBeFocused();
    await page.keyboard.press('j');
    await expect(page.getByRole('heading', { name: 'Second step' })).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.getByRole('heading', { name: 'First step' })).toBeFocused();
  });
});
