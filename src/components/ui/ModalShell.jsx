// Focus-stealing panel primitive — every modal in the app should consume
// this rather than hand-rolling its own fixed-inset-0 backdrop.
//
// Two shapes, same behaviour: the default centered modal, and
// variant="drawer", a full-height panel that slides in from the right. A
// drawer is the better home for a detail view you edit in place (the way
// To Do's task pane works) — it keeps the list visible behind it, it has
// the full height of the window so the content does not need scrolling,
// and it does not shove the page contents sideways on open.
//
// Owns:
//
//   • the dim backdrop layer at z-[var(--z-overlay)]
//   • click-outside-to-close (mousedown on the backdrop, panel stops
//     propagation so internal mouse activity is unaffected)
//   • Esc-to-close (via useDismissable; window-level listener)
//   • the unsaved-input guard — pass isDirty and the helper runs
//     window.confirm("Discard changes?") before closing
//   • the in-flight gate — pass isBusy={true} during async ops and
//     backdrop / Esc are inert
//   • body scroll lock while mounted (not in docked mode — see below)
//   • the +~16px top-offset nudge so modal centroids sit slightly
//     below true viewport-center and the panel top never tucks under
//     the fixed nav (var(--z-nav) at 64px) on short viewports
//
// Consumers pass the PANEL's class/style; the primitive supplies the
// scaffold. Mount on open, unmount on close — consumers control
// rendering via their existing `if (!open) return null` (or
// conditional JSX) pattern.

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import useDismissable from './useDismissable';

const ModalShell = ({
  onClose,
  isDirty = false,
  isBusy = false,
  panelClassName = '',
  panelStyle,
  variant = 'modal', // 'modal' (centered) | 'drawer' (right, full height)
  // A drawer that docks instead of overlaying: no scrim, no scroll lock, and
  // the page behind it stays live. Use it where the page has made room to the
  // right (a single focused board), so the panel reads as part of the page
  // rather than something covering it. Esc and the panel's own close still
  // dismiss it; click-outside does not, because there is nothing to click
  // outside of.
  docked = false,
  children,
}) => {
  const isDrawer = variant === 'drawer';
  const isDocked = isDrawer && docked;
  const { tryClose } = useDismissable({ onClose, isDirty, isBusy });

  useEffect(() => {
    if (isDocked) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isDocked]);

  const onBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) tryClose();
  };

  return createPortal(
    <div
      onMouseDown={onBackdropMouseDown}
      className={`fixed inset-0 z-[var(--z-overlay)] flex ${
        isDrawer ? 'items-stretch justify-end' : 'items-center justify-center'
      }`}
      style={
        isDocked
          ? {
              // Below the fixed nav, and inert: only the panel takes clicks,
              // so the board beside it stays usable.
              background: 'transparent',
              padding: 0,
              paddingTop: 64,
              pointerEvents: 'none',
            }
          : isDrawer
          ? {
              // Lighter scrim than the centered modal: a drawer is meant to
              // sit beside the list you came from, not blot it out.
              background: 'rgba(28, 27, 58, 0.28)',
              padding: 0,
            }
          : {
              background: 'rgba(0, 0, 0, 0.5)',
              // Asymmetric top padding: 64px nav clearance + 16px breathing
              // room. items-center honours the padded content area, so on
              // tall viewports the panel sits ~24px below true centre; on
              // short viewports the panel top is guaranteed ≥ 80px (nav +
              // gap) before overflow kicks in.
              padding: '16px',
              paddingTop: 'calc(64px + 16px)',
              overflowY: 'auto',
            }
      }
    >
      <div
        className={`${panelClassName}${isDocked ? ' jm-docked' : ''}`}
        style={isDocked ? { pointerEvents: 'auto', ...(panelStyle || {}) } : panelStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default ModalShell;
