import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import { ITEM_STATUS_CONFIG } from './StatusBadge';
import {
  upsertItems,
  deleteProvisioningItem,
  fetchAllInventoryLocations,
  fetchDistinctSuppliers,
  searchInventoryItems,
  fetchInventoryItemById,
  updateItemPaymentStatus,
  PROVISION_CATEGORIES,
} from '../utils/provisioningStorage';
import { PAYMENT_STATUS_OPTIONS } from './InvoiceUploadModal';
import { UNIT_GROUPS } from './DetailTableCells';
import { useAuth } from '../../../contexts/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────

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

// Per-status selected pill colours
const STATUS_STYLES = {
  draft:        { bg: '#f1f5f9', border: '#cbd5e1', color: '#475569' },
  to_order:     { bg: '#eff6ff', border: '#93c5fd', color: '#1d4ed8' },
  ordered:      { bg: '#f5f3ff', border: '#c4b5fd', color: '#7c3aed' },
  received:     { bg: '#f0fdf4', border: '#86efac', color: '#15803d' },
  partial:      { bg: '#fffbeb', border: '#fcd34d', color: '#b45309' },
  not_received: { bg: '#fef2f2', border: '#fca5a5', color: '#b91c1c' },
};

// ── Field label + child wrapper — defined at module level to avoid remount ───
const Field = ({ isLight, labelCls, label, children }) => (
  <div>
    {isLight ? (
      <span style={{ display: 'block', fontSize: 10, color: '#cbd5e1', fontWeight: 500, letterSpacing: '0.04em', marginBottom: 4 }}>
        {label}
      </span>
    ) : (
      <label className={labelCls}>{label}</label>
    )}
    {children}
  </div>
);

// ── Section wrapper — spacing only, no divider line ───────────────────────────
const Section = ({ label, children }) => (
  <div style={{ paddingTop: 20 }}>
    {label && (
      <p style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: '#cbd5e1', marginBottom: 10,
      }}>
        {label}
      </p>
    )}
    {children}
  </div>
);

// ── Field sub-label (inside sections) ────────────────────────────────────────
const FL = ({ children }) => (
  <span style={{ display: 'block', fontSize: 10, color: '#cbd5e1', fontWeight: 500, letterSpacing: '0.04em', marginBottom: 4 }}>
    {children}
  </span>
);

// ── Progressive category picker ──────────────────────────────────────────────
// paths: string[] of full paths like ["Bar", "Bar > Main Bar", "Bar > Main Bar > Wine"]
// value: currently selected full path  (e.g. "Bar > Main Bar > Wine")
// Deriving form fields: department=segments[0], category=segments[1], sub_category=segments.slice(1).join(' > ')
const CategoryPicker = ({ paths = [], value = '', onChange, disabled = false, borderColor = '#e2e8f0' }) => {
  const segments = value ? value.split(' > ') : [];

  const getLevelOptions = (level) => {
    const prefix = segments.slice(0, level).join(' > ');
    const relevant = prefix
      ? paths.filter(p => p === prefix || p.startsWith(prefix + ' > '))
      : paths;
    const seen = new Set();
    const opts = [];
    for (const path of relevant) {
      const seg = path.split(' > ')[level];
      if (seg && !seen.has(seg)) {
        seen.add(seg);
        opts.push(seg); // all entries in paths are folders; leaf folders are valid selections
      }
    }
    return opts;
  };

  const handleChange = (level, val) => {
    const newSegs = [...segments.slice(0, level), ...(val ? [val] : [])];
    onChange(newSegs.join(' > '));
  };

  // Build array of dropdowns: always show one more than currently selected (if options exist)
  const dropdowns = [];
  for (let level = 0; ; level++) {
    const opts = getLevelOptions(level);
    if (opts.length === 0) break;
    dropdowns.push({ level, opts, selected: segments[level] || '' });
    if (!segments[level]) break; // stop until this level is filled
  }

  if (dropdowns.length === 0 && paths.length === 0) {
    return <span style={{ fontSize: 12, color: '#CBD5E1' }}>No categories configured</span>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {dropdowns.map(({ level, opts, selected }) => (
        <select
          key={level}
          value={selected}
          onChange={e => handleChange(level, e.target.value)}
          disabled={disabled}
          style={{
            fontSize: 12, padding: '4px 6px',
            border: `1px solid ${disabled ? '#e2e8f0' : borderColor}`,
            borderRadius: 6, background: 'white',
            color: selected ? '#0F172A' : '#94A3B8',
            cursor: disabled ? 'default' : 'pointer',
            outline: 'none', flexShrink: 0,
            maxWidth: 150, opacity: disabled ? 0.55 : 1,
          }}
        >
          <option value="">Select…</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
    </div>
  );
};

// ── CSS for .idr-field inputs/selects/textareas ───────────────────────────────
const FIELD_CSS = `
  .idr-field {
    width: 100%;
    background: transparent;
    border: 1.5px solid transparent;
    outline: none;
    font-size: 14px;
    color: #1E3A5F;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    padding: 5px 0;
    border-radius: 6px;
    transition: all 0.15s ease;
    box-sizing: border-box;
  }
  .idr-field::placeholder { color: #CBD5E1; }
  .idr-field:hover {
    background: #f8fafc;
    padding: 5px 8px;
  }
  .idr-field:focus {
    background: #ffffff;
    border-color: #4A90E2;
    padding: 5px 8px;
    box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.08);
  }
  select.idr-field { cursor: pointer; }
  textarea.idr-field { resize: none; line-height: 1.6; min-height: 80px; }
  .idr-cost-input {
    background: #f8fafc;
    padding: 5px 8px;
  }
  .idr-cost-input:hover { background: #f8fafc; }
  .idr-cost-input:focus {
    background: #ffffff;
    border-color: #4A90E2;
    box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.08);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────

const ItemDrawer = ({ open, item, listId, tenantId, listCurrency = 'GBP', departments = [], suppliers = [], theme = 'dark', onSaved, onDeleted, onClose }) => {
  const isLight = theme === 'light';
  const navigate = useNavigate();
  const { user } = useAuth();
  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const canViewAccounting = ['COMMAND', 'CHIEF'].includes(userTier);

  const [form, setForm] = useState({});
  const [allCategoryPaths, setAllCategoryPaths] = useState([]);
  const [knownSuppliers, setKnownSuppliers] = useState([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [accountingOpen, setAccountingOpen] = useState(false);
  const flashTimer = useRef(null);
  const isNew = !item?.id || String(item?.id).startsWith('new_');

  // Inventory link search state
  const [invSearchQuery, setInvSearchQuery] = useState('');
  const [invResults, setInvResults] = useState([]);
  const [invDropdownOpen, setInvDropdownOpen] = useState(false);
  const [invSearchLoading, setInvSearchLoading] = useState(false);
  const [linkedInvItem, setLinkedInvItem] = useState(null); // full inv row when linked this session
  const [invItemData, setInvItemData] = useState(null);    // taxonomy/category fields for the linked item
  const invSearchRef = useRef(null);
  const invDebounceTimer = useRef(null);

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
        status: item.status || 'draft',
        quantity_received: item.quantity_received ?? '',
        allergen_flags: item.allergen_flags || [],
        item_notes: item.item_notes || '',
        notes: item.notes || '',
        source: item.source || 'manual',
        accounting_description: item.accounting_description || '',
        supplier_id: item.supplier_id || '',
        supplier_name: item.supplier_name || '',
        port_location: item.port_location || '',
        inventory_item_id: item.inventory_item_id || null,
        cargo_item_id: item.cargo_item_id || '',
        barcode: item.barcode || '',
      });
    }
  }, [item]);

  // Fetch all inventory category paths once per tenant; fall back to PROVISION_CATEGORIES
  useEffect(() => {
    if (!tenantId) return;
    fetchAllInventoryLocations(tenantId).then(paths => {
      if (paths && paths.length > 0) {
        setAllCategoryPaths(paths);
      } else {
        // Build paths from static provisioning categories as fallback
        const fallback = [];
        Object.entries(PROVISION_CATEGORIES).forEach(([dept, cats]) => {
          fallback.push(dept);
          cats.forEach(cat => fallback.push(`${dept} > ${cat}`));
        });
        setAllCategoryPaths(fallback);
      }
    });
    fetchDistinctSuppliers(tenantId).then(names => setKnownSuppliers(names || []));
  }, [tenantId]);

  // Reset search state when item changes; fetch inventory item data if already linked
  useEffect(() => {
    setInvSearchQuery('');
    setInvResults([]);
    setInvDropdownOpen(false);
    setLinkedInvItem(null);
    setInvItemData(null);
    if (item?.inventory_item_id && tenantId) {
      fetchInventoryItemById(item.inventory_item_id, tenantId).then(d => setInvItemData(d || null));
    }
  }, [item?.id]);

  // Debounced inventory search
  useEffect(() => {
    clearTimeout(invDebounceTimer.current);
    if (!invSearchQuery || invSearchQuery.length < 2) {
      setInvResults([]);
      setInvDropdownOpen(false);
      return;
    }
    invDebounceTimer.current = setTimeout(async () => {
      setInvSearchLoading(true);
      const results = await searchInventoryItems(invSearchQuery, tenantId);
      setInvResults(results);
      setInvDropdownOpen(results.length > 0);
      setInvSearchLoading(false);
    }, 300);
    return () => clearTimeout(invDebounceTimer.current);
  }, [invSearchQuery, tenantId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!invDropdownOpen) return;
    const handler = (e) => {
      if (invSearchRef.current && !invSearchRef.current.contains(e.target)) {
        setInvDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [invDropdownOpen]);

  const handleInventoryLink = (invItem) => {
    // Derive category fields from inventory item's location/sub_location
    // inventory_items: location = department, sub_location = "Cat > SubCat > …"
    const subParts = invItem.sub_location ? invItem.sub_location.split(' > ') : [];
    const invDept = invItem.location || '';
    const invCategory = subParts[0] || '';
    const invSubCategory = invItem.sub_location || '';  // full path used as sub_category

    const updates = {
      inventory_item_id: invItem.id,
      cargo_item_id: invItem.cargo_item_id || '',
      barcode: invItem.barcode || '',
      name: invItem.name || form.name,
      brand: invItem.brand || form.brand,
      size: invItem.size || form.size,
      unit: invItem.unit || form.unit,
      // Category pull-through from inventory
      ...(invDept ? { department: invDept } : {}),
      ...(invCategory ? { category: invCategory } : {}),
      ...(invSubCategory ? { sub_category: invSubCategory } : {}),
      // Pre-fill estimated cost from inventory
      ...(invItem.unit_cost != null
        ? { estimated_unit_cost: invItem.unit_cost }
        : {}),
    };
    setForm(prev => ({ ...prev, ...updates }));
    setLinkedInvItem(invItem);
    setInvItemData(invItem);
    setInvSearchQuery('');
    setInvDropdownOpen(false);
    saveField(updates);
  };

  const handleInventoryUnlink = () => {
    const updates = { inventory_item_id: null, cargo_item_id: '', barcode: '' };
    setForm(prev => ({ ...prev, ...updates }));
    setLinkedInvItem(null);
    setInvItemData(null);
    saveField(updates);
  };

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
      status: base.status || 'draft',
      quantity_received: base.quantity_received !== '' ? parseFloat(base.quantity_received) : null,
      allergen_flags: base.allergen_flags || [],
      item_notes: base.item_notes || '',
      notes: base.notes || '',
      source: base.source || 'manual',
      accounting_description: base.accounting_description || '',
      supplier_id: base.supplier_id || null,
      supplier_name: base.supplier_name || null,
      port_location: base.port_location || '',
      inventory_item_id: base.inventory_item_id || null,
      cargo_item_id: base.cargo_item_id || '',
      barcode: base.barcode || '',
    };
  };

  const saveField = useCallback(async (overrides = {}) => {
    if (form.status === 'received') return; // received items are read-only
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

  // ── Dark-theme fallbacks (unchanged from previous version) ────────────────
  const inputCls = isLight
    ? 'idr-field'
    : 'w-full rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2]';
  const labelCls = isLight
    ? ''  // replaced by <FL> component
    : 'block text-[10px] font-semibold uppercase tracking-wider mb-1 text-[rgba(255,255,255,0.4)]';

  // ── Computed values ───────────────────────────────────────────────────────
  const activeCurrCode = form.currency || listCurrency || 'USD';
  const activeCurrSymbol = CURRENCY_PILLS.find(p => p.code === activeCurrCode)?.symbol || '$';
  const totalCost = (parseFloat(form.quantity_ordered) || 0) * (parseFloat(form.estimated_unit_cost) || 0);

  // Dept dropdown options — from board's departments list, fallback to PROVISION_CATEGORIES keys
  const deptOptions = departments && departments.length > 0
    ? departments
    : Object.keys(PROVISION_CATEGORIES);

  // Inventory category path from linked item's taxonomy fields (l1_name > l2_name > ...)
  const activeInvItem = invItemData || linkedInvItem;
  const invCategoryPath = activeInvItem
    ? [activeInvItem.l1_name, activeInvItem.l2_name, activeInvItem.l3_name, activeInvItem.l4_name]
        .filter(Boolean).join(' > ')
    : '';

  if (!open || !item) return null;

  const isLinked = !!form.inventory_item_id;
  const isReceived = form.status === 'received';
  // When received, all fields are read-only (layered on top of isLinked)
  const isReadOnly = isLinked || isReceived;

  return (
    <>
      {isLight && <style>{FIELD_CSS}</style>}
      <Drawer
        open={open}
        onClose={onClose}
        theme={theme}
        title={
          isLight ? (
            /* ── Mockup header title area ── */
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>Edit item</span>
              {savedFlash && (
                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }} className="animate-pulse">Saved</span>
              )}
              {!isNew && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: '#fca5a5', transition: 'color 0.15s', opacity: deleting ? 0.4 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = '#fca5a5'}
                >
                  <Icon name="Trash2" style={{ width: 14, height: 14 }} />
                </button>
              )}
            </div>
          ) : (
            /* ── Dark theme header (unchanged) ── */
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate">{form.name || 'Item Details'}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {savedFlash && <span className="text-xs font-normal text-green-400 animate-pulse">Saved</span>}
                {!isNew && (
                  <button onClick={handleDelete} disabled={deleting} className="p-1 rounded text-[#94A3B8] hover:text-red-500 transition-colors disabled:opacity-40">
                    <Icon name="Trash2" className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        }
      >
        <div style={{ paddingBottom: 32 }}>

          {/* ════ RECEIVED BANNER ════ */}
          {isReceived && isLight && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="CheckCircle" style={{ width: 14, height: 14, color: '#34D399', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#047857' }}>This item has been received</span>
              </div>
              {form.inventory_item_id && (
                <button
                  onClick={() => navigate(`/inventory/item/${form.inventory_item_id}`)}
                  style={{ fontSize: 11, color: '#4A90E2', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0, padding: 0 }}
                >
                  View in inventory →
                </button>
              )}
            </div>
          )}

          {/* ════ INVENTORY LINK ════ */}
          <div style={{ marginBottom: 16 }}>
            {isLinked ? (
              /* ── Linked banner ── */
              (() => {
                const stockLocs = Array.isArray(linkedInvItem?.stock_locations) ? linkedInvItem.stock_locations : [];
                const stockQty = linkedInvItem?.total_qty ?? null;
                // Build "Location: qty" pairs for the detail line
                const locParts = stockLocs
                  .filter(l => (l.qty ?? l.quantity ?? 0) > 0)
                  .map(l => {
                    const name = l.locationName || l.name || l.location || '?';
                    const qty = l.qty ?? l.quantity ?? 0;
                    return `${name}: ${qty}`;
                  });
                return (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>
                            Linked to: {form.name}
                          </span>
                          {form.cargo_item_id && (
                            <span style={{ fontSize: 11, fontWeight: 500, color: '#4ade80', background: '#dcfce7', borderRadius: 4, padding: '1px 6px' }}>
                              {form.cargo_item_id}
                            </span>
                          )}
                        </div>
                        {stockQty !== null && (
                          <p style={{ fontSize: 11, color: '#16a34a', margin: '3px 0 0' }}>
                            In stock: <strong>{stockQty}</strong>
                            {locParts.length > 0
                              ? ` (${locParts.join(', ')})`
                              : stockLocs.length > 0 ? ` across ${stockLocs.length} location${stockLocs.length !== 1 ? 's' : ''}` : ''}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={handleInventoryUnlink}
                        style={{ background: 'none', border: '1px solid #86efac', cursor: 'pointer', fontSize: 11, color: '#6b7280', padding: '2px 8px', borderRadius: 5, flexShrink: 0 }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#fca5a5'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#86efac'; }}
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              /* ── Search widget ── */
              <div ref={invSearchRef} style={{ position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    value={invSearchQuery}
                    onChange={e => setInvSearchQuery(e.target.value)}
                    placeholder="Start typing to find inventory item..."
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      fontSize: 13, padding: '8px 32px 8px 10px',
                      border: '1px solid #e2e8f0', borderRadius: 8,
                      background: '#f8fafc', color: '#1E3A5F', outline: 'none',
                      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4A90E2'; e.currentTarget.style.background = '#fff'; if (invResults.length > 0) setInvDropdownOpen(true); }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; }}
                  />
                  {invSearchLoading && (
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94a3b8' }}>…</span>
                  )}
                  {!invSearchLoading && invSearchQuery && (
                    <button
                      onMouseDown={e => { e.preventDefault(); setInvSearchQuery(''); setInvDropdownOpen(false); }}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, padding: 2 }}
                    >×</button>
                  )}
                </div>
                {invDropdownOpen && invResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: 4, overflow: 'hidden',
                  }}>
                    {invResults.map(inv => (
                      <button
                        key={inv.id}
                        onMouseDown={e => { e.preventDefault(); handleInventoryLink(inv); }}
                        style={{
                          width: '100%', textAlign: 'left', background: 'none', border: 'none',
                          padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                          display: 'flex', flexDirection: 'column', gap: 2,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1E3A5F' }}>{inv.name}</span>
                          {inv.cargo_item_id && (
                            <span style={{ fontSize: 10, color: '#818cf8', background: '#eff6ff', borderRadius: 3, padding: '0 5px', fontWeight: 600 }}>{inv.cargo_item_id}</span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          {[inv.brand, inv.size].filter(Boolean).join(' · ')}
                          {inv.total_qty != null && <span style={{ marginLeft: 8, color: '#16a34a' }}>stock: {inv.total_qty}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Status hint below search */}
                <div style={{ fontSize: 11, color: '#94a3b8', padding: '5px 2px', marginTop: 1 }}>
                  {invSearchQuery.length >= 2 && !invSearchLoading && invResults.length === 0
                    ? 'No items found — will create new inventory item on receive.'
                    : 'Not linked — will create a new inventory item on receive.'}
                </div>
              </div>
            )}
          </div>

          {/* ════ SECTION 1: IDENTITY ════ */}
          <div>
            <input
              value={form.name || ''}
              onChange={e => !isReadOnly && set('name', e.target.value)}
              onBlur={() => !isReadOnly && saveField()}
              readOnly={isReadOnly}
              placeholder={isLight ? 'Untitled item' : 'Item name'}
              style={isLight ? {
                width: '100%', fontSize: 22, fontWeight: 700,
                color: isReadOnly ? '#94a3b8' : '#1E3A5F', background: 'none', border: 'none',
                borderBottom: `2px solid ${isReadOnly ? '#e2e8f0' : '#4A90E2'}`, outline: 'none',
                padding: '4px 0 4px', display: 'block',
                fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
                cursor: isReadOnly ? 'default' : 'text',
              } : {}}
              className={!isLight ? 'w-full bg-transparent outline-none font-semibold pb-1.5 border-b border-white/10 text-white placeholder:text-white/25 focus:border-[#4A90E2] transition-colors' : ''}
            />
            {/* Brand */}
            <div style={{ marginTop: 16 }}>
              <Field isLight={isLight} labelCls={labelCls} label="Brand">
                <input
                  value={form.brand || ''}
                  onChange={e => !isReadOnly && set('brand', e.target.value)}
                  onBlur={() => !isReadOnly && saveField()}
                  readOnly={isReadOnly}
                  className={inputCls}
                  placeholder="e.g. Heinz, Maggi"
                  style={isReadOnly ? { opacity: 0.55, cursor: 'default' } : {}}
                />
              </Field>
            </div>
            {/* Barcode */}
            <div style={{ marginTop: 8 }}>
              <Field isLight={isLight} labelCls={labelCls} label="Barcode">
                <input
                  value={form.barcode || ''}
                  onChange={e => !isReadOnly && set('barcode', e.target.value)}
                  onBlur={() => !isReadOnly && saveField()}
                  readOnly={isReadOnly}
                  className={inputCls}
                  placeholder="Scan or enter barcode"
                  style={isReadOnly ? { opacity: 0.55, cursor: 'default' } : {}}
                />
              </Field>
            </div>
          </div>

          {/* ════ SECTION 2: MEASURE ════ */}
          <Section label="Measure">
            {isLight ? (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 8 }}>
                <div>
                  <FL>Size</FL>
                  <input
                    value={form.size || ''} onChange={e => !isReadOnly && set('size', e.target.value)}
                    onBlur={() => !isReadOnly && saveField()} readOnly={isReadOnly}
                    className="idr-field" placeholder="e.g. 500"
                    style={isReadOnly ? { opacity: 0.55, cursor: 'default' } : {}}
                  />
                </div>
                <div>
                  <FL>Unit</FL>
                  <select value={form.unit || 'each'} onChange={e => !isReadOnly && setAndSave('unit', e.target.value)} disabled={isReadOnly} className="idr-field" style={isReadOnly ? { opacity: 0.55 } : {}}>
                    {UNIT_GROUPS.map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map(u => <option key={u} value={u}>{u}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <FL>Qty</FL>
                  <input type="number" value={form.quantity_ordered ?? ''} onChange={e => set('quantity_ordered', e.target.value)} onBlur={() => saveField()} className="idr-field [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" min="0" step="0.1" />
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div style={{ flex: 2 }}>
                  <label className={labelCls}>Size</label>
                  <input value={form.size || ''} onChange={e => !isReadOnly && set('size', e.target.value)} onBlur={() => !isReadOnly && saveField()} readOnly={isReadOnly} className={inputCls} placeholder="e.g. 500" style={isReadOnly ? { opacity: 0.55 } : {}} />
                </div>
                <div style={{ flex: 2 }}>
                  <label className={labelCls}>Unit</label>
                  <select value={form.unit || 'each'} onChange={e => !isReadOnly && setAndSave('unit', e.target.value)} disabled={isReadOnly} className={inputCls} style={isReadOnly ? { opacity: 0.55 } : {}}>
                    {UNIT_GROUPS.map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map(u => <option key={u} value={u}>{u}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className={labelCls}>Qty</label>
                  <input type="number" value={form.quantity_ordered ?? ''} onChange={e => set('quantity_ordered', e.target.value)} onBlur={() => saveField()} className={`${inputCls} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} min="0" step="0.1" />
                </div>
              </div>
            )}
          </Section>

          {/* ════ SECTION 3: DEPARTMENT ════ */}
          <Section label="Department">
            {/* Department — always shown; determines board grouping */}
            <div>
              {isLight ? <FL>Department</FL> : <label className={labelCls}>Department</label>}
              <select
                value={form.department || ''}
                onChange={e => { set('department', e.target.value); saveField({ department: e.target.value }); }}
                disabled={isReadOnly}
                className={inputCls}
                style={{ cursor: isReadOnly ? 'default' : undefined }}
              >
                <option value="">— select —</option>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Supplier */}
            <div style={{ marginTop: 8 }}>
              <Field isLight={isLight} labelCls={labelCls} label="Supplier">
                <input
                  type="text"
                  list="supplier-suggestions"
                  value={form.supplier_name || ''}
                  onChange={e => set('supplier_name', e.target.value)}
                  onBlur={() => saveField()}
                  className={inputCls}
                  placeholder="e.g. Metro Cash & Carry"
                  disabled={isReadOnly}
                />
                {knownSuppliers.length > 0 && (
                  <datalist id="supplier-suggestions">
                    {knownSuppliers.map(s => <option key={s} value={s} />)}
                  </datalist>
                )}
              </Field>
            </div>

            {/* Port / Location */}
            <div style={{ marginTop: 8 }}>
              <Field isLight={isLight} labelCls={labelCls} label="Port / Location">
                <input
                  value={form.port_location || ''}
                  onChange={e => set('port_location', e.target.value)}
                  onBlur={() => saveField()}
                  className={inputCls}
                  placeholder="e.g. Palma, FR"
                />
              </Field>
            </div>
          </Section>

          {/* ════ SECTION 3b: INVENTORY CATEGORY (only when linked) ════ */}
          {form.inventory_item_id && (
            <Section label="Inventory">
              {invCategoryPath ? (
                <div style={{
                  fontSize: 13, color: isLight ? '#1E3A5F' : '#e2e8f0',
                  background: isLight ? '#f0fdf4' : 'rgba(29,158,117,0.1)',
                  border: `1px solid ${isLight ? '#86efac' : 'rgba(29,158,117,0.3)'}`,
                  borderRadius: 7, padding: '8px 12px', lineHeight: 1.5,
                }}>
                  {invCategoryPath.split(' > ').map((seg, i, arr) => (
                    <React.Fragment key={i}>
                      <span style={{ fontWeight: i === arr.length - 1 ? 600 : 400 }}>{seg}</span>
                      {i < arr.length - 1 && (
                        <span style={{ color: isLight ? '#86efac' : 'rgba(29,158,117,0.6)', margin: '0 5px' }}>›</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Category not set on linked item</p>
              )}
            </Section>
          )}

          {/* ════ SECTION 4: COST ════ */}
          <Section label={isReceived ? 'Quoted cost' : 'Estimated cost'}>
            {isLight ? (
              <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Currency toggle group */}
                <div style={{ display: 'flex', background: '#f8fafc', borderRadius: 6, flexShrink: 0 }}>
                  {CURRENCY_PILLS.map(pill => {
                    const active = activeCurrCode === pill.code;
                    return (
                      <button
                        key={pill.code}
                        type="button"
                        onClick={() => { setForm(prev => ({ ...prev, currency: pill.code })); saveField({ currency: pill.code }); }}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                          background: active ? '#1E3A5F' : 'transparent',
                          color: active ? '#ffffff' : '#cbd5e1',
                          transition: 'all 0.15s',
                        }}
                      >
                        {pill.symbol}
                      </button>
                    );
                  })}
                </div>
                {/* Cost input — #f8fafc unfocused */}
                <input
                  type="number"
                  value={form.estimated_unit_cost ?? ''}
                  onChange={e => set('estimated_unit_cost', e.target.value)}
                  onBlur={() => saveField()}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="idr-field idr-cost-input"
                  style={{ flex: 1 }}
                />
                {/* Total — inline italic */}
                {totalCost > 0 && (
                  <span style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    = {activeCurrSymbol}{totalCost.toFixed(2)} total
                  </span>
                )}
              </div>
              {/* "from inventory" cost hint */}
              {(() => {
                const invCost = linkedInvItem?.unit_cost;
                if (!isLinked || invCost == null) return null;
                const current = parseFloat(form.estimated_unit_cost);
                const differs = !isNaN(current) && Math.abs(current - invCost) > 0.001;
                return (
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                    {differs
                      ? `from inventory: ${activeCurrSymbol}${parseFloat(invCost).toFixed(2)} · you've overridden this`
                      : `from inventory: ${activeCurrSymbol}${parseFloat(invCost).toFixed(2)}`}
                  </p>
                );
              })()}
              </>
            ) : (
              /* Dark theme cost row (unchanged from previous version) */
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelCls}>Unit Cost</label>
                  <div className="flex items-center">
                    <div className="flex flex-shrink-0">
                      {CURRENCY_PILLS.map((pill, idx) => {
                        const active = activeCurrCode === pill.code;
                        const isFirst = idx === 0; const isLast = idx === CURRENCY_PILLS.length - 1;
                        return (
                          <button key={pill.code} type="button"
                            onClick={() => { setForm(prev => ({ ...prev, currency: pill.code })); saveField({ currency: pill.code }); }}
                            style={{ width: 32, height: 32, fontSize: 12, fontWeight: 600, background: active ? '#1E3A5F' : 'transparent', color: active ? '#ffffff' : '#64748B', border: '1px solid #E2E8F0', borderRight: isLast ? '1px solid #E2E8F0' : 'none', borderRadius: isFirst ? '8px 0 0 8px' : isLast ? '0 8px 8px 0' : '0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s, color 0.15s' }}
                          >{pill.symbol}</button>
                        );
                      })}
                    </div>
                    <input type="number" value={form.estimated_unit_cost ?? ''} onChange={e => set('estimated_unit_cost', e.target.value)} onBlur={() => saveField()} placeholder="0.00" min="0" step="0.01" style={{ borderRadius: '0 8px 8px 0', borderLeft: 'none' }} className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition-colors text-white bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2]" />
                  </div>
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Total</label>
                  <div className="rounded-lg px-3 flex items-center bg-white/5 border border-white/5" style={{ height: 36 }}>
                    <span className="text-sm tabular-nums text-[#94A3B8]">{totalCost > 0 ? `${activeCurrSymbol}${totalCost.toFixed(2)}` : '—'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Quantity received — non-pending only */}
            {form.status && form.status !== 'draft' && (
              <div style={{ marginTop: 12 }}>
                <Field isLight={isLight} labelCls={labelCls} label="Quantity Received">
                  <input type="number" value={form.quantity_received ?? ''} onChange={e => set('quantity_received', e.target.value)} onBlur={() => saveField()} className={inputCls} min="0" step="0.1" />
                </Field>
              </div>
            )}
          </Section>

          {/* ════ SECTION 5: FLAGS ════ */}
          <Section label="Flags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALLERGEN_OPTIONS.map(a => {
                const active = (form.allergen_flags || []).includes(a);
                return isLight ? (
                  <button
                    key={a}
                    onClick={() => toggleAllergen(a)}
                    style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                      cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
                      background: active ? '#fef3c7' : '#f8fafc',
                      borderColor: active ? '#fcd34d' : '#e2e8f0',
                      color: active ? '#92400e' : '#94a3b8',
                    }}
                  >{a}</button>
                ) : (
                  <button
                    key={a}
                    onClick={() => toggleAllergen(a)}
                    className={`px-2 py-1 text-xs rounded-full border transition-colors ${active ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
                  >{a}</button>
                );
              })}
            </div>
          </Section>

          {/* ════ SECTION 6: STATUS ════ */}
          <Section label="Status">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(ITEM_STATUS_CONFIG).map(([val, cfg]) => {
                const isActive = form.status === val;
                const s = STATUS_STYLES[val] || {};
                return isLight ? (
                  <button
                    key={val}
                    onClick={() => !isReceived && setAndSave('status', val)}
                    disabled={isReceived}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      cursor: isReceived ? 'default' : 'pointer', transition: 'all 0.15s', border: '1px solid',
                      background: isActive ? s.bg : 'transparent',
                      borderColor: isActive ? s.border : '#e2e8f0',
                      color: isActive ? s.color : '#94a3b8',
                      opacity: isReceived && !isActive ? 0.4 : 1,
                    }}
                  >{cfg.label}</button>
                ) : (
                  <button
                    key={val}
                    onClick={() => !isReceived && setAndSave('status', val)}
                    disabled={isReceived}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${isActive ? 'bg-[#4A90E2]/20 border-[#4A90E2]/50 text-[#4A90E2]' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ════ SECTION 6b: PAYMENT (received items only) ════ */}
          {isReceived && (
            <Section label="Payment">
              {isLight ? (
                <>
                  <FL>Payment status</FL>
                  <select
                    value={form.payment_status || 'awaiting_invoice'}
                    onChange={e => {
                      const val = e.target.value;
                      setForm(prev => ({ ...prev, payment_status: val }));
                      updateItemPaymentStatus(form.id, val, null).catch(() => {});
                    }}
                    style={{
                      width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0',
                      borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#1e293b',
                      outline: 'none', cursor: 'pointer',
                    }}
                  >
                    {PAYMENT_STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className={labelCls}>Payment status</label>
                  <select
                    value={form.payment_status || 'awaiting_invoice'}
                    onChange={e => {
                      const val = e.target.value;
                      setForm(prev => ({ ...prev, payment_status: val }));
                      updateItemPaymentStatus(form.id, val, null).catch(() => {});
                    }}
                    className={inputCls}
                  >
                    {PAYMENT_STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </>
              )}
            </Section>
          )}

          {/* ════ SECTION 7: NOTES ════ */}
          <Section label="Notes">
            {isLight ? <FL>Item notes (internal)</FL> : <span className={labelCls}>Item notes (internal)</span>}
            <textarea
              value={form.item_notes || ''}
              onChange={e => set('item_notes', e.target.value)}
              onBlur={() => saveField()}
              rows={3}
              className={inputCls}
              placeholder="Storage instructions, sourcing preferences, special requirements…"
            />
            <div style={{ marginTop: 8 }}>
              {isLight ? <FL>Order notes (visible to supplier)</FL> : <span className={labelCls}>Order notes (visible to supplier)</span>}
              <textarea
                value={form.notes || ''}
                onChange={e => set('notes', e.target.value)}
                onBlur={() => saveField()}
                rows={2}
                className={inputCls}
                placeholder="Special delivery instructions, substitutions accepted, etc."
              />
            </div>
          </Section>

          {/* Source badge — only when non-manual */}
          {form.source && form.source !== 'manual' && (
            <div style={{ marginTop: 8 }}>
              {isLight ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f8fafc', color: '#cbd5e1', fontSize: 10, borderRadius: 4, padding: '2px 6px', fontWeight: 500 }}>
                  ✦ {SOURCE_LABELS[form.source] || form.source}
                </span>
              ) : (
                <span style={{ display: 'inline-block', background: 'rgba(0,0,0,0.05)', color: '#94A3B8', fontSize: 10, padding: '2px 8px', borderRadius: 10 }}>
                  {SOURCE_LABELS[form.source] || form.source}
                </span>
              )}
            </div>
          )}

          {/* ════ SECTION 9: ACCOUNTING (COMMAND / CHIEF only) ════ */}
          {canViewAccounting && (
            isLight ? (
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginTop: 20 }}>
                <button
                  onClick={() => setAccountingOpen(v => !v)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', cursor: 'pointer', padding: '2px 0', background: 'none', border: 'none' }}
                >
                  <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 500 }}>Accounting</span>
                  <span style={{ fontSize: 10, color: '#e2e8f0', display: 'inline-block', transform: accountingOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>▾</span>
                </button>
                {accountingOpen && (
                  <div style={{ marginTop: 10 }}>
                    <input value={form.accounting_description || ''} onChange={e => set('accounting_description', e.target.value)} onBlur={() => saveField()} className="idr-field" placeholder="e.g. food and beverage, guest entertainment, maintenance supplies" />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid #F1F5F9' }}>
                <button onClick={() => setAccountingOpen(v => !v)} className="w-full flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase text-[#94A3B8]" style={{ letterSpacing: '0.1em' }}>Accounting</span>
                  <Icon name={accountingOpen ? 'ChevronUp' : 'ChevronDown'} className="w-3.5 h-3.5 text-[#94A3B8]" />
                </button>
                {accountingOpen && (
                  <div className="mt-2">
                    <input value={form.accounting_description || ''} onChange={e => set('accounting_description', e.target.value)} onBlur={() => saveField()} className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2] transition-colors" placeholder="e.g. food and beverage, guest entertainment, maintenance supplies" />
                  </div>
                )}
              </div>
            )
          )}

        </div>
      </Drawer>
    </>
  );
};

export default ItemDrawer;
