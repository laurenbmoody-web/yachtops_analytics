import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import { ITEM_STATUS_CONFIG } from './StatusBadge';
import {
  upsertItems,
  deleteProvisioningItem,
} from '../utils/provisioningStorage';
import { UNIT_GROUPS } from './DetailTableCells';
import { getAllCategoriesL1, getCategoriesL2ByL1 } from '../../inventory/utils/taxonomyStorage';

const FALLBACK_CATEGORIES = [
  'Dry Goods', 'Fresh Produce', 'Frozen', 'Dairy', 'Beverages',
  'Cleaning & Laundry', 'Deck Stores', 'Engineering Supplies', 'Guest Amenities', 'Crew Supplies',
];

const ALLERGEN_OPTIONS = [
  'Gluten', 'Dairy', 'Eggs', 'Nuts', 'Peanuts', 'Soy', 'Fish', 'Shellfish',
  'Sesame', 'Celery', 'Mustard', 'Sulphites',
];

const SOURCE_LABELS = {
  manual: 'Manual',
  suggestion: 'Smart suggestion',
  guest_preference: 'Guest preference',
  low_stock: 'Low stock alert',
  history: 'Order history',
  template: 'Template',
};

const ItemDrawer = ({ open, item, listId, departments = [], theme = 'dark', onSaved, onDeleted, onClose }) => {
  const isLight = theme === 'light';
  const [form, setForm] = useState({});
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const flashTimer = useRef(null);
  const isNew = !item?.id || String(item?.id).startsWith('new_');

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || '',
        brand: item.brand || '',
        size: item.size || '',
        department: item.department || '',
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
        source: item.source || 'manual',
      });
    }
  }, [item]);

  useEffect(() => {
    const load = async () => {
      try {
        const cats = await getAllCategoriesL1();
        setCategories(cats?.length ? cats.map(c => c.name || c) : FALLBACK_CATEGORIES);
      } catch { setCategories(FALLBACK_CATEGORIES); }
    };
    load();
  }, []);

  useEffect(() => {
    if (!form.category) { setSubCategories([]); return; }
    const load = async () => {
      try {
        const subs = await getCategoriesL2ByL1(form.category);
        setSubCategories(subs?.length ? subs.map(s => s.name || s) : []);
      } catch { setSubCategories([]); }
    };
    load();
  }, [form.category]);

  const showSaved = () => {
    setSavedFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1800);
  };

  const buildPayload = (overrides = {}) => {
    const base = { ...form, ...overrides };
    return {
      ...(isNew ? {} : { id: item.id }),
      list_id: listId,
      name: base.name?.trim() || '',
      brand: base.brand || '',
      size: base.size || '',
      department: base.department || '',
      category: base.category || '',
      sub_category: base.sub_category || '',
      quantity_ordered: parseFloat(base.quantity_ordered) || 1,
      unit: base.unit || 'each',
      estimated_unit_cost: base.estimated_unit_cost ? parseFloat(base.estimated_unit_cost) : null,
      status: base.status || 'pending',
      quantity_received: base.quantity_received !== '' ? parseFloat(base.quantity_received) : null,
      allergen_flags: base.allergen_flags || [],
      item_notes: base.item_notes || '',
      notes: base.notes || '',
      source: base.source || 'manual',
    };
  };

  const saveField = useCallback(async (overrides = {}) => {
    if (!form.name?.trim() && !overrides.name?.trim()) return;
    try {
      const saved = await upsertItems([buildPayload(overrides)]);
      onSaved(listId, saved);
      showSaved();
    } catch { /* silent */ }
  }, [form, item, listId]);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const setAndSave = (key, val) => {
    const updated = { [key]: val };
    setForm(prev => ({ ...prev, ...updated }));
    saveField(updated);
  };

  const toggleAllergen = (a) => {
    const flags = (form.allergen_flags || []).includes(a)
      ? (form.allergen_flags || []).filter(x => x !== a)
      : [...(form.allergen_flags || []), a];
    setAndSave('allergen_flags', flags);
  };

  const handleDelete = async () => {
    if (isNew || !window.confirm('Delete this item?')) return;
    setDeleting(true);
    try {
      await deleteProvisioningItem(item.id);
      onDeleted(listId, item.id);
      onClose();
    } catch { setDeleting(false); }
  };

  const inputCls = isLight
    ? 'w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors bg-white border border-[#E2E8F0] text-[#1E3A5F] focus:border-[#4A90E2]'
    : 'w-full rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2]';
  const labelCls = isLight
    ? 'block text-[10px] font-semibold uppercase tracking-wider mb-1 text-[#64748B]'
    : 'block text-[10px] font-semibold uppercase tracking-wider mb-1 text-[rgba(255,255,255,0.4)]';

  if (!open || !item) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      theme={theme}
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{form.name || 'Item Details'}</span>
          {savedFlash && (
            <span className={`text-xs font-normal flex-shrink-0 animate-pulse ${isLight ? 'text-[#16a34a]' : 'text-green-400'}`}>Saved</span>
          )}
        </div>
      }
    >
      <div className="space-y-4 pb-8">

        {/* Name */}
        <div>
          <label className={labelCls}>Item Name</label>
          <input
            value={form.name || ''}
            onChange={e => set('name', e.target.value)}
            onBlur={() => saveField()}
            className={inputCls}
            placeholder="Item name"
          />
        </div>

        {/* Status pills */}
        <div>
          <label className={labelCls}>Status</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ITEM_STATUS_CONFIG).map(([val, cfg]) => (
              <button
                key={val}
                onClick={() => setAndSave('status', val)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  form.status === val
                    ? 'bg-[#4A90E2]/20 border-[#4A90E2]/50 text-[#4A90E2]'
                    : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-500 hover:text-[#1E3A5F]'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Brand */}
        <div>
          <label className={labelCls}>Brand</label>
          <input value={form.brand || ''} onChange={e => set('brand', e.target.value)} onBlur={() => saveField()} className={inputCls} placeholder="Brand" />
        </div>

        {/* Department */}
        <div>
          <label className={labelCls}>Department</label>
          <select value={form.department || ''} onChange={e => setAndSave('department', e.target.value)} className={inputCls}>
            <option value="">None</option>
            {departments.length === 0
              ? <option disabled value="">No departments configured</option>
              : departments.map(d => <option key={d} value={d}>{d}</option>)
            }
          </select>
        </div>

        {/* Category + Sub */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Category</label>
            <select value={form.category || ''} onChange={e => { set('category', e.target.value); set('sub_category', ''); saveField({ category: e.target.value, sub_category: '' }); }} className={inputCls}>
              <option value="">Select...</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {subCategories.length > 0 && (
            <div className="flex-1">
              <label className={labelCls}>Sub-category</label>
              <select value={form.sub_category || ''} onChange={e => setAndSave('sub_category', e.target.value)} className={inputCls}>
                <option value="">Select...</option>
                {subCategories.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Measure: Size | Unit | Qty */}
        <div>
          <label className={labelCls}>Measure</label>
          <div className="flex gap-2">
            <div style={{ flex: 2 }}>
              <label className={labelCls}>Size</label>
              <input value={form.size || ''} onChange={e => set('size', e.target.value)} onBlur={() => saveField()} className={inputCls} placeholder="e.g. 500g" />
            </div>
            <div style={{ flex: 2 }}>
              <label className={labelCls}>Unit</label>
              <select value={form.unit || 'each'} onChange={e => setAndSave('unit', e.target.value)} className={inputCls}>
                {UNIT_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map(u => <option key={u} value={u}>{u}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className={labelCls}>Qty</label>
              <input
                type="number"
                value={form.quantity_ordered ?? ''}
                onChange={e => set('quantity_ordered', e.target.value)}
                onBlur={() => saveField()}
                className={`${inputCls} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                min="0"
                step="0.1"
              />
            </div>
          </div>
        </div>

        {/* Qty received (non-pending) */}
        {form.status && form.status !== 'pending' && (
          <div>
            <label className={labelCls}>Quantity Received</label>
            <input type="number" value={form.quantity_received ?? ''} onChange={e => set('quantity_received', e.target.value)} onBlur={() => saveField()} className={inputCls} min="0" step="0.1" />
          </div>
        )}

        {/* Est. unit cost */}
        <div>
          <label className={labelCls}>Estimated Unit Cost</label>
          <input type="number" value={form.estimated_unit_cost ?? ''} onChange={e => set('estimated_unit_cost', e.target.value)} onBlur={() => saveField()} className={inputCls} placeholder="0.00" min="0" step="0.01" />
        </div>

        {/* Allergens */}
        <div>
          <label className={labelCls}>Allergen Flags</label>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGEN_OPTIONS.map(a => {
              const active = (form.allergen_flags || []).includes(a);
              return (
                <button key={a} onClick={() => toggleAllergen(a)}
                  className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? 'bg-red-500/20 border-red-500/40 text-red-400'
                      : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-500 hover:text-[#1E3A5F]'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                  }`}>
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        {/* Source */}
        <div>
          <label className={labelCls}>Source</label>
          <p className={`text-sm px-3 py-2 rounded-lg ${isLight ? 'text-[#64748B] bg-slate-50 border border-[#E2E8F0]' : 'text-slate-400 bg-white/5'}`}>
            {SOURCE_LABELS[form.source] || form.source || 'Manual'}
          </p>
        </div>

        {/* Item notes */}
        <div>
          <label className={labelCls}>Item Notes</label>
          <textarea value={form.item_notes || ''} onChange={e => set('item_notes', e.target.value)} onBlur={() => saveField()} rows={2} className={inputCls} placeholder="Notes about this item..." />
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} onBlur={() => saveField()} rows={2} className={inputCls} placeholder="Additional notes..." />
        </div>

        {/* Delete */}
        {!isNew && (
          <div className={`pt-4 ${isLight ? 'border-t border-[#E2E8F0]' : 'border-t border-white/5'}`}>
            <button onClick={handleDelete} disabled={deleting}
              className={`w-full py-2 text-sm rounded-lg disabled:opacity-40 transition-colors ${isLight ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'}`}>
              {deleting ? 'Deleting...' : 'Delete Item'}
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default ItemDrawer;
