import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEPARTMENTS = ['Galley', 'Interior', 'Deck', 'Engineering', 'Admin'];

const BLANK_ITEM = () => ({
  _id: crypto.randomUUID(),
  name: '',
  category: '',
  department: '',
  quantity_ordered: '',
  unit: '',
  estimated_unit_cost: '',
});

// Load trips from localStorage
const loadLocalTrips = () => {
  try {
    return JSON.parse(localStorage.getItem('cargo.trips.v1') || '[]');
  } catch {
    return [];
  }
};

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
  borderTop: '1px solid rgba(255,255,255,0.06)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexShrink: 0,
};

const inputStyle = {
  width: '100%',
  backgroundColor: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 7,
  padding: '8px 11px',
  fontSize: 13,
  color: 'white',
  outline: 'none',
  boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  marginBottom: 6,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
const fieldWrap = { marginBottom: 16 };
const rowGrid = (cols) => ({
  display: 'grid',
  gridTemplateColumns: cols,
  gap: 12,
});

const btnBlue = {
  backgroundColor: '#3B82F6',
  border: 'none',
  borderRadius: 7,
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  color: 'white',
  cursor: 'pointer',
};
const btnGhost = {
  backgroundColor: 'transparent',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 7,
  padding: '9px 18px',
  fontSize: 13,
  color: 'rgba(255,255,255,0.6)',
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
  const [form, setForm] = useState({
    title: '',
    trip_id: '',
    departments: [],
    port_location: '',
    supplier_id: '',
    estimated_cost: '',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState({});

  // ─── Items state
  const [items, setItems] = useState([BLANK_ITEM()]);

  // ─── Source data
  const [trips] = useState(() => loadLocalTrips());
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
  });
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());

  // Sync suppliers prop
  useEffect(() => { setSuppliers(suppliersProp); }, [suppliersProp]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setActiveTab('manual');
      setForm({ title: '', trip_id: '', departments: [], port_location: '', supplier_id: '', estimated_cost: '', notes: '' });
      setItems([BLANK_ITEM()]);
      setFormErrors({});
      setSaving(false);
      setSuggestions({ guestPreferences: [], lowStock: [], orderPatterns: [] });
      setSelectedSuggestions(new Set());
      setAddingSupplier(false);
      setNewSupplierName('');
    }
  }, [isOpen]);

  // Load smart suggestions when trip changes and smart tab is active
  const loadSuggestions = useCallback(async () => {
    if (!form.trip_id || !activeTenantId) return;
    setSuggestionsLoading(true);

    const trip = trips.find(t => t.id === form.trip_id);
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

    setSuggestions({
      guestPreferences: prefResult.status === 'fulfilled' ? prefResult.value : [],
      lowStock:         stockResult.status === 'fulfilled' ? stockResult.value : [],
      orderPatterns:    patternResult.status === 'fulfilled' ? patternResult.value : [],
    });
    setSuggestionsLoading(false);
  }, [form.trip_id, activeTenantId, trips]);

  useEffect(() => {
    if (activeTab === 'smart' && form.trip_id) {
      loadSuggestions();
    }
  }, [activeTab, form.trip_id, loadSuggestions]);

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
      const listPayload = {
        tenant_id:      activeTenantId,
        title:          form.title.trim(),
        trip_id:        form.trip_id || null,
        department:     form.departments,
        port_location:  form.port_location.trim() || null,
        supplier_id:    form.supplier_id || null,
        estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : null,
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
          list_id:            newList.id,
          name:               i.name.trim(),
          category:           i.category.trim() || null,
          department:         i.department || null,
          quantity_ordered:   Number(i.quantity_ordered) || 0,
          unit:               i.unit.trim() || null,
          estimated_unit_cost: i.estimated_unit_cost ? Number(i.estimated_unit_cost) : null,
          source:             'manual',
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>New Provisioning List</h2>
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
              { key: 'manual', label: 'Build Manually' },
              { key: 'smart',  label: 'Smart Suggestions' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab.key ? '2px solid #3B82F6' : '2px solid transparent',
                  padding: '8px 16px 10px',
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 400,
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
                          border: `1px solid ${active ? '#3B82F6' : 'rgba(255,255,255,0.12)'}`,
                          backgroundColor: active ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
                          color: active ? '#4A90E2' : 'rgba(255,255,255,0.5)',
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

              {/* Port / Supplier row */}
              <div style={{ ...rowGrid('1fr 1fr'), ...fieldWrap }}>
                <div>
                  <label style={labelStyle}>Port / Location</label>
                  <input
                    style={inputStyle}
                    placeholder="e.g. Palma de Mallorca"
                    value={form.port_location}
                    onChange={e => setField('port_location', e.target.value)}
                  />
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

              {/* Estimated cost / Notes row */}
              <div style={{ ...rowGrid('1fr 2fr'), ...fieldWrap }}>
                <div>
                  <label style={labelStyle}>Estimated Cost</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>£</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={{ ...inputStyle, paddingLeft: 24 }}
                      placeholder="0.00"
                      value={form.estimated_cost}
                      onChange={e => setField('estimated_cost', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
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

                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.2fr 1.2fr 0.8fr 0.9fr 1fr 28px',
                  gap: 6,
                  marginBottom: 6,
                  padding: '0 2px',
                }}>
                  {['Item name', 'Category', 'Department', 'Qty', 'Unit', '£ Unit cost', ''].map((h, i) => (
                    <span key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                  ))}
                </div>

                {items.map((item) => (
                  <div key={item._id} style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.2fr 1.2fr 0.8fr 0.9fr 1fr 28px',
                    gap: 6,
                    marginBottom: 6,
                    alignItems: 'center',
                  }}>
                    <input
                      style={inputStyle}
                      placeholder="Item name"
                      value={item.name}
                      onChange={e => updateItem(item._id, 'name', e.target.value)}
                    />
                    <input
                      style={inputStyle}
                      placeholder="Category"
                      value={item.category}
                      onChange={e => updateItem(item._id, 'category', e.target.value)}
                    />
                    <select
                      style={{ ...inputStyle, color: item.department ? 'white' : 'rgba(255,255,255,0.35)' }}
                      value={item.department}
                      onChange={e => updateItem(item._id, 'department', e.target.value)}
                    >
                      <option value="">Dept</option>
                      {(form.departments.length ? form.departments : DEPARTMENTS).map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      style={inputStyle}
                      placeholder="0"
                      value={item.quantity_ordered}
                      onChange={e => updateItem(item._id, 'quantity_ordered', e.target.value)}
                    />
                    <input
                      style={inputStyle}
                      placeholder="each"
                      value={item.unit}
                      onChange={e => updateItem(item._id, 'unit', e.target.value)}
                    />
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>£</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        style={{ ...inputStyle, paddingLeft: 20 }}
                        placeholder="0.00"
                        value={item.estimated_unit_cost}
                        onChange={e => updateItem(item._id, 'estimated_unit_cost', e.target.value)}
                      />
                    </div>
                    <button
                      onClick={() => removeItem(item._id)}
                      title="Remove item"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255,255,255,0.25)',
                        fontSize: 16,
                        cursor: 'pointer',
                        lineHeight: 1,
                        padding: 0,
                        textAlign: 'center',
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}

                <button
                  onClick={addItem}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#4A90E2', cursor: 'pointer', padding: '6px 0', marginTop: 4 }}
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

                  {!suggestions.guestPreferences.length &&
                   !suggestions.lowStock.length &&
                   !suggestions.orderPatterns.length && (
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
        </div>

        {/* Footer */}
        <div style={FOOTER}>
          <button style={{ ...btnGhost, marginRight: 'auto' }} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            style={{ ...btnGhost, ...(saving ? btnDisabled : {}) }}
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
