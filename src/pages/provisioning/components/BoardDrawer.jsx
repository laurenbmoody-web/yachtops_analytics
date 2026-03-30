import React, { useState, useEffect, useMemo } from 'react';
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
  formatCurrency,
} from '../utils/provisioningStorage';
import { getSmartSuggestions } from '../../../utils/provisioningSuggestions';

// ── Edit mode ────────────────────────────────────────────────────────────────

const EditMode = ({ list, suppliers, trips, tenantId, departments = [], onSaved, onDeleted, onClose }) => {
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
    visibility: 'private',
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
        visibility: list.visibility || (list.is_private ? 'private' : 'shared'),
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
        visibility: form.visibility,
        is_private: form.visibility === 'private',
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
          {departments.length === 0
            ? <span className="text-xs text-slate-500 italic">No departments configured</span>
            : departments.map(d => {
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
              })
          }
        </div>
      </div>

      {/* Supplier */}
      <div>
        <label className={labelCls}>Supplier</label>
        <select value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)} className={inputCls}>
          <option value="">No supplier</option>
          {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Port */}
      <div>
        <label className={labelCls}>Port / Location</label>
        <input value={form.port_location} onChange={e => set('port_location', e.target.value)} className={inputCls} placeholder="e.g. Palma, FR" />
      </div>

      {/* Order by date */}
      <div>
        <label className={labelCls}>Order By Date</label>
        <input type="date" value={form.order_by_date} onChange={e => set('order_by_date', e.target.value)} className={inputCls} />
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

      {/* Visibility */}
      <div>
        <label className={labelCls}>Visibility</label>
        <select
          value={form.visibility}
          onChange={e => set('visibility', e.target.value)}
          className={inputCls}
        >
          <option value="private">Private — only me</option>
          <option value="department">My department</option>
          <option value="shared">Shared — collaborators &amp; link holders</option>
        </select>
        <p className="text-xs text-slate-500 mt-1">
          {form.visibility === 'private' && 'Only you (and COMMAND) can see this board.'}
          {form.visibility === 'department' && 'Everyone in your department can see this board.'}
          {form.visibility === 'shared' && 'Visible to people you invite or share a link with.'}
        </p>
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

  // Templates tab
  const [previewTplId, setPreviewTplId] = useState(null);
  const [previewItems, setPreviewItems] = useState({});
  const [previewLoading, setPreviewLoading] = useState({});

  // History tab
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [infoPopover, setInfoPopover] = useState(null);

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

  const handlePreviewToggle = async (tplId) => {
    if (previewTplId === tplId) { setPreviewTplId(null); return; }
    setPreviewTplId(tplId);
    if (!previewItems[tplId]) {
      setPreviewLoading(prev => ({ ...prev, [tplId]: true }));
      try {
        const items = await fetchListItems(tplId);
        setPreviewItems(prev => ({ ...prev, [tplId]: items }));
      } catch {
        setPreviewItems(prev => ({ ...prev, [tplId]: [] }));
      } finally {
        setPreviewLoading(prev => ({ ...prev, [tplId]: false }));
      }
    }
  };

  // History helpers
  const histKey = (h) => `${h.name}|${h.brand || ''}|${h.size || ''}`;

  const groupedHistory = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? history.filter(h =>
          h.name?.toLowerCase().includes(q) ||
          h.brand?.toLowerCase().includes(q) ||
          h.category?.toLowerCase().includes(q)
        )
      : history;
    const groups = {};
    filtered.forEach(h => {
      const dept = h.department || 'Other';
      const cat = h.category || 'Uncategorised';
      if (!groups[dept]) groups[dept] = {};
      if (!groups[dept][cat]) groups[dept][cat] = [];
      groups[dept][cat].push(h);
    });
    return groups;
  }, [history, search]);

  const deptKeys = (dept) =>
    Object.values(groupedHistory[dept] || {}).flat().map(histKey);

  const toggleCheck = (key) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectAllDept = (dept, check) => {
    const keys = deptKeys(dept);
    setCheckedItems(prev => {
      const next = new Set(prev);
      keys.forEach(k => (check ? next.add(k) : next.delete(k)));
      return next;
    });
  };

  const handleAddSelected = async () => {
    const allHistItems = Object.values(groupedHistory).flatMap(cats => Object.values(cats).flat());
    const toAdd = allHistItems.filter(h => checkedItems.has(histKey(h)));
    const newItems = toAdd.map(h => ({
      list_id: list.id,
      name: h.name,
      brand: h.brand || '',
      size: h.size || '',
      category: h.category || '',
      sub_category: h.sub_category || '',
      department: h.department || '',
      unit: h.unit || 'each',
      quantity_ordered: null,
      source: 'history',
      status: 'pending',
    }));
    try {
      const saved = await upsertItems(newItems);
      onAddItems(list.id, saved);
      setCheckedItems(new Set());
    } catch {
      // silent
    }
  };

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
          {templates.map(tpl => {
            const depts = Array.isArray(tpl.department)
              ? tpl.department.filter(Boolean)
              : tpl.department ? [tpl.department] : [];
            const isPreviewing = previewTplId === tpl.id;
            const pItems = previewItems[tpl.id];
            return (
              <div key={tpl.id} className="bg-white/5 border border-white/8 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{tpl.title}</p>
                    {depts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {depts.map(d => (
                          <span key={d} className="text-[10px] px-1.5 py-0.5 bg-white/10 text-slate-400 rounded">{d}</span>
                        ))}
                      </div>
                    )}
                    {isPreviewing && pItems && (
                      <p className="text-[10px] text-slate-500 mt-1">{pItems.length} item{pItems.length !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handlePreviewToggle(tpl.id)}
                      className="px-2.5 py-1.5 bg-white/5 text-slate-400 text-xs rounded-lg hover:bg-white/10 transition-colors"
                    >
                      {isPreviewing ? 'Hide' : 'Preview'}
                    </button>
                    <button
                      onClick={() => handleApplyTemplate(tpl)}
                      className="px-3 py-1.5 bg-[#4A90E2]/20 text-[#4A90E2] text-xs font-medium rounded-lg hover:bg-[#4A90E2]/30 transition-colors"
                    >
                      Use template
                    </button>
                  </div>
                </div>
                {isPreviewing && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    {previewLoading[tpl.id] ? (
                      <p className="text-xs text-slate-500">Loading items…</p>
                    ) : !pItems || pItems.length === 0 ? (
                      <p className="text-xs text-slate-500">No items in this template.</p>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {pItems.map(item => (
                          <p key={item.id} className="text-xs text-slate-400">
                            {item.name}
                            {item.brand ? ` · ${item.brand}` : ''}
                            {item.size ? ` · ${item.size}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, brand or category…"
            className={inputCls}
          />

          {/* Add selected — sticky at top when any checked */}
          {checkedItems.size > 0 && (
            <button
              onClick={handleAddSelected}
              className="w-full py-2 bg-[#4A90E2] text-white text-sm font-medium rounded-lg hover:bg-[#4A90E2]/80 transition-colors"
            >
              Add {checkedItems.size} selected item{checkedItems.size !== 1 ? 's' : ''}
            </button>
          )}

          {Object.keys(groupedHistory).length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6">No order history found.</p>
          )}

          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {Object.entries(groupedHistory).map(([dept, cats]) => {
              const allDeptKeys = deptKeys(dept);
              const allDeptChecked = allDeptKeys.length > 0 && allDeptKeys.every(k => checkedItems.has(k));
              return (
                <div key={dept}>
                  {/* Department header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{dept}</span>
                    <button
                      onClick={() => selectAllDept(dept, !allDeptChecked)}
                      className="text-[10px] text-[#4A90E2] hover:underline"
                    >
                      {allDeptChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>

                  {Object.entries(cats).map(([cat, items]) => (
                    <div key={cat} className="mb-3">
                      <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wide mb-1 pl-1">{cat}</p>
                      {items.map(h => {
                        const key = histKey(h);
                        const isChecked = checkedItems.has(key);
                        const lastDate = h.last_ordered_date
                          ? new Date(h.last_ordered_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
                          : null;
                        return (
                          <div key={key} className="flex items-start gap-2 py-1.5 px-1 hover:bg-white/5 rounded-lg transition-colors">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCheck(key)}
                              className="mt-1 flex-shrink-0 accent-[#4A90E2]"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white leading-snug">{h.name}</p>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                {h.brand && <span className="text-xs text-slate-500">{h.brand}</span>}
                                {h.size && <span className="text-xs text-slate-500">{h.size}</span>}
                                <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-slate-500 rounded">{dept}</span>
                                <span className="text-[10px] text-slate-600">×{h.times_ordered}</span>
                                {lastDate && <span className="text-[10px] text-slate-600">{lastDate}</span>}
                              </div>
                            </div>
                            {/* Info popover */}
                            <div className="relative flex-shrink-0">
                              <button
                                onMouseEnter={() => setInfoPopover(key)}
                                onMouseLeave={() => setInfoPopover(null)}
                                className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
                              >
                                <Icon name="Info" className="w-3.5 h-3.5" />
                              </button>
                              {infoPopover === key && (
                                <div
                                  className="absolute right-0 bottom-7 z-20 rounded-lg shadow-xl text-xs text-slate-300 whitespace-nowrap"
                                  style={{ background: '#1a2540', border: '1px solid rgba(255,255,255,0.12)', padding: '8px 12px' }}
                                >
                                  <p>Last qty: {h.last_quantity != null ? `${h.last_quantity} ${h.unit}` : '—'}</p>
                                  <p>Avg qty: {h.avg_quantity != null ? `${h.avg_quantity} ${h.unit}` : '—'}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
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

const BoardDrawer = ({ open, mode, list, suppliers, trips, tenantId, departments = [], onSaved, onDeleted, onAddItems, onClose }) => {
  if (!list) return null;

  return (
    <Drawer open={open} onClose={onClose} title={DRAWER_TITLES[mode] || 'Board'}>
      {mode === 'edit' && (
        <EditMode
          list={list}
          suppliers={suppliers}
          trips={trips}
          tenantId={tenantId}
          departments={departments}
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
