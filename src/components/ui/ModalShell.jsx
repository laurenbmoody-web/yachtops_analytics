// Centered-modal primitive — every focus-stealing modal in the app
// should consume this rather than hand-rolling its own fixed-inset-0
// backdrop. Owns:
//
//   • the dim backdrop layer at z-[var(--z-overlay)]
//   • click-outside-to-close (mousedown on the backdrop, panel stops
//     propagation so internal mouse activity is unaffected)
//   • Esc-to-close (via useDismissable; window-level listener)
//   • the unsaved-input guard — pass isDirty and the helper runs
//     window.confirm("Discard changes?") before closing
//   • the in-flight gate — pass isBusy={true} during async ops and
//     backdrop / Esc are inert
//   • body scroll lock while mounted
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
  children,
}) => {
  const { tryClose } = useDismissable({ onClose, isDirty, isBusy });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const onBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) tryClose();
  };

  return createPortal(
    <div
      onMouseDown={onBackdropMouseDown}
      className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center"
      style={{
        background: 'rgba(0, 0, 0, 0.5)',
        // Asymmetric top padding: 64px nav clearance + 16px breathing
        // room. items-center honours the padded content area, so on
        // tall viewports the panel sits ~24px below true centre; on
        // short viewports the panel top is guaranteed ≥ 80px (nav +
        // gap) before overflow kicks in.
        padding: '16px',
        paddingTop: 'calc(64px + 16px)',
        overflowY: 'auto',
      }}
    >
      <div
        className={panelClassName}
        style={panelStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default ModalShell;
