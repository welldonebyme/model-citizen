/** Browser loader: the DAG and the extras of a tag are separate chunks, fetched only when the tag is opened. */
import index from '../../generated/dag/index.json';
import { Project } from './project';
import type { Dag, Extras } from './types';

const dagFiles = import.meta.glob<{ default: Dag }>('../../generated/dag/*-*.json');
const extraFiles = import.meta.glob<{ default: Extras }>('./data/extras-*.json');

export interface TagInfo {
  id: string;
  key: 'jaffle' | 'shopflow';
  tag: string;
  nodes: number;
  sources: number;
  exposures: number;
  found: string | null;
  selectors: string[];
}

type IndexFile = { tags: Record<string, { key: string; tag: string; nodes: number; sources: number; exposures: number; found_line: string | null; selectors: string[] }> };

export const TAGS: TagInfo[] = Object.entries((index as IndexFile).tags)
  .map(([id, t]) => ({ id, key: t.key as TagInfo['key'], tag: t.tag, nodes: t.nodes, sources: t.sources, exposures: t.exposures, found: t.found_line, selectors: t.selectors }))
  .filter((t) => t.nodes + t.sources > 0);

const cache = new Map<string, Promise<Project>>();

export function loadProject(id: string): Promise<Project> {
  let p = cache.get(id);
  if (!p) {
    const dagLoader = dagFiles[`../../generated/dag/${id}.json`];
    const exLoader = extraFiles[`./data/extras-${id}.json`];
    if (!dagLoader) return Promise.reject(new Error(`No data for ${id}`));
    p = Promise.all([dagLoader(), exLoader ? exLoader() : Promise.resolve(null)]).then(([d, e]) => new Project(d.default, e ? e.default : null));
    cache.set(id, p);
  }
  return p;
}
