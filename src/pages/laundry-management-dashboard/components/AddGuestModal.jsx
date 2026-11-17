import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { createGuest } from '../../guest-management-dashboard/utils/guestStorage';
import './ownerWardrobe.css';

// Quick-add a person to a wardrobe world so they appear as a tile straight away
// — just a name and cabin; the full record is editable later in Guest
// management.
//
// What this sets is whether they STOW things aboard, which is the question the
// two wardrobe worlds actually divide on. It no longer guesses their camp: the
// guest wardrobe holds the owner's friends as well as charter guests, and
// stamping everyone there "Charter" asserted something about the owner's own
// circle that nobody told us. Camp is set in Guest management, where it is
// asked rather than inferred.
const AddGuestModal = ({ scope = 'guest', onClose, onCreated }) => {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [cabin, setCabin] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!first.trim() || busy) return;
    setBusy(true);
    try {
      const g = await createGuest({
        firstName: first.trim(),
        lastName: last.trim(),
        cabinAllocated: cabin.trim(),
        keepsWardrobeAboard: scope === 'owner',
      });
      if (g) { onCreated?.(g); onClose?.(); }
    } catch { window.showToast?.('Could not add the guest', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Add guest" onClick={onClose}>
      <form className="ow-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="ow-modal-head">
          <div><span className="ow-eyebrow">{scope === 'owner' ? 'Owner' : 'Guest'}</span><h2 className="ow-modal-title">Add a {scope === 'owner' ? 'person' : 'guest'}</h2></div>
          <button type="button" className="ow-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="ow-dialog-fields">
          <div className="ow-row2">
            <div className="ow-fieldcol">
              <label className="ow-l">First name <span className="ow-req">required</span></label>
              <input className="ow-input" autoFocus value={first} onChange={(e) => setFirst(e.target.value)} placeholder="e.g. Jane" />
            </div>
            <div className="ow-fieldcol">
              <label className="ow-l">Last name</label>
              <input className="ow-input" value={last} onChange={(e) => setLast(e.target.value)} placeholder="e.g. Doe" />
            </div>
          </div>
          <div className="ow-fieldcol">
            <label className="ow-l">Cabin</label>
            <input className="ow-input" value={cabin} onChange={(e) => setCabin(e.target.value)} placeholder="e.g. Main Deck VIP" />
          </div>
          <p className="ow-dialog-hint">Full details (dates, contact, preferences) live in Guest management.</p>
        </div>
        <div className="ow-dialog-foot">
          <button type="button" className="ow-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="ow-btn primary" disabled={!first.trim() || busy}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </form>
    </div>
  );
};

export default AddGuestModal;
