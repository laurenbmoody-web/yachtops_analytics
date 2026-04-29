import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';
import { BOARD_TYPES } from '../../provisioning/data/templates';
import { loadTrips, findTripByAnyId } from '../../trips-management-dashboard/utils/tripStorage';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEPARTMENTS = ['Galley', 'Interior', 'Deck', 'Engineering', 'Admin'];

const CURRENCIES = [
  { code: 'GBP', symbol: '£' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
];

const CATEGORY_L1 = ['Dry Goods','Fresh Produce','Frozen','Dairy','Beverages','Cleaning & Laundry','Deck Stores','Engineering Supplies','Guest Amenities','Crew Supplies'];
const CATEGORY_L2 = {
  'Dry Goods': ['Pasta','Rice','Flour','Cereals','Tinned Goods','Sauces','Oils & Vinegars'],
  'Fresh Produce': ['Fruit','Vegetables','Herbs','Salads'],
  'Frozen': ['Meat','Fish & Seafood','Ready Meals','Desserts'],
  'Dairy': ['Milk','Cheese','Yoghurt','Butter & Cream','Eggs'],
  'Beverages': ['Water','Soft Drinks','Juices','Coffee & Tea'],
  'Cleaning & Laundry': ['Detergents','Cloths & Mops','Bin Bags','Laundry'],
  'Deck Stores': ['Ropes','Cleaning','Safety','Maintenance'],
  'Engineering Supplies': ['Spares','Lubricants','Consumables','Safety'],
  'Guest Amenities': ['Toiletries','Towels','Stationery'],
  'Crew Supplies': ['Provisions','Uniforms','Stationery'],
};

const BLANK_ITEM = () => ({
  _id: crypto.randomUUID(),
  name: '',
  brand: '',
  size: '',
  category: '',
  sub_category: '',
  department: '',
  quantity_ordered: '',
  unit: '',
  estimated_unit_cost: '',
  item_notes: '',
});

// Trips were localStorage-only pre-A3; loadTrips is now async + Supabase
// + LS merged. The local helper is removed; the modal hydrates trips via
// useEffect on mount.

// Load guest preferences from localStorage (legacy store)
const loadLocalPreferences = () => {
  try {
    return JSON.parse(localStorage.getItem('cargo.preferences.v1') || '[]');
  } catch {
    return [];
  }
};

// ─── Inline styles ────────────────────────────────────────────────────────────
const OVERLAY = {
  position: 'fixed', inset: 0,
  backgroundColor: 'rgba(0,0,0,0.7)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 16px',
  fontFamily: 'Inter, sans-serif',
};
const MODAL = {
  backgroundColor: '#0d1a2e',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.08)',
  width: '100%',
  maxWidth: 720,
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
const HEADER = {
  padding: '20px 24px 0',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  flexShrink: 0,
};
const BODY = {
  flex: 1,
  overflowY: 'auto',
  padding: '20px 24px',
};
const FOOTER = {
  padding: '16px 24px',
  borderTop: '1px solid rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexShrink: 0,
};

const inputStyle = {
  width: '100%',
  height: 40,
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 13,
  color: 'white',
  outline: 'none',
  boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 10,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.4)',
  marginBottom: 6,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};
const fieldWrap = { marginBottom: 20 };
const rowGrid = (cols) => ({
  display: 'grid',
  gridTemplateColumns: cols,
  gap: 12,
});

const btnBlue = {
  backgroundColor: '#4A90E2',
  border: 'none',
  borderRadius: 8,
  padding: '9px 20px',
  fontSize: 13,
  fontWeight: 600,
  color: 'white',
  cursor: 'pointer',
};
const btnGhost = {
  backgroundColor: 'transparent',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  padding: '9px 18px',
  fontSize: 13,
  color: 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
};
const btnDisabled = {
  opacity: 0.4,
  cursor: 'not-allowed',
};

// ─── Component ────────────────────────────────────────────────────────────────
const CreateProvisioningListModal = ({
  isOpen,
  onClose,
  onSuccess,
  suppliers: suppliersProp = [],
  onSuppliersChange,
}) => {
  const { activeTenantId } = useTenant();
  const { session } = useAuth();

  // ─── Tab state
  const [activeTab, setActiveTab] = useState('manual');

  // ─── Form state
  // board_type defaults to 'charter' — most common case, saves a click on the
  // most common workflow. Sprint 9c.1a — column lives at provisioning_lists.board_type
  // with a CHECK constraint covering the values in BOARD_TYPES.
  const [form, setForm] = useState({
    title: '',
    board_type: 'charter',
    trip_id: '',
    departments: [],
    port_location: '',
    supplier_id: '',
    estimated_cost: '',
    currency: 'GBP',
    order_by_date: '',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState({});

  // ─── Items state
  const [items, setItems] = useState([BLANK_ITEM()]);

  // ─── Source data
  // loadTrips is async post-A3.1; hydrate via useEffect with cancellation guard.
  const [trips, setTrips] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await loadTrips();
        if (!cancelled) setTrips(fetched || []);
      } catch (err) {
        console.warn('[CreateProvisioningListModal] loadTrips failed:', err);
        if (!cancelled) setTrips([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [suppliers, setSuppliers] = useState(suppliersProp);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');

  // ─── Save state
  const [saving, setSaving] = useState(false);

  // ─── Smart suggestions state
  const [suggestions, setSuggestions] = useState({
    guestPreferences: [],
    lowStock: [],
    orderPatterns: [],
    masterHistory: [],
  });
  const [templates, setTemplates] = useState([]);
  const [masterHistory, setMasterHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDept, setHistoryDept] = useState('');
  const [checkedHistory, setCheckedHistory] = useState(new Set());
  const [historySubTab, setHistorySubTab] = useState('templates');
  const [previewTemplateId, setPreviewTemplateId] = useState(null);
  const [previewItems, setPreviewItems] = useState([]);
  const [historyPopKey, setHistoryPopKey] = useState(null);
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());

  // Sync suppliers prop
  useEffect(() => { setSuppliers(suppliersProp); }, [suppliersProp]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setActiveTab('manual');
      setForm({ title: '', board_type: 'charter', trip_id: '', departments: [], port_location: '', supplier_id: '', estimated_cost: '', currency: 'GBP', order_by_date: '', notes: '' });
      setItems([BLANK_ITEM()]);
      setFormErrors({});
      setSaving(false);
      setSuggestions({ guestPreferences: [], lowStock: [], orderPatterns: [], masterHistory: [] });
      setSelectedSuggestions(new Set());
      setAddingSupplier(false);
      setNewSupplierName('');
      setCheckedHistory(new Set());
      setHistorySearch('');
      setHistoryDept('');
      setHistorySubTab('templates');
      setPreviewTemplateId(null);
      setExpandedNotes(new Set());
    }
  }, [isOpen]);

  // Load smart suggestions when trip changes and smart tab is active
  const loadSuggestions = useCallback(async () => {
    if (!form.trip_id || !activeTenantId) return;
    setSuggestionsLoading(true);

    const trip = findTripByAnyId(trips, form.trip_id);
    const guestIds = (trip?.guests || []).filter(g => g.isActive !== false).map(g => g.guestId).filter(Boolean);

    const [prefResult, stockResult, patternResult] = await Promise.allSettled([
      // ── Source 1: Guest preferences from Supabase guest_preferences table
      (async () => {
        if (!guestIds.length) return [];
        const { data, error } = await supabase
          ?.from('guest_preferences')
          ?.select('guest_id, key, value, category')
          ?.eq('tenant_id', activeTenantId)
          ?.in('guest_id', guestIds)
          ?.in('category', ['Food & Drink', 'Dietary', 'Dietary Restrictions', 'Allergies']);
        if (error) throw error;

        // Also merge local preferences
        const localPrefs = loadLocalPreferences().filter(
          p => guestIds.includes(p.guestId) &&
               ['Food & Drink', 'Dietary', 'Dietary Restrictions'].includes(p.category)
        );

        const combined = [
          ...(data || []).map(r => ({
            id: `pref-${r.guest_id}-${r.key}`,
            name: r.value || r.key,
            reason: 'Guest Preference',
            source: 'guest_preference',
            category: r.category,
          })),
          ...localPrefs.map(p => ({
            id: `localpref-${p.guestId}-${p.id}`,
            name: p.value || p.key,
            reason: 'Guest Preference',
            source: 'guest_preference',
            category: p.category,
          })),
        ];
        // Deduplicate by name
        const seen = new Set();
        return combined.filter(item => {
          const key = item.name?.toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })(),

      // ── Source 2: Low stock from inventory_items
      (async () => {
        const { data, error } = await supabase
          ?.from('inventory_items')
          ?.select('name, total_qty, par_level, reorder_point, unit')
          ?.eq('tenant_id', activeTenantId);
        if (error) throw error;

        return (data || [])
          .filter(item => {
            const qty = Number(item.total_qty) || 0;
            const reorder = Number(item.reorder_point) || null;
            const par = Number(item.par_level) || null;
            if (reorder != null && qty <= reorder) return true;
            if (par != null && qty < par * 0.2) return true;
            return false;
          })
          .map(item => ({
            id: `stock-${item.name}`,
            name: item.name,
            unit: item.unit,
            reason: `Low Stock — ${item.total_qty ?? 0} ${item.unit || 'units'} remaining`,
            source: 'low_stock',
            category: null,
          }));
      })(),

      // ── Source 3: Order patterns from provisioning history
      (async () => {
        const { data: deliveries, error } = await supabase
          ?.from('provisioning_items')
          ?.select('name, unit, category, created_at, list_id, provisioning_lists!inner(tenant_id)')
          ?.eq('provisioning_lists.tenant_id', activeTenantId)
          ?.order('created_at', { ascending: false });
        if (error) throw error;

        // Group by item name
        const byName = {};
        (deliveries || []).forEach(item => {
          const key = item.name?.toLowerCase();
          if (!key) return;
          if (!byName[key]) byName[key] = { name: item.name, unit: item.unit, category: item.category, dates: [] };
          byName[key].dates.push(new Date(item.created_at));
        });

        const now = new Date();
        const results = [];
        Object.values(byName).forEach(({ name, unit, category, dates }) => {
          if (dates.length < 2) return;
          dates.sort((a, b) => b - a);
          const daysBetween = [];
          for (let i = 0; i < dates.length - 1; i++) {
            daysBetween.push((dates[i] - dates[i + 1]) / 86400000);
          }
          const avgDays = daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length;
          const daysSinceLast = (now - dates[0]) / 86400000;
          if (daysSinceLast >= avgDays * 0.8) {
            results.push({
              id: `pattern-${name}`,
              name,
              unit,
              category,
              reason: `Order Pattern — last ordered ${Math.round(daysSinceLast)}d ago`,
              source: 'invoice_pattern',
            });
          }
        });
        return results;
      })(),
    ]);

    // ── Source 4: Master history — items ordered 3+ times not already on list
    const currentNames = new Set(items.map(i => (i.name || '').toLowerCase().trim()));
    let masterHistoryItems = [];
    try {
      const { data: deliveredLists } = await supabase?.from('provisioning_lists')?.select('id')?.eq('tenant_id', activeTenantId)?.eq('status', 'delivered');
      if (deliveredLists?.length) {
        const { data: hItems } = await supabase?.from('provisioning_items')?.select('name, brand, size, category, unit, created_at')?.in('list_id', deliveredLists.map(l => l.id));
        const byName = {};
        (hItems || []).forEach(i => {
          const k = (i.name || '').toLowerCase().trim();
          if (!k) return;
          if (!byName[k]) byName[k] = { name: i.name, brand: i.brand||'', size: i.size||'', category: i.category||'', unit: i.unit||'', count: 0, last: null };
          byName[k].count++;
          const d = i.created_at ? new Date(i.created_at) : null;
          if (d && (!byName[k].last || d > byName[k].last)) byName[k].last = d;
        });
        masterHistoryItems = Object.values(byName)
          .filter(h => h.count >= 3 && !currentNames.has(h.name.toLowerCase().trim()))
          .map(h => ({
            id: `mh-${h.name}`,
            name: h.name,
            brand: h.brand,
            size: h.size,
            category: h.category,
            unit: h.unit,
            reason: `Regular Order — ordered ${h.count} times previously${h.last ? `, last ${Math.round((Date.now()-h.last)/86400000)}d ago` : ''}`,
            source: 'master_history',
          }));
      }
    } catch {}

    setSuggestions({
      guestPreferences: prefResult.status === 'fulfilled' ? prefResult.value : [],
      lowStock:         stockResult.status === 'fulfilled' ? stockResult.value : [],
      orderPatterns:    patternResult.status === 'fulfilled' ? patternResult.value : [],
      masterHistory:    masterHistoryItems,
    });
    setSuggestionsLoading(false);
  }, [form.trip_id, activeTenantId, trips]);

  useEffect(() => {
    if (activeTab === 'smart' && form.trip_id) {
      loadSuggestions();
    }
    if (activeTab === 'history' && !historyLoading && !masterHistory.length && !templates.length) {
      loadHistoryAndTemplates();
    }
  }, [activeTab, form.trip_id, loadSuggestions]);

  const loadHistoryAndTemplates = async () => {
    if (!activeTenantId) return;
    setHistoryLoading(true);
    try {
      const [tmplRes, listsRes] = await Promise.allSettled([
        supabase?.from('provisioning_lists')?.select('id, title, department, updated_at')?.eq('tenant_id', activeTenantId)?.eq('is_template', true)?.order('updated_at', { ascending: false }),
        supabase?.from('provisioning_lists')?.select('id')?.eq('tenant_id', activeTenantId)?.eq('status', 'delivered'),
      ]);
      if (tmplRes.status === 'fulfilled' && !tmplRes.value.error) setTemplates(tmplRes.value.data || []);

      if (listsRes.status === 'fulfilled' && !listsRes.value.error && listsRes.value.data?.length) {
        const listIds = listsRes.value.data.map(l => l.id);
        const { data: hItems } = await supabase?.from('provisioning_items')?.select('name, brand, size, category, sub_category, department, unit, quantity_ordered, created_at')?.in('list_id', listIds)?.order('name');
        const byName = {};
        (hItems || []).forEach(i => {
          const k = `${(i.name||'').toLowerCase()}|${(i.brand||'').toLowerCase()}`;
          if (!k) return;
          if (!byName[k]) byName[k] = { name: i.name, brand: i.brand||'', size: i.size||'', category: i.category||'', sub_category: i.sub_category||'', department: i.department||'', unit: i.unit||'each', count: 0, qtys: [], last: null };
          byName[k].count++;
          if (i.quantity_ordered) byName[k].qtys.push(Number(i.quantity_ordered));
          const d = i.created_at ? new Date(i.created_at) : null;
          if (d && (!byName[k].last || d > byName[k].last)) byName[k].last = d;
        });
        setMasterHistory(Object.values(byName).map(h => ({
          ...h,
          avg_qty: h.qtys.length ? Math.round(h.qtys.reduce((a,b)=>a+b,0)/h.qtys.length*10)/10 : null,
          last_qty: h.qtys[h.qtys.length-1] || null,
        })).sort((a,b) => b.count - a.count));
      }
    } catch(e) { console.error(e); }
    setHistoryLoading(false);
  };

  // ─── Form helpers ────────────────────────────────────────────────────────────
  const setField = (key, val) => {
    setForm(f => ({ ...f, [key]: val }));
    if (formErrors[key]) setFormErrors(e => ({ ...e, [key]: null }));
  };

  const toggleDepartment = (dept) => {
    setForm(f => {
      const cur = f.departments;
      const next = cur.includes(dept) ? cur.filter(d => d !== dept) : [...cur, dept];
      return { ...f, departments: next };
    });
    if (formErrors.departments) setFormErrors(e => ({ ...e, departments: null }));
  };

  // ─── Item helpers ────────────────────────────────────────────────────────────
  const addItem = () => setItems(prev => [...prev, BLANK_ITEM()]);

  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));

  const updateItem = (id, field, val) => {
    setItems(prev => prev.map(i => i._id === id ? { ...i, [field]: val } : i));
  };

  // ─── Inline add supplier ─────────────────────────────────────────────────────
  const saveNewSupplier = async () => {
    if (!newSupplierName.trim() || !activeTenantId) return;
    const { data, error } = await supabase
      ?.from('provisioning_suppliers')
      ?.insert({ tenant_id: activeTenantId, name: newSupplierName.trim() })
      ?.select()
      ?.single();
    if (error) { showToast('Could not add supplier', 'error'); return; }
    const updated = [...suppliers, data];
    setSuppliers(updated);
    setField('supplier_id', data.id);
    setAddingSupplier(false);
    setNewSupplierName('');
    onSuppliersChange?.();
  };

  // ─── Validation ──────────────────────────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (!form.title.trim()) errs.title = 'Title is required';
    if (!form.departments.length) errs.departments = 'Select at least one department';
    return errs;
  };

  // ─── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async (status) => {
    const errs = validate();
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    if (!activeTenantId) { showToast('No active tenant', 'error'); return; }

    setSaving(true);
    try {
      const userId = session?.user?.id || null;
      // provisioning_lists.trip_id is a uuid column. Trips on the merged
      // shape expose `supabaseId` (the canonical Supabase UUID) alongside
      // the legacy `id` string. Resolve to the UUID at submit; fall back
      // to null if the selected trip is LS-only (pending-sync, no
      // Supabase row yet — DB insert would fail anyway).
      const selectedTrip = form.trip_id
        ? findTripByAnyId(trips, form.trip_id)
        : null;
      const tripIdForWire = selectedTrip?.supabaseId || null;
      const listPayload = {
        tenant_id:      activeTenantId,
        title:          form.title.trim(),
        board_type:     form.board_type || 'general',
        trip_id:        tripIdForWire,
        department:     form.departments,
        port_location:  form.port_location.trim() || null,
        supplier_id:    form.supplier_id || null,
        estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : null,
        currency:       form.currency || 'GBP',
        order_by_date:  form.order_by_date || null,
        notes:          form.notes.trim() || null,
        status,
        created_by:     userId,
      };

      const { data: newList, error: listErr } = await supabase
        ?.from('provisioning_lists')
        ?.insert(listPayload)
        ?.select()
        ?.single();

      if (listErr) throw listErr;

      // Batch insert items (skip blank rows)
      const validItems = items.filter(i => i.name.trim());
      if (validItems.length) {
        const itemRows = validItems.map(i => ({
          list_id:             newList.id,
          name:                i.name.trim(),
          brand:               i.brand?.trim() || null,
          size:                i.size?.trim() || null,
          category:            i.category?.trim() || null,
          sub_category:        i.sub_category?.trim() || null,
          department:          i.department || null,
          quantity_ordered:    Number(i.quantity_ordered) || 0,
          unit:                i.unit?.trim() || null,
          estimated_unit_cost: i.estimated_unit_cost ? Number(i.estimated_unit_cost) : null,
          item_notes:          i.item_notes?.trim() || null,
          source:              'manual',
        }));
        const { error: itemErr } = await supabase?.from('provisioning_items')?.insert(itemRows);
        if (itemErr) throw itemErr;
      }

      onSuccess?.();
    } catch (err) {
      console.error('[Provisioning] save error:', err?.message);
      showToast('Could not save provisioning list', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Add selected suggestions to items ───────────────────────────────────────
  const addSuggestionsToItems = () => {
    const allSuggestions = [
      ...suggestions.guestPreferences,
      ...suggestions.lowStock,
      ...suggestions.orderPatterns,
    ];
    const toAdd = allSuggestions
      .filter(s => selectedSuggestions.has(s.id))
      .map(s => ({
        ...BLANK_ITEM(),
        name: s.name,
        category: s.category || '',
        unit: s.unit || '',
        source: s.source,
      }));
    if (!toAdd.length) return;
    setItems(prev => {
      // Remove any purely blank rows first
      const nonBlank = prev.filter(i => i.name.trim());
      return [...nonBlank, ...toAdd];
    });
    setSelectedSuggestions(new Set());
    setActiveTab('manual');
  };

  const toggleSuggestion = (id) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllSuggestions = (group) => {
    const ids = group.map(s => s.id);
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  };

  const hasItems = items.some(i => i.name.trim());
  const canSubmit = hasItems;

  if (!isOpen) return null;

  // ─── Suggestion section ───────────────────────────────────────────────────────
  const SuggestionGroup = ({ title, items: group }) => {
    if (!group.length) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {title}
          </span>
          <button
            onClick={() => selectAllSuggestions(group)}
            style={{ background: 'none', border: 'none', fontSize: 11, color: '#4A90E2', cursor: 'pointer', padding: 0 }}
          >
            Select all
          </button>
        </div>
        {group.map(s => (
          <div
            key={s.id}
            onClick={() => toggleSuggestion(s.id)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 7,
              marginBottom: 4,
              cursor: 'pointer',
              backgroundColor: selectedSuggestions.has(s.id) ? 'rgba(74,144,226,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${selectedSuggestions.has(s.id) ? 'rgba(74,144,226,0.3)' : 'rgba(255,255,255,0.05)'}`,
            }}
          >
            <input
              type="checkbox"
              readOnly
              checked={selectedSuggestions.has(s.id)}
              style={{ marginTop: 2, accentColor: '#4A90E2', flexShrink: 0, cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'white' }}>{s.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.reason}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={OVERLAY} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MODAL}>

        {/* Header */}
        <div style={HEADER}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>New Provisioning List</h2>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
            >
              ×
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { key: 'manual',  label: 'Build Manually' },
              { key: 'smart',   label: 'Smart Suggestions' },
              { key: 'history', label: 'Templates & History' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab.key ? '2px solid #4A90E2' : '2px solid transparent',
                  padding: '8px 16px 10px',
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 500,
                  color: activeTab === tab.key ? 'white' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={BODY}>

          {/* ── BUILD MANUALLY TAB ─────────────────────────────────────────── */}
          {activeTab === 'manual' && (
            <>
              {/* Title */}
              <div style={fieldWrap}>
                <label style={labelStyle}>List Title *</label>
                <input
                  style={{ ...inputStyle, borderColor: formErrors.title ? '#ef4444' : 'rgba(255,255,255,0.1)' }}
                  placeholder="e.g. Week 12 Galley Order"
                  value={form.title}
                  onChange={e => setField('title', e.target.value)}
                />
                {formErrors.title && (
                  <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>{formErrors.title}</span>
                )}
              </div>

              {/* Board type — Sprint 9c.1a. Defaults to 'charter' on open. */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Board type *</label>
                <select
                  style={{ ...inputStyle, color: form.board_type ? 'white' : 'rgba(255,255,255,0.35)' }}
                  value={form.board_type}
                  onChange={e => setField('board_type', e.target.value)}
                >
                  {BOARD_TYPES.map(bt => (
                    <option key={bt.value} value={bt.value}>{bt.label}</option>
                  ))}
                </select>
              </div>

              {/* Link to trip */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Link to Trip</label>
                <select
                  style={{ ...inputStyle, color: form.trip_id ? 'white' : 'rgba(255,255,255,0.35)' }}
                  value={form.trip_id}
                  onChange={e => setField('trip_id', e.target.value)}
                >
                  <option value="">No trip linked</option>
                  {trips.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.startDate ? ` — ${new Date(t.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Departments */}
              <div style={fieldWrap}>
                <label style={{ ...labelStyle, color: formErrors.departments ? '#ef4444' : 'rgba(255,255,255,0.5)' }}>
                  Departments *
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {DEPARTMENTS.map(dept => {
                    const active = form.departments.includes(dept);
                    return (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => toggleDepartment(dept)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: active ? 600 : 400,
                          border: `1px solid ${active ? '#4A90E2' : 'rgba(255,255,255,0.12)'}`,
                          backgroundColor: active ? '#4A90E2' : 'rgba(255,255,255,0.05)',
                          color: active ? 'white' : 'rgba(255,255,255,0.5)',
                          cursor: 'pointer',
                        }}
                      >
                        {dept}
                      </button>
                    );
                  })}
                </div>
                {formErrors.departments && (
                  <span style={{ fontSize: 11, color: '#ef4444', marginTop: 6, display: 'block' }}>{formErrors.departments}</span>
                )}
              </div>

              {/* Order By Date / Port row */}
              <div style={{ ...rowGrid('1fr 1fr'), ...fieldWrap }}>
                <div>
                  <label style={labelStyle}>Order By Date</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={form.order_by_date}
                    onChange={e => setField('order_by_date', e.target.value)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Port / Location</label>
                  <input
                    style={inputStyle}
                    placeholder="e.g. Palma de Mallorca"
                    value={form.port_location}
                    onChange={e => setField('port_location', e.target.value)}
                  />
                </div>
              </div>

              {/* Supplier row */}
              <div style={{ ...rowGrid('1fr 1fr'), ...fieldWrap }}>
                <div>
                  <label style={labelStyle}>Estimated Cost</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {CURRENCIES.map(c => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => setField('currency', c.code)}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            border: form.currency === c.code ? 'none' : '1px solid rgba(255,255,255,0.1)',
                            background: form.currency === c.code ? '#4A90E2' : 'rgba(255,255,255,0.05)',
                            fontSize: 14,
                            fontWeight: 600,
                            color: form.currency === c.code ? 'white' : 'rgba(255,255,255,0.5)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                          }}
                        >
                          {c.symbol}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number" min="0" step="0.01"
                      style={{ ...inputStyle, flex: 1 }}
                      placeholder="0.00"
                      value={form.estimated_cost}
                      onChange={e => setField('estimated_cost', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Supplier</label>
                  {addingSupplier ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        placeholder="Supplier name"
                        value={newSupplierName}
                        autoFocus
                        onChange={e => setNewSupplierName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveNewSupplier(); if (e.key === 'Escape') setAddingSupplier(false); }}
                      />
                      <button style={{ ...btnBlue, padding: '8px 12px', fontSize: 12 }} onClick={saveNewSupplier}>Add</button>
                      <button style={{ ...btnGhost, padding: '8px 10px', fontSize: 12 }} onClick={() => setAddingSupplier(false)}>✕</button>
                    </div>
                  ) : (
                    <select
                      style={{ ...inputStyle, color: form.supplier_id ? 'white' : 'rgba(255,255,255,0.35)' }}
                      value={form.supplier_id}
                      onChange={e => {
                        if (e.target.value === '__add__') { setAddingSupplier(true); return; }
                        setField('supplier_id', e.target.value);
                      }}
                    >
                      <option value="">No supplier</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      <option value="__add__">+ Add new supplier</option>
                    </select>
                  )}
                </div>
              </div>

              {/* Notes row */}
              <div style={{ ...fieldWrap }}>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea
                    style={{ ...inputStyle, height: 'auto', resize: 'none', minHeight: 80, padding: '10px 12px', lineHeight: 1.5 }}
                    placeholder="Any notes for this list..."
                    value={form.notes}
                    onChange={e => setField('notes', e.target.value)}
                  />
                </div>
              </div>

              {/* Items section */}
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>Items</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {items.filter(i => i.name.trim()).length} added
                  </span>
                </div>

                {items.map((item, idx) => {
                  const currSym = CURRENCIES.find(c => c.code === form.currency)?.symbol || '£';
                  const l2Options = CATEGORY_L2[item.category] || [];
                  const noteExpanded = expandedNotes.has(item._id) || !!item.item_notes;
                  return (
                    <div key={item._id} style={{ marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 14 }}>
                      {/* Card header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, cursor: 'grab', userSelect: 'none' }}>⠿</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 500, flex: 1 }}>Item {idx + 1}</span>
                        <button
                          onClick={() => removeItem(item._id)}
                          title="Remove"
                          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 15, cursor: 'pointer', padding: 0, lineHeight: 1 }}
                          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
                        >🗑</button>
                      </div>
                      {/* Row 1: name, brand, size */}
                      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                        <input style={{ ...inputStyle, flex: 2 }} placeholder="Item name" value={item.name} onChange={e => updateItem(item._id, 'name', e.target.value)} />
                        <input style={{ ...inputStyle, flex: 1 }} placeholder="Brand" value={item.brand || ''} onChange={e => updateItem(item._id, 'brand', e.target.value)} />
                        <input style={{ ...inputStyle, flex: 1 }} placeholder="Size e.g. 500ml" value={item.size || ''} onChange={e => updateItem(item._id, 'size', e.target.value)} />
                      </div>
                      {/* Row 2: category, sub-cat, dept, qty, unit cost */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <select style={{ ...inputStyle, flex: '1.5 1 0', minWidth: 0, color: item.category ? 'white' : 'rgba(255,255,255,0.35)' }} value={item.category || ''} onChange={e => { updateItem(item._id, 'category', e.target.value); updateItem(item._id, 'sub_category', ''); }}>
                          <option value="">Category</option>
                          {CATEGORY_L1.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select style={{ ...inputStyle, flex: '1.5 1 0', minWidth: 0, color: item.sub_category ? 'white' : 'rgba(255,255,255,0.35)' }} value={item.sub_category || ''} onChange={e => updateItem(item._id, 'sub_category', e.target.value)} disabled={!item.category}>
                          <option value="">Sub-category</option>
                          {l2Options.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select style={{ ...inputStyle, flex: '1 1 0', minWidth: 0, color: item.department ? 'white' : 'rgba(255,255,255,0.35)' }} value={item.department} onChange={e => updateItem(item._id, 'department', e.target.value)}>
                          <option value="">Dept</option>
                          {(form.departments.length ? form.departments : DEPARTMENTS).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input type="number" min="0" style={{ ...inputStyle, flex: '1 1 0', minWidth: 0 }} placeholder="Qty" value={item.quantity_ordered} onChange={e => updateItem(item._id, 'quantity_ordered', e.target.value)} />
                        <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0 }}>
                          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }}>{currSym}</span>
                          <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: '100%', paddingLeft: 26 }} placeholder="0.00" value={item.estimated_unit_cost} onChange={e => updateItem(item._id, 'estimated_unit_cost', e.target.value)} />
                        </div>
                      </div>
                      {/* Row 3: notes */}
                      {noteExpanded ? (
                        <input
                          style={{ ...inputStyle, width: '100%', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}
                          placeholder="Item note — e.g. check expiry, preferred brand only"
                          value={item.item_notes || ''}
                          onChange={e => updateItem(item._id, 'item_notes', e.target.value)}
                        />
                      ) : (
                        <button
                          onClick={() => setExpandedNotes(prev => { const n = new Set(prev); n.add(item._id); return n; })}
                          style={{ background: 'none', border: 'none', fontSize: 11, color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0 }}
                        >+ Add note</button>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={addItem}
                  style={{ width: '100%', background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 0', fontSize: 12, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', marginTop: 4, textAlign: 'center', boxSizing: 'border-box' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  + Add item
                </button>
              </div>
            </>
          )}

          {/* ── SMART SUGGESTIONS TAB ──────────────────────────────────────── */}
          {activeTab === 'smart' && (
            <div>
              {!form.trip_id ? (
                <div style={{
                  textAlign: 'center',
                  padding: '40px 24px',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>🔗</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)', margin: '0 0 6px' }}>
                    No trip linked
                  </p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', margin: '0 0 16px', maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
                    Link this list to a trip to generate smart suggestions based on guest preferences, low stock and order history.
                  </p>
                  <button
                    onClick={() => setActiveTab('manual')}
                    style={{ ...btnBlue, fontSize: 12 }}
                  >
                    Go to Build Manually to select a trip
                  </button>
                </div>
              ) : suggestionsLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>Loading suggestions...</p>
                </div>
              ) : (
                <>
                  <SuggestionGroup title="Guest Preferences" items={suggestions.guestPreferences} />
                  <SuggestionGroup title="Low Stock" items={suggestions.lowStock} />
                  <SuggestionGroup title="Order Patterns" items={suggestions.orderPatterns} />
                  <SuggestionGroup title="Regular Orders (History)" items={suggestions.masterHistory} />

                  {!suggestions.guestPreferences.length &&
                   !suggestions.lowStock.length &&
                   !suggestions.orderPatterns.length &&
                   !suggestions.masterHistory.length && (
                    <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>No suggestions available</p>
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
                        No guest preferences, low-stock items or order patterns were found for this trip.
                      </p>
                    </div>
                  )}

                  {selectedSuggestions.size > 0 && (
                    <div style={{
                      position: 'sticky',
                      bottom: 0,
                      marginTop: 16,
                      padding: '12px 0',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      backgroundColor: '#0d1a2e',
                    }}>
                      <button style={btnBlue} onClick={addSuggestionsToItems}>
                        Add {selectedSuggestions.size} selected item{selectedSuggestions.size !== 1 ? 's' : ''} to list →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── TEMPLATES & HISTORY TAB ────────────────────────────────────── */}
          {activeTab === 'history' && (
            <div>
              {/* Sub-tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
                {[['templates','Saved Templates'],['history','Master Order History']].map(([key, label]) => (
                  <button key={key} onClick={() => setHistorySubTab(key)} style={{ background: 'none', border: 'none', borderBottom: historySubTab === key ? '2px solid #3B82F6' : '2px solid transparent', padding: '7px 14px 9px', fontSize: 12, fontWeight: historySubTab === key ? 600 : 400, color: historySubTab === key ? 'white' : 'rgba(255,255,255,0.4)', cursor: 'pointer', marginBottom: -1 }}>{label}</button>
                ))}
              </div>

              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 24px' }}><p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>Loading…</p></div>
              ) : historySubTab === 'templates' ? (
                templates.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 24px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.4)', margin: '0 0 6px' }}>No saved templates</p>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', margin: 0 }}>Save a list as a template from its detail view to reuse it here.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {templates.map(t => (
                      <div key={t.id} style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'white' }}>{t.title}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(Array.isArray(t.department) ? t.department : (t.department||'').split(',')).filter(Boolean).map(d => (
                                <span key={d} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>{d.trim()}</span>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                            <button
                              onClick={async () => {
                                if (previewTemplateId === t.id) { setPreviewTemplateId(null); return; }
                                const { data } = await supabase?.from('provisioning_items')?.select('*')?.eq('list_id', t.id);
                                setPreviewItems(data || []);
                                setPreviewTemplateId(t.id);
                              }}
                              style={{ ...btnGhost, fontSize: 11, padding: '6px 10px' }}
                            >{previewTemplateId === t.id ? 'Hide' : 'Preview'}</button>
                            <button
                              onClick={async () => {
                                const { data } = await supabase?.from('provisioning_items')?.select('*')?.eq('list_id', t.id);
                                const mapped = (data || []).map(i => ({ ...BLANK_ITEM(), name: i.name||'', brand: i.brand||'', size: i.size||'', category: i.category||'', sub_category: i.sub_category||'', department: i.department||'', quantity_ordered: i.quantity_ordered||'', unit: i.unit||'', estimated_unit_cost: i.estimated_unit_cost||'', item_notes: i.item_notes||'' }));
                                setItems(prev => [...prev.filter(i => i.name.trim()), ...mapped]);
                                setActiveTab('manual');
                              }}
                              style={{ ...btnBlue, fontSize: 11, padding: '6px 10px' }}
                            >Use template</button>
                          </div>
                        </div>
                        {previewTemplateId === t.id && previewItems.length > 0 && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            {previewItems.map((i, idx) => (
                              <div key={idx} style={{ display: 'flex', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>
                                <span style={{ color: 'white' }}>{i.name}</span>
                                {i.brand && <span>· {i.brand}</span>}
                                <span>· {i.quantity_ordered} {i.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* Master Order History */
                masterHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 24px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.4)', margin: '0 0 6px' }}>No order history yet</p>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', margin: 0 }}>Your master order history will build automatically as deliveries are logged.</p>
                  </div>
                ) : (
                  <div>
                    {/* Search + dept filter */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      <input style={{ ...inputStyle, flex: 1 }} placeholder="Search items, brands, categories…" value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
                      <select style={{ ...inputStyle, width: 140 }} value={historyDept} onChange={e => setHistoryDept(e.target.value)}>
                        <option value="">All departments</option>
                        {[...new Set(masterHistory.map(h => h.department).filter(Boolean))].sort().map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>

                    {/* Items list */}
                    {(() => {
                      const filtered = masterHistory.filter(h => {
                        if (historyDept && h.department !== historyDept) return false;
                        if (historySearch) { const q = historySearch.toLowerCase(); return (h.name||'').toLowerCase().includes(q) || (h.brand||'').toLowerCase().includes(q) || (h.category||'').toLowerCase().includes(q); }
                        return true;
                      });
                      if (!filtered.length) return <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '20px 0' }}>No items match.</p>;

                      const byDept = filtered.reduce((acc, h) => { const d = h.department||'Other'; if (!acc[d]) acc[d] = []; acc[d].push(h); return acc; }, {});

                      return Object.entries(byDept).map(([dept, deptItems]) => {
                        const deptKeys = deptItems.map(h => `${h.name}|${h.brand}`);
                        const allChecked = deptKeys.length > 0 && deptKeys.every(k => checkedHistory.has(k));
                        return (
                          <div key={dept} style={{ marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6, marginBottom: 6 }}>
                              <input type="checkbox" checked={allChecked} onChange={() => {
                                setCheckedHistory(prev => {
                                  const n = new Set(prev);
                                  deptKeys.forEach(k => allChecked ? n.delete(k) : n.add(k));
                                  return n;
                                });
                              }} style={{ accentColor: '#3B82F6' }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{dept}</span>
                            </div>
                            {deptItems.map(h => {
                              const key = `${h.name}|${h.brand}`;
                              const showPop = historyPopKey === key;
                              return (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, marginBottom: 3, backgroundColor: checkedHistory.has(key) ? 'rgba(59,130,246,0.07)' : 'rgba(255,255,255,0.02)' }}>
                                  <input type="checkbox" checked={checkedHistory.has(key)} onChange={() => setCheckedHistory(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })} style={{ accentColor: '#3B82F6', flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 12, color: 'white' }}>{h.name}</span>
                                      {h.brand && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{h.brand}</span>}
                                      {h.size && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{h.size}</span>}
                                    </div>
                                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{h.category || '—'}</span>
                                  </div>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>×{h.count}</span>
                                  <div style={{ position: 'relative', flexShrink: 0 }}>
                                    <button onClick={() => setHistoryPopKey(showPop ? null : key)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>ⓘ</button>
                                    {showPop && (
                                      <div style={{ position: 'absolute', right: 0, bottom: 22, zIndex: 30, backgroundColor: '#0d1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                                        <p style={{ margin: '0 0 3px' }}>Last ordered: <strong style={{ color: 'white' }}>{h.last_qty != null ? `${h.last_qty} ${h.unit}` : '—'}</strong></p>
                                        <p style={{ margin: 0 }}>Average: <strong style={{ color: 'white' }}>{h.avg_qty != null ? `${h.avg_qty} ${h.unit}` : '—'}</strong></p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      });
                    })()}

                    {checkedHistory.size > 0 && (
                      <div style={{ position: 'sticky', bottom: 0, padding: '12px 0 0', borderTop: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#0d1a2e', marginTop: 8 }}>
                        <button style={btnBlue} onClick={() => {
                          const selected = masterHistory.filter(h => checkedHistory.has(`${h.name}|${h.brand}`));
                          const mapped = selected.map(h => ({ ...BLANK_ITEM(), name: h.name, brand: h.brand||'', size: h.size||'', category: h.category||'', sub_category: h.sub_category||'', department: h.department||'', unit: h.unit||'' }));
                          setItems(prev => [...prev.filter(i => i.name.trim()), ...mapped]);
                          setCheckedHistory(new Set());
                          setActiveTab('manual');
                        }}>
                          Add {checkedHistory.size} selected item{checkedHistory.size !== 1 ? 's' : ''} to list →
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={FOOTER}>
          <button style={{ ...btnGhost, marginRight: 'auto', color: 'rgba(255,255,255,0.5)' }} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            {items.filter(i => i.name.trim()).length} added
          </span>
          <button
            style={{ ...btnGhost, color: 'rgba(255,255,255,0.7)', ...(saving ? btnDisabled : {}) }}
            disabled={saving}
            onClick={() => handleSave('draft')}
          >
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            style={{ ...btnBlue, ...((!canSubmit || saving) ? btnDisabled : {}) }}
            disabled={!canSubmit || saving}
            onClick={() => handleSave('pending_approval')}
          >
            Submit for Approval
          </button>
        </div>

      </div>
    </div>
  );
};

export default CreateProvisioningListModal;
