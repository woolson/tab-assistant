import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { QuickSearchFilter } from '../../common/quickSearch';

type Direction = 1 | -1;
type Bounds = { left: number; top: number; width: number; height: number };
type PendingSlide = { outgoing: HTMLDivElement; direction: Direction; transform: string };

export function useFilterMotion(filter: QuickSearchFilter, viewport: RefObject<HTMLDivElement>) {
  const filters = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bounds = useRef<Bounds>();
  const pending = useRef<PendingSlide>();
  const outgoing = useRef<HTMLDivElement>();
  const animations = useRef<Animation[]>([]);
  const version = useRef(0);

  const clearSlide = useCallback(() => {
    version.current++;
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    pending.current?.outgoing.remove();
    pending.current = undefined;
    outgoing.current?.remove();
    outgoing.current = undefined;
    stage.current?.removeAttribute('data-sliding');
  }, []);

  const prepareSlide = useCallback((direction: Direction) => {
    const current = viewport.current, container = stage.current;
    const transform = current ? getComputedStyle(current).transform : 'none';
    clearSlide();
    if (!current || !container || !current.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // A visual snapshot lets the live list update immediately, including keyboard/ARIA state.
    const clone = current.cloneNode(true) as HTMLDivElement;
    clone.removeAttribute('id');
    clone.removeAttribute('role');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    clone.classList.add('quick-search-results-outgoing');
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    const currentSelection = current.querySelector<HTMLElement>('.quick-search-selection');
    const oldSelection = clone.querySelector<HTMLElement>('.quick-search-selection');
    if (currentSelection && oldSelection) {
      const style = getComputedStyle(currentSelection);
      oldSelection.dataset.animate = 'false';
      oldSelection.style.transform = style.transform;
      oldSelection.style.height = style.height;
    }
    clone.style.transform = transform;
    container.append(clone);
    clone.scrollTop = current.scrollTop;
    pending.current = { outgoing: clone, direction, transform };
  }, [clearSlide, viewport]);

  useLayoutEffect(() => {
    const container = filters.current, pill = highlight.current;
    if (!container || !pill) return;
    const align = (animate: boolean) => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!button) return;
      const next = { left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight };
      if (!next.width || !next.height) return;
      const previous = bounds.current;
      if (previous && Object.keys(next).every(key => previous[key as keyof Bounds] === next[key as keyof Bounds])) return;
      pill.dataset.animate = String(animate && !!previous);
      pill.style.transform = `translate3d(${next.left}px, ${next.top}px, 0)`;
      pill.style.width = `${next.width}px`;
      pill.style.height = `${next.height}px`;
      pill.hidden = false;
      bounds.current = next;
    };
    align(true);
    const observer = new ResizeObserver(() => align(false));
    observer.observe(container, { box: 'border-box' });
    container.querySelectorAll('button').forEach(button => observer.observe(button, { box: 'border-box' }));
    return () => observer.disconnect();
  }, [filter]);

  // Run after the live list's selection/scroll alignment has committed.
  useLayoutEffect(() => {
    const slide = pending.current, current = viewport.current;
    if (!slide || !current) return;
    pending.current = undefined;
    outgoing.current = slide.outgoing;
    stage.current?.setAttribute('data-sliding', 'true');
    const token = ++version.current;
    const timing: KeyframeAnimationOptions = { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' };
    animations.current = [
      slide.outgoing.animate([{ transform: slide.transform }, { transform: `translate3d(${-slide.direction * 100}%, 0, 0)` }], timing),
      current.animate([{ transform: `translate3d(${slide.direction * 100}%, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }], timing),
    ];
    void Promise.all(animations.current.map(animation => animation.finished)).then(() => {
      if (version.current === token) clearSlide();
    }).catch(() => {}); // Superseded slides are cancelled when a key repeats.
  }, [filter, clearSlide, viewport]);

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => { if (media.matches) clearSlide(); };
    media.addEventListener('change', changed);
    return () => { media.removeEventListener('change', changed); clearSlide(); };
  }, [clearSlide]);

  return { filters, highlight, stage, prepareSlide };
}
