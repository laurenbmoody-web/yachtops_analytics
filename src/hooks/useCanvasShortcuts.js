import { useEffect, useRef } from 'react';

// Page-scoped single-key shortcuts for canvas tools — the codebase's first
// global-key pattern, written as a hook so the deck-plan and walkthrough
// surfaces reuse the same guards instead of reinventing them per page.
//
// Guards, in order:
//   * modifier chords (Cmd/Ctrl/Alt) pass through untouched — browser's
//   * keys typed into inputs, textareas, selects or contentEditable pass
//     through — a pin label containing "p" must never switch tools
//
// `bindings` maps lowercase key names ('v', 'p', 'escape') to handlers.
// Handlers are kept in a ref so callers can pass fresh closures every render
// without re-binding the listener.
export default function useCanvasShortcuts(bindings, { enabled = true } = {}) {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return undefined;

    const isTyping = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const handler = bindingsRef.current?.[e.key.toLowerCase()];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
