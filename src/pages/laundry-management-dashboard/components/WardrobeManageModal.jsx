import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import WardrobeIcon from './WardrobeIcon';
import DeckPlanPicker from './DeckPlanPicker';
import MapPickerModal from '../../vessel-map/components/MapPickerModal';
import { updateWardrobe, archiveWardrobe } from '../utils/laundryWardrobes';
import { setLaundryItemsWardrobe } from '../utils/laundryStorage';
import './ownerWardrobe.css';

// Manage the owner wardrobes (locations): rename, delete (garments inside are
// unplaced, not lost), or add a new one. Counts come from the loaded item set.
const WardrobeManageModal = ({ wardrobes = [], items = [], onNew, onChanged, onClose }) => {
  const [editing, setEditing] = useState(null); // wardrobe id being renamed
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(null);  // { id, count }
  const [busy, setBusy] = useState(false);
  const [planFor, setPlanFor] = useState(null);  // wardrobe id being pinned on the deck plan
  const [scanPlace, setScanPlace] = useState(null); // { scanId, wid }

  // Pin a wardrobe to a deck-plan location (its "where on the vessel").
  const applyLocation = async (wid, locationId, locationName) => {
    if (!wid || !locationId) return;
    await updateWardrobe(wid, { locationId, location: locationName || '' });
    onChanged?.();
  };

  // Everything homed in this wardrobe (all people), counted in pieces.
  const countFor = (id) => items.filter((i) => i.wardrobeId === id).reduce((a, i) => a + Math.max(1, Number(i?.details?.quantity) || 1), 0);

  const startEdit = (w) => { setEditing(w.id); setName(w.name); };
  const saveEdit = async (w) => {
    const nm = name.trim();
    if (!nm || nm === w.name) { setEditing(null); return; }
    setBusy(true);
    const ok = await updateWardrobe(w.id, { name: nm });
    setBusy(false); setEditing(null);
    if (ok) onChanged?.();
  };
  const doDelete = async () => {
    const { id } = confirm;
    setBusy(true);
    const ids = items.filter((i) => i.wardrobeId === id).map((i) => i.id);
    if (ids.length) await setLaundryItemsWardrobe(ids, null);
    await archiveWardrobe(id);
    setBusy(false); setConfirm(null);
    onChanged?.();
  };

  return (
    <>
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Manage wardrobes" onClick={onClose}>
      <div className="ow-chooser" onClick={(e) => e.stopPropagation()}>
        <div className="ow-modal-head">
          <div><span className="ow-eyebrow">Owner wardrobe</span><h2 className="ow-modal-title">Wardrobes</h2></div>
          <button type="button" className="ow-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ow-wm-list">
          {wardrobes.length === 0 && <p className="ow-empty-note" style={{ padding: '8px 4px' }}>No wardrobes yet. Add one to place garments.</p>}
          {wardrobes.map((w) => {
            const n = countFor(w.id);
            return (
              <div className="ow-wm-row" key={w.id}>
                <span className="ow-wm-ic"><WardrobeIcon size={17} /></span>
                {editing === w.id ? (
                  <input className="ow-input ow-wm-input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(w); if (e.key === 'Escape') setEditing(null); }} />
                ) : (
                  <div className="ow-wm-main">
                    <span className="ow-wm-nm">{w.name}</span>
                    <span className="ow-wm-sub">{[w.locationName || 'Not on the plan', `${n} garment${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
                  </div>
                )}
                <div className="ow-wm-acts">
                  {editing === w.id ? (
                    <>
                      <button type="button" className="ow-wm-btn" onClick={() => saveEdit(w)} disabled={busy}>Save</button>
                      <button type="button" className="ow-wm-btn quiet" onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={`ow-wm-icon${w.locationId ? ' on' : ''}`} title={w.locationId ? 'Change deck-plan location' : 'Pin on deck plan'} onClick={() => setPlanFor(w.id)}><Icon name="MapPin" size={15} /></button>
                      <button type="button" className="ow-wm-icon" title="Rename" onClick={() => startEdit(w)}><Icon name="Pencil" size={15} /></button>
                      <button type="button" className="ow-wm-icon danger" title="Delete" onClick={() => setConfirm({ id: w.id, count: n })}><Icon name="Trash2" size={15} /></button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="ow-wm-foot">
          <button type="button" className="ow-btn primary" onClick={() => { onClose?.(); onNew?.(); }}><Icon name="Plus" size={15} /> New wardrobe</button>
        </div>
      </div>

      {confirm && (
        <div className="ow-overlay" onClick={() => setConfirm(null)}>
          <div className="ow-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ow-modal-head"><h2 className="ow-modal-title">Delete wardrobe</h2><button type="button" className="ow-x" onClick={() => setConfirm(null)}><Icon name="X" size={18} /></button></div>
            <p className="ow-dialog-body">{confirm.count > 0
              ? `${confirm.count} garment${confirm.count === 1 ? '' : 's'} live here — they'll be unplaced (kept, just not homed), and the wardrobe removed.`
              : 'Remove this wardrobe?'}</p>
            <div className="ow-dialog-foot">
              <button type="button" className="ow-btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="ow-btn danger" disabled={busy} onClick={doDelete}>{busy ? 'Working…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>

    {planFor && (
      <DeckPlanPicker
        onSelect={(space) => {
          if (space?.scan?.id) { setScanPlace({ scanId: space.scan.id, wid: planFor }); setPlanFor(null); return; }
          applyLocation(planFor, space?.id, space?.name); setPlanFor(null);
        }}
        onClose={() => setPlanFor(null)}
      />
    )}
    {scanPlace && (
      <MapPickerModal
        initialScanId={scanPlace.scanId}
        placingStorage={{ name: 'Wardrobe' }}
        onPlaced={(res) => { applyLocation(scanPlace.wid, res?.locationId, res?.name); setScanPlace(null); }}
        onClose={() => setScanPlace(null)}
      />
    )}
    </>
  );
};

export default WardrobeManageModal;
