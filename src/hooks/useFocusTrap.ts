import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Traps keyboard focus inside `containerRef` while mounted.
 * - Focuses the first focusable child on mount.
 * - Tab / Shift+Tab cycle within the container.
 * - Restores focus to the previously-focused element on unmount
 *   (falls back to document.body if that element was removed from the DOM).
 */
export function useFocusTrap<T extends HTMLElement>(): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    const focusable = (): NodeListOf<HTMLElement> =>
      container.querySelectorAll<HTMLElement>(FOCUSABLE);

    // Focus first focusable child on mount.
    const first = focusable()[0];
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const nodes = Array.from(focusable());
      if (nodes.length === 0) { e.preventDefault(); return; }

      const firstEl = nodes[0]!;
      const lastEl = nodes[nodes.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);

      // Restore focus; fall back to body if the trigger was removed from the DOM.
      const prev = previouslyFocused.current;
      if (prev instanceof HTMLElement && document.contains(prev)) {
        prev.focus();
      } else {
        (document.body as HTMLElement).focus();
      }
    };
  }, []);

  return containerRef;
}
