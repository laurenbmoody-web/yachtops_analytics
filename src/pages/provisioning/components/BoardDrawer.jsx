import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import SmartSuggestionsPanel from './SmartSuggestionsPanel';
import StatusBadge, { STATUS_CONFIG } from './StatusBadge';
import { BOARD_TYPES } from '../data/templates';
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

// Sprint 9c.1a follow-up — interim restyle of the drawer body content for
// the white card surface. Replaces dark-theme Tailwind classes with
// concrete editorial-language values so the form is usable on /provisioning.
// Sprint 9c.5 (modal/drawer pass) will rewrite this properly in the
// editorial pattern; the bd-* classes below are deliberately throwaway
// scaffolding to make the existing JSX readable in the meantime.
const BD_STYLES = `
.bd-input {
  width: 100%;
  background: #FAF7F0;
  border: 1px solid rgba(30, 39, 66, 0.12);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: #1E2742;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.bd-input::placeholder { color: rgba(30, 39, 66, 0.35); }
.bd-input:focus { border-color: #C65A1A; }
.bd-input:disabled { opacity: 0.5; }
.bd-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: rgba(30, 39, 66, 0.55);
  margin-bottom: 4px;
}
.bd-pill {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid rgba(30, 39, 66, 0.08);
  background: rgba(30, 39, 66, 0.04);
  color: #1E2742;
  transition: all 0.15s;
  cursor: pointer;
}
.bd-pill:hover { background: rgba(30, 39, 66, 0.08); }
.bd-pill-active {
  background: #FEF3E8;
  border-color: #C65A1A;
  color: #C65A1A;
  font-weight: 500;
}
.bd-pill-active:hover { background: #FCE6D2; }
.bd-card {
  background: #FAF7F0;
  border: 1px solid rgba(30, 39, 66, 0.08);
  border-radius: 8px;
  padding: 12px;
}
.bd-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(30, 39, 66, 0.06);
  color: rgba(30, 39, 66, 0.7);
}
.bd-muted        { color: rgba(30, 39, 66, 0.55); }
.bd-strong       { color: #1E2742; }
.bd-faint        { color: rgba(30, 39, 66, 0.4); }
.bd-divider      { border-top: 1px solid rgba(30, 39, 66, 0.08); }
.bd-row-hover:hover { background: rgba(30, 39, 66, 0.04); }
.bd-tab-bar {
  display: flex;
  gap: 4px;
  background: rgba(30, 39, 66, 0.04);
  border-radius: 8px;
  padding: 2px;
}
.bd-tab {
  flex: 1;
  padding: 6px 0;
  font-size: 14px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: rgba(30, 39, 66, 0.55);
  cursor: pointer;
  transition: all 0.15s;
}
.bd-tab:hover { color: #1E2742; }
.bd-tab-active {
  background: #FFFFFF;
  color: #C65A1A;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(30, 39, 66, 0.06);
}
.bd-btn-secondary {
  width: 100%;
  padding: 8px 0;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid rgba(30, 39, 66, 0.12);
  background: #FFFFFF;
  color: #1E2742;
  cursor: pointer;
  transition: all 0.15s;
}
.bd-btn-secondary:hover { background: #FAF7F0; }
.bd-btn-primary {
  width: 100%;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  border: 0;
  background: #1E2742;
  color: #FFFFFF;
  cursor: pointer;
  transition: opacity 0.15s;
}
.bd-btn-primary:hover { opacity: 0.9; }
.bd-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.bd-btn-accent {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid #C65A1A;
  background: #FEF3E8;
  color: #C65A1A;
  cursor: pointer;
  transition: all 0.15s;
}
.bd-btn-accent:hover { background: #FCE6D2; }
.bd-btn-danger {
  width: 100%;
  padding: 8px 0;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.2);
  background: rgba(254, 242, 242, 0.6);
  color: #B91C1C;
  cursor: pointer;
  transition: background 0.15s;
}
.bd-btn-danger:hover { background: rgba(254, 226, 226, 0.7); }
.bd-btn-danger:disabled { opacity: 0.4; cursor: not-allowed; }
.bd-btn-status-warn {
  width: 100%;
  padding: 8px 0;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid rgba(217, 119, 6, 0.25);
  background: rgba(254, 243, 199, 0.5);
  color: #B45309;
  cursor: pointer;
  transition: background 0.15s;
}
.bd-btn-status-warn:hover { background: rgba(254, 243, 199, 0.85); }
.bd-btn-status-go {
  flex: 1;
  padding: 8px 0;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid rgba(30, 64, 175, 0.2);
  background: rgba(219, 234, 254, 0.5);
  color: #1E40AF;
  cursor: pointer;
  transition: background 0.15s;
}
.bd-btn-status-go:hover { background: rgba(219, 234, 254, 0.85); }
`;


// ── Edit mode ────────────────────────────────────────────────────────────────

const EditMode = ({ list, suppliers, trips, tenantId, departments = [], onSaved, onDeleted, onClose }) => {
  const [form, setForm] = useState({
    title: '',
    board_type: 'general',
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
  const [saveError, setSaveError] = useState(null);

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
        board_type: list.board_type || 'general',
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
      setSaveError(null);
    }
  }, [list]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      // department stored as text[] in DB — convert comma-string → array
      const deptArray = form.department
        ? form.department.split(',').map(d => d.trim()).filter(Boolean)
        : [];
      const updated = await updateProvisioningList(list.id, {
        title: form.title.trim(),
        board_type: form.board_type || 'general',
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
    } catch (err) {
      // Surface the error so the user sees it instead of a silent no-op.
      // Previously caught and dropped — the dev error Lauren spotted in
      // the console had no UI feedback.
      console.error('[BoardDrawer.EditMode] save error:', err);
      setSaveError(err?.message || String(err) || 'Save failed');
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

  const inputCls = 'bd-input';
  const labelCls = 'bd-label';

  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <label className={labelCls}>Board Title *</label>
        <input value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} placeholder="e.g. Weekly Galley Order" />
      </div>

      {/* Board type — Sprint 9c.1a.1 */}
      <div>
        <label className={labelCls}>Board type</label>
        <select value={form.board_type} onChange={e => set('board_type', e.target.value)} className={inputCls}>
          {BOARD_TYPES.map(bt => (
            <option key={bt.value} value={bt.value}>{bt.label}</option>
          ))}
        </select>
      </div>

      {/* Trip */}
      <div>
        <label className={labelCls}>Linked Trip</label>
        <select value={form.trip_id} onChange={e => set('trip_id', e.target.value)} className={inputCls}>
          <option value="">None</option>
          {/* Use the canonical Supabase UUID as the option value so the
              dropdown matches existing list.trip_id (uuid) and so a new
              selection sends a uuid on save. Falls back to legacy id
              for LS-only pending-sync trips. */}
          {(trips || []).map(t => (
            <option key={t.id} value={t.supabaseId || t.id}>
              {t.title || t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Departments */}
      <div>
        <label className={labelCls}>Departments</label>
        <div className="flex flex-wrap gap-2">
          {departments.length === 0
            ? <span className="text-xs italic bd-faint">No departments configured</span>
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
                    className={`bd-pill${selected ? ' bd-pill-active' : ''}`}
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
        <p className="text-xs mt-1 bd-faint">
          {form.visibility === 'private' && 'Only you (and COMMAND) can see this board.'}
          {form.visibility === 'department' && 'Everyone in your department can see this board.'}
          {form.visibility === 'shared' && 'Visible to people you invite or share a link with.'}
        </p>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !form.title.trim()}
        className="bd-btn-primary"
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
      {saveError && (
        <p
          role="alert"
          style={{
            margin: '8px 0 0',
            fontSize: 12,
            color: '#B91C1C',
            background: 'rgba(254, 242, 242, 0.6)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: 6,
            padding: '8px 10px',
            lineHeight: 1.4,
          }}
        >
          Save failed: {saveError}
        </p>
      )}

      {/* Status actions */}
      <div className="bd-divider pt-4 space-y-2">
        <p className="text-xs font-medium mb-2 bd-muted">Status Actions</p>
        <div className="flex items-center gap-2 mb-2">
          <StatusBadge status={list.status} />
        </div>
        {list.status === PROVISIONING_STATUS.DRAFT && (
          <button onClick={() => handleStatusChange(PROVISIONING_STATUS.PENDING_APPROVAL)} className="bd-btn-status-warn">
            Submit for Approval
          </button>
        )}
        {list.status === PROVISIONING_STATUS.PENDING_APPROVAL && (
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange(PROVISIONING_STATUS.SENT_TO_SUPPLIER)} className="bd-btn-status-go">
              Approve & Send
            </button>
            <button onClick={() => handleStatusChange(PROVISIONING_STATUS.DRAFT)} className="bd-btn-secondary" style={{ flex: 1 }}>
              Request Changes
            </button>
          </div>
        )}
        <button onClick={handleSaveAsTemplate} className="bd-btn-secondary">
          Save as Template
        </button>
      </div>

      {/* Delete danger zone */}
      <div className="pt-4" style={{ borderTop: '1px solid rgba(220, 38, 38, 0.15)' }}>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="bd-btn-danger"
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

  const inputCls = 'bd-input';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#C65A1A', borderTopColor: 'transparent' }} />
        <span className="text-sm bd-muted">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="bd-tab-bar">
        {['templates', 'history'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`bd-tab${tab === t ? ' bd-tab-active' : ''}`}
          >
            {t === 'templates' ? 'Templates' : 'Order History'}
          </button>
        ))}
      </div>

      {tab === 'templates' ? (
        <div className="space-y-2">
          {templates.length === 0 && (
            <p className="text-sm text-center py-6 bd-muted">No templates saved yet.</p>
          )}
          {templates.map(tpl => {
            const depts = Array.isArray(tpl.department)
              ? tpl.department.filter(Boolean)
              : tpl.department ? [tpl.department] : [];
            const isPreviewing = previewTplId === tpl.id;
            const pItems = previewItems[tpl.id];
            return (
              <div key={tpl.id} className="bd-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium bd-strong">{tpl.title}</p>
                    {depts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {depts.map(d => (
                          <span key={d} className="bd-tag">{d}</span>
                        ))}
                      </div>
                    )}
                    {isPreviewing && pItems && (
                      <p className="text-[10px] mt-1 bd-faint">{pItems.length} item{pItems.length !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handlePreviewToggle(tpl.id)}
                      className="bd-btn-secondary"
                      style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}
                    >
                      {isPreviewing ? 'Hide' : 'Preview'}
                    </button>
                    <button
                      onClick={() => handleApplyTemplate(tpl)}
                      className="bd-btn-accent"
                    >
                      Use template
                    </button>
                  </div>
                </div>
                {isPreviewing && (
                  <div className="mt-3 bd-divider pt-3">
                    {previewLoading[tpl.id] ? (
                      <p className="text-xs bd-muted">Loading items…</p>
                    ) : !pItems || pItems.length === 0 ? (
                      <p className="text-xs bd-muted">No items in this template.</p>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {pItems.map(item => (
                          <p key={item.id} className="text-xs bd-muted">
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
              className="bd-btn-primary"
            >
              Add {checkedItems.size} selected item{checkedItems.size !== 1 ? 's' : ''}
            </button>
          )}

          {Object.keys(groupedHistory).length === 0 && (
            <p className="text-sm text-center py-6 bd-muted">No order history found.</p>
          )}

          <div className="space-y-5 overflow-y-auto pr-1" style={{ maxHeight: '60vh' }}>
            {Object.entries(groupedHistory).map(([dept, cats]) => {
              const allDeptKeys = deptKeys(dept);
              const allDeptChecked = allDeptKeys.length > 0 && allDeptKeys.every(k => checkedItems.has(k));
              return (
                <div key={dept}>
                  {/* Department header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider bd-muted">{dept}</span>
                    <button
                      onClick={() => selectAllDept(dept, !allDeptChecked)}
                      className="text-[10px] hover:underline"
                      style={{ color: '#C65A1A', background: 'none', border: 0, cursor: 'pointer' }}
                    >
                      {allDeptChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>

                  {Object.entries(cats).map(([cat, items]) => (
                    <div key={cat} className="mb-3">
                      <p className="text-[10px] font-medium uppercase tracking-wide mb-1 pl-1 bd-faint">{cat}</p>
                      {items.map(h => {
                        const key = histKey(h);
                        const isChecked = checkedItems.has(key);
                        const lastDate = h.last_ordered_date
                          ? new Date(h.last_ordered_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
                          : null;
                        return (
                          <div key={key} className="flex items-start gap-2 py-1.5 px-1 rounded-lg transition-colors bd-row-hover">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCheck(key)}
                              className="mt-1 flex-shrink-0"
                              style={{ accentColor: '#C65A1A' }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm leading-snug bd-strong">{h.name}</p>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                {h.brand && <span className="text-xs bd-muted">{h.brand}</span>}
                                {h.size && <span className="text-xs bd-muted">{h.size}</span>}
                                <span className="bd-tag">{dept}</span>
                                <span className="text-[10px] bd-faint">×{h.times_ordered}</span>
                                {lastDate && <span className="text-[10px] bd-faint">{lastDate}</span>}
                              </div>
                            </div>
                            {/* Info popover */}
                            <div className="relative flex-shrink-0">
                              <button
                                onMouseEnter={() => setInfoPopover(key)}
                                onMouseLeave={() => setInfoPopover(null)}
                                className="p-1 transition-colors bd-faint"
                                style={{ background: 'none', border: 0, cursor: 'pointer' }}
                              >
                                <Icon name="Info" className="w-3.5 h-3.5" />
                              </button>
                              {infoPopover === key && (
                                <div
                                  className="absolute right-0 bottom-7 z-20 rounded-lg shadow-xl text-xs whitespace-nowrap"
                                  style={{ background: '#FFFFFF', border: '1px solid rgba(30, 39, 66, 0.12)', padding: '8px 12px', color: '#1E2742' }}
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
      <style>{BD_STYLES}</style>
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
