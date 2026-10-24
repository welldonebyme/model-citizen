// Spaced repetition (Leitner boxes), matching the book's review rhythm (Part 0: day 3, day 7, day 21).
// Box 1 → review tomorrow, then 3, 7, 21 and 60 days. A miss sends the card back to box 1.
import type { SrsCard } from './store/db';
import { today } from './store/db';

export const BOX_DAYS = [0, 1, 3, 7, 21, 60] as const; // index = box (1..5)

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return today(dt);
}

export function newCard(id: string, kind: SrsCard['kind'], on = today()): SrsCard {
  return { id, kind, box: 1, due: addDays(on, BOX_DAYS[1]), lapses: 0, updatedAt: Date.now() };
}

export function review(card: SrsCard, remembered: boolean, on = today()): SrsCard {
  const box = remembered ? Math.min(5, card.box + 1) : 1;
  return { ...card, box, due: addDays(on, BOX_DAYS[box]), lastAt: Date.now(), lapses: card.lapses + (remembered ? 0 : 1), updatedAt: Date.now() };
}

export function isDue(card: SrsCard, on = today()): boolean {
  return card.due <= on;
}
