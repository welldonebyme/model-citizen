// Shared types of "dbt in the browser": presets (public/presets/dbt/index.json), terminal output, worker protocol.

export type PresetStep = { run: string } | { checkout: string; bundle: string };

export interface Preset {
  id: string;              // "ch07-start"
  project: string;         // "jaffle"
  chapter: number;         // 7 (26 for the capstone)
  milestone?: string;      // "m05" (capstone only)
  label: string;           // "Chapter 7", "Capstone m05"
  state: 'start' | 'end';
  title: string;           // "Chapter 7, start of the labs"
  chapterTitle: string;    // "Models, ref, source and the DAG"
  filesTag: string | null; // "ch06" (null: no project yet)
  filesBundle: string | null;
  profile: string;         // key of ProjectInfo.profiles
  packages: boolean;
  python: boolean;
  cwd: string;             // "~/dbt-course/jaffle_dbt"
  summary: string[];
  steps: PresetStep[];
  hash: string;
}

export interface ProjectInfo {
  title: string;
  dir: string;             // "jaffle_dbt"
  practiceDir: string;     // "practice"
  database: string;        // "practice.duckdb"
  practiceBundle: string;
  packagesBundle: string;
  packages: { name: string; package: string; version: string }[];
  profiles: Record<string, string>;
  onMachine?: string;
}

export interface PresetIndex {
  schema: number;
  projects: Record<string, ProjectInfo>;
  presets: Preset[];
}

/** A bundle of files: text, or { b64 } for bytes. */
export interface Bundle {
  files: Record<string, string | { b64: string }>;
  packages?: { name: string; package: string; version: string }[];
  tag?: string;
}

/** A sandbox message: not printed by a real program, shown with its own style in the terminal. */
export interface Note {
  text: string;
  tone?: 'info' | 'warn' | 'error' | 'ok';
  link?: { href: string; label: string };
  openFile?: string;       // a .html file of the workspace the learner can open in a new tab
}

export interface Io {
  out(line: string): void;
  err(line: string): void;
  note(n: Note): void;
  /** A command shown before its output (preparation log, chained commands). */
  cmd?(line: string): void;
  /** Ask the terminal to clear the screen. */
  clear?(): void;
}

export interface ExecContext {
  cols: number;
  /** Link to the lab's on-machine steps (shown by `git`). */
  onMachineHref?: string;
}

export interface FileEntry {
  name: string;
  path: string;            // absolute path in the virtual file system
  dir: boolean;
  size: number;
  mtime: number;
}

export interface EngineManifest {
  id: string;
  versions: { pyodide: string; python: string; dbtCore: string; dbtDuckdb: string; duckdb: string };
  indexPath: string;
  lockPath: string;
  groups: Record<string, { files: number; size: number; gzip: number }>;
  files: { path: string; group: string; size: number; gzip: number; sha256: string }[];
}

export type BootPhase = 'download' | 'python' | 'packages' | 'dbt' | 'workspace' | 'prepare' | 'ready';

export interface Progress {
  phase: BootPhase;
  label: string;
  loaded?: number;         // bytes
  total?: number;          // bytes
  step?: number;           // preparation step (1-based)
  steps?: number;
}

export interface WorkspaceMeta {
  ws: string;              // workspace id, e.g. "jaffle-ch07"
  preset: string;          // preset id it was made from
  presetHash: string;
  state: 'preparing' | 'ready';
  cwd: string;
  env: Record<string, string>;
  history: string[];
  createdAt: number;
  updatedAt: number;
  bytes: number;
  files: number;
}

/** Messages main thread -> worker. Every request has an id; the worker answers { id, ok, result | error }. */
export type WorkerRequest =
  | { id: number; type: 'boot'; engineBase: string; presetsBase: string; manifest: EngineManifest; presets: PresetIndex }
  | { id: number; type: 'open'; ws: string; preset: string; mode: 'continue' | 'reset' }
  | { id: number; type: 'exec'; line: string; ctx: ExecContext }
  | { id: number; type: 'list'; dir: string }
  | { id: number; type: 'read'; path: string }
  | { id: number; type: 'write'; path: string; text: string }
  | { id: number; type: 'export' }
  | { id: number; type: 'workspaces' }
  | { id: number; type: 'delete-workspace'; ws: string }
  | { id: number; type: 'prep-log' };

export type WorkerEvent =
  | { type: 'progress'; progress: Progress }
  | { type: 'line'; id: number; kind: 'out' | 'err'; text: string }
  | { type: 'note'; id: number; note: Note }
  | { type: 'cmd'; id: number; text: string }
  | { type: 'clear'; id: number }
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: string };
