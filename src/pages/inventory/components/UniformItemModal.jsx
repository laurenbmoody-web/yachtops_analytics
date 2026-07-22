import React, { useMemo, useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { saveItem } from '../utils/inventoryStorage';
import { LocationPicker } from './AddEditItemModal';
import { spaceLeaf, spaceSegments } from '../utils/vesselPath';
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
  const [isolating, setIsolating] = useState(false);
  const [originalUrl, setOriginalUrl] = useState(''); // pre-cutout image, for undo
  const [bgError, setBgError] = useState('');
  const [garmentType, setGarmentType] = useState(cf.garmentType || folder.garment || '');
  const [subType, setSubType] = useState(cf.subType || '');
  const [fit, setFit] = useState(cf.fit || folder.fit || '');
  const [colour, setColour] = useState(cf.colour || '');
  const [brand, setBrand] = useState(item?.brand || '');
  const [styleCode, setStyleCode] = useState(cf.styleCode || '');
  // Stock is a size × location matrix: `sizeCols` are the sizes (columns) and
  // `blocks` are locations (rows), each holding a qty per size. The same size can
  // sit in several locations (3 M in a cabin, 5 M in the lazarette, …).
  const initStock = () => {
    const sls = (item?.stockLocations || []).filter((s) => Array.isArray(s.sizes) && s.sizes.length);
    if (sls.length) {
      const cols = [];
      sls.forEach((sl) => sl.sizes.forEach((z) => { if (z.size && !cols.includes(z.size)) cols.push(z.size); }));
      const blocks = sls.map((sl) => ({
        locId: sl.vesselLocationId || sl.locationId || '',
        locLabel: sl.locationName || sl.location_name || sl.subLocation || '',
        qty: Object.fromEntries((sl.sizes || []).map((z) => [z.size, z.qty])),
      }));
      return { cols, blocks };
    }
    const vs = (item?.variants || []).filter((v) => v && (v.size || v.label));
    if (vs.length) {
      const first = (item?.stockLocations || [])[0] || {};
      return {
        cols: vs.map((v) => v.size || v.label),
        blocks: [{
          locId: first.vesselLocationId || first.locationId || '',
          locLabel: first.locationName || first.location_name || first.subLocation || '',
          qty: Object.fromEntries(vs.map((v) => [v.size || v.label, v.qty ?? v.quantity ?? 0])),
        }],
      };
    }
    return { cols: [], blocks: [{ locId: '', locLabel: '', qty: {} }] };
  };
  const _init = useMemo(() => initStock(), []);
  const [sizeCols, setSizeCols] = useState(_init.cols);
  const [blocks, setBlocks] = useState(_init.blocks);
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

  const [vesselLocations, setVesselLocations] = useState([]);
  const [vesselLoading, setVesselLoading] = useState(false);
  // Location picker target: a block index (which location row we're setting), or null.
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

  // Refresh block location labels once the map loads (covers items saved before).
  useEffect(() => {
    if (!vesselLocations.length) return;
    const byId = new Map(vesselLocations.map((n) => [n.id, n]));
    const labelOf = (id) => {
      const chain = []; const seen = new Set(); let cur = byId.get(id);
      while (cur && !seen.has(cur.id)) { chain.unshift(cur); seen.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
      return chain.length ? chain.map((n) => n.name).join(' › ') : '';
    };
    setBlocks((prev) => prev.map((b) => (b.locId && byId.has(b.locId) ? { ...b, locLabel: labelOf(b.locId) } : b)));
  }, [vesselLocations]);

  // Matrix helpers.
  const cellQty = (b, s) => Number(b.qty[s]) || 0;
  const blockTotal = (b) => sizeCols.reduce((a, s) => a + cellQty(b, s), 0);
  const sizeTotal = (s) => blocks.reduce((a, b) => a + cellQty(b, s), 0);
  const total = blocks.reduce((a, b) => a + blockTotal(b), 0);

  const addSizeCol = (s) => { const v = (s || '').trim(); if (!v || sizeCols.some((x) => x.toLowerCase() === v.toLowerCase())) return; setSizeCols((p) => [...p, v]); };
  const removeSizeCol = (s) => { setSizeCols((p) => p.filter((x) => x !== s)); setBlocks((p) => p.map((b) => { const q = { ...b.qty }; delete q[s]; return { ...b, qty: q }; })); };
  const setCell = (bi, s, val) => setBlocks((p) => p.map((b, i) => (i === bi ? { ...b, qty: { ...b.qty, [s]: val } } : b)));
  const addBlock = () => setBlocks((p) => [...p, { locId: '', locLabel: '', qty: {} }]);
  const removeBlock = (bi) => setBlocks((p) => (p.length > 1 ? p.filter((_, i) => i !== bi) : p));

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

  // Cut out just the item — drops the person AND the background. SAM2 segments
  // the object at a point; for these product shots the item dominates the frame,
  // so we auto-point at the upper-centre. The mask is composited onto the photo
  // client-side (canvas destination-in) and the transparent cut-out uploaded.
  const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load'));
    img.src = src;
  });

  const isolateGarment = async () => {
    if (!imageUrl || isolating) return;
    setIsolating(true); setBgError('');
    try {
      const img = await loadImg(imageUrl);
      // Work at a capped size (SAM is fine at ~1024; keeps the base64 payload small).
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];

      const { data, error: fnErr } = await supabase.functions.invoke('deck-plan-sam', {
        body: { imageBase64: b64, x: Math.round(w / 2), y: Math.round(h * 0.42), mediaType: 'image/jpeg' },
      });
      if (fnErr || !data?.maskUrl) {
        let detail = fnErr?.message || '';
        try { const body = await fnErr?.context?.json?.(); if (body?.detail || body?.error) detail = body.detail || body.error; } catch { /* not json */ }
        setBgError(`Couldn’t isolate the garment — ${detail || 'try again.'}`.slice(0, 280));
        setIsolating(false); return;
      }

      // Composite: keep the photo only where the mask is white (the garment).
      const mask = await loadImg(data.maskUrl);
      const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
      const mctx = mc.getContext('2d'); mctx.drawImage(mask, 0, 0, w, h);
      const md = mctx.getImageData(0, 0, w, h);
      // Turn the mask into an alpha layer (luminance → alpha).
      for (let i = 0; i < md.data.length; i += 4) {
        const a = md.data[i]; // white ≈ keep
        md.data[i] = 0; md.data[i + 1] = 0; md.data[i + 2] = 0; md.data[i + 3] = a;
      }
      mctx.putImageData(md, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mc, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      if (!blob) { setBgError('Couldn’t isolate the garment — try again.'); setIsolating(false); return; }
      const { data: ctx2 } = await supabase?.rpc('get_my_context');
      const tenantId = ctx2?.[0]?.tenant_id || 'shared';
      const path = `inventory/${tenantId}/isolated-${Date.now()}.png`;
      const { error: upErr } = await supabase?.storage?.from('item-images')?.upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) { setBgError(`Couldn’t save the cut-out — ${upErr.message || 'try again.'}`); setIsolating(false); return; }
      const { data: urlData } = supabase?.storage?.from('item-images')?.getPublicUrl(path);
      setOriginalUrl(imageUrl); setImageUrl(urlData?.publicUrl || '');
    } catch (e) {
      // A canvas taint (cross-origin without CORS) lands here.
      setBgError(`Couldn’t isolate the garment — ${e?.message || 'try again.'}`);
    }
    setIsolating(false);
  };

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    const customFields = {
      fit, garmentType, subType: subType.trim(), colour: colour.trim(), styleCode: styleCode.trim(),
      branding: { type: brandingType, colour: brandingColour.trim(), logo: brandingLogo.trim(), placement: brandingPlacement.trim() },
      fabric: fabric.trim(), care: care.trim(), season,
    };
    // stock_locations IS the size × location matrix: one row per location, each
    // with a size breakdown. variants are the per-size totals (summed across
    // locations) used for the size-run display and issue-by-size.
    const stockLocations = blocks.map((b) => {
      const szs = sizeCols.map((s) => ({ size: s, qty: cellQty(b, s) })).filter((x) => x.qty > 0);
      const quantity = szs.reduce((a, x) => a + x.qty, 0);
      return {
        vesselLocationId: b.locId || '', locationId: b.locId || '',
        locationName: b.locLabel || '', location_name: b.locLabel || '', subLocation: b.locLabel || '',
        sizes: szs, quantity, qty: quantity,
      };
    }).filter((sl) => sl.quantity > 0);
    const variants = sizeCols.map((s) => ({ size: s, qty: sizeTotal(s) }));
    const firstLoc = blocks.find((b) => b.locId);
    const payload = {
      ...(isEdit ? { id: item.id, cargoItemId: item.cargoItemId } : {}),
      name: name.trim(), imageUrl, brand: brand.trim(), supplier: supplier.trim(), notes,
      unitCost: unitCost === '' ? null : parseFloat(unitCost), currency,
      location: loc, subLocation: sub,
      hasVariants: true, variantType: 'size', variants,
      quantity: total, totalQty: total, stockLocations,
      defaultLocationId: firstLoc?.locId || null,
      isUniform: true, customFields, condition: item?.condition || 'New',
    };
    const res = await saveItem(payload, { dedupe: false });
    setSaving(false);
    if (res) onClose?.(); else setError('Could not save. Please try again.');
  };

  const L = ({ children, opt }) => <label className="uim-l">{children}{opt && <span className="uim-opt">optional</span>}</label>;

  return (
    <div className="uim-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
                  <button type="button" className="uim-mini" onClick={isolateGarment} disabled={isolating}><Icon name="Scissors" size={12} /> {isolating ? 'Cleaning up…' : 'Cut out the item'}</button>
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

          {/* Stock by location — a size × location matrix. The same size can sit
              in several places (3 M in a cabin, 5 M in the lazarette, …). */}
          <div className="uim-sec">
            <div className="uim-sec-h"><span>Stock by location</span><span className="uim-total">{total} total</span></div>

            <L opt>Sizes</L>
            <div className="uim-size-add">
              {sizeCols.map((s) => (
                <span className="uim-szchip" key={s}>{s}<button type="button" onClick={() => removeSizeCol(s)} aria-label={`Remove ${s}`}><Icon name="X" size={11} /></button></span>
              ))}
              {COMMON_SIZES.filter((s) => !sizeCols.includes(s)).map((s) => (
                <button type="button" key={s} className="uim-chip" onClick={() => addSizeCol(s)}>+ {s}</button>
              ))}
              <span className="uim-size-custom">
                <input className="uim-input sm" value={customSize} onChange={(e) => setCustomSize(e.target.value)} placeholder="e.g. 42, One size"
                  onKeyDown={(e) => { if (e.key === 'Enter') { addSizeCol(customSize); setCustomSize(''); } }} />
                <button type="button" className="uim-chip" onClick={() => { addSizeCol(customSize); setCustomSize(''); }}>Add</button>
              </span>
            </div>

            {sizeCols.length === 0 ? (
              <p className="uim-hint" style={{ marginTop: 12 }}>Add sizes above to start logging quantities by location.</p>
            ) : (
              <div className="uim-mtx-wrap">
                <table className="uim-mtx">
                  <thead>
                    <tr>
                      <th className="loc">Location</th>
                      {sizeCols.map((s) => <th key={s}>{s}</th>)}
                      <th className="tot">Total</th>
                      <th aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((b, bi) => (
                      <tr key={bi}>
                        <th className="loc">
                          <button type="button" className="uim-mtx-loc" onClick={() => setPickerTarget(bi)} disabled={vesselLoading}
                            title={b.locId ? spaceSegments(b.locLabel).join(' › ') : undefined}>
                            <Icon name="MapPin" size={13} />
                            <span className={b.locId ? 'val' : 'ph'}>{b.locId ? (spaceLeaf(b.locLabel) || 'Location') : (vesselLoading ? 'Loading…' : 'Set location')}</span>
                            <Icon name="ChevronRight" size={13} />
                          </button>
                        </th>
                        {sizeCols.map((s) => (
                          <td key={s}><input className="uim-mtx-in" type="number" min="0" value={b.qty[s] ?? ''} onChange={(e) => setCell(bi, s, e.target.value)} placeholder="0" /></td>
                        ))}
                        <td className="tot">{blockTotal(b)}</td>
                        <td>{blocks.length > 1 && <button type="button" className="uim-mtx-x" onClick={() => removeBlock(bi)} aria-label="Remove location"><Icon name="X" size={13} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th className="loc">Per size</th>
                      {sizeCols.map((s) => <td key={s} className="tot">{sizeTotal(s)}</td>)}
                      <td className="tot">{total}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <button type="button" className="uim-addloc" onClick={addBlock}><Icon name="Plus" size={14} /> Add another location</button>
            <p className="uim-hint">One row per location, one column per size — tab across like a sheet. Leave a location unset to log stock that isn’t placed yet.</p>
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
          selectedId={blocks[pickerTarget]?.locId || ''}
          onSelect={({ id, label }) => {
            setBlocks((p) => p.map((b, idx) => (idx === pickerTarget ? { ...b, locId: id, locLabel: label } : b)));
            setPickerTarget(null);
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  );
};

export default UniformItemModal;
