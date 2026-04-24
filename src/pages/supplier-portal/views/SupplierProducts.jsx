import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { usePermission } from '../../../contexts/SupplierPermissionContext';
import {
  fetchCatalogueItems,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
} from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

const NO_PERMISSION_TITLE = "Your role doesn't have permission for this action.";

const CATEGORIES = ['Produce', 'Meat & Fish', 'Dairy', 'Beverages', 'Dry Goods', 'Frozen', 'Cleaning', 'Other'];
const UNITS = ['kg', 'g', 'L', 'ml', 'unit', 'case', 'box', 'bottle', 'each'];

const EMPTY_FORM = { name: '', sku: '', category: '', unit: 'kg', unit_price: '', currency: 'EUR', description: '', in_stock: true };

const ProductModal = ({ initial, onSave, onClose, saving }) => {
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ ...form, unit_price: parseFloat(form.unit_price) || null });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: 'var(--card)', borderRadius: 14, padding: 28, width: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 16, margin: 0 }}>
            {initial ? 'Edit product' : 'New product'}
          </h4>
          <button className="sp-icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Name *</label>
              <input required value={form.name} onChange={e => set('name', e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>SKU</label>
              <input value={form.sku} onChange={e => set('sku', e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13, background: 'var(--card)' }}>
                <option value="">— select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Unit</label>
              <select value={form.unit} onChange={e => set('unit', e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13, background: 'var(--card)' }}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Unit price</label>
              <input type="number" step="0.01" min="0" value={form.unit_price} onChange={e => set('unit_price', e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Currency</label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13, background: 'var(--card)' }}>
                {['EUR','USD','GBP','CHF'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Description</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
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
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    fetchCatalogueItems(supplier.id)
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id]);

  const handleSave = async (formData) => {
    setSaving(true);
    try {
      if (modal === 'new') {
        const created = await createCatalogueItem(supplier.id, formData);
        setItems(prev => [created, ...prev]);
      } else {
        const updated = await updateCatalogueItem(modal.id, formData);
        setItems(prev => prev.map(i => i.id === modal.id ? updated : i));
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
    } catch (e) {
      setError(e.message);
    }
  };

  const filtered = items.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.sku ?? '').toLowerCase().includes(search.toLowerCase())
  );

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

      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{items.length} products</div>
          <h1 className="sp-page-title">Your <em>catalogue</em></h1>
          <p className="sp-page-sub">Manage what you offer. Prices and stock visible to yacht clients.</p>
        </div>
        <div className="sp-actions">
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

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13, width: 260 }}
        />
      </div>

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon="📦"
          title={items.length === 0 ? 'No products yet' : 'No results'}
          body={items.length === 0 ? 'Add your first product to start receiving orders.' : 'Try a different search term.'}
          action={items.length === 0 && canEdit && (
            <button className="sp-pill primary" onClick={() => setModal('new')}><Plus size={13} />Add product</button>
          )}
        />
      )}

      {filtered.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="num">Price</th>
                <th>Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id}>
                  <td>
                    <div className="sp-line-name">{item.name}</div>
                    {item.sku && <div className="sp-line-sku">{item.sku}</div>}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted-s)' }}>{item.category ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>{item.unit ?? '—'}</td>
                  <td className="sp-amount">
                    {item.unit_price != null
                      ? `${item.unit_price.toFixed(2)} ${item.currency}`
                      : '—'}
                  </td>
                  <td>
                    <span className={`sp-stock ${item.in_stock ? 'in' : 'out'}`}>
                      <span className="d" />{item.in_stock ? 'In stock' : 'Out'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
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

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading products…</div>
      )}
    </div>
  );
};

export default SupplierProducts;
