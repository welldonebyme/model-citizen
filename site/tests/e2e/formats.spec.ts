// Every question format, answered with the mouse and with the keyboard only (real Chapter 7 questions).
import { expect, test, type Page } from '@playwright/test';
import { drag, feedback, startAtHeading, tabTo } from './helpers';

const open = async (page: Page, qid: string) => {
  await page.goto(`quiz/ch07/?q=${qid}`);
  await expect(page.locator('#qz-q-h')).toBeVisible();
};
const check = (page: Page) => page.getByRole('button', { name: 'Check answer' });
const expectCorrect = async (page: Page) => {
  await expect(feedback(page).getByRole('heading', { name: 'Correct', exact: true })).toBeVisible();
};

test.describe('multiple choice', () => {
  test('mouse', async ({ page }) => {
    await open(page, 'q-ch07-01');
    await page.getByText('analytics.crm.accounts_v2', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /^B\./ })).toBeChecked();
    await check(page).click();
    await expectCorrect(page);
    await expect(page.getByText('Your answer, correct')).toBeVisible();
  });
  test('keyboard only', async ({ page }) => {
    await open(page, 'q-ch07-01');
    await startAtHeading(page);
    await tabTo(page, page.getByRole('radio', { name: /^A\./ }));
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: /^B\./ })).toBeChecked();
    await tabTo(page, check(page));
    await page.keyboard.press('Enter');
    await expectCorrect(page);
    await expect(page.getByRole('heading', { name: 'Correct', exact: true })).toBeFocused();
  });
});

test.describe('multiple select', () => {
  test('mouse, and never more than N', async ({ page }) => {
    await open(page, 'q-ch07-05');
    await expect(page.getByText('Choose 2.')).toBeVisible();
    await page.getByRole('checkbox', { name: /^A\./ }).click();
    await page.getByRole('checkbox', { name: /^C\./ }).click();
    await page.locator('label.qz-choice').nth(3).scrollIntoViewIfNeeded();
    const d = (await page.locator('label.qz-choice').nth(3).boundingBox())!; // D: a third choice is refused
    await page.mouse.click(d.x + d.width / 2, d.y + d.height / 2);
    await expect(page.getByRole('checkbox', { name: /^D\./ })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /^D\./ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('You already chose 2.')).toBeVisible();
    await expect(page.getByText('2 of 2 chosen.')).toBeVisible();
    await check(page).click();
    await expectCorrect(page);
  });
  test('keyboard only', async ({ page }) => {
    await open(page, 'q-ch07-05');
    await startAtHeading(page);
    await tabTo(page, page.getByRole('checkbox', { name: /^A\./ }));
    await page.keyboard.press('Space');
    await tabTo(page, page.getByRole('checkbox', { name: /^C\./ }));
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: /^C\./ })).toBeChecked();
    await tabTo(page, check(page));
    await page.keyboard.press('Enter');
    await expectCorrect(page);
  });
});

test.describe('fill in the blank', () => {
  test('mouse', async ({ page }) => {
    await open(page, 'q-ch07-02');
    await page.getByRole('textbox', { name: 'Your answer for the blank' }).click();
    await page.keyboard.type('Table ');
    await check(page).click();
    await expectCorrect(page);
  });
  test('keyboard only, a wrong answer shows the accepted one', async ({ page }) => {
    await open(page, 'q-ch07-02');
    await startAtHeading(page);
    await tabTo(page, page.getByRole('textbox', { name: 'Your answer for the blank' }));
    await page.keyboard.type('tabel');
    await page.keyboard.press('Enter');
    await expect(feedback(page).getByRole('heading', { name: 'Not correct' })).toBeVisible();
    await expect(page.getByText('Accepted answer:')).toBeVisible();
  });
});

test.describe('hotspot', () => {
  test('mouse', async ({ page }) => {
    await open(page, 'q-ch07-03');
    await page.getByRole('button', { name: 'Line 5', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Line 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await check(page).click();
    await expectCorrect(page);
  });
  test('keyboard only', async ({ page }) => {
    await open(page, 'q-ch07-03');
    await startAtHeading(page);
    await tabTo(page, page.getByRole('button', { name: 'Line 1', exact: true }));
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Line 5', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('You chose line 5.')).toBeVisible();
    await tabTo(page, check(page));
    await page.keyboard.press('Enter');
    await expectCorrect(page);
  });
});

test.describe('matching', () => {
  const pairs: [string, string][] = [['1', 'b'], ['2', 'c'], ['3', 'd'], ['4', 'a']];
  test('mouse (lines on wide screens, lists on phones)', async ({ page, isMobile }) => {
    await open(page, 'q-ch07-06');
    for (const [l, r] of pairs) {
      if (isMobile) await page.getByLabel(new RegExp(`^Match for ${l}:`)).selectOption(r);
      else await drag(page, page.locator(`[data-dot-left="${l}"]`), page.locator(`[data-right-id="${r}"]`), { dx: 60 });
    }
    for (const [l, r] of pairs) await expect(page.getByLabel(new RegExp(`^Match for ${l}:`))).toHaveValue(r);
    if (!isMobile) await expect(page.locator('.qz-match-lines path')).toHaveCount(4);
    await check(page).click();
    await expectCorrect(page);
  });
  test('click a dot, then a target (tap alternative)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the dots are hidden on narrow screens; the lists are used there');
    await open(page, 'q-ch07-06');
    await page.locator('[data-dot-left="1"]').click();
    await page.getByRole('button', { name: 'Match 1 here' }).nth(1).click();
    await expect(page.getByLabel(/^Match for 1:/)).toHaveValue('b');
  });
  test('keyboard only', async ({ page }) => {
    await open(page, 'q-ch07-06');
    await startAtHeading(page);
    for (const [l, r] of pairs) {
      const select = page.getByLabel(new RegExp(`^Match for ${l}:`));
      await tabTo(page, select);
      await page.keyboard.type(r); // type-ahead on the closed list: "b. Declares the raw Stripe tables"
      await expect(select).toHaveValue(r);
    }
    await tabTo(page, check(page));
    await page.keyboard.press('Enter');
    await expectCorrect(page);
  });
});

test.describe('build list', () => {
  const texts = async (page: Page) => page.locator('.qz-order-item .qz-letter').allTextContents();
  test('mouse drag', async ({ page }) => {
    await open(page, 'q-ch07-07');
    const handle = (id: string) => page.locator(`[data-item="${id}"] .qz-handle`);
    const item = (id: string) => page.locator(`[data-item="${id}"]`);
    await drag(page, handle('B'), item('A'), { dy: 4 });
    expect(await texts(page)).toEqual(['B', 'A', 'C', 'D', 'E']);
    await drag(page, handle('D'), item('A'), { dy: 4 });
    expect(await texts(page)).toEqual(['B', 'D', 'A', 'C', 'E']);
    await drag(page, handle('E'), item('C'), { dy: 4 });
    expect(await texts(page)).toEqual(['B', 'D', 'A', 'E', 'C']);
    await check(page).click();
    await expectCorrect(page);
  });
  test('keyboard only (arrow keys on the handle, and the Move buttons)', async ({ page }) => {
    await open(page, 'q-ch07-07');
    await startAtHeading(page);
    await tabTo(page, page.locator('[data-item="B"] .qz-handle'));
    await page.keyboard.press('ArrowUp');                         // B A C D E
    await expect(page.locator('[data-item="B"] .qz-handle')).toBeFocused();
    await tabTo(page, page.locator('[data-item="D"] [data-ctl="up"]'));
    await page.keyboard.press('Enter');                           // B A D C E
    await page.keyboard.press('Enter');                           // B D A C E (focus stays on the moved item)
    await tabTo(page, page.locator('[data-item="E"] .qz-handle'));
    await page.keyboard.press('ArrowUp');                         // B D A E C
    expect(await texts(page)).toEqual(['B', 'D', 'A', 'E', 'C']);
    await tabTo(page, check(page));
    await page.keyboard.press('Enter');
    await expectCorrect(page);
  });
  test('"Use this order" answers without moving', async ({ page }) => {
    await open(page, 'q-ch07-07');
    await page.getByRole('button', { name: 'Use this order' }).click();
    await expect(page.getByText('Your order is saved.')).toBeVisible();
    await check(page).click();
    await expect(feedback(page).getByRole('heading', { name: 'Not correct' })).toBeVisible();
  });
});

test.describe('DOMC', () => {
  test('mouse: one option at a time, early end, extra option', async ({ page }) => {
    await open(page, 'q-ch07-08');
    await expect(page.getByText('Option A', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByText('Option B', { exact: true })).toBeVisible();
    await expect(page.getByText('It creates an edge between two nodes of the DAG.')).toHaveCount(0); // judged option hidden
    await page.getByRole('button', { name: 'Yes' }).click();
    // A and B are the only YES options: the question is decided; one extra (unscored) option appears
    await expect(page.getByText('Option C', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expectCorrect(page);
    await expect(page.getByText('Extra option, not scored: you answered YES')).toBeVisible();
    await expect(page.getByText('Not shown: the question ended before this option.')).toBeVisible();
  });
  test('keyboard only: Y and N keys', async ({ page }) => {
    await open(page, 'q-ch07-08');
    await startAtHeading(page);
    await page.keyboard.press('y');
    await expect(page.getByText('Option B', { exact: true })).toBeVisible();
    await page.keyboard.press('n'); // B is YES: wrong, the question ends (then the extra option)
    await expect(page.getByText('Option C', { exact: true })).toBeVisible();
    await page.keyboard.press('n');
    await expect(feedback(page).getByRole('heading', { name: 'Not correct' })).toBeVisible();
  });
});
