import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Drawer from './Drawer';
import SmartSuggestionsPanel from './SmartSuggestionsPanel';
import StatusBadge from './StatusBadge';
import SelectionCheckbox from './SelectionCheckbox';
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
  fetchQuickAddFavourites,
  applyOrderItems,
  fetchPastOrders,
  fetchSupplierOrderItems,
  PROVISIONING_STATUS,
  formatCurrency,
} from '../utils/provisioningStorage';
import { getSmartSuggestions } from '../../../utils/provisioningSuggestions';
import { showToast } from '../../../utils/toast';
import { useAuth } from '../../../contexts/AuthContext';
import { toggleSupplierOrderFavourite } from '../utils/provisioningStorage';

// Sprint 9c.1a follow-up — interim restyle of the drawer body content for
// the white card surface. Replaces dark-theme Tailwind classes with
// concrete editorial-language values so the form is usable on /provisioning.
// Sprint 9c.5 (modal/drawer pass) will rewrite this properly in the
// editorial pattern; the bd-* classes below are deliberately throwaway
// scaffolding to make the existing JSX readable in the meantime.
const BD_STYLES = `
.bd-input {
  width: 100%;
  background: #F1F5F9;
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
  background: #F1F5F9;
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
.bd-btn-secondary:hover { background: #F1F5F9; }
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

const EditMode = ({ list, items = [], trips, tenantId, departments = [], onSaved, onDeleted, onClose, onDirtyChange, onBusyChange }) => {
  const [form, setForm] = useState({
    title: '',
    board_type: 'general',
    trip_id: '',
    department: '',
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
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        currency: form.currency,
        notes: form.notes,
        visibility: form.visibility,
        is_private: form.visibility === 'private',
      });
      onSaved(updated);
      showToast('Board saved', 'success');
      onClose?.();
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
    } catch (err) {
      console.error('[BoardDrawer.EditMode] status change error:', err);
      showToast(`Couldn't change status — ${err?.message || err}`, 'error');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${list.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteProvisioningList(list.id);
      onDeleted(list.id);
      onClose();
    } catch (err) {
      console.error('[BoardDrawer.handleDelete] error:', err);
      showToast(`Couldn't delete board — ${err?.message || err}`, 'error');
      setDeleting(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    try {
      await saveAsTemplate(list.id, true);
      onSaved({ ...list, is_template: true });
    } catch (err) {
      console.error('[BoardDrawer.handleSaveAsTemplate] error:', err);
      showToast(`Couldn't save as template — ${err?.message || err}`, 'error');
    }
  };

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  // Dirty signal — any form field differs from the loaded list (using the
  // same fallbacks the hydrate effect applies, so a freshly-opened drawer
  // reads clean). Published to BoardDrawer so it can pass it to Drawer's
  // close gate.
  const isDirty = !!list && (
    form.title !== (list.title || '') ||
    form.board_type !== (list.board_type || 'general') ||
    form.trip_id !== (list.trip_id || '') ||
    form.department !== normDept(list.department) ||
    form.estimated_cost !== (list.estimated_cost || '') ||
    form.currency !== (list.currency || 'USD') ||
    form.notes !== (list.notes || '') ||
    form.visibility !== (list.visibility || (list.is_private ? 'private' : 'shared'))
  );
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(saving || deleting); }, [saving, deleting, onBusyChange]);

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
              Approve &amp; Send to Supplier
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
      } catch (err) {
        console.error('[BoardDrawer.SuggestionsMode] load error:', err);
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
      status: 'draft',
    }));
    try {
      const saved = await upsertItems(newItems);
      onAddItems(list.id, saved);
      showToast(`Added ${saved.length} suggestion${saved.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      console.error('[BoardDrawer.SuggestionsMode] handleAdd error:', err);
      showToast(`Couldn't add suggestions — ${err?.message || err}`, 'error');
    }
  };

  return <SmartSuggestionsPanel suggestions={suggestions} onAdd={handleAdd} onAddAll={handleAdd} loading={loading} />;
};

// ── Quick Add mode ───────────────────────────────────────────────────────────
// Hosts three discrete sources for adding items onto a board:
//   • Favourites    — CHIEF/HOD-starred whole supplier_orders. Dept-scoped
//                     via the get_quick_add_favourites RPC. Apply-favourite
//                     restores the strict snapshot persisted on
//                     supplier_order_items (brand / size / dept / etc).
//   • Templates     — user-saved boards (provisioning_lists.is_template).
//   • Order History — frequently-ordered items aggregated across past
//                     boards. Multi-select with checkboxes.
//
// Tabs are the right primitive for three discrete sources. Favourites is
// the default tab (highest expected traffic — "re-order what worked"
// outweighs "load a generic template" or "browse past items").

const TemplatesMode = ({ list, tenantId, onAddItems }) => {
  // Tabs (in render order): Past Orders / Favourites / Frequent Items / Templates.
  // Past Orders is the default surface — most-recent-orders is the highest
  // expected traffic for "what should I add now?" Favourites is curated
  // memory; Frequent Items is aggregated signal; Templates is structured
  // pre-builds. Past Orders sits front because it's chronological + the
  // freshest mental model.
  const [tab, setTab] = useState('past');
  const [pastOrders, setPastOrders] = useState([]);
  const [favourites, setFavourites] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Templates tab
  const [previewTplId, setPreviewTplId] = useState(null);
  const [previewItems, setPreviewItems] = useState({});
  const [previewLoading, setPreviewLoading] = useState({});

  // Favourites tab — per-card busy state so a slow Apply doesn't block
  // sibling cards.
  const [applyingFavId, setApplyingFavId] = useState(null);

  // Past Orders tab — per-card busy state, same shape as applyingFavId.
  // Tracks which order's "Apply all" call is in flight.
  const [applyingPastId, setApplyingPastId] = useState(null);
  // Per-card star toggle in-flight state. Lets the affected card grey
  // its star briefly without freezing sibling stars.
  const [favouritingPastId, setFavouritingPastId] = useState(null);
  // Single-expand UX: one card open at a time (mirrors Templates preview).
  // Switching to a different card collapses the previous one.
  const [expandedPastId, setExpandedPastId] = useState(null);
  // Lazy-load cache of supplier_order_items per order id — keys are
  // order ids, values are arrays of { id, item_name, brand, size,
  // quantity, unit }. First expand fetches; subsequent expands of
  // the same card hit cache.
  const [pastItemsCache, setPastItemsCache] = useState({});
  const [pastItemsLoading, setPastItemsLoading] = useState({});
  // Per-card checkbox selection — keyed by order id, value is a Set of
  // selected supplier_order_items.id values. Cleared on successful
  // "Add N selected" so the user can iterate.
  const [pastChecked, setPastChecked] = useState({});

  // Frequent Items tab (renamed from Order History — see brief)
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [infoPopover, setInfoPopover] = useState(null);

  // Tier + dept context. Drives two things:
  //   1. UI gate for the Past Orders star toggle. Server-side
  //      toggle_supplier_order_favourite RPC is the real gate
  //      (COMMAND any-dept; CHIEF must dept-intersect). HOD gets the
  //      affordance even though their toggle gets rejected — surfaces
  //      the rejection as a toast (cleaner than silently hiding).
  //   2. Dept-scoping for Frequent Items. Non-COMMAND callers see only
  //      their own dept; COMMAND sees tenant-wide. Mirrors the
  //      Favourites/Past Orders RPC pattern in JS.
  const { user, tenantRole } = useAuth();
  const userTier = (tenantRole || '').toUpperCase();
  const userDeptName = user?.department || null;
  const isCommand = userTier === 'COMMAND';
  const canFavouriteOrder = ['COMMAND', 'CHIEF', 'HOD'].includes(userTier);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [past, favs, tpl, hist] = await Promise.all([
          fetchPastOrders(tenantId).catch(() => []),
          fetchQuickAddFavourites(tenantId).catch(() => []),
          fetchTemplates(tenantId),
          // Dept-scope Frequent Items in JS (no RPC needed — the helper
          // gained an options arg in 3b22cb8). COMMAND sees tenant-wide;
          // others see only their dept's frequently-ordered items.
          fetchMasterOrderHistory(tenantId, { userDeptName, isCommand }),
        ]);
        if (!cancelled) {
          setPastOrders(past);
          setFavourites(favs);
          setTemplates(tpl);
          setHistory(hist);
        }
      } catch (err) {
        // Read path — won't violate the no-silent-write-catch rule but log
        // so failures aren't invisible during dev.
        console.error('[Quick Add] load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // Refetch if dept context changes — AuthContext may resolve after
    // first mount, in which case Frequent Items would otherwise stay
    // tenant-wide for the user's first session. Past Orders + Favourites
    // are dept-scoped server-side so they don't strictly need these
    // deps, but keeping them aligned makes the four-pane refresh atomic.
  }, [tenantId, userDeptName, isCommand]);

  const handleApplyFavourite = async (fav) => {
    setApplyingFavId(fav.id);
    try {
      const saved = await applyOrderItems(fav.id, list.id, { source: 'favourite' });
      if (saved && saved.length) {
        onAddItems(list.id, saved);
        showToast(`Added ${saved.length} item${saved.length === 1 ? '' : 's'} from ${fav.supplier_name}`, 'success');
      } else {
        showToast(`No items found on ${fav.supplier_name} — nothing added`, 'error');
      }
    } catch (err) {
      console.error('[Quick Add] applyOrderItems error:', err);
      showToast(`Couldn't add items — ${err.message || err}`, 'error');
    } finally {
      setApplyingFavId(null);
    }
  };

  // Past Orders "Apply all" — applies the whole order's items onto the
  // current board. Same backend as Favourites apply (applyOrderItems is
  // order-agnostic, doesn't check is_favourite). Per-card busy state so
  // applying one order doesn't grey out sibling cards.
  const handleApplyPastOrder = async (order) => {
    setApplyingPastId(order.id);
    try {
      const saved = await applyOrderItems(order.id, list.id);
      if (saved && saved.length) {
        onAddItems(list.id, saved);
        showToast(`Added ${saved.length} item${saved.length === 1 ? '' : 's'} from ${order.supplier_name}`, 'success');
      } else {
        showToast(`No items found on ${order.supplier_name} — nothing added`, 'error');
      }
    } catch (err) {
      console.error('[Quick Add] applyOrderItems (past order) error:', err);
      showToast(`Couldn't add items — ${err.message || err}`, 'error');
    } finally {
      setApplyingPastId(null);
    }
  };

  // Toggle a Past Orders card's expanded state. Single-expand: clicking
  // another card collapses the prior. First expand lazy-loads the
  // order's items via fetchSupplierOrderItems; subsequent expands hit
  // the cache (pastItemsCache keyed by order id). Mirrors the existing
  // handlePreviewToggle pattern from the Templates tab.
  const handlePastExpand = async (orderId) => {
    if (expandedPastId === orderId) { setExpandedPastId(null); return; }
    setExpandedPastId(orderId);
    if (!pastItemsCache[orderId]) {
      setPastItemsLoading(prev => ({ ...prev, [orderId]: true }));
      try {
        const items = await fetchSupplierOrderItems(orderId);
        setPastItemsCache(prev => ({ ...prev, [orderId]: items }));
      } catch (err) {
        console.error('[Quick Add] fetchSupplierOrderItems error:', err);
        setPastItemsCache(prev => ({ ...prev, [orderId]: [] }));
      } finally {
        setPastItemsLoading(prev => ({ ...prev, [orderId]: false }));
      }
    }
  };

  // Toggle a specific supplier_order_items.id in the per-card selection
  // Set. Cleared on successful "Add N selected".
  const togglePastItemChecked = (orderId, itemId) => {
    setPastChecked(prev => {
      const cur = prev[orderId] || new Set();
      const next = new Set(cur);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return { ...prev, [orderId]: next };
    });
  };

  // Past Orders star toggle. Optimistic flip locally, revert + toast on
  // RPC rejection. Same pattern as ProvisioningBoardDetail.jsx's
  // handleToggleFavourite — the RPC's error message becomes the toast
  // verbatim so the crew sees exactly why a curate attempt was refused
  // (e.g. "Only the department head can favourite orders").
  //
  // Note: the same RPC is the source of truth for both surfaces. A
  // star toggled here will appear correctly on the order-card star in
  // the Orders tab next time that page loads, and vice versa.
  const handleTogglePastFavourite = async (order) => {
    if (favouritingPastId) return;
    setFavouritingPastId(order.id);
    const next = !order.is_favourite;
    // Optimistic local flip — replace the row in the pastOrders array.
    setPastOrders(prev => prev.map(o => o.id === order.id
      ? { ...o, is_favourite: next, favourited_at: next ? new Date().toISOString() : null }
      : o));
    try {
      await toggleSupplierOrderFavourite(order.id);
    } catch (err) {
      // Revert optimistic flip
      setPastOrders(prev => prev.map(o => o.id === order.id
        ? { ...o, is_favourite: !next, favourited_at: order.favourited_at }
        : o));
      const msg = err?.message || 'Could not update favourite';
      showToast(msg, 'error');
    } finally {
      setFavouritingPastId(null);
    }
  };

  // Past Orders "Add N selected" — applies only the checked subset of
  // an expanded card. Falls through to applyOrderItems with itemIds
  // option (added alongside this commit) to filter server-side.
  const handleApplyPastSelected = async (order) => {
    const checkedSet = pastChecked[order.id];
    if (!checkedSet || checkedSet.size === 0) return;
    setApplyingPastId(order.id);
    try {
      const saved = await applyOrderItems(order.id, list.id, { itemIds: [...checkedSet] });
      if (saved && saved.length) {
        onAddItems(list.id, saved);
        // Clear the selection so the user can iterate (e.g. open a
        // different order and pick from it without stale ticks).
        setPastChecked(prev => ({ ...prev, [order.id]: new Set() }));
        showToast(`Added ${saved.length} item${saved.length === 1 ? '' : 's'} from ${order.supplier_name}`, 'success');
      } else {
        showToast(`Couldn't find the selected items — nothing added`, 'error');
      }
    } catch (err) {
      console.error('[Quick Add] applyOrderItems (past selected) error:', err);
      showToast(`Couldn't add items — ${err.message || err}`, 'error');
    } finally {
      setApplyingPastId(null);
    }
  };

  const handleApplyTemplate = async (tpl) => {
    try {
      const items = await fetchListItems(tpl.id);
      // source: 'template' — provenance tag enabled by the source CHECK
      // relaxation migration (20260612140000). Overrides any source the
      // template's source items had (templates themselves contain items
      // with various original provenances; what matters now is that THIS
      // copy came from a template).
      const newItems = items.map(({ id, created_at, ...rest }) => ({
        ...rest,
        list_id: list.id,
        status: 'draft',
        quantity_received: null,
        source: 'template',
      }));
      if (newItems.length) {
        const saved = await upsertItems(newItems);
        onAddItems(list.id, saved);
        showToast(`Added ${saved.length} item${saved.length === 1 ? '' : 's'} from "${tpl.title}"`, 'success');
      } else {
        showToast(`No items found in "${tpl.title}" — nothing added`, 'error');
      }
    } catch (err) {
      console.error('[Quick Add] applyTemplate error:', err);
      showToast(`Couldn't apply template — ${err.message || err}`, 'error');
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
      } catch (err) {
        console.error('[BoardDrawer.TemplatesMode] preview load error:', err);
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
    // status: 'draft' to match all other Quick Add apply paths (Favourite,
    // Template) — one source of truth for "items applied from Quick Add
    // start as draft". source: 'history' — provenance tag for the
    // Frequent Items / Past Orders aggregator pipeline. Enabled by the
    // source CHECK relaxation migration (20260612140000).
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
      status: 'draft',
      source: 'history',
    }));
    try {
      const saved = await upsertItems(newItems);
      onAddItems(list.id, saved);
      setCheckedItems(new Set());
      showToast(`Added ${saved.length} item${saved.length === 1 ? '' : 's'} from order history`, 'success');
    } catch (err) {
      console.error('[Quick Add] addFromHistory error:', err);
      showToast(`Couldn't add items — ${err.message || err}`, 'error');
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
      {/* Tabs — Past Orders is the default surface (most recent
          dispatched orders, dept-scoped). Order: Past / Favourites /
          Frequent / Templates. See brief: chronological → curated →
          aggregated → pre-built. */}
      <div className="bd-tab-bar">
        {[
          { key: 'past',       label: 'Past Orders' },
          { key: 'favourites', label: 'Favourites' },
          { key: 'frequent',   label: 'Frequent Items' },
          { key: 'templates',  label: 'Templates' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`bd-tab${tab === t.key ? ' bd-tab-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'past' ? (
        <div className="space-y-2">
          {pastOrders.length === 0 && (
            <p className="text-sm text-center py-6 bd-muted">
              No past orders yet. Send an order to a supplier and it'll appear here.
            </p>
          )}
          {pastOrders.map(order => {
            const depts = Array.isArray(order.departments) ? order.departments.filter(Boolean) : [];
            const orderDate = order.sent_at || order.created_at;
            const formattedDate = orderDate
              ? new Date(orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : '';
            const isApplying = applyingPastId === order.id;
            const itemCount = Number(order.item_count) || 0;
            const isExpanded = expandedPastId === order.id;
            const cachedItems = pastItemsCache[order.id];
            const isItemsLoading = !!pastItemsLoading[order.id];
            const checkedSet = pastChecked[order.id] || new Set();
            const checkedCount = checkedSet.size;
            return (
              <div key={order.id} className="bd-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium bd-strong">{order.supplier_name || 'Supplier'}</p>
                      {canFavouriteOrder && (
                        <button
                          type="button"
                          onClick={() => handleTogglePastFavourite(order)}
                          disabled={favouritingPastId === order.id}
                          title={order.is_favourite ? 'Unfavourite this order' : 'Favourite this order'}
                          aria-label={order.is_favourite ? 'Unfavourite' : 'Favourite'}
                          style={{
                            background: 'none',
                            border: 0,
                            padding: '0 2px',
                            cursor: favouritingPastId === order.id ? 'default' : 'pointer',
                            fontSize: 14,
                            lineHeight: 1,
                            color: order.is_favourite ? '#C65A1A' : '#94A3B8',
                            opacity: favouritingPastId === order.id ? 0.5 : 1,
                          }}
                        >
                          {order.is_favourite ? '★' : '☆'}
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] mt-0.5 bd-muted">
                      {itemCount} item{itemCount === 1 ? '' : 's'}
                      {formattedDate ? ` · ${formattedDate}` : ''}
                    </p>
                    {depts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {depts.map(d => (
                          <span key={d} className="bd-tag">{d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0 items-start">
                    <button
                      onClick={() => handlePastExpand(order.id)}
                      disabled={itemCount === 0}
                      className="bd-btn-secondary"
                      style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}
                      title={isExpanded ? 'Hide items' : 'Show items'}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Hide' : 'Items'}
                    </button>
                    <button
                      onClick={() => handleApplyPastOrder(order)}
                      disabled={isApplying || !!applyingPastId || itemCount === 0}
                      className="bd-btn-accent"
                      style={isApplying || applyingPastId ? { opacity: 0.6, cursor: 'default' } : null}
                      title={itemCount === 0 ? 'No items on this order' : undefined}
                    >
                      {isApplying ? 'Applying…' : 'Apply all'}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 bd-divider pt-3">
                    {isItemsLoading ? (
                      <p className="text-xs bd-muted">Loading items…</p>
                    ) : !cachedItems || cachedItems.length === 0 ? (
                      <p className="text-xs bd-muted">No items on this order.</p>
                    ) : (
                      <>
                        <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                          {cachedItems.map(it => {
                            const checked = checkedSet.has(it.id);
                            return (
                              <label
                                key={it.id}
                                className="flex items-start gap-2 cursor-pointer text-xs"
                                style={{ padding: '4px 2px' }}
                              >
                                <span style={{ marginTop: 2, flexShrink: 0 }}>
                                  <SelectionCheckbox
                                    checked={checked}
                                    onChange={() => togglePastItemChecked(order.id, it.id)}
                                    ariaLabel="Select item from past order"
                                  />
                                </span>
                                <span className="bd-muted" style={{ lineHeight: 1.4 }}>
                                  <span className="bd-strong">{it.item_name}</span>
                                  {it.brand ? ` · ${it.brand}` : ''}
                                  {it.size ? ` · ${it.size}` : ''}
                                  {it.quantity != null ? ` · ${it.quantity}${it.unit ? ' ' + it.unit : ''}` : ''}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between mt-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setPastChecked(prev => ({ ...prev, [order.id]: new Set() }))}
                            disabled={checkedCount === 0}
                            className="text-[10px] hover:underline"
                            style={{ color: '#C65A1A', background: 'none', border: 0, cursor: checkedCount === 0 ? 'default' : 'pointer', opacity: checkedCount === 0 ? 0.4 : 1 }}
                          >
                            Clear
                          </button>
                          <button
                            onClick={() => handleApplyPastSelected(order)}
                            disabled={checkedCount === 0 || isApplying || !!applyingPastId}
                            className="bd-btn-accent"
                            style={(checkedCount === 0 || isApplying || applyingPastId) ? { opacity: 0.6, cursor: 'default' } : null}
                          >
                            {isApplying ? 'Applying…' : `Add ${checkedCount} selected`}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : tab === 'favourites' ? (
        <div className="space-y-2">
          {favourites.length === 0 && (
            <p className="text-sm text-center py-6 bd-muted">
              No favourited orders yet. Star an order from the Orders tab to add it here.
            </p>
          )}
          {favourites.map(fav => {
            const depts = Array.isArray(fav.departments) ? fav.departments.filter(Boolean) : [];
            const orderDate = fav.sent_at || fav.created_at;
            const formattedDate = orderDate
              ? new Date(orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : '';
            const isApplying = applyingFavId === fav.id;
            return (
              <div key={fav.id} className="bd-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium bd-strong">{fav.supplier_name || 'Supplier'}</p>
                    <p className="text-[10px] mt-0.5 bd-muted">
                      {Number(fav.item_count) || 0} item{Number(fav.item_count) === 1 ? '' : 's'}
                      {formattedDate ? ` · ${formattedDate}` : ''}
                    </p>
                    {depts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {depts.map(d => (
                          <span key={d} className="bd-tag">{d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleApplyFavourite(fav)}
                    disabled={isApplying || !!applyingFavId}
                    className="bd-btn-accent"
                    style={isApplying || applyingFavId ? { opacity: 0.6, cursor: 'default' } : null}
                  >
                    {isApplying ? 'Applying…' : 'Apply'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === 'templates' ? (
        <div className="space-y-2">
          {templates.length === 0 && (
            <p className="text-sm text-center py-6 bd-muted">
              No saved templates yet. Save a board as a template from the three-dot menu.
            </p>
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
          {/* Save-as-template affordance — the smallest honest move:
              a tip pointing at the existing three-dot-menu action,
              not a duplicate inline button. */}
          <p className="text-[11px] text-center mt-3 bd-faint" style={{ fontStyle: 'italic' }}>
            Save this board as a template from the three-dot menu on the board card.
          </p>
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
            <p className="text-sm text-center py-6 bd-muted">
              {isCommand
                ? 'No frequent items yet. They\'ll appear after orders have been sent.'
                : 'No frequent items for your department yet. They\'ll appear after you\'ve sent a few orders.'}
            </p>
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
                            <span className="mt-1 flex-shrink-0">
                              <SelectionCheckbox
                                checked={isChecked}
                                onChange={() => toggleCheck(key)}
                                ariaLabel="Select frequent item"
                              />
                            </span>
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
  templates: 'Quick Add',
};

const BoardDrawer = ({ open, mode, list, items = [], trips, tenantId, departments = [], onSaved, onDeleted, onAddItems, onClose }) => {
  // EditMode publishes its dirty / busy state up so Drawer's close gate can
  // see it. Suggestions / Templates modes don't carry user input that
  // needs guarding; we leave the gate at false for those.
  const [editDirty, setEditDirty] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const isDirty = mode === 'edit' && editDirty;
  const isBusy = mode === 'edit' && editBusy;

  if (!list) return null;

  return (
    <Drawer open={open} onClose={onClose} isDirty={isDirty} isBusy={isBusy} title={DRAWER_TITLES[mode] || 'Board'}>
      <style>{BD_STYLES}</style>
      {mode === 'edit' && (
        <EditMode
          list={list}
          items={items}
          trips={trips}
          tenantId={tenantId}
          departments={departments}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onClose={onClose}
          onDirtyChange={setEditDirty}
          onBusyChange={setEditBusy}
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
