import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { EditorialPageShell, EditorialTabNav } from '../../components/editorial';
import '../pantry/pantry.css';
import StatusBadge from './components/StatusBadge';
import { BOARD_TYPES } from './data/templates';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import {
  fetchProvisioningList,
  fetchListItems,
  fetchSuppliers,
  upsertItems,
  updateProvisioningItem,
  deleteProvisioningItem,
  updateProvisioningList,
  deleteProvisioningList,
  duplicateList,
  fetchVesselDepartments,
  fetchDeliveryBatches,
  repairUnbatchedReceivedItems,
  updateItemPaymentStatus,
  updateBatchTotal,
  quickReceiveItem,
  fetchPendingCrossMatches,
  fetchCrossDeptMatchesForBoard,
  fetchUserNames,
  fetchOrderHistory,
  fetchSupplierOrders,
  fetchInvoiceSignedUrl,
  acceptOrderItemQuote,
  declineOrderItemQuote,
  queryOrderItemQuote,
  PROVISIONING_STATUS,
  PROVISION_CATEGORIES,
  PROVISION_UNITS,
  SUPPLIER_ORDER_STATUS,
  formatCurrency,
} from './utils/provisioningStorage';
import SendToSupplierModal from './components/SendToSupplierModal';
import InvoiceUploadModal, { PAYMENT_STATUS_OPTIONS } from './components/InvoiceUploadModal';
import ItemDrawer from './components/ItemDrawer';
import SupplierOrderDrawer from './components/SupplierOrderDrawer';
import ReceiveDeliveryModal from './components/ReceiveDeliveryModal';
import ConfirmDeliveryModal from './components/ConfirmDeliveryModal';
import { loadTrips, findTripByAnyId } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { showToast } from '../../utils/toast';
import {
  DETAIL_GRID,
  ITEM_STATUS_OPTIONS,
  getStatusCfg,
  EditCell,
  SelectCell,
  QtyCell,
  StatusCell,
  DeptGroup,
} from './components/DetailTableCells';
import SummaryGauges from './components/SummaryGauges';
import { getActivityForEntity } from '../../utils/activityStorage';
import { supabase } from '../../lib/supabaseClient';
import { getDepartmentColor, hexToRgba, categoriesForDept } from './data/categories';
import { useInferCategory } from './hooks/useInferCategory';

// ── (SummaryGauges, SemiGauge, useCountUp live in components/SummaryGauges.jsx) ─

// ── Sprint 9c.2 helpers ─────────────────────────────────────────────────────

// ISO 2-letter country code → flag emoji via regional indicator symbols.
// Returns empty string on any non-2-letter input. Falsy-safe.
const flagEmoji = (iso) => {
  if (!iso || typeof iso !== 'string' || iso.length !== 2) return '';
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  const u = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(u)) return '';
  return String.fromCodePoint(u.charCodeAt(0) + offset, u.charCodeAt(1) + offset);
};

// supplier_orders.status values that get the 5px navy bottom edge — the
// "in flight" 3D moment. Terminal states (paid, draft) keep just the
// hairline. Mirrors the canonical 8-stage CHECK from Sprint 9c.2a.
const ACTIVE_ORDER_STATES = new Set([
  'sent',
  'confirmed',
  'dispatched',
  'out_for_delivery',
  'received',
  'invoiced',
]);

// Short-ref helper — mirrors the supplier-side shortRef for consistent
// order-number display across both portals.
const shortOrderRef = (id) => String(id || '').slice(0, 8).toUpperCase();


// ── Edit Board Modal ──────────────────────────────────────────────────────────

const EditBoardModal = ({ list, onSaved, onClose }) => {
  const [form, setForm] = useState({
    title: list.title || '',
    board_type: list.board_type || 'general',
    status: list.status || PROVISIONING_STATUS.DRAFT,
    port_location: list.port_location || '',
    order_by_date: list.order_by_date || '',
    notes: list.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const updated = await updateProvisioningList(list.id, {
        title: form.title.trim(),
        board_type: form.board_type,
        status: form.status,
        port_location: form.port_location,
        order_by_date: form.order_by_date || null,
        notes: form.notes,
      });
      onSaved(updated);
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-foreground">Edit Board</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <Icon name="X" className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={fieldCls} />
          </div>
          {/* Board type — Sprint 9c.1a. Sits between Title and Port/Location. */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Board type</label>
            <select value={form.board_type} onChange={e => setForm(f => ({ ...f, board_type: e.target.value }))} className={fieldCls}>
              {BOARD_TYPES.map(bt => (
                <option key={bt.value} value={bt.value}>{bt.label}</option>
              ))}
            </select>
          </div>
          {[
            { label: 'Port / Location', key: 'port_location', type: 'text' },
            { label: 'Order By Date', key: 'order_by_date', type: 'date' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
              <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={fieldCls} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={fieldCls}>
              {Object.values(PROVISIONING_STATUS).map(v => (
                <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={`${fieldCls} resize-none`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── AlwaysEditCell — always-visible inline input for the board detail table ───
const AlwaysEditCell = ({ value, placeholder, onSave, type = 'text', inputStyle = {} }) => {
  const ref = React.useRef(null);
  const [local, setLocal] = React.useState(value ?? '');
  React.useEffect(() => {
    if (document.activeElement !== ref.current) setLocal(value ?? '');
  }, [value]);
  const commit = () => { if (String(local) !== String(value ?? '')) onSave(local); };
  return (
    <input
      ref={ref}
      type={type}
      value={local}
      placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setLocal(value ?? ''); ref.current?.blur(); } }}
      onFocus={e => { e.target.style.borderColor = '#3B82F6'; e.target.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.15)'; }}
      onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.boxShadow = 'none'; commit(); }}
      onMouseEnter={e => { if (document.activeElement !== e.target) e.target.style.borderColor = '#E5E7EB'; }}
      onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderColor = 'transparent'; }}
      style={{ border: '1px solid transparent', borderRadius: 4, padding: '2px 6px', outline: 'none', background: 'transparent', width: '100%', ...inputStyle }}
    />
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const ProvisioningBoardDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [trip, setTrip] = useState(null);
  const [allergenGuests, setAllergenGuests] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editingCell, setEditingCell] = useState(null);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupBy, setGroupBy] = useState('category'); // 'category' | 'none'
  const [collapsedCategories, setCollapsedCategories] = useState(new Set());
  const [sortColumn, setSortColumn] = useState('item');
  const [sortDirection, setSortDirection] = useState('asc');
  const [addingToDept, setAddingToDept] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const { inferring, inferredCategory, infer: inferCategory, clearInference } = useInferCategory();
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [itemDrawer, setItemDrawer] = useState({ open: false, item: null });
  const [activeTab, setActiveTab] = useState('items');
  const [deliveries, setDeliveries] = useState([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null); // { batch, batchItems }
  // Optimistic payment_status overrides until DB column is added
  const [paymentStatusMap, setPaymentStatusMap] = useState({});
  const [hoveredRow, setHoveredRow] = useState(null);
  const menuRef = useRef(null);
  const [displayCurrency, setDisplayCurrency] = useState(null);
  const [fxRates, setFxRates] = useState({ GBP: 1, USD: 1.27, EUR: 1.17 });
  const [fxRatesLabel, setFxRatesLabel] = useState('Using estimated rates');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showReceived, setShowReceived] = useState(false);
  const [crossDeptHistory, setCrossDeptHistory] = useState([]);
  const [historyUserNames, setHistoryUserNames] = useState({});
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [activityEvents, setActivityEvents] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // ── Supplier Orders ──────────────────────────────────────────────────────
  const [showSendModal, setShowSendModal] = useState(false);
  const [supplierOrders, setSupplierOrders] = useState([]);
  const [supplierOrdersLoading, setSupplierOrdersLoading] = useState(false);

  // Sprint 9.5 quote workflow state
  const [quoteRowBusy, setQuoteRowBusy] = useState(null);   // item.id currently saving
  const [acceptAllBusy, setAcceptAllBusy] = useState(null); // order.id currently bulk-accepting
  const [queryModalItem, setQueryModalItem] = useState(null);

  // Merge an updated supplier_order_items row back into local state.
  // Finds the order containing this item by order_id and replaces the line.
  const mergeUpdatedItem = useCallback((updated) => {
    if (!updated?.id) return;
    setSupplierOrders((prev) => prev.map((o) => (
      o.id === updated.order_id
        ? { ...o, supplier_order_items: (o.supplier_order_items || []).map((it) => it.id === updated.id ? { ...it, ...updated } : it) }
        : o
    )));
  }, []);

  const handleAcceptItemQuote = useCallback(async (item) => {
    setQuoteRowBusy(item.id);
    try {
      const updated = await acceptOrderItemQuote(item.id);
      mergeUpdatedItem(updated);
    } catch (e) {
      window.alert(`Could not accept quote: ${e.message}`);
    } finally {
      setQuoteRowBusy(null);
    }
  }, [mergeUpdatedItem]);

  const handleDeclineItemQuote = useCallback(async (item) => {
    if (!window.confirm('Decline this quote? The supplier will be asked to re-quote.')) return;
    setQuoteRowBusy(item.id);
    try {
      const updated = await declineOrderItemQuote(item.id);
      mergeUpdatedItem(updated);
    } catch (e) {
      window.alert(`Could not decline: ${e.message}`);
    } finally {
      setQuoteRowBusy(null);
    }
  }, [mergeUpdatedItem]);

  const handleQueryItemQuote = useCallback(async (item) => {
    // Open the placeholder modal first; the RPC also flips quote_status
    // to 'in_discussion' so the supplier sees the line is being queried.
    setQueryModalItem(item);
    setQuoteRowBusy(item.id);
    try {
      const updated = await queryOrderItemQuote(item.id);
      mergeUpdatedItem(updated);
    } catch (e) {
      // Failure to flip status server-side is non-fatal — the modal is
      // already open, supplier just won't see the in_discussion badge.
      console.warn('[queryOrderItemQuote] failed:', e.message);
    } finally {
      setQuoteRowBusy(null);
    }
  }, [mergeUpdatedItem]);

  // Bulk-accept every quoted line on a single order.
  const handleAcceptAllQuoted = useCallback(async (order) => {
    const quoted = (order.supplier_order_items || []).filter((i) => i.quote_status === 'quoted');
    if (quoted.length === 0) return;
    if (!window.confirm(`Accept all ${quoted.length} quoted price${quoted.length === 1 ? '' : 's'}?`)) return;
    setAcceptAllBusy(order.id);
    try {
      const results = await Promise.allSettled(quoted.map((it) => acceptOrderItemQuote(it.id)));
      // Merge each successful result; surface count of failures if any.
      let failed = 0;
      results.forEach((r) => {
        if (r.status === 'fulfilled') mergeUpdatedItem(r.value);
        else failed += 1;
      });
      if (failed > 0) {
        window.alert(`Accepted ${quoted.length - failed} of ${quoted.length}. ${failed} failed — refresh to retry.`);
      }
    } finally {
      setAcceptAllBusy(null);
    }
  }, [mergeUpdatedItem]);
  // Sprint 9c.2 Commit 1.5: replaces inline expansion with a slide-in
  // drawer. Holds the order id whose detail drawer is currently open;
  // null = drawer closed.
  const [drawerOrderId, setDrawerOrderId] = useState(null);
  const [tenantVesselName, setTenantVesselName] = useState('');
  const [tenantVesselTypeLabel, setTenantVesselTypeLabel] = useState('');

  // ── Smart Suggestions ─────────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState([]);      // [{ name, category, quantity, unit, reasoning, source, confidence }]
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [skippedSuggestions, setSkippedSuggestions] = useState(new Set()); // names of skipped items
  const [addedSuggestions, setAddedSuggestions] = useState(new Set());     // names of added items

  const userTier = (tenantRole || '').toUpperCase();
  const userDept = (user?.department || '').trim();
  const userId = user?.id;
  const isOwner = userId && (list?.owner_id === userId || list?.created_by === userId);
  const listDepts = Array.isArray(list?.department)
    ? list.department.filter(Boolean)
    : (list?.department ? list.department.split(',').map(d => d.trim()) : []);
  const inSameDept = !listDepts.length || listDepts.some(d => d?.toLowerCase() === userDept.toLowerCase());

  // Edit board metadata + add items: owner / COMMAND / CHIEF / HOD  (not CREW)
  const canEdit = !!isOwner || userTier === 'COMMAND' || (['CHIEF', 'HOD'].includes(userTier) && inSameDept);
  const canAddItems = canEdit;
  // Delete the board: owner / COMMAND / CHIEF  (HOD and CREW cannot delete boards)
  const canDelete = !!isOwner || userTier === 'COMMAND' || (userTier === 'CHIEF' && inSameDept);
  // Send to supplier: COMMAND and CHIEF only — isOwner intentionally excluded
  // so a CREW member who created a board cannot bypass the tier restriction.
  const canSendToSupplier = userTier === 'COMMAND' || userTier === 'CHIEF';

  // Item-locking: once an order has been sent, board items that appear in any
  // supplier_order_items row become read-only until the board is back to draft.
  const isSent = list?.status === 'sent_to_supplier' || list?.status === 'confirmed';
  const itemStatusMap = useMemo(() => {
    const map = {};
    supplierOrders.forEach(order => {
      (order.supplier_order_items || []).forEach(oi => {
        const key = (oi.item_name || '').toLowerCase().trim();
        if (!map[key]) {
          map[key] = {
            status: oi.status,
            substitution: oi.substitute_description,
            subPrice: oi.substitution_price,
          };
        }
      });
    });
    return map;
  }, [supplierOrders]);

  // itemStatusMap must be declared before hasSendableItems and canDeleteItem
  const hasSendableItems = items
    .filter(i => i.status !== 'received' && i.name?.trim())
    .some(i => {
      const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
      return !oi;
    });
  // Delete individual items: owner / COMMAND / CHIEF / HOD  (not CREW)
  const canDeleteItem = !!isOwner || userTier === 'COMMAND' || (['CHIEF', 'HOD'].includes(userTier) && inSameDept);

  // Default department NAME (string) for new items: user's own dept from auth,
  // then board's dept, then vessel config, else null (→ GLOBAL). departments is
  // { id, name, color }[]; we return just the name to keep downstream callers
  // (addingToDept, handleAddItem) operating on strings.
  const defaultDept = useMemo(() => {
    const userDept = (user?.department || '').trim();
    if (userDept) {
      const match = departments.find(d => d?.name?.toLowerCase() === userDept.toLowerCase());
      if (match) return match.name;
    }
    return (Array.isArray(list?.department) ? list.department.filter(Boolean) : (list?.department || '').split(',').map(d => d.trim()).filter(Boolean))[0]
      || departments[0]?.name || null;
  }, [departments, list?.department, user?.department]);

  // ── AI category inference (Sprint 4B Phase 4) ────────────────────────────
  // Apply the inferred category to the add row only when the dropdown is
  // still empty and the name input is still populated. User-picked values
  // win — the guard re-checks state every render so a category typed during
  // the 800ms debounce isn't overwritten when the inference resolves.
  useEffect(() => {
    if (!inferredCategory) return;
    if (newItemCategory.trim()) return;
    if (!newItemName.trim()) return;
    setNewItemCategory(inferredCategory);
  }, [inferredCategory, newItemCategory, newItemName]);

  // Cross-row staleness guard: when the active add row changes (or closes),
  // drop any in-flight or resolved inference so a result from one surface
  // can't auto-fill a different one.
  useEffect(() => {
    clearInference();
  }, [addingToDept, clearInference]);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (id) loadAll();
    if (activeTenantId) fetchVesselDepartments(activeTenantId).then(setDepartments);
  }, [id, activeTenantId]);

  // Fetch vessel name + type from tenants table so emails use the real vessel
  // name rather than the provisioning board title.
  useEffect(() => {
    if (!activeTenantId) return;
    supabase.from('tenants').select('name, vessel_type_label').eq('id', activeTenantId).single()
      .then(({ data }) => {
        if (data?.name) setTenantVesselName(data.name);
        if (data?.vessel_type_label) setTenantVesselTypeLabel(data.vessel_type_label);
      })
      .catch(() => {});
  }, [activeTenantId]);

  useEffect(() => {
    if (!user?.id) return;
    fetchPendingCrossMatches(user.id).then(matches => {
      if (matches.length > 0) setShowConfirmModal(true);
    });
  }, [user?.id]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedList, fetchedItems, fetchedSuppliers, fetchedOrders] = await Promise.all([
        fetchProvisioningList(id),
        fetchListItems(id),
        activeTenantId ? fetchSuppliers(activeTenantId).catch(() => []) : Promise.resolve([]),
        fetchSupplierOrders(id).catch(() => []),
      ]);
      setList(fetchedList);
      setDisplayCurrency(fetchedList?.currency || 'GBP');
      setItems(fetchedItems || []);
      setSuppliers(fetchedSuppliers || []);
      setSupplierOrders(fetchedOrders || []);

      if (fetchedList?.trip_id) {
        try {
          const trips = (await loadTrips()) || [];
          const linked = findTripByAnyId(trips, fetchedList.trip_id);
          setTrip(linked);

          if (linked?.guests?.length && activeTenantId) {
            const guestIds = new Set(linked.guests.map(g => g.guestId).filter(Boolean));
            const allGuests = await loadGuests(activeTenantId).catch(() => []);
            const withAllergens = allGuests.filter(g =>
              guestIds.has(g.id) && g.allergies?.trim()
            ).map(g => ({
              name: [g.firstName, g.lastName].filter(Boolean).join(' ') || 'Guest',
              allergies: g.allergies.trim(),
            }));
            setAllergenGuests(withAllergens);
          }
        } catch { /* trip/guest load failed - non-critical */ }
      }
    } catch (err) {
      console.error('[BoardDetail] loadAll error:', err);
      setError('Could not load board.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showMenu) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showMenu]);

  // Load deliveries when Deliveries or History tab becomes active; auto-repair unbatched items
  useEffect(() => {
    if ((activeTab !== 'deliveries' && activeTab !== 'history') || !list?.id) return;
    setDeliveriesLoading(true);
    fetchDeliveryBatches(list.id)
      .then(async (batches) => {
        if (batches.length === 0) {
          // No batch records — attempt to retroactively create them for received items
          const repaired = await repairUnbatchedReceivedItems(list.id, activeTenantId, user?.id);
          if (repaired) {
            // Reload both batches and items so the UI reflects the new grouping
            const [newBatches, newItems] = await Promise.all([
              fetchDeliveryBatches(list.id),
              fetchListItems(list.id),
            ]);
            setDeliveries(newBatches || []);
            setItems(newItems || []);
            return;
          }
        }
        setDeliveries(batches || []);
      })
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [activeTab, list?.id]);

  // Resolve received_by and supplier_name UUIDs when deliveries list changes
  useEffect(() => {
    if (deliveries.length === 0) return;
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const allUuids = [...new Set(
      deliveries.flatMap(d => [
        d.received_by,
        ...(d.supplier_name?.match(uuidRegex) || []),
      ]).filter(Boolean)
    )];
    if (allUuids.length === 0) return;
    fetchUserNames(allUuids).then(names => setHistoryUserNames(prev => ({ ...prev, ...names }))).catch(() => {});
  }, [deliveries]);

  // Load activity events + cross-dept history when History tab becomes active
  // Queries both provisioning_list (board-level) and provisioning_item (item-level) events
  useEffect(() => {
    if (activeTab !== 'history' || !list?.id) return;
    setActivityLoading(true);
    (async () => {
      try {
        const [matches] = await Promise.all([
          fetchCrossDeptMatchesForBoard(list.id).catch(() => []),
        ]);
        setCrossDeptHistory(matches);

        // Build OR filter: board-level events OR any item on this board
        const itemIds = items.map(i => i.id).filter(Boolean);
        const tenantId = activeTenantId;

        // Fetch events where entity_type=provisioning_list and entity_id=board,
        // OR entity_type=provisioning_item and entity_id in item IDs
        let events = [];
        if (tenantId) {
          const listFilter = `entity_type.eq.provisioning_list,entity_id.eq.${list.id}`;
          const itemFilter = itemIds.length > 0
            ? `,entity_type.eq.provisioning_item,entity_id.in.(${itemIds.join(',')})`
            : '';
          const { data, error } = await supabase
            ?.from('activity_events')
            ?.select('*')
            ?.eq('tenant_id', tenantId)
            ?.eq('module', 'provisioning')
            ?.or(`${listFilter}${itemFilter}`)
            ?.order('created_at', { ascending: false })
            ?.limit(200);
          if (!error) {
            events = (data || []).map(row => ({
              id: row.id,
              createdAt: row.created_at,
              actorUserId: row.actor_user_id,
              actorName: row.actor_name,
              actorDepartment: row.actor_department,
              action: row.action,
              entityType: row.entity_type,
              entityId: row.entity_id,
              summary: row.summary,
              meta: row.meta || {},
            }));
          } else {
            console.error('[History] activity_events query error:', error.message);
          }
        }
        setActivityEvents(events);

        // Resolve user IDs from deliveries + cross-dept matches
        const userIds = [
          ...deliveries.map(d => d.received_by),
          ...matches.map(m => m.scanned_by),
          ...matches.map(m => m.target_user_id),
        ].filter(Boolean);
        const names = await fetchUserNames(userIds).catch(() => ({}));
        setHistoryUserNames(prev => ({ ...prev, ...names }));
      } catch (err) {
        console.error('[History] load error:', err);
      } finally {
        setActivityLoading(false);
      }
    })();
  }, [activeTab, list?.id, items, activeTenantId, deliveries]);

  // Load supplier orders when Orders tab is active
  useEffect(() => {
    if (activeTab !== 'orders' || !list?.id) return;
    let cancelled = false;
    setSupplierOrdersLoading(true);
    fetchSupplierOrders(list.id)
      .then(data => { if (!cancelled) setSupplierOrders(data || []); })
      .catch(err => console.error('[ProvisioningBoardDetail] fetchSupplierOrders:', err))
      .finally(() => { if (!cancelled) setSupplierOrdersLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, list?.id]);

  // Realtime: refresh supplier orders when supplier confirms on public page.
  // Requires supplier_orders to be added to supabase_realtime publication.
  useEffect(() => {
    if (!list?.id) return;
    const channel = supabase
      .channel(`supplier-orders-${list.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'supplier_orders',
        filter: `list_id=eq.${list.id}`,
      }, (payload) => {
        fetchSupplierOrders(list.id)
          .then(data => setSupplierOrders(data || []))
          .catch(() => {});
        if (payload.eventType === 'UPDATE' && payload.new?.status === 'confirmed') {
          showToast(`${payload.new?.supplier_name || 'Supplier'} confirmed your order!`, 'success');
        }
      })
      .subscribe((status) => {
        console.log('[ProvisioningBoardDetail] realtime status:', status);
      });
    return () => { supabase.removeChannel(channel); };
  }, [list?.id]);

  // Fetch live FX rates once on mount (GBP base)
  useEffect(() => {
    fetch('https://api.frankfurter.dev/v2/rates?base=GBP&quotes=USD,EUR')
      .then(r => r.json())
      .then(data => {
        if (data?.rates?.USD && data?.rates?.EUR) {
          setFxRates({ GBP: 1, USD: data.rates.USD, EUR: data.rates.EUR });
          setFxRatesLabel('Rates updated today');
        }
      })
      .catch(() => { /* keep hardcoded fallback rates */ });
  }, []);

  // ── Cell save ─────────────────────────────────────────────────────────────

  const handleCellSave = useCallback(async (item, field, rawValue) => {
    let value = rawValue;
    if (['quantity_ordered', 'quantity_received', 'estimated_unit_cost'].includes(field)) {
      value = rawValue === '' || rawValue == null ? null : parseFloat(rawValue) || 0;
    }
    if (item[field] === value) return;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: value } : i));
    try {
      await updateProvisioningItem(item.id, { [field]: value });
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: item[field] } : i));
      showToast('Failed to save', 'error');
    }
  }, []);

  const handleQtyStep = useCallback(async (item, field, delta) => {
    const next = Math.max(0, (parseFloat(item[field]) || 0) + delta);
    await handleCellSave(item, field, next);
  }, [handleCellSave]);

  const handleStatusSave = useCallback(async (item, field, newStatus) => {
    await handleCellSave(item, 'status', newStatus);
  }, [handleCellSave]);

  const handleQuickReceive = useCallback(async (item) => {
    // Optimistic update — item moves off Items tab immediately
    const qty = item.quantity_ordered ?? 0;
    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, status: 'received', quantity_received: qty, payment_status: 'awaiting_invoice' }
      : i
    ));
    try {
      await quickReceiveItem({ item, listId: id, tenantId: activeTenantId, userId: user?.id });
      // Refresh delivery batches so Received tab shows the item immediately
      fetchDeliveryBatches(id).then(data => setDeliveries(data || [])).catch(() => {});
      showToast(`${item.name} marked received`, 'success');
    } catch {
      // Revert on failure
      setItems(prev => prev.map(i => i.id === item.id ? item : i));
      showToast('Failed to receive item', 'error');
    }
  }, [id, activeTenantId, user?.id]);

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this item?')) return;
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await deleteProvisioningItem(itemId);
    } catch {
      showToast('Failed to delete item', 'error');
      loadAll();
    }
  };

  const handleAddItem = async (dept) => {
    if (!newItemName.trim()) return;
    const payload = { list_id: id, name: newItemName.trim(), department: (dept === 'Other' || dept === 'General') ? '' : dept, category: newItemCategory.trim() || null, quantity_ordered: 1, unit: 'each', status: 'draft', source: 'manual' };
    setNewItemName('');
    setNewItemCategory('');
    setAddingToDept(null);
    try {
      const [saved] = await upsertItems([payload]);
      if (saved) setItems(prev => [...prev, saved]);
      else loadAll();
    } catch {
      showToast('Failed to add item', 'error');
    }
  };

  const handleItemDrawerSaved = useCallback((listId, savedItems) => {
    setItems(prev => prev.map(i => {
      const match = savedItems.find(s => s.id === i.id);
      return match ? { ...i, ...match } : i;
    }));
    // Keep drawer item in sync so re-saving reflects latest values
    setItemDrawer(prev => {
      if (!prev.item) return prev;
      const updated = savedItems.find(s => s.id === prev.item.id);
      return updated ? { ...prev, item: { ...prev.item, ...updated } } : prev;
    });
  }, []);

  // ── Board actions ─────────────────────────────────────────────────────────

  const handleStatusUpdate = async (newStatus) => {
    setShowMenu(false);
    try {
      const updated = await updateProvisioningList(id, { status: newStatus });
      setList(prev => ({ ...prev, ...updated }));
      showToast('Status updated', 'success');
    } catch { showToast('Failed to update status', 'error'); }
  };

  const handleDuplicate = async () => {
    setShowMenu(false);
    try {
      const newList = await duplicateList(id, activeTenantId, user?.id);
      showToast('Board duplicated', 'success');
      navigate('/provisioning/' + newList.id);
    } catch { showToast('Failed to duplicate', 'error'); }
  };

  const handleSendToSupplier = () => {
    const sendableItems = items.filter(i => i.status !== 'received' && i.name?.trim());
    if (sendableItems.length === 0) {
      showToast('Add items to the board before sending to a supplier.', 'warning');
      return;
    }
    const unsentItems = sendableItems.filter(i => {
      const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
      return !oi;
    });
    if (unsentItems.length === 0) {
      showToast('All items on this board have already been sent to a supplier.', 'info');
      return;
    }
    setShowSendModal(true);
  };

  // ── Smart Suggestions ─────────────────────────────────────────────────────

  const handleGetSuggestions = async () => {
    if (suggestionsLoading) return;
    setShowSuggestions(true);
    setSuggestionsLoading(true);
    setSkippedSuggestions(new Set());
    setAddedSuggestions(new Set());
    try {
      const orderHistory = await fetchOrderHistory(activeTenantId, null, 5);
      const existingNames = items.map(i => i.name).filter(Boolean);

      const { data, error } = await supabase.functions.invoke('suggestItems', {
        body: {
          boardType:    list?.board_type || 'general',
          tripType:     trip?.tripType || trip?.type || null,
          guestCount:   trip?.guests?.filter(g => g.isActive)?.length || trip?.guests?.length || 0,
          duration:     trip?.duration || null,
          season:       null, // could derive from trip dates if available
          region:       list?.port_location || null,
          department:   (user?.department || '').trim() || null,
          existingItems: existingNames,
          orderHistory,
        },
      });

      if (error) throw error;
      setSuggestions((data?.suggestions || []).filter(s => !existingNames.some(n => n.toLowerCase() === s.name.toLowerCase())));
    } catch (err) {
      console.error('[ProvisioningBoardDetail] suggestItems error:', err);
      showToast('Failed to load suggestions', 'error');
      setShowSuggestions(false);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleAddSuggestion = async (suggestion) => {
    try {
      const newItem = {
        list_id:          id,
        name:             suggestion.name,
        category:         suggestion.category || null,
        quantity_ordered: suggestion.quantity || 1,
        unit:             suggestion.unit || null,
        status:           'draft',
        department:       (user?.department || '').trim() || null,
      };
      const [saved] = await upsertItems([newItem]);
      if (saved) {
        setItems(prev => [...prev, saved]);
        setAddedSuggestions(prev => new Set([...prev, suggestion.name]));
      }
    } catch (err) {
      console.error('[ProvisioningBoardDetail] addSuggestion error:', err);
      showToast('Failed to add item', 'error');
    }
  };

  const handleAddAllSuggestions = async () => {
    const visible = suggestions.filter(s => !skippedSuggestions.has(s.name) && !addedSuggestions.has(s.name));
    if (!visible.length) return;
    try {
      const payload = visible.map(s => ({
        list_id:          id,
        name:             s.name,
        category:         s.category || null,
        quantity_ordered: s.quantity || 1,
        unit:             s.unit || null,
        status:           'draft',
        department:       (user?.department || '').trim() || null,
      }));
      const saved = await upsertItems(payload);
      setItems(prev => [...prev, ...saved]);
      setAddedSuggestions(prev => new Set([...prev, ...visible.map(s => s.name)]));
      showToast(`Added ${saved.length} items`, 'success');
    } catch (err) {
      console.error('[ProvisioningBoardDetail] addAllSuggestions error:', err);
      showToast('Failed to add items', 'error');
    }
  };

  const handleDeleteBoard = async () => {
    setShowMenu(false);
    if (!window.confirm(`Delete "${list?.title}"? This cannot be undone.`)) return;
    try {
      await deleteProvisioningList(id);
      navigate('/provisioning');
      showToast('Board deleted', 'success');
    } catch { showToast('Failed to delete board', 'error'); }
  };

  // ── Allergen helpers ──────────────────────────────────────────────────────

  const isAllergenRisk = useCallback((item) => {
    if (!allergenGuests.length) return false;
    const text = `${item.name || ''} ${item.category || ''}`.toLowerCase();
    return allergenGuests.some(g =>
      g.allergies.split(/[,;]+/).some(a => a.trim() && text.includes(a.trim().toLowerCase()))
    );
  }, [allergenGuests]);

  // ── Filtering & grouping ──────────────────────────────────────────────────

  const filteredItems = useMemo(() => items.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (deptFilter !== 'all' && item.department !== deptFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!item.name?.toLowerCase().includes(q) && !item.brand?.toLowerCase().includes(q) && !item.category?.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, statusFilter, deptFilter, searchQuery]);

  const hasFilters = statusFilter !== 'all' || deptFilter !== 'all' || searchQuery;

  // Items that are received but have no batch link — shown as a fallback group on the Received tab
  const completedItems = useMemo(
    () => items.filter(i => i.status === 'received' && !i.receive_batch_id),
    [items]
  );

  const deptGroups = useMemo(() => {
    const pendingItems = showReceived ? filteredItems : filteredItems.filter(i => i.status !== 'received');
    const groups = {};
    pendingItems.forEach(item => {
      const d = item.department || 'General';
      if (!groups[d]) groups[d] = [];
      groups[d].push(item);
    });
    if (addingToDept && !groups[addingToDept]) groups[addingToDept] = [];
    const ordered = [];
    const deptNames = new Set(departments.map(d => d?.name).filter(Boolean));
    // Preserve canonical dept order (sorted by name from the RPC), and pass
    // the dept object through so the category header can read .color.
    departments.forEach(d => {
      if (d?.name && groups[d.name] !== undefined) {
        ordered.push({ dept: d.name, deptObj: d, items: groups[d.name] });
      }
    });
    // Fallback group for items whose department name isn't in the
    // departments list (e.g. 'General', deleted dept). No deptObj — header
    // colour will fall to neutral grey via getDepartmentColor.
    Object.keys(groups).forEach(d => {
      if (!deptNames.has(d)) ordered.push({ dept: d, deptObj: null, items: groups[d] });
    });
    return ordered;
  }, [filteredItems, addingToDept, departments, showReceived]);

  // ── Sorting ──────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const sortItems = useCallback((arr) => {
    const sorted = [...arr];
    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'item':      return (a.name || '').localeCompare(b.name || '');
        case 'category':  return (a.category || '').localeCompare(b.category || '');
        case 'qty':       return (Number(a.quantity_ordered) || 0) - (Number(b.quantity_ordered) || 0);
        case 'unit_cost': return (Number(a.estimated_unit_cost) || 0) - (Number(b.estimated_unit_cost) || 0);
        case 'total': {
          const at = (Number(a.quantity_ordered) || 0) * (Number(a.estimated_unit_cost) || 0);
          const bt = (Number(b.quantity_ordered) || 0) * (Number(b.estimated_unit_cost) || 0);
          return at - bt;
        }
        case 'status':    return (a.status || '').localeCompare(b.status || '');
        default:          return 0;
      }
    });
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [sortColumn, sortDirection]);

  // ── Category collapse ────────────────────────────────────────────────────
  const toggleCategory = (key) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Seed collapse state once: collapse all but first 2 categories per dept
  // on first load. Skipped after the user has interacted.
  const collapsedSeededRef = useRef(false);
  useEffect(() => {
    if (groupBy !== 'category') return;
    if (collapsedSeededRef.current) return;
    if (collapsedCategories.size > 0) return;
    if (deptGroups.length === 0) return;

    const seed = new Set();
    for (const { dept, items: deptItems } of deptGroups) {
      const cats = new Set();
      for (const it of deptItems) cats.add(it.category || 'Uncategorised');
      const sortedCats = Array.from(cats).sort((a, b) => {
        if (a === 'Uncategorised') return 1;
        if (b === 'Uncategorised') return -1;
        return a.localeCompare(b);
      });
      sortedCats.slice(2).forEach(cat => seed.add(`${dept}::${cat}`));
    }
    if (seed.size > 0) {
      setCollapsedCategories(seed);
    }
    collapsedSeededRef.current = true;
  }, [deptGroups, groupBy, collapsedCategories.size]);

  const grandTotals = useMemo(() => items.reduce((acc, i) => {
    const qty = parseFloat(i.quantity_ordered) || 0;
    const qtyRec = parseFloat(i.quantity_received) || 0;
    const cost = parseFloat(i.estimated_unit_cost) || 0;
    return { estimated: acc.estimated + qty * cost, actual: acc.actual + qtyRec * cost };
  }, { estimated: 0, actual: 0 }), [items]);

  const convertedTotals = useMemo(() => {
    const disp = displayCurrency || 'GBP';
    return items.reduce((acc, i) => {
      const qty = parseFloat(i.quantity_ordered) || 0;
      const qtyRec = parseFloat(i.quantity_received) || 0;
      const cost = parseFloat(i.estimated_unit_cost) || 0;
      const iCurr = i.currency || (list?.currency || 'GBP');
      const c = (cost / (fxRates[iCurr] || 1)) * (fxRates[disp] || 1);
      return { estimated: acc.estimated + qty * c, actual: acc.actual + qtyRec * c };
    }, { estimated: 0, actual: 0 });
  }, [items, displayCurrency, fxRates, list]);

  // Pre-computed values passed to SummaryGauges
  const gaugeProps = useMemo(() => {
    const disp = displayCurrency || 'GBP';
    const convItem = (i) => {
      const cost = parseFloat(i.estimated_unit_cost) || 0;
      const qty  = parseFloat(i.quantity_ordered) || 0;
      const iCurr = i.currency || (list?.currency || 'GBP');
      return qty * ((cost / (fxRates[iCurr] || 1)) * (fxRates[disp] || 1));
    };
    const effectivePS = (i) => paymentStatusMap[i.id] ?? i.payment_status ?? 'awaiting_invoice';
    const receivedCount = items.filter(i => ['received', 'partial'].includes(i.status)).length;
    const paidItems   = items.filter(i => ['paid', 'paid_upfront'].includes(effectivePS(i)));
    const unpaidItems = items.filter(i => !['paid', 'paid_upfront'].includes(effectivePS(i)));
    return {
      leftToReceive:  items.length - receivedCount,
      totalCount:     items.length,
      receivedCount,
      totalValue:     convertedTotals.estimated,
      costSubtext:    `${items.length} item${items.length !== 1 ? 's' : ''} on board`,
      paidValue:      paidItems.reduce((s, i) => s + convItem(i), 0),
      leftToPayValue: unpaidItems.reduce((s, i) => s + convItem(i), 0),
    };
  }, [items, paymentStatusMap, convertedTotals, fxRates, displayCurrency, list]);

  // ── Checkboxes ────────────────────────────────────────────────────────────

  const allChecked = filteredItems.length > 0 && filteredItems.every(i => selectedItems.has(i.id));
  const toggleAll = () => setSelectedItems(allChecked ? new Set() : new Set(filteredItems.map(i => i.id)));
  const toggleItem = (itemId) => setSelectedItems(prev => {
    const n = new Set(prev);
    n.has(itemId) ? n.delete(itemId) : n.add(itemId);
    return n;
  });

  // ── Meta helpers ──────────────────────────────────────────────────────────

  const supplierName = list?.supplier_id ? (suppliers.find(s => s.id === list.supplier_id)?.name || null) : null;
  const deptTags = useMemo(() => {
    if (!list?.department) return [];
    return Array.isArray(list.department) ? list.department.filter(Boolean) : list.department.split(',').map(d => d.trim()).filter(Boolean);
  }, [list]);
  const currency = list?.currency || 'GBP';
  const isDraftOrPending = list?.status === PROVISIONING_STATUS.DRAFT || list?.status === PROVISIONING_STATUS.PENDING_APPROVAL;

  // ── Style constants ───────────────────────────────────────────────────────

  // TODO(backlog): DEPT_CHIP_STYLES is a hardcoded dept→colour map that predates the
  // dept.color DB column. Migrate to use dept.color as single source of truth.
  const DEPT_CHIP_STYLES = {
    Galley:      { bg: '#FEF9C3', color: '#854D0E' },
    Interior:    { bg: '#EDE9FE', color: '#5B21B6' },
    Deck:        { bg: '#DCFCE7', color: '#166534' },
    Engineering: { bg: '#FFF7ED', color: '#9A3412' },
  };
  const getDeptChip = (dept) => DEPT_CHIP_STYLES[dept] || { bg: '#F1F5F9', color: '#64748B' };

  const STATUS_BADGE = {
    draft:        { bg: '#F8FAFC', color: '#94A3B8', border: '#E2E8F0', dot: '#CBD5E1', label: 'Draft' },
    to_order:     { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE', dot: '#60A5FA', label: 'To order' },
    ordered:      { bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE', dot: '#A78BFA', label: 'Ordered' },
    received:     { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0', dot: '#4ADE80', label: 'Received' },
    partial:      { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A', dot: '#FCD34D', label: 'Partial' },
    not_received: { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA', dot: '#FCA5A5', label: 'Not received' },
  };
  const SUPPLIER_BADGE = {
    pending:     { bg: '#E0F2FE', color: '#0369A1', border: '#BAE6FD', dot: '#38BDF8', label: 'Sent' },
    confirmed:   { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0', dot: '#34D399', label: 'Confirmed' },
    unavailable: { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA', dot: '#FCA5A5', label: 'Unavailable' },
    substituted: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A', dot: '#FCD34D', label: 'Substituted' },
  };

  const STATUS_HERO_COLOR = {
    draft:                        { dot: '#F59E0B', text: '#F59E0B' },
    pending_approval:             { dot: '#4A90E2', text: '#4A90E2' },
    sent_to_supplier:             { dot: '#3B82F6', text: '#3B82F6' },
    partially_delivered:          { dot: '#F59E0B', text: '#F59E0B' },
    delivered_with_discrepancies: { dot: '#EF4444', text: '#EF4444' },
    delivered:                    { dot: '#22C55E', text: '#15803D' },
  };

  // cols: check | item | category | size | unit | qty | unit cost | total | status | actions
  const TABLE_GRID_FULL   = '36px minmax(180px,1.5fr) minmax(110px,0.8fr) 76px 70px 92px 90px 80px 120px 56px';
  // cols: check | item | size | unit | qty | unit cost | total | status | actions  (category dropped)
  const TABLE_GRID_NO_CAT = '36px minmax(180px,1.5fr) 76px 70px 92px 90px 80px 120px 56px';
  const TABLE_GRID = groupBy === 'category' ? TABLE_GRID_NO_CAT : TABLE_GRID_FULL;

  const CURR_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };
  const currSymbol = CURR_SYMBOLS[list?.currency] || '£';
  const dispCurr = displayCurrency || currency;
  const dispSymbol = CURR_SYMBOLS[dispCurr] || '£';

  // ── Additional computed values ────────────────────────────────────────────

  const isOverdue = list?.order_by_date
    ? new Date(list.order_by_date) < new Date(new Date().setHours(0, 0, 0, 0))
    : false;

  const heroStatus = STATUS_HERO_COLOR[list?.status] || { dot: '#94A3B8', text: '#94A3B8' };
  const statusLabel = (list?.status || '').replace(/_/g, ' ').toUpperCase();

  const renderTitle = (title = '') => {
    const emIdx = title.indexOf('-');
    const hypIdx = title.indexOf(' - ');
    const idx = emIdx !== -1 ? emIdx : hypIdx;
    const sep = emIdx !== -1 ? '-' : ' - ';
    if (idx === -1) return <span>{title}</span>;
    return (
      <>
        <span>{title.slice(0, idx + sep.length)}</span>
        <span style={{ color: '#4A90E2' }}>{title.slice(idx + sep.length)}</span>
      </>
    );
  };

  const metaItems = [
    trip && { icon: 'Calendar', content: trip.title || trip.name },
    list?.port_location && { icon: 'MapPin', content: list.port_location },
    supplierName && { icon: 'User', content: supplierName },
    deptTags.length > 0 && { type: 'chips', content: deptTags },
  ].filter(Boolean);

  // ── Editorial header (Sprint 9c.1) ────────────────────────────────────────
  // Split the board title into the editorial pattern's two halves.
  // 'Charter - Bridge'  → headline='CHARTER',  qualifier='Bridge'
  // 'Owner Week'        → headline='OWNER WEEK', qualifier=<dept fallback>
  const titleStr = list?.title || '';
  const sepMatch = titleStr.match(/\s*-\s*/);
  let editorialHeadline;
  let editorialQualifier;
  if (sepMatch) {
    editorialHeadline = titleStr.slice(0, sepMatch.index).trim().toUpperCase();
    editorialQualifier = titleStr.slice(sepMatch.index + sepMatch[0].length).trim();
  } else {
    editorialHeadline = titleStr.toUpperCase();
    editorialQualifier = deptTags[0] || 'Provisioning';
  }
  // Subtitle carries the operational state — status + overdue flag — that
  // used to live as inline chips next to the H1 in the predecessor design.
  const editorialSubtitle = [
    statusLabel,
    isOverdue && 'Overdue',
  ].filter(Boolean).join(' · ');
  // Meta strip — translates the existing metaItems to the editorial segment
  // shape. Dept chips are dropped from the strip (they were a different
  // visual pattern); first dept lands in the qualifier instead.
  const editorialMeta = [
    list?.port_location && { icon: 'MapPin', label: list.port_location },
    trip && { label: trip.title || trip.name },
    supplierName && { label: supplierName, muted: true },
  ].filter(Boolean);

  // ── States ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (error || !list) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-background px-6 py-10">
          <button onClick={() => navigate('/provisioning')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
            <Icon name="ArrowLeft" className="w-4 h-4" /> Back to boards
          </button>
          <p className="text-muted-foreground">{error || 'Board not found.'}</p>
        </div>
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Header />
      <div className="editorial-page">

        <EditorialPageShell
          title={editorialHeadline}
          qualifier={editorialQualifier}
          subtitle={editorialSubtitle}
          meta={editorialMeta}
          backTo="/provisioning"
          backLabel="Back to boards"
          rightRail={null}
          showDuty={false}
          actionStrip={
            // Sprint 9c.1 Commit 3: unified pill aesthetic per the editorial
            // language. Two visual groups separated by a hairline divider:
            // read actions (Suggestions / Templates / PDF / Print) on the
            // left, write actions (Receive Items / Send to Supplier or
            // Submit for Approval / overflow menu) on the right. Send to
            // Supplier is the lone "primary" action — filled navy when its
            // gating condition (hasSendableItems) holds.
            <div className="cargo-ribbon">
              {/* Read actions */}
              <div className="cargo-ribbon-group">
                <button
                  type="button"
                  onClick={showSuggestions ? () => setShowSuggestions(false) : handleGetSuggestions}
                  disabled={suggestionsLoading}
                  className={`cargo-ribbon-btn${showSuggestions ? ' cargo-ribbon-btn-active' : ''}`}
                >
                  <span aria-hidden="true">{suggestionsLoading ? '…' : '✦'}</span> Suggestions
                </button>
                <button
                  type="button"
                  onClick={() => showToast('Templates coming soon', 'success')}
                  className="cargo-ribbon-btn"
                >
                  <Icon name="FileText" style={{ width: 13, height: 13 }} /> Templates
                </button>
                <button
                  type="button"
                  onClick={() => { showToast('Use "Save as PDF" in the print dialog', 'success'); setTimeout(() => window.print(), 300); }}
                  className="cargo-ribbon-btn"
                >
                  <Icon name="FileDown" style={{ width: 13, height: 13 }} /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="cargo-ribbon-btn"
                >
                  <Icon name="Printer" style={{ width: 13, height: 13 }} /> Print
                </button>
              </div>

              <div className="cargo-ribbon-divider" aria-hidden="true" />

              {/* Write actions */}
              <div className="cargo-ribbon-group">
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(true)}
                  className="cargo-ribbon-btn"
                >
                  <Icon name="PackageCheck" style={{ width: 13, height: 13 }} /> Receive Items
                </button>
                {canSendToSupplier && (
                  <button
                    type="button"
                    onClick={handleSendToSupplier}
                    disabled={!hasSendableItems}
                    className="cargo-ribbon-btn cargo-ribbon-btn-primary"
                    title={!hasSendableItems ? 'Add items to the board before sending' : undefined}
                  >
                    <Icon name="Send" style={{ width: 13, height: 13 }} /> Send to Supplier
                  </button>
                )}
                {isDraftOrPending && (
                  <button
                    type="button"
                    onClick={() => handleStatusUpdate(PROVISIONING_STATUS.PENDING_APPROVAL)}
                    className="cargo-ribbon-btn"
                  >
                    <Icon name="Send" style={{ width: 13, height: 13 }} /> Submit for Approval
                  </button>
                )}
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setShowMenu(v => !v)}
                    className="cargo-ribbon-btn cargo-ribbon-btn-icon"
                    aria-label="More board actions"
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                  >
                    <Icon name="MoreHorizontal" style={{ width: 14, height: 14 }} />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[185px] z-50">
                      {canEdit && (
                        <button onClick={() => { setShowMenu(false); setShowEditModal(true); }} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                          <Icon name="Pencil" className="w-4 h-4" /> Edit Board
                        </button>
                      )}
                      <button onClick={handleDuplicate} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                        <Icon name="Copy" className="w-4 h-4" /> Duplicate
                      </button>
                      {canDelete && (
                        <>
                          <div className="my-1 border-t border-border" />
                          <button onClick={handleDeleteBoard} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2">
                            <Icon name="Trash2" className="w-4 h-4" /> Delete Board
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          }
        >

        <EditorialTabNav
          tabs={[
            { id: 'items', label: 'Items' },
            { id: 'deliveries', label: 'Deliveries' },
            { id: 'orders', label: 'Orders' },
            { id: 'history', label: 'History' },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* ── Smart Suggestions panel ──────────────────────────────────── */}
        {showSuggestions && (
          <div style={{ margin: '0 24px 0', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ background: '#F0F7FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: '16px 20px', margin: '12px 0' }}>
              {/* Panel header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>✦ Smart Suggestions</span>
                  {suggestionsLoading && (
                    <span style={{ fontSize: 11, color: '#64748B' }}>Analysing your history…</span>
                  )}
                  {!suggestionsLoading && suggestions.length > 0 && (
                    <span style={{ fontSize: 11, color: '#64748B' }}>{suggestions.filter(s => !skippedSuggestions.has(s.name) && !addedSuggestions.has(s.name)).length} suggestions</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!suggestionsLoading && suggestions.filter(s => !skippedSuggestions.has(s.name) && !addedSuggestions.has(s.name)).length > 1 && (
                    <button
                      onClick={handleAddAllSuggestions}
                      style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', background: '#1E3A5F', border: 'none', color: 'white' }}
                    >
                      Add All
                    </button>
                  )}
                  <button
                    onClick={() => setShowSuggestions(false)}
                    style={{ fontSize: 11, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                  >
                    ✕ Close
                  </button>
                </div>
              </div>

              {/* Loading skeleton */}
              {suggestionsLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1, 2, 3].map(n => (
                    <div key={n} style={{ height: 52, borderRadius: 8, background: '#E0ECFF', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!suggestionsLoading && suggestions.length === 0 && (
                <p style={{ fontSize: 12, color: '#64748B', textAlign: 'center', padding: '12px 0', margin: 0 }}>
                  No new suggestions — your board looks well-stocked!
                </p>
              )}

              {/* Suggestion cards */}
              {!suggestionsLoading && suggestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {suggestions.map(s => {
                    const isAdded   = addedSuggestions.has(s.name);
                    const isSkipped = skippedSuggestions.has(s.name);
                    if (isSkipped) return null;
                    return (
                      <div
                        key={s.name}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: isAdded ? '#ECFDF5' : 'white',
                          border: `1px solid ${isAdded ? '#A7F3D0' : '#DBEAFE'}`,
                          borderRadius: 8, padding: '9px 12px', gap: 12,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isAdded ? '#065F46' : '#0F172A' }}>{s.name}</span>
                            <span style={{ fontSize: 10, color: '#94A3B8', background: '#F1F5F9', borderRadius: 4, padding: '1px 6px' }}>{s.category}</span>
                            {s.source === 'history' && (
                              <span style={{ fontSize: 10, color: '#7C3AED', background: '#F5F3FF', borderRadius: 4, padding: '1px 6px' }}>from history</span>
                            )}
                            {s.confidence === 'high' && s.source !== 'history' && (
                              <span style={{ fontSize: 10, color: '#065F46', background: '#ECFDF5', borderRadius: 4, padding: '1px 6px' }}>high confidence</span>
                            )}
                          </div>
                          <p style={{ margin: '3px 0 0', fontSize: 11, color: '#64748B', lineHeight: 1.4 }}>
                            {s.quantity} {s.unit} · {s.reasoning}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {isAdded ? (
                            <span style={{ fontSize: 11, color: '#065F46', fontWeight: 600 }}>✓ Added</span>
                          ) : (
                            <>
                              <button
                                onClick={() => setSkippedSuggestions(prev => new Set([...prev, s.name]))}
                                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#94A3B8' }}
                              >
                                Skip
                              </button>
                              <button
                                onClick={() => handleAddSuggestion(s)}
                                style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', background: '#1E3A5F', border: 'none', color: 'white' }}
                              >
                                + Add
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Allergen banner ───────────────────────────────────────────── */}
        {allergenGuests.length > 0 && (
          <div className="mx-6 mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <span className="flex-shrink-0 mt-0.5">⚠</span>
            <div>
              <span className="font-semibold">Allergen alert: </span>
              {allergenGuests.map((g, i) => (
                <span key={i}>{i > 0 && ' · '}<strong>{g.name}</strong> - {g.allergies}</span>
              ))}
              <span className="text-amber-600 dark:text-amber-400"> · Highlighted rows may be affected.</span>
            </div>
          </div>
        )}

        {/* ── Toolbar ───────────────────────────────────────────────────── */}
        <div style={{ background: 'white', borderBottom: '1px solid #F1F5F9', padding: '10px 32px', position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Icon name="Search" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#CBD5E1', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search items…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6, fontSize: 12, background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 7, color: '#0F172A', outline: 'none', width: 220 }}
              />
            </div>
            {/* Dept filter */}
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              style={{ fontSize: 11, background: 'white', border: '1px solid #F1F5F9', borderRadius: 7, padding: '6px 10px', color: '#64748B', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">All depts</option>
              {departments.map(d => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
            </select>
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ fontSize: 11, background: 'white', border: '1px solid #F1F5F9', borderRadius: 7, padding: '6px 10px', color: '#64748B', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">All statuses</option>
              {ITEM_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {hasFilters && (
              <button
                onClick={() => { setSearchQuery(''); setDeptFilter('all'); setStatusFilter('all'); }}
                style={{ fontSize: 11, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                onMouseEnter={e => e.currentTarget.style.color = '#1E3A5F'}
                onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
              >
                Clear filters
              </button>
            )}
            {/* Group by */}
            <select
              value={groupBy}
              onChange={e => {
                const next = e.target.value;
                setGroupBy(next);
                if (next === 'category' && sortColumn === 'category') {
                  setSortColumn('item');
                  setSortDirection('asc');
                }
              }}
              style={{ fontSize: 11, background: 'white', border: '1px solid #F1F5F9', borderRadius: 7, padding: '6px 10px', color: '#64748B', outline: 'none', cursor: 'pointer' }}
            >
              <option value="category">Group: Category</option>
              <option value="none">Group: None</option>
            </select>
            {/* Show received toggle */}
            <button
              type="button"
              onClick={() => setShowReceived(p => !p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <div style={{ width: 28, height: 16, borderRadius: 99, background: showReceived ? '#1E3A5F' : '#E2E8F0', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 2, left: showReceived ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>Show received</span>
            </button>
          </div>
          {/* Progress */}
          {(() => {
            const totalItems = items.length;
            const receivedItems = items.filter(i => i.status === 'received').length;
            const pct = totalItems > 0 ? receivedItems / totalItems : 0;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                  {receivedItems} of {totalItems} items received
                </span>
                <div style={{ width: 64, height: 3, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ height: '100%', width: `${Math.round(pct * 100)}%`, background: 'linear-gradient(90deg, #4A90E2, #34D399)', borderRadius: 99, transition: 'width 0.4s' }} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Items area ────────────────────────────────────────────────── */}
        {activeTab === 'items' && <div style={{ padding: '24px 0 48px' }}>
          {deptGroups.length === 0 && items.length === 0 ? (
            /* True empty board */
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, background: '#F8FAFC', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="ShoppingBag" style={{ width: 28, height: 28, color: '#CBD5E1' }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#0F172A', marginBottom: 4 }}>No items yet</p>
              <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 16 }}>Add items to track your provisioning order.</p>
              {canAddItems && (
                <button
                  onClick={() => { setAddingToDept(defaultDept || 'General'); setNewItemName(''); setNewItemCategory(''); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#1E3A5F', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  <Icon name="Plus" style={{ width: 14, height: 14 }} /> Add first item
                </button>
              )}
            </div>
          ) : deptGroups.length === 0 && !hasFilters ? (
            /* All items received */
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, background: '#ECFDF5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="CheckCircle" style={{ width: 28, height: 28, color: '#34D399' }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>All items received ✓</p>
              <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20 }}>View the Deliveries tab for delivery history.</p>
              {addingToDept === '__global__' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'white', border: '1px solid #93C5FD', borderRadius: 8 }}>
                  <input autoFocus type="text" placeholder="Item name…" value={newItemName}
                    onChange={e => {
                      setNewItemName(e.target.value);
                      if (!e.target.value.trim()) clearInference();
                    }}
                    onBlur={() => {
                      const dn = defaultDept || 'General';
                      if (!newItemCategory.trim() && newItemName.trim()) {
                        inferCategory(newItemName, dn, categoriesForDept(dn));
                      }
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { handleAddItem(defaultDept || 'General'); setAddingToDept(null); } if (e.key === 'Escape') { setAddingToDept(null); setNewItemName(''); setNewItemCategory(''); } }}
                    style={{ fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: '#0F172A', width: 200 }} />
                  <select
                    value={newItemCategory}
                    onChange={e => setNewItemCategory(e.target.value)}
                    style={{ fontSize: 13, background: 'white', border: '1px solid #93C5FD', borderRadius: 6, padding: '4px 8px', outline: 'none', color: newItemCategory ? '#0F172A' : '#94A3B8', cursor: 'pointer', fontStyle: !newItemCategory && inferring ? 'italic' : 'normal' }}
                  >
                    <option value="">{inferring && !newItemCategory ? 'Inferring…' : 'Select category…'}</option>
                    {categoriesForDept(defaultDept || 'General').filter(c => c !== 'Uncategorised').map(c => <option key={c} value={c}>{c}</option>)}
                    <option disabled>──────────</option>
                    <option value="Uncategorised">Uncategorised</option>
                  </select>
                  <button onClick={() => { handleAddItem(defaultDept || 'General'); setAddingToDept(null); }} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', background: '#1E3A5F', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer' }}>Add</button>
                  <button onClick={() => { setAddingToDept(null); setNewItemName(''); setNewItemCategory(''); }} style={{ fontSize: 12, padding: '4px 8px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, color: '#94A3B8', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : canAddItems ? (
                <button onClick={() => { setAddingToDept(defaultDept || '__global__'); setNewItemName(''); setNewItemCategory(''); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'white', border: '1px dashed #CBD5E1', borderRadius: 8, color: '#64748B', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  <Icon name="Plus" style={{ width: 14, height: 14 }} /> Add another item
                </button>
              ) : null}
            </div>
          ) : deptGroups.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>No items match your filters.</div>
          ) : (
            <>
              {deptGroups.map(({ dept, deptObj, items: deptItems }) => {
                const deptChip = getDeptChip(dept);
                const deptSubtotal = deptItems.reduce((acc, i) => {
                  const cost = parseFloat(i.estimated_unit_cost) || 0;
                  const qty = parseFloat(i.quantity_ordered) || 0;
                  const iCurr = i.currency || currency;
                  return acc + qty * ((cost / (fxRates[iCurr] || 1)) * (fxRates[dispCurr] || 1));
                }, 0);
                const allDeptSel = deptItems.length > 0 && deptItems.every(i => selectedItems.has(i.id));
                return (
                  <div key={dept} style={{ marginBottom: 24 }}>
                    {/* Dept header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ background: deptChip.bg, color: deptChip.color, fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 4, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
                        {dept}
                      </span>
                      <span style={{ fontSize: 11, color: '#CBD5E1', flexShrink: 0 }}>{deptItems.length} item{deptItems.length !== 1 ? 's' : ''}</span>
                      <div style={{ flex: 1, height: 1, background: '#F1F5F9' }} />
                      <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>{dispSymbol}{deptSubtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    </div>

                    {/* White card table */}
                    <div style={{ background: 'white', border: '1px solid #F1F5F9', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      {/* Table header */}
                      <div style={{ display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px', background: '#FAFAFA', borderBottom: '1px solid #F1F5F9' }}>
                        {/* Receive-all checkbox for dept */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0' }}>
                          <input
                            type="checkbox"
                            checked={false}
                            title="Mark all as received"
                            onChange={() => deptItems.forEach(i => handleQuickReceive(i))}
                            style={{ width: 13, height: 13, accentColor: '#1D9E75', cursor: 'pointer' }}
                          />
                        </div>
                        {[
                          { label: 'Item',      key: 'item' },
                          ...(groupBy === 'category' ? [] : [{ label: 'Category', key: 'category' }]),
                          { label: 'Size',      key: null },
                          { label: 'Unit',      key: null },
                          { label: 'Qty',       key: 'qty' },
                          { label: 'Unit Cost', key: 'unit_cost' },
                          { label: 'Total',     key: 'total' },
                          { label: 'Status',    key: 'status' },
                          { label: '',          key: null },
                        ].map(({ label, key }, idx) => {
                          const sortable = !!key;
                          const active = sortable && sortColumn === key;
                          return (
                            <div
                              key={`${label}-${idx}`}
                              onClick={sortable ? () => handleSort(key) : undefined}
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                color: active ? '#1E3A5F' : '#CBD5E1',
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                padding: '10px 8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                cursor: sortable ? 'pointer' : 'default',
                                userSelect: sortable ? 'none' : undefined,
                              }}
                            >
                              {label}
                              {active && (
                                <span style={{ fontSize: 9, color: '#1E3A5F' }}>
                                  {sortDirection === 'asc' ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Item rows */}
                      {(() => {
                        const renderItemRow = (item, rowIdx, totalRows) => {
                        const badge = STATUS_BADGE[item.status] || STATUS_BADGE.draft;
                        const isHovered = hoveredRow === item.id;
                        const isEditing = editingCell?.itemId === item.id;
                        const allergen = isAllergenRisk(item);
                        const isReceived = item.status === 'received';
                        const dim = isReceived ? '#CBD5E1' : null;
                        const itemCurr = item.currency || currency;
                        const convertCost = (amt) => (parseFloat(amt) / (fxRates[itemCurr] || 1)) * (fxRates[dispCurr] || 1);
                        const showOriginal = itemCurr !== dispCurr;
                        const origSymbol = CURR_SYMBOLS[itemCurr] || '£';

                        // Supplier-order locking
                        const itemOrder = itemStatusMap[(item.name || '').toLowerCase().trim()];
                        const isLocked = isSent && !!itemOrder;
                        const displayBadge = isLocked ? (SUPPLIER_BADGE[itemOrder.status] || SUPPLIER_BADGE.pending) : badge;

                        return (
                          <div
                            key={item.id}
                            onMouseEnter={() => setHoveredRow(item.id)}
                            onMouseLeave={() => setHoveredRow(null)}
                            style={{
                              display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px',
                              background: allergen ? '#FFFBEB' : isHovered ? '#FAFCFF' : 'white',
                              borderBottom: rowIdx < totalRows - 1 ? '1px solid #F8FAFC' : 'none',
                              transition: 'background 0.1s',
                              opacity: isLocked && itemOrder.status === 'unavailable' ? 0.7 : 1,
                            }}
                          >
                            {/* Quick-receive checkbox / received checkmark */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0' }}>
                              {item.status === 'received' ? (
                                <Icon name="CheckCircle" style={{ width: 13, height: 13, color: '#4ADE80' }} />
                              ) : (
                              <input
                                type="checkbox"
                                checked={false}
                                title="Mark as received"
                                onChange={() => handleQuickReceive(item)}
                                style={{ width: 13, height: 13, accentColor: '#1D9E75', cursor: 'pointer' }}
                              />
                              )}
                            </div>
                            {/* Item (name + brand italic sub-text) */}
                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '9px 8px', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {allergen && <span title="Allergen risk" style={{ fontSize: 11 }}>⚠</span>}
                                {editingCell?.itemId === item.id && editingCell?.field === 'name' ? (
                                  <input
                                    autoFocus
                                    defaultValue={item.name}
                                    onBlur={e => { handleCellSave(item, 'name', e.target.value); setEditingCell(null); }}
                                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                    style={{ fontSize: 13, color: '#0F172A', background: '#F0F7FF', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 6px', width: '100%', outline: 'none' }}
                                  />
                                ) : (
                                  <>
                                    <span
                                      onDoubleClick={() => !isReceived && !isLocked && setEditingCell({ itemId: item.id, field: 'name' })}
                                      style={{
                                        fontSize: 13,
                                        color: itemOrder?.status === 'unavailable' ? '#94A3B8' : dim || '#0F172A',
                                        fontWeight: 500, cursor: 'default', lineHeight: 1.3,
                                        textDecoration: itemOrder?.status === 'unavailable' ? 'line-through' : 'none',
                                      }}
                                    >
                                      {item.name}
                                    </span>
                                    {isLocked && (
                                      <span style={{
                                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                        textTransform: 'uppercase', letterSpacing: '0.4px',
                                        background: itemOrder.status === 'confirmed'   ? '#D1FAE5'
                                                  : itemOrder.status === 'unavailable' ? '#FEE2E2'
                                                  : itemOrder.status === 'substituted' ? '#FEF3C7'
                                                  : '#E0F2FE',
                                        color: itemOrder.status === 'confirmed'   ? '#065F46'
                                             : itemOrder.status === 'unavailable' ? '#991B1B'
                                             : itemOrder.status === 'substituted' ? '#92400E'
                                             : '#0369A1',
                                      }}>
                                        {itemOrder.status === 'confirmed'   ? 'Confirmed'
                                        : itemOrder.status === 'unavailable' ? 'Unavailable'
                                        : itemOrder.status === 'substituted' ? 'Substituted'
                                        : 'Sent'}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                              {!isReceived && !isLocked && <AlwaysEditCell
                                value={item.brand ?? ''}
                                placeholder="Brand…"
                                onSave={v => handleCellSave(item, 'brand', v)}
                                inputStyle={{ fontSize: 11, color: '#0F172A', paddingLeft: allergen ? 18 : undefined }}
                              />}
                              {(isReceived || isLocked) && item.brand && <span style={{ fontSize: 11, color: dim || '#94A3B8', padding: '2px 6px' }}>{item.brand}</span>}
                              {isLocked && itemOrder?.status === 'substituted' && itemOrder.substitution && (
                                <span style={{ fontSize: 11, color: '#92400E', paddingLeft: 6, borderLeft: '2px solid #F59E0B', marginTop: 2 }}>
                                  → {itemOrder.substitution}{itemOrder.subPrice ? ` (${itemOrder.subPrice})` : ''}
                                </span>
                              )}
                            </div>
                            {/* Category */}
                            {groupBy !== 'category' && (
                              <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                                <span style={{ fontSize: 12, color: dim || '#64748B' }}>
                                  {(() => {
                                    const segs = [item.category, item.sub_category]
                                      .filter(Boolean)
                                      .join(' > ')
                                      .split(/\s*[>›]\s*/)
                                      .map(s => s.trim())
                                      .filter(Boolean)
                                      .filter((s, i, arr) => arr.indexOf(s) === i);
                                    return segs.length > 0
                                      ? segs.join(' › ')
                                      : <span style={{ color: '#CBD5E1' }}>-</span>;
                                  })()}
                                </span>
                              </div>
                            )}
                            {/* Size */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {isReceived || isLocked
                                ? <span style={{ fontSize: 12, color: dim || (isLocked ? '#94A3B8' : undefined) }}>{item.size || ''}</span>
                                : <AlwaysEditCell value={item.size ?? ''} placeholder="e.g. 750ml" onSave={v => handleCellSave(item, 'size', v)} inputStyle={{ fontSize: 12, color: '#0F172A' }} />
                              }
                            </div>
                            {/* Unit */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {isReceived || isLocked
                                ? <span style={{ fontSize: 11, color: dim || (isLocked ? '#94A3B8' : undefined) }}>{item.unit || 'each'}</span>
                                : <select value={item.unit || 'each'} onChange={e => handleCellSave(item, 'unit', e.target.value)} style={{ fontSize: 11, color: '#64748B', background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, width: '100%' }}>
                                    {PROVISION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                              }
                            </div>
                            {/* Qty */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px', gap: 3 }}>
                              {isReceived || isLocked
                                ? <span style={{ fontSize: 13, color: dim || (isLocked ? '#94A3B8' : undefined), minWidth: 18, textAlign: 'center' }}>{item.quantity_ordered ?? '-'}</span>
                                : <>
                                    <button onClick={() => handleQtyStep(item, 'quantity_ordered', -1)} style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F5F9', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 13, color: '#64748B', flexShrink: 0, lineHeight: 1, padding: 0 }}>−</button>
                                    {editingCell?.itemId === item.id && editingCell?.field === 'quantity_ordered' ? (
                                      <input autoFocus type="number" defaultValue={item.quantity_ordered ?? ''} onBlur={e => { handleCellSave(item, 'quantity_ordered', e.target.value); setEditingCell(null); }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null); }} style={{ fontSize: 13, color: '#0F172A', background: '#F0F7FF', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 4px', width: 36, outline: 'none', textAlign: 'center', flexShrink: 0 }} />
                                    ) : (
                                      <span onDoubleClick={() => setEditingCell({ itemId: item.id, field: 'quantity_ordered' })} style={{ fontSize: 13, color: '#0F172A', cursor: 'default', minWidth: 18, textAlign: 'center', flexShrink: 0 }}>{item.quantity_ordered ?? <span style={{ color: '#CBD5E1' }}>-</span>}</span>
                                    )}
                                    <button onClick={() => handleQtyStep(item, 'quantity_ordered', 1)} style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F5F9', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 13, color: '#64748B', flexShrink: 0, lineHeight: 1, padding: 0 }}>+</button>
                                  </>
                              }
                            </div>
                            {/* Unit Cost */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px', gap: 3 }}>
                              <span style={{ fontSize: 11, color: dim || '#94A3B8', flexShrink: 0 }}>{origSymbol}</span>
                              {isReceived || isLocked
                                ? <span style={{ fontSize: 13, color: dim || (isLocked ? '#94A3B8' : undefined) }}>{item.estimated_unit_cost ?? ''}</span>
                                : <AlwaysEditCell value={item.estimated_unit_cost ?? ''} placeholder="0.00" type="number" onSave={v => handleCellSave(item, 'estimated_unit_cost', v)} inputStyle={{ fontSize: 13, color: '#0F172A', textAlign: 'right' }} />
                              }
                            </div>
                            {/* Total */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {(() => {
                                const qty = parseFloat(item.quantity_ordered);
                                const cost = parseFloat(item.estimated_unit_cost);
                                return !isNaN(qty) && !isNaN(cost)
                                  ? <span style={{ fontSize: 13, color: dim || '#0F172A', fontWeight: 500 }}>{dispSymbol}{(qty * convertCost(cost)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  : <span style={{ fontSize: 13, color: dim || '#CBD5E1' }}>-</span>;
                              })()}
                            </div>
                            {/* Status badge select */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 5, height: 5, borderRadius: '50%', background: displayBadge.dot, pointerEvents: 'none', zIndex: 1 }} />
                                {isLocked
                                  ? <span style={{ paddingLeft: 16, paddingRight: 8, paddingTop: 3, paddingBottom: 3, fontSize: 11, fontWeight: 600, background: displayBadge.bg, color: displayBadge.color, border: `1px solid ${displayBadge.border}`, borderRadius: 6, display: 'inline-block' }}>{displayBadge.label}</span>
                                  : <select
                                      value={item.status || 'draft'}
                                      onChange={e => handleStatusSave(item, 'status', e.target.value)}
                                      style={{
                                        paddingLeft: 16, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
                                        fontSize: 11, fontWeight: 600, background: badge.bg, color: badge.color,
                                        border: `1px solid ${badge.border}`, borderRadius: 6,
                                        cursor: 'pointer', outline: 'none', appearance: 'none',
                                      }}
                                    >
                                      {ITEM_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    </select>
                                }
                              </div>
                            </div>
                            {/* Actions */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '11px 0', gap: 2 }}>
                              {isHovered && !isLocked && (
                                <>
                                  <button
                                    onClick={() => setItemDrawer({ open: true, item })}
                                    title="Edit"
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#94A3B8' }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                  >
                                    <Icon name="Pencil" style={{ width: 12, height: 12 }} />
                                  </button>
                                  {canDeleteItem && (
                                    <button
                                      onClick={() => handleDeleteItem(item.id)}
                                      title="Delete"
                                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#94A3B8' }}
                                      onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#EF4444'; }}
                                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
                                    >
                                      <Icon name="Trash2" style={{ width: 12, height: 12 }} />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                        };

                        if (groupBy === 'category') {
                          const catMap = new Map();
                          for (const it of deptItems) {
                            const k = it.category || 'Uncategorised';
                            if (!catMap.has(k)) catMap.set(k, []);
                            catMap.get(k).push(it);
                          }
                          const catEntries = Array.from(catMap.entries()).sort(([a], [b]) => {
                            if (a === 'Uncategorised') return 1;
                            if (b === 'Uncategorised') return -1;
                            return a.localeCompare(b);
                          });

                          return catEntries.map(([category, catItems]) => {
                            // Category header colour comes from the dept now (single source
                            // of truth: public.departments.color). Falls back to neutral grey
                            // when the dept isn't in the lookup table (e.g. 'General').
                            const color = getDepartmentColor(deptObj);
                            const key = `${dept}::${category}`;
                            const isCollapsed = collapsedCategories.has(key);
                            const subtotal = catItems.reduce((sum, i) => {
                              const cost = parseFloat(i.estimated_unit_cost) || 0;
                              const qty  = parseFloat(i.quantity_ordered) || 0;
                              const iCurr = i.currency || currency;
                              return sum + qty * ((cost / (fxRates[iCurr] || 1)) * (fxRates[dispCurr] || 1));
                            }, 0);
                            const sortedRows = sortItems(catItems);

                            return (
                              <React.Fragment key={key}>
                                <div
                                  onClick={() => toggleCategory(key)}
                                  style={{
                                    background: hexToRgba(color, 0.08),
                                    borderLeft: `4px solid ${color}`,
                                    padding: '10px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    borderTop: '1px solid #F1F5F9',
                                    transition: 'filter 0.15s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.97)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ color, fontSize: 12 }}>{isCollapsed ? '▸' : '▾'}</span>
                                    <span style={{ color, fontWeight: 500, fontSize: 13 }}>{category}</span>
                                    <span style={{ fontSize: 12, color: '#64748B' }}>
                                      {catItems.length} {catItems.length === 1 ? 'item' : 'items'}
                                    </span>
                                  </div>
                                  <span style={{ color, fontWeight: 500, fontSize: 13 }}>
                                    {dispSymbol}{subtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </span>
                                </div>
                                {!isCollapsed && sortedRows.map((item, idx) => renderItemRow(item, idx, sortedRows.length))}
                              </React.Fragment>
                            );
                          });
                        }

                        const sortedFlat = sortItems(deptItems);
                        return sortedFlat.map((item, idx) => renderItemRow(item, idx, sortedFlat.length));
                      })()}

                      {/* Subtotal row */}
                      <div style={{ display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
                        <div style={{ gridColumn: groupBy === 'category' ? '1 / 6' : '1 / 7', padding: '8px 8px 8px 0' }}>
                          <span style={{ fontSize: 11, color: '#94A3B8' }}>{deptItems.length} item{deptItems.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ padding: '8px 8px', display: 'flex', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1E3A5F' }}>{dispSymbol}{deptSubtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                        <div />{/* total col */}
                        <div />{/* status col */}
                        <div />{/* actions col */}
                      </div>

                      {/* Add item row */}
                      {addingToDept === dept ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px dashed #E2E8F0', background: '#FAFEFF' }}>
                          <input
                            autoFocus
                            type="text"
                            placeholder="Item name…"
                            value={newItemName}
                            onChange={e => {
                              setNewItemName(e.target.value);
                              if (!e.target.value.trim()) clearInference();
                            }}
                            onBlur={() => {
                              if (!newItemCategory.trim() && newItemName.trim()) {
                                inferCategory(newItemName, dept, categoriesForDept(dept));
                              }
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddItem(dept); if (e.key === 'Escape') { setAddingToDept(null); setNewItemName(''); setNewItemCategory(''); } }}
                            style={{ flex: 1, fontSize: 13, background: 'white', border: '1px solid #93C5FD', borderRadius: 6, padding: '5px 10px', outline: 'none', color: '#0F172A' }}
                          />
                          <select
                            value={newItemCategory}
                            onChange={e => setNewItemCategory(e.target.value)}
                            style={{ flex: '0 0 200px', fontSize: 13, background: 'white', border: '1px solid #93C5FD', borderRadius: 6, padding: '5px 10px', outline: 'none', color: newItemCategory ? '#0F172A' : '#94A3B8', cursor: 'pointer', fontStyle: !newItemCategory && inferring ? 'italic' : 'normal' }}
                          >
                            <option value="">{inferring && !newItemCategory ? 'Inferring…' : 'Select category…'}</option>
                            {categoriesForDept(dept).filter(c => c !== 'Uncategorised').map(c => <option key={c} value={c}>{c}</option>)}
                            <option disabled>──────────</option>
                            <option value="Uncategorised">Uncategorised</option>
                          </select>
                          <button onClick={() => handleAddItem(dept)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', background: '#1E3A5F', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setAddingToDept(null); setNewItemName(''); setNewItemCategory(''); }} style={{ fontSize: 12, padding: '5px 10px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, color: '#94A3B8', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      ) : canAddItems ? (
                        <button
                          onClick={() => { setAddingToDept(dept); setNewItemName(''); setNewItemCategory(''); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '9px 16px', background: 'none', border: 'none', borderTop: '1px dashed #F1F5F9', cursor: 'pointer', fontSize: 12, color: '#CBD5E1', textAlign: 'left' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#FAFEFF'; e.currentTarget.style.color = '#4A90E2'; e.currentTarget.style.borderTopColor = '#4A90E2'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#CBD5E1'; e.currentTarget.style.borderTopColor = '#F1F5F9'; }}
                        >
                          <Icon name="Plus" style={{ width: 13, height: 13 }} /> Add item to {dept}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* Grand total row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderTop: '2px solid #F1F5F9', marginTop: 8, flexWrap: 'wrap', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{items.length} item{items.length !== 1 ? 's' : ''} total</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>
                    Estimated: <span style={{ fontWeight: 700, color: '#0F172A' }}>{dispSymbol}{Math.round(convertedTotals.estimated).toLocaleString()}</span>
                  </span>
                  {convertedTotals.actual > 0 && (
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>
                      Received: <span style={{ fontWeight: 700, color: '#15803D' }}>{dispSymbol}{Math.round(convertedTotals.actual).toLocaleString()}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* ── Global add item ────────────────────────────────────── */}
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px dashed #E2E8F0' }}>
                {addingToDept === '__global__' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Item name…"
                      value={newItemName}
                      onChange={e => {
                        setNewItemName(e.target.value);
                        if (!e.target.value.trim()) clearInference();
                      }}
                      onBlur={() => {
                        const dn = defaultDept || 'General';
                        if (!newItemCategory.trim() && newItemName.trim()) {
                          inferCategory(newItemName, dn, categoriesForDept(dn));
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { handleAddItem(defaultDept || 'General'); setAddingToDept(null); }
                        if (e.key === 'Escape') { setAddingToDept(null); setNewItemName(''); setNewItemCategory(''); }
                      }}
                      style={{ flex: 1, maxWidth: 320, fontSize: 13, background: 'white', border: '1px solid #93C5FD', borderRadius: 6, padding: '6px 10px', outline: 'none', color: '#0F172A' }}
                    />
                    <select
                      value={newItemCategory}
                      onChange={e => setNewItemCategory(e.target.value)}
                      style={{ flex: '0 0 200px', fontSize: 13, background: 'white', border: '1px solid #93C5FD', borderRadius: 6, padding: '6px 10px', outline: 'none', color: newItemCategory ? '#0F172A' : '#94A3B8', cursor: 'pointer', fontStyle: !newItemCategory && inferring ? 'italic' : 'normal' }}
                    >
                      <option value="">{inferring && !newItemCategory ? 'Inferring…' : 'Select category…'}</option>
                      {categoriesForDept(defaultDept || 'General').filter(c => c !== 'Uncategorised').map(c => <option key={c} value={c}>{c}</option>)}
                      <option disabled>──────────</option>
                      <option value="Uncategorised">Uncategorised</option>
                    </select>
                    <button onClick={() => { handleAddItem(defaultDept || 'General'); setAddingToDept(null); }} style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', background: '#1E3A5F', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer' }}>Add</button>
                    <button onClick={() => { setAddingToDept(null); setNewItemName(''); setNewItemCategory(''); }} style={{ fontSize: 12, padding: '6px 10px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, color: '#94A3B8', cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : canAddItems ? (
                  <button
                    onClick={() => { setAddingToDept(defaultDept || '__global__'); setNewItemName(''); setNewItemCategory(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#4A90E2'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
                  >
                    <Icon name="Plus" style={{ width: 13, height: 13 }} /> Add item
                  </button>
                ) : null}
              </div>
            </>
          )}

          {/* ── Summary gauges — always visible when items exist ──────── */}
          {items.length > 0 && (
            <SummaryGauges
              {...gaugeProps}
              dispSymbol={dispSymbol}
              dispCurr={dispCurr}
              setDisplayCurrency={setDisplayCurrency}
              fxRatesLabel={fxRatesLabel}
            />
          )}
        </div>}

        {/* ── Deliveries tab ─────────────────────────────────────────────── */}
        {activeTab === 'deliveries' && (
          <div style={{ padding: '32px 0 64px' }}>
            {deliveriesLoading ? (
              <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>Loading…</div>
            ) : deliveries.length === 0 && completedItems.length === 0 ? (
              <div style={{ padding: '80px 0', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, background: '#F1F5F9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <Icon name="PackageOpen" style={{ width: 22, height: 22, color: '#CBD5E1' }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#0F172A', marginBottom: 4 }}>No received items yet</p>
                <p style={{ fontSize: 12, color: '#94A3B8' }}>Received delivery history will appear here.</p>
              </div>
            ) : (() => {
              // ── Helper: render one timeline batch block ────────────────
              const ITEM_GRID = '40px 180px 140px 90px 70px 80px';
              const COL_HDRS  = ['Qty', 'Item', 'Category', 'Inventory', 'Cost', 'Payment'];

              const resolvedName = (uid) => uid ? (historyUserNames[uid] || 'Crew member') : null;
              const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
              const resolveUuidsInText = (text) => {
                if (!text) return text;
                return text.replace(uuidRegex, (uuid) => historyUserNames[uuid] || uuid);
              };

              const accentFor = (supplierName) => supplierName && supplierName !== 'Manual receive'
                ? { border: '#378ADD', badgeBg: '#E6F1FB', badgeText: '#185FA5' }
                : { border: '#1D9E75', badgeBg: '#E1F5EE', badgeText: '#0F6E56' };

              const invLabel = (bi) => bi.cargo_item_id ? 'Pushed' : bi.inventory_item_id ? 'Linked' : 'Skipped';
              const invColor = (bi) => bi.cargo_item_id ? '#059669' : bi.inventory_item_id ? '#2563EB' : '#94A3B8';

              const payColor = (ps) => ['paid', 'paid_upfront'].includes(ps) ? '#059669' : '#D97706';

              const renderBatchBlock = (batchItems, supplierName, receivedAt, batchId, receivedBy, invoiceData) => {
                const displaySupplier = resolveUuidsInText(supplierName) || 'Manual receive';
                const accent = accentFor(supplierName);
                const receivedByName = resolvedName(receivedBy);

                const batchTotal = batchItems.reduce((sum, bi) => {
                  const effectivePS = paymentStatusMap[bi.id] ?? bi.payment_status ?? 'awaiting_invoice';
                  const isPaid = ['paid', 'paid_upfront'].includes(effectivePS);
                  const cost = isPaid && bi.actual_unit_cost != null
                    ? parseFloat(bi.actual_unit_cost) : parseFloat(bi.estimated_unit_cost) || 0;
                  return sum + cost * (parseFloat(bi.quantity_received) || 0);
                }, 0);
                const batchTotalStr = batchTotal > 0 ? `${dispSymbol}${batchTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null;

                return (
                  <div key={batchId || supplierName + receivedAt} style={{ borderLeft: `2px solid ${accent.border}`, paddingLeft: 24, paddingBottom: 8 }}>
                        {/* Batch header row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: receivedByName ? 6 : 14 }}>
                          <span style={{ background: accent.badgeBg, color: accent.badgeText, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                            {displaySupplier}
                          </span>
                          <span style={{ fontSize: 12, color: '#94A3B8' }}>
                            {batchItems.length} item{batchItems.length !== 1 ? 's' : ''}
                            {batchTotalStr ? ` · ${batchTotalStr}` : ''}
                          </span>
                          <div style={{ flex: 1 }} />
                          {invoiceData && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                              <button
                                onClick={() => setInvoiceModal(invoiceData)}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 10px', background: invoiceData.batch.invoice_file_url ? '#ECFDF5' : 'white', border: `1px solid ${invoiceData.batch.invoice_file_url ? '#A7F3D0' : '#E2E8F0'}`, borderRadius: 6, color: invoiceData.batch.invoice_file_url ? '#047857' : '#64748B', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                <Icon name={invoiceData.batch.invoice_file_url ? 'FileCheck' : 'FileUp'} style={{ width: 11, height: 11 }} />
                                {invoiceData.batch.invoice_file_url ? 'Invoice ✓' : 'Upload invoice'}
                              </button>
                              {invoiceData.batch.invoice_file_url && (
                                <button
                                  onClick={() => window.open(invoiceData.batch.invoice_file_url, '_blank')}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#185FA5', background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
                                >
                                  <Icon name="FileText" size={13} />
                                  View document
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {receivedByName && (
                          <p style={{ margin: '0 0 12px', fontSize: 11, color: '#94A3B8' }}>
                            Received by <span style={{ fontWeight: 600, color: '#64748B' }}>{receivedByName}</span>
                          </p>
                        )}

                        {/* Column headers */}
                        <div style={{ display: 'grid', gridTemplateColumns: ITEM_GRID, gap: 12, padding: '0 0 6px', borderBottom: '0.5px solid #E5E7EB', marginBottom: 0 }}>
                          {COL_HDRS.map((h, i) => (
                            <span key={h} style={{ fontSize: 10, textTransform: 'uppercase', color: '#CBD5E1', letterSpacing: '0.05em', textAlign: i >= 4 ? 'right' : 'left' }}>{h}</span>
                          ))}
                        </div>

                        {/* Item rows */}
                        {batchItems.map((bi, idx) => {
                          const effectivePS = paymentStatusMap[bi.id] ?? bi.payment_status ?? 'awaiting_invoice';
                          const isPaid = ['paid', 'paid_upfront'].includes(effectivePS);
                          const costVal = isPaid && bi.actual_unit_cost != null
                            ? parseFloat(bi.actual_unit_cost) : parseFloat(bi.estimated_unit_cost);
                          const lineTotal = !isNaN(costVal) && costVal > 0
                            ? `${dispSymbol}${(costVal * (parseFloat(bi.quantity_received) || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
                          const isPartial = bi.quantity_ordered != null && bi.quantity_received < bi.quantity_ordered;
                          const qtyStr = isPartial ? `${bi.quantity_received}/${bi.quantity_ordered}` : `${bi.quantity_received ?? '?'}`;
                          const catPath = [bi.department, bi.sub_category || bi.category].filter(Boolean).join(' › ');
                          const itemTitle = [bi.name, bi.brand, bi.size].filter(Boolean).join(' · ');
                          return (
                            <div
                              key={bi.id}
                              style={{ display: 'grid', gridTemplateColumns: ITEM_GRID, gap: 12, padding: '12px 0', borderBottom: idx < batchItems.length - 1 ? '0.5px solid #F1F5F9' : 'none', alignItems: 'center' }}
                            >
                              <span style={{ fontSize: 13, color: '#374151' }}>{qtyStr}</span>
                              <span
                                onClick={() => setItemDrawer({ open: true, item: bi })}
                                style={{ fontSize: 13, fontWeight: 500, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                                title={itemTitle}
                              >{itemTitle}</span>
                              <span style={{ fontSize: 12, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={catPath}>{catPath || '—'}</span>
                              <span style={{ fontSize: 12, color: invColor(bi) }}>{invLabel(bi)}</span>
                              <span style={{ fontSize: 13, fontWeight: 500, color: '#0F172A', textAlign: 'right' }}>{lineTotal}</span>
                              <div style={{ textAlign: 'right' }}>
                                <select
                                  value={effectivePS}
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setPaymentStatusMap(prev => ({ ...prev, [bi.id]: val }));
                                    updateItemPaymentStatus(bi.id, val)
                                      .then(() => batchId && updateBatchTotal(batchId))
                                      .catch(() => {});
                                  }}
                                  style={{ fontSize: 11, fontWeight: 500, color: payColor(effectivePS), background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', maxWidth: 80 }}
                                >
                                  {PAYMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                  </div>
                );
              };

              // ── Build the unified batch list: real batches + fallback groups ──
              const allBatchData = [
                ...deliveries
                  .map(d => {
                    const batchItems = items.filter(i => i.receive_batch_id === d.id);
                    return batchItems.length ? { batchItems, supplierName: d.supplier_name || 'Manual receive', receivedAt: d.received_at, batchId: d.id, receivedBy: d.received_by, invoiceData: { batch: d, batchItems } } : null;
                  })
                  .filter(Boolean),
                ...(() => {
                  const fallbackGroups = {};
                  completedItems.forEach(item => {
                    const ts = item.updated_at || item.created_at;
                    // Group by date only so all items received on the same day merge into one block
                    const key = ts ? new Date(ts).toISOString().split('T')[0] : '1970-01-01';
                    if (!fallbackGroups[key]) fallbackGroups[key] = [];
                    fallbackGroups[key].push(item);
                  });
                  return Object.entries(fallbackGroups)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([dateKey, groupItems]) => ({ batchItems: groupItems, supplierName: 'Manual receive', receivedAt: dateKey + 'T12:00:00Z', batchId: `fallback-${dateKey}`, receivedBy: null, invoiceData: null }));
                })(),
              ];

              // Group by calendar date (YYYY-MM-DD), descending
              const batchesByDate = {};
              allBatchData.forEach(b => {
                const dateKey = b.receivedAt ? new Date(b.receivedAt).toISOString().split('T')[0] : '1970-01-01';
                if (!batchesByDate[dateKey]) batchesByDate[dateKey] = [];
                batchesByDate[dateKey].push(b);
              });
              const sortedDates = Object.keys(batchesByDate).sort((a, b) => b.localeCompare(a));

              return (
                <div>
                  {sortedDates.map((dateKey, dateIdx) => {
                    const dateBatches = batchesByDate[dateKey];
                    const dt = new Date(dateKey + 'T12:00:00');
                    const dayNum  = dt.getDate();
                    const monthAb = dt.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
                    const isLastDate = dateIdx === sortedDates.length - 1;
                    return (
                      <React.Fragment key={dateKey}>
                        <div style={{ display: 'flex', gap: 0 }}>
                          {/* ── Date column ── */}
                          <div style={{ width: 70, flexShrink: 0, paddingRight: 20, textAlign: 'right', paddingTop: 2 }}>
                            <div style={{ fontSize: 22, fontWeight: 500, color: '#0F172A', lineHeight: 1 }}>{dayNum}</div>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#94A3B8', letterSpacing: '0.05em', marginTop: 3 }}>{monthAb}</div>
                          </div>
                          {/* ── All batches for this date ── */}
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {dateBatches.map(b => renderBatchBlock(b.batchItems, b.supplierName, b.receivedAt, b.batchId, b.receivedBy, b.invoiceData))}
                          </div>
                        </div>
                        {/* Date separator */}
                        {!isLastDate && <div style={{ margin: '32px 0 32px 70px', height: 1, background: '#E9EDF2' }} />}
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── History tab ────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div style={{ padding: '32px 0 64px' }}>
            {activityLoading ? (
              <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>Loading…</div>
            ) : (() => {
              // Action → dot color mapping
              const dotColor = (action) => {
                if (['PROVISION_ITEM_RECEIVED', 'PROVISION_DELIVERY_SCANNED', 'PROVISION_ITEM_ADDED', 'PROVISION_INBOX_CLAIMED'].includes(action)) return '#059669'; // green
                if (['PROVISION_CROSS_DEPT_CONFIRMED'].includes(action)) return '#1E3A5F'; // navy
                if (['PROVISION_ITEM_QTY_CHANGED', 'PROVISION_ITEM_COST_CHANGED', 'PROVISION_ITEM_UPDATED', 'PROVISION_BOARD_UPDATED', 'PROVISION_BOARD_STATUS_CHANGED'].includes(action)) return '#D97706'; // amber
                if (['PROVISION_ITEM_DELETED'].includes(action)) return '#DC2626'; // red
                return '#94A3B8'; // gray
              };

              const entries = activityEvents.map(ev => ({
                key: ev.id,
                date: ev.createdAt ? new Date(ev.createdAt) : null,
                dot: dotColor(ev.action),
                summary: ev.summary || ev.action,
                meta: ev.meta || {},
                action: ev.action,
                actorName: ev.actorName,
                actorDepartment: ev.actorDepartment,
              })).filter(e => e.date).sort((a, b) => b.date - a.date);

              if (entries.length === 0) {
                return (
                  <div style={{ padding: '80px 0', textAlign: 'center' }}>
                    <Icon name="Clock" style={{ width: 32, height: 32, color: '#CBD5E1', margin: '0 auto 12px', display: 'block' }} />
                    <p style={{ fontSize: 14, color: '#64748B' }}>No activity recorded yet</p>
                    <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Activity will appear here as items are received and updated.</p>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {entries.map((entry, idx) => {
                    let relTime = '';
                    let absTime = '';
                    try {
                      relTime = formatDistanceToNow(entry.date, { addSuffix: true });
                      absTime = entry.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + entry.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    } catch { absTime = ''; }
                    const isExpanded = expandedHistory === entry.key;
                    const hasMeta = Object.keys(entry.meta).length > 0;
                    return (
                      <div key={entry.key} style={{ borderBottom: idx < entries.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                        {/* Collapsed row */}
                        <div
                          onClick={() => hasMeta && setExpandedHistory(isExpanded ? null : entry.key)}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 0', cursor: hasMeta ? 'pointer' : 'default' }}
                        >
                          {hasMeta && <span style={{ fontSize: 10, color: '#94A3B8', marginTop: 4, flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>}
                          {!hasMeta && <span style={{ width: 14, flexShrink: 0 }} />}
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.dot, flexShrink: 0, marginTop: 5 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{entry.summary}</p>
                            {entry.actorDepartment && (
                              <p style={{ margin: '3px 0 0', fontSize: 11, color: '#94A3B8' }}>{entry.actorDepartment}</p>
                            )}
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <p style={{ margin: 0, fontSize: 11, color: '#64748B' }}>{relTime}</p>
                            <p style={{ margin: '2px 0 0', fontSize: 10, color: '#CBD5E1' }}>{absTime}</p>
                          </div>
                        </div>
                        {/* Expanded meta detail */}
                        {isExpanded && hasMeta && (
                          <div style={{ marginLeft: 28, marginBottom: 14, background: 'white', border: '1px solid #F1F5F9', borderRadius: 10, padding: '12px 16px' }}>
                            {/* items_received list */}
                            {Array.isArray(entry.meta.items) && entry.meta.items.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                {entry.meta.items.map((it, i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < entry.meta.items.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                                    <span style={{ fontSize: 13, color: '#0F172A', flex: 1 }}>{it.raw_name || it.matched_item || it.name || '—'}</span>
                                    {it.qty != null && <span style={{ fontSize: 12, color: '#64748B', flexShrink: 0 }}>× {it.qty}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* scalar meta fields */}
                            {[
                              entry.meta.supplier && ['Supplier', entry.meta.supplier],
                              entry.meta.board_title && ['Board', entry.meta.board_title],
                              entry.meta.items_received != null && ['Items received', entry.meta.items_received],
                              entry.meta.items_unmatched != null && entry.meta.items_unmatched > 0 && ['Unmatched', entry.meta.items_unmatched],
                            ].filter(Boolean).map(([label, val]) => (
                              <p key={label} style={{ margin: '4px 0', fontSize: 11, color: '#64748B' }}>
                                <span style={{ fontWeight: 600, color: '#374151' }}>{label}: </span>{val}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ marginTop: 32, textAlign: 'center' }}>
              <button
                onClick={() => navigate(`/provisioning/history?board=${list?.id}`)}
                style={{ fontSize: 13, color: '#1E3A5F', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                View full delivery history →
              </button>
            </div>
          </div>
        )}

        {/* ── Orders tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'orders' && (
          <div style={{ padding: '32px 0 64px' }}>
            {supplierOrdersLoading ? (
              <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>Loading…</div>
            ) : supplierOrders.length === 0 ? (
              <div style={{ padding: '80px 0', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, background: '#F0FDFA', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <Icon name="Send" style={{ width: 22, height: 22, color: '#0D9488' }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#0F172A', marginBottom: 4 }}>No orders sent yet</p>
                <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20 }}>Use "Send to Supplier" to create and send your first order.</p>
                {canSendToSupplier && (
                  <button
                    onClick={handleSendToSupplier}
                    disabled={!hasSendableItems}
                    style={{ fontSize: 13, fontWeight: 600, padding: '8px 20px', borderRadius: 8, cursor: hasSendableItems ? 'pointer' : 'not-allowed', background: hasSendableItems ? '#00A8CC' : '#CBD5E1', border: 'none', color: 'white', opacity: hasSendableItems ? 1 : 0.7 }}
                    title={!hasSendableItems ? 'Add items to the board before sending' : undefined}
                  >
                    Send to Supplier
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {supplierOrders.map(order => {
                  // Status chip palette — preserved from previous design
                  // pending Commit 2's lifecycle indicator. Subsequent commits
                  // will move status into the lifecycle row.
                  const statusColor = order.status === 'confirmed' ? { bg: '#D1FAE5', text: '#065F46' }
                    : order.status === 'partially_confirmed' ? { bg: '#FEF3C7', text: '#92400E' }
                    : order.status === 'paid' ? { bg: '#D1FAE5', text: '#065F46' }
                    : order.status === 'received' ? { bg: '#D1FAE5', text: '#065F46' }
                    : order.status === 'sent' ? { bg: '#DBEAFE', text: '#1E40AF' }
                    : { bg: '#F1F5F9', text: '#475569' };
                  const orderItems = order.supplier_order_items || [];
                  const isActive = ACTIVE_ORDER_STATES.has(order.status);
                  // supplier_profile is the joined supplier_profiles row
                  // (Sprint 9c.2 — fetchSupplierOrders now joins it). Falls
                  // back gracefully on legacy rows without supplier_profile_id.
                  const country = order.supplier_profile?.business_country || null;
                  const flag = flagEmoji(country);
                  const displayName = order.supplier_profile?.name || order.supplier_name || 'Supplier';
                  const orderRef = shortOrderRef(order.id);

                  // Most-recent invoice for the bottom action row
                  const invoices = order.supplier_invoices || [];
                  const invoice = invoices.length > 0
                    ? [...invoices].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
                    : null;
                  const fmtCur = (a, c = 'EUR') => {
                    try {
                      return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(a) || 0);
                    } catch { return `${c} ${Number(a || 0).toFixed(2)}`; }
                  };

                  return (
                    <div
                      key={order.id}
                      className={`cargo-order-card${isActive ? ' cargo-order-card-active' : ''}`}
                    >
                      {/* Identity row + status — clickable to open the
                          detail drawer (Sprint 9c.2 Commit 1.5). */}
                      <div
                        className="cargo-order-card-row"
                        onClick={() => setDrawerOrderId(order.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDrawerOrderId(order.id);
                          }
                        }}
                      >
                        <span className="cargo-order-card-chevron" aria-hidden="true">›</span>
                        <div className="cargo-order-card-identity">
                          <h3 className="cargo-order-card-supplier">{displayName}</h3>
                          <div className="cargo-order-card-meta">
                            <span className="cargo-order-card-ref">#{orderRef}</span>
                            {flag && (
                              <>
                                <span className="cargo-order-card-meta-divider" aria-hidden="true" />
                                <span className="cargo-order-card-flag" title={country || ''}>{flag}</span>
                              </>
                            )}
                            <span className="cargo-order-card-meta-divider" aria-hidden="true" />
                            <span>{orderItems.length} item{orderItems.length !== 1 ? 's' : ''}</span>
                            {order.delivery_date && (
                              <>
                                <span className="cargo-order-card-meta-divider" aria-hidden="true" />
                                <span>{new Date(order.delivery_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                              </>
                            )}
                            {order.delivery_port && (
                              <>
                                <span className="cargo-order-card-meta-divider" aria-hidden="true" />
                                <span>{order.delivery_port}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span
                          className="cargo-order-card-status"
                          style={{ background: statusColor.bg, color: statusColor.text }}
                        >
                          {order.status === 'partially_confirmed' ? 'Partial'
                            : order.status === 'out_for_delivery' ? 'Out for delivery'
                            : (order.status || '').replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* Body slot — placeholder for lifecycle indicator
                          (9c.2 Commit 2) and document chips (9c.2 Commit 3).
                          Empty in Commit 1 — kept for the visual rhythm. */}

                      {/* Action affordances at the bottom — the 9c.2 spec
                          reserves stage-appropriate actions in the pill
                          aesthetic from the ribbon vocabulary. Commit 1
                          carries the existing invoice link + sent_via
                          chips + sent_at; subsequent commits replace these
                          with lifecycle-aware actions. */}
                      <div className="cargo-order-card-actions">
                        {invoice && (
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetchInvoiceSignedUrl(invoice.id);
                                if (res?.signed_url) {
                                  window.open(res.signed_url, '_blank', 'noopener');
                                } else {
                                  window.alert('Could not open invoice — no signed URL returned.');
                                }
                              } catch (err) {
                                window.alert(`Could not open invoice: ${err.message}`);
                              }
                            }}
                            title={`Invoice ${invoice.invoice_number} · click to open`}
                            className="cargo-ribbon-btn"
                            style={{ fontSize: 11 }}
                          >
                            <span aria-hidden="true">📄</span>
                            Invoice · {fmtCur(invoice.amount, invoice.currency)}
                          </button>
                        )}
                        {order.sent_via && (
                          order.sent_via === 'both' ? (
                            <>
                              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999, background: '#EFF6FF', color: '#1E40AF' }}>Email</span>
                              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999, background: '#D1FAE5', color: '#065F46' }}>WhatsApp</span>
                            </>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999, background: order.sent_via === 'whatsapp' ? '#D1FAE5' : '#EFF6FF', color: order.sent_via === 'whatsapp' ? '#065F46' : '#1E40AF' }}>
                              {order.sent_via === 'whatsapp' ? 'WhatsApp' : order.sent_via === 'email' ? 'Email' : order.sent_via}
                            </span>
                          )
                        )}
                        {order.sent_at && (
                          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--ink-muted)', letterSpacing: '0.04em' }}>
                            Sent {new Date(order.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </EditorialPageShell>
      </div>

      {showEditModal && (
        <EditBoardModal
          list={list}
          onSaved={(updated) => { setList(prev => ({ ...prev, ...updated })); setShowEditModal(false); showToast('Board saved', 'success'); }}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {showReceiveModal && (
        <ReceiveDeliveryModal
          list={list}
          items={items.filter(i => i.status !== 'received')}
          tenantId={activeTenantId}
          onClose={() => setShowReceiveModal(false)}
          onComplete={() => {
            setShowReceiveModal(false);
            // Refresh items to reflect updated statuses and received quantities
            fetchListItems(id).then(updated => setItems(updated || [])).catch(() => {});
            // Refresh delivery batches list
            if (list?.id) fetchDeliveryBatches(list.id).then(data => setDeliveries(data || [])).catch(() => {});
            showToast('Delivery received', 'success');
          }}
        />
      )}

      {showConfirmModal && (
        <ConfirmDeliveryModal
          userId={user?.id}
          onClose={() => setShowConfirmModal(false)}
          onConfirmed={() => fetchListItems(id).then(updated => setItems(updated || [])).catch(() => {})}
        />
      )}

      {invoiceModal && (
        <InvoiceUploadModal
          batch={invoiceModal.batch}
          batchItems={invoiceModal.batchItems}
          onClose={() => setInvoiceModal(null)}
          onComplete={() => {
            setInvoiceModal(null);
            if (list?.id) fetchDeliveryBatches(list.id).then(data => setDeliveries(data || [])).catch(() => {});
            fetchListItems(id).then(updated => setItems(updated || [])).catch(() => {});
          }}
        />
      )}

      {showSendModal && (
        <SendToSupplierModal
          isOpen={showSendModal}
          onClose={() => setShowSendModal(false)}
          onSent={async (order) => {
            // Refetch from DB so deduped 'both' rows collapse correctly
            try {
              const fresh = await fetchSupplierOrders(id);
              setSupplierOrders(fresh || []);
            } catch { /* non-fatal */ }
            setList(prev => ({ ...prev, status: 'sent_to_supplier' }));
            setActiveTab('orders');
            showToast(`Order sent to ${order.supplier_name || 'supplier'}`, 'success');
          }}
          tenantId={activeTenantId}
          listId={id}
          items={items
            .filter(i => i.status !== 'received' && i.name?.trim())
            .filter(i => {
              const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
              return !oi;
            })
            .map(i => ({
              name: i.name,
              quantity: i.quantity_ordered,
              unit: i.unit,
              notes: i.notes,
              estimated_price: i.estimated_unit_cost || null,
            }))}
          vesselName={tenantVesselName || list?.title}
          vesselTypeLabel={tenantVesselTypeLabel}
          orderRef={list?.port_location}
          createdBy={user?.id}
        />
      )}

      <ItemDrawer
        open={itemDrawer.open}
        item={itemDrawer.item}
        listId={id}
        tenantId={activeTenantId}
        listCurrency={currency}
        departments={departments.map(d => d.name)}
        theme="light"
        onSaved={handleItemDrawerSaved}
        onDeleted={(listId, itemId) => {
          setItems(prev => prev.filter(i => i.id !== itemId));
          setItemDrawer({ open: false, item: null });
        }}
        onClose={() => setItemDrawer({ open: false, item: null })}
      />

      {/* Sprint 9c.2 Commit 1.5b — supplier order detail drawer.
          Resolves the live order off the supplierOrders list each render so
          mid-quote edits (Accept/Decline/Query) reflect immediately when
          the parent state updates. The drawer renders its own rich title
          (Georgia name + mono ref + flag) — no drawerTitle prop needed. */}
      <SupplierOrderDrawer
        open={!!drawerOrderId}
        order={drawerOrderId ? supplierOrders.find((o) => o.id === drawerOrderId) || null : null}
        acceptAllBusy={acceptAllBusy}
        quoteRowBusy={quoteRowBusy}
        onAcceptAllQuoted={handleAcceptAllQuoted}
        onAcceptItemQuote={handleAcceptItemQuote}
        onQueryItemQuote={handleQueryItemQuote}
        onDeclineItemQuote={handleDeclineItemQuote}
        onClose={() => setDrawerOrderId(null)}
      />

      {/* Query placeholder — Sprint 9.5 stub. Real threading is a future
          sprint; for now the RPC has already flipped quote_status to
          'in_discussion' so the supplier sees the line being queried. */}
      {queryModalItem && (
        <div
          onClick={() => setQueryModalItem(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9000, padding: 16,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460,
            padding: '22px 26px', boxShadow: '0 24px 64px rgba(15,23,42,0.24)',
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
              Query raised — discussion threads coming soon
            </h3>
            <p style={{ margin: '0 0 8px', fontSize: 13.5, color: '#475569', lineHeight: 1.55 }}>
              We've flagged <strong>{queryModalItem.item_name}</strong> as in discussion, so the
              supplier knows you have a question. Threaded messaging on quoted lines is a future
              sprint — for now, contact your supplier directly.
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#94A3B8' }}>
              You can still Accept or Decline this line at any time.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setQueryModalItem(null)}
                style={{
                  fontSize: 13, fontWeight: 600, padding: '8px 16px',
                  borderRadius: 8, border: 'none', background: '#1E3A5F', color: '#fff', cursor: 'pointer',
                }}
              >Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProvisioningBoardDetail;
