import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Presses Tab until `target` has the focus (a real keyboard path). Fails after `max` presses.
 * Safari (WebKit) moves to buttons, radios and checkboxes with Option+Tab unless "Press Tab to highlight
 * each item" is on, so WebKit uses Alt+Tab, like a Safari keyboard user.
 */
export async function tabTo(page: Page, target: Locator, max = 60) {
  const key = page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

/** Puts the keyboard focus on the question heading, where a keyboard user starts after "Next". */
export async function startAtHeading(page: Page) {
  const h = page.locator('#qz-q-h');
  await h.focus();
  await expect(h).toBeFocused();
}

/** Reads every row of an IndexedDB table of the site's database. */
export async function idb<T = Record<string, unknown>>(page: Page, table: string): Promise<T[]> {
  return page.evaluate((t) => new Promise<T[]>((resolve, reject) => {
    const open = indexedDB.open('model-citizen');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(t)) { db.close(); resolve([]); return; }
      const req = db.transaction(t, 'readonly').objectStore(t).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result as T[]); };
      req.onerror = () => reject(req.error);
    };
  }), table);
}

/** Drags with the mouse from the centre of one element to a point of another (pointer events, in steps). */
export async function drag(page: Page, from: Locator, to: Locator, opts: { dy?: number; dx?: number } = {}) {
  await from.scrollIntoViewIfNeeded();
  let a = await from.boundingBox();
  let b = await to.boundingBox();
  if (!a || !b) throw new Error('element not visible');
  // scroll so that both ends of the drag are on screen
  const vh = page.viewportSize()!.height;
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  if (top < 0 || bottom > vh) {
    await page.evaluate((d) => window.scrollBy(0, d), (top + bottom) / 2 - vh / 2);
    a = await from.boundingBox();
    b = await to.boundingBox();
    if (!a || !b) throw new Error('element not visible');
  }
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + (opts.dx ?? b.width / 2), b.y + (opts.dy ?? b.height / 2), { steps: 12 });
  await page.mouse.up();
}

export const feedback = (page: Page) => page.getByRole('region', { name: 'Feedback' });

/** Writes rows into an IndexedDB table of the site's database (the page must have opened the database). */
export async function putRows(page: Page, table: string, rows: unknown[]): Promise<void> {
  await page.evaluate(({ t, rs }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('model-citizen');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(t, 'readwrite');
      for (const r of rs) tx.objectStore(t).put(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { t: table, rs: rows });
}
