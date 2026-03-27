import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import { ITEM_STATUS_CONFIG } from './StatusBadge';
import {
  upsertItems,
  deleteProvisioningItem,
  PROVISION_DEPARTMENTS,
  PROVISION_UNITS,
  ITEM_STATUS,
} from '../utils/provisioningStorage';
import { getAllCategoriesL1, getCategoriesL2ByL1 } from '../../inventory/utils/taxonomyStorage';

const FALLBACK_CATEGORIES = [
  'Dry Goods', 'Fresh Produce', 'Frozen', 'Dairy', 'Beverages',
  'Cleaning & Laundry', 'Deck Stores', 'Engineering Supplies', 'Guest Amenities', 'Crew Supplies',
];

const ALLERGEN_OPTIONS = [
  'Gluten', 'Dairy', 'Eggs', 'Nuts', 'Peanuts', 'Soy', 'Fish', 'Shellfish', 'Sesame', 'Celery', 'Mustard', 'Sulphites',
];

const ItemDrawer = ({ open, item, listId, onSaved, onDeleted, onClose }) => {
  const [form, setForm] = useState({});
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || '',
        brand: item.brand || '',
        size: item.size || '',
        department: item.department || 'Galley',
        category: item.category || '',
        sub_category: item.sub_category || '',
        quantity_ordered: item.quantity_ordered ?? 1,
        unit: item.unit || 'each',
        estimated_unit_cost: item.estimated_unit_cost || '',
        status: item.status || 'pending',
        quantity_received: item.quantity_received ?? '',
        allergen_flags: item.allergen_flags || [],
        item_notes: item.item_notes || '',
        notes: item.notes || '',
      });
    }
  }, [item]);

  // Load taxonomy categories
  useEffect(() => {
    const load = async () => {
      try {
        const cats = await getAllCategoriesL1();
        setCategories(cats?.length ? cats.map(c => c.name || c) : FALLBACK_CATEGORIES);
      } catch {
        setCategories(FALLBACK_CATEGORIES);
      }
    };
    load();
  }, []);

  // Load sub-categories when category changes
  useEffect(() => {
    if (!form.category) { setSubCategories([]); return; }
    const load = async () => {
      try {
        const subs = await getCategoriesL2ByL1(form.category);
        setSubCategories(subs?.length ? subs.map(s => s.name || s) : []);
      } catch {
        setSubCategories([]);
      }
    };
    load();
  }, [form.category]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const toggleAllergen = (a) => {
    setForm(prev => {
      const flags = prev.allergen_flags || [];
      return {
        ...prev,
        allergen_flags: flags.includes(a) ? flags.filter(x => x !== a) : [...flags, a],
      };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...(item?.id && !String(item.id).startsWith('new_') ? { id: item.id } : {}),
        list_id: listId,
        name: form.name.trim(),
        brand: form.brand,
        size: form.size,
        department: form.department,
        category: form.category,
        sub_category: form.sub_category,
        quantity_ordered: parseFloat(form.quantity_ordered) || 1,
        unit: form.unit,
        estimated_unit_cost: form.estimated_unit_cost ? parseFloat(form.estimated_unit_cost) : null,
        status: form.status,
        quantity_received: form.quantity_received !== '' ? parseFloat(form.quantity_received) : null,
        allergen_flags: form.allergen_flags,
        item_notes: form.item_notes,
        notes: form.notes,
        source: item?.source || 'manual',
      };
      const saved = await upsertItems([payload]);
      onSaved(listId, saved);
      onClose();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item?.id || String(item.id).startsWith('new_')) return;
    if (!window.confirm('Delete this item?')) return;
    setDeleting(true);
    try {
      await deleteProvisioningItem(item.id);
      onDeleted(listId, item.id);
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  const inputCls = 'w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#4A90E2] transition-colors';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

  return (
    <Drawer open={open} onClose={onClose} title={item?.name || 'Item Details'}>
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className={labelCls}>Item Name *</label>
          <input value={form.name || ''} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="Item name" />
        </div>

        {/* Brand + Size */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Brand</label>
            <input value={form.brand || ''} onChange={e => set('brand', e.target.value)} className={inputCls} placeholder="Brand" />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Size</label>
            <input value={form.size || ''} onChange={e => set('size', e.target.value)} className={inputCls} placeholder="e.g. 500g" />
          </div>
        </div>

        {/* Department */}
        <div>
          <label className={labelCls}>Department</label>
          <select value={form.department || ''} onChange={e => set('department', e.target.value)} className={inputCls}>
            {PROVISION_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Category + Sub-category */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Category</label>
            <select value={form.category || ''} onChange={e => { set('category', e.target.value); set('sub_category', ''); }} className={inputCls}>
              <option value="">Select...</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {subCategories.length > 0 && (
            <div className="flex-1">
              <label className={labelCls}>Sub-category</label>
              <select value={form.sub_category || ''} onChange={e => set('sub_category', e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {subCategories.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Quantity + Unit */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Quantity</label>
            <input type="number" value={form.quantity_ordered ?? ''} onChange={e => set('quantity_ordered', e.target.value)} className={inputCls} min="0" step="0.1" />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Unit</label>
            <select value={form.unit || 'each'} onChange={e => set('unit', e.target.value)} className={inputCls}>
              {PROVISION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Cost */}
        <div>
          <label className={labelCls}>Estimated Unit Cost</label>
          <input type="number" value={form.estimated_unit_cost ?? ''} onChange={e => set('estimated_unit_cost', e.target.value)} className={inputCls} placeholder="0.00" min="0" step="0.01" />
        </div>

        {/* Status */}
        <div>
          <label className={labelCls}>Status</label>
          <select value={form.status || 'pending'} onChange={e => set('status', e.target.value)} className={inputCls}>
            {Object.entries(ITEM_STATUS_CONFIG).map(([val, cfg]) => (
              <option key={val} value={val}>{cfg.label}</option>
            ))}
          </select>
        </div>

        {/* Quantity received (only if not pending) */}
        {form.status && form.status !== 'pending' && (
          <div>
            <label className={labelCls}>Quantity Received</label>
            <input type="number" value={form.quantity_received ?? ''} onChange={e => set('quantity_received', e.target.value)} className={inputCls} min="0" step="0.1" />
          </div>
        )}

        {/* Allergens */}
        <div>
          <label className={labelCls}>Allergen Flags</label>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGEN_OPTIONS.map(a => {
              const selected = (form.allergen_flags || []).includes(a);
              return (
                <button
                  key={a}
                  onClick={() => toggleAllergen(a)}
                  className={`px-2 py-1 text-xs rounded-full border transition-colors ${selected ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Item Notes</label>
          <textarea value={form.item_notes || ''} onChange={e => set('item_notes', e.target.value)} rows={2} className={inputCls} placeholder="Notes about this item..." />
        </div>

        <div>
          <label className={labelCls}>General Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls} placeholder="Additional notes..." />
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || !form.name?.trim()}
          className="w-full py-2.5 bg-[#4A90E2] text-white text-sm font-medium rounded-lg hover:bg-[#4A90E2]/80 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Item'}
        </button>

        {/* Delete */}
        {item?.id && !String(item.id).startsWith('new_') && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-full py-2 bg-red-500/10 text-red-400 text-sm rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete Item'}
          </button>
        )}
      </div>
    </Drawer>
  );
};

export default ItemDrawer;
