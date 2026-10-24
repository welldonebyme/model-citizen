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
// Options are shown in a seeded order with new letters (review F1): pick them by their text.
const RIGHT_MC = /^[A-D]\. analytics\.crm\.accounts_v2/;          // q-ch07-01
const MS_RIGHT = [/^[A-E]\. Renaming id/, /^[A-E]\. Converting an amount/]; // q-ch07-05

test.describe('multiple choice', () => {
  test('mouse', async ({ page }) => {
    await open(page, 'q-ch07-01');
    await page.getByText('analytics.crm.accounts_v2', { exact: true }).click();
    await expect(page.getByRole('radio', { name: RIGHT_MC })).toBeChecked();
    await check(page).click();
    await expectCorrect(page);
    await expect(page.getByText('Your answer, correct')).toBeVisible();
    // the explanation names the letter the learner saw for the right option
    const letter = (await page.getByRole('radio', { name: RIGHT_MC }).getAttribute('value'))!;
    await expect(feedback(page).locator('.qz-expl strong').first()).toHaveText(`${letter}.`);
  });
  test('keyboard only', async ({ page }) => {
    await open(page, 'q-ch07-01');
    await startAtHeading(page);
    await tabTo(page, page.getByRole('radio', { name: /^A\./ }));
    await page.keyboard.press('Space');
    for (let i = 0; i < 4 && !(await page.getByRole('radio', { name: RIGHT_MC }).isChecked()); i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: RIGHT_MC })).toBeChecked();
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
    await page.getByRole('checkbox', { name: MS_RIGHT[0] }).click();
    await page.getByRole('checkbox', { name: MS_RIGHT[1] }).click();
    const third = page.locator('label.qz-choice', { hasText: 'Aggregating payments' }); // a third choice is refused
    await third.scrollIntoViewIfNeeded();
    const d = (await third.boundingBox())!;
    await page.mouse.click(d.x + d.width / 2, d.y + d.height / 2);
    await expect(page.getByRole('checkbox', { name: /Aggregating payments/ })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Aggregating payments/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('You already chose 2.')).toBeVisible();
    await expect(page.getByText('2 of 2 chosen.')).toBeVisible();
    await check(page).click();
    await expectCorrect(page);
  });
  test('keyboard only', async ({ page }) => {
    await open(page, 'q-ch07-05');
    await startAtHeading(page);
    // the two right options, in the order they are shown (Tab only goes forward)
    const boxes = await Promise.all(MS_RIGHT.map(async (r) => ({ r, letter: (await page.getByRole('checkbox', { name: r }).getAttribute('value'))! })));
    boxes.sort((a, b) => a.letter.localeCompare(b.letter));
    for (const { r } of boxes) {
      await tabTo(page, page.getByRole('checkbox', { name: r }));
      await page.keyboard.press('Space');
      await expect(page.getByRole('checkbox', { name: r })).toBeChecked();
    }
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
  const KEY = ['B', 'D', 'A', 'E', 'C']; // q-ch07-07
  const texts = async (page: Page) => page.locator('.qz-order-item .qz-letter').allTextContents();
  test('starts in a seeded order that is not the answer (review E10)', async ({ page }) => {
    await open(page, 'q-ch07-07');
    await expect(page.locator('.qz-order-item')).toHaveCount(5);
    const start = await texts(page);
    expect([...start].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(start).not.toEqual(KEY);
    await page.reload();
    await expect(page.locator('.qz-order-item')).toHaveCount(5);
    expect(await texts(page)).toEqual(start); // the same order after a reload
  });
  test('mouse drag', async ({ page }) => {
    await open(page, 'q-ch07-07');
    const handle = (id: string) => page.locator(`[data-item="${id}"] .qz-handle`);
    const item = (id: string) => page.locator(`[data-item="${id}"]`);
    // put each item of the key in place, from the top: drag it onto the item that is there now
    for (let i = 0; i < KEY.length; i++) {
      const now = await texts(page);
      if (now[i] === KEY[i]) continue;
      await drag(page, handle(KEY[i]), item(now[i]), { dy: 4 });
      expect((await texts(page))[i]).toBe(KEY[i]);
    }
    expect(await texts(page)).toEqual(KEY);
    await check(page).click();
    await expectCorrect(page);
  });
  test('keyboard only (arrow keys on the handle, and the Move buttons)', async ({ page }) => {
    await open(page, 'q-ch07-07');
    await startAtHeading(page);
    for (let i = 0; i < KEY.length; i++) {
      const up = (await texts(page)).indexOf(KEY[i]) - i;
      if (up <= 0) continue;
      if (i % 2 === 0) {
        await tabTo(page, page.locator(`[data-item="${KEY[i]}"] .qz-handle`));
        for (let k = 0; k < up; k++) await page.keyboard.press('ArrowUp');
        await expect(page.locator(`[data-item="${KEY[i]}"] .qz-handle`)).toBeFocused(); // the focus follows the item
      } else {
        await tabTo(page, page.locator(`[data-item="${KEY[i]}"] [data-ctl="up"]`));
        for (let k = 0; k < up; k++) await page.keyboard.press('Enter');
      }
    }
    expect(await texts(page)).toEqual(KEY);
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
  test('keyboard only: Y and N keys, only when the option has the focus (review E15)', async ({ page }) => {
    await open(page, 'q-ch07-08');
    await startAtHeading(page);
    await page.keyboard.press('y'); // the focus is on the heading: nothing is judged
    await expect(page.getByText('Option A', { exact: true })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Yes' }));
    await page.keyboard.press('y');
    await expect(page.getByText('Option B', { exact: true })).toBeVisible();
    await page.keyboard.press('n'); // B is YES: wrong, the question ends (then the extra option)
    await expect(page.getByText('Option C', { exact: true })).toBeVisible();
    await page.keyboard.press('n');
    await expect(feedback(page).getByRole('heading', { name: 'Not correct' })).toBeVisible();
  });
});

test('DOMC: on some questions no extra option follows the decision (review E6)', async ({ page }) => {
  await page.goto('quiz/ch16/?q=q-ch16-08'); // this question's coin shows no extra option
  await expect(page.locator('.qz-q')).toHaveAttribute('data-format', 'domc');
  await page.getByRole('button', { name: 'No', exact: true }).click(); // option A is YES: the question is decided (wrong)
  await expect(feedback(page).getByRole('heading', { name: 'Not correct' })).toBeVisible();
  await expect(page.getByText('Extra option, not scored')).toHaveCount(0);
});

test('fill in the blank: a code blank and a sentence blank both get an input (review E1, Mock 1 Q61)', async ({ page }) => {
  await page.goto('exams/mock1/');
  await page.getByRole('button', { name: 'Start in practice mode' }).click();
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: /^Question 61:/ }).click();
  await expect(page.getByRole('textbox')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Blank 1 of 2' }).fill('state');
  await page.getByRole('textbox', { name: 'Blank 2 of 2' }).fill('manifest.json');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expectCorrect(page);
});

test('hotspot: a question split over two code blocks has every line clickable (review E2, Mock 3 Q40)', async ({ page }) => {
  await page.goto('exams/mock3/');
  await page.getByRole('button', { name: 'Start in exam mode' }).click();
  await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('region', { name: 'All questions' }).getByRole('button', { name: /^Question 40:/ }).click();
  await expect(page.locator('.qz-q button.mc-ln')).toHaveCount(12);
  await page.getByRole('button', { name: 'Line 9', exact: true }).click();
  await expect(page.getByText('You chose line 9.')).toBeVisible();
  await expect(page.locator('.qz-q button.mc-ln').first()).not.toContainText('1|'); // printed numbers are not shown twice (E7)
});
