import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import LocationPicker from './LocationPicker';
import { createWardrobe } from '../utils/laundryWardrobes';
import './ownerWardrobe.css';

// Create a wardrobe scoped to a real vessel location. The wardrobe then lives on
// the deck plan / map like any other place.
const WardrobeEditorModal = ({ scope = 'owner', onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [loc, setLoc] = useState(null); // { id, name, label }
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const w = await createWardrobe({ name: name.trim(), locationId: loc?.id || null, location: loc?.name || null, scope });
    setBusy(false);
    if (w) { onCreated?.(w); onClose?.(); }
  };

  return (
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="New wardrobe" onClick={onClose}>
      <div className="ow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ow-modal-head">
          <div><span className="ow-eyebrow">Owner wardrobe</span><h2 className="ow-modal-title">New wardrobe</h2></div>
          <button type="button" className="ow-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="ow-modal-body">
          <label className="ow-l">Name <span className="ow-req">required</span></label>
          <input className="ow-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Master dressing room" />
          <label className="ow-l">Where on board <span className="ow-opt">links it to the deck plan</span></label>
          <LocationPicker value={loc?.id} valueLabel={loc?.name} onChange={setLoc} />
        </div>
        <div className="ow-modal-foot">
          <button type="button" className="ow-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ow-btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Creating…' : 'Create wardrobe'}</button>
        </div>
      </div>
    </div>
  );
};

export default WardrobeEditorModal;
