import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RESULTS = fileURLToPath(new URL('../../test-results/labs-reports/', import.meta.url));
export const SERVER = `http://127.0.0.1:${process.env.LABS_PORT ?? 4410}`;

export function writeReport(name: string, data: unknown) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(RESULTS + name, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
}

/** Console errors and uncaught page errors (DuckDB logs failed queries with console.log: those are fine). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

export function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

export const foreign = (urls: string[]) => urls.filter((u) => !u.startsWith(SERVER + '/model-citizen/') && !u.startsWith('data:') && !u.startsWith('blob:'));

/** Paths the static server served since the last clear (includes worker and service-worker requests). */
export async function served(): Promise<string[]> {
  const r = await fetch(`${SERVER}/__requests`);
  return ((await r.json()) as { path: string }[]).map((x) => x.path);
}
export async function clearServed(): Promise<void> {
  await fetch(`${SERVER}/__requests`, { method: 'POST' });
}

export async function sqlReady(page: Page) {
  await expect(page.getByTestId('engine-status')).toHaveAttribute('data-phase', 'ready', { timeout: 90_000 });
}
export async function pyReady(page: Page) {
  await page.waitForFunction(() => (globalThis as Record<string, unknown>).__mcPyInfo, null, { timeout: 90_000 });
}

/** Replace the text of a CodeMirror editor (by its test id). */
export async function setEditor(page: Page, testId: string, text: string) {
  await page.evaluate(([id, t]) => {
    const el = document.querySelector(`[data-editor="${id}"]`) as unknown as { __mcEditor: { setValue(t: string): void } } | null;
    if (!el?.__mcEditor) throw new Error(`editor ${id} not mounted`);
    el.__mcEditor.setValue(t);
  }, [testId, text] as const);
}
export async function getEditor(page: Page, testId: string): Promise<string> {
  return page.evaluate((id) => (document.querySelector(`[data-editor="${id}"]`) as unknown as { __mcEditor: { getValue(): string } }).__mcEditor.getValue(), testId);
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
