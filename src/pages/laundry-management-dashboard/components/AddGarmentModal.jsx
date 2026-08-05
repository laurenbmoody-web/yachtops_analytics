import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import DeckPlanPicker from './DeckPlanPicker';
import MapPickerModal from '../../vessel-map/components/MapPickerModal';
import OwSelect from './OwSelect';
import { createWardrobe } from '../utils/laundryWardrobes';
import { createLaundryItem, LaundryStatus, availableLaundryTags, formatLaundryTag } from '../utils/laundryStorage';
import { parseGarmentPhotos } from '../utils/garmentAi';
import './ownerWardrobe.css';

export const GARMENT_TYPES = ['Shirt', 'T-shirt', 'Top', 'Trousers', 'Shorts', 'Dress', 'Skirt', 'Suit', 'Jacket', 'Coat', 'Knitwear', 'Swimwear', 'Activewear', 'Underwear', 'Nightwear', 'Footwear', 'Bag', 'Accessory', 'Jewellery', 'Watch', 'Other'];
export const CURRENCIES = ['EUR', 'GBP', 'USD'];
export const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair', 'Worn'];
export const SEASONS = ['All year', 'Summer', 'Winter', 'Spring', 'Autumn', 'Resort', 'Formal'];
export const GENDERS = ['Womens', 'Mens', 'Unisex', 'Girls', 'Boys', 'Baby'];
// Option list with a leading "—" clear row for optional selects.
export const dashOpts = (arr) => [{ value: '', label: '—' }, ...arr.map((x) => ({ value: x, label: x }))];
const dash = dashOpts;

// Attention flag — a garment can be marked as needing attention (kept in sync
// with the laundry log's damaged/missing flags, plus a "needs repair" state).
export const FLAG_OPTIONS = [{ v: '', label: 'None' }, { v: 'damaged', label: 'Damaged' }, { v: 'repair', label: 'Needs repair' }, { v: 'missing', label: 'Missing' }];
export const FLAG_LABELS = { damaged: 'Damaged', repair: 'Needs repair', missing: 'Missing' };
export const FlagField = ({ flag, note, onFlag, onNote }) => (
  <div className="ow-flag">
    <div className="ow-flag-opts">
      {FLAG_OPTIONS.map((o) => (
        <button type="button" key={o.v || 'none'} className={`ow-flag-opt${flag === o.v ? ` on ${o.v || 'none'}` : ''}`} onClick={() => onFlag(o.v)}>{o.label}</button>
      ))}
    </div>
    {flag && <input className="ow-input" placeholder={flag === 'missing' ? 'Where was it last seen?' : 'What needs attention?'} value={note} onChange={(e) => onNote(e.target.value)} />}
  </div>
);

// Downscale + JPEG-compress a captured photo before upload. Phone photos are
// several MB; sending them raw was failing silently for all but one — this keeps
// each around ~200KB so every photo saves reliably.
export const compressImage = (file, maxDim = 1600, quality = 0.82) => new Promise((res) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        res(canvas.toDataURL('image/jpeg', quality));
      } catch { res(reader.result); }
    };
    img.onerror = () => res(reader.result);
    img.src = reader.result;
  };
  reader.onerror = () => res('');
  reader.readAsDataURL(file);
});

// Add a resident garment straight into a wardrobe — a rich, catalogue-grade
// record (multiple photos first, then the full descriptive detail a high-value
// wardrobe warrants). Created "Stored" so it doesn't hit the active laundry list.
const AddGarmentModal = ({ wardrobes = [], guests = [], defaultWardrobeId = null, defaultGuestId = '', showValue = true, onClose, onCreated }) => {
  const [photos, setPhotos] = useState([]);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [type, setType] = useState('');
  const [size, setSize] = useState('');
  const [colour, setColour] = useState('');
  const [material, setMaterial] = useState('');
  const [gender, setGender] = useState('');
  const [quantity, setQuantity] = useState(1);
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
  const [guestId, setGuestId] = useState(defaultGuestId || '');
  const [staysOnboard, setStaysOnboard] = useState(true);
  const [flag, setFlag] = useState('');
  const [flagNote, setFlagNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const toggleTag = (t) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  // Read the garment's photos (front/back + brand & care labels) and pre-fill any
  // fields the crew haven't filled yet — never overwrites what they've typed.
  const autofill = async () => {
    if (aiBusy || !photos.length) return;
    setAiBusy(true);
    const f = await parseGarmentPhotos(photos, { types: GARMENT_TYPES, genders: GENDERS, conditions: CONDITIONS, careTags: availableLaundryTags });
    setAiBusy(false);
    let filled = 0;
    const fill = (cur, val, setter) => { if (!cur && val) { setter(val); filled += 1; } };
    fill(name, f.name, setName);
    fill(brand, f.brand, setBrand);
    fill(type, f.type, setType);
    fill(gender, f.gender, setGender);
    fill(size, f.size, setSize);
    fill(colour, f.colour, setColour);
    fill(material, f.material, setMaterial);
    fill(condition, f.condition, setCondition);
    fill(sku, f.sku, setSku);
    fill(description, f.description, setDescription);
    if (Array.isArray(f.care) && f.care.length) { setTags((p) => Array.from(new Set([...p, ...f.care]))); filled += 1; }
    window.showToast?.(filled ? 'Filled from photos — please review' : 'Couldn’t read details from these photos', filled ? 'success' : 'error');
  };

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    try { const urls = (await Promise.all(files.map((f) => compressImage(f)))).filter(Boolean); setPhotos((p) => [...p, ...urls]); } catch { /* ignore */ }
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
      put('material', material); put('gender', gender); put('condition', condition); put('season', season);
      put('purchasedPlace', purchasedPlace); put('purchasedDate', purchasedDate); put('monogram', monogram);
      if (Number(quantity) > 1) details.quantity = Number(quantity);
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
        flag: flag || null,
        flagNote: flag ? flagNote.trim() : '',
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
          {photos.length > 0 && (
            <button type="button" className="ow-ai-btn" onClick={autofill} disabled={aiBusy}>
              <Icon name={aiBusy ? 'Loader' : 'Sparkles'} size={15} className={aiBusy ? 'ow-ai-spin' : ''} />
              {aiBusy ? 'Reading photos…' : 'Auto-fill from photos'}
            </button>
          )}
          <p className="ow-ai-hint">Tip: front &amp; back on the hanger, plus the brand and care labels — AI fills the rest.</p>

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
              <OwSelect value={type} onChange={setType} options={dash(GARMENT_TYPES)} />
            </div>
          </div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Cut</label>
              <OwSelect value={gender} onChange={setGender} options={dash(GENDERS)} />
            </div>
            <div>
              <label className="ow-l">Size</label>
              <input className="ow-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 40R / M / UK 8" />
            </div>
          </div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Colour</label>
              <input className="ow-input" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="e.g. Navy" />
            </div>
            <div>
              <label className="ow-l">Material / fabric</label>
              <input className="ow-input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. 100% linen" />
            </div>
          </div>
          <div className="ow-row2">
            <div>
              <label className="ow-l">Condition</label>
              <OwSelect value={condition} onChange={setCondition} options={dash(CONDITIONS)} />
            </div>
            <div>
              <label className="ow-l">Quantity <span className="ow-opt">if multiples</span></label>
              <input className="ow-input" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} />
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
                  <div className="ow-cur"><OwSelect value={currency} onChange={setCurrency} options={CURRENCIES} /></div>
                  <input className="ow-input" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            ) : <div />}
            <div>
              <label className="ow-l">Season</label>
              <OwSelect value={season} onChange={setSeason} options={dash(SEASONS)} />
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
              <OwSelect value={wardrobeId} onChange={setWardrobeId} placeholder={wlist.length === 0 ? 'No wardrobe yet' : '—'} options={wlist.map((w) => ({ value: w.id, label: w.name }))} />
            </div>
            <div>
              <label className="ow-l">Belongs to</label>
              <OwSelect value={guestId} onChange={setGuestId} options={[{ value: '', label: 'Owner (unassigned)' }, ...guests.map((g) => ({ value: g.id, label: g.name || g.fullName || [g.firstName, g.lastName].filter(Boolean).join(' ') || 'Guest' }))]} />
            </div>
          </div>
          <label className="ow-check-row">
            <input type="checkbox" checked={staysOnboard} onChange={(e) => setStaysOnboard(e.target.checked)} />
            <span><b>Usually stays on board</b> — a hint for crew; it can still be packed and sent anytime.</span>
          </label>
          <label className="ow-l">Flag <span className="ow-opt">needs attention?</span></label>
          <FlagField flag={flag} note={flagNote} onFlag={setFlag} onNote={setFlagNote} />
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
