/** Test helpers: load a tag's DAG and extras from disk. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Project } from '../../src/lib/selector/project';
import type { Dag, Extras } from '../../src/lib/selector/types';

export const SITE = fileURLToPath(new URL('../../', import.meta.url));
export const ACADEMY = fileURLToPath(new URL('../../../', import.meta.url));

const cache = new Map<string, Project>();

const VARIANTS = `${SITE}tests/selector/fixtures/variants/`;

/** tag = a tag (ch16), or a variant name exported by tools/export_variants.py (ch16+ch16-two-parent-test, ea74932) */
function dagPath(key: string, tag: string): string {
  const v = `${VARIANTS}${key}-${tag}.json`;
  return existsSync(v) ? v : `${SITE}src/generated/dag/${key}-${tag}.json`;
}
function extrasPath(key: string, tag: string): string {
  const v = `${VARIANTS}extras-${key}-${tag}.json`;
  return existsSync(v) ? v : `${SITE}src/lib/selector/data/extras-${key}-${tag}.json`;
}

export function hasTag(key: string, tag: string): boolean {
  return existsSync(dagPath(key, tag));
}

export function loadProject(key: string, tag: string, withExtras = true): Project {
  const id = `${key}-${tag}-${withExtras}`;
  let p = cache.get(id);
  if (p) return p;
  const dag = JSON.parse(readFileSync(dagPath(key, tag), 'utf8')) as Dag;
  const ex = extrasPath(key, tag);
  const extras = withExtras && existsSync(ex) ? (JSON.parse(readFileSync(ex, 'utf8')) as Extras) : null;
  p = new Project(dag, extras);
  cache.set(id, p);
  return p;
}

export function lsJsonFixture(key: string, tag: string): Record<string, string> {
  return JSON.parse(readFileSync(`${SITE}tests/selector/fixtures/lsjson-${key}-${tag}.json`, 'utf8'));
}
