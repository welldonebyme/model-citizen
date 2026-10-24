// Friend challenge (/practice/challenge/): a short link gives two people the same questions in the same
// order, each in their own browser; the score stays local and can be copied as text.
import { expect, test, type Page } from '@playwright/test';

async function stems(page: Page, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await expect(page.locator('#qz-q-h')).toHaveText(new RegExp(`Question ${i + 1} of ${n}`));
    out.push((await page.locator('.qz-q').first().innerText()).slice(0, 160));
    if (i + 1 < n) await page.getByRole('button', { name: 'Skip for now' }).click();
  }
  return out;
}

async function answerAll(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: `Question ${i + 1}`, exact: false }).first().click();
    const show = page.getByRole('button', { name: 'I do not know: show the answer' });
    if (await show.count()) await show.click();
    else for (let k = 0; k < 8 && !(await page.getByRole('region', { name: 'Feedback' }).count()); k++) await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Feedback' })).toBeVisible();
  }
  await page.getByRole('button', { name: /See your score|Next question/ }).last().click();
}

test('the same questions in the same order in another browser, a local score and a share text', async ({ page, browser }) => {
  await page.goto('practice/challenge/');
  await expect(page.getByText(/questions match/)).toBeVisible();
  await page.getByRole('radio', { name: '5', exact: true }).check();
  await page.getByRole('checkbox', { name: /^7 Models/ }).check();
  await expect(page.locator('.dr-count')).toHaveText(/questions match\. The challenge takes 5 of them/);
  await page.getByRole('button', { name: 'Create the challenge' }).click();
  await expect(page).toHaveURL(/\?c=[A-Za-z0-9_-]{23}$/);
  const link = page.url();
  await expect(page.getByRole('heading', { name: '5 questions' })).toBeVisible();
  await expect(page.locator('.ch-facts')).toContainText('Chapter 7');
  await expect(page.getByLabel('Challenge link')).toHaveValue(link);

  await page.getByRole('button', { name: 'Start the challenge' }).click();
  const mine = await stems(page, 5);

  const other = await browser.newContext();
  const friend = await other.newPage();
  await friend.goto(link);
  await friend.getByRole('button', { name: 'Start the challenge' }).click();
  expect(await stems(friend, 5)).toEqual(mine);
  await other.close();

  await answerAll(page, 5);
  await expect(page.getByRole('heading', { name: /^Your challenge score: \d of 5/ })).toBeVisible();
  const share = await page.getByLabel('Share your score').inputValue();
  expect(share).toMatch(/^Model Citizen challenge: I scored \d of 5 \(\d+%\) in /);
  expect(share).toContain(link + '&s=');
  expect(share).not.toContain('!');
  await page.getByLabel(/Your first name in the text/).fill('Adnane');
  await expect(page.getByLabel('Share your score')).toHaveValue(/Adnane scored/);

  // the friend opens the shared link: the sender's score is shown
  const url = share.split(': ').pop()!.trim();
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(url);
  await expect(p2.locator('.ch-sender')).toContainText(/The person who sent you this link scored \d of 5/);
  await ctx2.close();

  // results stay in this browser
  await page.getByRole('button', { name: 'Back to the challenge' }).click();
  await expect(page.getByRole('heading', { name: 'Your results for this challenge' })).toBeVisible();
});

test('a damaged link says so and offers a new challenge', async ({ page }) => {
  await page.goto('practice/challenge/?c=not-a-real-code');
  await expect(page.getByRole('heading', { name: 'This challenge link does not work' })).toBeVisible();
  await page.getByRole('button', { name: 'Create a new challenge' }).click();
  await expect(page.getByRole('button', { name: 'Create the challenge' })).toBeVisible();
});

test('filters that match nothing cannot make a challenge', async ({ page }) => {
  await page.goto('practice/challenge/');
  await expect(page.getByText(/questions match/)).toBeVisible();
  await page.getByRole('checkbox', { name: /^0 Start Here/ }).check(); // Chapter 0 has no hotspot question
  await page.getByRole('checkbox', { name: 'Hotspot' }).check();
  await expect(page.locator('.dr-count')).toHaveText('No question matches these choices.');
  await expect(page.getByRole('button', { name: 'Create the challenge' })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Create the challenge' }).click({ force: true }); // still reachable, it explains why
  await expect(page.getByRole('alert')).toHaveText('No question matches these choices. Remove a filter.');
  await expect(page).not.toHaveURL(/\?c=/);
});
