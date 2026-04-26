import React, { useEffect, useRef } from 'react';

/**
 * Centred dialog with overlay backdrop.
 *  - Esc closes (document keydown listener while open)
 *  - Overlay click closes; inner click is stopped from propagating
 *  - On open, focus moves to the first focusable element in the body
 */
export default function SupplierModal({ open, onClose, title, children, footer }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    // Focus first focusable element after the modal mounts.
    const t = setTimeout(() => {
      const firstInput = dialogRef.current?.querySelector('input, select, textarea, button');
      firstInput?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handleEsc);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sp-modal-overlay" onClick={onClose}>
      <div
        className="sp-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sp-modal-head">
          <h3 id="sp-modal-title">{title}</h3>
          <button type="button" className="sp-modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="sp-modal-body">{children}</div>
        {footer && <footer className="sp-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
