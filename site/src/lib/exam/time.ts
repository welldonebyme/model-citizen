// Time formatting for timers and results.

const pad = (n: number) => String(n).padStart(2, '0');

/** 7_630_000 → "02:07:10" (the exam timer). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 110_000 → "1:50", 4_000 → "0:04" (per question). */
export function mss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Spoken form for screen readers and text: "1 hour 47 minutes", "12 minutes", "45 seconds". */
export function spoken(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} hour${h > 1 ? 's' : ''}${m ? ` ${m} minute${m > 1 ? 's' : ''}` : ''}`;
  if (m) return `${m} minute${m > 1 ? 's' : ''}`;
  return `${s} second${s === 1 ? '' : 's'}`;
}

/** Whole minutes, rounded: 1_530_000 → 26. */
export const minutes = (ms: number) => Math.round(ms / 60_000);

export function dateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function shortDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return new Date(ts).toISOString().slice(5, 10);
  }
}
