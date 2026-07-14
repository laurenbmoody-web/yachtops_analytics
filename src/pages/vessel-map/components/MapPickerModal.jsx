import React, { Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Lazy so the 3-D map + splat deps stay out of the inventory bundle until a
// crew actually opens "Set location on the map".
const VesselMapPage = React.lazy(() => import('../index'));

// The vessel map in a blurred-backdrop modal, for picking an item's pin without
// leaving the item form. `placingItem` = { id, name }. onPlaced fires when the
// item was linked to a pin; onClose closes the modal either way.
export default function MapPickerModal({ placingItem, onPlaced, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div className="vm-picker-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="vm-picker-panel" role="dialog" aria-modal="true" aria-label="Pick a location on the map">
        <button className="vm-picker-close" onClick={onClose} aria-label="Close map">×</button>
        <Suspense fallback={<div className="vm-picker-loading">Loading map…</div>}>
          <VesselMapPage embedded placingItem={placingItem} onPlaced={onPlaced} onClose={onClose} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}
