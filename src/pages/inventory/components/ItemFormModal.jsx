import React, { useState, useMemo, useEffect } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import InventoryFolderPicker from './InventoryFolderPicker';
import { LocationPicker } from './AddEditItemModal';
import { getFolderTree } from '../utils/inventoryStorage';
import './item-form.css';

// Type-driven inventory item form. Profiles tailor the fields; the folder
// stays the category and just suggests the profile. Fields that map to real
// inventory_items columns are saved directly; profile-specific extras go in
// custom_fields; uniform sizes use the variants mechanism.

const PROFILES = [
  { id: 'general', label: 'General', icon: 'Package' },
  { id: 'bonded', label: 'Bonded', icon: 'Wine' },
  { id: 'eng', label: 'Engineering', icon: 'Wrench' },
  { id: 'uniform', label: 'Uniform', icon: 'Shirt' },
];
const PROFILE_TITLE = { bonded: 'Bonded store', eng: 'Engineering', uniform: 'Uniform' };
const PROFILE_ICON = { bonded: 'Wine', eng: 'Wrench', uniform: 'Shirt' };

const SIZE_SETS = {
  alpha: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  waist: ['28', '30', '32', '34', '36', '38'],
  waistin: ['30/30', '32/32', '34/32', '36/34'],
  youth: ['XS', 'S', 'M', 'L', '8-10', '12-14'],
  one: ['One size'],
  custom: [],
};
const SHOE = [{ uk: '6', eu: '39', us: '7' }, { uk: '7', eu: '41', us: '8' }, { uk: '8', eu: '42', us: '9' }, { uk: '9', eu: '43', us: '10' }, { uk: '10', eu: '44', us: '11' }, { uk: '11', eu: '45', us: '12' }];
const WOMEN = [{ us: '2', eu: '34', uk: '6' }, { us: '4', eu: '36', uk: '8' }, { us: '6', eu: '38', uk: '10' }, { us: '8', eu: '40', uk: '12' }, { us: '10', eu: '42', uk: '14' }];
const isMultiSize = (t) => t === 'shoe' || t === 'women';

const FLAGS = [
  { id: 'hazardous', label: 'Hazardous', icon: 'AlertTriangle', tip: 'Dangerous-goods stowage & MARPOL. Covers cleaning & engine chemicals.' },
  { id: 'fragile', label: 'Fragile', icon: 'Wine', tip: 'Handling / stowage caution.' },
  { id: 'critical', label: 'Critical', icon: 'AlertOctagon', tip: 'Hard low-stock alert & links to planned maintenance.' },
];
const ADDONS = [
  { id: 'medical', label: 'Medical' },
  { id: 'food', label: 'Food' },
  { id: 'maint', label: 'Maintenance' },
];
const ALLERGENS = ['Gluten', 'Nuts', 'Dairy', 'Shellfish', 'Soy', 'Egg'];
const FREQS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Every 6 months', 'Annually', 'Custom…'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const autoProfile = (folder) => {
  const f = String(folder || '').toLowerCase();
  if (/bond|cellar|wine|spirit|tobacco|cigar/.test(f)) return 'bonded';
  if (/engineer|spare|part|machin|filter/.test(f)) return 'eng';
  if (/uniform|crew.?kit|wardrobe/.test(f)) return 'uniform';
  return 'general';
};

const Sec = ({ id, icon, name, open, onToggle, summary, children }) => (
  <div className={`itf-sec${open ? ' open' : ''}`}>
    <div className="itf-sec-h" onClick={onToggle}>
      <span className="itf-sec-n"><span className="ic"><Icon name={icon} size={15} /></span>{name}</span>
      <span className="itf-sum">{summary}</span>
      <span className="itf-chev">▾</span>
    </div>
    <div className="itf-sec-b">{children}</div>
  </div>
);

const ItemFormModal = ({ item, defaultLocation, defaultSubLocation, onClose, onSaved }) => {
  const isEdit = !!item;
  const folderDisplay = defaultSubLocation ? `${defaultLocation} > ${defaultSubLocation}` : (defaultLocation || '');

  const [profile, setProfile] = useState(item?.customFields?.profile || autoProfile(folderDisplay));
  const [open, setOpen] = useState({ identity: true, details: true, stock: true, buying: false, handling: false, docs: false, ref: false });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // core fields
  const [name, setName] = useState(item?.name || '');
  const [description, setDescription] = useState(item?.description || '');
  const [imageUrl, setImageUrl] = useState(item?.imageUrl || '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [folder, setFolder] = useState(folderDisplay);
  const [folderPath, setFolderPath] = useState(defaultLocation ? (defaultSubLocation ? [defaultLocation, defaultSubLocation] : [defaultLocation]) : []);
  const [folderTree, setFolderTree] = useState({});
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [vesselLocations, setVesselLocations] = useState([]);
  const [locRows, setLocRows] = useState([{ label: '', id: '', qty: 0 }]);
  const updateRow = (i, patch) => setLocRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [uniLocId, setUniLocId] = useState('');
  const [locTarget, setLocTarget] = useState(null); // {kind:'stock',idx} | {kind:'uni'}
  const [unit, setUnit] = useState(item?.unit || 'each');
  const [keep, setKeep] = useState(item?.parLevel ?? '');
  const [reorder, setReorder] = useState(item?.reorderPoint ?? '');
  const [size, setSize] = useState(item?.size || '');
  const [expiry, setExpiry] = useState(item?.expiryDate || '');
  const [brand, setBrand] = useState(item?.brand || '');
  const [supplier, setSupplier] = useState(item?.supplier || '');
  const [unitCost, setUnitCost] = useState(item?.unitCost ?? '');
  const [currency, setCurrency] = useState(item?.currency || 'EUR');
  const [purchaseUnit, setPurchaseUnit] = useState(item?.purchaseUnit || '');
  const [unitsPerPack, setUnitsPerPack] = useState(item?.unitsPerPack ?? '');
  const [sku, setSku] = useState(item?.customFields?.sku || '');
  const [barcode, setBarcode] = useState(item?.barcode || '');
  const [tags, setTags] = useState(item?.tags || []);
  const [notes, setNotes] = useState(item?.notes || '');
  const [moreStock, setMoreStock] = useState(false);
  const [moreBuy, setMoreBuy] = useState(false);

  // bonded
  const [bKind, setBKind] = useState(item?.customFields?.bonded?.kind || 'wine');
  const [volume, setVolume] = useState(item?.customFields?.bonded?.volume || '');
  const [abv, setAbv] = useState(item?.customFields?.bonded?.abv || '');
  const [vintage, setVintage] = useState(item?.year ?? '');
  const [tasting, setTasting] = useState(item?.tastingNotes || '');
  const [perPack, setPerPack] = useState(item?.customFields?.bonded?.perPack || '20');
  const [perCarton, setPerCarton] = useState(item?.customFields?.bonded?.perCarton || '10');

  // engineering
  const [eng, setEng] = useState(item?.customFields?.eng || { partNo: '', manufacturer: '', model: '', serial: '', system: '' });
  const [condition, setCondition] = useState(item?.condition || 'New');
  const [moreEng, setMoreEng] = useState(false);

  // uniform
  const [garment, setGarment] = useState(item?.customFields?.uniform?.garment || 'Top');
  const [subType, setSubType] = useState(item?.customFields?.uniform?.subType || '');
  const [fit, setFit] = useState(item?.customFields?.uniform?.fit || 'Womens');
  const [colour, setColour] = useState(item?.customFields?.uniform?.colour || '');
  const [sizeType, setSizeType] = useState(item?.variantType || 'alpha');
  const [region, setRegion] = useState('uk');
  const [sizeOn, setSizeOn] = useState({}); // label -> true
  const [matrix, setMatrix] = useState({}); // "loc||size" -> qty
  const [uniLoc, setUniLoc] = useState("Owner's Cabin");
  const [moreUni, setMoreUni] = useState(false);
  const [branding, setBranding] = useState(item?.customFields?.uniform?.branding || '');
  const [care, setCare] = useState(item?.customFields?.uniform?.care || '');

  // handling
  const [addonOn, setAddonOn] = useState({});
  const [flagOn, setFlagOn] = useState(item?.customFields?.flags || {});
  const [medForm, setMedForm] = useState(item?.customFields?.medical?.form || '');
  const [medMca, setMedMca] = useState(item?.customFields?.medical?.mca || '');
  const [medControlled, setMedControlled] = useState(!!item?.customFields?.medical?.controlled);
  const [foodOrigin, setFoodOrigin] = useState(item?.customFields?.food?.origin || '');
  const [foodAllergens, setFoodAllergens] = useState(item?.customFields?.food?.allergens || []);
  const [mFreq, setMFreq] = useState(item?.customFields?.maintenance?.every || 'Monthly');
  const [mNext, setMNext] = useState(item?.customFields?.maintenance?.nextDue || '');
  const [mDays, setMDays] = useState(item?.customFields?.maintenance?.days || []);
  const [mCheck, setMCheck] = useState(item?.customFields?.maintenance?.check || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // size labels for the current system
  const sizeList = useMemo(() => {
    if (sizeType === 'shoe') return SHOE.map((s) => (region === 'all' ? `${s.uk}·${s.eu}·${s.us}` : s[region] || s.uk));
    if (sizeType === 'women') return WOMEN.map((s) => (region === 'all' ? `${s.us}·${s.eu}·${s.uk}` : s[region] || s.us));
    return SIZE_SETS[sizeType] || [];
  }, [sizeType, region]);

  // default first-4 sizes on when the system changes
  useEffect(() => {
    if (profile !== 'uniform') return;
    const next = {};
    sizeList.forEach((s, i) => { if (i < 4) next[s] = true; });
    setSizeOn(next);
    if (sizeType === 'women') setRegion((r) => (r === 'uk' ? 'us' : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeType, profile]);

  const activeSizes = useMemo(() => sizeList.filter((s) => sizeOn[s]), [sizeList, sizeOn]);
  const cell = (s) => Number(matrix[`${uniLoc}||${s}`]) || 0;
  const setCell = (s, v) => setMatrix((m) => ({ ...m, [`${uniLoc}||${s}`]: v }));
  const rowTotal = activeSizes.reduce((a, s) => a + cell(s), 0);

  const toArr = (obj) => Object.keys(obj).filter((k) => obj[k]);

  // Load the inventory folder tree + vessel locations for the pickers.
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const tree = await getFolderTree(); if (alive) setFolderTree(tree || {}); } catch { /* ignore */ }
      try {
        const { data: ctx } = await supabase.rpc('get_my_context');
        const tid = ctx?.[0]?.tenant_id;
        if (tid) {
          const { data } = await supabase.from('vessel_locations')
            .select('id, name, level, parent_id').eq('tenant_id', tid).eq('is_archived', false)
            .order('sort_order', { ascending: true }).order('name', { ascending: true });
          if (alive && data) setVesselLocations(data);
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  const uploadPhoto = async (file) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoErr('');
    try {
      const { data: ctx } = await supabase.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id || 'shared';
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `inventory/${tenantId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('item-images').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('item-images').getPublicUrl(path);
      setOriginalUrl('');
      setImageUrl(pub?.publicUrl || '');
    } catch (err) { setPhotoErr(`Upload failed — ${err?.message || 'try again.'}`); }
    finally { setPhotoBusy(false); }
  };

  const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img); img.onerror = () => reject(new Error('image load')); img.src = src;
  });

  // Cut the item out of its background via the SAM segmenter (same as uniforms).
  const cutout = async () => {
    if (!imageUrl || photoBusy) return;
    setPhotoBusy(true); setPhotoErr('');
    try {
      const img = await loadImg(imageUrl);
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
      const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
      const { data, error: fnErr } = await supabase.functions.invoke('deck-plan-sam', {
        body: { imageBase64: b64, x: Math.round(w / 2), y: Math.round(h * 0.42), mediaType: 'image/jpeg' },
      });
      if (fnErr || !data?.maskUrl) { setPhotoErr('Couldn’t remove the background — try again.'); setPhotoBusy(false); return; }
      const mask = await loadImg(data.maskUrl);
      const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
      const mctx = mc.getContext('2d'); mctx.drawImage(mask, 0, 0, w, h);
      const md = mctx.getImageData(0, 0, w, h);
      for (let i = 0; i < md.data.length; i += 4) { const a = md.data[i]; md.data[i] = 0; md.data[i + 1] = 0; md.data[i + 2] = 0; md.data[i + 3] = a; }
      mctx.putImageData(md, 0, 0);
      cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mc, 0, 0); cx.globalCompositeOperation = 'source-over';
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      if (!blob) { setPhotoErr('Couldn’t remove the background — try again.'); setPhotoBusy(false); return; }
      const { data: ctx2 } = await supabase.rpc('get_my_context');
      const tenantId = ctx2?.[0]?.tenant_id || 'shared';
      const path = `inventory/${tenantId}/isolated-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from('item-images').upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) { setPhotoErr('Couldn’t save the cut-out — try again.'); setPhotoBusy(false); return; }
      const { data: urlData } = supabase.storage.from('item-images').getPublicUrl(path);
      setOriginalUrl(imageUrl); setImageUrl(urlData?.publicUrl || '');
    } catch (e) { setPhotoErr(`Couldn’t remove the background — ${e?.message || 'try again.'}`); }
    finally { setPhotoBusy(false); }
  };

  const save = async () => {
    if (!name.trim()) { setError('Item name is required.'); setOpen((o) => ({ ...o, identity: true })); return; }
    setSaving(true); setError('');
    try {
      const { data: ctx } = await supabase.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id;
      if (!tenantId) throw new Error('No tenant context');

      const segs = folderPath.length ? folderPath : String(folder || '').split('>').map((s) => s.trim()).filter(Boolean);
      const location = segs[0] || null;
      const sub_location = segs.length ? segs.join(' > ') : null;

      // uniform → variants (one per active size, qty summed across the matrix)
      let variants = null; let has_variants = false; let variant_type = null; let totalQty = 0;
      let stock_locations = [];
      if (profile === 'uniform') {
        has_variants = true; variant_type = sizeType;
        variants = activeSizes.map((s) => ({ size: s, qty: cell(s) }));
        totalQty = variants.reduce((a, v) => a + (v.qty || 0), 0);
        if (activeSizes.length) stock_locations = [{ locationName: uniLoc, vesselLocationId: uniLocId || undefined, qty: totalQty, sizes: variants }];
      } else {
        const rows = locRows.filter((r) => r.label || r.qty);
        stock_locations = rows.map((r) => ({ locationName: r.label || '—', vesselLocationId: r.id || undefined, qty: r.qty || 0 }));
        totalQty = rows.reduce((a, r) => a + (r.qty || 0), 0);
      }

      const custom_fields = {
        profile,
        sku: sku || undefined,
        bonded: profile === 'bonded' ? { kind: bKind, volume, abv, perPack, perCarton } : undefined,
        eng: profile === 'eng' ? eng : undefined,
        uniform: profile === 'uniform' ? { garment, subType, fit, colour, sizeType, region, branding, care } : undefined,
        flags: toArr(flagOn).length ? flagOn : undefined,
        medical: addonOn.medical ? { form: medForm, mca: medMca, controlled: medControlled } : undefined,
        food: addonOn.food ? { origin: foodOrigin, allergens: foodAllergens } : undefined,
        maintenance: addonOn.maint ? { every: mFreq, nextDue: mNext, days: mDays, check: mCheck } : undefined,
      };

      const payload = {
        tenant_id: tenantId,
        name: name.trim(),
        description: description || null,
        image_url: imageUrl || null,
        brand: brand || null,
        supplier: supplier || null,
        unit: unit || 'each',
        size: profile === 'bonded' ? (volume || size || null) : (profile === 'uniform' ? null : size || null),
        unit_cost: unitCost === '' ? null : Number(unitCost),
        currency: currency || null,
        purchase_unit: purchaseUnit || null,
        units_per_pack: unitsPerPack === '' ? null : Number(unitsPerPack),
        par_level: keep === '' ? null : Number(keep),
        reorder_point: reorder === '' ? null : Number(reorder),
        restock_level: reorder === '' ? null : Number(reorder),
        barcode: barcode || null,
        tags: tags.length ? tags : null,
        notes: notes || null,
        expiry_date: profile === 'uniform' ? null : (expiry || null),
        year: profile === 'bonded' && vintage !== '' ? Number(vintage) : null,
        tasting_notes: profile === 'bonded' ? (tasting || null) : null,
        condition: profile === 'eng' ? condition : null,
        is_alcohol: profile === 'bonded' && (bKind === 'wine' || bKind === 'spirit' || bKind === 'beer'),
        is_uniform: profile === 'uniform',
        location, sub_location,
        default_location_id: locRows[0]?.id || uniLocId || null,
        quantity: totalQty, total_qty: totalQty,
        has_variants, variant_type, variants,
        stock_locations,
        custom_fields,
      };

      let res;
      if (isEdit) res = await supabase.from('inventory_items').update(payload).eq('id', item.id).eq('tenant_id', tenantId);
      else res = await supabase.from('inventory_items').insert(payload);
      if (res.error) throw res.error;
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error('[ItemFormModal] save failed:', err);
      setError(err?.message || 'Couldn’t save — try again.');
    } finally {
      setSaving(false);
    }
  };

  const pickProfile = (p) => {
    setProfile(p);
    if (p !== 'general') setOpen((o) => ({ ...o, details: true }));
  };
  const handleFolderSelect = ({ path, displayPath }) => {
    setFolder(displayPath); setFolderPath(path || []);
    if (!isEdit) setProfile(autoProfile(displayPath));
    setShowFolderPicker(false);
  };
  const handleLocPicked = ({ id, label }) => {
    if (locTarget?.kind === 'uni') { setUniLoc(label); setUniLocId(id); }
    else if (locTarget?.kind === 'stock') { updateRow(locTarget.idx, { label, id }); }
    setLocTarget(null);
  };

  // ── render ──
  const handSummary = [...toArr(addonOn).map((a) => ADDONS.find((x) => x.id === a)?.label), ...toArr(flagOn).map((f) => FLAGS.find((x) => x.id === f)?.label)].filter(Boolean);

  return (
    <>
    <ModalShell onClose={onClose} panelClassName="itf bg-card rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
      <div className="itf-head">
        <div><div className="itf-eyebrow">Inventory {isEdit ? '· Edit' : '· New'}</div><div className="itf-title">{isEdit ? 'Edit item' : 'Add item'}</div></div>
        <button className="itf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
      </div>

      <div className="itf-body">
        {/* 1 IDENTITY */}
        <Sec icon="Package" name="Identity" open={open.identity} onToggle={() => toggle('identity')}>
          <div className="itf-idcard">
            <div className="itf-phcol">
              <label className="itf-ph">
                {photoBusy ? <span className="itf-spin" /> : imageUrl ? <img src={imageUrl} alt="" /> : <>＋<br />Photo</>}
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadPhoto(f); }} />
              </label>
              {imageUrl && !photoBusy && (
                <div className="itf-phacts">
                  {originalUrl ? <button type="button" onClick={() => { setImageUrl(originalUrl); setOriginalUrl(''); }}>↩ Revert</button>
                    : <button type="button" onClick={cutout}>✂ Cut out</button>}
                  <button type="button" onClick={() => { setImageUrl(''); setOriginalUrl(''); }}>Remove</button>
                </div>
              )}
            </div>
            <div className="itf-idf">
              <input className="itf-nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
              <textarea className="itf-ds" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description (optional)" />
              {photoErr && <div className="itf-err" style={{ marginTop: 4 }}>{photoErr}</div>}
            </div>
          </div>
          <div className="itf-slab" style={{ marginTop: 16 }}>Profile</div>
          <div className="itf-types">
            {PROFILES.map((p) => (
              <span key={p.id} className={`itf-type${profile === p.id ? ' on' : ''}`} onClick={() => pickProfile(p.id)}>
                <Icon name={p.icon} size={15} />{p.label}
              </span>
            ))}
          </div>
          <div className="itf-f" style={{ marginTop: 14, marginBottom: 0 }}>
            <label className="itf-lab">Folder <span className="opt">· category in inventory tree</span></label>
            <button type="button" className="itf-pick" onClick={() => setShowFolderPicker(true)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><Icon name="Folder" size={15} style={{ color: '#C65A1A', flexShrink: 0 }} /><span className={folder ? '' : 'ph'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder || 'Select folder…'}</span></span>
              <Icon name="ChevronRight" size={15} style={{ color: '#AEB4C2', flexShrink: 0 }} />
            </button>
          </div>
        </Sec>

        {/* 2 DETAILS */}
        {profile !== 'general' && (
          <Sec icon={PROFILE_ICON[profile]} name={PROFILE_TITLE[profile]} open={open.details} onToggle={() => toggle('details')}>
            {profile === 'bonded' && (
              <>
                <div className="itf-chips" style={{ marginBottom: 14 }}>
                  {['wine', 'spirit', 'beer', 'cig', 'cigar'].map((k) => (
                    <span key={k} className={`itf-chip${bKind === k ? ' on' : ''}`} onClick={() => setBKind(k)}>{{ wine: 'Wine', spirit: 'Spirit', beer: 'Beer', cig: 'Cigarettes', cigar: 'Cigars' }[k]}</span>
                  ))}
                </div>
                {(bKind === 'wine' || bKind === 'spirit' || bKind === 'beer') ? (
                  <>
                    <div className="itf-g2"><div className="itf-f"><label className="itf-lab">Volume</label><div className="itf-adorn"><input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="750" /><span className="tail"><select><option>ml</option><option>cl</option><option>L</option></select></span></div></div><div className="itf-f"><label className="itf-lab">ABV %</label><input className="itf-in" value={abv} onChange={(e) => setAbv(e.target.value)} placeholder="13.5" /></div></div>
                    <div className="itf-f" style={{ marginBottom: 0 }}><label className="itf-lab">Vintage <span className="opt">(wine)</span></label><input className="itf-in" value={vintage} onChange={(e) => setVintage(e.target.value)} placeholder="2019" /></div>
                  </>
                ) : (
                  <>
                    <div className="itf-g2"><div className="itf-f"><label className="itf-lab">Cigarettes / pack</label><input className="itf-in" value={perPack} onChange={(e) => setPerPack(e.target.value)} /></div><div className="itf-f"><label className="itf-lab">Packs / carton</label><input className="itf-in" value={perCarton} onChange={(e) => setPerCarton(e.target.value)} /></div></div>
                    <div className="itf-hint" style={{ marginBottom: 0 }}>↺ 1 carton = <b>{(Number(perPack) || 0) * (Number(perCarton) || 0)}</b> cigarettes</div>
                  </>
                )}
                <div className="itf-note" style={{ marginTop: 12 }}><span>◆</span><span>Bonded / duty-free — counts toward the <b>bonded stores report</b>.</span></div>
              </>
            )}

            {profile === 'eng' && (
              <>
                <div className="itf-g2"><div className="itf-f"><label className="itf-lab">Part number</label><input className="itf-in" value={eng.partNo} onChange={(e) => setEng({ ...eng, partNo: e.target.value })} placeholder="R20T" /></div><div className="itf-f"><label className="itf-lab">Manufacturer</label><input className="itf-in" value={eng.manufacturer} onChange={(e) => setEng({ ...eng, manufacturer: e.target.value })} placeholder="Parker Racor" /></div></div>
                <div className="itf-f"><label className="itf-lab">System / equipment</label><input className="itf-in" value={eng.system} onChange={(e) => setEng({ ...eng, system: e.target.value })} placeholder="Fuel — Port main engine" /></div>
                <div className="itf-more" onClick={() => setMoreEng((v) => !v)}><span className="pl">{moreEng ? '–' : '+'}</span> Model, serial, condition</div>
                <div className={`itf-morebody${moreEng ? ' show' : ''}`}>
                  <div className="itf-g2"><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Model / fits</label><input className="itf-in" value={eng.model} onChange={(e) => setEng({ ...eng, model: e.target.value })} placeholder="500FG" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Serial</label><input className="itf-in" value={eng.serial} onChange={(e) => setEng({ ...eng, serial: e.target.value })} placeholder="—" /></div></div>
                  <div className="itf-f" style={{ margin: '12px 0 0' }}><label className="itf-lab">Condition</label><select className="itf-sel" value={condition} onChange={(e) => setCondition(e.target.value)}><option>New</option><option>Serviceable</option><option>Needs service</option><option>Beyond economical repair</option></select></div>
                </div>
              </>
            )}

            {profile === 'uniform' && (
              <>
                <div className="itf-g2"><div className="itf-f"><label className="itf-lab">Garment</label><select className="itf-sel" value={garment} onChange={(e) => setGarment(e.target.value)}><option>Top</option><option>Bottom</option><option>Shoes</option><option>Accessories</option></select></div><div className="itf-f"><label className="itf-lab">Sub-type <span className="opt">(opt)</span></label><input className="itf-in" value={subType} onChange={(e) => setSubType(e.target.value)} placeholder="Polo, Fleece…" /></div></div>
                <div className="itf-g2"><div className="itf-f"><label className="itf-lab">Fit</label><select className="itf-sel" value={fit} onChange={(e) => setFit(e.target.value)}><option>Mens</option><option>Womens</option><option>Unisex</option></select></div><div className="itf-f"><label className="itf-lab">Colour <span className="opt">(opt)</span></label><input className="itf-in" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="Navy" /></div></div>
                <div className="itf-f"><label className="itf-lab">Size type</label><select className="itf-sel" value={sizeType} onChange={(e) => setSizeType(e.target.value)}><option value="alpha">Alpha (XS–XXL)</option><option value="waist">Waist (inches)</option><option value="waistin">Waist × inseam</option><option value="shoe">Shoe</option><option value="women">Women's numeric</option><option value="youth">Youth</option><option value="one">One size</option><option value="custom">Custom…</option></select></div>
                {isMultiSize(sizeType) && (
                  <div className="itf-f"><label className="itf-lab">Label by <span className="opt">· same item, different scale</span></label><div className="itf-rtoggle">{['uk', 'eu', 'us', 'all'].map((r) => <span key={r} className={`itf-rt${region === r ? ' on' : ''}`} onClick={() => setRegion(r)}>{r === 'all' ? 'Show all' : r.toUpperCase()}</span>)}</div></div>
                )}
                <div className="itf-f" style={{ marginBottom: 0 }}><label className="itf-lab">Sizes in use <span className="opt">· quantities go in Stock</span></label><div className="itf-chips">{sizeList.map((s) => <span key={s} className={`itf-chip${sizeOn[s] ? ' on' : ''}`} onClick={() => setSizeOn((o) => ({ ...o, [s]: !o[s] }))}>{s}</span>)}</div></div>
                <div className="itf-more" onClick={() => setMoreUni((v) => !v)}><span className="pl">{moreUni ? '–' : '+'}</span> Branding & care</div>
                <div className={`itf-morebody${moreUni ? ' show' : ''}`}>
                  <div className="itf-g2" style={{ margin: 0 }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Branding</label><input className="itf-in" value={branding} onChange={(e) => setBranding(e.target.value)} placeholder="Embroidery" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Care</label><input className="itf-in" value={care} onChange={(e) => setCare(e.target.value)} placeholder="40° wash" /></div></div>
                </div>
              </>
            )}
          </Sec>
        )}

        {/* 3 STOCK */}
        <Sec icon="Boxes" name="Stock & location" open={open.stock} onToggle={() => toggle('stock')}>
          {profile === 'uniform' ? (
            <>
              <span className="itf-fl">Where it's stowed & how much <span className="opt">· per size</span></span>
              <div className="itf-umtx">
                <div className="itf-umtx-hd" style={{ gridTemplateColumns: `1.4fr ${activeSizes.map(() => 'minmax(38px,1fr)').join(' ')} 50px` }}>
                  <span className="loc">Location</span>{activeSizes.map((s) => <span key={s}>{s}</span>)}<span>Total</span>
                </div>
                <div className="itf-umtx-row" style={{ gridTemplateColumns: `1.4fr ${activeSizes.map(() => 'minmax(38px,1fr)').join(' ')} 50px` }}>
                  <span className="loc" style={{ cursor: 'pointer' }} onClick={() => setLocTarget({ kind: 'uni' })}><Icon name="MapPin" size={13} />{uniLoc} <Icon name="ChevronDown" size={11} /></span>
                  {activeSizes.map((s) => <input key={s} value={matrix[`${uniLoc}||${s}`] ?? ''} onChange={(e) => setCell(s, Number(e.target.value) || 0)} placeholder="0" />)}
                  <span className="tot">{rowTotal}</span>
                </div>
                <div className="itf-umtx-add">＋ Add location</div>
              </div>
            </>
          ) : (
            <>
              <span className="itf-fl">Where it's stowed & how much</span>
              {locRows.map((r, i) => (
                <div className="itf-locline" key={i}>
                  <button type="button" className="itf-pick pin" onClick={() => setLocTarget({ kind: 'stock', idx: i })}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><Icon name="MapPin" size={15} style={{ color: '#C65A1A', flexShrink: 0 }} /><span className={r.label ? '' : 'ph'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label || 'Select location…'}</span></span>
                    <Icon name="ChevronRight" size={15} style={{ color: '#AEB4C2', flexShrink: 0 }} />
                  </button>
                  <div className="itf-adorn q"><input value={r.qty || ''} onChange={(e) => updateRow(i, { qty: Number(e.target.value) || 0 })} placeholder="0" /><span className="tail"><select value={unit} onChange={(e) => setUnit(e.target.value)}><option>each</option><option>bottle</option><option>case</option><option>kg</option><option>L</option><option>pack</option></select></span></div>
                  {locRows.length > 1 && <button type="button" className="itf-rmrow" onClick={() => setLocRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>}
                </div>
              ))}
              <button type="button" className="itf-addloc" onClick={() => setLocRows((rs) => [...rs, { label: '', id: '', qty: 0 }])}>＋ Add another location</button>
              <div style={{ height: 16 }} />
            </>
          )}
          <span className="itf-fl">Keep-level <span className="opt">· total</span></span>
          <div className="itf-sentence">Keep <input className="itf-mini" value={keep} onChange={(e) => setKeep(e.target.value)} /> aboard · reorder at <input className="itf-mini" value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
          {profile !== 'uniform' && (
            <>
              <div className="itf-more" onClick={() => setMoreStock((v) => !v)}><span className="pl">{moreStock ? '–' : '+'}</span> {profile === 'bonded' ? 'Expiry' : 'Size, expiry'}</div>
              <div className={`itf-morebody${moreStock ? ' show' : ''}`}>
                <div className="itf-g2" style={{ margin: 0 }}>
                  {profile !== 'bonded' && <div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Size</label><input className="itf-in" value={size} onChange={(e) => setSize(e.target.value)} placeholder="750ml" /></div>}
                  <div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Expiry <span className="opt">(optional)</span></label><input className="itf-in" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
                </div>
              </div>
            </>
          )}
        </Sec>

        {/* 4 BUYING */}
        <Sec icon="ShoppingBag" name="Buying" open={open.buying} onToggle={() => toggle('buying')} summary={<span className="sc muted">optional</span>}>
          <span className="itf-fl">What it costs</span>
          <div className="itf-adorn" style={{ maxWidth: 230 }}><span className="pre">{currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£'}</span><input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" /><span className="tail"><select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>EUR</option><option>USD</option><option>GBP</option></select></span></div>
          <div style={{ height: 16 }} />
          <span className="itf-fl">How you order it</span>
          <div className="itf-sentence">Bought by <input className="itf-mini" style={{ width: 80 }} value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} placeholder="Case" /> of <input className="itf-mini" value={unitsPerPack} onChange={(e) => setUnitsPerPack(e.target.value)} /> {unit}</div>
          {purchaseUnit && Number(unitsPerPack) > 0 && <div className="itf-hint">↺ 1 {purchaseUnit.toLowerCase()} = <b>{unitsPerPack}</b> {unit}</div>}
          <div className="itf-more" onClick={() => setMoreBuy((v) => !v)}><span className="pl">{moreBuy ? '–' : '+'}</span> Brand, supplier, SKU</div>
          <div className={`itf-morebody${moreBuy ? ' show' : ''}`}>
            <div className="itf-g2"><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Brand</label><input className="itf-in" value={brand} onChange={(e) => setBrand(e.target.value)} /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Supplier</label><input className="itf-in" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div></div>
            <div className="itf-f" style={{ margin: '12px 0 0' }}><label className="itf-lab">Supplier SKU</label><input className="itf-in" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="reorder ref" /></div>
          </div>
        </Sec>

        {/* 5 HANDLING */}
        <Sec icon="ShieldCheck" name="Handling & maintenance" open={open.handling} onToggle={() => toggle('handling')} summary={handSummary.length ? handSummary.map((h) => <span key={h} className="sc hot">{h}</span>) : <span className="sc muted">none set</span>}>
          <div className="itf-clu">
            <div className="itf-mlab"><span>Add details</span><span className="rule" /><span className="free">inserts fields</span></div>
            <div className="itf-addons">
              {ADDONS.map((a) => <span key={a.id} className={`itf-addon${addonOn[a.id] ? ' on' : ''}`} onClick={() => setAddonOn((o) => ({ ...o, [a.id]: !o[a.id] }))}><span className="sign">{addonOn[a.id] ? '✓' : '+'}</span>{a.label}</span>)}
            </div>
            {addonOn.medical && <div className="itf-block show"><div className="itf-block-h"><span className="t">Medical</span><span className="rm" onClick={() => setAddonOn((o) => ({ ...o, medical: false }))}>✕ remove</span></div><div className="itf-block-b"><div className="itf-g2" style={{ margin: '0 0 11px' }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Form / dose</label><input className="itf-in" value={medForm} onChange={(e) => setMedForm(e.target.value)} placeholder="Tablet 500mg" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">MCA kit</label><input className="itf-in" value={medMca} onChange={(e) => setMedMca(e.target.value)} placeholder="Cat A/B/C" /></div></div><div className="itf-chips"><span className={`itf-chip${medControlled ? ' on' : ''}`} onClick={() => setMedControlled((v) => !v)}>Controlled drug — logbook</span></div></div></div>}
            {addonOn.food && <div className="itf-block show"><div className="itf-block-h"><span className="t">Food</span><span className="rm" onClick={() => setAddonOn((o) => ({ ...o, food: false }))}>✕ remove</span></div><div className="itf-block-b"><div className="itf-f"><label className="itf-lab">Origin <span className="opt">(customs)</span></label><input className="itf-in" value={foodOrigin} onChange={(e) => setFoodOrigin(e.target.value)} placeholder="Italy" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Allergens</label><div className="itf-chips">{ALLERGENS.map((a) => <span key={a} className={`itf-chip${foodAllergens.includes(a) ? ' on' : ''}`} onClick={() => setFoodAllergens((xs) => xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a])}>{a}</span>)}</div></div></div></div>}
            {addonOn.maint && <div className="itf-block show"><div className="itf-block-h"><span className="t">Scheduled checks</span><span className="rm" onClick={() => setAddonOn((o) => ({ ...o, maint: false }))}>✕ remove</span></div><div className="itf-block-b"><div className="itf-g2"><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Every</label><select className="itf-sel" value={mFreq} onChange={(e) => setMFreq(e.target.value)}>{FREQS.map((f) => <option key={f}>{f}</option>)}</select></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Next due</label><input className="itf-in" type="date" value={mNext} onChange={(e) => setMNext(e.target.value)} /></div></div>{(mFreq === 'Weekly' || mFreq === 'Daily') && <div className="itf-f" style={{ margin: '11px 0 0' }}><label className="itf-lab">On days</label><div className="itf-days">{DOW.map((d, i) => <span key={i} className={`itf-day${mDays.includes(i) ? ' on' : ''}`} onClick={() => setMDays((xs) => xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i])}>{d}</span>)}</div></div>}<div className="itf-f" style={{ margin: '11px 0 0' }}><label className="itf-lab">What to check</label><input className="itf-in" value={mCheck} onChange={(e) => setMCheck(e.target.value)} placeholder="Gauge in green, seal intact, pin secure" /></div><div className="itf-note" style={{ marginTop: 11 }}><span>↻</span><span>Drops a <b>recurring job</b> onto Team Jobs each cycle.</span></div></div></div>}
          </div>
          <div className="itf-clu">
            <div className="itf-mlab"><span>Flags</span><span className="rule" /><span className="free">on / off · hover</span></div>
            <div className="itf-flags">
              {FLAGS.map((f) => <span key={f.id} className={`itf-flag${flagOn[f.id] ? ' on' : ''}`} title={f.tip} onClick={() => setFlagOn((o) => ({ ...o, [f.id]: !o[f.id] }))}><Icon name={f.icon} size={17} /><span className="fl-t">{f.label}</span></span>)}
            </div>
          </div>
        </Sec>

        {/* 6 REFERENCE */}
        <Sec icon="Tag" name="Reference" open={open.ref} onToggle={() => toggle('ref')} summary={<span className="sc muted">barcode · tags · notes</span>}>
          <div className="itf-f"><label className="itf-lab">Barcode / QR</label><input className="itf-in" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or enter…" /></div>
          <div className="itf-f"><label className="itf-lab">Tags</label><div className="itf-chips">{['drinks', 'bar', 'snacks', 'safety', 'cleaning'].map((t) => <span key={t} className={`itf-chip${tags.includes(t) ? ' on' : ''}`} onClick={() => setTags((xs) => xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t])}>{t}</span>)}</div></div>
          <div className="itf-f" style={{ marginBottom: 0 }}><label className="itf-lab">Notes</label><input className="itf-in" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes…" /></div>
        </Sec>

        {error && <div className="itf-err">{error}</div>}
      </div>

      <div className="itf-foot">
        <button className="itf-btn itf-ghost" onClick={onClose}>Cancel</button>
        <button className="itf-btn itf-prim" disabled={saving} onClick={save}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}</button>
      </div>
    </ModalShell>
    {showFolderPicker && (
      <InventoryFolderPicker tree={folderTree} onSelect={handleFolderSelect} onClose={() => setShowFolderPicker(false)} onFolderCreated={(t) => setFolderTree(t || {})} />
    )}
    {locTarget && (
      <LocationPicker vesselLocations={vesselLocations} selectedId={locTarget?.kind === 'uni' ? uniLocId : (locRows[locTarget?.idx]?.id || '')} onSelect={handleLocPicked} onClose={() => setLocTarget(null)} />
    )}
    </>
  );
};

export default ItemFormModal;
