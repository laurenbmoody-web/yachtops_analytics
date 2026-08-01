import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import {
  fetchTenantKit, saveKitItem, deleteKitItem, recordKitReturn, requestKitSignoff,
  logKitEvent, fmtKitDate, CONDITIONS, canonicalGarment, GARMENT_ORDER, GARMENT_ICON,
  KIT_CATEGORIES, kitCategoryLabel, fetchVesselIdentity, kitSignatureDataUrl, fetchCabinAllocation,
} from '../../crew-profile/utils/crewKit';
import { exportKitReceipt } from '../../crew-profile/utils/kitReceiptExport';
import { sendDbNotification } from '../../../lib/dbNotifications';
import { EditorialDatePicker } from '../../../components/editorial';
import { exportCrewKitList } from '../utils/crewKitListExport';
import { getAllItems, adjustItemQuantity, saveItem } from '../../inventory/utils/inventoryStorage';
import { canViewCost } from '../../../utils/costPermissions';
import { money } from '../utils/laundryBilling';
import PersonTiles from './PersonTiles';
import { FilterMenu, SortMenu } from './LaundryFilters';
import './crewFolder.css';

const today = () => new Date().toISOString().slice(0, 10);

const STATUS = {
  in_service: { label: 'In service', cls: 'live' },
  returned: { label: 'Returned', cls: 'done' },
  lost: { label: 'Lost / written off', cls: 'lost' },
};
const kitStatus = (k) => {
  if (k.status === 'in_service') {
    if (k.swap_requested_size) return { label: 'Swap requested', cls: 'swap' };
    if (k.acknowledged_at) return { label: 'In service', cls: 'live' };
    if (k.signoff_requested_at) return { label: 'Sign-off sent', cls: 'await' };
    return { label: 'Awaiting sign-off', cls: 'await' };
  }
  return STATUS[k.status] || { label: k.status, cls: 'live' };
};

// The inventory folder an issued item files under, so the List view mirrors how
// uniform is filed in inventory. Inventory's location model is the materialized
// folder path — `location` + `sub_location` ('>'-joined) — NOT the deprecated
// l1..l4 taxonomy. Show the folders BELOW the "Uniform" anchor (e.g. Interior >
// Crew > Uniform > On charter > Evening wear → "On charter › Evening wear");
// "Uncategorised" when the issued row isn't linked to inventory stock yet.
const UNCATEGORISED = 'Uncategorised';
const catPath = (item) => {
  if (!item) return UNCATEGORISED;
  const parts = [];
  if (item.location) parts.push(item.location);
  if (item.subLocation) item.subLocation.split('>').forEach((s) => parts.push(s));
  const segs = parts.map((s) => (s || '').trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase()); // drop duplicated roots
  if (!segs.length) return UNCATEGORISED;
  const ui = segs.findIndex((s) => s.toLowerCase() === 'uniform');
  const below = ui >= 0 ? segs.slice(ui + 1) : segs.slice(1); // below Uniform, else drop the top root
  return (below.length ? below : segs.slice(-1)).join(' › ');
};

// The item's inventory folder path as deduped segments (location + sub_location).
const pathSegs = (item) => {
  const parts = [];
  if (item.location) parts.push(item.location);
  if (item.subLocation) item.subLocation.split('>').forEach((s) => parts.push(s));
  return parts.map((s) => (s || '').trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase());
};
// Uniform is defined by the FOLDER, not a per-item flag: an item is issuable
// uniform when it's filed anywhere under a "Uniform" folder. `is_uniform` is kept
// only as an optional override for uniform that lives outside that tree.
const underUniform = (item) => pathSegs(item).some((s) => s.toLowerCase() === 'uniform');
const isUniformStock = (item) => underUniform(item) || item.isUniform;
// Segments BELOW the "Uniform" anchor — what the issue browser drills through
// (Uniform > On charter > Evening wear → the item lives in "Evening wear").
const uniformRel = (item) => {
  const segs = pathSegs(item);
  const ui = segs.map((s) => s.toLowerCase()).lastIndexOf('uniform');
  return ui >= 0 ? segs.slice(ui + 1) : segs;
};

// A crew member's kit reads like inventory — grouped CHARTER-first (what they
// hold on charter vs off charter) then by TYPE. Both are derived automatically
// from the item's Uniform folder path (rel = segments below "Uniform"), so the
// grouping mirrors however the interior filed the stock — no separate tagging.
const charterOf = (rel = []) => {
  for (const s of rel) {
    if (/off[\s-]*charter/i.test(s)) return 'Off charter';
    if (/on[\s-]*charter/i.test(s)) return 'On charter';
  }
  return 'General';
};
const CHARTER_ORDER = { 'On charter': 0, 'Off charter': 1, General: 2 };
// Folder segments that aren't garment categories — the interior files uniform
// under gender / a charter split / generic buckets, none of which are a "type".
const GENDER_RE = /^(mens?|womens?|ladies|unisex|kids?)$/i;
const GENERIC_RE = /^(general|all|standard|default|misc|other|crew)$/i;
const CHARTER_RE = /(on|off)[\s-]*charter/i;
// Garment type from the item's folder leaf (skipping gender / charter / generic
// buckets), folding down to Clothing / Footwear / Accessories; falls back to
// classifying the item name when nothing meaningful is in the path.
const TYPE_ORDER = GARMENT_ORDER;
const typeOf = (rel = [], name = '') => {
  for (let i = rel.length - 1; i >= 0; i -= 1) {
    const s = rel[i];
    if (GENDER_RE.test(s) || GENERIC_RE.test(s) || CHARTER_RE.test(s)) continue;
    return canonicalGarment(s);
  }
  return canonicalGarment(name);
};
const typeIcon = (type) => GARMENT_ICON[type] || 'Shirt';

// Sort sizes into wearing order (XS→XXL, then numeric, then alpha; "one size" last).
const SIZE_RANK = { XXS: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, '2XL': 6, XXL: 6, '3XL': 7, XXXL: 7 };
const sizeSort = (a, b) => {
  const A = String(a || '').toUpperCase().trim();
  const B = String(b || '').toUpperCase().trim();
  if (A === B) return 0;
  if (!A) return 1; if (!B) return -1;
  const ra = SIZE_RANK[A]; const rb = SIZE_RANK[B];
  if (ra != null && rb != null) return ra - rb;
  if (ra != null) return -1; if (rb != null) return 1;
  const na = parseFloat(A); const nb = parseFloat(B);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return A.localeCompare(B);
};

// Non-uniform hand-outs (PPE, electronics, keys…) live in the Crew world too now
// — grouped by kit category rather than charter/garment type.
const isUniformKit = (k) => (k.category || 'uniform') === 'uniform';
const CATEGORY_ICON = { ppe: 'HardHat', electronics: 'Radio', equipment: 'Wrench', keys: 'Key', other: 'Package', uniform: 'Shirt' };
const CATEGORY_ORDER = KIT_CATEGORIES.reduce((m, c, i) => { m[c.id] = i; return m; }, {});
// Which kit category an inventory item files under when issued — inferred from
// its folder path + name so a hand-out from the Electronics folder records as
// 'electronics', a PPE item as 'ppe', anything under Uniform as 'uniform', etc.
const kitCategoryOf = (item) => {
  if (!item) return 'other';
  const hay = `${pathSegs(item).join(' ')} ${item.name || ''}`.toLowerCase();
  if (item.isUniform || pathSegs(item).some((s) => s.toLowerCase() === 'uniform')) return 'uniform';
  if (/\bppe\b|protective|hi-?vis|hard\s*hat|goggle|harness|life\s*jacket|life\s*vest|safety\s*(boot|glove|glasses)/.test(hay)) return 'ppe';
  if (/electronic|radio|\bvhf\b|phone|ipad|tablet|laptop|camera|charger|comms|handset/.test(hay)) return 'electronics';
  if (/\bkey\b|fob|access\s*card|swipe/.test(hay)) return 'keys';
  if (/equipment|\btool|torch|head\s*torch|gear/.test(hay)) return 'equipment';
  return 'other';
};

// Apply per-size stock changes to an inventory item and persist. Deltas are
// keyed by size (use '' for a plain item); negative removes (issuing), positive
// adds back (returning / swapping). Removes pull across storage locations in
// order; adds land on the first location holding that size, else the first
// sized location. Keeps variants, stock-location tallies and the total in step.
const applyStockDelta = async (item, deltas) => {
  const entries = Object.entries(deltas).filter(([, d]) => d);
  if (!entries.length) return;
  const vs = (item.variants || []).filter((v) => v && (v.size || v.label));
  if (!vs.length) {
    const total = entries.reduce((a, [, d]) => a + d, 0);
    if (total) await adjustItemQuantity(item.id, total);
    return;
  }
  const variants = item.variants.map((v) => {
    const s = v.size || v.label;
    const d = deltas[s] || 0;
    return { ...v, qty: Math.max(0, (Number(v.qty ?? v.quantity) || 0) + d) };
  });
  const newTotal = variants.reduce((a, v) => a + (Number(v.qty) || 0), 0);
  let stockLocations = (item.stockLocations || []).map((sl) => ({
    ...sl, sizes: Array.isArray(sl.sizes) ? sl.sizes.map((z) => ({ ...z })) : sl.sizes,
  }));
  entries.forEach(([size, d]) => {
    if (d < 0) {
      let rem = -d;
      stockLocations.forEach((sl) => {
        if (!Array.isArray(sl.sizes)) return;
        sl.sizes.forEach((z) => {
          if (z.size === size && rem > 0) { const take = Math.min(Number(z.qty) || 0, rem); z.qty = (Number(z.qty) || 0) - take; rem -= take; }
        });
      });
    } else {
      let placed = false;
      for (const sl of stockLocations) {
        if (!Array.isArray(sl.sizes)) continue;
        const z = sl.sizes.find((x) => x.size === size);
        if (z) { z.qty = (Number(z.qty) || 0) + d; placed = true; break; }
      }
      if (!placed) { const sl = stockLocations.find((x) => Array.isArray(x.sizes)); if (sl) sl.sizes.push({ size, qty: d }); }
    }
  });
  stockLocations = stockLocations.map((sl) => {
    if (!Array.isArray(sl.sizes)) return sl;
    const sizes = sl.sizes.filter((z) => (Number(z.qty) || 0) > 0);
    const qq = sizes.reduce((a, z) => a + (Number(z.qty) || 0), 0);
    return { ...sl, sizes, quantity: qq, qty: qq };
  }).filter((sl) => !Array.isArray(sl.sizes) || (sl.quantity || 0) > 0);
  await saveItem({ ...item, variants, totalQty: newTotal, quantity: newTotal, stockLocations }, { dedupe: false });
};

// Issue-from-inventory: browse the whole inventory tree as tiles (Uniform,
// Electronics, PPE…), drill down to items, tick items and allocate a quantity
// (−/count/+, capped at what's on board), then issue the lot in one go. Anything
// not in inventory goes through "Add item" (manual hand-out).
const IssueModal = ({ crewName, stock, folderRels = [], showValue, onIssue, onAddManual, onClose }) => {
  const [trail, setTrail] = useState([]); // folder path segments from the root
  const [open, setOpen] = useState({});   // itemId -> ticked open for allocation
  const [sel, setSel] = useState({});     // `${itemId}|${size}` -> allocated qty
  const [busy, setBusy] = useState(false);

  const withRel = useMemo(() => stock.map((i) => ({ i, rel: pathSegs(i) })), [stock]);
  const atLevel = useMemo(
    () => withRel.filter((x) => trail.every((t, idx) => (x.rel[idx] || '').toLowerCase() === t.toLowerCase())),
    [withRel, trail]
  );
  // Child folders = real inventory folders at this level (so empty ones show)
  // plus any surfaced by items, with the item count on each.
  const folders = useMemo(() => {
    const key = (s) => s.toLowerCase();
    const under = (rel) => rel.length > trail.length && trail.every((t, idx) => (rel[idx] || '').toLowerCase() === t.toLowerCase());
    const m = new Map();
    folderRels.forEach((rel) => { if (under(rel)) { const seg = rel[trail.length]; if (!m.has(key(seg))) m.set(key(seg), { name: seg, count: 0 }); } });
    atLevel.forEach((x) => { if (x.rel.length > trail.length) { const seg = x.rel[trail.length]; const e = m.get(key(seg)) || { name: seg, count: 0 }; e.count += 1; m.set(key(seg), e); } });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [folderRels, atLevel, trail]);
  const itemsHere = useMemo(() => atLevel.filter((x) => x.rel.length === trail.length).map((x) => x.i), [atLevel, trail]);

  // Size-run uniforms expose a stepper PER SIZE (pull out 2 × M, 1 × L); plain
  // items keep the single stepper. `sel` is keyed `${itemId}|${size}` (size '' = plain).
  const variantsOf = (i) => (i.variants || []).filter((v) => v && (v.size || v.label));
  const vSize = (v) => v.size || v.label;
  const vQty = (v) => Number(v.qty ?? v.quantity) || 0;
  const stockOf = (i) => Number(i.totalQty ?? i.quantity) || 0;
  const skey = (id, size) => `${id}|${size || ''}`;
  const toggle = (i) => setOpen((p) => {
    const n = { ...p };
    if (i.id in n) {
      delete n[i.id];
      setSel((s) => { const ns = { ...s }; Object.keys(ns).forEach((k) => { if (k.startsWith(`${i.id}|`)) delete ns[k]; }); return ns; });
    } else n[i.id] = true;
    return n;
  });
  const bump = (id, size, d, cap) => setSel((p) => ({ ...p, [skey(id, size)]: Math.max(0, Math.min(cap, (p[skey(id, size)] || 0) + d)) }));

  const alloc = [];
  stock.forEach((i) => {
    const vs = variantsOf(i);
    if (vs.length) vs.forEach((v) => { const q = sel[skey(i.id, vSize(v))] || 0; if (q > 0) alloc.push({ invItem: i, size: vSize(v), qty: q }); });
    else { const q = sel[skey(i.id, '')] || 0; if (q > 0) alloc.push({ invItem: i, size: i.size || null, qty: q }); }
  });
  const totalUnits = alloc.reduce((a, x) => a + x.qty, 0);

  const submit = async () => {
    if (!alloc.length || busy) return;
    setBusy(true);
    try { await onIssue(alloc); } finally { setBusy(false); }
  };

  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Issue item</span><h2 className="cf-modal-title">To {crewName}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {/* Breadcrumb — Inventory is the root; each tile drills a folder deeper. */}
        <div className="cf-crumb">
          <button type="button" className="cf-crumb-seg" onClick={() => setTrail([])}>Inventory</button>
          {trail.map((seg, i) => (
            <React.Fragment key={i}>
              <span className="cf-crumb-sep">›</span>
              <button type="button" className="cf-crumb-seg" onClick={() => setTrail(trail.slice(0, i + 1))}>{seg}</button>
            </React.Fragment>
          ))}
        </div>

        <div className="cf-modal-body">
          {stock.length === 0 && folderRels.length === 0 ? (
            <p className="cf-empty-note">Nothing in inventory yet. Use <b>Add item</b> below to hand out kit that isn’t stocked.</p>
          ) : (
            <>
              {folders.length > 0 && (
                <div className="cf-folder-grid">
                  {folders.map((f) => (
                    <button type="button" key={f.name} className="cf-folder" onClick={() => setTrail([...trail, f.name])}>
                      <span className="cf-folder-ic"><Icon name="Folder" size={18} /></span>
                      <span className="cf-folder-nm">{f.name}</span>
                      <span className="cf-folder-ct">{f.count} item{f.count === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                </div>
              )}
              {itemsHere.length > 0 && (
                <div className="cf-item-grid">
                  {itemsHere.map((i) => {
                    const onboard = stockOf(i);
                    const opened = i.id in open;
                    const vs = variantsOf(i);
                    const plainQty = sel[skey(i.id, '')] || 0;
                    return (
                      <div className={`cf-itile${opened ? ' on' : ''}`} key={i.id}>
                        <button type="button" className="cf-itile-media" onClick={() => toggle(i)}>
                          {i.imageUrl ? <img src={i.imageUrl} alt={i.name} /> : <span className="cf-itile-ph"><Icon name={CATEGORY_ICON[kitCategoryOf(i)] || 'Package'} size={26} /></span>}
                          <span className="cf-itile-check"><Icon name={opened ? 'CheckSquare' : 'Square'} size={18} /></span>
                        </button>
                        <div className="cf-itile-body">
                          <span className="cf-itile-nm">{i.name}{!vs.length && i.size ? ` · ${i.size}` : ''}</span>
                          <span className="cf-itile-sub">{onboard} on board{showValue && i.unitCost != null ? ` · ${money(i.unitCost, i.currency)}` : ''}</span>
                        </div>
                        {opened && (vs.length ? (
                          <div className="cf-sizes">
                            {vs.map((v) => {
                              const cap = vQty(v);
                              const q = sel[skey(i.id, vSize(v))] || 0;
                              return (
                                <div className="cf-sizerow" key={vSize(v)}>
                                  <span className="cf-sizelbl">{vSize(v)}</span>
                                  <div className="cf-itile-qty">
                                    <button type="button" className="cf-qbtn" onClick={() => bump(i.id, vSize(v), -1, cap)} disabled={q <= 0} aria-label="Less">−</button>
                                    <span className="cf-qnum">{q}</span>
                                    <button type="button" className="cf-qbtn" onClick={() => bump(i.id, vSize(v), 1, cap)} disabled={q >= cap} aria-label="More">+</button>
                                  </div>
                                  <span className="cf-itile-of">of {cap}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="cf-itile-qty">
                            <button type="button" className="cf-qbtn" onClick={() => bump(i.id, '', -1, onboard)} disabled={plainQty <= 0} aria-label="Less">−</button>
                            <span className="cf-qnum">{plainQty}</span>
                            <button type="button" className="cf-qbtn" onClick={() => bump(i.id, '', 1, onboard)} disabled={plainQty >= onboard} aria-label="More">+</button>
                            <span className="cf-itile-of">of {onboard}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              {folders.length === 0 && itemsHere.length === 0 && <p className="cf-empty-note">Nothing filed here.</p>}
            </>
          )}
        </div>

        <div className="cf-modal-foot">
          <button type="button" className="cf-btn quiet" onClick={() => onAddManual(trail)}><Icon name="Plus" size={15} /> Add item not in inventory</button>
          <span className="cf-foot-spacer" />
          <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cf-btn primary" disabled={busy || totalUnits === 0} onClick={submit}>
            {busy ? 'Issuing…' : totalUnits > 0 ? `Issue ${totalUnits} item${totalUnits === 1 ? '' : 's'}` : 'Issue'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Return modal: hand kit back, choosing whether it goes back into inventory.
const ReturnModal = ({ row, onReturn, onClose }) => {
  const [restock, setRestock] = useState(true);
  const [condition, setCondition] = useState('Good');
  const [busy, setBusy] = useState(false);
  const linked = !!row.inventory_item_id;
  const submit = async () => { setBusy(true); try { await onReturn(row, { restock: restock && linked, condition }); } finally { setBusy(false); } };
  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cf-modal sm" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Return kit</span><h2 className="cf-modal-title">{row.item}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="cf-modal-body">
          <label className="cf-l">Condition back</label>
          <div className="cf-select"><select value={condition} onChange={(e) => setCondition(e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <label className={`cf-check${restock ? ' on' : ''}${linked ? '' : ' disabled'}`}>
            <input type="checkbox" checked={restock && linked} disabled={!linked} onChange={(e) => setRestock(e.target.checked)} />
            <span>
              <b>Put back into inventory</b>
              <span className="cf-check-sub">{linked ? `Adds ${row.quantity || 1} back to the master stock. Leave off to write it off (kept / consumed / binned).` : 'This item isn’t linked to inventory stock, so nothing to restock.'}</span>
            </span>
          </label>
        </div>
        <div className="cf-modal-foot">
          <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cf-btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Confirm return'}</button>
        </div>
      </div>
    </div>
  );
};

// Swap modal: fulfil a crew member's size-swap request — hand back the wrong
// size and issue the one they asked for, in one move.
const SwapModal = ({ row, inv, crewName, onSwap, onClose }) => {
  const [busy, setBusy] = useState(false);
  const size = row.swap_requested_size;
  const variant = (inv?.variants || []).find((v) => (v.size || v.label) === size);
  const inStock = variant ? (Number(variant.qty ?? variant.quantity) || 0) : (inv ? (Number(inv.totalQty ?? inv.quantity) || 0) : null);
  const submit = async () => { setBusy(true); try { await onSwap(row); } finally { setBusy(false); } };
  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cf-modal sm" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Swap size</span><h2 className="cf-modal-title">{row.item}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="cf-modal-body">
          <div className="cf-swap-flow">
            <span className="cf-swap-chip old">{row.size || 'Current'}</span>
            <Icon name="ArrowRight" size={16} />
            <span className="cf-swap-chip new">{size}</span>
          </div>
          <p className="cf-empty-note" style={{ padding: 0 }}>
            {crewName ? `${crewName.split(' ')[0]} asked for ` : 'Requested '}<b>{size}</b> instead of {row.size ? <b>{row.size}</b> : 'the current size'}. This returns the {row.size || 'current'} to stock and issues {size} in its place.
          </p>
          {inStock != null && (
            inStock > 0
              ? <p className="cf-stock-ok"><Icon name="Check" size={13} /> {inStock} in stock in {size}</p>
              : <p className="cf-warn">Not currently in stock in {size} — you can still swap if you have it to hand.</p>
          )}
        </div>
        <div className="cf-modal-foot">
          <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cf-btn primary" disabled={busy} onClick={submit}>{busy ? 'Swapping…' : `Swap to ${size}`}</button>
        </div>
      </div>
    </div>
  );
};

// Folder browser (breadcrumb + folder tiles) for choosing where a new inventory
// item is filed — the same drill-down as the issue browser, not a flat dropdown.
const FolderPicker = ({ folderRels = [], value = [], onChange }) => {
  const children = useMemo(() => {
    const m = new Map();
    folderRels.forEach((rel) => {
      if (rel.length > value.length && value.every((t, idx) => (rel[idx] || '').toLowerCase() === t.toLowerCase())) {
        const seg = rel[value.length];
        if (!m.has(seg.toLowerCase())) m.set(seg.toLowerCase(), seg);
      }
    });
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }, [folderRels, value]);
  return (
    <div className="cf-fp">
      <div className="cf-crumb cf-fp-crumb">
        <button type="button" className="cf-crumb-seg" onClick={() => onChange([])}>Inventory</button>
        {value.map((seg, i) => (
          <React.Fragment key={i}>
            <span className="cf-crumb-sep">›</span>
            <button type="button" className="cf-crumb-seg" onClick={() => onChange(value.slice(0, i + 1))}>{seg}</button>
          </React.Fragment>
        ))}
      </div>
      {value.length >= 2 && <p className="cf-fp-here"><Icon name="Check" size={13} /> Filing under <b>{value[value.length - 1]}</b></p>}
      {children.length > 0 ? (
        <div className="cf-fp-grid">
          {children.map((c) => (
            <button type="button" key={c} className="cf-fp-folder" onClick={() => onChange([...value, c])}>
              <Icon name="Folder" size={15} /><span>{c}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="cf-fp-note">{value.length >= 2 ? 'No sub-folders — the item will be filed here.' : 'Pick a folder to file it under.'}</p>
      )}
    </div>
  );
};

// Hand out a non-uniform item (PPE, a radio, a key fob…) by hand — for kit that
// isn't drawn from the uniform inventory. Same sign-off loop applies afterwards.
// Optionally register the item into inventory (into a real subfolder) so it's
// stock-tracked and issuable from inventory next time.
const HandoutModal = ({ crewName, folderRels = [], defaultFolder = [], onHandout, onClose }) => {
  const hasFolders = useMemo(() => folderRels.some((rel) => rel.length >= 2), [folderRels]);
  const [form, setForm] = useState({ category: 'ppe', item: '', serial: '', size: '', quantity: 1, condition: 'New', issuedDate: today(), notes: '' });
  const [addToInv, setAddToInv] = useState(false);
  const [invFolder, setInvFolder] = useState(defaultFolder?.length >= 2 ? defaultFolder : (defaultFolder?.length ? defaultFolder : []));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const invReady = !addToInv || invFolder.length >= 2;
  const submit = async () => {
    if (!form.item.trim() || busy || !invReady) return;
    setBusy(true);
    try { await onHandout({ ...form, invFolder: addToInv && invFolder.length >= 2 ? invFolder : null }); } finally { setBusy(false); }
  };
  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Hand out</span><h2 className="cf-modal-title">To {crewName}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="cf-modal-body cf-handout">
          <label className="cf-field"><span>Category</span>
            <div className="cf-select"><select value={form.category} onChange={(e) => set('category', e.target.value)}>{KIT_CATEGORIES.filter((c) => c.id !== 'uniform').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          </label>
          <label className="cf-field cf-col2"><span>Item <em className="req">required</em></span>
            <input className="cf-input" value={form.item} onChange={(e) => set('item', e.target.value)} placeholder="e.g. Handheld VHF radio, cabin key fob" />
          </label>
          <label className="cf-field"><span>Serial / asset no.</span>
            <input className="cf-input" value={form.serial} onChange={(e) => set('serial', e.target.value)} placeholder="IMEI / FOB-0431" />
          </label>
          <label className="cf-field"><span>Size <em>optional</em></span>
            <input className="cf-input" value={form.size} onChange={(e) => set('size', e.target.value)} placeholder="e.g. UK 9, M" />
          </label>
          <label className="cf-field"><span>Quantity</span>
            <input className="cf-input" type="number" min="1" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </label>
          <label className="cf-field"><span>Condition</span>
            <div className="cf-select"><select value={form.condition} onChange={(e) => set('condition', e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          </label>
          <label className="cf-field"><span>Issued date</span>
            <EditorialDatePicker value={(form.issuedDate || '').slice(0, 10)} onChange={(iso) => set('issuedDate', iso)} placeholder="dd/mm/yyyy" />
          </label>
          <label className="cf-field cf-col2"><span>Notes <em>optional</em></span>
            <input className="cf-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="anything worth recording" />
          </label>
          <div className="cf-field cf-col2">
            <label className={`cf-invtoggle${addToInv ? ' on' : ''}`}>
              <input type="checkbox" checked={addToInv} onChange={(e) => setAddToInv(e.target.checked)} disabled={!hasFolders} />
              <span>
                <b>Also add to inventory</b>
                <span className="cf-invtoggle-sub">{hasFolders ? 'Register this item so it’s stock-tracked and issuable next time.' : 'No inventory folders available to file it under.'}</span>
              </span>
            </label>
            {addToInv && hasFolders && <FolderPicker folderRels={folderRels} value={invFolder} onChange={setInvFolder} />}
          </div>
        </div>
        <div className="cf-modal-foot">
          <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cf-btn primary" disabled={busy || !form.item.trim() || !invReady} onClick={submit}>{busy ? 'Handing out…' : 'Hand out'}</button>
        </div>
      </div>
    </div>
  );
};

// The Crew world: a folder of crew (name tiles) → click a person → the uniform
// issued to them. Issuing draws from master inventory; the crew profile shows
// the same kit read-only for the crew member to sign off.
const CrewFolder = ({ onBack, initialCrewId = null }) => {
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();
  const showValue = canViewCost();
  const canManage = (tenantRole || '').toUpperCase() === 'COMMAND' || (user?.department || '').toLowerCase() === 'interior';

  const [roster, setRoster] = useState([]);
  const [kit, setKit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [stock, setStock] = useState([]);
  const [folderRels, setFolderRels] = useState([]); // inventory folder paths below "Uniform"
  const [issuing, setIssuing] = useState(false);
  const [handingOut, setHandingOut] = useState(false);
  const [handoutFolder, setHandoutFolder] = useState([]); // inventory folder browsed when "Add item" was tapped
  const [returning, setReturning] = useState(null);
  const [swapping, setSwapping] = useState(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [sort, setSort] = useState('name');
  const [crewView, setCrewView] = useState('tiles'); // tiles (by crew) | list (combined uniform)
  // Member kit view — its own search / filter / sort (mirrors inventory tiles).
  const [kq, setKq] = useState('');
  const [kCharter, setKCharter] = useState('all');
  const [kType, setKType] = useState('all');
  const [kStatus, setKStatus] = useState('all');
  const [kSort, setKSort] = useState('newest');
  const [signingOff, setSigningOff] = useState(false);
  const [receiptChooser, setReceiptChooser] = useState(false);
  const [exportingReceipt, setExportingReceipt] = useState(false);

  const load = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [crew, allKit, all] = await Promise.all([
      fetchTenantCrew(activeTenantId), fetchTenantKit(activeTenantId), getAllItems().catch(() => []),
    ]);
    setRoster(crew); setKit(allKit); setStock(all);
    // The full inventory folder tree, so the issue browser shows the structure
    // (empty folders included), not just folders that already hold items.
    const { data: locs } = await supabase
      .from('inventory_locations')
      .select('location, sub_location')
      .eq('tenant_id', activeTenantId)
      .eq('is_archived', false);
    const rels = [];
    (locs || []).forEach((r) => {
      const rel = pathSegs({ location: r.location, subLocation: r.sub_location });
      if (rel.length) rels.push(rel);
    });
    setFolderRels(rels);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeTenantId]);
  // Deep-link straight to a crew member (e.g. from a swap-request notification).
  useEffect(() => { if (initialCrewId) setSelectedId(initialCrewId); }, [initialCrewId]);

  // Cabin + interior laundry marking for the selected crew member (crew_employment).
  const [memberAlloc, setMemberAlloc] = useState({});
  useEffect(() => {
    let cancelled = false;
    setMemberAlloc({});
    if (selectedId) fetchCabinAllocation(selectedId).then((a) => { if (!cancelled) setMemberAlloc(a || {}); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const openIssue = async () => { setIssuing(true); const all = await getAllItems(); setStock(all); };

  // Linked inventory item by id — lets the List view file each issued item under
  // its inventory folder path (the same category tree used in inventory).
  const itemById = useMemo(() => Object.fromEntries(stock.map((i) => [i.id, i])), [stock]);

  const countByUser = useMemo(() => {
    const m = {};
    kit.forEach((k) => { if (k.status === 'in_service') m[k.user_id] = (m[k.user_id] || 0) + 1; });
    return m;
  }, [kit]);

  const depts = useMemo(() => [...new Set(roster.map((c) => c.department).filter((d) => d && d !== '—'))].sort(), [roster]);
  const deptMatch = (c) => dept === 'all' || c.department === dept;

  // Roster as tiles — filtered by department + name search, sorted.
  const tilePeople = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = roster.filter(deptMatch);
    if (s) list = list.filter((c) => (c.fullName || '').toLowerCase().includes(s));
    const rows = list.map((c) => ({
      id: c.id, name: c.fullName, photo: c.photo,
      subtitle: [c.roleTitle, c.department].filter(Boolean).join(' · '),
      count: countByUser[c.id] || 0, countLabel: 'issued',
    }));
    rows.sort((a, b) => (sort === 'most' ? b.count - a.count : sort === 'fewest' ? a.count - b.count : (a.name || '').localeCompare(b.name || '')));
    return rows;
  }, [roster, q, dept, sort, countByUser]);

  // List view — every in-service item combined across the (dept-filtered) crew,
  // keyed by item + size (3 crew each holding 2 × Polo white M → 6 × Polo white M),
  // grouped into the same canonical sections as a member's kit (uniform by
  // charter → garment type, then equipment by category) so it reads consistently.
  const sectionFor = (r) => {
    if ((r.category || 'uniform') === 'uniform') {
      const rel = uniformRel(itemById[r.invId] || {});
      const charter = charterOf(rel); const type = typeOf(rel, r.item);
      return { key: `u|${charter}||${type}`, kind: 'uniform', charter, type, title: charter === 'General' ? type : `${charter} · ${type}`, icon: typeIcon(type) };
    }
    const cat = r.category || 'other';
    return { key: `e|${cat}`, kind: 'equip', category: cat, title: kitCategoryLabel(cat), icon: CATEGORY_ICON[cat] || 'Package' };
  };
  const listGroups = useMemo(() => {
    const ids = new Set(roster.filter(deptMatch).map((c) => c.id));
    const m = new Map();
    // One entry per item (across sizes) — sizes roll up into a breakdown so a
    // multi-size item is a single line, not one row per size.
    kit.filter((k) => k.status === 'in_service' && ids.has(k.user_id)).forEach((k) => {
      const cat = k.category || 'uniform';
      const key = `${(k.item || '').trim().toLowerCase()}|${cat}`;
      if (!m.has(key)) m.set(key, { item: k.item, category: cat, sizes: new Map(), holders: new Set(), value: k.value, invId: k.inventory_item_id || null });
      const r = m.get(key);
      const sz = (k.size || '').trim();
      r.sizes.set(sz, (r.sizes.get(sz) || 0) + (Number(k.quantity) || 1));
      r.holders.add(k.user_id);
      if (r.value == null && k.value != null) r.value = k.value;
      if (!r.invId && k.inventory_item_id) r.invId = k.inventory_item_id;
    });
    let rows = [...m.values()].map((r) => {
      const sizes = [...r.sizes.entries()].map(([size, qty]) => ({ size, qty })).sort((a, b) => sizeSort(a.size, b.size));
      const total = sizes.reduce((a, s) => a + s.qty, 0);
      return { item: r.item, category: r.category, value: r.value, invId: r.invId, img: itemById[r.invId]?.imageUrl || null, sizes, total, holders: r.holders.size, section: sectionFor(r) };
    });
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((r) => `${r.item} ${r.sizes.map((x) => x.size).join(' ')} ${r.section.title}`.toLowerCase().includes(s));
    const g = new Map();
    rows.forEach((r) => { if (!g.has(r.section.key)) g.set(r.section.key, { ...r.section, rows: [] }); g.get(r.section.key).rows.push(r); });
    const groups = [...g.values()].map((grp) => ({
      ...grp,
      units: grp.rows.reduce((a, r) => a + r.total, 0),
      rows: grp.rows.sort((a, b) => (sort === 'qty' ? b.total - a.total : (a.item || '').localeCompare(b.item || ''))),
    }));
    groups.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'uniform' ? -1 : 1;
      if (a.kind === 'uniform') return ((CHARTER_ORDER[a.charter] ?? 9) - (CHARTER_ORDER[b.charter] ?? 9)) || ((TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)) || a.type.localeCompare(b.type);
      return (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9);
    });
    return groups;
  }, [kit, roster, dept, q, sort, itemById]);

  const sortOptions = crewView === 'list'
    ? [{ val: 'item', label: 'Item (A–Z)' }, { val: 'qty', label: 'Quantity (high → low)' }]
    : [{ val: 'name', label: 'Name (A–Z)' }, { val: 'most', label: 'Most issued' }, { val: 'fewest', label: 'Fewest issued' }];
  const filterGroups = [
    { key: 'dept', label: 'Department', value: dept, neutral: 'all', onChange: setDept, options: [{ value: 'all', label: 'All departments' }, ...depts.map((d) => ({ value: d, label: d }))] },
  ];
  const switchView = (v) => { setCrewView(v); setSort(v === 'list' ? 'item' : 'name'); };

  const [exportingList, setExportingList] = useState(false);
  const doExportList = async () => {
    if (exportingList || !listGroups.length) return;
    setExportingList(true);
    try {
      const vessel = await fetchVesselIdentity(activeTenantId).catch(() => null);
      await exportCrewKitList({
        vesselName: vessel?.name, vessel, generatedAt: fmtKitDate(today()),
        groups: listGroups, showValue, scopeLabel: dept === 'all' ? 'All crew · in service' : `${dept} · in service`,
      });
    } catch { window.showToast?.('Couldn’t export — try again', 'error'); }
    finally { setExportingList(false); }
  };

  const selected = roster.find((c) => c.id === selectedId) || null;
  const memberKit = useMemo(
    () => kit.filter((k) => k.user_id === selectedId)
      .sort((a, b) => (b.issued_date || '').localeCompare(a.issued_date || '')),
    [kit, selectedId]
  );

  // Facet per kit row. Uniform files by charter + garment type (from its inventory
  // folder); non-uniform hand-outs (PPE, electronics…) file by kit category.
  const kitFacets = useMemo(() => {
    const m = {};
    memberKit.forEach((k) => {
      const img = itemById[k.inventory_item_id]?.imageUrl || null;
      if (isUniformKit(k)) {
        const rel = uniformRel(itemById[k.inventory_item_id] || {});
        m[k.id] = { kind: 'uniform', charter: charterOf(rel), type: typeOf(rel, k.item), img };
      } else {
        const cat = k.category || 'other';
        m[k.id] = { kind: 'equip', category: cat, charter: 'General', type: kitCategoryLabel(cat), img };
      }
    });
    return m;
  }, [memberKit, itemById]);

  const kitTypes = useMemo(
    () => [...new Set(memberKit.map((k) => kitFacets[k.id]?.type).filter(Boolean))]
      .sort((a, b) => ((TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9)) || a.localeCompare(b)),
    [memberKit, kitFacets]
  );

  // Quick stats for the member header (in-service only): units held + styles.
  const kitStats = useMemo(() => {
    const live = memberKit.filter((k) => k.status === 'in_service');
    return {
      issued: live.reduce((a, k) => a + (Number(k.quantity) || 1), 0),
      styles: live.length,
      returned: memberKit.filter((k) => k.status !== 'in_service').length,
    };
  }, [memberKit]);

  // Items not yet sent for sign-off (what the button sends) vs already sent and
  // still waiting on the crew member — so the button doesn't re-fire on nothing.
  const toSignoff = useMemo(
    () => memberKit.filter((k) => k.status === 'in_service' && !k.acknowledged_at && !k.signoff_requested_at && !k.swap_requested_size).map((k) => k.id),
    [memberKit]
  );
  const awaitingSignoff = useMemo(
    () => memberKit.filter((k) => k.status === 'in_service' && !k.acknowledged_at && (k.signoff_requested_at || k.swap_requested_size)).length,
    [memberKit]
  );

  // Filtered + charter→type grouped view of the member's kit. In-service items
  // group charter-first then by type; returned/retired items collect at the end.
  const memberGroups = useMemo(() => {
    const s = kq.trim().toLowerCase();
    const filtered = memberKit.filter((k) => {
      const f = kitFacets[k.id] || {};
      if (kCharter !== 'all' && f.charter !== kCharter) return false;
      if (kType !== 'all' && f.type !== kType) return false;
      if (kStatus === 'in_service' && k.status !== 'in_service') return false;
      if (kStatus === 'awaiting' && !(k.status === 'in_service' && !k.acknowledged_at)) return false;
      if (kStatus === 'retired' && k.status === 'in_service') return false;
      if (s && !`${k.item} ${k.size || ''} ${f.charter} ${f.type}`.toLowerCase().includes(s)) return false;
      return true;
    });
    const sortRows = (rows) => rows.sort((a, b) => {
      if (kSort === 'name') return (a.item || '').localeCompare(b.item || '');
      if (kSort === 'qty') return (Number(b.quantity) || 1) - (Number(a.quantity) || 1);
      const cmp = (b.issued_date || '').localeCompare(a.issued_date || '');
      return kSort === 'oldest' ? -cmp : cmp;
    });
    const active = filtered.filter((k) => k.status === 'in_service');
    const retired = sortRows(filtered.filter((k) => k.status !== 'in_service'));
    const g = new Map();
    active.forEach((k) => {
      const f = kitFacets[k.id] || {};
      const key = f.kind === 'equip' ? `e|${f.category}` : `u|${f.charter}||${f.type}`;
      if (!g.has(key)) {
        g.set(key, f.kind === 'equip'
          ? { key, kind: 'equip', category: f.category, title: kitCategoryLabel(f.category), icon: CATEGORY_ICON[f.category] || 'Package', rows: [] }
          : { key, kind: 'uniform', charter: f.charter, type: f.type, title: f.charter === 'General' ? f.type : `${f.charter} · ${f.type}`, icon: typeIcon(f.type), rows: [] });
      }
      g.get(key).rows.push(k);
    });
    const groups = [...g.values()].map((grp) => ({ ...grp, rows: sortRows(grp.rows) }));
    // Uniform sections first (charter → garment type), then equipment by category.
    groups.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'uniform' ? -1 : 1;
      if (a.kind === 'uniform') {
        return ((CHARTER_ORDER[a.charter] ?? 9) - (CHARTER_ORDER[b.charter] ?? 9))
          || ((TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)) || a.type.localeCompare(b.type);
      }
      return (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9);
    });
    return { groups, retired };
  }, [memberKit, kitFacets, kq, kCharter, kType, kStatus, kSort]);

  const kitFilterGroups = [
    { key: 'charter', label: 'Charter', value: kCharter, neutral: 'all', onChange: setKCharter,
      options: [{ value: 'all', label: 'All' }, { value: 'On charter', label: 'On charter' }, { value: 'Off charter', label: 'Off charter' }, { value: 'General', label: 'General' }] },
    { key: 'type', label: 'Type', value: kType, neutral: 'all', onChange: setKType,
      options: [{ value: 'all', label: 'All types' }, ...kitTypes.map((t) => ({ value: t, label: t }))] },
    { key: 'status', label: 'Status', value: kStatus, neutral: 'all', onChange: setKStatus,
      options: [{ value: 'all', label: 'All' }, { value: 'in_service', label: 'In service' }, { value: 'awaiting', label: 'Awaiting sign-off' }, { value: 'retired', label: 'Returned / lost' }] },
  ];
  const kitSortOptions = [
    { val: 'newest', label: 'Newest issued' }, { val: 'oldest', label: 'Oldest issued' },
    { val: 'name', label: 'Item (A–Z)' }, { val: 'qty', label: 'Quantity (high → low)' },
  ];

  // Hand-over: stamp the crew member's unacknowledged kit as sent for sign-off,
  // so their profile prompts them to acknowledge receipt or request a size swap.
  const doSignoff = async () => {
    if (!toSignoff.length || signingOff) return;
    setSigningOff(true);
    const n = toSignoff.length;
    const issuerName = user?.user_metadata?.full_name || user?.email;
    try {
      await requestKitSignoff(toSignoff, { requestedBy: user?.id });
      await logKitEvent({ userId: selectedId, tenantId: activeTenantId, action: 'signoff_requested', detail: { count: n }, actorId: user?.id, actorName: issuerName });
      // Ping the crew member's bell so they know to review it on any device.
      await sendDbNotification(selectedId, {
        type: 'kit_signoff',
        title: 'Uniform to sign off',
        message: `${issuerName || 'The interior'} has issued you ${n} uniform item${n === 1 ? '' : 's'} — confirm receipt or request a size swap.`,
        actionUrl: `/profile/${selectedId}?tab=kit`,
        severity: 'info',
      });
      window.showToast?.(`Sent ${n} item${n === 1 ? '' : 's'} to ${selected?.fullName?.split(' ')[0] || 'the crew member'} for sign-off`, 'success');
      await load();
    } catch (e) {
      window.showToast?.('Couldn’t send for sign-off — try again', 'error');
    } finally { setSigningOff(false); }
  };

  // Per-crew kit receipt (the same A4 receipt as the crew profile) — signature
  // blocks show the signature on file, or a blank line to sign once printed.
  const doExportReceipt = async (scope) => {
    setReceiptChooser(false);
    const list = scope === 'held' ? memberKit.filter((k) => k.status === 'in_service') : memberKit;
    if (!list.length) { window.showToast?.(scope === 'held' ? 'Nothing currently held to export' : 'No kit to export yet', 'error'); return; }
    setExportingReceipt(true);
    try {
      const ackPath = list.filter((k) => k.ack_signature_path).sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at)))[0]?.ack_signature_path;
      const retPath = list.filter((k) => k.return_signature_path).sort((a, b) => String(b.returned_date).localeCompare(String(a.returned_date)))[0]?.return_signature_path;
      const [ackImg, retImg, vessel] = await Promise.all([
        ackPath ? kitSignatureDataUrl(ackPath) : null,
        retPath ? kitSignatureDataUrl(retPath) : null,
        fetchVesselIdentity(activeTenantId).catch(() => null),
      ]);
      await exportKitReceipt({
        crewName: selected?.fullName || 'Crew member', vesselName: vessel?.name, vessel,
        generatedAt: fmtKitDate(today()), items: list, ackSig: ackImg, returnSig: retImg,
        scopeLabel: scope === 'held' ? 'Currently held' : 'Full record',
      });
    } catch (e) { window.showToast?.('Couldn’t export — try again', 'error'); }
    finally { setExportingReceipt(false); }
  };

  // Issue a batch of allocations [{ invItem, size, qty }] to the selected crew
  // member: one kit row per size, drawing each size from master stock. For a
  // size-run item the specific size variant (and its stock-location tally) is
  // decremented; plain items fall back to the aggregate quantity.
  const doIssue = async (allocations) => {
    const issuerName = user?.user_metadata?.full_name || user?.email;
    for (const { invItem, size, qty } of allocations) {
      await saveKitItem({
        userId: selectedId, tenantId: activeTenantId, category: kitCategoryOf(invItem),
        item: invItem.name, size: size || null, quantity: qty,
        conditionIssued: 'New', issuedDate: today(),
        issuedBy: user?.id, issuedByName: issuerName,
        value: invItem.unitCost ?? null, inventoryItemId: invItem.id, createdBy: user?.id,
      });
      await logKitEvent({ userId: selectedId, tenantId: activeTenantId, action: 'issued', detail: { item: invItem.name, size: size || null, quantity: qty }, actorId: user?.id, actorName: issuerName });
    }

    // Decrement master stock, grouped by item so we write each item once.
    const byItem = new Map();
    for (const a of allocations) {
      const g = byItem.get(a.invItem.id) || { item: a.invItem, sizes: {}, total: 0 };
      if (a.size) g.sizes[a.size] = (g.sizes[a.size] || 0) + a.qty;
      g.total += a.qty;
      byItem.set(a.invItem.id, g);
    }
    for (const { item, sizes, total } of byItem.values()) {
      const vs = (item.variants || []).filter((v) => v && (v.size || v.label));
      if (vs.length) {
        const deltas = {};
        Object.entries(sizes).forEach(([s, qy]) => { deltas[s] = -qy; });
        await applyStockDelta(item, deltas);
      } else {
        await adjustItemQuantity(item.id, -Math.abs(total));
      }
    }
    setIssuing(false); load();
  };

  // Fulfil a size-swap the crew member requested from their profile: return the
  // wrong-size item to stock and issue the requested size in its place, keeping
  // master stock correct across both moves.
  const doSwap = async (k) => {
    const size = k.swap_requested_size;
    if (!size) return;
    const inv = itemById[k.inventory_item_id];
    const qty = Number(k.quantity) || 1;
    const issuerName = user?.user_metadata?.full_name || user?.email;
    await recordKitReturn([k.id], { returnedDate: today(), condition: 'Swapped for size', returnedTo: user?.id });
    await logKitEvent({ kitId: k.id, userId: k.user_id, tenantId: activeTenantId, action: 'returned', detail: { item: k.item, size: k.size || null, swappedTo: size }, actorId: user?.id, actorName: issuerName });
    await saveKitItem({
      userId: k.user_id, tenantId: activeTenantId, category: 'uniform',
      item: k.item, size, quantity: qty, conditionIssued: 'New', issuedDate: today(),
      issuedBy: user?.id, issuedByName: issuerName,
      value: inv?.unitCost ?? k.value ?? null, inventoryItemId: k.inventory_item_id || null, createdBy: user?.id,
    });
    await logKitEvent({ userId: k.user_id, tenantId: activeTenantId, action: 'issued', detail: { item: k.item, size, quantity: qty, swappedFrom: k.size || null }, actorId: user?.id, actorName: issuerName });
    if (inv) await applyStockDelta(inv, { ...(k.size ? { [k.size]: qty } : {}), [size]: -qty });
    await sendDbNotification(k.user_id, {
      type: 'kit_signoff', title: 'Uniform swapped',
      message: `Your ${k.item} has been swapped to ${size} — please confirm receipt.`,
      actionUrl: `/profile/${k.user_id}?tab=kit`, severity: 'info',
    });
    window.showToast?.(`Swapped ${k.item} to ${size}`, 'success');
    setSwapping(null); await load();
  };

  const doReturn = async (row, { restock, condition }) => {
    await recordKitReturn([row.id], { returnedDate: today(), condition, returnedTo: user?.id });
    if (restock && row.inventory_item_id) await adjustItemQuantity(row.inventory_item_id, Math.abs(row.quantity || 1));
    await logKitEvent({ kitId: row.id, userId: row.user_id, tenantId: activeTenantId, action: 'returned', detail: { item: row.item, restock }, actorId: user?.id, actorName: user?.user_metadata?.full_name });
    setReturning(null); load();
  };

  const doDelete = async (row) => {
    if (!window.confirm(`Remove “${row.item}”? ${row.inventory_item_id && row.status === 'in_service' ? 'The stock goes back into inventory.' : ''}`)) return;
    if (row.inventory_item_id && row.status === 'in_service') await adjustItemQuantity(row.inventory_item_id, Math.abs(row.quantity || 1));
    await deleteKitItem(row.id);
    load();
  };

  // Hand out a non-inventory item (PPE, a specific radio, a key fob…) — the same
  // sign-off loop as uniform, just entered by hand rather than drawn from stock.
  // Optionally register it into inventory first (0 on board — it's out with crew)
  // so it's stock-tracked and issuable from inventory next time.
  const doHandout = async (form) => {
    const issuerName = user?.user_metadata?.full_name || user?.email;
    const qty = Number(form.quantity) || 1;
    let inventoryItemId = null;
    if (Array.isArray(form.invFolder) && form.invFolder.length >= 2) {
      const [loc, ...sub] = form.invFolder;
      const created = await saveItem({
        name: form.item, location: loc, subLocation: sub.join(' > '),
        quantity: 0, totalQty: 0,
        unitCost: form.value ?? null,
      }, { dedupe: false }).catch(() => false);
      if (created && created.id) inventoryItemId = created.id;
      else window.showToast?.('Handed out — but couldn’t add it to inventory', 'error');
    }
    const saved = await saveKitItem({
      userId: selectedId, tenantId: activeTenantId, category: form.category || 'other',
      item: form.item, size: form.size || null, quantity: qty,
      serial: form.serial || null, conditionIssued: form.condition || 'New', issuedDate: form.issuedDate || today(),
      issuedBy: user?.id, issuedByName: issuerName, notes: form.notes || null,
      inventoryItemId, createdBy: user?.id,
    });
    await logKitEvent({ userId: selectedId, tenantId: activeTenantId, action: 'issued', detail: { item: form.item, size: form.size || null, quantity: qty, category: form.category, addedToInventory: !!inventoryItemId }, actorId: user?.id, actorName: issuerName });
    setHandingOut(false); setHandoutFolder([]);
    if (saved) window.showToast?.(`Handed out ${form.item} to ${selected?.fullName?.split(' ')[0] || 'crew'}${inventoryItemId ? ' · added to inventory' : ''}`, 'success');
    load();
  };

  // ── Roster (person tiles) ────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="cf-view">
        <div className="cf-bar"><button type="button" className="lm-back" onClick={onBack}><Icon name="ArrowLeft" size={16} /> Back to wardrobe management</button></div>
        <p className="editorial-meta">
          <span className="dot">●</span><span>Wardrobe</span>
          <span className="bar" /><span className="muted">Crew</span>
          <span className="bar" /><span className="muted">{kit.filter((k) => k.status === 'in_service').length} issued</span>
        </p>
        <h1 className="editorial-greeting">CREW<span className="period">,</span> <em>in uniform</em><span className="period">.</span></h1>
        <div className="cf-toolbar">
          <div className="cf-tsearch">
            <Icon name="Search" size={16} className="cf-search-ic" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={crewView === 'list' ? 'Search uniform…' : 'Search crew…'} />
          </div>
          <div className="cf-tools">
            <FilterMenu groups={filterGroups} />
            <SortMenu value={sort} onChange={setSort} options={sortOptions} />
            {crewView === 'list' && (
              <button type="button" className="cf-btn ghost sm" onClick={doExportList} disabled={exportingList || !listGroups.length}>
                <Icon name="Download" size={15} /> {exportingList ? 'Exporting…' : 'Export'}
              </button>
            )}
            <div className="cf-viewtoggle" role="tablist" aria-label="View">
              <button type="button" className={crewView === 'tiles' ? 'on' : ''} onClick={() => switchView('tiles')}>By crew</button>
              <button type="button" className={crewView === 'list' ? 'on' : ''} onClick={() => switchView('list')}>List</button>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="cf-loading">Loading the crew…</div>
        ) : crewView === 'tiles' ? (
          <PersonTiles people={tilePeople} emptyLabel="No crew match." onPick={(id) => setSelectedId(id)} />
        ) : (
          <div className="cf-list">
            {listGroups.length === 0 ? (
              <div className="cf-empty-note">No kit issued{dept !== 'all' ? ` in ${dept}` : ''} yet.</div>
            ) : listGroups.map((grp) => (
              <section className="cf-listgroup" key={grp.key}>
                <div className="cf-listgroup-h">
                  <span className="cf-listgroup-t"><span className="cf-listgroup-ic"><Icon name={grp.icon} size={12} /></span>{grp.title}</span>
                  <span className="cf-listgroup-ct">{grp.rows.length} {grp.rows.length === 1 ? 'line' : 'lines'} · {grp.units} item{grp.units === 1 ? '' : 's'}</span>
                </div>
                {grp.rows.map((r, i) => (
                  <div className="cf-lrow" key={i}>
                    <span className="cf-lrow-thumb">{r.img ? <img src={r.img} alt="" /> : <Icon name={grp.icon} size={16} />}</span>
                    <div className="cf-lrow-main">
                      <span className="cf-lrow-nm">{r.item}</span>
                      <span className="cf-lrow-sub">held by {r.holders} {r.holders === 1 ? 'crew member' : 'crew'}{showValue && r.value != null ? ` · ${money(r.value, 'USD')} each` : ''}</span>
                    </div>
                    <div className="cf-lrow-sizes">
                      {r.sizes.length > 1 ? (
                        <>
                          {r.sizes.map((s) => (
                            <span className="cf-lrow-szrow" key={s.size || '_'}><span className="cf-lrow-szlbl">{s.size || 'One size'}</span><span className="cf-lrow-szq">×{s.qty}</span></span>
                          ))}
                          <span className="cf-lrow-szrow tot"><span className="cf-lrow-szlbl">total</span><span className="cf-lrow-szq">×{r.total}</span></span>
                        </>
                      ) : (
                        <span className="cf-lrow-szrow solo">{r.sizes[0]?.size ? <span className="cf-lrow-szlbl">{r.sizes[0].size}</span> : null}<span className="cf-lrow-szq">×{r.total}</span></span>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── One crew member's issued uniform ─────────────────────────────────────
  // A kit tile — reads like an inventory item tile, but the number is what THIS
  // crew member holds (×qty issued), not master stock.
  const KitTile = (k) => {
    const st = kitStatus(k);
    const f = kitFacets[k.id] || {};
    const live = k.status === 'in_service';
    const meta = [k.condition_issued, k.issued_date ? fmtKitDate(k.issued_date) : null].filter(Boolean).join(' · ');
    return (
      <div className={`cf-tile${live ? '' : ' ret'}`} key={k.id}>
        <div className="cf-tile-media">
          {f.img ? <img src={f.img} alt={k.item} /> : <span className="cf-tile-ph"><Icon name={f.kind === 'equip' ? (CATEGORY_ICON[f.category] || 'Package') : typeIcon(f.type)} size={30} /></span>}
          <span className={`cf-tile-qty${live ? '' : ' ret'}`}><span className="x">×</span>{k.quantity || 1}</span>
          {canManage && live && (
            <button type="button" className="cf-tile-del" onClick={() => doDelete(k)} aria-label="Remove"><Icon name="Trash2" size={13} /></button>
          )}
        </div>
        <div className="cf-tile-body">
          <span className="cf-tile-nm">{k.item}</span>
          <div className="cf-tile-sub">
            {k.size && <span className="cf-tile-sz">{k.size}</span>}
            {meta && <span>{meta}</span>}
          </div>
          {k.swap_requested_size && <span className="cf-tile-swap"><Icon name="Repeat" size={11} /> Swap → {k.swap_requested_size}</span>}
          {k.notes && <span className="cf-tile-note">{k.notes}</span>}
          <div className="cf-tile-foot">
            <span className={`cf-pill ${st.cls}`}>{st.label}</span>
            {showValue && k.value != null && <span className="cf-tile-val">{money(k.value * (k.quantity || 1), 'USD')}</span>}
            {canManage && live && k.swap_requested_size && (
              <button type="button" className="cf-tile-swapbtn" onClick={() => setSwapping(k)}><Icon name="Repeat" size={12} /> Swap → {k.swap_requested_size}</button>
            )}
            {canManage && live && <button type="button" className="cf-tile-return" onClick={() => setReturning(k)}>Return</button>}
          </div>
        </div>
      </div>
    );
  };

  const noneMatch = memberKit.length > 0 && memberGroups.groups.length === 0 && memberGroups.retired.length === 0;

  return (
    <div className="cf-view">
      <div className="cf-bar">
        <button type="button" className="lm-back" onClick={() => setSelectedId(null)}><Icon name="ArrowLeft" size={16} /> Back to all crew</button>
        {canManage && (toSignoff.length > 0 || awaitingSignoff > 0) && (
          <div className="cf-bar-acts">
            {toSignoff.length > 0 ? (
              <button type="button" className="cf-btn ghost sm" onClick={doSignoff} disabled={signingOff}>
                <Icon name="PenLine" size={15} /> {signingOff ? 'Sending…' : `Send for sign-off (${toSignoff.length})`}
              </button>
            ) : (
              <span className="cf-await-chip"><Icon name="Clock" size={13} /> Awaiting sign-off · {awaitingSignoff} sent</span>
            )}
          </div>
        )}
      </div>

      <div className="cf-member-head">
        <span className="cf-avatar lg">{selected.photo ? <img src={selected.photo} alt="" /> : <span>{(selected.fullName || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>}</span>
        <div className="cf-member-who">
          <p className="editorial-meta cf-member-meta">
            <span className="dot">●</span><span>Wardrobe</span>
            {(selected.roleTitle || selected.department) && <><span className="bar" /><span className="muted">{[selected.roleTitle, selected.department].filter(Boolean).join(' · ')}</span></>}
            {memberAlloc.cabin && <><span className="bar" /><span className="muted">Cabin {memberAlloc.cabin}</span></>}
            {(memberAlloc.laundry_number || memberAlloc.laundry_colour) && <><span className="bar" /><span className="muted">Laundry {[memberAlloc.laundry_number, memberAlloc.laundry_colour].filter(Boolean).join(' · ')}</span></>}
            <span className="bar" /><span className="muted">{kitStats.issued} issued</span>
            {kitStats.returned > 0 && <><span className="bar" /><span className="muted">{kitStats.returned} returned</span></>}
          </p>
          <h2 className="cf-member-nm">{selected.fullName}</h2>
        </div>
      </div>

      {memberKit.length === 0 ? (
        <div className="cf-empty">
          <Icon name="Shirt" size={26} />
          <p>No uniform issued yet.</p>
          {canManage && <button type="button" className="cf-btn primary" onClick={openIssue}><Icon name="Plus" size={15} /> Issue from inventory</button>}
        </div>
      ) : (
        <>
          <div className="cf-toolbar">
            <div className="cf-tsearch">
              <Icon name="Search" size={16} className="cf-search-ic" />
              <input value={kq} onChange={(e) => setKq(e.target.value)} placeholder="Search this kit…" />
            </div>
            <div className="cf-tools">
              <FilterMenu groups={kitFilterGroups} />
              <SortMenu value={kSort} onChange={setKSort} options={kitSortOptions} />
              <button type="button" className="cf-btn ghost sm" onClick={() => setReceiptChooser(true)} disabled={exportingReceipt}>
                <Icon name="Download" size={15} /> {exportingReceipt ? 'Exporting…' : 'Kit record'}
              </button>
              {canManage && <button type="button" className="cf-btn primary sm" onClick={openIssue}><Icon name="Plus" size={15} /> Issue item</button>}
            </div>
          </div>

          {noneMatch ? (
            <div className="cf-empty-note">No kit matches these filters.</div>
          ) : (
            <>
              {memberGroups.groups.map((grp) => {
                const units = grp.rows.reduce((a, k) => a + (Number(k.quantity) || 1), 0);
                return (
                  <section className="cf-cat" key={grp.key}>
                    <div className="cf-cat-h">
                      <span className="cf-cat-t"><span className="cf-cat-ic"><Icon name={grp.icon} size={14} /></span>{grp.title}</span>
                      <span className="cf-cat-ct">{grp.rows.length} {grp.rows.length === 1 ? 'line' : 'lines'} · {units} item{units === 1 ? '' : 's'}</span>
                      <span className="cf-cat-rule" />
                    </div>
                    <div className="cf-tilegrid">{grp.rows.map(KitTile)}</div>
                  </section>
                );
              })}
              {memberGroups.retired.length > 0 && (
                <section className="cf-cat">
                  <div className="cf-cat-h">
                    <span className="cf-cat-t"><span className="cf-cat-ic muted"><Icon name="Undo2" size={14} /></span>Returned / retired</span>
                    <span className="cf-cat-ct">{memberGroups.retired.length} item{memberGroups.retired.length === 1 ? '' : 's'}</span>
                    <span className="cf-cat-rule" />
                  </div>
                  <div className="cf-tilegrid">{memberGroups.retired.map(KitTile)}</div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {receiptChooser && (
        <div className="cf-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setReceiptChooser(false); }}>
          <div className="cf-modal sm" onClick={(e) => e.stopPropagation()}>
            <div className="cf-modal-head">
              <div><span className="cf-eyebrow">Kit record</span><h2 className="cf-modal-title">{selected.fullName}</h2></div>
              <button type="button" className="cf-x" onClick={() => setReceiptChooser(false)} aria-label="Close"><Icon name="X" size={18} /></button>
            </div>
            <div className="cf-scope">
              <button type="button" className="cf-scope-opt" onClick={() => doExportReceipt('held')} disabled={exportingReceipt}>
                <Icon name="ShieldCheck" size={18} />
                <span><b>Currently held</b><small>Only kit in service now — the responsibility record to sign.</small></span>
              </button>
              <button type="button" className="cf-scope-opt" onClick={() => doExportReceipt('all')} disabled={exportingReceipt}>
                <Icon name="History" size={18} />
                <span><b>Full record</b><small>Everything issued, incl. returned &amp; lost items.</small></span>
              </button>
            </div>
          </div>
        </div>
      )}
      {issuing && <IssueModal crewName={selected.fullName} stock={stock} folderRels={folderRels} showValue={showValue} onIssue={doIssue} onAddManual={(trail) => { setIssuing(false); setHandoutFolder(trail || []); setHandingOut(true); }} onClose={() => setIssuing(false)} />}
      {handingOut && <HandoutModal crewName={selected.fullName} folderRels={folderRels} defaultFolder={handoutFolder} onHandout={doHandout} onClose={() => { setHandingOut(false); setHandoutFolder([]); }} />}
      {returning && <ReturnModal row={returning} onReturn={doReturn} onClose={() => setReturning(null)} />}
      {swapping && <SwapModal row={swapping} inv={itemById[swapping.inventory_item_id]} crewName={selected.fullName} onSwap={doSwap} onClose={() => setSwapping(null)} />}
    </div>
  );
};

export default CrewFolder;
