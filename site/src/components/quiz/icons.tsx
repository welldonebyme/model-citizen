// Small line icons. Always paired with text: meaning never depends on the icon or the colour alone.
const P = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const;

export const IconCheck = ({ size = 16 }: { size?: number }) => (
  <svg {...P} width={size} height={size}><path d="M3.2 8.4 6.5 11.6 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconCross = ({ size = 16 }: { size?: number }) => (
  <svg {...P} width={size} height={size}><path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
export const IconFlag = ({ filled = false }: { filled?: boolean }) => (
  <svg {...P}><path d="M3.5 14.5V2.2M3.5 2.8h8.2l-1.8 3 1.8 3H3.5" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
);
export const IconGrip = () => (
  <svg {...P}><g fill="currentColor"><circle cx="5.5" cy="3.5" r="1.3" /><circle cx="10.5" cy="3.5" r="1.3" /><circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" /><circle cx="5.5" cy="12.5" r="1.3" /><circle cx="10.5" cy="12.5" r="1.3" /></g></svg>
);
export const IconUp = () => (
  <svg {...P}><path d="M8 13V3.5M3.8 7.4 8 3.2l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconDown = () => (
  <svg {...P}><path d="M8 3v9.5M3.8 8.6 8 12.8l4.2-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconInfo = () => (
  <svg {...P}><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 7.3v4M8 4.6v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);
export const IconArrowRight = () => (
  <svg {...P}><path d="M3 8h9.5M8.6 3.8 12.8 8l-4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** A right/wrong mark with a text label (for screen readers and for people who do not see colours). */
export function Mark({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className={`qz-mark ${ok ? 'qz-ok' : 'qz-bad'}`}>
      {ok ? <IconCheck /> : <IconCross />}
      <span className={label ? undefined : 'visually-hidden'}>{label ?? (ok ? 'Right' : 'Wrong')}</span>
    </span>
  );
}
