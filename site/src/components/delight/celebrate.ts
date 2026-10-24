// A small celebration from any page code (the CelebrationHost of the page shows it), for example when a
// chapter is finished:  celebrate({ title: 'Chapter 7 done', text: 'Take the quiz with the book closed.' })
// Badges and levels are celebrated automatically; use this only for moments the badges do not cover.
import type { Glyph } from '../../lib/gamification';

export const CELEBRATE_EVENT = 'mc:celebrate';

export interface CelebrateDetail {
  title: string;
  text?: string;
  /** small line above the title (default "Well done") */
  kicker?: string;
  glyph?: Glyph;
  href?: string;
  linkText?: string;
}

export function celebrate(detail: CelebrateDetail) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent<CelebrateDetail>(CELEBRATE_EVENT, { detail }));
}
