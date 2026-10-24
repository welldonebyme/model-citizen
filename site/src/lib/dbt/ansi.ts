// ANSI colour codes (as printed by dbt, daff and colorama) -> text segments with CSS classes.
// Only SGR codes are kept (colours, bold); anything else is removed.

export interface Segment { text: string; cls?: string }

const SGR = /\x1b\[([0-9;]*)m/g;
const OTHER = /\x1b\[[0-9;?]*[A-Za-ln-z]|\x1b\][^\x07]*\x07|\r/g;

const COLORS: Record<number, string> = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'grey', 91: 'red', 92: 'green', 93: 'yellow', 94: 'blue', 95: 'magenta', 96: 'cyan', 97: 'white',
};

export function stripAnsi(s: string): string {
  return s.replace(SGR, '').replace(OTHER, '');
}

export function parseAnsi(input: string): Segment[] {
  const s = input.replace(OTHER, '');
  const out: Segment[] = [];
  let fg: string | null = null;
  let bold = false;
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const cls = [fg ? `t-${fg}` : '', bold ? 't-bold' : ''].filter(Boolean).join(' ') || undefined;
    const prev = out[out.length - 1];
    if (prev && prev.cls === cls) prev.text += text;
    else out.push({ text, cls });
  };
  SGR.lastIndex = 0;
  for (let m = SGR.exec(s); m; m = SGR.exec(s)) {
    push(s.slice(last, m.index));
    last = m.index + m[0].length;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (const c of codes) {
      if (c === 0) { fg = null; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = null;
      else if (COLORS[c]) fg = COLORS[c];
    }
  }
  push(s.slice(last));
  return out;
}
