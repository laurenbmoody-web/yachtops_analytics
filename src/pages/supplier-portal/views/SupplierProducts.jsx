import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X, UploadCloud, ImagePlus, Download } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { usePermission } from '../../../contexts/SupplierPermissionContext';
import {
  fetchCatalogueItems,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
  bulkUpdateCatalogueItems,
  bulkDeleteCatalogueItems,
  uploadCatalogueImage,
  fetchCatalogueCosts,
  upsertCatalogueCost,
  fetchCommittedQuantities,
} from '../utils/supplierStorage';
import { STANDARD_CATEGORIES, categoryHue, orderCategories } from '../../../utils/catalogueConstants';
import { UNIT_GROUPS, UNIT_GROUP_VALUES, normalizeUnit } from '../../../data/unitGroups';
import EmptyState from '../components/EmptyState';
import CatalogueImportModal from '../components/CatalogueImportModal';
import ConfirmDialog from '../components/ConfirmDialog';
import '../components/product-modal.css';
import './supplier-products.css';

const NO_PERMISSION_TITLE = "Your role doesn't have permission for this action.";
const DEFAULT_LOW_STOCK_AT = 10;

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', category: '', unit: 'each',
  pack_size: '', pack_unit: '', unit_size: '',
  unit_price: '', currency: 'EUR', stock_qty: '', description: '', in_stock: true,
  reorder_point: '', lead_time_days: '', min_order_qty: '',
};

const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const fmtPack = (item) => {
  if (!item.pack_size && !item.unit_size) return '—';
  const inner = [item.pack_size, normalizeUnit(item.pack_unit)].filter(Boolean).join(' × ');
  return [inner || null, item.unit_size].filter(Boolean).join(' · ');
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const marginPct = (price, cost) => {
  if (price == null || cost == null || Number(price) <= 0) return null;
  return ((Number(price) - Number(cost)) / Number(price)) * 100;
};

const lowStockAt = (item) => item.reorder_point ?? DEFAULT_LOW_STOCK_AT;
const isLowStock = (item) =>
  !item.in_stock || (item.stock_qty != null && Number(item.stock_qty) <= lowStockAt(item));

const Thumb = ({ item }) => {
  if (item.image_url) return <img className="spp-thumb" src={item.image_url} alt="" loading="lazy" />;
  return (
    <span className="spp-thumb-ph" style={{ background: categoryHue(item.category) }}>
      {(item.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
};

// Click-to-edit numeric cell (Katana pattern): click → input, Enter/blur saves, Esc cancels.
const InlineNumber = ({ value, suffix, canEdit, onSave, placeholder = '—', decimals = 2 }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = async () => {
    const next = numOrNull(draft);
    setEditing(false);
    if (next === (value ?? null)) return;
    setSaving(true);
    try { await onSave(next); } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="spp-cell-input"
        type="number" step="0.01" min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      className={`spp-cell-view ${canEdit ? '' : 'ro'} ${saving ? 'spp-cell-saving' : ''}`}
      title={canEdit ? 'Click to edit' : undefined}
      onClick={() => { if (canEdit && !saving) { setDraft(value ?? ''); setEditing(true); } }}
    >
      {value != null ? `${Number(value).toFixed(decimals)}${suffix ? ` ${suffix}` : ''}` : placeholder}
    </span>
  );
};

const ProductModal = ({ initial, initialCost, categorySuggestions, onSave, onClose, saving }) => {
  const [form, setForm] = useState(() => {
    if (!initial) return EMPTY_FORM;
    const merged = { ...EMPTY_FORM };
    Object.keys(EMPTY_FORM).forEach(k => {
      if (initial[k] != null) merged[k] = initial[k];
    });
    return merged;
  });
  const [costPrice, setCostPrice] = useState(initialCost ?? '');
  const [photo, setPhoto] = useState(null);
  const photoInput = useRef(null);
  const nameRef = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const previewUrl = useMemo(
    () => (photo ? URL.createObjectURL(photo) : initial?.image_url || null),
    [photo, initial?.image_url]
  );

  const liveMargin = marginPct(numOrNull(form.unit_price), numOrNull(costPrice));
  const marginClass = liveMargin == null ? '' : liveMargin < 0 ? 'neg' : liveMargin < 15 ? 'thin' : 'ok';

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      category: form.category.trim() || null,
      unit: normalizeUnit(form.unit.trim()) || 'each',
      pack_unit: form.pack_unit.trim() ? normalizeUnit(form.pack_unit.trim()) : null,
      unit_size: form.unit_size.trim() || null,
      description: form.description.trim() || null,
      unit_price: numOrNull(form.unit_price),
      pack_size: numOrNull(form.pack_size),
      stock_qty: numOrNull(form.stock_qty),
      reorder_point: numOrNull(form.reorder_point),
      lead_time_days: intOrNull(form.lead_time_days),
      min_order_qty: numOrNull(form.min_order_qty),
    }, photo, numOrNull(costPrice));
  };

  return (
    <div className="spm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spm-panel" role="dialog" aria-label={initial ? 'Edit product' : 'New product'}>
        <div className="spm-head">
          <div>
            <div className="spm-eyebrow">Catalogue</div>
            <h4 className="spm-title">{initial ? <>Edit <em>{initial.name}</em></> : 'New product'}</h4>
          </div>
          <button type="button" className="spm-close" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          <div className="spm-body">
            <div className="spm-section">
              <div className="spm-photo">
                {previewUrl
                  ? <img className="spm-photo-preview" src={previewUrl} alt="" />
                  : <span className="spm-photo-preview"><ImagePlus size={22} /></span>}
                <div>
                  <button type="button" className="spm-photo-btn" onClick={() => photoInput.current?.click()}>
                    {previewUrl ? 'Change photo' : 'Add photo'}
                  </button>
                  <div className="spm-photo-hint">JPG, PNG or WebP · 5MB max</div>
                  <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                </div>
              </div>
            </div>

            <div className="spm-section">
              <p className="spm-section-label">The product<span className="req">name required</span></p>
              <div className="spm-grid c2">
                <div className="spm-field">
                  <label>Name</label>
                  <input ref={nameRef} required className="spm-input" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="spm-field">
                  <label>Category <small>— pick or type your own</small></label>
                  <input
                    className="spm-input"
                    list="spp-category-suggestions"
                    value={form.category}
                    onChange={e => set('category', e.target.value)}
                    placeholder="e.g. Engineering & Spares"
                  />
                  <datalist id="spp-category-suggestions">
                    {categorySuggestions.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="spm-field">
                  <label>SKU <small>— your own code</small></label>
                  <input className="spm-input" value={form.sku} onChange={e => set('sku', e.target.value)} />
                </div>
                <div className="spm-field">
                  <label>Barcode <small>(EAN/GTIN)</small></label>
                  <input className="spm-input" value={form.barcode} onChange={e => set('barcode', e.target.value)}
                    placeholder="e.g. 8002270014901" inputMode="numeric" />
                </div>
              </div>
            </div>

            <div className="spm-section">
              <p className="spm-section-label">Pricing<span className="opt">cost is private — never shown to yachts</span></p>
              <div className="spm-grid c3">
                <div className="spm-field">
                  <label>Sell unit</label>
                  <select className="spm-input" value={UNIT_GROUP_VALUES.has(normalizeUnit(form.unit)) ? normalizeUnit(form.unit) : (form.unit || 'each')} onChange={e => set('unit', e.target.value)}>
                    {form.unit && !UNIT_GROUP_VALUES.has(normalizeUnit(form.unit)) && <option value={form.unit}>{form.unit}</option>}
                    {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
                  </select>
                </div>
                <div className="spm-field">
                  <label>Unit price <small>— what yachts pay</small></label>
                  <div className="spm-row">
                    <input type="number" step="0.01" min="0" className="spm-input num" value={form.unit_price} onChange={e => set('unit_price', e.target.value)} />
                    <select className="spm-select ccy" value={form.currency} onChange={e => set('currency', e.target.value)}>
                      {['EUR', 'USD', 'GBP', 'CHF'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="spm-field">
                  <label>Your cost</label>
                  <div className="spm-row">
                    <input type="number" step="0.01" min="0" className="spm-input num" value={costPrice} onChange={e => setCostPrice(e.target.value)} />
                    <span className={`spm-margin-pill ${marginClass}`}>
                      {liveMargin == null ? '— margin' : `${liveMargin.toFixed(1)}%`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="spm-section">
              <p className="spm-section-label">Pack — inside one sell unit<span className="opt">optional</span></p>
              <div className="spm-grid c3">
                <div className="spm-field">
                  <label>Quantity</label>
                  <input type="number" step="1" min="0" className="spm-input num" placeholder="24" value={form.pack_size}
                    onChange={e => set('pack_size', e.target.value)} />
                </div>
                <div className="spm-field">
                  <label>Inner unit</label>
                  <select className="spm-input" value={form.pack_unit && UNIT_GROUP_VALUES.has(normalizeUnit(form.pack_unit)) ? normalizeUnit(form.pack_unit) : (form.pack_unit || '')}
                    onChange={e => set('pack_unit', e.target.value)}>
                    <option value="">—</option>
                    {form.pack_unit && !UNIT_GROUP_VALUES.has(normalizeUnit(form.pack_unit)) && <option value={form.pack_unit}>{form.pack_unit}</option>}
                    {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
                  </select>
                </div>
                <div className="spm-field">
                  <label>Size each</label>
                  <input className="spm-input" placeholder="330ml" value={form.unit_size}
                    onChange={e => set('unit_size', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="spm-section">
              <p className="spm-section-label">Stock &amp; ordering</p>
              <div className="spm-grid c4">
                <div className="spm-field">
                  <label>Stock qty</label>
                  <input type="number" step="1" min="0" className="spm-input num" value={form.stock_qty} onChange={e => set('stock_qty', e.target.value)}
                    placeholder="untracked" />
                </div>
                <div className="spm-field">
                  <label>Reorder at</label>
                  <input type="number" step="1" min="0" className="spm-input num" value={form.reorder_point} onChange={e => set('reorder_point', e.target.value)}
                    placeholder={String(DEFAULT_LOW_STOCK_AT)} />
                </div>
                <div className="spm-field">
                  <label>Lead time <small>(days)</small></label>
                  <input type="number" step="1" min="0" className="spm-input num" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)}
                    placeholder="0" />
                </div>
                <div className="spm-field">
                  <label>Min order</label>
                  <input type="number" step="1" min="0" className="spm-input num" value={form.min_order_qty} onChange={e => set('min_order_qty', e.target.value)}
                    placeholder="1" />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label className="spm-toggle">
                  <input type="checkbox" checked={form.in_stock} onChange={e => set('in_stock', e.target.checked)} />
                  <span className="track" />
                  Available to order
                </label>
              </div>
            </div>

            <div className="spm-section">
              <p className="spm-section-label">Notes<span className="opt">shown to yachts</span></p>
              <textarea rows={2} className="spm-textarea" placeholder="Origin, grade, delivery notes…"
                value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
          </div>

          <div className="spm-foot">
            <button type="button" className="spm-btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="spm-btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// CSV export of the current (filtered) view — costs included: this file
// is for the supplier's own records.
const exportCsv = (rows, costs) => {
  const cols = ['name', 'sku', 'barcode', 'category', 'unit', 'pack_size', 'pack_unit', 'unit_size',
    'unit_price', 'currency', 'cost_price', 'margin_pct', 'stock_qty', 'reorder_point',
    'lead_time_days', 'min_order_qty', 'in_stock', 'updated_at'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  rows.forEach(r => {
    const cost = costs[r.id];
    const m = marginPct(r.unit_price, cost);
    lines.push(cols.map(c => {
      if (c === 'cost_price') return esc(cost);
      if (c === 'margin_pct') return esc(m != null ? m.toFixed(1) : '');
      return esc(r[c]);
    }).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `catalogue-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

const SupplierProducts = () => {
  const { supplier } = useSupplier();
  const { allowed: canEdit } = usePermission('catalogue:edit');
  const [items, setItems] = useState([]);
  const [costs, setCosts] = useState({});
  const [committed, setCommitted] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { title, body, label, action }

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    Promise.all([
      fetchCatalogueItems(supplier.id),
      fetchCatalogueCosts(supplier.id).catch(() => ({})),
      fetchCommittedQuantities(supplier.id),
    ])
      .then(([rows, costMap, committedMap]) => {
        setItems(rows);
        setCosts(costMap);
        setCommitted(committedMap);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id]);

  const patchLocal = (updated) => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));

  const handleSave = async (formData, photo, costPrice) => {
    setSaving(true);
    try {
      let row;
      if (modal === 'new') {
        row = await createCatalogueItem(supplier.id, formData);
        setItems(prev => [row, ...prev]);
      } else {
        row = await updateCatalogueItem(modal.id, formData);
        patchLocal(row);
      }
      if (photo) {
        try {
          const withPhoto = await uploadCatalogueImage(supplier.id, row.id, photo);
          patchLocal(withPhoto);
        } catch (e) {
          setError(`Product saved, but the photo upload failed: ${e.message}`);
        }
      }
      const prevCost = modal === 'new' ? null : (costs[modal.id] ?? null);
      if (costPrice !== prevCost) {
        try {
          await upsertCatalogueCost(supplier.id, row.id, costPrice, formData.currency);
          setCosts(prev => ({ ...prev, [row.id]: costPrice }));
        } catch (e) {
          setError(`Product saved, but the cost price didn't save: ${e.message}`);
        }
      }
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item) => setConfirm({
    title: 'Delete this product?',
    body: `“${item.name}” will be removed from your catalogue and the marketplace. Past orders keep their history.`,
    label: 'Delete product',
    action: async () => {
      await deleteCatalogueItem(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      setSelected(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    },
  });

  const handleInlineSave = (item, patch) => async (value) => {
    try {
      const updated = await updateCatalogueItem(item.id, patch(value));
      patchLocal(updated);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleInlineCostSave = (item) => async (value) => {
    try {
      await upsertCatalogueCost(supplier.id, item.id, value, item.currency);
      setCosts(prev => ({ ...prev, [item.id]: value }));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleImported = (created) => {
    setItems(prev => [...created, ...prev]);
    setImportOpen(false);
  };

  // ── filtering ──
  const q = search.toLowerCase();
  const searched = useMemo(() => items.filter(i =>
    !q
    || i.name.toLowerCase().includes(q)
    || (i.sku ?? '').toLowerCase().includes(q)
    || (i.barcode ?? '').includes(q)
  ), [items, q]);

  const counts = useMemo(() => {
    const byCat = {};
    let low = 0;
    for (const i of searched) {
      byCat[i.category || 'Other'] = (byCat[i.category || 'Other'] || 0) + 1;
      if (isLowStock(i)) low++;
    }
    return { byCat, low };
  }, [searched]);

  const matchesStatus = (i) => {
    switch (statusFilter) {
      case 'attention': return isLowStock(i);
      case 'in': return i.in_stock && !isLowStock(i);
      case 'low': return i.in_stock && i.stock_qty != null && Number(i.stock_qty) <= lowStockAt(i);
      case 'out': return !i.in_stock || (i.stock_qty != null && Number(i.stock_qty) <= 0);
      case 'no_photo': return !i.image_url;
      case 'no_cost': return costs[i.id] == null;
      case 'no_barcode': return !i.barcode;
      default: return true;
    }
  };

  const filtered = useMemo(() => {
    const rows = searched.filter(i =>
      (categoryFilter === 'All' || (i.category || 'Other') === categoryFilter) && matchesStatus(i)
    );
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      price_desc: (a, b) => (b.unit_price ?? -1) - (a.unit_price ?? -1),
      price_asc: (a, b) => (a.unit_price ?? Infinity) - (b.unit_price ?? Infinity),
      margin_desc: (a, b) => (marginPct(b.unit_price, costs[b.id]) ?? -999) - (marginPct(a.unit_price, costs[a.id]) ?? -999),
      margin_asc: (a, b) => (marginPct(a.unit_price, costs[a.id]) ?? 999) - (marginPct(b.unit_price, costs[b.id]) ?? 999),
      stock_asc: (a, b) => (a.stock_qty ?? Infinity) - (b.stock_qty ?? Infinity),
      value_desc: (a, b) =>
        ((b.stock_qty ?? 0) * (costs[b.id] ?? 0)) - ((a.stock_qty ?? 0) * (costs[a.id] ?? 0)),
      updated_desc: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
    }[sortBy] || ((a, b) => a.name.localeCompare(b.name));
    return [...rows].sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, categoryFilter, statusFilter, sortBy, costs]);

  // ── KPI band: valuation + health from the operational data ──
  const kpis = useMemo(() => {
    let stockValue = 0, retailValue = 0, marginSum = 0, marginN = 0, thin = 0;
    let photos = 0, costed = 0, coded = 0, out = 0, lowOnly = 0;
    for (const i of items) {
      const cost = costs[i.id];
      const qty = i.stock_qty != null ? Number(i.stock_qty) : null;
      if (qty != null && cost != null) stockValue += qty * Number(cost);
      if (qty != null && i.unit_price != null) retailValue += qty * Number(i.unit_price);
      const m = marginPct(i.unit_price, cost);
      if (m != null) { marginSum += m; marginN++; if (m < 15) thin++; }
      if (i.image_url) photos++;
      if (cost != null) costed++;
      if (i.barcode) coded++;
      const isOut = !i.in_stock || (qty != null && qty <= 0);
      if (isOut) out++;
      else if (qty != null && qty <= lowStockAt(i)) lowOnly++;
    }
    const n = items.length || 1;
    return {
      stockValue, retailValue,
      uplift: stockValue > 0 ? (retailValue / stockValue - 1) * 100 : null,
      blendedMargin: marginN ? marginSum / marginN : null,
      thin,
      healthPct: Math.round(((photos / n) + (costed / n) + (coded / n)) / 3 * 100),
      photos, costed, coded,
      out, lowOnly,
    };
  }, [items, costs]);

  // ── bulk selection ──
  const allVisibleSelected = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev);
    if (allVisibleSelected) filtered.forEach(i => n.delete(i.id));
    else filtered.forEach(i => n.add(i.id));
    return n;
  });
  const toggleOne = (id) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const runBulk = async (fn) => {
    setBulkBusy(true);
    setError(null);
    try { await fn(Array.from(selected)); }
    catch (e) { setError(e.message); }
    finally { setBulkBusy(false); }
  };

  const bulkCategory = (cat) => runBulk(async (ids) => {
    const updated = await bulkUpdateCatalogueItems(ids, { category: cat });
    setItems(prev => prev.map(i => updated.find(u => u.id === i.id) ?? i));
    setSelected(new Set());
  });
  const bulkStock = (inStock) => runBulk(async (ids) => {
    const updated = await bulkUpdateCatalogueItems(ids, { in_stock: inStock, ...(inStock ? {} : { stock_qty: 0 }) });
    setItems(prev => prev.map(i => updated.find(u => u.id === i.id) ?? i));
    setSelected(new Set());
  });
  const bulkDelete = () => setConfirm({
    title: `Delete ${selected.size} product${selected.size === 1 ? '' : 's'}?`,
    body: 'They will be removed from your catalogue and the marketplace. This can’t be undone — past orders keep their history.',
    label: `Delete ${selected.size}`,
    action: () => runBulk(async (ids) => {
      await bulkDeleteCatalogueItems(ids);
      setItems(prev => prev.filter(i => !selected.has(i.id)));
      setSelected(new Set());
    }),
  });

  const dataCategories = orderCategories(Object.keys(counts.byCat));
  const categorySuggestions = orderCategories(Array.from(new Set([
    ...STANDARD_CATEGORIES,
    ...items.map(i => i.category).filter(Boolean),
  ])));
  const bulkCategoryOptions = categorySuggestions;
  const homeCurrency = items[0]?.currency || 'EUR';

  return (
    <div className="sp-page">
      {modal && (
        <ProductModal
          initial={modal === 'new' ? null : modal}
          initialCost={modal === 'new' ? null : (costs[modal.id] ?? null)}
          categorySuggestions={categorySuggestions}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}

      {importOpen && (
        <CatalogueImportModal
          supplierId={supplier.id}
          existingItems={items}
          onImported={handleImported}
          onClose={() => setImportOpen(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.label}
          busy={bulkBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try { await confirm.action(); }
            catch (e) { setError(e.message); }
            finally { setConfirm(null); }
          }}
        />
      )}

      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{items.length} products</div>
          <h1 className="sp-page-title">Your <em>catalogue</em></h1>
          <p className="sp-page-sub">Manage what you offer. Prices and stock visible to yacht clients — costs and margins are yours alone.</p>
        </div>
        <div className="sp-actions">
          <button
            className="sp-pill"
            onClick={() => exportCsv(filtered, costs)}
            disabled={!items.length}
            title="Export the current view as CSV (includes your costs — for your records)"
          ><Download size={13} />Export</button>
          <button
            className="sp-pill"
            onClick={() => setImportOpen(true)}
            disabled={!canEdit}
            title={canEdit ? 'Import a price list (CSV, Excel, PDF or photo)' : NO_PERMISSION_TITLE}
            style={{ opacity: canEdit ? 1 : 0.5 }}
          ><UploadCloud size={13} />Import price list</button>
          <button
            className="sp-pill primary"
            onClick={() => setModal('new')}
            disabled={!canEdit}
            title={canEdit ? undefined : NO_PERMISSION_TITLE}
            style={{ opacity: canEdit ? 1 : 0.5 }}
          ><Plus size={13} />New product</button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {items.length > 0 && (
        <div className="spp-kpiband">
          <div
            className="spp-kpicell click"
            role="button" tabIndex={0}
            title="See where your stock value sits — sorts by value at cost"
            onClick={() => { setStatusFilter('all'); setSortBy('value_desc'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setStatusFilter('all'); setSortBy('value_desc'); } }}
          >
            <div className="spp-kpi-label">Stock on hand · at cost</div>
            <div className="spp-kpi-value">
              {kpis.stockValue ? <>{kpis.stockValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })} <small>{homeCurrency}</small></> : '—'}
            </div>
            <div className="spp-kpi-sub">
              retail <b>{kpis.retailValue ? kpis.retailValue.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '—'}</b>
              {kpis.uplift != null && <span className="up"> · +{kpis.uplift.toFixed(0)}% uplift</span>}
            </div>
            <div className="spp-kpi-meter">
              <i className="orange" style={{ width: `${kpis.retailValue > 0 ? Math.min(100, (kpis.stockValue / kpis.retailValue) * 100) : 0}%` }} />
            </div>
          </div>

          <div
            className="spp-kpicell click"
            role="button" tabIndex={0}
            title="Review your thinnest margins first"
            onClick={() => { setStatusFilter('all'); setSortBy('margin_asc'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setStatusFilter('all'); setSortBy('margin_asc'); } }}
          >
            <div className="spp-kpi-label">Blended margin</div>
            <div className="spp-kpi-value">
              {kpis.blendedMargin != null ? <>{kpis.blendedMargin.toFixed(1)}<small>%</small></> : '—'}
            </div>
            <div className="spp-kpi-sub">
              {kpis.thin
                ? <span className="warn">{kpis.thin} product{kpis.thin === 1 ? '' : 's'} under 15%</span>
                : <span className="up">nothing under 15%</span>}
            </div>
            <div className="spp-kpi-meter">
              <i className={kpis.blendedMargin != null && kpis.blendedMargin < 15 ? 'amber' : 'green'}
                style={{ width: `${Math.min(100, Math.max(0, (kpis.blendedMargin ?? 0) / 60 * 100))}%` }} />
            </div>
          </div>

          <div
            className="spp-kpicell click"
            role="button" tabIndex={0}
            title="Work through the biggest gap in your catalogue data"
            onClick={() => {
              const weakest = Math.min(kpis.photos, kpis.costed, kpis.coded);
              setStatusFilter(weakest === kpis.photos ? 'no_photo' : weakest === kpis.costed ? 'no_cost' : 'no_barcode');
              setSortBy('name');
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const weakest = Math.min(kpis.photos, kpis.costed, kpis.coded);
              setStatusFilter(weakest === kpis.photos ? 'no_photo' : weakest === kpis.costed ? 'no_cost' : 'no_barcode');
              setSortBy('name');
            }}
          >
            <div className="spp-kpi-label">Catalogue health</div>
            <div className="spp-kpi-value">{kpis.healthPct}<small>%</small></div>
            <div className="spp-kpi-sub">
              <b>{kpis.photos}</b> photos · <b>{kpis.costed}</b> costs · <b>{kpis.coded}</b> barcodes
            </div>
            <div className="spp-kpi-meter">
              <i className={kpis.healthPct >= 75 ? 'green' : 'amber'} style={{ width: `${kpis.healthPct}%` }} />
            </div>
          </div>

          <div
            className="spp-kpicell click"
            role="button" tabIndex={0}
            title="See everything low or out, emptiest first"
            onClick={() => { setStatusFilter('attention'); setSortBy('stock_asc'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setStatusFilter('attention'); setSortBy('stock_asc'); } }}
          >
            <div className="spp-kpi-label">Needs attention</div>
            <div className="spp-kpi-value">{kpis.out + kpis.lowOnly || '0'}</div>
            <div className="spp-kpi-sub">
              {kpis.out + kpis.lowOnly
                ? <><span className="bad">{kpis.out} out</span> · <span className="warn">{kpis.lowOnly} low</span></>
                : <span className="up">everything stocked</span>}
            </div>
            <div className="spp-kpi-meter">
              <i className={kpis.out ? 'red' : kpis.lowOnly ? 'amber' : 'green'}
                style={{ width: `${Math.min(100, ((kpis.out + kpis.lowOnly) / (items.length || 1)) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="spp-controls">
        <input
          className="spp-search"
          placeholder="Search name, SKU or barcode…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label className="spp-filter">
          <span className="k">Category</span>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="All">All ({searched.length})</option>
            {dataCategories.map(c => <option key={c} value={c}>{c} ({counts.byCat[c]})</option>)}
          </select>
        </label>
        <label className="spp-filter">
          <span className="k">Show</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">Everything</option>
            <option value="attention">Needs attention</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="no_photo">Missing photo</option>
            <option value="no_cost">Missing cost</option>
            <option value="no_barcode">Missing barcode</option>
          </select>
        </label>
        <label className="spp-filter">
          <span className="k">Sort</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="name">Name A–Z</option>
            <option value="price_desc">Price · high first</option>
            <option value="price_asc">Price · low first</option>
            <option value="margin_desc">Margin · high first</option>
            <option value="margin_asc">Margin · low first</option>
            <option value="stock_asc">Stock · low first</option>
            <option value="value_desc">Stock value · high first</option>
            <option value="updated_desc">Recently updated</option>
          </select>
        </label>
        {(search || categoryFilter !== 'All' || statusFilter !== 'all' || sortBy !== 'name') && (
          <button
            type="button"
            className="spp-clear"
            onClick={() => { setSearch(''); setCategoryFilter('All'); setStatusFilter('all'); setSortBy('name'); }}
          >
            × Clear all
          </button>
        )}
        <span className="spp-controls-count">{filtered.length} of {items.length}</span>
      </div>

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon="📦"
          title={items.length === 0 ? 'No products yet' : 'No results'}
          body={items.length === 0 ? 'Add products one by one, or import the price list you already have.' : 'Try a different search or filter.'}
          action={items.length === 0 && canEdit && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="sp-pill" onClick={() => setImportOpen(true)}><UploadCloud size={13} />Import price list</button>
              <button className="sp-pill primary" onClick={() => setModal('new')}><Plus size={13} />Add product</button>
            </div>
          )}
        />
      )}

      {filtered.length > 0 && (
        <div className="sp-table-wrap spp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                {canEdit && (
                  <th style={{ width: 34 }}>
                    <input type="checkbox" className="spp-check" checked={allVisibleSelected} onChange={toggleAll} />
                  </th>
                )}
                <th>Product</th>
                <th>Category</th>
                <th>Pack</th>
                <th className="num">Price</th>
                <th className="num">Margin</th>
                <th className="num">Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const cost = costs[item.id];
                const m = marginPct(item.unit_price, cost);
                const committedQty = committed[item.id] || 0;
                const available = item.stock_qty != null ? Number(item.stock_qty) - committedQty : null;
                const leadBits = [
                  item.lead_time_days ? `${item.lead_time_days}d lead` : null,
                  item.min_order_qty && Number(item.min_order_qty) > 1 ? `min ${Number(item.min_order_qty)}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <tr key={item.id}>
                    {canEdit && (
                      <td>
                        <input type="checkbox" className="spp-check" checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} />
                      </td>
                    )}
                    <td>
                      <div className="spp-prodcell">
                        <Thumb item={item} />
                        <div>
                          <div className="sp-line-name">{item.name}</div>
                          <div className="sp-line-sku">
                            {[item.sku, item.barcode ? `EAN ${item.barcode}` : null, leadBits || null].filter(Boolean).join(' · ') || `${item.unit || 'each'}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--muted-s)' }}>{item.category ?? '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--muted-s)', whiteSpace: 'nowrap' }}>{fmtPack(item)}</td>
                    <td className="sp-amount" style={{ textAlign: 'right' }}>
                      <InlineNumber
                        value={item.unit_price}
                        suffix={item.currency}
                        canEdit={canEdit}
                        onSave={handleInlineSave(item, (v) => ({ unit_price: v }))}
                      />
                      {item.updated_at && <div className="spp-updated">upd {fmtDate(item.updated_at)}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`spp-margin ${m == null ? '' : m < 0 ? 'neg' : m < 15 ? 'thin' : 'ok'}`}>
                        {m != null ? `${m.toFixed(1)}%` : '—'}
                      </span>
                      <div className="spp-updated">
                        cost{' '}
                        <InlineNumber
                          value={cost ?? null}
                          canEdit={canEdit}
                          onSave={handleInlineCostSave(item)}
                          placeholder="set"
                        />
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <InlineNumber
                        value={item.stock_qty}
                        canEdit={canEdit}
                        decimals={0}
                        placeholder={item.in_stock ? 'In stock' : 'Out'}
                        onSave={handleInlineSave(item, (v) => ({ stock_qty: v, in_stock: v == null ? item.in_stock : v > 0 }))}
                      />
                      {committedQty > 0 && (
                        <div className="spp-updated">{committedQty} committed · {available} avail</div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="sp-icon-btn"
                          style={{ width: 28, height: 28, opacity: canEdit ? 1 : 0.4 }}
                          disabled={!canEdit}
                          title={canEdit ? undefined : NO_PERMISSION_TITLE}
                          onClick={() => setModal(item)}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="sp-icon-btn"
                          style={{ width: 28, height: 28, color: 'var(--red)', opacity: canEdit ? 1 : 0.4 }}
                          disabled={!canEdit}
                          title={canEdit ? undefined : NO_PERMISSION_TITLE}
                          onClick={() => handleDelete(item)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && selected.size > 0 && (
        <div className="spp-bulkbar">
          <span className="count">{selected.size} selected</span>
          <select
            className="spp-bulk-select"
            value=""
            disabled={bulkBusy}
            onChange={(e) => { if (e.target.value) bulkCategory(e.target.value); }}
          >
            <option value="">Move to category…</option>
            {bulkCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="spp-bulk-btn" disabled={bulkBusy} onClick={() => bulkStock(true)}>Mark in stock</button>
          <button className="spp-bulk-btn" disabled={bulkBusy} onClick={() => bulkStock(false)}>Mark out of stock</button>
          <button className="spp-bulk-btn danger" disabled={bulkBusy} onClick={bulkDelete}>Delete</button>
          <button className="spp-bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading products…</div>
      )}
    </div>
  );
};

export default SupplierProducts;
