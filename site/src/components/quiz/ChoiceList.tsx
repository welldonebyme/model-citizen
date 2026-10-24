// Multiple choice (radio buttons) and multiple select (checkboxes, "choose N", never more than N).
import { useState } from 'react';
import type { Question } from '../../lib/content-types';
import type { Response } from '../../lib/scoring';
import { Inline } from '../content/Inline';
import { Mark } from './icons';

interface Props {
  q: Question;
  response: Response | undefined;
  onResponse: (r: Response | undefined) => void;
  locked?: boolean;
  review?: boolean;
  name: string;
}

export function MultipleChoice({ q, response, onResponse, locked, review, name }: Props) {
  const choice = response?.format === 'mc' ? response.choice : null;
  return (
    <fieldset className="qz-choices" disabled={false}>
      <legend className="visually-hidden">Choose one answer</legend>
      {(q.options ?? []).map((o) => {
        const checked = choice === o.id;
        const isKey = review && q.key === o.id;
        const state = review ? (isKey ? 'key' : checked ? 'wrong' : undefined) : undefined;
        return (
          <label key={o.id} className="qz-choice" data-checked={checked || undefined} data-state={state}>
            <input
              type="radio" name={name} value={o.id} checked={checked}
              aria-describedby={review && (isKey || checked) ? `${name}-${o.id}-m` : undefined}
              onChange={() => { if (!locked) onResponse({ format: 'mc', choice: o.id }); }}
              readOnly={locked}
            />
            <span className="qz-letter" aria-hidden="true">{o.id}</span>
            <span className="qz-choice-text"><span className="visually-hidden">{o.id}. </span><Inline c={o.c} /></span>
            {review && (isKey || checked) && (
              <span id={`${name}-${o.id}-m`} className="qz-choice-mark">
                {isKey ? <Mark ok label={checked ? 'Your answer, correct' : 'Correct answer'} /> : <Mark ok={false} label="Your answer" />}
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

export function MultipleSelect({ q, response, onResponse, locked, review, name }: Props) {
  const n = q.choose ?? (q.key as string[]).length;
  const chosen = response?.format === 'ms' ? response.choices : [];
  const [msg, setMsg] = useState('');
  const key = new Set(review ? (q.key as string[]) : []);

  const toggle = (id: string) => {
    if (locked) return;
    if (chosen.includes(id)) {
      setMsg('');
      const next = chosen.filter((c) => c !== id);
      onResponse(next.length ? { format: 'ms', choices: next } : undefined);
      return;
    }
    if (chosen.length >= n) {
      setMsg(`You already chose ${n}. Clear one answer before you choose another one.`);
      return;
    }
    setMsg('');
    onResponse({ format: 'ms', choices: [...chosen, id] });
  };

  return (
    <fieldset className="qz-choices">
      <legend className="qz-count">
        Choose {n}. <span aria-live="polite">{chosen.length} of {n} chosen.</span>
      </legend>
      {(q.options ?? []).map((o) => {
        const checked = chosen.includes(o.id);
        const full = !checked && chosen.length >= n;
        const isKey = key.has(o.id);
        const state = review ? (isKey ? (checked ? 'key' : 'missed') : checked ? 'wrong' : undefined) : undefined;
        return (
          <label key={o.id} className="qz-choice" data-checked={checked || undefined} data-full={(!locked && full) || undefined} data-state={state}>
            <input
              type="checkbox" name={name} value={o.id} checked={checked}
              aria-disabled={(!locked && full) || undefined}
              onChange={() => toggle(o.id)}
              readOnly={locked}
            />
            <span className="qz-letter" aria-hidden="true">{o.id}</span>
            <span className="qz-choice-text"><span className="visually-hidden">{o.id}. </span><Inline c={o.c} /></span>
            {review && (isKey || checked) && (
              <span className="qz-choice-mark">
                {isKey && checked && <Mark ok label="Your answer, correct" />}
                {isKey && !checked && <Mark ok={false} label="Correct answer, not chosen" />}
                {!isKey && checked && <Mark ok={false} label="Your answer, wrong" />}
              </span>
            )}
          </label>
        );
      })}
      <p className="qz-limit" role="status">{msg}</p>
    </fieldset>
  );
}
