// The terminal's scrollback, kept outside React so that hundreds of lines per second cost one render per frame.
import { parseAnsi, stripAnsi, type Segment } from './ansi';
import type { Note } from './types';

export type LineKind = 'out' | 'err' | 'note' | 'cmd' | 'sys';
export interface TermLine { id: number; kind: LineKind; text: string; segs?: Segment[]; note?: Note; box?: boolean }
export interface TermBlock {
  id: number;
  prompt?: string;     // "jaffle_dbt $"
  command?: string;    // what was typed
  title?: string;      // a group (for example the preparation log), shown collapsed
  lines: TermLine[];
  running: boolean;
  code?: number;
  version: number;
}

const MAX_LINES = 8000;
const BOX = /[─-╿]/;

export class TerminalModel {
  blocks: TermBlock[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  private scheduled = false;
  private snapshotRef: TermBlock[] = [];

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = () => this.snapshotRef;

  private notify(now = false) {
    const run = () => {
      this.scheduled = false;
      this.snapshotRef = [...this.blocks];
      for (const l of this.listeners) l();
    };
    if (now || typeof requestAnimationFrame === 'undefined') { run(); return; }
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(run);
  }

  start(opts: { prompt?: string; command?: string; title?: string }): TermBlock {
    const b: TermBlock = { id: this.nextId++, ...opts, lines: [], running: true, version: 0 };
    this.blocks.push(b);
    this.trim();
    this.notify(true);
    return b;
  }

  append(b: TermBlock, kind: LineKind, text: string, note?: Note) {
    const line: TermLine = { id: this.nextId++, kind, text: kind === 'note' ? text : stripAnsi(text), note };
    if (kind === 'out' || kind === 'err') {
      line.segs = parseAnsi(text);
      if (BOX.test(text)) line.box = true;
    }
    b.lines.push(line);
    b.version++;
    this.trim();
    this.notify();
  }

  end(b: TermBlock, code?: number) {
    b.running = false;
    b.code = code;
    b.version++;
    this.notify(true);
  }

  clear() {
    this.blocks = this.blocks.filter((b) => b.running);
    this.notify(true);
  }

  private trim() {
    let total = this.blocks.reduce((s, b) => s + b.lines.length, 0);
    while (total > MAX_LINES && this.blocks.length > 1) {
      total -= this.blocks[0].lines.length;
      this.blocks.shift();
    }
  }

  /** Plain text of a block (prompt line + output), as it would be copied from a terminal. */
  static text(b: TermBlock): string {
    const lines: string[] = [];
    if (b.command != null) lines.push(`${b.prompt ?? '$'} ${b.command}`);
    for (const l of b.lines) lines.push(l.kind === 'note' ? `[browser] ${l.text}` : l.kind === 'cmd' ? `$ ${l.text}` : l.text);
    return lines.join('\n');
  }

  allText(): string {
    return this.blocks.map((b) => TerminalModel.text(b)).join('\n');
  }

  lastOutput(): string {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (b.command != null) return b.lines.filter((l) => l.kind === 'out' || l.kind === 'err').map((l) => l.text).join('\n');
    }
    return '';
  }
}
