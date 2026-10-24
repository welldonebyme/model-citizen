// Drive the dbt workspace from Playwright: start the engine, type commands, read their output.
import { expect, type Page } from '@playwright/test';

export const BOOT_TIMEOUT = 240_000;
export const CMD_TIMEOUT = 240_000;

export interface Captured { command: string; lines: string[]; code: number | null }

/** Open /labs/dbt/ on a preset, press Start, wait until the terminal accepts commands. Returns the boot info. */
export async function startWorkspace(page: Page, preset: string) {
  await page.goto(`labs/dbt/?preset=${preset}`);
  const start = page.getByRole('button', { name: 'Start dbt in your browser' });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  await expect(page.locator('.t-input:not([readonly])')).toBeVisible({ timeout: BOOT_TIMEOUT });
  return page.evaluate(() => (window as unknown as { __mcDbt: { info: unknown } }).__mcDbt.info) as Promise<{
    versions: Record<string, string>; timings: Record<string, number>; resources?: { files: number; transferBytes: number; decodedBytes: number }; cold: boolean; wallMs: number;
  }>;
}

/** Type one command, press Enter, wait for it to finish, return its output lines (dbt/duckdb output only, no notes). */
export async function run(page: Page, command: string, timeout = CMD_TIMEOUT): Promise<Captured> {
  const input = page.locator('.t-input');
  const before = await page.locator('.t-block').count();
  await input.fill(command);
  await input.press('Enter');
  await expect(page.locator('.t-block')).toHaveCount(before + 1, { timeout: 10_000 }).catch(() => {});
  await expect(page.locator('.t-input:not([readonly])')).toBeVisible({ timeout });
  return page.evaluate((cmd) => {
    const blocks = [...document.querySelectorAll('.t-block')];
    const b = [...blocks].reverse().find((x) => x.querySelector('.t-typed')?.textContent === cmd);
    if (!b) return { command: cmd, lines: [], code: null };
    const lines = [...b.querySelectorAll('.t-line[data-kind="out"], .t-line[data-kind="err"]')].map((l) => (l.textContent ?? '').replace(/ /g, ''));
    const code = b.getAttribute('data-code');
    return { command: cmd, lines, code: code === '' || code === null ? null : Number(code) };
  }, command);
}

export async function notes(page: Page): Promise<string[]> {
  return page.locator('.t-line[data-kind="note"]').allTextContents();
}
