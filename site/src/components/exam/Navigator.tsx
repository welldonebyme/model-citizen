// Question navigator: one button per question (answered / flagged / current). Arrow keys move inside
// the grid (one tab stop), Home / End go to the first / last question, Enter opens the question.
import { useEffect, useRef, useState } from 'react';
import { IconFlag } from '../quiz/icons';

export interface NavItem { id: string; answered: boolean; started: boolean; flagged: boolean }

interface Props {
  items: NavItem[];
  current: number;
  onGo: (index: number) => void;
  onReview: () => void;
  id: string;
}

export function Navigator({ items, current, onGo, onReview, id }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(current);
  useEffect(() => setFocusIdx(current), [current]);

  const cols = () => {
    const btns = gridRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!btns || btns.length < 2) return 1;
    const top = btns[0].offsetTop;
    let n = 0;
    for (const b of btns) { if (b.offsetTop !== top) break; n++; }
    return Math.max(1, n);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let j = focusIdx;
    const c = cols();
    if (e.key === 'ArrowRight') j++;
    else if (e.key === 'ArrowLeft') j--;
    else if (e.key === 'ArrowDown') j += c;
    else if (e.key === 'ArrowUp') j -= c;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else return;
    e.preventDefault();
    j = Math.max(0, Math.min(items.length - 1, j));
    setFocusIdx(j);
    gridRef.current?.querySelectorAll<HTMLButtonElement>('button')[j]?.focus();
  };

  const answered = items.filter((x) => x.answered).length;
  const flagged = items.filter((x) => x.flagged).length;

  return (
    <div className="ex-nav" id={id} role="region" aria-label="All questions">
      <p className="ex-nav-sum">{answered} of {items.length} answered. {flagged} flagged for review.</p>
      <div className="ex-grid" ref={gridRef} role="group" aria-label="Go to a question. Use the arrow keys to move." onKeyDown={onKeyDown}>
        {items.map((it, i) => {
          const state = it.answered ? 'answered' : it.started ? 'started' : 'empty';
          const label = `Question ${i + 1}: ${it.answered ? 'answered' : it.started ? 'started, not finished' : 'not answered'}${it.flagged ? ', flagged for review' : ''}${i === current ? ', this question' : ''}`;
          return (
            <button
              key={it.id} type="button"
              data-state={state} data-flagged={it.flagged || undefined} data-current={i === current || undefined}
              aria-label={label} aria-current={i === current ? 'step' : undefined}
              tabIndex={i === focusIdx ? 0 : -1}
              onClick={() => onGo(i)}
            >
              {i + 1}
              {it.flagged && <span className="ex-grid-flag"><IconFlag filled /></span>}
            </button>
          );
        })}
      </div>
      <div className="ex-nav-foot">
        <ul className="ex-key" aria-label="Key">
          <li><span className="ex-key-sw" data-state="answered" aria-hidden="true" />Filled: answered</li>
          <li><span className="ex-key-sw" data-state="started" aria-hidden="true" />Half filled: started, not finished</li>
          <li><span className="ex-key-sw" data-flagged aria-hidden="true"><IconFlag filled /></span>Flag: flagged for review</li>
          <li><span className="ex-key-sw" data-current aria-hidden="true" />Ring: this question</li>
        </ul>
        <button type="button" className="ex-btn" onClick={onReview}>Review and submit</button>
      </div>
    </div>
  );
}
