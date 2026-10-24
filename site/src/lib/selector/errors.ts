/** Errors with the same title and message dbt 1.11 prints ("Encountered an error:" block). */

export type ErrorKind = 'Runtime Error' | 'Internal Error' | 'Compilation Error' | 'Usage' | 'Unhandled' | 'Shell';

export class DbtError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly hint?: string) {
    super(message);
  }
  /** The lines dbt prints after "Encountered an error:" (or the click usage block). */
  lines(command = 'ls'): string[] {
    if (this.kind === 'Usage') {
      return [`Usage: dbt ${command} [OPTIONS]`, `Try 'dbt ${command} --help' for help.`, '', `Error: ${this.message}`];
    }
    if (this.kind === 'Unhandled' || this.kind === 'Shell') return this.message.split('\n');
    return [this.kind, ...this.message.split('\n').map((l) => `  ${l}`)];
  }
  get exitCode(): number {
    return this.kind === 'Shell' ? 1 : 2;
  }
}

export const runtimeError = (msg: string, hint?: string) => new DbtError('Runtime Error', msg, hint);
export const internalError = (msg: string, hint?: string) => new DbtError('Internal Error', msg, hint);
export const usageError = (msg: string, hint?: string) => new DbtError('Usage', msg, hint);

/** Python repr() of a list of strings: ['a', 'b'] */
export function pyListRepr(items: string[]): string {
  return `[${items.map((s) => pyStrRepr(s)).join(', ')}]`;
}

export function pyStrRepr(s: string): string {
  if (s.includes("'") && !s.includes('"')) return `"${s}"`;
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
