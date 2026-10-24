import type { ReactNode } from 'react';
import type { CalloutKind, Inline as InlineT } from '../../lib/content-types';
import { Inline } from './Inline';

export const CALLOUT_TITLE: Record<CalloutKind, string> = {
  why: 'Why this matters', idea: 'The idea in 3 sentences', analogy: 'Analogy', trap: 'Exam trap', tip: 'Tip',
  deep: 'Going deeper (optional)', dbt: 'Where you will meet this in dbt', summary: 'Chapter summary',
  quiz: 'Check yourself', answer: 'Answers and explanations',
};

// One simple line icon per meaning, so meaning never depends on colour alone.
const ICON: Record<CalloutKind, string> = {
  why: '<circle cx="8" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 14h4M8 4.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  idea: '<circle cx="5.5" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.7 8H15M12.5 8v2.5M14.5 8v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  analogy: '<circle cx="5" cy="5.5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="11" cy="5.5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1.5 14c.5-2.6 2-3.8 3.5-3.8S8 11.4 8.5 14M7.5 14c.5-2.6 2-3.8 3.5-3.8s3 1.2 3.5 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  trap: '<path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 6.2v3.8M8 11.6v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  tip: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7.3v4M8 4.6v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  deep: '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.5 10.5 14.5 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  dbt: '<rect x="1" y="2" width="5" height="4" rx="1.3" fill="currentColor"/><rect x="1" y="10" width="5" height="4" rx="1.3" fill="currentColor"/><rect x="10" y="6" width="5" height="4" rx="1.3" fill="currentColor"/><path d="M6 4c3 0 1.5 4 4 4M6 12c3 0 1.5-4 4-4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  summary: '<path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  quiz: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3M8 11.5v.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  answer: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 8.2 7.2 10.4 11 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function CalloutIcon({ kind }: { kind: CalloutKind }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[kind] }} />;
}

/** anchor: the converter's link target for the box (e.g. #get-the-course-files), an id on the box itself */
export function Callout({ kind, title, children, os, anchor }: { kind: CalloutKind; title?: InlineT[]; children: ReactNode; os?: string[]; anchor?: string }) {
  const head = title && title.length ? <Inline c={title} /> : CALLOUT_TITLE[kind];
  // OS notes are shown only for their OS (content.css hides [data-os-only] for the other ones)
  const osOnly = os && os.length ? os.join(' ') : undefined;
  if (kind === 'deep') {
    return (
      <details className={`mc-callout mc-k-${kind}`} data-os-only={osOnly} id={anchor}>
        <summary className="mc-callout-title"><CalloutIcon kind={kind} />{head}<span className="mc-chev" aria-hidden="true" /></summary>
        <div className="mc-callout-body">{children}</div>
      </details>
    );
  }
  return (
    <aside className={`mc-callout mc-k-${kind}`} aria-label={CALLOUT_TITLE[kind]} data-os-only={osOnly} id={anchor}>
      <p className="mc-callout-title"><CalloutIcon kind={kind} />{head}</p>
      <div className="mc-callout-body">{children}</div>
    </aside>
  );
}
