import { useEffect, useState, type RefObject } from 'react';
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

/**
 * Code blocks that scroll sideways must be reachable with the keyboard (WCAG 2.1.1, axe
 * scrollable-region-focusable). Inside `ref`, every overflowing code body gets tabindex="0" and a label.
 */
export function useFocusableScrollers(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const apply = () => {
      root.querySelectorAll<HTMLElement>('pre.mc-code-body').forEach((pre) => {
        if (pre.querySelector('button')) return; // hotspot lines are buttons already
        const scrolls = pre.scrollWidth > pre.clientWidth + 1;
        if (scrolls && !pre.hasAttribute('tabindex')) {
          pre.tabIndex = 0;
          pre.dataset.qzScroll = '';
          pre.setAttribute('role', 'region');
          pre.setAttribute('aria-label', 'Code (scroll sideways to read it all)');
        } else if (!scrolls && pre.dataset.qzScroll !== undefined) {
          pre.removeAttribute('tabindex'); pre.removeAttribute('role'); pre.removeAttribute('aria-label'); delete pre.dataset.qzScroll;
        }
      });
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    const mo = new MutationObserver(apply);
    mo.observe(root, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [ref]);
}
