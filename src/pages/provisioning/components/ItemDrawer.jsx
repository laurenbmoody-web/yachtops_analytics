import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import { ITEM_STATUS_CONFIG } from './StatusBadge';
import {
  upsertItems,
  deleteProvisioningItem,
  fetchInventoryLocationChildren,
} from '../utils/provisioningStorage';
import { UNIT_GROUPS } from './DetailTableCells';
import { useAuth } from '../../../contexts/AuthContext';

const ALLERGEN_OPTIONS = [
  'Gluten', 'Dairy', 'Eggs', 'Nuts', 'Peanuts', 'Soy', 'Fish', 'Shellfish',
  'Sesame', 'Celery', 'Mustard', 'Sulphites',
];

const SOURCE_LABELS = {
  manual: 'Manual',
  suggestion: 'Smart Suggestion',
  guest_preference: 'Guest Preference',
  low_stock: 'Low Stock',
  history: 'Order Pattern',
  template: 'Template',
};

const CURRENCY_PILLS = [
  { code: 'GBP', symbol: '£' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
];

// ── Section divider wrapper ───────────────────────────────────────────────────
const Section = ({ label, children }) => (
  <div className="mt-4 pt-4" style={{ borderTop: '1px solid #F1F5F9' }}>
    {label && (
      <p className="text-[10px] font-semibold uppercase text-[#94A3B8] mb-2" style={{ letterSpacing: '0.1em' }}>
        {label}
      </p>
    )}
    {children}
  </div>
);

const ItemDrawer = ({ open, item, listId, tenantId, listCurrency = 'USD', departments = [], theme = 'dark', onSaved, onDeleted, onClose }) => {
  const isLight = theme === 'light';
  const { user } = useAuth();
  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const canViewAccounting = ['COMMAND', 'CHIEF'].includes(userTier);

  const [form, setForm] = useState({});
  const [locRows, setLocRows] = useState([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [accountingOpen, setAccountingOpen] = useState(false);
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
        currency: item.currency || null,
        status: item.status || 'pending',
        quantity_received: item.quantity_received ?? '',
        allergen_flags: item.allergen_flags || [],
        item_notes: item.item_notes || '',
        notes: item.notes || '',
        source: item.source || 'manual',
        accounting_description: item.accounting_description || '',
      });
    }
  }, [item]);

  // Fetch inventory location children whenever department or tenantId changes
  useEffect(() => {
    if (!form.department || !tenantId) { setLocRows([]); return; }
    fetchInventoryLocationChildren(tenantId, form.department)
      .then(setLocRows)
      .catch(() => setLocRows([]));
  }, [form.department, tenantId]);

  // ── Derived cascading options ──────────────────────────────────────────────
  const locL2Options = locRows
    .filter(r => !r.sub_location.includes(' > '))
    .map(r => r.sub_location);

  const locL2 = form.category || '';
  const subParts = form.sub_category ? form.sub_category.split(' > ') : [];
  const locL3 = subParts[1] || '';
  const locL4 = subParts[2] || '';

  const locL3Options = locL2
    ? locRows
        .filter(r =>
          r.sub_location.startsWith(locL2 + ' > ') &&
          r.sub_location.split(' > ').length === 2
        )
        .map(r => r.sub_location.split(' > ')[1])
    : [];

  const locL4Options = locL2 && locL3
    ? locRows
        .filter(r =>
          r.sub_location.startsWith(locL2 + ' > ' + locL3 + ' > ') &&
          r.sub_location.split(' > ').length === 3
        )
        .map(r => r.sub_location.split(' > ')[2])
    : [];

  // ── Save helpers ──────────────────────────────────────────────────────────

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
      currency: base.currency || null,
      status: base.status || 'pending',
      quantity_received: base.quantity_received !== '' ? parseFloat(base.quantity_received) : null,
      allergen_flags: base.allergen_flags || [],
      item_notes: base.item_notes || '',
      notes: base.notes || '',
      source: base.source || 'manual',
      accounting_description: base.accounting_description || '',
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

  // ── Style constants ───────────────────────────────────────────────────────

  const inputCls = isLight
    ? 'w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors bg-white border border-[#E2E8F0] text-[#1E3A5F] focus:border-[#4A90E2]'
    : 'w-full rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2]';
  const labelCls = isLight
    ? 'block text-[10px] font-semibold uppercase tracking-wider mb-1 text-[#64748B]'
    : 'block text-[10px] font-semibold uppercase tracking-wider mb-1 text-[rgba(255,255,255,0.4)]';

  // ── Computed values ───────────────────────────────────────────────────────

  const activeCurrCode = form.currency || listCurrency || 'USD';
  const activeCurrSymbol = CURRENCY_PILLS.find(p => p.code === activeCurrCode)?.symbol || '$';
  const totalCost = (parseFloat(form.quantity_ordered) || 0) * (parseFloat(form.estimated_unit_cost) || 0);

  if (!open || !item) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      theme={theme}
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{form.name || 'Item Details'}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {savedFlash && (
              <span className={`text-xs font-normal animate-pulse ${isLight ? 'text-[#16a34a]' : 'text-green-400'}`}>Saved</span>
            )}
            {!isNew && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-1 rounded text-[#94A3B8] hover:text-red-500 transition-colors disabled:opacity-40"
              >
                <Icon name="Trash2" className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="pb-8">

        {/* ═══════════ SECTION 1: IDENTITY ═══════════ */}
        <div>
          {/* Name — large, prominent, title-weight */}
          <input
            value={form.name || ''}
            onChange={e => set('name', e.target.value)}
            onBlur={() => saveField()}
            placeholder="Item name"
            className={`w-full bg-transparent outline-none font-semibold pb-1.5 border-b transition-colors ${
              isLight
                ? 'text-[#1E3A5F] border-[#E2E8F0] placeholder:text-[#CBD5E1] focus:border-[#4A90E2]'
                : 'text-white border-white/10 placeholder:text-white/25 focus:border-[#4A90E2]'
            }`}
            style={{ fontSize: 18 }}
          />
          {/* Brand */}
          <div className="mt-3">
            <label className={labelCls}>Brand</label>
            <input
              value={form.brand || ''}
              onChange={e => set('brand', e.target.value)}
              onBlur={() => saveField()}
              className={inputCls}
              placeholder="Brand"
            />
          </div>
        </div>

        {/* ═══════════ SECTION 2: MEASURE ═══════════ */}
        <Section label="Measure">
          <div className="flex gap-2">
            <div style={{ flex: 2 }}>
              <label className={labelCls}>Size</label>
              <input
                value={form.size || ''}
                onChange={e => set('size', e.target.value)}
                onBlur={() => saveField()}
                className={inputCls}
                placeholder="e.g. 500g"
              />
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
        </Section>

        {/* ═══════════ SECTION 3: LOCATION ═══════════ */}
        <Section label="Location">
          {/* Department */}
          <div>
            <label className={labelCls}>Department</label>
            <select
              value={form.department || ''}
              onChange={e => {
                const dept = e.target.value;
                setForm(prev => ({ ...prev, department: dept, category: '', sub_category: '' }));
                saveField({ department: dept, category: '', sub_category: '' });
              }}
              className={inputCls}
            >
              <option value="">None</option>
              {departments.length === 0
                ? <option disabled value="">No departments configured</option>
                : departments.map(d => <option key={d} value={d}>{d}</option>)
              }
            </select>
          </div>

          {/* Category cascade — inventory_locations hierarchy */}
          {form.department && (
            <div className="mt-3 space-y-3">
              {locL2Options.length > 0 && (
                <div>
                  <label className={labelCls}>Category</label>
                  <select
                    value={locL2}
                    onChange={e => {
                      const val = e.target.value;
                      setForm(prev => ({ ...prev, category: val, sub_category: val }));
                      saveField({ category: val, sub_category: val });
                    }}
                    className={inputCls}
                  >
                    <option value="">Select category…</option>
                    {locL2Options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              )}

              {locL2 && locL3Options.length > 0 && (
                <div>
                  <label className={labelCls}>Sub-category</label>
                  <select
                    value={locL3}
                    onChange={e => {
                      const val = e.target.value;
                      const path = val ? `${locL2} > ${val}` : locL2;
                      setForm(prev => ({ ...prev, sub_category: path }));
                      saveField({ sub_category: path });
                    }}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {locL3Options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              )}

              {locL3 && locL4Options.length > 0 && (
                <div>
                  <label className={labelCls}>Sub-category 2</label>
                  <select
                    value={locL4}
                    onChange={e => {
                      const val = e.target.value;
                      const path = val ? `${locL2} > ${locL3} > ${val}` : `${locL2} > ${locL3}`;
                      setForm(prev => ({ ...prev, sub_category: path }));
                      saveField({ sub_category: path });
                    }}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {locL4Options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ═══════════ SECTION 4: COST ═══════════ */}
        <Section label="Cost">
          <div className="flex gap-3">
            {/* Unit cost with currency toggle */}
            <div className="flex-1">
              <label className={labelCls}>Unit Cost</label>
              <div className="flex items-center">
                {/* Currency pills */}
                <div className="flex flex-shrink-0">
                  {CURRENCY_PILLS.map((pill, idx) => {
                    const active = activeCurrCode === pill.code;
                    const isFirst = idx === 0;
                    const isLast = idx === CURRENCY_PILLS.length - 1;
                    return (
                      <button
                        key={pill.code}
                        type="button"
                        onClick={() => {
                          setForm(prev => ({ ...prev, currency: pill.code }));
                          saveField({ currency: pill.code });
                        }}
                        style={{
                          width: 32,
                          height: 32,
                          fontSize: 12,
                          fontWeight: 600,
                          background: active ? '#1E3A5F' : 'transparent',
                          color: active ? '#ffffff' : '#64748B',
                          border: '1px solid #E2E8F0',
                          borderRight: isLast ? '1px solid #E2E8F0' : 'none',
                          borderRadius: isFirst ? '8px 0 0 8px' : isLast ? '0 8px 8px 0' : '0',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'background 0.15s, color 0.15s',
                        }}
                      >
                        {pill.symbol}
                      </button>
                    );
                  })}
                </div>
                {/* Cost input */}
                <input
                  type="number"
                  value={form.estimated_unit_cost ?? ''}
                  onChange={e => set('estimated_unit_cost', e.target.value)}
                  onBlur={() => saveField()}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  style={{ borderRadius: '0 8px 8px 0', borderLeft: 'none' }}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm outline-none transition-colors ${
                    isLight
                      ? 'bg-white border border-[#E2E8F0] text-[#1E3A5F] focus:border-[#4A90E2]'
                      : 'text-white bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2]'
                  }`}
                />
              </div>
            </div>

            {/* Total — read-only calculated */}
            <div className="flex-1">
              <label className={labelCls}>Total</label>
              <div
                className={`rounded-lg px-3 flex items-center ${isLight ? 'bg-slate-50 border border-[#E2E8F0]' : 'bg-white/5 border border-white/5'}`}
                style={{ height: 36 }}
              >
                <span className="text-sm tabular-nums text-[#94A3B8]">
                  {totalCost > 0 ? `${activeCurrSymbol}${totalCost.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Quantity Received — only when non-pending */}
          {form.status && form.status !== 'pending' && (
            <div className="mt-3">
              <label className={labelCls}>Quantity Received</label>
              <input
                type="number"
                value={form.quantity_received ?? ''}
                onChange={e => set('quantity_received', e.target.value)}
                onBlur={() => saveField()}
                className={inputCls}
                min="0"
                step="0.1"
              />
            </div>
          )}
        </Section>

        {/* ═══════════ SECTION 5: FLAGS ═══════════ */}
        <Section label="Flags">
          <div className="flex flex-wrap gap-1.5">
            {ALLERGEN_OPTIONS.map(a => {
              const active = (form.allergen_flags || []).includes(a);
              return (
                <button
                  key={a}
                  onClick={() => toggleAllergen(a)}
                  className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? 'bg-red-500/20 border-red-500/40 text-red-400'
                      : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-500 hover:text-[#1E3A5F]'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </Section>

        {/* ═══════════ SECTION 6: STATUS ═══════════ */}
        <Section label="Status">
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
        </Section>

        {/* ═══════════ SECTION 7: NOTES ═══════════ */}
        <Section label="Notes">
          <textarea
            value={form.item_notes || ''}
            onChange={e => set('item_notes', e.target.value)}
            onBlur={() => saveField()}
            rows={3}
            className={inputCls}
            placeholder="Any notes about this item — storage instructions, sourcing preferences, special requirements..."
          />
        </Section>

        {/* Source badge — read-only, only shown when source is non-manual */}
        {form.source && form.source !== 'manual' && (
          <div className="mt-3">
            <span
              style={{
                display: 'inline-block',
                background: 'rgba(0,0,0,0.05)',
                color: '#94A3B8',
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {SOURCE_LABELS[form.source] || form.source}
            </span>
          </div>
        )}

        {/* ═══════════ SECTION 9: ACCOUNTING (COMMAND / CHIEF only) ═══════════ */}
        {canViewAccounting && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #F1F5F9' }}>
            <button
              onClick={() => setAccountingOpen(v => !v)}
              className="w-full flex items-center justify-between"
            >
              <span
                className="text-[10px] font-semibold uppercase text-[#94A3B8]"
                style={{ letterSpacing: '0.1em' }}
              >
                Accounting
              </span>
              <Icon
                name={accountingOpen ? 'ChevronUp' : 'ChevronDown'}
                className="w-3.5 h-3.5 text-[#94A3B8]"
              />
            </button>
            {accountingOpen && (
              <div className="mt-2">
                <input
                  value={form.accounting_description || ''}
                  onChange={e => set('accounting_description', e.target.value)}
                  onBlur={() => saveField()}
                  className={inputCls}
                  placeholder="e.g. food and beverage, guest entertainment, maintenance supplies"
                />
              </div>
            )}
          </div>
        )}

      </div>
    </Drawer>
  );
};

export default ItemDrawer;
