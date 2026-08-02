import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import DeckPlanPicker from './DeckPlanPicker';
import MapPickerModal from '../../vessel-map/components/MapPickerModal';
import { createWardrobe } from '../utils/laundryWardrobes';
import { createLaundryItem, LaundryStatus, availableLaundryTags, formatLaundryTag } from '../utils/laundryStorage';
import './ownerWardrobe.css';

export const GARMENT_TYPES = ['Shirt', 'T-shirt', 'Top', 'Trousers', 'Shorts', 'Dress', 'Skirt', 'Suit', 'Jacket', 'Coat', 'Knitwear', 'Swimwear', 'Activewear', 'Underwear', 'Nightwear', 'Footwear', 'Bag', 'Accessory', 'Jewellery', 'Watch', 'Other'];
const CURRENCIES = ['EUR', 'GBP', 'USD'];
const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair', 'Worn'];
const SEASONS = ['All year', 'Summer', 'Winter', 'Spring', 'Autumn', 'Resort', 'Formal'];

const fileToDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// Add a resident garment straight into a wardrobe — a rich, catalogue-grade
// record (multiple photos first, then the full descriptive detail a high-value
// wardrobe warrants). Created "Stored" so it doesn't hit the active laundry list.
const AddGarmentModal = ({ wardrobes = [], guests = [], defaultWardrobeId = null, showValue = true, onClose, onCreated }) => {
  const [photos, setPhotos] = useState([]);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [type, setType] = useState('');
  const [size, setSize] = useState('');
  const [colour, setColour] = useState('');
  const [material, setMaterial] = useState('');
  const [condition, setCondition] = useState('');
  const [season, setSeason] = useState('');
  const [purchasedPlace, setPurchasedPlace] = useState('');
  const [purchasedDate, setPurchasedDate] = useState('');
  const [monogram, setMonogram] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [tags, setTags] = useState([]);
  const [notes, setNotes] = useState('');
  const [wlist, setWlist] = useState(wardrobes);
  const [wardrobeId, setWardrobeId] = useState(defaultWardrobeId || wardrobes[0]?.id || '');
  const [showPlan, setShowPlan] = useState(false);
  const [scanPlace, setScanPlace] = useState(null);
  const [guestId, setGuestId] = useState('');
  const [staysOnboard, setStaysOnboard] = useState(true);
  const [busy, setBusy] = useState(false);

  const toggleTag = (t) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    try { const urls = await Promise.all(files.map(fileToDataUrl)); setPhotos((p) => [...p, ...urls]); } catch { /* ignore */ }
    e.target.value = '';
  };
  const removePhoto = (i) => setPhotos((p) => p.filter((_, idx) => idx !== i));
  const makeCover = (i) => setPhotos((p) => (i === 0 ? p : [p[i], ...p.filter((_, idx) => idx !== i)]));

  // Placing a wardrobe on the deck plan: reuse the one homed to that node, else
  // offer to create one there.
  const onPlanPick = async (res) => {
    setShowPlan(false);
    const locId = res?.locationId;
    if (!locId) return;
    const existing = wlist.find((w) => w.locationId === locId);
    if (existing) { setWardrobeId(existing.id); return; }
    const nm = res?.name || 'Wardrobe';
    const w = await createWardrobe({ name: nm, locationId: locId, scope: 'owner' });
    if (w) { setWlist((p) => [w, ...p]); setWardrobeId(w.id); }
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const details = {};
      const put = (k, v) => { const t = typeof v === 'string' ? v.trim() : v; if (t) details[k] = t; };
      put('brand', brand); put('description', description); put('sku', sku); put('size', size);
      put('material', material); put('condition', condition); put('season', season);
      put('purchasedPlace', purchasedPlace); put('purchasedDate', purchasedDate); put('monogram', monogram);
      const guest = guests.find((g) => g.id === guestId);
      const created = await createLaundryItem({
        description: name.trim(),
        garmentType: type || null,
        colour: colour.trim(),
        garmentValue: value === '' ? null : value,
        garmentValueCurrency: currency,
        tags,
        notes: notes.trim(),
        details,
        photos,
        wardrobeId: wardrobeId || null,
        staysOnboard,
        ...(guest
          ? { ownerType: 'guest', ownerGuestId: guest.id, ownerName: guest.name || guest.fullName, ownerDisplayName: guest.name || guest.fullName }
          : { ownerType: 'other', ownerName: 'Owner' }),
        status: LaundryStatus.STORED,
      });
      if (created) { onCreated?.(created); onClose?.(); }
    } catch { /* toast handled in storage */ }
    finally { setBusy(false); }
  };

  return (
    <>
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Add garment" onClick={onClose}>
      <div className="ow-modal ow-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="ow-modal-head">
          <div><span className="ow-eyebrow">Owner wardrobe</span><h2 className="ow-modal-title">Add a garment</h2></div>
          <button type="button" className="ow-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ow-modal-body">
          {/* Photos first — a proper little gallery, cover = first. */}
          <div className="ow-photos">
            {photos.map((src, i) => (
              <div className={`ow-photo-thumb${i === 0 ? ' cover' : ''}`} key={i}>
                <img src={src} alt="" />
                {i === 0 ? <span className="ow-photo-badge">Cover</span> : <button type="button" className="ow-photo-cover" onClick={() => makeCover(i)}>Make cover</button>}
                <button type="button" className="ow-photo-del" onClick={() => removePhoto(i)} aria-label="Remove"><Icon name="X" size={12} /></button>
              </div>
            ))}
            <label className="ow-photo-add">
              <Icon name="Camera" size={20} /><span>{photos.length ? 'Add more' : 'Add photos'}</span>
              <input type="file" accept="image/*" multiple onChange={addPhotos} hidden />
            </label>
          </div>

          <div className="ow-sec">Essentials</div>
          <label className="ow-l">Item name <span className="ow-req">required</span></label>
          <input className="ow-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Navy linen shirt" />
          <div className="ow-row2">
            <div>
              <label className="ow-l">Brand</label>
              <input className="ow-input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Loro Piana" />
            </div>
            <div>
              <label className="ow-l">Type</label>
              <div className="ow-select"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">—</option>{GARMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            </div>
          </div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Size</label>
              <input className="ow-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 40R / M / UK 8" />
            </div>
            <div>
              <label className="ow-l">Colour</label>
              <input className="ow-input" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="e.g. Navy" />
            </div>
          </div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Material / fabric</label>
              <input className="ow-input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. 100% linen" />
            </div>
            <div>
              <label className="ow-l">Condition</label>
              <div className="ow-select"><select value={condition} onChange={(e) => setCondition(e.target.value)}><option value="">—</option>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
          </div>
          <label className="ow-l">Description <span className="ow-opt">optional</span></label>
          <textarea className="ow-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Cut, styling, distinguishing detail…" />

          <div className="ow-sec">Care &amp; value</div>
          <label className="ow-l">Care</label>
          <div className="ow-tags">
            {availableLaundryTags.map((t) => (
              <button type="button" key={t} className={`ow-tag${tags.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{formatLaundryTag(t)}</button>
            ))}
          </div>
          <div className="ow-row2">
            {showValue ? (
              <div>
                <label className="ow-l">Value <span className="ow-opt">optional</span></label>
                <div className="ow-value">
                  <div className="ow-select ow-cur"><select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <input className="ow-input" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            ) : <div />}
            <div>
              <label className="ow-l">Season</label>
              <div className="ow-select"><select value={season} onChange={(e) => setSeason(e.target.value)}><option value="">—</option>{SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            </div>
          </div>

          <div className="ow-sec">Provenance</div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Style code / SKU</label>
              <input className="ow-input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Supplier / style reference" />
            </div>
            <div>
              <label className="ow-l">Monogram / initials</label>
              <input className="ow-input" value={monogram} onChange={(e) => setMonogram(e.target.value)} placeholder="e.g. J.A.D." />
            </div>
          </div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Purchased at</label>
              <input className="ow-input" value={purchasedPlace} onChange={(e) => setPurchasedPlace(e.target.value)} placeholder="Boutique / city" />
            </div>
            <div>
              <label className="ow-l">Purchased on</label>
              <input className="ow-input" type="date" value={purchasedDate} onChange={(e) => setPurchasedDate(e.target.value)} />
            </div>
          </div>

          <div className="ow-sec">On board</div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Wardrobe <button type="button" className="ow-inline-map" onClick={() => setShowPlan(true)}><Icon name="Map" size={12} /> plan</button></label>
              <div className="ow-select"><select value={wardrobeId} onChange={(e) => setWardrobeId(e.target.value)}>{wlist.length === 0 && <option value="">No wardrobe yet</option>}{wlist.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
            </div>
            <div>
              <label className="ow-l">Belongs to</label>
              <div className="ow-select"><select value={guestId} onChange={(e) => setGuestId(e.target.value)}><option value="">Owner (unassigned)</option>{guests.map((g) => <option key={g.id} value={g.id}>{g.name || g.fullName || [g.firstName, g.lastName].filter(Boolean).join(' ') || 'Guest'}</option>)}</select></div>
            </div>
          </div>
          <label className="ow-check-row">
            <input type="checkbox" checked={staysOnboard} onChange={(e) => setStaysOnboard(e.target.checked)} />
            <span><b>Usually stays on board</b> — a hint for crew; it can still be packed and sent anytime.</span>
          </label>
          <label className="ow-l">Notes <span className="ow-opt">optional</span></label>
          <textarea className="ow-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else the crew should know…" />

          <p className="ow-qr-note"><Icon name="QrCode" size={13} /> A scannable QR tag is generated automatically — print it from the garment’s page once saved.</p>
        </div>

        <div className="ow-modal-foot">
          <button type="button" className="ow-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ow-btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Adding…' : 'Add garment'}</button>
        </div>
      </div>
    </div>
    {showPlan && (
      <DeckPlanPicker
        onSelect={(space) => {
          setShowPlan(false);
          if (space?.scan?.id) { setScanPlace(space.scan.id); return; }
          onPlanPick({ locationId: space.id, name: space.name });
        }}
        onClose={() => setShowPlan(false)}
      />
    )}
    {scanPlace && <MapPickerModal initialScanId={scanPlace} placingStorage={{ name: 'Wardrobe' }} onPlaced={onPlanPick} onClose={() => setScanPlace(null)} />}
    </>
  );
};

export default AddGarmentModal;
