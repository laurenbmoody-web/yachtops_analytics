import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X, UploadCloud, ImagePlus } from 'lucide-react';
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
} from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';
import CatalogueImportModal from '../components/CatalogueImportModal';
import './supplier-products.css';

const NO_PERMISSION_TITLE = "Your role doesn't have permission for this action.";

const CATEGORIES = ['Produce', 'Meat & Fish', 'Dairy', 'Beverages', 'Dry Goods', 'Frozen', 'Cleaning', 'Other'];
const UNITS = ['kg', 'g', 'L', 'ml', 'unit', 'case', 'box', 'bottle', 'each'];
const LOW_STOCK_AT = 10;

// Deterministic tile colour per category so an image-less list still scans.
const CATEGORY_HUES = {
  'Produce': '#4E8A3E', 'Meat & Fish': '#A5484F', 'Dairy': '#C99A2C', 'Beverages': '#3B6CB4',
  'Dry Goods': '#8A6D4B', 'Frozen': '#4E93A6', 'Cleaning': '#6D57A5', 'Other': '#64748B',
};

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', category: '', unit: 'kg',
  pack_size: '', pack_unit: '', unit_size: '',
  unit_price: '', currency: 'EUR', stock_qty: '', description: '', in_stock: true,
};

const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const fmtPack = (item) => {
  if (!item.pack_size && !item.unit_size) return '—';
  const inner = [item.pack_size, item.pack_unit].filter(Boolean).join(' × ');
  return [inner || null, item.unit_size].filter(Boolean).join(' · ');
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const isLowStock = (item) =>
  !item.in_stock || (item.stock_qty != null && Number(item.stock_qty) <= LOW_STOCK_AT);

const Thumb = ({ item }) => {
  if (item.image_url) return <img className="spp-thumb" src={item.image_url} alt="" loading="lazy" />;
  const hue = CATEGORY_HUES[item.category] || CATEGORY_HUES.Other;
  return (
    <span className="spp-thumb-ph" style={{ background: hue }}>
      {(item.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
};

// Click-to-edit numeric cell (Katana pattern): click → input, Enter/blur saves, Esc cancels.
const InlineNumber = ({ value, suffix, canEdit, onSave, placeholder = '—' }) => {
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
      {value != null ? `${Number(value).toFixed(suffix ? 2 : 0)}${suffix ? ` ${suffix}` : ''}` : placeholder}
    </span>
  );
};

const fieldStyle = { width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13 };
const labelStyle = { fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 };

const ProductModal = ({ initial, onSave, onClose, saving }) => {
  const [form, setForm] = useState(() => {
    if (!initial) return EMPTY_FORM;
    const merged = { ...EMPTY_FORM };
    Object.keys(EMPTY_FORM).forEach(k => {
      if (initial[k] != null) merged[k] = initial[k];
    });
    return merged;
  });
  const [photo, setPhoto] = useState(null); // File pending upload
  const photoInput = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const previewUrl = useMemo(
    () => (photo ? URL.createObjectURL(photo) : initial?.image_url || null),
    [photo, initial?.image_url]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      pack_unit: form.pack_unit.trim() || null,
      unit_size: form.unit_size.trim() || null,
      description: form.description.trim() || null,
      unit_price: numOrNull(form.unit_price),
      pack_size: numOrNull(form.pack_size),
      stock_qty: numOrNull(form.stock_qty),
    }, photo);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: 'var(--card)', borderRadius: 14, padding: 28, width: 540, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 16, margin: 0 }}>
            {initial ? 'Edit product' : 'New product'}
          </h4>
          <button className="sp-icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="spp-photo-row">
            {previewUrl
              ? <img className="spp-photo-preview" src={previewUrl} alt="" />
              : <span className="spp-photo-preview" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><ImagePlus size={20} /></span>}
            <div>
              <button type="button" className="sp-pill" onClick={() => photoInput.current?.click()}>
                {previewUrl ? 'Change photo' : 'Add photo'}
              </button>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>JPG, PNG or WebP · 5MB max</div>
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input required value={form.name} onChange={e => set('name', e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                style={{ ...fieldStyle, background: 'var(--card)' }}>
                <option value="">— select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>SKU</label>
              <input value={form.sku} onChange={e => set('sku', e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Barcode (EAN/GTIN)</label>
              <input value={form.barcode} onChange={e => set('barcode', e.target.value)}
                placeholder="e.g. 8002270014901" inputMode="numeric" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Sell unit</label>
              <select value={form.unit} onChange={e => set('unit', e.target.value)}
                style={{ ...fieldStyle, background: 'var(--card)' }}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unit price</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" step="0.01" min="0" value={form.unit_price} onChange={e => set('unit_price', e.target.value)}
                  style={{ ...fieldStyle, flex: 1 }} />
                <select value={form.currency} onChange={e => set('currency', e.target.value)}
                  style={{ ...fieldStyle, width: 74, background: 'var(--card)' }}>
                  {['EUR', 'USD', 'GBP', 'CHF'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Pack — what's inside one sell unit <span style={{ color: 'var(--muted)' }}>(optional)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <input type="number" step="1" min="0" placeholder="Qty (e.g. 24)" value={form.pack_size}
                onChange={e => set('pack_size', e.target.value)} style={fieldStyle} />
              <input placeholder="Inner unit (e.g. bottle)" value={form.pack_unit}
                onChange={e => set('pack_unit', e.target.value)} style={fieldStyle} />
              <input placeholder="Size (e.g. 330ml)" value={form.unit_size}
                onChange={e => set('unit_size', e.target.value)} style={fieldStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Stock quantity <span style={{ color: 'var(--muted)' }}>(blank = untracked)</span></label>
              <input type="number" step="1" min="0" value={form.stock_qty} onChange={e => set('stock_qty', e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Description</label>
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
                style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.in_stock} onChange={e => set('in_stock', e.target.checked)} />
            In stock
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="sp-pill" onClick={onClose}>Cancel</button>
            <button type="submit" className="sp-pill primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const SupplierProducts = () => {
  const { supplier } = useSupplier();
  const { allowed: canEdit } = usePermission('catalogue:edit');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // null | 'new' | {item}
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('All'); // 'All' | category | 'Low'
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    fetchCatalogueItems(supplier.id)
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id]);

  const patchLocal = (updated) => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));

  const handleSave = async (formData, photo) => {
    setSaving(true);
    try {
      if (modal === 'new') {
        let created = await createCatalogueItem(supplier.id, formData);
        if (photo) {
          try { created = await uploadCatalogueImage(supplier.id, created.id, photo); }
          catch (e) { setError(`Product saved, but the photo upload failed: ${e.message}`); }
        }
        setItems(prev => [created, ...prev]);
      } else {
        let updated = await updateCatalogueItem(modal.id, formData);
        if (photo) {
          try { updated = await uploadCatalogueImage(supplier.id, modal.id, photo); }
          catch (e) { setError(`Product saved, but the photo upload failed: ${e.message}`); }
        }
        patchLocal(updated);
      }
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    try {
      await deleteCatalogueItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) {
      setError(e.message);
    }
  };

  const handleInlineSave = (item, patch) => async (value) => {
    try {
      const updates = { ...patch(value) };
      const updated = await updateCatalogueItem(item.id, updates);
      patchLocal(updated);
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

  const filtered = useMemo(() => searched.filter(i => {
    if (chip === 'All') return true;
    if (chip === 'Low') return isLowStock(i);
    return (i.category || 'Other') === chip;
  }), [searched, chip]);

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
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} product${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return;
    runBulk(async (ids) => {
      await bulkDeleteCatalogueItems(ids);
      setItems(prev => prev.filter(i => !selected.has(i.id)));
      setSelected(new Set());
    });
  };

  const chipDefs = [
    { key: 'All', label: 'All', count: searched.length },
    ...CATEGORIES.filter(c => counts.byCat[c]).map(c => ({ key: c, label: c, count: counts.byCat[c] })),
    ...(counts.low ? [{ key: 'Low', label: 'Low / out', count: counts.low, warn: true }] : []),
  ];

  return (
    <div className="sp-page">
      {modal && (
        <ProductModal
          initial={modal === 'new' ? null : modal}
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

      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{items.length} products</div>
          <h1 className="sp-page-title">Your <em>catalogue</em></h1>
          <p className="sp-page-sub">Manage what you offer. Prices and stock visible to yacht clients.</p>
        </div>
        <div className="sp-actions">
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

      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Search name, SKU or barcode…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13, width: 260 }}
        />
      </div>

      {items.length > 0 && (
        <div className="spp-chips">
          {chipDefs.map(c => (
            <button
              key={c.key}
              className={`spp-chip ${chip === c.key ? 'on' : ''} ${c.warn ? 'warn' : ''}`}
              onClick={() => setChip(chip === c.key ? 'All' : c.key)}
            >
              {c.warn && <span className="dot" />}
              {c.label} <span className="ct">{c.count}</span>
            </button>
          ))}
        </div>
      )}

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
                <th>Unit</th>
                <th>Pack</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
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
                        {(item.sku || item.barcode) && (
                          <div className="sp-line-sku">
                            {[item.sku, item.barcode ? `EAN ${item.barcode}` : null].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted-s)' }}>{item.category ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>{item.unit ?? '—'}</td>
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
                    <InlineNumber
                      value={item.stock_qty}
                      canEdit={canEdit}
                      placeholder={item.in_stock ? 'In stock' : 'Out'}
                      onSave={handleInlineSave(item, (v) => ({ stock_qty: v, in_stock: v == null ? item.in_stock : v > 0 }))}
                    />
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
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
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
