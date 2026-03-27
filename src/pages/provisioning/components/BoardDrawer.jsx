import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import SmartSuggestionsPanel from './SmartSuggestionsPanel';
import StatusBadge, { STATUS_CONFIG } from './StatusBadge';
import {
  updateProvisioningList,
  updateListStatus,
  deleteProvisioningList,
  saveAsTemplate,
  fetchTemplates,
  fetchMasterOrderHistory,
  fetchListItems,
  upsertItems,
  PROVISIONING_STATUS,
  PROVISION_DEPARTMENTS,
  formatCurrency,
} from '../utils/provisioningStorage';
import { getSmartSuggestions } from '../../../utils/provisioningSuggestions';

// ── Edit mode ────────────────────────────────────────────────────────────────

const EditMode = ({ list, suppliers, trips, tenantId, onSaved, onDeleted, onClose }) => {
  const [form, setForm] = useState({
    title: '',
    trip_id: '',
    department: '',
    port_location: '',
    order_by_date: '',
    supplier_id: '',
    estimated_cost: '',
    currency: 'USD',
    notes: '',
    is_private: false,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // department may be text[] from DB or legacy comma-string — normalise to comma-string for form
  const normDept = (dept) => {
    if (!dept) return '';
    if (Array.isArray(dept)) return dept.filter(Boolean).join(', ');
    return dept;
  };

  useEffect(() => {
    if (list) {
      setForm({
        title: list.title || '',
        trip_id: list.trip_id || '',
        department: normDept(list.department),
        port_location: list.port_location || '',
        order_by_date: list.order_by_date || '',
        supplier_id: list.supplier_id || '',
        estimated_cost: list.estimated_cost || '',
        currency: list.currency || 'USD',
        notes: list.notes || '',
        is_private: !!list.is_private,
      });
    }
  }, [list]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      // department stored as text[] in DB — convert comma-string → array
      const deptArray = form.department
        ? form.department.split(',').map(d => d.trim()).filter(Boolean)
        : [];
      const updated = await updateProvisioningList(list.id, {
        title: form.title.trim(),
        trip_id: form.trip_id || null,
        department: deptArray,
        port_location: form.port_location,
        order_by_date: form.order_by_date || null,
        supplier_id: form.supplier_id || null,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        currency: form.currency,
        notes: form.notes,
        is_private: form.is_private,
      });
      onSaved(updated);
    } catch {
      // error handled by caller
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      const updated = await updateListStatus(list.id, newStatus);
      onSaved(updated);
    } catch {
      // silent
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${list.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteProvisioningList(list.id);
      onDeleted(list.id);
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    try {
      await saveAsTemplate(list.id, true);
      onSaved({ ...list, is_template: true });
    } catch {
      // silent
    }
  };

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const inputCls = 'w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#4A90E2] transition-colors';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <label className={labelCls}>Board Title *</label>
        <input value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="e.g. Weekly Galley Order" />
      </div>

      {/* Trip */}
      <div>
        <label className={labelCls}>Linked Trip</label>
        <select value={form.trip_id} onChange={e => set('trip_id', e.target.value)} className={inputCls}>
          <option value="">None</option>
          {(trips || []).map(t => <option key={t.id} value={t.id}>{t.title || t.name}</option>)}
        </select>
      </div>

      {/* Departments */}
      <div>
        <label className={labelCls}>Departments</label>
        <div className="flex flex-wrap gap-2">
          {PROVISION_DEPARTMENTS.map(d => {
            const selected = form.department.split(',').map(s => s.trim()).filter(Boolean).includes(d);
            return (
              <button
                key={d}
                onClick={() => {
                  const current = form.department.split(',').map(s => s.trim()).filter(Boolean);
                  const next = selected ? current.filter(x => x !== d) : [...current, d];
                  set('department', next.join(', '));
                }}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selected ? 'bg-[#4A90E2]/20 border-[#4A90E2]/40 text-[#4A90E2]' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* Port */}
      <div>
        <label className={labelCls}>Port / Location</label>
        <input value={form.port_location} onChange={e => set('port_location', e.target.value)} className={inputCls} placeholder="e.g. Antibes" />
      </div>

      {/* Order by date */}
      <div>
        <label className={labelCls}>Order By Date</label>
        <input type="date" value={form.order_by_date} onChange={e => set('order_by_date', e.target.value)} className={inputCls} />
      </div>

      {/* Supplier */}
      <div>
        <label className={labelCls}>Supplier</label>
        <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} className={inputCls}>
          <option value="">None</option>
          {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Cost + Currency */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Estimated Cost</label>
          <input type="number" value={form.estimated_cost} onChange={e => set('estimated_cost', e.target.value)} className={inputCls} placeholder="0.00" />
        </div>
        <div className="w-24">
          <label className={labelCls}>Currency</label>
          <select value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Notes</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className={inputCls} placeholder="Internal notes..." />
      </div>

      {/* Private toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white">Private Board</p>
          <p className="text-xs text-slate-500">Only visible to you and COMMAND</p>
        </div>
        <button
          role="switch"
          aria-checked={form.is_private}
          onClick={() => set('is_private', !form.is_private)}
          className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${form.is_private ? 'bg-[#4A90E2]' : 'bg-white/20'}`}
        >
          <span className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_private ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !form.title.trim()}
        className="w-full py-2.5 bg-[#4A90E2] text-white text-sm font-medium rounded-lg hover:bg-[#4A90E2]/80 disabled:opacity-40 transition-colors"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>

      {/* Status actions */}
      <div className="border-t border-white/5 pt-4 space-y-2">
        <p className="text-xs font-medium text-slate-400 mb-2">Status Actions</p>
        <div className="flex items-center gap-2 mb-2">
          <StatusBadge status={list.status} />
        </div>
        {list.status === PROVISIONING_STATUS.DRAFT && (
          <button onClick={() => handleStatusChange(PROVISIONING_STATUS.PENDING_APPROVAL)} className="w-full py-2 bg-amber-600/20 text-amber-400 text-sm rounded-lg hover:bg-amber-600/30 transition-colors">
            Submit for Approval
          </button>
        )}
        {list.status === PROVISIONING_STATUS.PENDING_APPROVAL && (
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange(PROVISIONING_STATUS.SENT_TO_SUPPLIER)} className="flex-1 py-2 bg-blue-600/20 text-blue-400 text-sm rounded-lg hover:bg-blue-600/30 transition-colors">
              Approve & Send
            </button>
            <button onClick={() => handleStatusChange(PROVISIONING_STATUS.DRAFT)} className="flex-1 py-2 bg-white/5 text-slate-400 text-sm rounded-lg hover:bg-white/10 transition-colors">
              Request Changes
            </button>
          </div>
        )}
        <button onClick={handleSaveAsTemplate} className="w-full py-2 bg-white/5 text-slate-400 text-sm rounded-lg hover:bg-white/10 transition-colors">
          Save as Template
        </button>
      </div>

      {/* Delete danger zone */}
      <div className="border-t border-red-500/20 pt-4">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="w-full py-2 bg-red-500/10 text-red-400 text-sm rounded-lg hover:bg-red-500/20 disabled:opacity-40 transition-colors"
        >
          {deleting ? 'Deleting...' : 'Delete Board'}
        </button>
      </div>
    </div>
  );
};

// ── Suggestions mode ────────────────────────────────────────────────────────

const SuggestionsMode = ({ list, tenantId, onAddItems }) => {
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await getSmartSuggestions(list.trip_id, tenantId, []);
        if (!cancelled) setSuggestions(data);
      } catch {
        if (!cancelled) setSuggestions({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [list.trip_id, tenantId]);

  const handleAdd = async (items) => {
    const newItems = items.map(s => ({
      list_id: list.id,
      name: s.name,
      brand: s.brand || '',
      size: s.size || '',
      category: s.category || '',
      sub_category: s.sub_category || '',
      department: s.department || 'Galley',
      quantity_ordered: s.quantity || s.avg_quantity || 1,
      unit: s.unit || 'each',
      estimated_unit_cost: s.estimated_unit_cost || '',
      allergen_flags: s.allergen_flags || [],
      source: s.source || 'suggestion',
      notes: s.reason || '',
      item_notes: '',
      status: 'pending',
    }));
    try {
      const saved = await upsertItems(newItems);
      onAddItems(list.id, saved);
    } catch {
      // silent
    }
  };

  return <SmartSuggestionsPanel suggestions={suggestions} onAdd={handleAdd} onAddAll={handleAdd} loading={loading} />;
};

// ── Templates & History mode ─────────────────────────────────────────────────

const TemplatesMode = ({ list, tenantId, onAddItems }) => {
  const [tab, setTab] = useState('templates');
  const [templates, setTemplates] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [tpl, hist] = await Promise.all([fetchTemplates(tenantId), fetchMasterOrderHistory(tenantId)]);
        if (!cancelled) { setTemplates(tpl); setHistory(hist); }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  const handleApplyTemplate = async (tpl) => {
    try {
      const items = await fetchListItems(tpl.id);
      const newItems = items.map(({ id, created_at, ...rest }) => ({
        ...rest,
        list_id: list.id,
        status: 'pending',
        quantity_received: null,
      }));
      if (newItems.length) {
        const saved = await upsertItems(newItems);
        onAddItems(list.id, saved);
      }
    } catch {
      // silent
    }
  };

  const handleAddHistoryItem = async (histItem) => {
    const newItem = {
      list_id: list.id,
      name: histItem.name,
      brand: histItem.brand || '',
      size: histItem.size || '',
      category: histItem.category || '',
      sub_category: histItem.sub_category || '',
      department: histItem.department || 'Galley',
      quantity_ordered: histItem.last_quantity || histItem.avg_quantity || 1,
      unit: histItem.unit || 'each',
      source: 'history',
      status: 'pending',
    };
    try {
      const saved = await upsertItems([newItem]);
      onAddItems(list.id, saved);
    } catch {
      // silent
    }
  };

  const q = search.toLowerCase();
  const filteredHistory = q ? history.filter(h => h.name?.toLowerCase().includes(q)) : history;

  const inputCls = 'w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#4A90E2] transition-colors';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="w-5 h-5 border-2 border-[#4A90E2] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-slate-400">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
        {['templates', 'history'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${tab === t ? 'bg-[#4A90E2]/20 text-[#4A90E2] font-medium' : 'text-slate-400 hover:text-white'}`}
          >
            {t === 'templates' ? 'Templates' : 'Order History'}
          </button>
        ))}
      </div>

      {tab === 'templates' ? (
        <div className="space-y-2">
          {templates.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">No templates saved yet.</p>
          )}
          {templates.map(tpl => (
            <div key={tpl.id} className="bg-white/5 border border-white/8 rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{tpl.title}</p>
                <p className="text-xs text-slate-400">{tpl.department || 'All departments'}</p>
              </div>
              <button
                onClick={() => handleApplyTemplate(tpl)}
                className="px-3 py-1.5 bg-[#4A90E2]/20 text-[#4A90E2] text-xs font-medium rounded-lg hover:bg-[#4A90E2]/30 transition-colors"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search past orders..."
            className={inputCls}
          />
          {filteredHistory.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">No order history found.</p>
          )}
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {filteredHistory.slice(0, 100).map((h, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-2 hover:bg-white/5 rounded-lg transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{h.name}</p>
                  <p className="text-xs text-slate-500">
                    Ordered {h.times_ordered}x · avg {h.avg_quantity} {h.unit}
                    {h.brand ? ` · ${h.brand}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleAddHistoryItem(h)}
                  className="ml-2 px-2 py-1 text-xs text-[#4A90E2] hover:bg-[#4A90E2]/10 rounded transition-colors"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main BoardDrawer ─────────────────────────────────────────────────────────

const DRAWER_TITLES = {
  edit: 'Board Details',
  suggestions: 'Smart Suggestions',
  templates: 'Templates & History',
};

const BoardDrawer = ({ open, mode, list, suppliers, trips, tenantId, onSaved, onDeleted, onAddItems, onClose }) => {
  if (!list) return null;

  return (
    <Drawer open={open} onClose={onClose} title={DRAWER_TITLES[mode] || 'Board'}>
      {mode === 'edit' && (
        <EditMode
          list={list}
          suppliers={suppliers}
          trips={trips}
          tenantId={tenantId}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onClose={onClose}
        />
      )}
      {mode === 'suggestions' && (
        <SuggestionsMode list={list} tenantId={tenantId} onAddItems={onAddItems} />
      )}
      {mode === 'templates' && (
        <TemplatesMode list={list} tenantId={tenantId} onAddItems={onAddItems} />
      )}
    </Drawer>
  );
};

export default BoardDrawer;
