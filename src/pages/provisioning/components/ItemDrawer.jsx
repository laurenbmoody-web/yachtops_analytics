import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { HelpHint, HelpHintBuckets } from '../../../components/editorial';
import Drawer from './Drawer';
import SupplierPicker from './SupplierPicker';
import { ITEM_STATUS_CONFIG, ITEM_STATUS_ORDER } from '../data/statusConfig';
import {
  upsertItems,
  deleteProvisioningItem,
  fetchAllInventoryLocations,
  fetchVendors,
  searchInventoryItems,
  fetchInventoryItemById,
  updateItemPaymentStatus,
  PROVISION_CATEGORIES,
} from '../utils/provisioningStorage';
import { PAYMENT_STATUS_OPTIONS } from './InvoiceUploadModal';
import { showToast } from '../../../utils/toast';
import { STOCK_UNIT_GROUPS, STOCK_UNIT_VALUES, BOUGHT_BY_GROUPS } from '../../../data/unitGroups';
import { UNIT_GROUP_VALUES, normalizeUnit, isBulkUnit } from '../../../data/unitGroups';
import { useAuth } from '../../../contexts/AuthContext';
import '../provisioning-dashboard.css';
import './item-drawer.css';

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

// (STATUS_STYLES was a duplicate per-status palette; deleted in phase 3
// commit 5. The cool-surface .idr-status-pill rules in item-drawer.css
// now own the visual treatment via --d-status-* tokens.)

// ── Field label + child wrapper — defined at module level to avoid remount ───
const Field = ({ isLight, labelCls, label, children }) => (
  <div>
    {isLight ? (
      <span className="idr-field-label">{label}</span>
    ) : (
      <label className={labelCls}>{label}</label>
    )}
    {children}
  </div>
);

// ── Section wrapper — light branch = white card on cool ground; dark
//    branch keeps the prior padding-only chrome (unchanged dead-code
//    fallback per the brief's "don't touch dark"). ───────────────────────────
const Section = ({ isLight, label, children }) => (
  isLight ? (
    <div className="idr-section">
      {label && <p className="idr-section-label">{label}</p>}
      {children}
    </div>
  ) : (
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
  )
);

// ── Field sub-label (inside sections, light branch only) ─────────────────────
const FL = ({ children }) => (
  <span className="idr-field-label">{children}</span>
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

// FIELD_CSS template removed — .idr-field styles now live in
// ./item-drawer.css. Was injected at runtime via <style>{FIELD_CSS}</style>.

// ─────────────────────────────────────────────────────────────────────────────

const ItemDrawer = ({ open, item, listId, tenantId, listCurrency = 'GBP', departments = [], theme = 'dark', readOnly = false, onSaved, onDeleted, onClose }) => {
  const isLight = theme === 'light';
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const userTier = (tenantRole || '').toUpperCase();
  const canViewAccounting = ['COMMAND', 'CHIEF'].includes(userTier);
  // Lock every input + the save / delete affordances when readOnly is
  // true. Caller passes this from the kanban when the item already
  // lives inside a supplier_order (the chief should never silently
  // edit qty / unit / size / brand / cost on a sent line). To make
  // changes, they open the board and use the inline editors on still-
  // pending lines or the ↺ Reopen flow on committed ones.

  const [form, setForm] = useState({});
  const [allCategoryPaths, setAllCategoryPaths] = useState([]);
  // Sprint 9c.3 Phase 8 — structured supplier picker (supplier_profiles).
  const [supplierProfiles, setSupplierProfiles] = useState([]);
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
        purchase_unit: item.purchase_unit || '',
        units_per_pack: item.units_per_pack ?? '',
        estimated_unit_cost: item.estimated_unit_cost || '',
        currency: item.currency || null,
        status: item.status || 'draft',
        quantity_received: item.quantity_received ?? '',
        returns_qty: item.returns_qty ?? 0,
        allergen_flags: item.allergen_flags || [],
        item_notes: item.item_notes || '',
        notes: item.notes || '',
        source: item.source || 'manual',
        accounting_description: item.accounting_description || '',
        supplier_id: item.supplier_id || '',
        supplier_profile_id: item.supplier_profile_id || '',
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
  }, [tenantId]);

  // Active (non-archived) supplier_profiles for the structured picker.
  // One query when the drawer opens; refreshed on reopen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchVendors().then(({ data }) => {
      if (!cancelled) setSupplierProfiles(data || []);
    });
    return () => { cancelled = true; };
  }, [open]);

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
    // Core fields — always present (original schema columns)
    const payload = {
      ...(isNew ? {} : { id: item.id }),
      list_id: listId,
      ...(isNew && tenantId ? { tenant_id: tenantId } : {}),
      name: base.name?.trim() || '',
      department: base.department || '',
      category: base.category || '',
      quantity_ordered: parseFloat(base.quantity_ordered) || 1,
      unit: base.unit || 'each',
      status: base.status || 'draft',
      allergen_flags: base.allergen_flags || [],
      notes: base.notes || '',
      source: base.source || 'manual',
    };
    // Extended fields — only included when they have a value, so a missing
    // DB column on the field doesn't break the upsert for other fields.
    const ext = {
      brand:                  base.brand               || null,
      size:                   base.size                || null,
      purchase_unit:          base.purchase_unit ? normalizeUnit(base.purchase_unit) : null,
      units_per_pack:         base.purchase_unit && base.units_per_pack ? parseInt(base.units_per_pack, 10) || null : null,
      sub_category:           base.sub_category        || null,
      estimated_unit_cost:    base.estimated_unit_cost ? parseFloat(base.estimated_unit_cost) : null,
      currency:               base.currency            || null,
      quantity_received:      base.quantity_received !== '' ? parseFloat(base.quantity_received) : null,
      returns_qty:            base.returns_qty != null ? parseFloat(base.returns_qty) || 0 : 0,
      item_notes:             base.item_notes          || null,
      accounting_description: base.accounting_description || null,
      supplier_id:            base.supplier_id         || null,
      supplier_profile_id:    base.supplier_profile_id || null,
      supplier_name:          base.supplier_name       || null,
      port_location:          base.port_location       || null,
      inventory_item_id:      base.inventory_item_id   || null,
      cargo_item_id:          base.cargo_item_id       || null,
      barcode:                base.barcode             || null,
    };
    // Include extended fields that have a non-null value
    Object.entries(ext).forEach(([k, v]) => { if (v !== null && v !== undefined) payload[k] = v; });
    // Marketplace/catalogue lines: the supplier's product definition is
    // authoritative — force those fields back to the original values so
    // drawer edits can't drift them. Qty, notes etc. save normally.
    if (item?.catalogue_item_id) {
      ['name', 'brand', 'size', 'unit', 'purchase_unit', 'units_per_pack', 'category', 'sub_category', 'estimated_unit_cost', 'currency']
        .forEach((k) => { if (item[k] !== undefined && item[k] !== null) payload[k] = item[k]; });
    }
    return payload;
  };

  const saveField = async (overrides = {}) => {
    if (form.status === 'received') return; // received items are read-only
    if (!form.name?.trim() && !overrides.name?.trim()) return;
    try {
      const saved = await upsertItems([buildPayload(overrides)]);
      onSaved(listId, saved);
      showSaved();
    } catch (err) {
      console.error('[ItemDrawer] save error:', err);
      const msg = err?.message || 'Unknown error';
      showToast(`Save failed: ${msg}`, 'error');
    }
  };

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const setAndSave = (key, val) => {
    const updated = { [key]: val };
    setForm(prev => ({ ...prev, ...updated }));
    saveField(updated);
  };

  // Structured supplier pick: persist the FK + mirror the resolved
  // name into supplier_name (back-compat / display fallback). Pass
  // null to clear. Both fields saved atomically.
  const chooseSupplier = (profile) => {
    const updated = profile
      ? { supplier_profile_id: profile.id, supplier_name: profile.name || '' }
      : { supplier_profile_id: '', supplier_name: '' };
    setForm(prev => ({ ...prev, ...updated }));
    saveField(updated);
  };

  const toggleAllergen = (a) => {
    const flags = (form.allergen_flags || []).includes(a)
      ? (form.allergen_flags || []).filter(x => x !== a)
      : [...(form.allergen_flags || []), a];
    setAndSave('allergen_flags', flags);
  };

  const handleSave = async () => {
    await saveField();
    onClose();
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
  // Marketplace lines: the supplier's product definition is authoritative
  // — identity fields lock exactly like inventory-linked items do.
  const isCatalogue = !!(form.catalogue_item_id || item?.catalogue_item_id);
  // When received, all fields are read-only (layered on top of isLinked)
  const isReadOnly = isLinked || isReceived || isCatalogue;

  // Dirty signal — any form field differs from the loaded item (same
  // fallbacks the hydrate effect uses). Field-level autosave keeps `item`
  // in sync after each save; the predicate goes back to false once the
  // parent re-renders with the saved values, so a partially-saved drawer
  // closes cleanly between keystrokes and prompts during in-flight saves.
  const itemBaseline = item ? {
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
    returns_qty: item.returns_qty ?? 0,
    allergen_flags: item.allergen_flags || [],
    item_notes: item.item_notes || '',
    notes: item.notes || '',
    source: item.source || 'manual',
    accounting_description: item.accounting_description || '',
    supplier_id: item.supplier_id || '',
    supplier_profile_id: item.supplier_profile_id || '',
    supplier_name: item.supplier_name || '',
    port_location: item.port_location || '',
    inventory_item_id: item.inventory_item_id || null,
    cargo_item_id: item.cargo_item_id || '',
    barcode: item.barcode || '',
  } : null;
  const isDirty = !!itemBaseline && Object.keys(itemBaseline).some(k => {
    const a = form[k]; const b = itemBaseline[k];
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) !== JSON.stringify(b || []);
    return a !== b;
  });

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        isDirty={isDirty}
        isBusy={deleting}
        theme={theme}
        panelClassName={isLight ? 'pv-dashboard idr' : ''}
        panelBg={isLight ? 'var(--d-bg)' : undefined}
        title={
          isLight ? (
            /* ── Light header title area ── */
            <div className="idr-header">
              <span className="idr-header-eyebrow">Edit item</span>
              {savedFlash && (
                <span className="idr-header-saved animate-pulse">Saved</span>
              )}
              {!isNew && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="idr-header-delete"
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
                  <button onClick={handleDelete} disabled={deleting || readOnly} title={readOnly ? 'Locked — item is on a supplier order. Open the board to reopen the line.' : undefined} className="p-1 rounded text-[#94A3B8] hover:text-red-500 transition-colors disabled:opacity-40">
                    <Icon name="Trash2" className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        }
        footer={
          isLight ? (
            <div className="idr-footer">
              <button onClick={onClose} className="idr-btn idr-btn-ghost">{readOnly ? 'Close' : 'Cancel'}</button>
              {!isReceived && !readOnly && (
                <button
                  onClick={handleSave}
                  disabled={!form.name?.trim()}
                  className="idr-btn idr-btn-primary"
                >
                  {isNew ? 'Add item' : 'Save'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 16px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 18px', fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.08)', color: '#94a3b8',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                Cancel
              </button>
              {!isReceived && (
                <button
                  onClick={handleSave}
                  style={{
                    padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                    background: '#1E3A5F', color: '#ffffff', border: 'none',
                    opacity: !form.name?.trim() ? 0.45 : 1,
                  }}
                >
                  {isNew ? 'Add item' : 'Save'}
                </button>
              )}
            </div>
          )
        }
      >
        <div className={isLight ? 'idr-body' : ''} style={isLight ? null : { paddingBottom: 8 }}>

          {/* ════ READ-ONLY BANNER ════ */}
          {readOnly && isLight && (
            <div style={{
              margin: '0 0 16px',
              padding: '12px 14px',
              background: '#FAFAF8',
              border: '1px solid #ECEAE3',
              borderLeft: '3px solid #C65A1A',
              borderRadius: 8,
              fontSize: 13,
              color: '#1C1B3A',
              lineHeight: 1.5,
            }}>
              <strong style={{
                fontFamily: "'DM Serif Display', 'DM Serif Text', Georgia, serif",
                fontWeight: 400,
                fontStyle: 'italic',
                color: '#C65A1A',
                fontSize: 14.5,
                marginRight: 4,
              }}>Locked.</strong>
              This item is on a supplier order. To revise it, open the board and use the ↺ Reopen action on the line.
            </div>
          )}

          {/* When readOnly, wrap the form content in a disabled
              fieldset — every input, select, textarea, and form-
              control button inside goes inert. The Close button in
              the footer sits outside this scope so the chief can
              still close. */}
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>

          {/* ════ RECEIVED BANNER ════ */}
          {isReceived && isLight && (
            <div className="idr-banner">
              <div className="idr-banner-row">
                <div className="idr-banner-row-left">
                  <Icon name="CheckCircle" className="idr-banner-icon" style={{ width: 14, height: 14 }} />
                  <span className="idr-banner-text">This item has been received</span>
                </div>
                {form.inventory_item_id && (
                  <button
                    onClick={() => navigate(`/inventory/item/${form.inventory_item_id}`)}
                    className="idr-banner-link"
                  >
                    View in inventory →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ════ INVENTORY LINK ════ */}
          <div>
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
                return isLight ? (
                  <div className="idr-banner">
                    <div className="idr-banner-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="idr-linked-head">
                          <span className="idr-linked-title">Linked to: {form.name}</span>
                          {form.cargo_item_id && (
                            <span className="idr-linked-cargo">{form.cargo_item_id}</span>
                          )}
                        </div>
                        {stockQty !== null && (
                          <p className="idr-linked-stock">
                            In stock: <strong>{stockQty}</strong>
                            {locParts.length > 0
                              ? ` (${locParts.join(', ')})`
                              : stockLocs.length > 0 ? ` across ${stockLocs.length} location${stockLocs.length !== 1 ? 's' : ''}` : ''}
                          </p>
                        )}
                      </div>
                      <button onClick={handleInventoryUnlink} className="idr-linked-unlink">
                        Unlink
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Dark-theme linked banner — preserved verbatim */
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
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : isLight ? (
              /* ── Search widget (light) — wrapped in a white card on the cool ground ── */
              <div ref={invSearchRef} className="idr-invsearch">
                <div className="idr-invsearch-wrap">
                  <input
                    value={invSearchQuery}
                    onChange={e => setInvSearchQuery(e.target.value)}
                    placeholder="Start typing to find inventory item..."
                    className="idr-invsearch-input"
                    onFocus={() => { if (invResults.length > 0) setInvDropdownOpen(true); }}
                  />
                  {invSearchLoading && (
                    <span className="idr-invsearch-loading">…</span>
                  )}
                  {!invSearchLoading && invSearchQuery && (
                    <button
                      onMouseDown={e => { e.preventDefault(); setInvSearchQuery(''); setInvDropdownOpen(false); }}
                      className="idr-invsearch-clear"
                    >×</button>
                  )}
                </div>
                {invDropdownOpen && invResults.length > 0 && (
                  <div className="idr-invsearch-dropdown">
                    {invResults.map(inv => (
                      <button
                        key={inv.id}
                        onMouseDown={e => { e.preventDefault(); handleInventoryLink(inv); }}
                        className="idr-invsearch-result"
                      >
                        <div className="idr-invsearch-result-head">
                          <span className="idr-invsearch-result-name">{inv.name}</span>
                          {inv.cargo_item_id && (
                            <span className="idr-invsearch-result-cargo">{inv.cargo_item_id}</span>
                          )}
                        </div>
                        <span className="idr-invsearch-result-meta">
                          {[inv.brand, inv.size].filter(Boolean).join(' · ')}
                          {inv.total_qty != null && <span className="idr-invsearch-result-stock">stock: {inv.total_qty}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Status hint below search */}
                <div className="idr-invsearch-helper">
                  {invSearchQuery.length >= 2 && !invSearchLoading && invResults.length === 0
                    ? 'No items found — will create new inventory item on receive.'
                    : 'Not linked — will create a new inventory item on receive.'}
                </div>
              </div>
            ) : (
              /* ── Search widget (dark) — preserved verbatim ── */
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
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 'var(--z-dropdown)',
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
                <div style={{ fontSize: 11, color: '#94a3b8', padding: '5px 2px', marginTop: 1 }}>
                  {invSearchQuery.length >= 2 && !invSearchLoading && invResults.length === 0
                    ? 'No items found — will create new inventory item on receive.'
                    : 'Not linked — will create a new inventory item on receive.'}
                </div>
              </div>
            )}
          </div>

          {/* ════ SECTION 1: IDENTITY ════ */}
          <div className={isLight ? 'idr-identity' : ''}>
            <input
              value={form.name || ''}
              onChange={e => !isReadOnly && set('name', e.target.value)}
              onBlur={() => !isReadOnly && saveField()}
              readOnly={isReadOnly}
              placeholder={isLight ? 'Untitled item' : 'Item name'}
              className={isLight
                ? 'idr-name-input'
                : 'w-full bg-transparent outline-none font-semibold pb-1.5 border-b border-white/10 text-white placeholder:text-white/25 focus:border-[#4A90E2] transition-colors'}
            />
            <div className={isLight ? 'idr-identity-fields' : ''}>
              {/* Brand */}
              <div style={isLight ? null : { marginTop: 16 }}>
                <Field isLight={isLight} labelCls={labelCls} label="Brand">
                  <input
                    value={form.brand || ''}
                    onChange={e => !isReadOnly && set('brand', e.target.value)}
                    onBlur={() => !isReadOnly && saveField()}
                    readOnly={isReadOnly}
                    className={inputCls}
                    placeholder="e.g. Heinz, Maggi"
                  />
                </Field>
              </div>
              {/* Barcode */}
              <div style={isLight ? null : { marginTop: 8 }}>
                <Field isLight={isLight} labelCls={labelCls} label="Barcode">
                  <input
                    value={form.barcode || ''}
                    onChange={e => !isReadOnly && set('barcode', e.target.value)}
                    onBlur={() => !isReadOnly && saveField()}
                    readOnly={isReadOnly}
                    className={inputCls}
                    placeholder="Scan or enter barcode"
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* ════ SECTION 2: MEASURE ════ */}
          <Section isLight={isLight} label="Measure">
            {isLight ? (
              <div className="idr-measure-grid">
                <div>
                  <FL>Size</FL>
                  <input
                    value={form.size || ''} onChange={e => !isReadOnly && set('size', e.target.value)}
                    onBlur={() => !isReadOnly && saveField()} readOnly={isReadOnly}
                    className="idr-field" placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <FL>Unit</FL>
                  <select value={STOCK_UNIT_VALUES.has(normalizeUnit(form.unit)) ? normalizeUnit(form.unit) : (form.unit || 'each')} onChange={e => !isReadOnly && setAndSave('unit', e.target.value)} disabled={isReadOnly} className="idr-field">
                    {form.unit && !STOCK_UNIT_VALUES.has(normalizeUnit(form.unit)) && <option value={form.unit}>{form.unit}</option>}
                    {STOCK_UNIT_GROUPS.map(g => (
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
                  <select value={STOCK_UNIT_VALUES.has(normalizeUnit(form.unit)) ? normalizeUnit(form.unit) : (form.unit || 'each')} onChange={e => !isReadOnly && setAndSave('unit', e.target.value)} disabled={isReadOnly} className={inputCls} style={isReadOnly ? { opacity: 0.55 } : {}}>
                    {form.unit && !STOCK_UNIT_VALUES.has(normalizeUnit(form.unit)) && <option value={form.unit}>{form.unit}</option>}
                    {STOCK_UNIT_GROUPS.map(g => (
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

            {/* Bought by — the pack model. `Unit` above is the BASE unit you
                stock/count (bottle). If you buy it by the case/pack, set that
                here + how many base units it holds. Ordering is in this pack;
                receive expands it into base units and stocks in the base unit. */}
            <div className="idr-pack-break">
              {isLight ? <FL>Bought in <span className="opt">optional</span></FL> : <label className={labelCls}>Bought in (optional)</label>}
              <div className="idr-pack-row">
                <select
                  value={UNIT_GROUP_VALUES.has(normalizeUnit(form.purchase_unit)) ? normalizeUnit(form.purchase_unit) : (form.purchase_unit || '')}
                  onChange={e => !isReadOnly && setAndSave('purchase_unit', e.target.value)}
                  disabled={isReadOnly}
                  className="idr-field"
                >
                  <option value="">— sold loose —</option>
                  {form.purchase_unit && !UNIT_GROUP_VALUES.has(normalizeUnit(form.purchase_unit)) && <option value={form.purchase_unit}>{form.purchase_unit}</option>}
                  {BOUGHT_BY_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
                </select>
                {form.purchase_unit && (
                  <>
                    <span className="idr-pack-lead">holds</span>
                    <input
                      type="number" min="1" step="1"
                      value={form.units_per_pack ?? ''}
                      onChange={e => !isReadOnly && set('units_per_pack', e.target.value)}
                      onBlur={() => !isReadOnly && saveField()}
                      readOnly={isReadOnly}
                      className="idr-field idr-pack-count"
                      placeholder="e.g. 24"
                    />
                    <span className="idr-pack-lead">
                      × {form.size?.trim() ? form.size : <em className="idr-pack-inner-hint">size</em>} {normalizeUnit(form.unit) || 'each'}
                    </span>
                  </>
                )}
              </div>
              {form.purchase_unit && Number(form.units_per_pack) > 1 && (
                <p className="idr-pack-total">
                  {(() => {
                    const per = parseInt(form.units_per_pack, 10) || 0;
                    const pu = normalizeUnit(form.purchase_unit);
                    const bu = normalizeUnit(form.unit) || 'each';
                    const inner = form.size?.trim() ? ` × ${form.size}` : '';
                    return `1 ${pu} = ${per}${inner} ${bu}${per === 1 ? '' : 's'}`;
                  })()}
                </p>
              )}
            </div>
          </Section>

          {/* ════ SECTION 3: DEPARTMENT ════ */}
          <Section isLight={isLight} label="Department">
            <div className={isLight ? 'idr-field-stack' : ''}>
              {/* Department — always shown; determines board grouping */}
              <div>
                {isLight ? <FL>Department</FL> : <label className={labelCls}>Department</label>}
                <select
                  value={form.department || ''}
                  onChange={e => { set('department', e.target.value); saveField({ department: e.target.value }); }}
                  disabled={isReadOnly}
                  className={inputCls}
                >
                  <option value="">— select —</option>
                  {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Supplier — shared structured picker over supplier_profiles */}
              <div style={isLight ? null : { marginTop: 8 }}>
                <Field isLight={isLight} labelCls={labelCls} label="Supplier">
                  <SupplierPicker
                    value={form.supplier_profile_id || ''}
                    suppliers={supplierProfiles}
                    disabled={isReadOnly}
                    inputClassName={inputCls}
                    onChange={chooseSupplier}
                  />
                </Field>
              </div>

              {/* Port / Location */}
              <div style={isLight ? null : { marginTop: 8 }}>
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
            </div>
          </Section>

          {/* ════ SECTION 3b: INVENTORY CATEGORY (only when linked) ════ */}
          {form.inventory_item_id && (
            <Section isLight={isLight} label="Inventory">
              {invCategoryPath ? (
                isLight ? (
                  <div className="idr-inv-category">
                    {invCategoryPath.split(' > ').map((seg, i, arr) => (
                      <React.Fragment key={i}>
                        <span className={`idr-inv-category-seg${i === arr.length - 1 ? ' is-last' : ''}`}>{seg}</span>
                        {i < arr.length - 1 && (
                          <span className="idr-inv-category-sep">›</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                ) : (
                  /* Dark-theme inventory category — preserved verbatim */
                  <div style={{
                    fontSize: 13, color: '#e2e8f0',
                    background: 'rgba(29,158,117,0.1)',
                    border: '1px solid rgba(29,158,117,0.3)',
                    borderRadius: 7, padding: '8px 12px', lineHeight: 1.5,
                  }}>
                    {invCategoryPath.split(' > ').map((seg, i, arr) => (
                      <React.Fragment key={i}>
                        <span style={{ fontWeight: i === arr.length - 1 ? 600 : 400 }}>{seg}</span>
                        {i < arr.length - 1 && (
                          <span style={{ color: 'rgba(29,158,117,0.6)', margin: '0 5px' }}>›</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )
              ) : (
                isLight
                  ? <p className="idr-inv-category-empty">Category not set on linked item</p>
                  : <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Category not set on linked item</p>
              )}
            </Section>
          )}

          {/* ════ SECTION 4: COST ════ */}
          <Section isLight={isLight} label={isReceived ? 'Quoted cost' : 'Estimated cost'}>
            {isLight ? (
              <>
              <div className="idr-cost-row">
                {/* Currency toggle group */}
                <div className="idr-currency-group">
                  {CURRENCY_PILLS.map(pill => {
                    const active = activeCurrCode === pill.code;
                    return (
                      <button
                        key={pill.code}
                        type="button"
                        onClick={() => { setForm(prev => ({ ...prev, currency: pill.code })); saveField({ currency: pill.code }); }}
                        className={`idr-currency-pill${active ? ' is-active' : ''}`}
                      >
                        {pill.symbol}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="number"
                  value={form.estimated_unit_cost ?? ''}
                  onChange={e => !isCatalogue && set('estimated_unit_cost', e.target.value)}
                  readOnly={isCatalogue}
                  onBlur={() => saveField()}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="idr-cost-input"
                />
                {totalCost > 0 && (
                  <span className="idr-cost-total">
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
                  <p className="idr-cost-hint">
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
                    <input type="number" value={form.estimated_unit_cost ?? ''} onChange={e => !isCatalogue && set('estimated_unit_cost', e.target.value)} readOnly={isCatalogue} onBlur={() => saveField()} placeholder="0.00" min="0" step="0.01" style={{ borderRadius: '0 8px 8px 0', borderLeft: 'none' }} className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition-colors text-white bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] focus:border-[#4A90E2]" />
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
          <Section isLight={isLight} label="Flags">
            <div className={isLight ? 'idr-pill-row' : ''} style={isLight ? null : { display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALLERGEN_OPTIONS.map(a => {
                const active = (form.allergen_flags || []).includes(a);
                return isLight ? (
                  <button
                    key={a}
                    onClick={() => toggleAllergen(a)}
                    className={`idr-allergen-pill${active ? ' is-active' : ''}`}
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
          <Section isLight={isLight} label="Status">
            <div className={isLight ? 'idr-pill-row' : ''} style={isLight ? null : { display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {/* Iterate ITEM_STATUS_ORDER (picker source — 6 crew-controllable
                  states), NOT Object.entries(ITEM_STATUS_CONFIG) which would
                  surface the derive-only states (confirmed / unavailable /
                  substituted / invoiced / paid / partially_returned). Those
                  are set by the supplier portal and the invoice flow, not by
                  crew picking from this drawer. */}
              {ITEM_STATUS_ORDER.map((val) => {
                const cfg = ITEM_STATUS_CONFIG[val];
                const isActive = form.status === val;
                // hyphenate val ('not_received' -> 'not-received') for the CSS class modifier
                const statusMod = val.replace(/_/g, '-');
                return isLight ? (
                  <button
                    key={val}
                    onClick={() => !isReceived && setAndSave('status', val)}
                    disabled={isReceived}
                    className={`idr-status-pill is-${statusMod}${isActive ? ' is-active' : ''}`}
                  >{cfg.label}</button>
                ) : (
                  <button
                    key={val}
                    onClick={() => !isReceived && setAndSave('status', val)}
                    disabled={isReceived}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${isActive ? 'bg-[#4A90E2]/20 border-[#4A90E2]/50 text-[#4A90E2]' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClassName}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ════ SECTION 6b: PAYMENT (received items only) ════ */}
          {isReceived && (
            <Section isLight={isLight} label="Payment">
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
                    className="idr-field"
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

          {/* ════ SECTION 6c: RETURNS (received items only) ════ */}
          {/* Lets a stew record a partial or full return after receipt.
              returns_qty stored as a numeric on provisioning_items (schema
              migration 20260610130000). CHECK constraint enforces
              0 <= returns_qty <= quantity_received. When returns_qty
              reaches quantity_received, status auto-flips to 'returned';
              partial returns stay at the underlying status (received or
              partial) and the derive function surfaces them as
              'partially returned' on the unified pill. */}
          {isReceived && parseFloat(form.quantity_received) > 0 && (
            <Section isLight={isLight} label="Returns">
              {isLight ? (
                <>
                  <div className="idr-cost-row">
                    <Field isLight={isLight} labelCls={labelCls} label="Qty returned">
                      <input
                        type="number"
                        value={form.returns_qty ?? 0}
                        min="0"
                        step="0.1"
                        max={parseFloat(form.quantity_received) || 0}
                        onChange={e => {
                          const raw = e.target.value;
                          const val = raw === '' ? 0 : parseFloat(raw);
                          const received = parseFloat(form.quantity_received) || 0;
                          if (isNaN(val) || val < 0) return;
                          const clamped = Math.min(val, received);
                          set('returns_qty', clamped);
                          // Auto-flip status to 'returned' on full return.
                          // Partial returns (clamped > 0 && < received)
                          // leave status untouched — the derive layer
                          // surfaces them as 'partially returned' on the
                          // pill via the returns_qty signal.
                          if (clamped >= received && received > 0) {
                            set('status', 'returned');
                          } else if (form.status === 'returned' && clamped < received) {
                            // Backed off from full return — revert to received.
                            set('status', 'received');
                          }
                        }}
                        onBlur={() => saveField()}
                        className={inputCls}
                      />
                    </Field>
                    <Field isLight={isLight} labelCls={labelCls} label="Kept">
                      <input
                        type="number"
                        value={Math.max(0, (parseFloat(form.quantity_received) || 0) - (parseFloat(form.returns_qty) || 0))}
                        readOnly
                        tabIndex={-1}
                        className={inputCls}
                        style={{ opacity: 0.7, cursor: 'default' }}
                      />
                    </Field>
                  </div>
                  {parseFloat(form.returns_qty) > 0 && parseFloat(form.returns_qty) < parseFloat(form.quantity_received) && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#C2410C', fontStyle: 'italic' }}>
                      Partial return — pill renders as "Partially returned" on the items table and kanban.
                    </p>
                  )}
                </>
              ) : (
                <Field isLight={isLight} labelCls={labelCls} label="Qty returned">
                  <input
                    type="number"
                    value={form.returns_qty ?? 0}
                    min="0"
                    step="0.1"
                    max={parseFloat(form.quantity_received) || 0}
                    onChange={e => {
                      const raw = e.target.value;
                      const val = raw === '' ? 0 : parseFloat(raw);
                      const received = parseFloat(form.quantity_received) || 0;
                      if (isNaN(val) || val < 0) return;
                      const clamped = Math.min(val, received);
                      set('returns_qty', clamped);
                      if (clamped >= received && received > 0) set('status', 'returned');
                      else if (form.status === 'returned' && clamped < received) set('status', 'received');
                    }}
                    onBlur={() => saveField()}
                    className={inputCls}
                  />
                </Field>
              )}
            </Section>
          )}

          {/* ════ SECTION 7: NOTES ════ */}
          <Section isLight={isLight} label="Notes">
            <div className={isLight ? 'idr-field-stack' : ''}>
              <div>
                {isLight ? <FL>Item notes (internal)</FL> : <span className={labelCls}>Item notes (internal)</span>}
                <textarea
                  value={form.item_notes || ''}
                  onChange={e => set('item_notes', e.target.value)}
                  onBlur={() => saveField()}
                  rows={3}
                  className={inputCls}
                  placeholder="Storage instructions, sourcing preferences, special requirements…"
                />
              </div>
              <div style={isLight ? null : { marginTop: 8 }}>
                {isLight ? (
                  <FL>
                    Order notes (visible to supplier)
                    <HelpHint title="What goes in Order notes?" width={300} align="end">
                      <HelpHintBuckets buckets={[
                        { label: 'Prep',        example: '"Skin on, pin boned, scaled"' },
                        { label: 'Packing',     example: '"1 per bag, vac-packed"' },
                        { label: 'State',       example: '"Ripe not soft, sashimi grade"' },
                        { label: 'Special',     example: '"Display quality, bones out"' },
                      ]} />
                    </HelpHint>
                  </FL>
                ) : (
                  <span className={labelCls}>Order notes (visible to supplier)</span>
                )}
                <textarea
                  value={form.notes || ''}
                  onChange={e => set('notes', e.target.value)}
                  onBlur={() => saveField()}
                  rows={2}
                  className={inputCls}
                  placeholder="e.g. Skin on, pin boned, 1 per bag, sashimi grade…"
                />
              </div>
            </div>
          </Section>

          {/* Source badge — only when non-manual */}
          {form.source && form.source !== 'manual' && (
            <div>
              {isLight ? (
                <span className="idr-source-badge">
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
              <div className="idr-accounting">
                <button
                  onClick={() => setAccountingOpen(v => !v)}
                  className="idr-accounting-toggle"
                >
                  <span className="idr-accounting-toggle-label">Accounting</span>
                  <span className={`idr-accounting-toggle-chevron${accountingOpen ? ' is-open' : ''}`}>▾</span>
                </button>
                {accountingOpen && (
                  <div className="idr-accounting-body">
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

          </fieldset>
        </div>
      </Drawer>
    </>
  );
};

export default ItemDrawer;
