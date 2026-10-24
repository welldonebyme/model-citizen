import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, getSettings } from '../../lib/store/db';
import type { DomcRules } from '../../lib/exam/domc';

/** DOMC rules from Settings (early ending, extra option). Defaults until the database answers. */
export function useDomcRules(): { rules: DomcRules; ready: boolean; storage: boolean } {
  const [state, setState] = useState({ rules: { earlyEnd: DEFAULT_SETTINGS.domcEarlyEnd, extraOption: DEFAULT_SETTINGS.domcExtraOption }, ready: false, storage: true });
  useEffect(() => {
    let live = true;
    getSettings()
      .then((s) => { if (live) setState({ rules: { earlyEnd: s.domcEarlyEnd, extraOption: s.domcExtraOption }, ready: true, storage: true }); })
      .catch(() => { if (live) setState((x) => ({ ...x, ready: true, storage: false })); });
    return () => { live = false; };
  }, []);
  return state;
}

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function scrollIntoViewIfNeeded(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
