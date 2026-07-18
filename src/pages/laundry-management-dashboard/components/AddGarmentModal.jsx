import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { createLaundryItem, LaundryStatus, availableLaundryTags, formatLaundryTag } from '../utils/laundryStorage';
import './ownerWardrobe.css';

export const GARMENT_TYPES = ['Shirt', 'T-shirt', 'Top', 'Trousers', 'Shorts', 'Dress', 'Skirt', 'Suit', 'Jacket', 'Coat', 'Knitwear', 'Swimwear', 'Activewear', 'Underwear', 'Nightwear', 'Footwear', 'Accessory', 'Other'];
const CURRENCIES = ['EUR', 'GBP', 'USD'];

const fileToDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// Add a resident garment straight into a wardrobe. Created "Stored" (at rest in
// its wardrobe) so it doesn't land in the active laundry list.
const AddGarmentModal = ({ wardrobes = [], defaultWardrobeId = null, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [colour, setColour] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [tags, setTags] = useState([]);
  const [wardrobeId, setWardrobeId] = useState(defaultWardrobeId || wardrobes[0]?.id || '');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleTag = (t) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const pickPhoto = async (e) => {
    const f = e.target.files?.[0];
    if (f) { try { setPhoto(await fileToDataUrl(f)); } catch { /* ignore */ } }
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await createLaundryItem({
        description: name.trim(),
        garmentType: type || null,
        colour: colour.trim(),
        garmentValue: value === '' ? null : value,
        garmentValueCurrency: currency,
        tags,
        photos: photo ? [photo] : [],
        wardrobeId: wardrobeId || null,
        ownerType: 'other',
        ownerName: 'Owner',
        status: LaundryStatus.STORED,
      });
      if (created) { onCreated?.(created); onClose?.(); }
    } catch (e) { /* toast handled in storage */ }
    finally { setBusy(false); }
  };

  return (
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Add garment" onClick={onClose}>
      <div className="ow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ow-modal-head">
          <div><span className="ow-eyebrow">Owner wardrobe</span><h2 className="ow-modal-title">Add a garment</h2></div>
          <button type="button" className="ow-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ow-modal-body">
          <label className="ow-photo">
            {photo ? <img src={photo} alt="" /> : <span className="ow-photo-ph"><Icon name="Camera" size={22} /><span>Add photo</span></span>}
            <input type="file" accept="image/*" onChange={pickPhoto} hidden />
          </label>

          <label className="ow-l">Name / description <span className="ow-req">required</span></label>
          <input className="ow-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Navy linen shirt" />

          <div className="ow-row2">
            <div>
              <label className="ow-l">Type</label>
              <div className="ow-select"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">—</option>{GARMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            </div>
            <div>
              <label className="ow-l">Colour</label>
              <input className="ow-input" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="e.g. Navy" />
            </div>
          </div>

          <div className="ow-row2">
            <div>
              <label className="ow-l">Value <span className="ow-opt">optional</span></label>
              <div className="ow-value">
                <div className="ow-select ow-cur"><select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                <input className="ow-input" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="ow-l">Wardrobe</label>
              <div className="ow-select"><select value={wardrobeId} onChange={(e) => setWardrobeId(e.target.value)}>{wardrobes.length === 0 && <option value="">No wardrobe yet</option>}{wardrobes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
            </div>
          </div>

          <label className="ow-l">Care</label>
          <div className="ow-tags">
            {availableLaundryTags.map((t) => (
              <button type="button" key={t} className={`ow-tag${tags.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{formatLaundryTag(t)}</button>
            ))}
          </div>
        </div>

        <div className="ow-modal-foot">
          <button type="button" className="ow-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ow-btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Adding…' : 'Add garment'}</button>
        </div>
      </div>
    </div>
  );
};

export default AddGarmentModal;
