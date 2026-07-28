import React, { useState, useMemo, useEffect, useRef } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import InventoryFolderPicker from './InventoryFolderPicker';
import { LocationPicker } from './AddEditItemModal';
import MapPickerModal from '../../vessel-map/components/MapPickerModal';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import BarcodeScanModal from './BarcodeScanModal';
import { getFolderTree } from '../utils/inventoryStorage';
import { printItemQr, mintItemCode } from '../utils/itemQr';
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

// The checklist / SOP a maintenance item links to: either a pasted template
// link/URL, or an uploaded PDF (public URL). Legacy value was a bare string.
const normChecklist = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return { type: 'link', url: v, name: '' };
  if (v.url || v.name) return { type: v.type === 'pdf' ? 'pdf' : 'link', url: v.url || '', name: v.name || '' };
  return null;
};
const cleanChecklist = (c) => {
  if (!c) return undefined;
  if (c.type === 'pdf') return c.url ? { type: 'pdf', url: c.url, name: c.name || '' } : undefined;
  const url = (c.url || '').trim();
  return url ? { type: 'link', url } : undefined;
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

  const [profile, setProfile] = useState(
    item?.customFields?.profile
    || ((item?.isUniform || item?.is_uniform || item?.customFields?.garmentType) ? 'uniform' : autoProfile(folderDisplay))
  );

  // Hydrate the size × location table. Works for uniform sizes, consumable
  // pack-sizes, AND a plain single item (one blank-labelled size column).
  const variantInit = useMemo(() => {
    const sl = item?.stockLocations || item?.stock_locations || [];
    const hasVar = item?.hasVariants || item?.has_variants || item?.variants?.length || sl.some((r) => (r.sizes || []).length);
    const on = {}; const mx = {}; const locs = []; const order = [];
    const note = (s) => { if (!order.includes(String(s))) order.push(String(s)); };
    const reord = { ...(item?.customFields?.reorderSizes || item?.customFields?.parSizes || {}) };

    if (hasVar) {
      sl.forEach((row) => {
        const label = row.locationName || row.location_name || '';
        const id = row.vesselLocationId || row.vessel_location_id || '';
        locs.push({ label, id });
        (row.sizes || []).forEach((v) => { if (v?.size != null) { on[v.size] = true; note(v.size); mx[`${label}||${v.size}`] = v.qty || 0; } });
      });
      if (!Object.keys(mx).length && item?.variants?.length) {
        if (!locs.length) locs.push({ label: '', id: '' });
        const label = locs[0].label;
        item.variants.forEach((v) => { if (v?.size != null) { on[v.size] = true; note(v.size); mx[`${label}||${v.size}`] = v.qty || 0; } });
      }
      if (!locs.length) locs.push({ label: '', id: '' });
      const formats = item?.variants?.length ? item.variants.map((v) => String(v.size)) : order;
      const buy = {};
      (item?.variants || []).forEach((v) => { if (v?.size != null) buy[String(v.size)] = { supplier: v.supplier || '', cost: v.unitCost ?? v.unit_cost ?? '' }; });
      return { locs, on, mx, formats, buy, reord };
    }

    // plain single item → one blank-labelled size column
    sl.forEach((row) => {
      const label = row.locationName || row.location_name || '';
      const id = row.vesselLocationId || row.vessel_location_id || '';
      locs.push({ label, id });
      mx[`${label}||`] = row.qty ?? row.quantity ?? 0;
    });
    if (item && item.reorderPoint != null) reord[''] = item.reorderPoint;
    else if (item && item.parLevel != null) reord[''] = item.parLevel;
    if (!locs.length) locs.push({ label: '', id: '' });
    return { locs, on, mx, formats: [''], buy: {}, reord, simple: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [locTarget, setLocTarget] = useState(null); // {kind:'stock',idx} | {kind:'uni',idx}
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
  const [showScan, setShowScan] = useState(false);
  const [tags, setTags] = useState(item?.tags || []);
  const [tagDraft, setTagDraft] = useState('');
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
  const [garment, setGarment] = useState(item?.customFields?.garmentType || 'Top');
  const [subType, setSubType] = useState(item?.customFields?.subType || '');
  const [fit, setFit] = useState(item?.customFields?.fit || 'Womens');
  const [colour, setColour] = useState(item?.customFields?.colour || '');
  const [sizeType, setSizeType] = useState(item?.variantType || 'alpha');
  const [region, setRegion] = useState('uk');
  const [sizeOn, setSizeOn] = useState(variantInit?.on || {}); // label -> true
  const [matrix, setMatrix] = useState(variantInit?.mx || {}); // "loc||size" -> qty
  const [uniLocs, setUniLocs] = useState(variantInit?.locs || [{ label: '', id: '' }]);
  const [reorderSizes, setReorderSizes] = useState(variantInit?.reord || {}); // size -> reorder-at qty
  // Size columns for non-uniform items. Always ≥1 (a blank column = a plain
  // single item); naming it or adding more turns the item multi-size.
  const [formats, setFormats] = useState(variantInit?.formats?.length ? variantInit.formats : ['']);
  const [varBuy, setVarBuy] = useState(variantInit?.buy || {}); // format -> {supplier, cost}
  const [moreUni, setMoreUni] = useState(false);
  const [brandingType, setBrandingType] = useState(item?.customFields?.branding?.type || 'None');
  const [brandingColour, setBrandingColour] = useState(item?.customFields?.branding?.colour || '');
  const [brandingLogo, setBrandingLogo] = useState(item?.customFields?.branding?.logo || '');
  const [brandingPlacement, setBrandingPlacement] = useState(item?.customFields?.branding?.placement || '');
  const [fabric, setFabric] = useState(item?.customFields?.fabric || '');
  const [care, setCare] = useState(item?.customFields?.care || '');
  const [styleCode, setStyleCode] = useState(item?.customFields?.styleCode || '');

  // handling
  const [addonOn, setAddonOn] = useState({});
  const [flagOn, setFlagOn] = useState(item?.customFields?.flags || {});
  const [medForm, setMedForm] = useState(item?.customFields?.medical?.form || '');
  const [medControlled, setMedControlled] = useState(!!item?.customFields?.medical?.controlled);
  const [medActive, setMedActive] = useState(item?.customFields?.medical?.active || '');
  const [medBatch, setMedBatch] = useState(item?.customFields?.medical?.batch || '');
  const [medStorage, setMedStorage] = useState(item?.customFields?.medical?.storage || 'Room temp');
  const [foodOrigin, setFoodOrigin] = useState(item?.customFields?.food?.origin || '');
  const [foodAllergens, setFoodAllergens] = useState(item?.customFields?.food?.allergens || []);
  const [foodStorage, setFoodStorage] = useState(item?.customFields?.food?.storage || 'Room temp');
  const [foodBatch, setFoodBatch] = useState(item?.customFields?.food?.batch || '');
  const [allergenDraft, setAllergenDraft] = useState('');
  const [mFreq, setMFreq] = useState(item?.customFields?.maintenance?.every || 'Monthly');
  const [mNext, setMNext] = useState(item?.customFields?.maintenance?.nextDue || '');
  const [mDays, setMDays] = useState(item?.customFields?.maintenance?.days || []);
  const [mCheck, setMCheck] = useState(item?.customFields?.maintenance?.check || '');
  const [mResponsible, setMResponsible] = useState(item?.customFields?.maintenance?.responsible || '');
  const [mEstTime, setMEstTime] = useState(item?.customFields?.maintenance?.estTime || '');
  const [mLink, setMLink] = useState(() => normChecklist(item?.customFields?.maintenance?.link));
  const [clMode, setClMode] = useState(() => (normChecklist(item?.customFields?.maintenance?.link)?.type === 'link' ? 'link' : 'choose'));
  const [clBusy, setClBusy] = useState(false);
  const [clErr, setClErr] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mapItem, setMapItem] = useState(null);
  const [savedId, setSavedId] = useState(item?.id || null);
  const nameRef = useRef(null);

  // size labels for the current system
  const sizeList = useMemo(() => {
    if (sizeType === 'shoe') return SHOE.map((s) => (region === 'all' ? `${s.uk}·${s.eu}·${s.us}` : s[region] || s.uk));
    if (sizeType === 'women') return WOMEN.map((s) => (region === 'all' ? `${s.us}·${s.eu}·${s.uk}` : s[region] || s.us));
    return SIZE_SETS[sizeType] || [];
  }, [sizeType, region]);

  // default first-4 sizes on when the size system changes — but keep the
  // hydrated run intact on the very first render of an edit.
  const sizeInit = useRef(!!variantInit);
  useEffect(() => {
    if (profile !== 'uniform') return;
    if (sizeInit.current) { sizeInit.current = false; return; }
    const next = {};
    sizeList.forEach((s, i) => { if (i < 4) next[s] = true; });
    setSizeOn(next);
    if (sizeType === 'women') setRegion((r) => (r === 'uk' ? 'us' : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeType, profile]);

  // The stock table always shows. `cols` are its size columns; a single blank
  // column = a plain item. `namedSizes` are the real (labelled) sizes, so
  // `multiSize` (per-variant buying) only kicks in once a size is named.
  const activeSizes = useMemo(() => {
    if (profile === 'uniform') return sizeList.filter((s) => sizeOn[s]);
    return formats.filter((f) => String(f).trim());
  }, [profile, formats, sizeList, sizeOn]);
  const cols = profile === 'uniform' ? activeSizes : formats;
  const multiSize = profile !== 'uniform' && activeSizes.length > 0;
  const variantMode = profile === 'uniform' || multiSize;
  const cell = (loc, s) => Number(matrix[`${loc}||${s}`]) || 0;
  const setCell = (loc, s, v) => setMatrix((m) => ({ ...m, [`${loc}||${s}`]: v }));
  const rowTot = (loc) => cols.reduce((a, c) => a + cell(loc, c), 0);
  const locTotal = (loc) => activeSizes.reduce((a, s) => a + cell(loc, s), 0);
  const colHave = (c) => uniLocs.reduce((a, l) => a + cell(l.label, c), 0);
  const grandTotal = uniLocs.reduce((a, l) => a + rowTot(l.label), 0);
  const addUniLoc = () => { const idx = uniLocs.length; setUniLocs((ls) => [...ls, { label: '', id: '' }]); setLocTarget({ kind: 'uni', idx }); };
  const setVarBuy2 = (f, patch) => setVarBuy((b) => ({ ...b, [f]: { ...(b[f] || {}), ...patch } }));
  // consumable pack-sizes as editable column headers (no chips)
  const addFormat = () => setFormats((fs) => (fs.some((f) => !String(f).trim()) ? fs : [...fs, '']));
  const renameFormat = (j, val) => {
    const old = formats[j];
    setFormats((fs) => fs.map((f, k) => (k === j ? val : f)));
    if (old === val) return;
    setMatrix((m) => { const n = { ...m }; uniLocs.forEach((l) => { const ok = `${l.label}||${old}`; if (n[ok] != null) { n[`${l.label}||${val}`] = n[ok]; delete n[ok]; } }); return n; });
    setReorderSizes((p) => { if (p[old] == null) return p; const n = { ...p }; n[val] = n[old]; delete n[old]; return n; });
    setVarBuy((b) => { if (!b[old]) return b; const n = { ...b }; n[val] = b[old]; delete n[old]; return n; });
  };
  const removeFormatAt = (j) => {
    const old = formats[j];
    setFormats((fs) => fs.filter((_, k) => k !== j));
    setMatrix((m) => { const n = { ...m }; uniLocs.forEach((l) => delete n[`${l.label}||${old}`]); return n; });
    setReorderSizes((p) => { if (p[old] == null) return p; const n = { ...p }; delete n[old]; return n; });
    setVarBuy((b) => { if (!b[old]) return b; const n = { ...b }; delete n[old]; return n; });
  };

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

  // Re-encode any picked photo to a downscaled JPEG via canvas. This makes
  // HEIC/AVIF/large iPhone shots work (the item-images bucket only accepts
  // jpeg/png/webp/gif ≤5MB), matching how uniforms already handle it.
  const toJpeg = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url); let { width, height } = img; const MAX = 1600;
      if (Math.max(width, height) > MAX) { const s = MAX / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      c.getContext('2d')?.drawImage(img, 0, 0, width, height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });

  const uploadPhoto = async (file) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoErr('');
    try {
      let blob;
      try { blob = await toJpeg(file); }
      catch {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) && file.size <= 5 * 1024 * 1024;
        if (!ok) { setPhotoErr('Couldn’t read that image — try a JPG or PNG.'); setPhotoBusy(false); return; }
        blob = file;
      }
      const { data: ctx } = await supabase.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id || 'shared';
      const ext = blob === file ? ((file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')) : 'jpg';
      const contentType = blob === file ? (file.type || 'image/jpeg') : 'image/jpeg';
      const path = `inventory/${tenantId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('item-images').upload(path, blob, { upsert: true, contentType });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('item-images').getPublicUrl(path);
      setOriginalUrl('');
      setImageUrl(pub?.publicUrl || '');
    } catch (err) { setPhotoErr(`Upload failed — ${err?.message || 'try again.'}`); }
    finally { setPhotoBusy(false); }
  };

  // Upload a checklist / SOP PDF to the public inventory-docs bucket and pin it
  // to the maintenance block. Same tenant-scoped path scheme as item photos.
  const uploadChecklist = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') { setClErr('Please choose a PDF file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setClErr('That PDF is over 10MB — try a smaller file.'); return; }
    setClBusy(true); setClErr('');
    try {
      const { data: ctx } = await supabase.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id || 'shared';
      const safe = (file.name || 'checklist.pdf').replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `inventory/checklists/${tenantId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from('inventory-docs').upload(path, file, { upsert: false, contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('inventory-docs').getPublicUrl(path);
      setMLink({ type: 'pdf', url: pub?.publicUrl || '', name: file.name || 'checklist.pdf' });
    } catch (err) { setClErr(`Upload failed — ${err?.message || 'try again.'}`); }
    finally { setClBusy(false); }
  };

  // Mint a QR code no other item is already using (tenant-scoped). The item's
  // own Barcode field is the registry — so re-printing the same item reuses its
  // stored code, and a fresh item can never collide with an existing one.
  const mintUniqueCode = async () => {
    let tenant;
    try { const { data: ctx } = await supabase.rpc('get_my_context'); tenant = ctx?.[0]?.tenant_id; } catch { /* offline */ }
    for (let i = 0; i < 6; i += 1) {
      const code = mintItemCode();
      if (!tenant) return code;
      const { data } = await supabase.from('inventory_items').select('id').eq('tenant_id', tenant).eq('barcode', code).limit(1);
      if (!data || !data.length) return code;
    }
    return mintItemCode();
  };

  const handleCreateQr = async () => {
    const existing = barcode.trim();
    // Open the print window synchronously so the popup blocker doesn't eat it,
    // then fill it once the (possibly minted) code is ready.
    let win = null;
    try { win = window.open('', '_blank'); if (win) { win.document.write('<!doctype html><meta charset="utf-8"><title>QR label</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing label…</body>'); win.document.close(); } } catch { /* blocked */ }
    let code = existing;
    if (!code) { code = await mintUniqueCode(); setBarcode(code); }
    printItemQr({ code, name: name.trim(), brand, location: folder, win });
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

  const persist = async (notify = true) => {
    if (!name.trim()) { setError('Item name is required.'); setOpen((o) => ({ ...o, identity: true })); return null; }
    setSaving(true); setError('');
    try {
      const { data: ctx } = await supabase.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id;
      if (!tenantId) throw new Error('No tenant context');

      const segs = folderPath.length ? folderPath : String(folder || '').split('>').map((s) => s.trim()).filter(Boolean);
      const location = segs[0] || null;
      const sub_location = segs.length ? segs.join(' > ') : null;

      // The size × location table: uniform sizes, consumable pack-sizes, or a
      // single blank-labelled column (a plain item). Sizes that carry a label
      // become variants; a blank single column saves as an ordinary item.
      let variants = null; let has_variants = false; let variant_type = null; let totalQty = 0;
      let stock_locations = [];
      const hasVar = activeSizes.length > 0;
      const reorderTotal = activeSizes.reduce((a, s) => a + (Number(reorderSizes[s]) || 0), 0);
      if (hasVar) {
        has_variants = true; variant_type = profile === 'uniform' ? sizeType : 'format';
        // variants = per-size totals aggregated across every stowage location; the
        // consumable case also carries its own supplier + price per pack-size.
        variants = activeSizes.map((s) => {
          const v = { size: s, qty: uniLocs.reduce((a, l) => a + cell(l.label, s), 0) };
          if (profile !== 'uniform') {
            if (varBuy[s]?.supplier) v.supplier = varBuy[s].supplier;
            if (varBuy[s]?.cost !== '' && varBuy[s]?.cost != null) v.unitCost = Number(varBuy[s].cost);
          }
          return v;
        });
        totalQty = variants.reduce((a, v) => a + (v.qty || 0), 0);
        stock_locations = uniLocs
          .filter((l) => l.label)
          .map((l) => ({ locationName: l.label, vesselLocationId: l.id || undefined, qty: locTotal(l.label), sizes: activeSizes.map((s) => ({ size: s, qty: cell(l.label, s) })) }));
      } else {
        // plain single item — the one blank-labelled column
        stock_locations = uniLocs.filter((l) => l.label).map((l) => ({ locationName: l.label, vesselLocationId: l.id || undefined, qty: cell(l.label, '') }));
        totalQty = uniLocs.reduce((a, l) => a + cell(l.label, ''), 0);
      }
      const reorderVal = hasVar ? reorderTotal : (Number(reorderSizes['']) || 0);
      // For list display, surface the first priced variant at item level.
      const primaryCost = variants?.find((v) => v.unitCost != null)?.unitCost;
      const primarySupplier = variants?.find((v) => v.supplier)?.supplier;

      const custom_fields = {
        profile,
        sku: sku || undefined,
        bonded: profile === 'bonded' ? { kind: bKind, volume, abv, perPack, perCarton } : undefined,
        eng: profile === 'eng' ? eng : undefined,
        ...(profile === 'uniform' ? {
          garmentType: garment, subType, fit, colour, styleCode: styleCode || undefined,
          branding: brandingType === 'None' ? undefined : { type: brandingType, colour: brandingColour, logo: brandingLogo, placement: brandingPlacement },
          fabric: fabric || undefined, care: care || undefined, sizeType, region,
        } : {}),
        ...(multiSize ? { formats: activeSizes, variantKind: 'format' } : {}),
        reorderSizes: hasVar && activeSizes.some((s) => Number(reorderSizes[s]) > 0) ? activeSizes.reduce((o, s) => { o[s] = Number(reorderSizes[s]) || 0; return o; }, {}) : undefined,
        flags: toArr(flagOn).length ? flagOn : undefined,
        medical: addonOn.medical ? { form: medForm, controlled: medControlled, active: medActive || undefined, batch: medBatch || undefined, storage: medStorage } : undefined,
        food: addonOn.food ? { origin: foodOrigin, allergens: foodAllergens, storage: foodStorage, batch: foodBatch || undefined } : undefined,
        maintenance: addonOn.maint ? { every: mFreq, nextDue: mNext, days: mDays, check: mCheck, responsible: mResponsible || undefined, estTime: mEstTime || undefined, link: cleanChecklist(mLink) } : undefined,
      };

      const payload = {
        tenant_id: tenantId,
        name: name.trim(),
        description: description || null,
        image_url: imageUrl || null,
        brand: brand || null,
        supplier: multiSize ? (primarySupplier || supplier || null) : (supplier || null),
        unit: unit || 'each',
        size: profile === 'bonded' ? (volume || size || null) : (hasVar ? null : size || null),
        unit_cost: multiSize ? (primaryCost ?? (unitCost === '' ? null : Number(unitCost))) : (unitCost === '' ? null : Number(unitCost)),
        currency: currency || null,
        purchase_unit: purchaseUnit || null,
        units_per_pack: unitsPerPack === '' ? null : Number(unitsPerPack),
        par_level: reorderVal || null,
        reorder_point: reorderVal || null,
        restock_level: reorderVal || null,
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
        default_location_id: locRows[0]?.id || uniLocs[0]?.id || null,
        quantity: totalQty, total_qty: totalQty,
        has_variants, variant_type, variants,
        stock_locations,
        custom_fields,
      };

      // Idempotent: once we've inserted (e.g. via "Set on the map" before the
      // final save), keep updating that same row instead of inserting again.
      const existingId = isEdit ? item.id : savedId;
      let res;
      if (existingId) res = await supabase.from('inventory_items').update(payload).eq('id', existingId).eq('tenant_id', tenantId).select('id').single();
      else res = await supabase.from('inventory_items').insert(payload).select('id').single();
      if (res.error) throw res.error;
      const newId = res.data?.id || existingId || null;
      if (!isEdit && newId) setSavedId(newId);
      if (notify) onSaved?.();
      return newId;
    } catch (err) {
      console.error('[ItemFormModal] save failed:', err);
      setError(err?.message || 'Couldn’t save — try again.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const id = await persist();
    if (id) onClose?.();
  };

  // "Set from map" just picks a location visually — no save, no stock write. The
  // chosen pin comes back as a stock row where per-size quantities are set.
  const setOnMap = () => setMapItem({ id: savedId || item?.id || null, name: name.trim() || 'this item', pickOnly: true });
  const addMapLocation = ({ nodeId, name: locName }) => {
    setUniLocs((ls) => {
      if (ls.some((l) => l.id === nodeId)) return ls;
      const withoutEmpty = ls.filter((l) => l.label || l.id);
      return [...withoutEmpty, { label: locName, id: nodeId }];
    });
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
    if (locTarget?.kind === 'uni') {
      const idx = locTarget.idx;
      const old = uniLocs[idx]?.label;
      setUniLocs((ls) => ls.map((l, i) => (i === idx ? { label, id } : l)));
      if (old && old !== label) {
        setMatrix((m) => {
          const next = { ...m };
          activeSizes.forEach((s) => {
            if (next[`${old}||${s}`] != null) { next[`${label}||${s}`] = next[`${old}||${s}`]; delete next[`${old}||${s}`]; }
          });
          return next;
        });
      }
    } else if (locTarget?.kind === 'stock') { updateRow(locTarget.idx, { label, id }); }
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
              <input ref={nameRef} className="itf-nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
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
                  <div className="itf-g2" style={{ margin: 0 }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Branding</label><select className="itf-sel" value={brandingType} onChange={(e) => setBrandingType(e.target.value)}><option>None</option><option>Embroidery</option><option>Print</option><option>Woven badge</option></select></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Style code <span className="opt">(opt)</span></label><input className="itf-in" value={styleCode} onChange={(e) => setStyleCode(e.target.value)} placeholder="SKU / style ref" /></div></div>
                  {brandingType !== 'None' && (
                    <>
                      <div className="itf-g2" style={{ margin: 0 }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Thread / print colour <span className="opt">(opt)</span></label><input className="itf-in" value={brandingColour} onChange={(e) => setBrandingColour(e.target.value)} placeholder="Gold" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Placement <span className="opt">(opt)</span></label><input className="itf-in" value={brandingPlacement} onChange={(e) => setBrandingPlacement(e.target.value)} placeholder="Left chest" /></div></div>
                      <div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Logo / text <span className="opt">(opt)</span></label><input className="itf-in" value={brandingLogo} onChange={(e) => setBrandingLogo(e.target.value)} placeholder="Vessel name / crest" /></div>
                    </>
                  )}
                  <div className="itf-g2" style={{ margin: 0 }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Fabric <span className="opt">(opt)</span></label><input className="itf-in" value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="Cotton piqué" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Care <span className="opt">(opt)</span></label><input className="itf-in" value={care} onChange={(e) => setCare(e.target.value)} placeholder="40° wash" /></div></div>
                </div>
              </>
            )}
          </Sec>
        )}

        {/* 3 STOCK */}
        <Sec icon="Boxes" name="Stock & location" open={open.stock} onToggle={() => toggle('stock')}>
          <span className="itf-fl">Where it's stowed &amp; how much{cols.length > 1 ? <span className="opt"> · per size{uniLocs.length > 1 ? ', per location' : ''}</span> : null}</span>
          {cols.length === 0 ? (
            <>
              <div className="itf-usizes-empty">Turn on some sizes in <b>Details</b> to log quantities.</div>
              <div className="itf-locactions">
                <button type="button" className="itf-addloc" onClick={addUniLoc}>＋ Add location</button>
              </div>
            </>
          ) : (
            <div className="itf-mtxwrap">
              <div className="itf-mtx" style={{ gridTemplateColumns: `minmax(122px,1.2fr) repeat(${cols.length}, minmax(62px,1fr)) ${profile !== 'uniform' ? '30px ' : ''}54px` }}>
                {/* header — editable size labels for non-uniform, static for uniform */}
                <div className="itf-mh blank" />
                {cols.map((c, j) => (profile !== 'uniform'
                  ? <div className="itf-mh sz" key={j}><input value={c} title={c} onChange={(e) => renameFormat(j, e.target.value)} placeholder="+ size" aria-label="Size name" />{cols.length > 1 && <button type="button" className="x" onClick={() => removeFormatAt(j)} aria-label="Remove size">✕</button>}</div>
                  : <div className="itf-mh sz static" key={j}>{c}</div>
                ))}
                {profile !== 'uniform' && <div className="itf-mh add"><button type="button" onClick={addFormat} aria-label="Add a size" title="Add a size">＋</button></div>}
                <div className="itf-mh tot">Total</div>

                {/* one row per stow location */}
                {uniLocs.map((loc, i) => (
                  <React.Fragment key={i}>
                    <button type="button" className="itf-mloc" onClick={() => setLocTarget({ kind: 'uni', idx: i })}>
                      <Icon name="MapPin" size={13} style={{ color: '#C65A1A', flexShrink: 0 }} />
                      <span className={loc.label ? 'nm' : 'nm ph'}>{loc.label || 'Select location…'}</span>
                      {uniLocs.length > 1 && <span className="rm" onClick={(e) => { e.stopPropagation(); setUniLocs((ls) => ls.filter((_, k) => k !== i)); }}>✕</span>}
                    </button>
                    {cols.map((c, j) => <div className="itf-mq" key={j}><input value={matrix[`${loc.label}||${c}`] ?? ''} onChange={(e) => setCell(loc.label, c, Number(e.target.value) || 0)} placeholder="0" inputMode="numeric" aria-label={`${loc.label || 'location'} ${c || 'qty'}`} /></div>)}
                    {profile !== 'uniform' && <div className="itf-mgap" />}
                    <div className="itf-mrtot">{rowTot(loc.label)}</div>
                  </React.Fragment>
                ))}

                {/* totals row — action sits on this line, no separate label */}
                <div className="itf-mhaveact">
                  <button type="button" className="itf-addloc" onClick={addUniLoc}>＋ Add location</button>
                </div>
                {cols.map((c, j) => <div className="itf-mhave" key={j}>{colHave(c)}</div>)}
                {profile !== 'uniform' && <div className="itf-mhave gap" />}
                <div className="itf-mgtot">{grandTotal}</div>

                {/* reorder-at (low-stock trigger) per column */}
                <div className="itf-mminlab">Reorder at</div>
                {cols.map((c, j) => { const low = colHave(c) < (Number(reorderSizes[c]) || 0) && (Number(reorderSizes[c]) || 0) > 0; return <div className={`itf-mmin${low ? ' low' : ''}`} key={j}><input value={reorderSizes[c] ?? ''} onChange={(e) => setReorderSizes((p) => ({ ...p, [c]: Number(e.target.value) || 0 }))} placeholder="—" inputMode="numeric" aria-label={`Reorder at ${c}`} /></div>; })}
                {profile !== 'uniform' && <div className="itf-mmin gap" />}
                <div className="itf-mmin gap" />
              </div>
            </div>
          )}
        </Sec>

        {/* 4 BUYING */}
        <Sec icon="ShoppingBag" name="Buying" open={open.buying} onToggle={() => toggle('buying')} summary={<span className="sc muted">optional</span>}>
          {multiSize ? (
            <>
              <div className="itf-vbuy-top">
                <span className="itf-fl" style={{ margin: 0 }}>Supplier &amp; price <span className="opt">· per pack-size</span></span>
                <select className="itf-sel cur" value={currency} onChange={(e) => setCurrency(e.target.value)}><option>EUR</option><option>USD</option><option>GBP</option></select>
              </div>
              {activeSizes.length === 0 ? (
                <div className="itf-usizes-empty">Add a size / pack in <b>Stock</b> first.</div>
              ) : (
                <div className="itf-vbuy">
                  <div className="itf-vbuy-hd"><span>Size</span><span>Supplier</span><span>Price</span></div>
                  {activeSizes.map((s) => (
                    <div className="itf-vbuy-row" key={s}>
                      <span className="fmt">{s}</span>
                      <input value={varBuy[s]?.supplier || ''} onChange={(e) => setVarBuy2(s, { supplier: e.target.value })} placeholder="Supplier" />
                      <div className="itf-adorn sm"><span className="pre">{currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£'}</span><input value={varBuy[s]?.cost ?? ''} onChange={(e) => setVarBuy2(s, { cost: e.target.value })} placeholder="0.00" inputMode="decimal" /></div>
                    </div>
                  ))}
                </div>
              )}
              <div className="itf-more" onClick={() => setMoreBuy((v) => !v)}><span className="pl">{moreBuy ? '–' : '+'}</span> Brand, SKU</div>
              <div className={`itf-morebody${moreBuy ? ' show' : ''}`}>
                <div className="itf-g2" style={{ margin: 0 }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Brand</label><input className="itf-in" value={brand} onChange={(e) => setBrand(e.target.value)} /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Supplier SKU</label><input className="itf-in" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="reorder ref" /></div></div>
              </div>
            </>
          ) : (
            <>
              <span className="itf-fl">What it costs</span>
              <div className="itf-adorn" style={{ maxWidth: 230 }}><span className="pre">{currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£'}</span><input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.00" /><span className="tail"><select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>EUR</option><option>USD</option><option>GBP</option></select></span></div>
              <div style={{ height: 16 }} />
              <span className="itf-fl">How you order it</span>
              <div className="itf-keep">
                <div className="itf-keep-row">
                  <label className="itf-keep-f"><span className="itf-lab">Bought by</span><input className="itf-keep-in wide" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} placeholder="Case" /></label>
                  <span className="itf-keep-x">of</span>
                  <label className="itf-keep-f"><span className="itf-lab">Qty per {purchaseUnit ? purchaseUnit.toLowerCase() : 'pack'}</span><input className="itf-keep-in" value={unitsPerPack} onChange={(e) => setUnitsPerPack(e.target.value)} placeholder="e.g. 12" inputMode="numeric" /></label>
                  <span className="itf-keep-unit">{unit}</span>
                </div>
              </div>
              {purchaseUnit && Number(unitsPerPack) > 0 && <div className="itf-hint">↺ 1 {purchaseUnit.toLowerCase()} = <b>{unitsPerPack}</b> {unit}</div>}
              <div className="itf-more" onClick={() => setMoreBuy((v) => !v)}><span className="pl">{moreBuy ? '–' : '+'}</span> Brand, supplier, SKU</div>
              <div className={`itf-morebody${moreBuy ? ' show' : ''}`}>
                <div className="itf-g2"><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Brand</label><input className="itf-in" value={brand} onChange={(e) => setBrand(e.target.value)} /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Supplier</label><input className="itf-in" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div></div>
                <div className="itf-f" style={{ margin: '12px 0 0' }}><label className="itf-lab">Supplier SKU</label><input className="itf-in" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="reorder ref" /></div>
              </div>
            </>
          )}
        </Sec>

        {/* 5 HANDLING */}
        <Sec icon="ShieldCheck" name="Handling & maintenance" open={open.handling} onToggle={() => toggle('handling')} summary={handSummary.length ? handSummary.map((h) => <span key={h} className="sc hot">{h}</span>) : <span className="sc muted">none set</span>}>
          <div className="itf-clu">
            <div className="itf-mlab"><span>Add details</span><span className="rule" /><span className="free">inserts fields</span></div>
            <div className="itf-addons">
              {ADDONS.map((a) => <span key={a.id} className={`itf-addon${addonOn[a.id] ? ' on' : ''}`} onClick={() => setAddonOn((o) => ({ ...o, [a.id]: !o[a.id] }))}><span className="sign">{addonOn[a.id] ? '✓' : '+'}</span>{a.label}</span>)}
            </div>
            {addonOn.medical && <div className="itf-block show"><div className="itf-block-h"><span className="t">Medical</span><span className="rm" onClick={() => setAddonOn((o) => ({ ...o, medical: false }))}>✕ remove</span></div><div className="itf-block-b">
              <div className="itf-g2" style={{ margin: '0 0 11px' }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Form / dose</label><input className="itf-in" value={medForm} onChange={(e) => setMedForm(e.target.value)} placeholder="Tablet 500mg" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Active ingredient</label><input className="itf-in" value={medActive} onChange={(e) => setMedActive(e.target.value)} placeholder="Paracetamol" /></div></div>
              <div className="itf-g2" style={{ margin: '0 0 11px' }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Batch / lot no</label><input className="itf-in" value={medBatch} onChange={(e) => setMedBatch(e.target.value)} placeholder="Optional" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Storage</label><select className="itf-sel" value={medStorage} onChange={(e) => setMedStorage(e.target.value)}><option>Room temp</option><option>Chilled 2–8°C</option><option>Controlled / locked</option></select></div></div>
              <div className="itf-chips"><span className={`itf-chip${medControlled ? ' on' : ''}`} onClick={() => setMedControlled((v) => !v)}>Controlled drug — logbook</span></div></div></div>}
            {addonOn.food && <div className="itf-block show"><div className="itf-block-h"><span className="t">Food</span><span className="rm" onClick={() => setAddonOn((o) => ({ ...o, food: false }))}>✕ remove</span></div><div className="itf-block-b">
              <div className="itf-g2" style={{ margin: '0 0 11px' }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Origin <span className="opt">(customs)</span></label><input className="itf-in" value={foodOrigin} onChange={(e) => setFoodOrigin(e.target.value)} placeholder="Italy" /></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Storage</label><select className="itf-sel" value={foodStorage} onChange={(e) => setFoodStorage(e.target.value)}><option>Room temp</option><option>Chilled</option><option>Frozen</option></select></div></div>
              <div className="itf-f" style={{ margin: '0 0 11px' }}><label className="itf-lab">Batch / lot no <span className="opt">(recall trace)</span></label><input className="itf-in" value={foodBatch} onChange={(e) => setFoodBatch(e.target.value)} placeholder="Optional" /></div>
              <div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Allergens</label><div className="itf-chips">{ALLERGENS.map((a) => <span key={a} className={`itf-chip${foodAllergens.includes(a) ? ' on' : ''}`} onClick={() => setFoodAllergens((xs) => xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a])}>{a}</span>)}{foodAllergens.filter((a) => !ALLERGENS.includes(a)).map((a) => <span key={a} className="itf-chip on" onClick={() => setFoodAllergens((xs) => xs.filter((x) => x !== a))}>{a} ✕</span>)}<input className="itf-chip-in" value={allergenDraft} onChange={(e) => setAllergenDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = allergenDraft.trim(); if (v && !foodAllergens.includes(v)) setFoodAllergens((xs) => [...xs, v]); setAllergenDraft(''); } }} placeholder="+ custom" /></div></div></div></div>}
            {addonOn.maint && <div className="itf-block show"><div className="itf-block-h"><span className="t">Scheduled checks</span><span className="rm" onClick={() => setAddonOn((o) => ({ ...o, maint: false }))}>✕ remove</span></div><div className="itf-block-b">
              <div className="itf-g2"><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Every</label><select className="itf-sel" value={mFreq} onChange={(e) => setMFreq(e.target.value)}>{FREQS.map((f) => <option key={f}>{f}</option>)}</select></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Next due</label><EditorialDatePicker value={mNext} onChange={setMNext} placeholder="dd/mm/yyyy" ariaLabel="Next due date" /></div></div>
              <div className="itf-g2" style={{ margin: '11px 0 0' }}><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Responsible</label><select className="itf-sel" value={mResponsible} onChange={(e) => setMResponsible(e.target.value)}><option value="">Any dept</option><option>Deck</option><option>Engineering</option><option>Interior</option><option>Galley</option><option>Bridge</option><option>Medical</option></select></div><div className="itf-f" style={{ margin: 0 }}><label className="itf-lab">Est. time <span className="opt">(mins)</span></label><input className="itf-in" value={mEstTime} onChange={(e) => setMEstTime(e.target.value)} placeholder="15" inputMode="numeric" /></div></div>
              {(mFreq === 'Weekly' || mFreq === 'Daily') && <div className="itf-f" style={{ margin: '11px 0 0' }}><label className="itf-lab">On days</label><div className="itf-days">{DOW.map((d, i) => <span key={i} className={`itf-day${mDays.includes(i) ? ' on' : ''}`} onClick={() => setMDays((xs) => xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i])}>{d}</span>)}</div></div>}
              <div className="itf-f" style={{ margin: '11px 0 0' }}><label className="itf-lab">What to check</label><input className="itf-in" value={mCheck} onChange={(e) => setMCheck(e.target.value)} placeholder="Gauge in green, seal intact, pin secure" /></div>
              <div className="itf-f" style={{ margin: '11px 0 0' }}><label className="itf-lab">Checklist / SOP <span className="opt">(optional)</span></label>
                {mLink?.type === 'pdf' && mLink.url ? (
                  <div className="itf-clfile"><span className="ic"><Icon name="FileText" size={16} /></span><a className="nm" href={mLink.url} target="_blank" rel="noopener noreferrer">{mLink.name || 'checklist.pdf'}</a><span className="rm" onClick={() => { setMLink(null); setClMode('choose'); }} title="Remove"><Icon name="X" size={14} /></span></div>
                ) : clMode === 'link' ? (
                  <div className="itf-cllink">
                    <input className="itf-in" autoFocus value={mLink?.type === 'link' ? (mLink.url || '') : ''} onChange={(e) => setMLink(e.target.value ? { type: 'link', url: e.target.value, name: '' } : null)} placeholder="Paste a link (Vessel Documents, SharePoint, Drive…)" />
                    <button type="button" className="itf-linkx" onClick={() => { setMLink(null); setClMode('choose'); }} title="Cancel"><Icon name="X" size={15} /></button>
                  </div>
                ) : (
                  <div className="itf-clchoice">
                    <button type="button" className="itf-clopt" onClick={() => { setClErr(''); setClMode('link'); }}><Icon name="Link" size={14} /> Paste a link</button>
                    <label className={`itf-clopt${clBusy ? ' busy' : ''}`}><Icon name="Upload" size={14} /> {clBusy ? 'Uploading…' : 'Upload PDF'}<input type="file" accept="application/pdf" hidden disabled={clBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadChecklist(f); }} /></label>
                  </div>
                )}
                {clErr && <p className="itf-scanhint" style={{ color: '#C24632' }}>{clErr}</p>}
              </div>
              <div className="itf-note" style={{ marginTop: 11 }}><span>↻</span><span>Drops a <b>recurring job</b> onto Team Jobs each cycle.</span></div></div></div>}
          </div>
          <div className="itf-clu">
            <div className="itf-mlab"><span>Flags</span><span className="rule" /><span className="free">on / off · hover</span></div>
            <div className="itf-flags">
              {FLAGS.map((f) => <span key={f.id} className={`itf-flag${flagOn[f.id] ? ' on' : ''}`} title={f.tip} onClick={() => setFlagOn((o) => ({ ...o, [f.id]: !o[f.id] }))}><Icon name={f.icon} size={17} /><span className="fl-t">{f.label}</span></span>)}
            </div>
          </div>
          {profile !== 'uniform' && (
            <div className="itf-f" style={{ maxWidth: 240, marginBottom: 0 }}><label className="itf-lab">Expiry / best before <span className="opt">(optional)</span></label><EditorialDatePicker value={expiry} onChange={setExpiry} placeholder="dd/mm/yyyy" ariaLabel="Expiry date" /></div>
          )}
        </Sec>

        {/* 6 REFERENCE */}
        <Sec icon="Tag" name="Reference" open={open.ref} onToggle={() => toggle('ref')} summary={<span className="sc muted">barcode · tags · notes</span>}>
          <div className="itf-f"><label className="itf-lab">Barcode / QR</label>
            <input className="itf-in" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan, generate or enter…" />
            <div className="itf-scanbtns">
              <button type="button" className="itf-mini" onClick={() => setShowScan(true)} title="Scan a barcode or QR with the camera"><Icon name="ScanLine" size={15} /> Scan</button>
              <button type="button" className="itf-mini g" onClick={handleCreateQr} title="Generate a printable QR code for this item"><Icon name="QrCode" size={15} /> Create QR</button>
            </div>
            <p className="itf-scanhint">Scan a code, or <b>Create QR</b> to mint &amp; print a unique label for this item.</p>
          </div>
          <div className="itf-f"><label className="itf-lab">Tags</label><div className="itf-chips">{['drinks', 'bar', 'snacks', 'safety', 'cleaning'].map((t) => <span key={t} className={`itf-chip${tags.includes(t) ? ' on' : ''}`} onClick={() => setTags((xs) => xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t])}>{t}</span>)}{tags.filter((t) => !['drinks', 'bar', 'snacks', 'safety', 'cleaning'].includes(t)).map((t) => <span key={t} className="itf-chip on" onClick={() => setTags((xs) => xs.filter((x) => x !== t))}>{t} ✕</span>)}<input className="itf-chip-in" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = tagDraft.trim(); if (v && !tags.includes(v)) setTags((xs) => [...xs, v]); setTagDraft(''); } }} placeholder="+ custom" /></div></div>
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
      <LocationPicker vesselLocations={vesselLocations} selectedId={locTarget?.kind === 'uni' ? (uniLocs[locTarget?.idx]?.id || '') : (locRows[locTarget?.idx]?.id || '')} onSelect={handleLocPicked} onClose={() => setLocTarget(null)} onMap={() => { setLocTarget(null); setOnMap(); }} />
    )}
    {mapItem && (
      <MapPickerModal placingItem={mapItem} onPlaced={(payload) => { if (payload?.nodeId) addMapLocation(payload); setMapItem(null); }} onClose={() => setMapItem(null)} />
    )}
    {showScan && (
      <BarcodeScanModal onDetect={(val) => { setBarcode(val); setShowScan(false); }} onClose={() => setShowScan(false)} />
    )}
    </>
  );
};

export default ItemFormModal;
