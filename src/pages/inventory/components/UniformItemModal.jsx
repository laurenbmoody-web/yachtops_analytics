import React, { useMemo, useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { saveItem } from '../utils/inventoryStorage';
import { LocationPicker } from './AddEditItemModal';
import './uniformItem.css';

// The uniform-specific add/edit modal — opened by the inventory page when the
// item's folder is under "Uniform". Clothing is captured differently from stock:
// one style, a SIZE RUN (per-size stock), plus fit / branding / care / supply.
// Size run persists in variants (variant_type='size'); the rest in custom_fields.

const CURRENCIES = ['EUR', 'GBP', 'USD'];
const GARMENTS = ['Top', 'Bottom', 'Shoes', 'Accessories'];
const FITS = ['Mens', 'Womens', 'Unisex'];
const SEASONS = ['All year', 'Summer', 'Winter'];
const BRANDING = ['None', 'Embroidery', 'Print'];
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

// Read the gender + garment leaf out of the folder path (below the Uniform anchor)
// to pre-fill fit + garment type.
const readFolder = (loc, sub) => {
  const segs = String(sub || '').split('>').map((s) => s.trim()).filter(Boolean);
  const ui = segs.map((s) => s.toLowerCase()).lastIndexOf('uniform');
  const below = ui >= 0 ? segs.slice(ui + 1) : segs;
  const gender = below.find((s) => FITS.some((f) => f.toLowerCase() === s.toLowerCase())) || '';
  const garment = GARMENTS.find((g) => g.toLowerCase() === (below[below.length - 1] || '').toLowerCase()) || '';
  return { fit: gender, garment };
};

const UniformItemModal = ({ item, defaultLocation, defaultSubLocation, onClose }) => {
  const isEdit = !!item?.id;
  const loc = item?.location || defaultLocation || '';
  const sub = item?.subLocation || defaultSubLocation || '';
  const folder = useMemo(() => readFolder(loc, sub), [loc, sub]);
  const cf = item?.customFields || {};

  const [name, setName] = useState(item?.name || '');
  const [imageUrl, setImageUrl] = useState(item?.imageUrl || '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [removingBg, setRemovingBg] = useState(false);
  const [originalUrl, setOriginalUrl] = useState(''); // pre-cutout image, for undo
  const [bgError, setBgError] = useState('');
  const [garmentType, setGarmentType] = useState(cf.garmentType || folder.garment || '');
  const [subType, setSubType] = useState(cf.subType || '');
  const [fit, setFit] = useState(cf.fit || folder.fit || '');
  const [colour, setColour] = useState(cf.colour || '');
  const [brand, setBrand] = useState(item?.brand || '');
  const [styleCode, setStyleCode] = useState(cf.styleCode || '');
  const [sizes, setSizes] = useState(
    (item?.variants || []).map((v) => ({ size: v.size || v.label || '', qty: v.qty ?? v.quantity ?? '', locId: v.locationId || '', locLabel: v.locationName || '' }))
  );
  const [customSize, setCustomSize] = useState('');
  const [brandingType, setBrandingType] = useState(cf.branding?.type || 'None');
  const [brandingColour, setBrandingColour] = useState(cf.branding?.colour || '');
  const [brandingLogo, setBrandingLogo] = useState(cf.branding?.logo || '');
  const [brandingPlacement, setBrandingPlacement] = useState(cf.branding?.placement || '');
  const [fabric, setFabric] = useState(cf.fabric || '');
  const [care, setCare] = useState(cf.care || '');
  const [season, setSeason] = useState(cf.season || 'All year');
  const [supplier, setSupplier] = useState(item?.supplier || '');
  const [unitCost, setUnitCost] = useState(item?.unitCost ?? '');
  const [currency, setCurrency] = useState(item?.currency || 'EUR');
  const [notes, setNotes] = useState(item?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Physical storage on board — the vessel_locations node (the GA / location-
  // management map) so Interior can find where the uniform is actually kept.
  const existingStock = (item?.stockLocations || [])[0] || {};
  const [storageLocId, setStorageLocId] = useState(existingStock.vesselLocationId || existingStock.locationId || '');
  const [storageLabel, setStorageLabel] = useState(existingStock.locationName || existingStock.location_name || existingStock.subLocation || '');
  const [vesselLocations, setVesselLocations] = useState([]);
  const [vesselLoading, setVesselLoading] = useState(false);
  // Location picker target: null = closed, 'main' = the item's default storage,
  // or a size index = that size's own storage (split storage across locations).
  const [pickerTarget, setPickerTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setVesselLoading(true);
      try {
        const { data: ctx } = await supabase?.rpc('get_my_context');
        const tenantId = ctx?.[0]?.tenant_id;
        if (tenantId) {
          const { data } = await supabase?.from('vessel_locations')?.select('*')?.eq('tenant_id', tenantId);
          if (alive && data) setVesselLocations(data);
        }
      } catch { /* ignore */ }
      if (alive) setVesselLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // Keep the stored label fresh once locations load (covers edits saved before).
  useEffect(() => {
    if (!storageLocId || !vesselLocations.length) return;
    const byId = new Map(vesselLocations.map((n) => [n.id, n]));
    const chain = []; const seen = new Set(); let cur = byId.get(storageLocId);
    while (cur && !seen.has(cur.id)) { chain.unshift(cur); seen.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    if (chain.length) setStorageLabel(chain.map((n) => n.name).join(' › '));
  }, [storageLocId, vesselLocations]);

  const total = sizes.reduce((a, s) => a + (Number(s.qty) || 0), 0);
  // Partial-gap nudge: some sizes pinned to their own spot but no default set, so
  // the unpinned sizes have nowhere to land. (Not shown when nothing is pinned —
  // that's just "no location yet", handled elsewhere.)
  const anyPinned = sizes.some((s) => s.size && s.locId);
  const gapSizes = (anyPinned && !storageLocId) ? sizes.filter((s) => s.size && !s.locId) : [];

  // The item-images bucket only accepts JPEG/PNG/WebP/GIF up to 5 MB — but most
  // crew shoot on iPhones (HEIC, often >5 MB). So re-encode every picked photo to
  // JPEG through a canvas and downscale it: this makes HEIC work (iOS can decode
  // it to draw), guarantees an accepted format, and keeps us under the size cap.
  const MAX_DIM = 1600;
  const toJpeg = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (Math.max(width, height) > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBgError('');
    setUploading(true); setUploadError('');
    try {
      let blob;
      try {
        blob = await toJpeg(file); // HEIC/large → downscaled JPEG
      } catch {
        // Browser couldn't decode it (e.g. HEIC on desktop Chrome). Fall back to
        // the original if it's already an accepted type and small enough.
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) && file.size <= 5 * 1024 * 1024;
        if (!ok) {
          setUploadError('Couldn’t read that image — please try a JPG or PNG.');
          setUploading(false); return;
        }
        blob = file;
      }
      const { data: ctx } = await supabase?.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id || 'shared';
      const ext = blob === file ? ((file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')) : 'jpg';
      const contentType = blob === file ? (file.type || 'image/jpeg') : 'image/jpeg';
      const path = `inventory/${tenantId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase?.storage?.from('item-images')?.upload(path, blob, { upsert: true, contentType });
      if (upErr) {
        setUploadError('Upload failed — ' + (upErr?.message || 'please try again.'));
      } else {
        const { data: urlData } = supabase?.storage?.from('item-images')?.getPublicUrl(path);
        setImageUrl(urlData?.publicUrl || '');
      }
    } catch (err) {
      setUploadError('Upload failed — ' + (err?.message || 'please try again.'));
    }
    setUploading(false);
  };

  // Background removal — a manual button (only spends a fal call when needed).
  // Sends the current image to the uniform-cutout edge function and swaps in the
  // garment-on-transparent result; keeps the original for one-tap undo.
  const removeBg = async () => {
    if (!imageUrl || removingBg) return;
    setRemovingBg(true); setBgError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('uniform-cutout', { body: { imageUrl } });
      if (fnErr || !data?.url) setBgError('Couldn’t remove the background — try again.');
      else { setOriginalUrl(imageUrl); setImageUrl(data.url); }
    } catch { setBgError('Couldn’t remove the background — try again.'); }
    setRemovingBg(false);
  };

  const addSize = (s) => {
    const v = (s || '').trim();
    if (!v || sizes.some((x) => x.size.toLowerCase() === v.toLowerCase())) return;
    setSizes((p) => [...p, { size: v, qty: '', locId: '', locLabel: '' }]);
  };
  const setQty = (i, q) => setSizes((p) => p.map((s, idx) => (idx === i ? { ...s, qty: q } : s)));
  const removeSize = (i) => setSizes((p) => p.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    const variants = sizes.filter((s) => s.size).map((s) => ({
      size: s.size, qty: Number(s.qty) || 0,
      ...(s.locId ? { locationId: s.locId, locationName: s.locLabel } : {}),
    }));
    const customFields = {
      fit, garmentType, subType: subType.trim(), colour: colour.trim(), styleCode: styleCode.trim(),
      branding: { type: brandingType, colour: brandingColour.trim(), logo: brandingLogo.trim(), placement: brandingPlacement.trim() },
      fabric: fabric.trim(), care: care.trim(), season,
    };
    // Physical storage on the vessel map. Each size lands at its own location if
    // one is set, otherwise the item's default ('all sizes') location. Group by
    // location so the map/stock rows show a quantity (and size breakdown) per spot.
    const groups = new Map();
    for (const s of sizes.filter((x) => x.size)) {
      const locId = s.locId || storageLocId;
      const label = s.locId ? s.locLabel : storageLabel;
      if (!locId) continue;
      const g = groups.get(locId) || { label, qty: 0, sizes: [] };
      g.qty += Number(s.qty) || 0;
      g.sizes.push({ size: s.size, qty: Number(s.qty) || 0 });
      groups.set(locId, g);
    }
    const stockLocations = Array.from(groups.entries()).map(([locId, g]) => ({
      vesselLocationId: locId, locationId: locId,
      locationName: g.label, location_name: g.label, subLocation: g.label,
      quantity: g.qty, qty: g.qty, sizes: g.sizes,
    }));
    const payload = {
      ...(isEdit ? { id: item.id, cargoItemId: item.cargoItemId } : {}),
      name: name.trim(), imageUrl, brand: brand.trim(), supplier: supplier.trim(), notes,
      unitCost: unitCost === '' ? null : parseFloat(unitCost), currency,
      location: loc, subLocation: sub,
      hasVariants: true, variantType: 'size', variants,
      quantity: total, totalQty: total, stockLocations,
      defaultLocationId: storageLocId || null,
      isUniform: true, customFields, condition: item?.condition || 'New',
    };
    const res = await saveItem(payload, { dedupe: false });
    setSaving(false);
    if (res) onClose?.(); else setError('Could not save. Please try again.');
  };

  const L = ({ children, opt }) => <label className="uim-l">{children}{opt && <span className="uim-opt">optional</span>}</label>;

  return (
    <div className="uim-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="uim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="uim-head">
          <div>
            <span className="uim-eyebrow">{isEdit ? 'Edit uniform' : 'New uniform'}</span>
            <h2 className="uim-title">{name.trim() || 'Uniform item'}</h2>
            <p className="uim-folder"><Icon name="Folder" size={12} /> {[loc, sub].filter(Boolean).join(' › ')}</p>
          </div>
          <button type="button" className="uim-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="uim-body">
          <div className="uim-top">
            <div className="uim-photo-col">
              <label className="uim-photo">
                {imageUrl ? <img src={imageUrl} alt="" /> : <span className="uim-photo-ph"><Icon name={uploading ? 'Loader' : 'Camera'} size={22} /><span>{uploading ? 'Uploading…' : 'Add photo'}</span></span>}
                <input type="file" accept="image/*" onChange={upload} hidden />
              </label>
              {imageUrl && !uploading && (
                originalUrl ? (
                  <button type="button" className="uim-mini" onClick={() => { setImageUrl(originalUrl); setOriginalUrl(''); }}>↺ Use original</button>
                ) : (
                  <button type="button" className="uim-mini" onClick={removeBg} disabled={removingBg}><Icon name="Scissors" size={12} /> {removingBg ? 'Removing…' : 'Remove background'}</button>
                )
              )}
              {uploadError && <span className="uim-bg-err">{uploadError}</span>}
              {bgError && <span className="uim-bg-err">{bgError}</span>}
            </div>
            <div className="uim-top-fields">
              <L>Item / style <span className="uim-req">required</span></L>
              <input className="uim-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Musto Sardinia 2.0 Jacket" />
              <div className="uim-row2">
                <div><L>Garment</L><div className="uim-sel"><select value={garmentType} onChange={(e) => setGarmentType(e.target.value)}><option value="">—</option>{GARMENTS.map((g) => <option key={g}>{g}</option>)}</select></div></div>
                <div><L opt>Sub-type</L><input className="uim-input" value={subType} onChange={(e) => setSubType(e.target.value)} placeholder="Polo, Fleece, Shorts…" /></div>
              </div>
              <div className="uim-row2">
                <div><L>Fit</L><div className="uim-sel"><select value={fit} onChange={(e) => setFit(e.target.value)}><option value="">—</option>{FITS.map((f) => <option key={f}>{f}</option>)}</select></div></div>
                <div><L opt>Colour</L><input className="uim-input" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="Navy" /></div>
              </div>
            </div>
          </div>

          {/* Size run */}
          <div className="uim-sec">
            <div className="uim-sec-h"><span>Size run</span><span className="uim-total">{total} total</span></div>
            {sizes.length > 0 && (
              <div className="uim-sizes">
                {sizes.map((s, i) => (
                  <div className="uim-size" key={s.size}>
                    <span className="uim-size-lbl">{s.size}</span>
                    <input className="uim-size-qty" type="number" min="0" value={s.qty} onChange={(e) => setQty(i, e.target.value)} placeholder="0" />
                    <button type="button" className={`uim-size-loc${s.locId ? ' on' : ''}`}
                      title={s.locId ? `Stored at ${s.locLabel}` : 'Stored with the rest — tap to store this size elsewhere'}
                      onClick={() => setPickerTarget(i)}><Icon name="MapPin" size={12} /></button>
                    <button type="button" className="uim-size-x" onClick={() => removeSize(i)} aria-label="Remove"><Icon name="X" size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            {sizes.some((s) => s.locId) && (
              <div className="uim-split">
                <span className="uim-split-h">Split storage</span>
                {sizes.filter((s) => s.locId).map((s) => (
                  <span className="uim-split-row" key={s.size}>
                    <b>{s.size}</b><Icon name="MapPin" size={11} />{s.locLabel}
                    <button type="button" onClick={() => setSizes((p) => p.map((x) => (x.size === s.size ? { ...x, locId: '', locLabel: '' } : x)))} aria-label="Clear"><Icon name="X" size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="uim-size-add">
              {COMMON_SIZES.filter((s) => !sizes.some((x) => x.size === s)).map((s) => (
                <button type="button" key={s} className="uim-chip" onClick={() => addSize(s)}>+ {s}</button>
              ))}
              <span className="uim-size-custom">
                <input className="uim-input sm" value={customSize} onChange={(e) => setCustomSize(e.target.value)} placeholder="e.g. 42, One size"
                  onKeyDown={(e) => { if (e.key === 'Enter') { addSize(customSize); setCustomSize(''); } }} />
                <button type="button" className="uim-chip" onClick={() => { addSize(customSize); setCustomSize(''); }}>Add</button>
              </span>
            </div>
          </div>

          {/* Storage on board — links to the location-management / GA map */}
          <div className="uim-sec">
            <div className="uim-sec-h"><span>Storage on board</span></div>
            <L opt>Default location <span className="uim-opt">all sizes</span></L>
            <button type="button" className="uim-locpick" onClick={() => setPickerTarget('main')} disabled={vesselLoading}>
              <span className="uim-locpick-l">
                <Icon name="MapPin" size={15} />
                <span className={storageLocId ? 'uim-locpick-val' : 'uim-locpick-ph'}>
                  {storageLocId ? (storageLabel || 'Selected location') : (vesselLoading ? 'Loading map…' : 'Link to a location on the vessel map')}
                </span>
              </span>
              <span className="uim-locpick-r">
                {storageLocId && (
                  <span role="button" tabIndex={0} className="uim-locpick-clear" title="Clear"
                    onClick={(e) => { e.stopPropagation(); setStorageLocId(''); setStorageLabel(''); }}>
                    <Icon name="X" size={13} />
                  </span>
                )}
                <Icon name="ChevronRight" size={15} />
              </span>
            </button>
            <p className="uim-hint">Applies to every size that isn’t pinned to its own location in the size run above. So Interior can see where the uniform is kept — manage the map in Location management.</p>
            {gapSizes.length > 0 && (
              <p className="uim-nudge">
                <Icon name="AlertCircle" size={14} />
                <span><b>{gapSizes.map((s) => s.size).join(', ')}</b> {gapSizes.length === 1 ? 'isn’t' : 'aren’t'} stored anywhere yet — set a default location above, or pin {gapSizes.length === 1 ? 'it' : 'them'} in the size run.</span>
              </p>
            )}
          </div>

          {/* Branding */}
          <div className="uim-sec">
            <div className="uim-sec-h"><span>Branding</span></div>
            <div className="uim-row2">
              <div><L>Type</L><div className="uim-sel"><select value={brandingType} onChange={(e) => setBrandingType(e.target.value)}>{BRANDING.map((b) => <option key={b}>{b}</option>)}</select></div></div>
              <div><L opt>Thread / print colour</L><input className="uim-input" value={brandingColour} onChange={(e) => setBrandingColour(e.target.value)} placeholder="Turquoise" disabled={brandingType === 'None'} /></div>
            </div>
            {brandingType !== 'None' && (
              <div className="uim-row2">
                <div><L opt>Logo / text</L><input className="uim-input" value={brandingLogo} onChange={(e) => setBrandingLogo(e.target.value)} placeholder="M/Y name" /></div>
                <div><L opt>Placement</L><input className="uim-input" value={brandingPlacement} onChange={(e) => setBrandingPlacement(e.target.value)} placeholder="Left chest" /></div>
              </div>
            )}
          </div>

          {/* Care */}
          <div className="uim-sec">
            <div className="uim-sec-h"><span>Care</span></div>
            <div className="uim-row2">
              <div><L opt>Fabric / material</L><input className="uim-input" value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="100% cotton" /></div>
              <div><L>Season</L><div className="uim-sel"><select value={season} onChange={(e) => setSeason(e.target.value)}>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select></div></div>
            </div>
            <L opt>Care instructions</L>
            <input className="uim-input" value={care} onChange={(e) => setCare(e.target.value)} placeholder="40° wash, no tumble" />
          </div>

          {/* Supply */}
          <div className="uim-sec">
            <div className="uim-sec-h"><span>Supply</span></div>
            <div className="uim-row2">
              <div><L opt>Brand</L><input className="uim-input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Musto" /></div>
              <div><L opt>Supplier</L><input className="uim-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Superyacht Uniform" /></div>
            </div>
            <div className="uim-row2">
              <div><L opt>Style code / SKU</L><input className="uim-input" value={styleCode} onChange={(e) => setStyleCode(e.target.value)} placeholder="Supplier reorder ref" /></div>
              <div><L opt>Unit cost</L>
                <div className="uim-cost">
                  <div className="uim-sel uim-cur"><select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                  <input className="uim-input" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            </div>
          </div>

          <L opt>Notes</L>
          <input className="uim-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else" />
          {error && <p className="uim-error">{error}</p>}
        </div>

        <div className="uim-foot">
          <button type="button" className="uim-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="uim-btn primary" disabled={!name.trim() || saving} onClick={save}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add uniform'}</button>
        </div>
      </div>

      {pickerTarget !== null && (
        <LocationPicker
          vesselLocations={vesselLocations}
          selectedId={pickerTarget === 'main' ? storageLocId : (sizes[pickerTarget]?.locId || '')}
          onSelect={({ id, label }) => {
            if (pickerTarget === 'main') { setStorageLocId(id); setStorageLabel(label); }
            else setSizes((p) => p.map((s, idx) => (idx === pickerTarget ? { ...s, locId: id, locLabel: label } : s)));
            setPickerTarget(null);
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  );
};

export default UniformItemModal;
