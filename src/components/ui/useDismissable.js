// Shared close-behaviour hook for any overlay (centered modal, side
// drawer, sheet). One source of truth for the close gate:
//
//   1. isBusy → drop the close request silently (don't abandon an
//      in-flight async op).
//   2. isDirty → confirm "Discard changes?" via window.confirm
//      (intentional v1 — swap for a styled confirm later, single site).
//   3. Otherwise → call onClose.
//
// Also wires a window-level Escape listener while enabled, so every
// modal gets Esc-to-close for free with identical gating semantics as
// backdrop-click and the × button.
//
// Uses a ref-latched mirror of props so the keydown listener doesn't
// need to detach/reattach on every render; tryClose always sees the
// latest isDirty/isBusy/onClose without stale-closure bugs.

import { useEffect, useRef } from 'react';

export default function useDismissable({
  onClose,
  isDirty = false,
  isBusy = false,
  enabled = true,
}) {
  const latest = useRef({ onClose, isDirty, isBusy });
  latest.current = { onClose, isDirty, isBusy };

  const tryClose = () => {
    const { onClose: oc, isDirty: dirty, isBusy: busy } = latest.current;
    if (busy) return;
    if (dirty && !window.confirm('Discard changes?')) return;
    oc && oc();
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        tryClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // tryClose closes over latest via the ref; safe to keep deps empty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { tryClose };
}
