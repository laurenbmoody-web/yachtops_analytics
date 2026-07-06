import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { EditorialPageShell, EditorialTabNav, HelpHint, HelpHintBuckets } from '../../components/editorial';
import '../pantry/pantry.css';
import './provisioning-dashboard.css';
import StatusBadge from './components/StatusBadge';
import ShareModal from './components/ShareModal';
import QuoteReviewModal from './components/QuoteReviewModal';
import QuoteConfirmEmailModal from './components/QuoteConfirmEmailModal';
import { BOARD_TYPES } from './data/templates';
import { openBoardPdf } from './utils/boardPdfExport';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import {
  fetchProvisioningList,
  fetchListItems,
  upsertItems,
  updateProvisioningItem,
  deleteProvisioningItem,
  updateProvisioningList,
  submitProvisioningForApproval,
  fetchActiveApprovalRequest,
  decideProvisioningApproval,
  uploadProvisioningQuoteFile,
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
  reopenOrderItem,
  updateOrderItemStatus,
  acceptOrderItemQuote,
  declineOrderItemQuote,
  approveAllQuotes,
  callerRequiresProvisioningApproval,
  fetchCollaborators,
  fetchCrewMembers,
  fetchSupplierContactEmail,
  fetchSupplierNotesSeenAt,
  markSupplierNotesSeen,
  queryOrderItemQuote,
  toggleSupplierOrderFavourite,
  saveAsTemplate,
  bulkDeleteProvisioningItems,
  bulkUpdateItemDepartment,
  bulkUpdateProvisioningItems,
  fetchPortalEnabledSuppliers,
  PROVISIONING_STATUS,
  PROVISION_CATEGORIES,
  PROVISION_UNITS,
  SUPPLIER_ORDER_STATUS,
  formatCurrency,
} from './utils/provisioningStorage';
import SendToSupplierModal from './components/SendToSupplierModal';
import InvoiceUploadModal, { PAYMENT_STATUS_OPTIONS } from './components/InvoiceUploadModal';
import ItemDrawer from './components/ItemDrawer';
import BoardDrawer from './components/BoardDrawer';
import AddItemsModal from './components/AddItemsModal';
import OrderCard from './components/OrderCard';
import DeliveryBatchCard from './components/DeliveryBatchCard';
import SelectionCheckbox from './components/SelectionCheckbox';
import BulkActionBar from './components/BulkActionBar';
import BulkDeleteConfirmModal from './components/BulkDeleteConfirmModal';
import BulkChangeDeptModal from './components/BulkChangeDeptModal';
import BulkEditModal from './components/BulkEditModal';
import ReceiveDeliveryModal from './components/ReceiveDeliveryModal';
import ConfirmDeliveryModal from './components/ConfirmDeliveryModal';
import { loadTrips, findTripByAnyId } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { showToast } from '../../utils/toast';
import { getItemStatusConfig, deriveDisplayStatus, ITEM_STATUS_FILTER_ORDER, ITEM_STATUS_CONFIG } from './data/statusConfig';
import {
  DETAIL_GRID,
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

import ModalShell from '../../components/ui/ModalShell';
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

// Per-column teaching tooltips for the board items table. Lifted to
// module scope so every render reads the same definitions; matched
// by key to the helpHint marker on each header in the render array.
//
// Content sources from the chief's Excel veg + fish lists where the
// example phrases live in real provisioning prose, not invented.
const COLUMN_HELP_HINTS = {
  item: {
    title: 'What lives in Item',
    width: 280,
    buckets: [
      { label: 'Name',  example: '"Premium lager", "Oscietra caviar"' },
      { label: 'Brand', example: '"Evian", "Heinz", "Peroni"' },
    ],
  },
  category: {
    title: 'What lives in Category',
    width: 280,
    buckets: [
      { label: 'Category', example: '"Beer & Cider", "Caviar, Roe & Truffle"' },
      { label: 'Sub-cat',  example: '"Lager", "Sashimi Loin"' },
    ],
  },
  notes: {
    title: 'What goes in Notes?',
    width: 300,
    buckets: [
      { label: 'Prep',    example: '"Skin on, pin boned, scaled"' },
      { label: 'Packing', example: '"1 per bag, vac-packed"' },
      { label: 'State',   example: '"Ripe not soft, sashimi grade"' },
      { label: 'Special', example: '"Display quality, bones out"' },
    ],
  },
  size: {
    title: 'What goes in Size?',
    width: 300,
    buckets: [
      { label: 'Tip',    example: 'numeric only — the measure (g, ml…) lives in Unit' },
      { label: 'Weight', example: '"500" with Unit "g"' },
      { label: 'Volume', example: '"750" with Unit "ml"' },
      { label: 'Bundle', example: '"6" with Unit "pack"' },
    ],
  },
  unit: {
    title: 'What goes in Unit?',
    width: 280,
    buckets: [
      { label: 'Each',        example: 'bottle, can, jar, piece, side' },
      { label: 'Measurement', example: 'g, kg, ml, L' },
      { label: 'Bundle',      example: 'punnet, bunch, pack, tray, bag' },
    ],
  },
  status: {
    title: 'Status colours',
    width: 300,
    align: 'end',
    // Swatch colours are read straight from the status config so the
    // legend can never drift from the dots actually rendered on the rows.
    buckets: [
      { dot: getItemStatusConfig('draft').badge.dot,        label: 'Draft',        example: 'on the board, not ordered yet' },
      { dot: getItemStatusConfig('ordered').badge.dot,      label: 'Ordered',      example: 'sent to the supplier, awaiting reply' },
      { dot: getItemStatusConfig('confirmed').badge.dot,    label: 'Confirmed',    example: 'supplier agreed at the quoted price' },
      { dot: getItemStatusConfig('substituted').badge.dot,  label: 'Substituted',  example: 'supplier offered an alternative' },
      { dot: getItemStatusConfig('unavailable').badge.dot,  label: 'Unavailable',  example: 'won’t be supplied on this line' },
      { dot: getItemStatusConfig('received').badge.dot,     label: 'Received',     example: 'arrived aboard' },
      { dot: getItemStatusConfig('partial').badge.dot,      label: 'Partial',      example: 'part-delivered' },
      { dot: getItemStatusConfig('not_received').badge.dot, label: 'Not received', example: 'ordered but didn’t arrive' },
      { dot: getItemStatusConfig('returned').badge.dot,     label: 'Returned',     example: 'sent back to the supplier' },
      { dot: getItemStatusConfig('invoiced').badge.dot,     label: 'Invoiced',     example: 'invoice received' },
      { dot: getItemStatusConfig('paid').badge.dot,         label: 'Paid',         example: 'payment settled' },
    ],
  },
};

// Scoped selection checkbox — items-list bulk-selection model only.
// Lifted into components/SelectionCheckbox.jsx (the SVG-check sweep) so
// other selection surfaces can adopt it without re-implementing.
// Imported below alongside the other component imports.

// ── History action taxonomy ───────────────────────────────────────────────────
//
// Per-action display metadata for the History tab. Pulls each row's
// short uppercase TAG (renders next to the summary as a pill), its
// source category (Crew / Supplier — backs the filter pills), and
// the dot colour the row shows in the timeline.
//
// Source classification cheatsheet — both tables flow into the merged
// timeline, so we tag by event_type rather than relying on actor_name
// (which is missing on a few of the older writes and falls back to
// "Supplier" even for chief-driven rows like vessel_approved_quote):
//   * activity_events rows (uppercase PROVISION_…) → crew
//   * supplier_order_activity rows (prefixed supplier_ on merge)
//     → "supplier" bucket regardless of who actually triggered the
//     event, because the chief reads them as "the supplier
//     conversation". The summary text already says "Vessel reopened
//     X" / "Supplier quoted X" so the actor stays unambiguous.
const HISTORY_ACTION_META = {
  // Crew / board edits
  PROVISION_ITEM_ADDED:            { tag: 'Added',      source: 'crew',     dot: '#059669' },
  PROVISION_ITEM_RECEIVED:         { tag: 'Received',   source: 'crew',     dot: '#059669' },
  PROVISION_DELIVERY_SCANNED:      { tag: 'Scanned',    source: 'crew',     dot: '#059669' },
  PROVISION_INBOX_CLAIMED:         { tag: 'Claimed',    source: 'crew',     dot: '#059669' },
  PROVISION_CROSS_DEPT_CONFIRMED:  { tag: 'Cross-dept', source: 'crew',     dot: '#1E3A5F' },
  PROVISION_ITEM_QTY_CHANGED:      { tag: 'Qty',        source: 'crew',     dot: '#D97706' },
  PROVISION_ITEM_COST_CHANGED:     { tag: 'Cost',       source: 'crew',     dot: '#D97706' },
  PROVISION_ITEM_UPDATED:          { tag: 'Update',     source: 'crew',     dot: '#D97706' },
  PROVISION_BOARD_UPDATED:         { tag: 'Board',      source: 'crew',     dot: '#D97706' },
  PROVISION_BOARD_STATUS_CHANGED:  { tag: 'Status',     source: 'crew',     dot: '#D97706' },
  PROVISION_ITEM_DELETED:          { tag: 'Removed',    source: 'crew',     dot: '#DC2626' },
  // Supplier conversation (supplier_order_activity)
  supplier_quote_received:             { tag: 'Quoted',        source: 'supplier', dot: '#C65A1A' },
  supplier_quote_accepted:             { tag: 'Accepted',      source: 'supplier', dot: '#2E7D5A' },
  supplier_quote_declined:             { tag: 'Declined',      source: 'supplier', dot: '#991B1B' },
  supplier_line_reopened:              { tag: 'Reopened',      source: 'supplier', dot: '#D97706' },
  supplier_supplier_requested_reopen:  { tag: 'Reopen asked',  source: 'supplier', dot: '#D97706' },
  supplier_vessel_approved_quote:      { tag: 'Approved',      source: 'supplier', dot: '#2E7D5A' },
  supplier_discussion_opened:          { tag: 'Discussion',    source: 'supplier', dot: '#1E3A5F' },
};

const getHistoryActionMeta = (action) =>
  HISTORY_ACTION_META[action] || { tag: 'Event', source: 'system', dot: '#94A3B8' };

// Render an inline diff if the meta payload carries a recognisable
// previous → current pair. Supplier quote events store the agreed
// price and currency; reopens store the previous status. Returns
// the diff text (e.g. "GBP 22 → GBP 25", "confirmed → pending") or
// null if no diff is encodable from the payload.
const formatHistoryDiff = (action, meta) => {
  if (!meta) return null;
  if (action === 'supplier_quote_received' || action === 'supplier_quote_accepted') {
    const cur = meta.agreed_currency || '';
    const price = meta.agreed_price;
    return price != null ? `${cur} ${price}`.trim() : null;
  }
  if (action === 'supplier_quote_declined') {
    const cur = meta.declined_currency || '';
    const price = meta.declined_quoted_price;
    return price != null ? `${cur} ${price}`.trim() : null;
  }
  if (action === 'supplier_line_reopened' && meta.previous_status) {
    return `${meta.previous_status} → pending`;
  }
  if (action === 'supplier_supplier_requested_reopen' && meta.reason) {
    return `"${meta.reason}"`;
  }
  return null;
};

// ── Edit Board Modal ──────────────────────────────────────────────────────────

const EditBoardModal = ({ list, supplierManaged = false, onSaved, onClose }) => {
  const [form, setForm] = useState({
    title: list.title || '',
    board_type: list.board_type || 'general',
    status: list.status || PROVISIONING_STATUS.DRAFT,
    notes: list.notes || '',
    port_location: list.port_location || '',
    currency: list.currency || 'GBP',
    trip_id: list.trip_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [trips, setTrips] = useState([]);

  useEffect(() => {
    let cancelled = false;
    loadTrips()
      .then(list => { if (!cancelled) setTrips(list || []); })
      .catch(() => { if (!cancelled) setTrips([]); });
    return () => { cancelled = true; };
  }, []);

  const initial = useMemo(() => ({
    title: list.title || '',
    board_type: list.board_type || 'general',
    status: list.status || PROVISIONING_STATUS.DRAFT,
    notes: list.notes || '',
    port_location: list.port_location || '',
    currency: list.currency || 'GBP',
    trip_id: list.trip_id || '',
  }), [list]);
  // When the status field is locked (supplier-managed boards) it
  // isn't an editable surface, so a stale status value in `form`
  // shouldn't mark the modal dirty.
  const dirtyForm = supplierManaged ? { ...form, status: initial.status } : form;
  const isDirty = JSON.stringify(dirtyForm) !== JSON.stringify(initial);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      // Never overwrite a supplier-managed status from this modal —
      // even if the dropdown stayed editable in a stale render, the
      // server-of-record for the lifecycle is the supplier flow.
      const patch = {
        title: form.title.trim(),
        board_type: form.board_type,
        notes: form.notes,
        port_location: form.port_location.trim() || null,
        currency: form.currency,
        trip_id: form.trip_id || null,
      };
      if (!supplierManaged) patch.status = form.status;
      const updated = await updateProvisioningList(list.id, patch);
      onSaved(updated);
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  // "Last saved" strap: relative time + a hint that the full audit
  // trail lives on the History tab. Notes-style line, not a chip.
  const lastSavedLabel = (() => {
    const iso = list.updated_at || list.created_at;
    if (!iso) return null;
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return null;
    const diffMs = Date.now() - then.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  })();

  return (
    <ModalShell
      onClose={onClose}
      isDirty={isDirty}
      isBusy={saving}
      panelClassName="pv-edit-modal pv-dashboard"
    >
      <div className="pv-edit-modal-head">
        <div>
          <span className="pv-edit-modal-eyebrow">Provisioning Board</span>
          <h2 className="pv-edit-modal-title">Edit, <em>details</em>.</h2>
        </div>
        <button onClick={onClose} className="pv-edit-modal-close" aria-label="Close">
          <Icon name="X" style={{ width: 16, height: 16 }} />
        </button>
      </div>

      <div className="pv-edit-modal-body">
        <div className="pv-edit-modal-field">
          <label className="pv-edit-modal-label" htmlFor="ebm-title">Title</label>
          <input
            id="ebm-title"
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="pv-edit-modal-input"
            placeholder="e.g. Med Charter — Galley"
          />
        </div>

        <div className="pv-edit-modal-grid">
          <div className="pv-edit-modal-field">
            <label className="pv-edit-modal-label" htmlFor="ebm-type">Board type</label>
            <select
              id="ebm-type"
              value={form.board_type}
              onChange={e => setForm(f => ({ ...f, board_type: e.target.value }))}
              className="pv-edit-modal-select"
            >
              {BOARD_TYPES.map(bt => (
                <option key={bt.value} value={bt.value}>{bt.label}</option>
              ))}
            </select>
          </div>
          <div className="pv-edit-modal-field">
            <label className="pv-edit-modal-label" htmlFor="ebm-status">Status</label>
            {supplierManaged ? (
              // Supplier-managed boards: status flows from the
              // supplier flow + receive events, not from a manual
              // dropdown. Render the current value as a locked chip
              // so the chief can see it but can't overwrite it
              // (overrides would just get clobbered the next time a
              // line moves anyway). The hint line points to where
              // the lifecycle actually advances.
              <>
                <div className="pv-edit-modal-input pv-edit-modal-readonly" aria-readonly="true">
                  {(form.status || 'draft').replace(/_/g, ' ')}
                </div>
                <p className="pv-edit-modal-hint">
                  Managed by the supplier flow — advances as items move through quote / confirm / receive.
                </p>
              </>
            ) : (
              <select
                id="ebm-status"
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="pv-edit-modal-select"
              >
                {Object.values(PROVISIONING_STATUS).map(v => (
                  <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="pv-edit-modal-field">
          <label className="pv-edit-modal-label" htmlFor="ebm-trip">Linked trip</label>
          <select
            id="ebm-trip"
            value={form.trip_id}
            onChange={e => setForm(f => ({ ...f, trip_id: e.target.value }))}
            className="pv-edit-modal-select"
          >
            <option value="">No trip linked</option>
            {trips
              // `list.trip_id` is a uuid column — only trips with a
              // supabaseId can actually be saved against it. Legacy
              // localStorage-only trips (no supabaseId) would PATCH 400
              // on save, so we hide them from the picker.
              .filter(t => !!t.supabaseId)
              .map(t => {
                const name = t.title || t.name || 'Trip';
                const type = t.tripType ? ` · ${t.tripType}` : '';
                const start = t.startDate ? ` · ${new Date(t.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
                return (
                  <option key={t.supabaseId} value={t.supabaseId}>{name}{type}{start}</option>
                );
              })}
          </select>
        </div>

        <div className="pv-edit-modal-grid">
          <div className="pv-edit-modal-field">
            <label className="pv-edit-modal-label" htmlFor="ebm-port">Port / location</label>
            <input
              id="ebm-port"
              type="text"
              value={form.port_location}
              onChange={e => setForm(f => ({ ...f, port_location: e.target.value }))}
              className="pv-edit-modal-input"
              placeholder="e.g. Palma de Mallorca"
            />
          </div>
          <div className="pv-edit-modal-field">
            <label className="pv-edit-modal-label" htmlFor="ebm-cur">Currency</label>
            <select
              id="ebm-cur"
              value={form.currency}
              onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
              className="pv-edit-modal-select"
            >
              <option value="GBP">GBP — £</option>
              <option value="EUR">EUR — €</option>
              <option value="USD">USD — $</option>
            </select>
          </div>
        </div>

        <div className="pv-edit-modal-field">
          <label className="pv-edit-modal-label" htmlFor="ebm-notes">Notes</label>
          <textarea
            id="ebm-notes"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="pv-edit-modal-textarea"
            placeholder="Anything the team should know — special requests, dietary themes, supplier preferences…"
          />
        </div>
      </div>

      <div className="pv-edit-modal-foot">
        {lastSavedLabel && (
          <span className="pv-edit-modal-saved">
            Last saved {lastSavedLabel} · full timeline on the History tab
          </span>
        )}
        <div className="pv-edit-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.title.trim()}
            className="pv-edit-modal-btn pv-edit-modal-btn-primary"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </ModalShell>
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

// Crew-settable statuses offered by the bulk "Set status" control. Excludes
// received / partial — those run through the dedicated "Mark received" flow so
// a delivery record is always created. 'unavailable' (crew flag for lines that
// won't be supplied) sits right after 'ordered', mirroring the filter order.
const BULK_STATUS_OPTIONS = ['draft', 'ordered', 'unavailable', 'not_received', 'returned', 'invoiced', 'paid']
  .map((value) => ({ value, label: getItemStatusConfig(value).label }));

// ── Main page ─────────────────────────────────────────────────────────────────

const ProvisioningBoardDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [trip, setTrip] = useState(null);
  // This user's collaborator permission on the board (view / edit /
  // approve), or null if they're not an invited collaborator.
  const [collabPerm, setCollabPerm] = useState(null);
  // Share / collaborate modal (opened from the ⋯ menu) + crew list.
  const [showShareModal, setShowShareModal] = useState(false);
  const [crewMembers, setCrewMembers] = useState([]);
  const [allergenGuests, setAllergenGuests] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editingCell, setEditingCell] = useState(null);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupBy, setGroupBy] = useState('none'); // 'category' | 'none'
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
  const [allergenOpen, setAllergenOpen] = useState(false);
  const allergenRef = useRef(null);

  // Approval routing — PR3. Tracks the most recent approval request
  // row for the board so we can render the reviewer banner or the
  // "changes requested" chip. Reload after status flips so optimistic
  // local state stays in sync with the request lifecycle.
  const [approvalRequest, setApprovalRequest] = useState(null);
  const [approverProfile, setApproverProfile] = useState(null);
  const [submitterProfile, setSubmitterProfile] = useState(null);
  const [decisionModal, setDecisionModal] = useState(null); // 'approve' | 'request_changes' | null
  const [decisionComment, setDecisionComment] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [reviewNoteOpen, setReviewNoteOpen] = useState(false);
  const [reviewNoteSeen, setReviewNoteSeen] = useState(false);
  const reviewNoteRef = useRef(null);

  // Per-user / per-request "have I read this reviewer note" memory.
  // Persisted in localStorage so the chip stops pulsing once the user
  // has actually opened it, even across reloads. Author of the note
  // still sees the pulse on first view too — they might be returning
  // to the board hours later wanting to remember exactly what they
  // wrote, and a click dismisses it just as quickly as a non-author.
  const reviewNoteSeenKey = (approvalRequest?.id && user?.id)
    ? `cargo.provReviewNoteSeen.${user.id}.${approvalRequest.id}`
    : null;
  useEffect(() => {
    if (!approvalRequest?.id || !user?.id) { setReviewNoteSeen(false); return; }
    try {
      const v = window.localStorage.getItem(reviewNoteSeenKey);
      setReviewNoteSeen(v === '1');
    } catch { setReviewNoteSeen(false); }
  }, [approvalRequest?.id, user?.id, reviewNoteSeenKey]);

  // Open → mark seen + persist. Once dismissed, the chip stops
  // pulsing for this user/request forever.
  const handleReviewNoteToggle = () => {
    setReviewNoteOpen(v => !v);
    if (!reviewNoteSeen && reviewNoteSeenKey) {
      setReviewNoteSeen(true);
      try { window.localStorage.setItem(reviewNoteSeenKey, '1'); } catch { /* private mode */ }
    }
  };
  const quoteFileInputRef = useRef(null);
  const [uploadingQuote, setUploadingQuote] = useState(false);
  // The just-uploaded quote file, held so the review modal can AI-read
  // it and apply the extracted prices to the board lines.
  const [quoteReviewFile, setQuoteReviewFile] = useState(null);
  // After a manual quote is confirmed, optionally offer to email the
  // supplier. { defaultEmail } when open, null when closed.
  const [confirmEmailPrompt, setConfirmEmailPrompt] = useState(null);

  // ── Supplier Orders ──────────────────────────────────────────────────────
  const [showSendModal, setShowSendModal] = useState(false);
  const [supplierOrders, setSupplierOrders] = useState([]);
  const [supplierOrdersLoading, setSupplierOrdersLoading] = useState(false);

  // ── Quick Add panel (Favourites / Templates / Order History) ────────────
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Unified "Add items" modal — replaces the prior pair of Suggestions
  // + Quick Add buttons. Per-lane quick-add input is the fast-path for
  // single-item-by-hand; this modal is the bulk-from-another-source flow.
  const [addItemsOpen, setAddItemsOpen] = useState(false);
  // Tracks which order card's star is mid-toggle so we can show a brief
  // disabled state and avoid double-fires while the RPC is in flight.
  const [favouritingOrderId, setFavouritingOrderId] = useState(null);

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
  // Sprint 9c.2 redirect: order detail now lives at its own page
  // (/provisioning/:boardId/orders/:orderId). Card click navigates there
  // instead of opening a drawer.
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
  const isCommand = userTier === 'COMMAND';
  // Primary department for AddItemsModal context — first board dept if
  // multi-dept, else single dept. Drives Frequent items dept-scope toggle.
  const primaryDept = (Array.isArray(list?.department)
    ? list.department[0]
    : (list?.department || '').split(',')[0]) || userDept || null;
  const isOwner = userId && (list?.owner_id === userId || list?.created_by === userId);
  const listDepts = Array.isArray(list?.department)
    ? list.department.filter(Boolean)
    : (list?.department ? list.department.split(',').map(d => d.trim()) : []);
  const inSameDept = !listDepts.length || listDepts.some(d => d?.toLowerCase() === userDept.toLowerCase());

  // The current user's collaborator permission on this board (null if
  // not an invited collaborator). An 'edit' / 'approve' collaborator
  // gets the same write affordances the RLS now grants them
  // (20260627090000) — without this the UI would show a read-only
  // board to someone the DB lets edit.
  const isCollabEditor = collabPerm === 'edit' || collabPerm === 'approve';

  // Edit board metadata + add items: owner / COMMAND / CHIEF / HOD  (not CREW)
  const canEdit = !!isOwner || userTier === 'COMMAND' || (['CHIEF', 'HOD'].includes(userTier) && inSameDept) || isCollabEditor;
  const canAddItems = canEdit;
  // Delete the board: owner / COMMAND / CHIEF  (HOD and CREW cannot delete boards)
  const canDelete = !!isOwner || userTier === 'COMMAND' || (userTier === 'CHIEF' && inSameDept);
  // Send to supplier: COMMAND and CHIEF only — isOwner intentionally excluded
  // so a CREW member who created a board cannot bypass the tier restriction.
  const canSendToSupplier = userTier === 'COMMAND' || userTier === 'CHIEF';

  // Quick Add — star/unstar a supplier_order. UI gate is for affordance
  // only (button greys out for non-CHIEF/HOD tiers so they don't click
  // into a guaranteed rejection). The actual gate is server-side inside
  // toggle_supplier_order_favourite — COMMAND can star any tenant order,
  // CHIEF must intersect dept with the order's departments[]. HOD also
  // gets the affordance because they're dept-scoped curators in the
  // tier hierarchy, even though only COMMAND/CHIEF pass the RPC check
  // today — surface a clear toast on the rejection so HOD's intent is
  // visible rather than silently ignored.
  const canFavouriteOrder = ['COMMAND', 'CHIEF', 'HOD'].includes(userTier);

  // Item-locking: once an order has been sent, board items that appear in any
  // supplier_order_items row become read-only until the board is back to draft.
  // ('confirmed' previously appeared here too — that's a supplier_orders value
  // leaked into a provisioning_lists check; always false. Removed in commit 3.)
  const isSent = list?.status === 'sent_to_supplier';
  // Board has been through a quote confirmation (fully or partially). On
  // such a board, any line carrying an applied quote price
  // (quoted_unit_cost) is treated as confirmed — it locks the same way a
  // supplier-confirmed line does (read-only, tinted, excluded from
  // re-send), so the crew can't quietly re-edit or re-send it. This is the
  // manual-quote equivalent of the supplier-portal 'confirmed' lock.
  const boardConfirmedStage =
    list?.status === 'partially_confirmed' || list?.status === 'confirmed';
  const isQuoteConfirmed = (i) =>
    boardConfirmedStage
    && i.quoted_unit_cost != null && Number(i.quoted_unit_cost) > 0
    && !i.quote_reopened;   // reopened lines unlock but keep their price
  // Lookup keyed by lowered item name. Carries both the per-item
  // supplier-side state (status, substitution detail) AND a back-pointer
  // to the parent supplier_orders row — the parent's status (invoiced,
  // paid) drives the financial roll-forward in deriveDisplayStatus.
  const itemStatusMap = useMemo(() => {
    const map = {};
    supplierOrders.forEach(order => {
      (order.supplier_order_items || []).forEach(oi => {
        const key = (oi.item_name || '').toLowerCase().trim();
        if (!map[key]) {
          // Detect supplier-side overrides of the crew's original ask
          // (qty/unit/size). When any differ, the board items table
          // renders a struck-through original next to the bold actual.
          const qtyChanged  = oi.requested_quantity != null && String(oi.requested_quantity) !== String(oi.quantity);
          const unitChanged = !!oi.requested_unit && String(oi.requested_unit).toLowerCase() !== String(oi.unit || '').toLowerCase();
          const sizeChanged = !!oi.requested_size && String(oi.requested_size).toLowerCase() !== String(oi.size || '').toLowerCase();
          map[key] = {
            id:                oi.id,
            updated_at:        oi.updated_at,
            status: oi.status,
            quoteStatus: oi.quote_status,
            substitution: oi.substitute_description,
            subPrice: oi.substitution_price,
            supplierNote: oi.supplier_item_note,
            // Best price the supplier has settled — agreed > quoted.
            // Used to populate the Unit Cost column on the board view
            // once the order is sent so the chief sees the real number,
            // not the crew's pre-send estimate (which is what the row
            // still carries).
            supplierPrice: oi.agreed_price ?? oi.quoted_price ?? null,
            supplierCurrency: oi.agreed_currency || oi.quoted_currency || null,
            // qty/unit/size — live vs originally-requested.
            quantity:          oi.quantity,
            unit:              oi.unit,
            size:              oi.size,
            requestedQuantity: oi.requested_quantity,
            requestedUnit:     oi.requested_unit,
            requestedSize:     oi.requested_size,
            qtyChanged, unitChanged, sizeChanged,
            hasChanges: qtyChanged || unitChanged || sizeChanged,
            hasNote: !!(oi.supplier_item_note && String(oi.supplier_item_note).trim()),
            parentOrder: order,
          };
        }
      });
    });
    return map;
  }, [supplierOrders]);

  // Portal-supplier lock: lines attached to a supplier who has a Cargo
  // portal account are the supplier's to manage — the crew must not
  // override their status (e.g. mark unavailable). We resolve the set of
  // portal-enabled supplier_profile_ids present on the board via the
  // SECURITY DEFINER RPC (crew RLS can't read supplier_contacts directly),
  // keyed on the distinct ids so it refetches only when the mix changes.
  const [portalSupplierIds, setPortalSupplierIds] = useState(() => new Set());
  const boardSupplierIdsKey = useMemo(() => {
    const ids = [...new Set(items.map(i => i.supplier_profile_id).filter(Boolean))];
    return ids.sort().join(',');
  }, [items]);
  useEffect(() => {
    const ids = boardSupplierIdsKey ? boardSupplierIdsKey.split(',') : [];
    if (ids.length === 0) { setPortalSupplierIds(new Set()); return; }
    let cancelled = false;
    fetchPortalEnabledSuppliers(ids)
      .then((map) => { if (!cancelled) setPortalSupplierIds(new Set(map.keys())); })
      .catch(() => { if (!cancelled) setPortalSupplierIds(new Set()); });
    return () => { cancelled = true; };
  }, [boardSupplierIdsKey]);
  // A board line is portal-locked when it's assigned to a portal supplier
  // — its status belongs to the supplier, not the crew.
  const isPortalLocked = useCallback(
    (item) => !!item?.supplier_profile_id && portalSupplierIds.has(item.supplier_profile_id),
    [portalSupplierIds],
  );

  // Supplier-response counts — banner above the items toolbar tells the
  // chief how many of the order's lines the supplier has acted on
  // (confirmed / substituted / unavailable) so they can spot pending
  // work without scanning. Computed from itemStatusMap so it reflects
  // whatever just synced down from supplier_order_items.
  const supplierResponseCounts = useMemo(() => {
    const counts = { confirmed: 0, substituted: 0, unavailable: 0 };
    Object.values(itemStatusMap).forEach((oi) => {
      if (counts[oi.status] !== undefined) counts[oi.status] += 1;
    });
    return counts;
  }, [itemStatusMap]);
  const totalSupplierResponses =
    supplierResponseCounts.confirmed
    + supplierResponseCounts.substituted
    + supplierResponseCounts.unavailable;

  // itemStatusMap must be declared before hasSendableItems and canDeleteItem
  const hasSendableItems = items
    .filter(i => i.status !== 'received' && i.status !== 'unavailable' && !isQuoteConfirmed(i) && i.name?.trim())
    .some(i => {
      const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
      return !oi;
    });
  // Delete individual items: owner / COMMAND / CHIEF / HOD  (not CREW)
  const canDeleteItem = !!isOwner || userTier === 'COMMAND' || (['CHIEF', 'HOD'].includes(userTier) && inSameDept) || isCollabEditor;

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
      const [fetchedList, fetchedItems, fetchedOrders] = await Promise.all([
        fetchProvisioningList(id),
        fetchListItems(id),
        fetchSupplierOrders(id).catch(() => []),
      ]);
      setList(fetchedList);
      setDisplayCurrency(fetchedList?.currency || 'GBP');
      setItems(fetchedItems || []);
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

  useEffect(() => {
    if (!allergenOpen) return;
    const h = (e) => { if (allergenRef.current && !allergenRef.current.contains(e.target)) setAllergenOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setAllergenOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', key);
    };
  }, [allergenOpen]);

  // Review-note popover — same outside-click / Escape pattern as
  // the allergen chip. Triggered by the "Note from <approver>" chip
  // on approved + changes_requested boards.
  useEffect(() => {
    if (!reviewNoteOpen) return undefined;
    const h = (e) => { if (reviewNoteRef.current && !reviewNoteRef.current.contains(e.target)) setReviewNoteOpen(false); };
    const k = (e) => { if (e.key === 'Escape') setReviewNoteOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [reviewNoteOpen]);

  // Load the active approval request whenever the board loads or its
  // status flips. Resolves approver/submitter names so the banner can
  // read "Submitted by Lauren · 2h ago" without a second fetch.
  useEffect(() => {
    if (!list?.id) return;
    let cancelled = false;
    (async () => {
      const req = await fetchActiveApprovalRequest(list.id);
      if (cancelled) return;
      setApprovalRequest(req);
      if (!req) {
        setApproverProfile(null);
        setSubmitterProfile(null);
        return;
      }
      const ids = [req.approver_id, req.submitter_id].filter(Boolean);
      if (ids.length === 0) return;
      const { data } = await supabase
        ?.from('profiles')
        ?.select('id, full_name, email')
        ?.in('id', ids) || {};
      if (cancelled || !Array.isArray(data)) return;
      setApproverProfile(data.find(p => p.id === req.approver_id) || null);
      setSubmitterProfile(data.find(p => p.id === req.submitter_id) || null);
    })();
    return () => { cancelled = true; };
  }, [list?.id, list?.status]);

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

  // Renders a human-readable summary for a supplier_order_activity row.
  // Falls back to the raw event_type when payload is missing fields the
  // template wants — keeps the History list honest rather than
  // generating misleading prose.
  const SUPPLIER_EVENT_SUMMARY = (eventType, payload) => {
    const name = payload?.item_name || 'an item';
    const price = payload?.agreed_price ?? payload?.declined_quoted_price;
    const currency = payload?.agreed_currency || payload?.declined_currency || '';
    switch (eventType) {
      case 'quote_received':   return `Supplier quoted ${name}${price ? ` at ${currency} ${price}` : ''}`;
      case 'quote_accepted':   return `Quote accepted for ${name}${price ? ` (${currency} ${price})` : ''}`;
      case 'quote_declined':   return `Quote declined for ${name}${price ? ` (${currency} ${price})` : ''}`;
      case 'discussion_opened': return `Discussion opened on ${name}`;
      case 'line_reopened':    return `Vessel reopened ${name}${payload?.previous_status ? ` (was ${payload.previous_status})` : ''}`;
      case 'supplier_requested_reopen':
        return `Supplier requested changes on ${name}${payload?.reason ? ` — "${payload.reason}"` : ''}`;
      case 'vessel_approved_quote':
        return `Vessel approved the quote on this order${payload?.fully_confirmed === false ? ' (partial — some lines still awaiting a quote)' : ''}`;
      default:                 return `${eventType.replace(/_/g, ' ')} — ${name}`;
    }
  };

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
        // OR entity_type=provisioning_item and entity_id in item IDs.
        //
        // PostgREST's `or()` takes top-level comma-separated filters and
        // OR's them flat — so passing
        //   entity_type.eq.provisioning_list,entity_id.eq.<id>,…
        // means "any provisioning_list row OR any row whose entity_id
        // matches the board OR any provisioning_item row OR any row
        // whose entity_id is in itemIds", which effectively returns
        // every provisioning event in the tenant. The fix is to wrap
        // each (entity_type AND entity_id) pair in `and(...)` so the
        // OR only fires across the two correctly-grouped pairs.
        let events = [];
        if (tenantId) {
          const listFilter = `and(entity_type.eq.provisioning_list,entity_id.eq.${list.id})`;
          const itemFilter = itemIds.length > 0
            ? `,and(entity_type.eq.provisioning_item,entity_id.in.(${itemIds.join(',')}))`
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
        // Also pull supplier_order_activity rows for any supplier
        // orders linked to this board, normalize them into the same
        // event shape, and merge. So the History tab carries the
        // supplier's confirms / subs / unavails / reopens alongside
        // the crew's own actions instead of hiding them in the
        // supplier portal's own timeline.
        try {
          const supplierOrderIds = (supplierOrders || []).map(o => o.id).filter(Boolean);
          if (supplierOrderIds.length > 0) {
            const { data: soa, error: soaErr } = await supabase
              ?.from('supplier_order_activity')
              ?.select('id, created_at, order_id, item_id, event_type, actor_name, actor_role, payload')
              ?.in('order_id', supplierOrderIds)
              ?.order('created_at', { ascending: false })
              ?.limit(200);
            if (soaErr) {
              console.error('[History] supplier_order_activity query error:', soaErr.message);
            } else {
              const supplierEvents = (soa || []).map(row => ({
                id: `soa:${row.id}`,
                createdAt: row.created_at,
                actorUserId: null,
                actorName: row.actor_name || 'Supplier',
                actorDepartment: row.actor_role || 'Supplier',
                action: `supplier_${row.event_type}`,
                entityType: row.item_id ? 'supplier_order_item' : 'supplier_order',
                entityId: row.item_id || row.order_id,
                summary: SUPPLIER_EVENT_SUMMARY(row.event_type, row.payload || {}),
                meta: row.payload || {},
              }));
              events = [...events, ...supplierEvents].sort(
                (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
              );
            }
          }
        } catch (err) {
          console.error('[History] supplier activity merge failed:', err);
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
  }, [activeTab, list?.id, items, activeTenantId, deliveries, supplierOrders]);

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

  // Realtime: refresh the board itself when the receive-driven status
  // trigger flips the list to partially_delivered / delivered_with_
  // discrepancies / delivered. Without this, the chip in the header
  // sat on the pre-receive status until a full page reload — the
  // trigger had moved on, the UI hadn't.
  useEffect(() => {
    if (!list?.id) return;
    const channel = supabase
      .channel(`provisioning-list-${list.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'provisioning_lists',
        filter: `id=eq.${list.id}`,
      }, (payload) => {
        if (payload.new) {
          setList((prev) => (prev ? { ...prev, ...payload.new } : prev));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [list?.id]);

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

  // Fields the board edits which also need to mirror across to the
  // matching supplier_order_items row when one exists. provisioning_items
  // → supplier_order_items naming:
  //   quantity_ordered → quantity
  //   unit             → unit
  //   size             → size
  //   notes            → notes
  // estimated_unit_cost stays vessel-side (the supplier never sees it),
  // status / name / brand / category are vessel-side concepts that
  // don't have a meaningful supplier-side write target.
  const SUPPLIER_MIRROR_FIELD = {
    quantity_ordered: 'quantity',
    unit:             'unit',
    size:             'size',
    notes:            'notes',
    units_per_pack:   'units_per_pack',
  };

  const handleCellSave = useCallback(async (item, field, rawValue) => {
    let value = rawValue;
    if (['quantity_ordered', 'quantity_received', 'estimated_unit_cost', 'quoted_unit_cost'].includes(field)) {
      value = rawValue === '' || rawValue == null ? null : parseFloat(rawValue) || 0;
    }
    if (item[field] === value) return;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: value } : i));
    try {
      await updateProvisioningItem(item.id, { [field]: value });

      // Mirror the edit to the matching supplier_order_item if one
      // exists. Lets the supplier see the chief's revised qty / unit /
      // size / notes the next time they refresh — no separate "send"
      // step needed. We only fire this on the fields above; the others
      // stay vessel-side. itemStatusMap drives the lookup so we don't
      // need to re-fetch supplierOrders mid-edit.
      const supplierField = SUPPLIER_MIRROR_FIELD[field];
      const oi = itemStatusMap[(item.name || '').toLowerCase().trim()];
      if (supplierField && oi?.id) {
        try {
          await updateOrderItemStatus(oi.id, { [supplierField]: value });
          // Refresh supplier orders so the local map (and the row's
          // strikethrough / supplier-aware columns) reflect the new
          // value immediately.
          if (list?.id) {
            const fresh = await fetchSupplierOrders(list.id);
            setSupplierOrders(fresh || []);
          }
          showToast('Sent to supplier', 'success');
        } catch (mirrorErr) {
          console.error('[ProvisioningBoardDetail] supplier mirror failed:', mirrorErr);
          showToast(`Saved on board — failed to send to supplier: ${mirrorErr.message || mirrorErr}`, 'error');
        }
      }
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: item[field] } : i));
      showToast('Failed to save', 'error');
    }
  }, [itemStatusMap, list?.id]);

  const handleQtyStep = useCallback(async (item, field, delta) => {
    const next = Math.max(0, (parseFloat(item[field]) || 0) + delta);
    await handleCellSave(item, field, next);
  }, [handleCellSave]);

  // ── Bulk receive (selection-driven, supersedes per-row quick-receive) ──
  // Serialised loop over quickReceiveItem(). Serialised (not parallel) on
  // purpose: the storage helper does find-or-create on "today's Manual
  // receive batch" — N parallel calls would race and produce N batches.
  // Serial reuses the batch the first call creates.
  //
  // > 5 items: live "Receiving M of N..." indicator on the action bar.
  // ≤ 5 items: silent, single completion toast.
  //
  // Partial failures revert the failed items' local state and surface
  // "Marked X received · Y failed" matching the sendAll pattern from
  // 61f612a. Selection clears on completion regardless of partial state
  // so the bar disappears — failed items stay visible on the board, the
  // crew can retry by re-selecting.
  const [bulkBusy, setBulkBusy] = useState({ kind: null, done: 0, total: 0 });
  // Bulk delete confirm modal — open via the bar's Delete verb.
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Bulk change-department modal — open via the bar's Change dept verb.
  const [bulkChangeDeptOpen, setBulkChangeDeptOpen] = useState(false);
  // Bulk multi-edit modal — open via the bar's Edit verb.
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // targetsOverride lets handleBulkEdit chain into the receive flow with
  // fresh items (post upsertItems of non-status touched fields), avoiding
  // React's state-batching staleness when called in the same call stack.
  const handleBulkReceive = async (targetsOverride = null) => {
    const targets = targetsOverride
      ?? items.filter(i => selectedItems.has(i.id) && i.status !== 'received');
    if (targets.length === 0) {
      if (selectedItems.size > 0) {
        showToast('All selected items are already received', 'success');
        setSelectedItems(new Set());
      }
      return;
    }

    // Optimistic — fan out the received state immediately. Failed items
    // get reverted below.
    const originals = new Map(targets.map(t => [t.id, t]));
    setItems(prev => prev.map(i => originals.has(i.id)
      ? { ...i, status: 'received', quantity_received: i.quantity_ordered ?? 0, payment_status: 'awaiting_invoice' }
      : i
    ));

    const showProgress = targets.length > 5;
    setBulkBusy({ kind: 'receive', done: 0, total: targets.length });

    let succeeded = 0;
    const failed = [];
    for (const item of targets) {
      // eslint-disable-next-line no-await-in-loop
      try {
        await quickReceiveItem({ item, listId: id, tenantId: activeTenantId, userId: user?.id });
        succeeded += 1;
      } catch (err) {
        console.error('[BulkReceive] item failed:', item.id, err);
        failed.push(item);
      }
      if (showProgress) {
        setBulkBusy(prev => ({ ...prev, done: succeeded + failed.length }));
      }
    }

    setBulkBusy({ kind: null, done: 0, total: 0 });

    // Revert local state for any failed items
    if (failed.length) {
      const failedIds = new Set(failed.map(f => f.id));
      setItems(prev => prev.map(i => failedIds.has(i.id) ? (originals.get(i.id) || i) : i));
    }

    // Refresh delivery batches once (not per-item) so the Received tab
    // shows the new batch immediately.
    fetchDeliveryBatches(id)
      .then(data => setDeliveries(data || []))
      .catch(err => console.error('[BulkReceive] fetchDeliveryBatches failed:', err));

    // Refresh list status + supplier_orders so the cascade results
    // (board pill flips to delivered / partially_delivered, order pill
    // flips to received) reflect in the local React state. The cascade
    // helper has already written to the DB by the time receiveItems /
    // quickReceiveItem resolves — these refetches just pull the new
    // values back into the component.
    Promise.allSettled([
      fetchProvisioningList(id),
      fetchSupplierOrders(id).catch(() => []),
    ]).then(([listRes, ordersRes]) => {
      if (listRes.status === 'fulfilled' && listRes.value) {
        setList(prev => ({ ...prev, ...listRes.value }));
      }
      if (ordersRes.status === 'fulfilled') {
        setSupplierOrders(ordersRes.value || []);
      }
    });

    if (failed.length === 0) {
      showToast(`Marked ${succeeded} item${succeeded === 1 ? '' : 's'} received`, 'success');
    } else if (succeeded === 0) {
      showToast(`Failed to receive ${failed.length} item${failed.length === 1 ? '' : 's'}`, 'error');
    } else {
      showToast(`Marked ${succeeded} received · ${failed.length} failed`, 'error');
    }

    // Clear selection regardless of partial state — bar disappears,
    // failed items stay visible on the board for retry.
    setSelectedItems(new Set());
  };

  // ── Bulk change department ──────────────────────────────────────────────
  // Atomic single-roundtrip via bulkUpdateItemDepartment
  // (.update({department}).in('id', ids)). Optimistic — items re-bucket
  // into the new dept-group immediately; revert on failure restores the
  // original department.
  //
  // Re-bucketing note: the existing deptGroups render derives from
  // items + groupBy, so once setItems lands with the new departments,
  // the dept-group rendering re-buckets on the next React pass.
  // Verified clean — no manual re-grouping needed.
  const handleBulkChangeDept = async (newDept) => {
    const ids = [...selectedItems];
    if (ids.length === 0 || !newDept) return;

    // Capture originals for revert
    const originals = new Map(
      items.filter(i => selectedItems.has(i.id)).map(i => [i.id, i.department || ''])
    );

    setBulkBusy({ kind: 'changeDept', done: 0, total: ids.length });
    // Optimistic — flip department locally
    setItems(prev => prev.map(i => originals.has(i.id) ? { ...i, department: newDept } : i));

    try {
      await bulkUpdateItemDepartment(ids, newDept);
      showToast(`Changed ${ids.length} item${ids.length === 1 ? '' : 's'} to ${newDept}`, 'success');
    } catch (err) {
      console.error('[BulkChangeDept] failed:', err);
      // Revert each item's original department
      setItems(prev => prev.map(i => originals.has(i.id) ? { ...i, department: originals.get(i.id) } : i));
      showToast(`Couldn't change department — ${err.message || err}`, 'error');
    } finally {
      setBulkBusy({ kind: null, done: 0, total: 0 });
      setBulkChangeDeptOpen(false);
      setSelectedItems(new Set());
    }
  };

  // ── Bulk set status ─────────────────────────────────────────────────────
  // Single entry point for changing a line's status from the selection bar
  // (replaces the per-row status dropdown — the row dot is now a read-only
  // indicator). Covers draft / ordered / unavailable / not_received /
  // returned / invoiced / paid; 'received' and 'partial' stay on the
  // dedicated "Mark received" verb so a delivery record is always created.
  // Portal-supplier lines are skipped — their status belongs to the
  // supplier, not the crew. A light status write (no delivery cascade),
  // mirroring the old inline picker.
  const handleBulkSetStatus = async (newStatus) => {
    if (!newStatus) return;
    const selected = items.filter(i => selectedItems.has(i.id));
    const eligible = selected.filter(i => !isPortalLocked(i));
    if (eligible.length === 0) {
      showToast('These lines are managed by their supplier — change status from the supplier side.', 'error');
      return;
    }
    const ids = eligible.map(i => i.id);
    const originals = new Map(eligible.map(i => [i.id, i.status]));
    const label = getItemStatusConfig(newStatus).label;

    setBulkBusy({ kind: 'status', done: 0, total: ids.length });
    setItems(prev => prev.map(i => originals.has(i.id) ? { ...i, status: newStatus } : i));
    try {
      await bulkUpdateProvisioningItems(ids, { status: newStatus });
      showToast(`Set ${ids.length} item${ids.length === 1 ? '' : 's'} to ${label}`, 'success');
    } catch (err) {
      console.error('[BulkSetStatus] failed:', err);
      setItems(prev => prev.map(i => originals.has(i.id) ? { ...i, status: originals.get(i.id) } : i));
      showToast(`Couldn't update status — ${err.message || err}`, 'error');
    } finally {
      setBulkBusy({ kind: null, done: 0, total: 0 });
      setSelectedItems(new Set());
    }
  };

  // ── Bulk multi-edit ─────────────────────────────────────────────────────
  // The modal passes back { diff, touched } — diff is the touched fields
  // resolved to values (with supplier_name added when supplier_profile_id
  // is touched). Two write paths converge here:
  //
  //   1. Non-status touched fields (and status != 'received') →
  //      single upsertItems write across all selected items. Fast,
  //      fire-and-toast like Change dept.
  //
  //   2. Status = 'received' → modal closes immediately; the bar
  //      swaps to the receive progress indicator and handleBulkReceive
  //      runs the serialised quickReceiveItem loop (same path Lauren
  //      gets clicking Mark received directly). If non-status fields
  //      were also touched, those land via upsertItems FIRST so
  //      quickReceiveItem reads the updated quantity_ordered etc.
  //      Targets are passed to handleBulkReceive explicitly to dodge
  //      React state-batching staleness in the same call stack.
  const handleBulkEdit = async ({ diff, touched }) => {
    const ids = [...selectedItems];
    if (ids.length === 0) return;

    // Close modal first — bar takes over for progress / success.
    setBulkEditOpen(false);

    const touchedKeys = Object.keys(touched).filter((k) => touched[k]);
    if (touchedKeys.length === 0) {
      showToast('No changes to save', 'success');
      setSelectedItems(new Set());
      return;
    }

    const wantsReceive = touched.status && diff.status === 'received';

    // Strip status from the upsertItems payload when we're going to
    // route through quickReceiveItem anyway — that helper will set
    // status='received' as part of its side-effect bundle (batch +
    // ledger + payment_status=awaiting_invoice). Avoids a stale write.
    const upsertDiff = { ...diff };
    if (wantsReceive) delete upsertDiff.status;

    const willUpsert = Object.keys(upsertDiff).length > 0;

    // Build originals for revert + targets for handleBulkReceive.
    const originals = new Map(
      items.filter((i) => selectedItems.has(i.id)).map((i) => [i.id, i])
    );

    let upsertedItems = null;
    if (willUpsert) {
      setBulkBusy({ kind: 'edit', done: 0, total: ids.length });
      // Optimistic — apply the diff locally
      setItems((prev) =>
        prev.map((i) => (originals.has(i.id) ? { ...i, ...upsertDiff } : i))
      );

      // Use the bulk UPDATE helper (not upsertItems). upsertItems compiles
      // to INSERT … ON CONFLICT, which makes RLS evaluate the INSERT
      // WITH CHECK policy — that policy needs list_id to find the parent
      // board, and a partial diff doesn't include list_id, so Postgres
      // rejects with 42501. .update().in('id', ids) only triggers the
      // UPDATE policy, which reads list_id from the existing row (which
      // the DB already has). See bulkUpdateProvisioningItems comment for
      // the full reasoning.
      try {
        await bulkUpdateProvisioningItems(ids, upsertDiff);
      } catch (err) {
        console.error('[BulkEdit] bulkUpdateProvisioningItems failed:', err);
        // Revert
        setItems((prev) =>
          prev.map((i) => (originals.has(i.id) ? originals.get(i.id) : i))
        );
        showToast(`Couldn't save changes — ${err.message || err}`, 'error');
        setBulkBusy({ kind: null, done: 0, total: 0 });
        setSelectedItems(new Set());
        return;
      }

      // Capture the fresh items (with upsertDiff applied) so the
      // chained receive path uses the right quantity_ordered etc.
      upsertedItems = items
        .filter((i) => selectedItems.has(i.id))
        .map((i) => ({ ...i, ...upsertDiff }));
      setBulkBusy({ kind: null, done: 0, total: 0 });
    }

    if (wantsReceive) {
      // Pass fresh items as targetsOverride so handleBulkReceive uses
      // the updated quantity_ordered (not stale state from before the
      // upsertItems above).
      const receiveTargets = (upsertedItems
        ?? items.filter((i) => selectedItems.has(i.id))
      ).filter((i) => i.status !== 'received');
      // handleBulkReceive clears selectedItems itself on completion.
      handleBulkReceive(receiveTargets);
      return;
    }

    // No-receive path: success toast + clear selection.
    if (willUpsert) {
      showToast(`Updated ${ids.length} item${ids.length === 1 ? '' : 's'}`, 'success');
    }
    setSelectedItems(new Set());
  };

  // ── Bulk delete ──────────────────────────────────────────────────────────
  // Atomic single-roundtrip via bulkDeleteProvisioningItems (.in('id', ids)).
  // Optimistic — items disappear from the list immediately; revert on
  // failure restores them. The confirm modal is the safety gate (the
  // brief mandates a confirmation step for the destructive verb).
  const handleBulkDelete = async () => {
    const ids = [...selectedItems];
    if (ids.length === 0) return;

    const originals = items.filter(i => selectedItems.has(i.id));
    setBulkBusy({ kind: 'delete', done: 0, total: ids.length });
    // Optimistic — remove from local state
    setItems(prev => prev.filter(i => !selectedItems.has(i.id)));

    try {
      await bulkDeleteProvisioningItems(ids);
      showToast(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      console.error('[BulkDelete] failed:', err);
      // Revert — restore the items list. Append at the end; the existing
      // dept-grouping render will re-bucket them on the next pass.
      setItems(prev => [...prev, ...originals]);
      showToast(`Couldn't delete items — ${err.message || err}`, 'error');
    } finally {
      setBulkBusy({ kind: null, done: 0, total: 0 });
      setBulkDeleteOpen(false);
      setSelectedItems(new Set());
    }
  };

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this item?')) return;
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await deleteProvisioningItem(itemId);
    } catch (err) {
      console.error('[ProvisioningBoardDetail] handleDeleteItem failed:', err);
      showToast('Failed to delete item', 'error');
      loadAll();
    }
  };

  // Reopen a supplier-confirmed line so the crew can revise qty / unit /
  // size / notes. Caller passes (provisioning_items row, supplier_order_item
  // map entry) so we can show the name in the confirm dialog and write the
  // supplier-side activity event server-side. Refreshes supplierOrders on
  // success so the row visually unlocks immediately.
  const handleReopenLine = async (provisioningItem, supplierLine) => {
    const itemName = provisioningItem?.name || 'this item';
    if (!supplierLine?.parentOrder?.id) {
      showToast('Could not reopen — supplier order link missing.', 'error');
      return;
    }
    const ok = window.confirm(
      `Reopen "${itemName}" for changes?\n\n`
      + 'The supplier will be notified that this line is back to pending. '
      + 'They will need to re-confirm once you save your changes.',
    );
    if (!ok) return;
    try {
      // The map carries the FK on parentOrder; the order_item id we need
      // is the one keyed by item name. Walk the parent order's items.
      const oi = (supplierLine.parentOrder.supplier_order_items || [])
        .find(x => (x.item_name || '').toLowerCase().trim() === (itemName || '').toLowerCase().trim());
      if (!oi) {
        showToast('Could not find the supplier line to reopen.', 'error');
        return;
      }
      await reopenOrderItem(oi.id);
      showToast(`"${itemName}" reopened — supplier notified.`, 'success');
      // Refresh supplier orders so the local map drops supplierActed for
      // this line and the row unlocks on the next render.
      if (list?.id) {
        const fresh = await fetchSupplierOrders(list.id);
        setSupplierOrders(fresh || []);
      }
    } catch (err) {
      console.error('[ProvisioningBoardDetail] handleReopenLine failed:', err);
      showToast(`Reopen failed: ${err.message || err}`, 'error');
    }
  };

  // Manual-quote reopen — the non-supplier equivalent of handleReopenLine.
  // A quote-confirmed manual line has no supplier order to notify; reopening
  // just flips quote_reopened so the line unlocks (editable, re-sendable)
  // while keeping its entered price. If the board was fully confirmed it
  // drops back to partially_confirmed so "Confirm quote" reappears to
  // re-lock the line once the crew's done.
  const handleReopenManualLine = async (item) => {
    const itemName = item?.name || 'this line';
    const ok = window.confirm(
      `Reopen "${itemName}" for changes?\n\n`
      + 'It unlocks so you can edit or re-send it, and keeps its quoted price. '
      + 'It stops counting as confirmed until you confirm the quote again.',
    );
    if (!ok) return;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, quote_reopened: true } : i));
    try {
      await updateProvisioningItem(item.id, { quote_reopened: true });
      if (list?.status === 'confirmed') {
        try {
          await updateProvisioningList(id, { status: 'partially_confirmed' });
          setList(prev => ({ ...prev, status: 'partially_confirmed' }));
          try { window.dispatchEvent(new Event('provisioning-list-status-changed')); } catch { /* noop */ }
        } catch (e) {
          console.error('[ReopenManualLine] board status update failed:', e);
        }
      }
      showToast(`"${itemName}" reopened for changes`, 'success');
    } catch (err) {
      console.error('[ReopenManualLine] failed:', err);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, quote_reopened: false } : i));
      showToast(`Couldn't reopen — ${err.message || err}`, 'error');
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
    } catch (err) {
      console.error('[ProvisioningBoardDetail] handleAddItem failed:', err);
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

  // Quick Add: Apply-favourite / Apply-template / Add-from-history callbacks
  // route here. The drawer hands back the saved provisioning_items rows;
  // we append them to the board's items state. Matches the homepage's
  // handleAddItemsFromDrawer pattern but for the flat (single-board) state.
  const handleAddItemsFromQuickAdd = useCallback((listId, newItems) => {
    if (!Array.isArray(newItems) || newItems.length === 0) return;
    setItems(prev => [...prev, ...newItems]);
  }, []);

  // Star toggle on an order card. Optimistic update — flip locally first,
  // revert on RPC rejection (tier/dept gate fires inside
  // toggle_supplier_order_favourite). The RPC error message becomes the
  // toast verbatim so the crew sees exactly why a curate attempt was
  // refused (e.g. "Only the department head can favourite orders").
  const handleToggleFavourite = async (order) => {
    if (favouritingOrderId) return;
    setFavouritingOrderId(order.id);
    const next = !order.is_favourite;
    // Optimistic: update local row immediately
    setSupplierOrders(prev => prev.map(o => o.id === order.id
      ? { ...o, is_favourite: next, favourited_at: next ? new Date().toISOString() : null }
      : o));
    try {
      await toggleSupplierOrderFavourite(order.id);
    } catch (err) {
      // Revert
      setSupplierOrders(prev => prev.map(o => o.id === order.id
        ? { ...o, is_favourite: !next, favourited_at: order.favourited_at }
        : o));
      const msg = err?.message || 'Could not update favourite';
      showToast(msg, 'error');
    } finally {
      setFavouritingOrderId(null);
    }
  };

  // ── Board actions ─────────────────────────────────────────────────────────

  const handleStatusUpdate = async (newStatus) => {
    setShowMenu(false);
    try {
      const updated = await updateProvisioningList(id, { status: newStatus });
      setList(prev => ({ ...prev, ...updated }));
      showToast('Status updated', 'success');
    } catch { showToast('Failed to update status', 'error'); }
  };

  // Submit for Approval — calls the atomic RPC that resolves the
  // approver, writes the approval_requests row, flips the board to
  // pending_approval, and notifies the approver. The toast quotes the
  // approver name returned from the RPC so the submitter knows where
  // it went.
  const handleSubmitForApproval = async () => {
    setShowMenu(false);
    try {
      const result = await submitProvisioningForApproval(id);
      setList(prev => ({ ...prev, status: PROVISIONING_STATUS.PENDING_APPROVAL }));
      showToast(`Sent to ${result?.approver_name || 'reviewer'} for approval`, 'success');
    } catch (err) {
      const code = err?.code;
      if (code === 'P0003') {
        showToast('No approver configured for this vessel — add a COMMAND member in Settings.', 'error');
      } else if (code === 'P0004') {
        showToast('Board is already submitted.', 'error');
      } else if (code === 'PGRST202') {
        // RPC not found on the schema — migrations haven't applied yet.
        showToast('Approval routing not yet deployed on this environment.', 'error');
      } else {
        showToast('Failed to submit for approval', 'error');
      }
    }
  };

  // Reviewer decision — approve or request_changes. request_changes
  // requires a comment, collected via the decisionModal popup. Both
  // outcomes flip the board back to draft so the submitter can act.
  // Quote file upload — uploads to storage then calls the RPC that
  // attaches it to the list and flips status to quote_received iff
  // currently sent_to_supplier. Idempotent — uploading a revised PDF
  // updates the URL without regressing the lifecycle.
  const handleQuoteFileChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setUploadingQuote(true);
    try {
      const result = await uploadProvisioningQuoteFile(file, id);
      if (!result) {
        showToast('Could not upload quote file', 'error');
      } else {
        setList(prev => ({
          ...prev,
          quote_file_url: prev?.quote_file_url ?? null,
          quote_file_name: file.name,
          quote_file_uploaded_at: new Date().toISOString(),
          status: result.status || prev?.status,
        }));
        // Re-fetch the list to pull the new URL fields the RPC stamped.
        try {
          const fresh = await supabase
            ?.from('provisioning_lists')
            ?.select('quote_file_url, quote_file_uploaded_at, quote_file_name, status')
            ?.eq('id', id)
            ?.maybeSingle();
          if (fresh?.data) setList(prev => ({ ...prev, ...fresh.data }));
        } catch { /* best-effort */ }
        showToast(result.flipped
          ? 'Quote attached — board ready to re-submit for approval'
          : 'Quote attached', 'success');
        // Open the review modal so the AI can read the quote and the
        // chief can apply the supplier's prices onto the board lines.
        setQuoteReviewFile(file);
      }
    } catch (err) {
      showToast('Could not upload quote file', 'error');
    } finally {
      setUploadingQuote(false);
      if (quoteFileInputRef.current) quoteFileInputRef.current.value = '';
    }
  };

  const handleDecide = async (decision) => {
    if (!approvalRequest?.id) return;
    if (decision === 'request_changes' && !decisionComment.trim()) {
      showToast('Add a comment so the submitter knows what to fix.', 'error');
      return;
    }
    setDeciding(true);
    try {
      // Both decisions carry the optional note now. Request changes
      // requires one (enforced above + RPC P0005). Approve treats it
      // as advisory context the submitter sees on the board's review
      // chip + history — supplier swap, port change, delivery
      // instructions, etc.
      const trimmed = decisionComment.trim();
      const result = await decideProvisioningApproval(
        approvalRequest.id,
        decision,
        trimmed || null,
      );

      // Quote-review approvals auto-fire the agreed quotes back to
      // the supplier — the previous flow flipped the board to draft
      // and waited for the chief to send a separate "approval"
      // message. Now the approve action accepts every outstanding
      // line, flips each supplier_order + the list itself to
      // 'confirmed', and the supplier's portal picks it up via the
      // existing trigger-driven activity feed + bell badge.
      const isQuoteApproval =
        approvalRequest?.prev_status === PROVISIONING_STATUS.QUOTE_RECEIVED;
      let nextListStatus = PROVISIONING_STATUS.DRAFT;
      let quoteApprovalResult = null;
      if (decision === 'approve' && isQuoteApproval) {
        try {
          quoteApprovalResult = await approveAllQuotes(id);
          // Multi-supplier safe: the list only flips to 'confirmed'
          // when every linked supplier_order is itself confirmed.
          // Otherwise it goes to partially_confirmed so the chief
          // can see which lines / orders still need a response.
          nextListStatus = quoteApprovalResult.listFullyConfirmed
            ? 'confirmed'
            : (quoteApprovalResult.affectedItems > 0
                ? 'partially_confirmed'
                : list?.status || PROVISIONING_STATUS.DRAFT);
        } catch (autoErr) {
          console.error('[ProvisioningBoardDetail] approveAllQuotes failed:', autoErr);
          showToast('Approved — could not auto-confirm with supplier. Try again from the order.', 'error');
        }
      }
      setList(prev => ({ ...prev, status: nextListStatus }));
      setApprovalRequest(prev => prev ? {
        ...prev,
        status: result?.status || (decision === 'approve' ? 'approved' : 'changes_requested'),
        comment: trimmed || prev.comment,
        decided_at: new Date().toISOString(),
      } : prev);
      setDecisionModal(null);
      setDecisionComment('');
      // Same kanban-refresh signal as the no-approver flow.
      try { window.dispatchEvent(new Event('provisioning-list-status-changed')); } catch { /* noop */ }
      const successMsg = decision === 'approve'
        ? (isQuoteApproval
            ? (quoteApprovalResult?.listFullyConfirmed
                ? 'Quote approved — supplier notified'
                : `Quote approved — ${quoteApprovalResult?.ordersConfirmed || 0} order${quoteApprovalResult?.ordersConfirmed === 1 ? '' : 's'} confirmed, others still waiting on quotes`)
            : 'Approved')
        : 'Changes requested';
      showToast(successMsg, 'success');
    } catch (err) {
      const code = err?.code;
      if (code === 'P0005') showToast('A comment is required.', 'error');
      else if (code === 'P0006') showToast('Only the assigned approver can decide.', 'error');
      else if (code === 'P0007') showToast('Already decided.', 'error');
      else showToast('Failed to submit decision', 'error');
    } finally {
      setDeciding(false);
    }
  };

  const handleDuplicate = async () => {
    setShowMenu(false);
    try {
      const newList = await duplicateList(id, activeTenantId, user?.id);
      showToast('Board duplicated', 'success');
      navigate('/provisioning/' + newList.id);
    } catch { showToast('Failed to duplicate', 'error'); }
  };

  // Fire-and-toast — flip is_template=true on the current board so it
  // surfaces in the Quick Add Templates tab. Source board untouched.
  // No drawer open, no navigation.
  const handleSaveAsTemplateBoard = async () => {
    setShowMenu(false);
    try {
      await saveAsTemplate(id, true);
      showToast(`"${list.title}" saved as template`, 'success');
    } catch (err) {
      console.error('[ProvisioningBoardDetail] saveAsTemplate error:', err);
      showToast('Failed to save as template', 'error');
    }
  };

  const handleSendToSupplier = () => {
    const sendableItems = items.filter(i => i.status !== 'received' && i.status !== 'unavailable' && !isQuoteConfirmed(i) && i.name?.trim());
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
    if (statusFilter !== 'all') {
      // Filter applies to the DERIVED status — so picking "Confirmed" or
      // "Paid" matches items where the derive function returns those
      // values even when item.status is still 'ordered' / 'received'.
      const itemOrder = itemStatusMap[(item.name || '').toLowerCase().trim()];
      const derived = deriveDisplayStatus(item, itemOrder, itemOrder?.parentOrder);
      if (derived !== statusFilter) return false;
    }
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

  // Categories now default to all-expanded on first load. The previous
  // seed (collapse all but the first two per dept) created the visual
  // inconsistency the chief flagged — some categories open, others
  // shut, no obvious reason. All-open keeps the scan honest. Long
  // orders can collapse what they don't want via the chevrons.

  // Once an item's line is sitting inside a supplier_order, the
  // chief's view of cost / qty should reflect what the supplier
  // confirmed, not the crew's pre-send estimate. These helpers walk
  // itemStatusMap and fall back to the row's own values when no
  // supplier match exists yet (pre-send rows + unmatched names).
  const effectiveCost = useCallback((i) => {
    const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
    // An applied manual quote (quoted_unit_cost) is the chief's most
    // recent explicit pricing action, so it wins — including over a
    // Cargo-supplier confirmed price. Then the supplier's price, then
    // the original estimate. (On a normal supplier board no manual
    // quote exists, so quoted_unit_cost is null and the supplier price
    // still wins — existing behaviour is unchanged.)
    if (i.quoted_unit_cost != null && Number(i.quoted_unit_cost) > 0) {
      return Number(i.quoted_unit_cost);
    }
    if (oi?.supplierPrice != null && Number(oi.supplierPrice) > 0) {
      return Number(oi.supplierPrice);
    }
    return parseFloat(i.estimated_unit_cost) || 0;
  }, [itemStatusMap]);
  const effectiveOrderedQty = useCallback((i) => {
    const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
    if (oi?.quantity != null) return Number(oi.quantity) || 0;
    return parseFloat(i.quantity_ordered) || 0;
  }, [itemStatusMap]);

  // Baseline cost per line for the quote-review variance — the line's
  // CURRENT effective cost (supplier price / prior quote / estimate),
  // not just estimated_unit_cost. On a Cargo-supplier board the estimate
  // is often null and the real cost is the supplier's, so diffing only
  // against estimated_unit_cost showed nothing. null when there's no
  // baseline to compare against.
  const baselineCostById = useMemo(() => {
    const m = {};
    items.forEach((i) => { const c = effectiveCost(i); m[i.id] = c > 0 ? c : null; });
    return m;
  }, [items, effectiveCost]);

  // Unavailable lines are excluded from every cost roll-up — they won't be
  // supplied, so they carry no committed spend.
  const grandTotals = useMemo(() => items.reduce((acc, i) => {
    if (i.status === 'unavailable') return acc;
    const qty = effectiveOrderedQty(i);
    const qtyRec = parseFloat(i.quantity_received) || 0;
    const cost = effectiveCost(i);
    return { estimated: acc.estimated + qty * cost, actual: acc.actual + qtyRec * cost };
  }, { estimated: 0, actual: 0 }), [items, effectiveCost, effectiveOrderedQty]);

  const convertedTotals = useMemo(() => {
    const disp = displayCurrency || 'GBP';
    return items.reduce((acc, i) => {
      if (i.status === 'unavailable') return acc;
      const qty = effectiveOrderedQty(i);
      const qtyRec = parseFloat(i.quantity_received) || 0;
      const cost = effectiveCost(i);
      const iCurr = i.currency || (list?.currency || 'GBP');
      const c = (cost / (fxRates[iCurr] || 1)) * (fxRates[disp] || 1);
      return { estimated: acc.estimated + qty * c, actual: acc.actual + qtyRec * c };
    }, { estimated: 0, actual: 0 });
  }, [items, displayCurrency, fxRates, list, effectiveCost, effectiveOrderedQty]);

  // Pre-computed values passed to SummaryGauges
  const gaugeProps = useMemo(() => {
    const disp = displayCurrency || 'GBP';
    const convItem = (i) => {
      const cost = effectiveCost(i);
      const qty  = effectiveOrderedQty(i);
      const iCurr = i.currency || (list?.currency || 'GBP');
      return qty * ((cost / (fxRates[iCurr] || 1)) * (fxRates[disp] || 1));
    };
    const effectivePS = (i) => paymentStatusMap[i.id] ?? i.payment_status ?? 'awaiting_invoice';
    // Unavailable lines don't count toward receive / pay progress — they
    // won't be supplied, so they're neither outstanding nor payable.
    const liveItems = items.filter(i => i.status !== 'unavailable');
    const unavailableCount = items.length - liveItems.length;
    const receivedCount = liveItems.filter(i => ['received', 'partial'].includes(i.status)).length;
    const paidItems   = liveItems.filter(i => ['paid', 'paid_upfront'].includes(effectivePS(i)));
    const unpaidItems = liveItems.filter(i => !['paid', 'paid_upfront'].includes(effectivePS(i)));
    return {
      leftToReceive:  liveItems.length - receivedCount,
      totalCount:     liveItems.length,
      receivedCount,
      totalValue:     convertedTotals.estimated,
      costSubtext:    `${liveItems.length} item${liveItems.length !== 1 ? 's' : ''} on board${unavailableCount > 0 ? ` · ${unavailableCount} unavailable` : ''}`,
      paidValue:      paidItems.reduce((s, i) => s + convItem(i), 0),
      leftToPayValue: unpaidItems.reduce((s, i) => s + convItem(i), 0),
    };
  }, [items, paymentStatusMap, convertedTotals, fxRates, displayCurrency, list, effectiveCost, effectiveOrderedQty]);

  // ── Checkboxes / selection model ──────────────────────────────────────────
  // selectedItems is a Set of item ids. Survives filter/search changes
  // naturally (id-keyed) — items hidden by filter stay selected and
  // reappear when the filter clears. Clears on bulk-action success,
  // explicit Clear button on the action bar, or component unmount.
  //
  // Only allChecked matters for the header checkbox state. Indeterminate
  // is deliberately omitted — the dash reads as "remove", which is the
  // opposite of what the click does. The "some selected" state is
  // communicated by the floating action bar's count ("N items selected"),
  // not by a mid-state on the checkbox. toggleAll acts on the CURRENT
  // FILTERED VIEW per the brief — what's visible is what's selectable.

  const allChecked = filteredItems.length > 0 && filteredItems.every(i => selectedItems.has(i.id));
  const toggleAll = () => setSelectedItems(allChecked ? new Set() : new Set(filteredItems.map(i => i.id)));
  // Per-dept-group toggle. Two scopes: the top-level master toggles
  // every filtered item (toggleAll, above); each dept-group's header
  // checkbox toggles only its own deptItems via toggleDept. Both
  // derive checked-state from their own scope: top-level uses
  // allChecked; dept-group uses an inline `deptItems.every(...)` at
  // render time. No indeterminate state on either (consistent with
  // the standing-rule from tweak 2).
  const toggleDept = (deptItems) => {
    const ids = deptItems.map(i => i.id);
    const allDeptSelected = ids.every(id => selectedItems.has(id));
    setSelectedItems(prev => {
      const n = new Set(prev);
      if (allDeptSelected) {
        ids.forEach(id => n.delete(id));
      } else {
        ids.forEach(id => n.add(id));
      }
      return n;
    });
  };
  const toggleItem = (itemId) => setSelectedItems(prev => {
    const n = new Set(prev);
    n.has(itemId) ? n.delete(itemId) : n.add(itemId);
    return n;
  });
  const clearSelection = () => setSelectedItems(new Set());

  // ── Meta helpers ──────────────────────────────────────────────────────────

  const deptTags = useMemo(() => {
    if (!list?.department) return [];
    return Array.isArray(list.department) ? list.department.filter(Boolean) : list.department.split(',').map(d => d.trim()).filter(Boolean);
  }, [list]);
  const currency = list?.currency || 'GBP';
  const isDraftOrPending = list?.status === PROVISIONING_STATUS.DRAFT || list?.status === PROVISIONING_STATUS.PENDING_APPROVAL;
  // Submit for Approval is valid from draft (initial submission) or
  // quote_received (re-submission after the supplier's quote landed).
  // Pending-approval boards show their review chip instead.
  const isQuoteReceived = list?.status === PROVISIONING_STATUS.QUOTE_RECEIVED;
  // A manually-uploaded quote (PDF attached) puts the board into the
  // same "decide on the quote" stage as a Cargo-supplier quote_received —
  // so Submit-for-approval / Confirm-quote should surface once a quote is
  // attached, regardless of how it arrived. Excluded once the board has
  // moved past the decision (pending approval, or any delivered state).
  const DELIVERED_STATES = [
    PROVISIONING_STATUS.PARTIALLY_DELIVERED,
    PROVISIONING_STATUS.DELIVERED,
    PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES,
  ];
  const hasManualQuote = !!list?.quote_file_url;
  const manualQuoteStage = hasManualQuote
    && list?.status !== PROVISIONING_STATUS.PENDING_APPROVAL
    // Once the board is fully confirmed there's nothing left to confirm —
    // hide the decision button. (A partially-confirmed board still shows
    // it via isPartiallyConfirmed below, so the remaining lines can be
    // finalised.)
    && list?.status !== PROVISIONING_STATUS.CONFIRMED
    && !DELIVERED_STATES.includes(list?.status);
  // A part-confirmed board still has items waiting on a quote decision —
  // a multi-supplier split where one supplier's quote is already in /
  // confirmed but others are still outstanding. Keep the decision buttons
  // open so the next supplier's quote can be submitted / confirmed without
  // the board having to bounce back to 'quote_received' first. (Manual
  // boards are already covered by manualQuoteStage, which spans partials.)
  const isPartiallyConfirmed = list?.status === PROVISIONING_STATUS.PARTIALLY_CONFIRMED;
  // The board is awaiting a quote decision (Cargo-supplier OR manual, and
  // including a partially-confirmed split with items still outstanding).
  const quoteDecisionStage = isQuoteReceived || manualQuoteStage || isPartiallyConfirmed;
  const canSubmitForApproval = list?.status === PROVISIONING_STATUS.DRAFT || quoteDecisionStage;

  // "Note from supplier" chip state. seenAt = ISO timestamp this
  // user last clicked the chip (or null = never). The chip pulses
  // when the supplier has unseen activity — substitution,
  // unavailable, or supplier_item_note — newer than seenAt. The
  // popover lists those actions; opening it marks the chip seen,
  // pulse stops until the supplier touches the order again.
  const [supplierNotesSeenAt, setSupplierNotesSeenAt] = useState(null);
  const [supplierNotesOpen, setSupplierNotesOpen] = useState(false);
  const supplierNotesRef = useRef(null);

  // History tab source filter — driven by the "View in history" link
  // in the supplier-notes popover (which prefills 'supplier' so the
  // chief lands on a focused timeline) and by the filter pills above
  // the History list. Persists across tab switches so the popover
  // hand-off survives a round-trip via the Items tab.
  const [historySourceFilter, setHistorySourceFilter] = useState('all');

  // Resolve this user's collaborator permission so canEdit can grant
  // an invited 'edit' / 'approve' collaborator the write affordances.
  useEffect(() => {
    if (!list?.id || !user?.id) { setCollabPerm(null); return undefined; }
    let cancelled = false;
    fetchCollaborators(list.id)
      .then((rows) => {
        if (cancelled) return;
        const mine = (rows || []).find((c) => c.user_id === user.id);
        setCollabPerm(mine?.permission || null);
      })
      .catch(() => { if (!cancelled) setCollabPerm(null); });
    return () => { cancelled = true; };
  }, [list?.id, user?.id]);

  // Crew list for the Share modal's collaborator picker.
  useEffect(() => {
    if (!activeTenantId) { setCrewMembers([]); return undefined; }
    let cancelled = false;
    fetchCrewMembers(activeTenantId)
      .then((rows) => { if (!cancelled) setCrewMembers(rows || []); })
      .catch(() => { if (!cancelled) setCrewMembers([]); });
    return () => { cancelled = true; };
  }, [activeTenantId]);

  useEffect(() => {
    if (!list?.id || !user?.id) return undefined;
    let cancelled = false;
    fetchSupplierNotesSeenAt(list.id, user.id)
      .then((t) => { if (!cancelled) setSupplierNotesSeenAt(t); })
      .catch(() => { if (!cancelled) setSupplierNotesSeenAt(null); });
    return () => { cancelled = true; };
  }, [list?.id, user?.id]);

  useEffect(() => {
    if (!supplierNotesOpen) return undefined;
    const onDocClick = (e) => {
      if (supplierNotesRef.current && !supplierNotesRef.current.contains(e.target)) {
        setSupplierNotesOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setSupplierNotesOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [supplierNotesOpen]);

  // Compose the supplier-activity feed for the chip popover. Tracks
  // every action the supplier took on a line — confirms, sub'd,
  // unavail'd, qty / unit / size overridden, notes left. Per-line
  // simple confirms get batched into a single summary row at the
  // top so a bulk-confirm of 14 lines doesn't drown the rest of
  // the feed.
  //
  // Each row carries an updated_at so the feed can sort newest
  // first and the pulse predicate can compare to seen_at.
  const supplierNoteActions = useMemo(() => {
    const out = [];
    const confirmed = [];
    Object.entries(itemStatusMap).forEach(([nameKey, oi]) => {
      const niceName = (items.find(it => (it.name || '').toLowerCase().trim() === nameKey)?.name) || nameKey;
      const updatedAtMs = oi.updated_at ? new Date(oi.updated_at).getTime() : 0;
      if (oi.status === 'substituted' && oi.substitution) {
        out.push({ key: `sub:${nameKey}`, kind: 'sub', item: niceName, text: oi.substitution, updatedAtMs });
      } else if (oi.status === 'unavailable') {
        out.push({ key: `un:${nameKey}`, kind: 'unavail', item: niceName, updatedAtMs });
      } else if (oi.status === 'confirmed') {
        confirmed.push({ name: niceName, updatedAtMs });
      }
      if (oi.qtyChanged) {
        out.push({ key: `qty:${nameKey}`, kind: 'qty', item: niceName, text: `${oi.requestedQuantity} → ${oi.quantity}`, updatedAtMs });
      }
      if (oi.unitChanged) {
        out.push({ key: `unit:${nameKey}`, kind: 'unit', item: niceName, text: `${oi.requestedUnit} → ${oi.unit}`, updatedAtMs });
      }
      if (oi.sizeChanged) {
        out.push({ key: `size:${nameKey}`, kind: 'size', item: niceName, text: `${oi.requestedSize} → ${oi.size}`, updatedAtMs });
      }
      if (oi.hasNote && oi.supplierNote) {
        out.push({ key: `note:${nameKey}`, kind: 'note', item: niceName, text: oi.supplierNote, updatedAtMs });
      }
    });
    // Bulk-confirm summary row. Single line at the top so a 14-item
    // batch doesn't push the more interesting actions off-screen;
    // sorts to its own newest item's timestamp so it interleaves
    // honestly with subs / notes that happened around the same time.
    if (confirmed.length > 0) {
      const newestConfirm = confirmed.reduce((m, c) => Math.max(m, c.updatedAtMs), 0);
      const sampleNames = confirmed.slice(0, 3).map(c => c.name).join(', ');
      const overflow = confirmed.length > 3 ? ` + ${confirmed.length - 3} more` : '';
      out.push({
        key: `confirmed-summary`,
        kind: 'confirmed',
        item: `${confirmed.length} item${confirmed.length === 1 ? '' : 's'} confirmed`,
        text: `${sampleNames}${overflow}`,
        updatedAtMs: newestConfirm,
      });
    }
    // Newest first.
    out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return out;
  }, [itemStatusMap, items]);

  const supplierLatestUpdatedAt = useMemo(() => {
    let max = 0;
    Object.values(itemStatusMap).forEach((oi) => {
      const t = oi.updated_at ? new Date(oi.updated_at).getTime() : 0;
      if (t > max) max = t;
    });
    return max;
  }, [itemStatusMap]);

  const supplierNotesSeenAtMs = supplierNotesSeenAt
    ? new Date(supplierNotesSeenAt).getTime()
    : 0;
  const supplierNotesUnread =
    supplierNoteActions.length > 0
    && supplierLatestUpdatedAt > 0
    && supplierLatestUpdatedAt > supplierNotesSeenAtMs;
  // Per-row predicate used by the items table to pulse the cells
  // that actually changed (qty / unit / size diffs, supplier note,
  // sub line) — so the chief's eye lands on the right line rather
  // than scanning for what's different.
  const rowHasUnseenSupplier = useCallback((oi) => {
    if (!oi?.updated_at) return false;
    return new Date(oi.updated_at).getTime() > supplierNotesSeenAtMs;
  }, [supplierNotesSeenAtMs]);

  const handleSupplierNotesToggle = () => {
    const willOpen = !supplierNotesOpen;
    setSupplierNotesOpen(willOpen);
    if (willOpen && supplierNotesUnread && list?.id && user?.id) {
      // Optimistically clear locally so the pulse stops immediately;
      // server stamp follows.
      const now = new Date().toISOString();
      setSupplierNotesSeenAt(now);
      markSupplierNotesSeen(list.id, user.id).catch(() => {});
    }
  };

  // "Confirm quote" gate. Reads the per-vessel approval_routing
  // toggles + the caller's tier — COMMAND never requires approval,
  // CHIEF / HOD / CREW require it iff their respective routing
  // toggle is left at the default (true). When the toggle is OFF in
  // Vessel Settings → Provisioning approval, the user can confirm a
  // quote directly without going through the approval cycle.
  //
  // Distinct from resolve_provisioning_approver which always falls
  // back to "any COMMAND member" — that fallback would hide this
  // button from everyone.
  const [confirmQuoteAllowed, setConfirmQuoteAllowed] = useState(false);
  useEffect(() => {
    if (!quoteDecisionStage || !activeTenantId || !user?.id) {
      setConfirmQuoteAllowed(false);
      return undefined;
    }
    let cancelled = false;
    callerRequiresProvisioningApproval(activeTenantId, user.id)
      .then((requires) => { if (!cancelled) setConfirmQuoteAllowed(!requires); })
      .catch(() => { if (!cancelled) setConfirmQuoteAllowed(false); });
    return () => { cancelled = true; };
  }, [quoteDecisionStage, activeTenantId, user?.id]);

  // Confirm-quote handler (no-approver path). Same flow as the
  // approver-approve branch above; we just skip the approval-request
  // step and call approveAllQuotes directly. The intent step lives
  // in an editorial Cargo modal (not window.confirm) so the prompt
  // reads as part of the app, not the browser.
  const [confirmingQuote, setConfirmingQuote] = useState(false);
  const [confirmQuoteModalOpen, setConfirmQuoteModalOpen] = useState(false);
  const handleConfirmQuoteWithoutApprover = () => {
    if (!id) return;
    setConfirmQuoteModalOpen(true);
  };
  const runConfirmQuote = async () => {
    if (!id) return;
    setConfirmingQuote(true);
    try {
      const result = await approveAllQuotes(id);
      let nextStatus = result?.listFullyConfirmed
        ? 'confirmed'
        : (result?.affectedItems > 0
            ? 'partially_confirmed'
            : list?.status);
      // Manual quote (uploaded PDF, no Cargo supplier_order to confirm):
      // approveAllQuotes had nothing to act on. There's no per-line quote
      // object, so derive the board rollup from how many items now carry
      // an applied quote (quoted_unit_cost). An item is "confirmed" once a
      // supplier's quote has been read onto it; the rest are still out to
      // quote. Confirming only ever *advances* the rollup — already-priced
      // items are never re-touched, and when a later supplier quote fills
      // in the remaining items a second Confirm completes the board.
      //   all priced  → confirmed
      //   some priced → partially_confirmed
      //   none priced → leave as-is (nothing to confirm yet)
      const isPriced = (i) => i.quoted_unit_cost != null && Number(i.quoted_unit_cost) > 0;
      // An item is "settled" for the rollup once it either carries an
      // applied quote OR the crew has marked it unavailable (it will never
      // be quoted). Counting unavailable as settled lets a board complete
      // to 'confirmed' instead of sticking at partially_confirmed forever.
      const isSettled = (i) => isPriced(i) || i.status === 'unavailable';
      const pricedItems = items.filter(isPriced);
      let manualOutcome = null;   // { priced, unavailable, total } when the manual branch ran
      if ((!result || !result.affectedItems) && hasManualQuote) {
        // Re-confirming re-locks any reopened priced lines — clear their
        // quote_reopened flag so isQuoteConfirmed treats them as confirmed
        // again (mirrors a supplier re-confirm closing a reopened line).
        const reopenedIds = items.filter(i => i.quote_reopened && isPriced(i)).map(i => i.id);
        if (reopenedIds.length) {
          try {
            await bulkUpdateProvisioningItems(reopenedIds, { quote_reopened: false });
            setItems(prev => prev.map(i => reopenedIds.includes(i.id) ? { ...i, quote_reopened: false } : i));
          } catch (e) {
            console.error('[runConfirmQuote] clear quote_reopened failed:', e);
          }
        }
        const total = items.length;
        const settledCount = items.filter(isSettled).length;
        const unavailableCount = items.filter(i => i.status === 'unavailable').length;
        manualOutcome = { priced: pricedItems.length, unavailable: unavailableCount, total };
        const manualStatus = total > 0 && settledCount >= total
          ? 'confirmed'
          : (pricedItems.length > 0 ? 'partially_confirmed' : nextStatus);
        if (manualStatus !== list?.status) {
          try {
            await updateProvisioningList(id, { status: manualStatus });
          } catch (e) {
            console.error('[ProvisioningBoardDetail] manual confirm status update failed:', e);
          }
        }
        nextStatus = manualStatus;
      }
      setList(prev => ({ ...prev, status: nextStatus }));
      // Tell the kanban (and any other surface that lists this
      // board) to refresh — otherwise the chief navigates back to
      // the index and sees stale "QUOTE IN" on a now-confirmed board.
      try { window.dispatchEvent(new Event('provisioning-list-status-changed')); } catch { /* noop */ }
      // Honest signal if the per-line accepts worked but the list
      // status update was blocked (RLS, etc.). Toast still reads
      // "confirmed" because the line state DID land server-side;
      // only the board-level rollup needs follow-up.
      if (result?.listStatusUpdateError) {
        console.warn('[ProvisioningBoardDetail] list status not persisted:', result.listStatusUpdateError);
        showToast(
          'Lines confirmed — board status may take a moment to update. Refresh if it stays at "Quote in".',
          'info',
        );
      } else if (manualOutcome) {
        // Manual board: phrase the rollup in items, not Cargo orders.
        const { priced, unavailable, total } = manualOutcome;
        const unavailNote = unavailable > 0 ? ` (${unavailable} unavailable)` : '';
        const msg = (priced + unavailable) >= total
          ? `Quote confirmed — all ${total} item${total === 1 ? '' : 's'} settled${unavailNote}`
          : `Quote confirmed — ${priced} of ${total} items confirmed${unavailNote}, others still awaiting a quote`;
        showToast(msg, 'success');
      } else {
        const msg = result?.listFullyConfirmed
          ? 'Quote confirmed — supplier notified'
          : `Quote confirmed — ${result?.ordersConfirmed || 0} order${result?.ordersConfirmed === 1 ? '' : 's'} confirmed, others still waiting on quotes`;
        showToast(msg, 'success');
      }
      setConfirmQuoteModalOpen(false);
      // Manual quote (a file was uploaded, not a Cargo-supplier portal
      // confirm)? Offer to email the supplier a confirmation. Resolve a
      // best-effort default recipient from the board's supplier link;
      // the modal lets the chief edit it before sending.
      if (list?.quote_file_url) {
        const supplierProfileId = items.find(i => i.supplier_profile_id)?.supplier_profile_id || null;
        const defaultEmail = supplierProfileId
          ? await fetchSupplierContactEmail(supplierProfileId).catch(() => null)
          : null;
        // Scope the email to the items actually carrying a quote (the
        // ones just confirmed) so a partial confirm doesn't overstate
        // the count / total with still-unquoted lines.
        const disp = displayCurrency || 'GBP';
        const scopeItems = pricedItems.length > 0 ? pricedItems : items;
        const scopeTotal = scopeItems.reduce((s, i) => {
          const iCurr = i.currency || (list?.currency || 'GBP');
          return s + effectiveOrderedQty(i)
            * ((effectiveCost(i) / (fxRates[iCurr] || 1)) * (fxRates[disp] || 1));
        }, 0);
        setConfirmEmailPrompt({
          defaultEmail: defaultEmail || '',
          quotedTotal: scopeTotal > 0 ? formatCurrency(scopeTotal, disp) : '',
          itemCount: scopeItems.length,
        });
      }
    } catch (err) {
      console.error('[ProvisioningBoardDetail] runConfirmQuote failed:', err);
      showToast(`Could not confirm: ${err.message || err}`, 'error');
    } finally {
      setConfirmingQuote(false);
    }
  };

  // ── Style constants ───────────────────────────────────────────────────────

  // Dept chip palette — single source of truth is the
  // `public.departments.color` hex set in the
  // 20260617130000_departments_color_editorial_repalette migration.
  // Resolved by name from the live `departments` array so per-tenant
  // overrides (Studio edits) flow through automatically.
  //
  // bg = the dept colour at 12% alpha for a soft tint; text colour
  // stays the full dept hex so it reads with conviction against the
  // tinted bg. Fallback for unknown dept names is the cool
  // border-soft / muted ink pair.
  const getDeptChip = (deptName) => {
    const match = departments.find(d => d.name === deptName);
    const color = match?.color;
    if (!color) return { bg: '#EEF0F4', color: '#7C7E9B' };
    return { bg: hexToRgba(color, 0.12), color };
  };

  // Per-row item-status pill palette comes from the unified statusConfig.
  // getItemStatusConfig(status).badge yields {bg, color, border, dot}; label
  // is sibling. Single pill per row — the supplier-response and order-
  // financial states are folded into the same render path via the derive
  // function (Phase 3 commit 4). No more SUPPLIER_BADGE swap.

  const STATUS_HERO_COLOR = {
    draft:                        { dot: '#F59E0B', text: '#F59E0B' },
    pending_approval:             { dot: '#4A90E2', text: '#4A90E2' },
    sent_to_supplier:             { dot: '#3B82F6', text: '#3B82F6' },
    partially_delivered:          { dot: '#F59E0B', text: '#F59E0B' },
    delivered_with_discrepancies: { dot: '#EF4444', text: '#EF4444' },
    delivered:                    { dot: '#22C55E', text: '#15803D' },
  };

  // cols: check | item | category | size | unit | qty | unit cost | total | status | actions
  // Column widths. Notes sits between Category and Size in the
  // full grid, and right after Item in the no-cat grid. Free-form
  // so it gets the second-biggest minmax after Item.
  const TABLE_GRID_FULL   = '36px minmax(180px,1.5fr) minmax(110px,0.8fr) minmax(150px,1.2fr) 76px 70px 92px 90px 80px 56px 56px';
  // cols: check | item | size | unit | qty | unit cost | total | status | actions  (category dropped)
  const TABLE_GRID_NO_CAT = '36px minmax(180px,1.5fr) minmax(150px,1.2fr) 76px 70px 92px 90px 80px 56px 56px';
  const TABLE_GRID = groupBy === 'category' ? TABLE_GRID_NO_CAT : TABLE_GRID_FULL;

  const CURR_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };
  const currSymbol = CURR_SYMBOLS[list?.currency] || '£';
  const dispCurr = displayCurrency || currency;
  const dispSymbol = CURR_SYMBOLS[dispCurr] || '£';

  // ── Additional computed values ────────────────────────────────────────────

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
  // Subtitle is intentionally empty — operational state (status, allergens)
  // moves to chips that sit between the headline and the toolbar, so the
  // headline reads as identity, not state. Status used to live here.
  // Empty string (not null) so EditorialHeadline's `??` fallback to the
  // generic Pantry greeting doesn't fire.
  const editorialSubtitle = '';
  // Meta strip carries the identity context: trip type (Charter/Owner/…),
  // trip name, date range, guest count. Replaces the prior strip that only
  // held trip name and forced status to sit awkwardly in the subtitle.
  const tripGuestCount = Array.isArray(trip?.guests)
    ? (trip.guests.filter(g => g.isActive).length || trip.guests.length)
    : 0;
  const formatRangeDate = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
  };
  const tripStart = formatRangeDate(trip?.startDate);
  const tripEnd = formatRangeDate(trip?.endDate);
  const tripDateLabel = tripStart && tripEnd
    ? (tripStart === tripEnd ? tripStart : `${tripStart} – ${tripEnd}`)
    : (tripStart || tripEnd || null);
  // Drop placeholder trip names ("New", "Untitled", "New Trip") so they
  // don't pollute the meta strip — they're default labels from the trip
  // form, not real identifiers.
  const rawTripName = trip?.title || trip?.name || '';
  const PLACEHOLDER_TRIP_NAMES = new Set(['NEW', 'NEW TRIP', 'UNTITLED', 'UNTITLED TRIP', 'UNNAMED', 'UNNAMED TRIP']);
  const meaningfulTripName = rawTripName && !PLACEHOLDER_TRIP_NAMES.has(rawTripName.trim().toUpperCase())
    ? rawTripName
    : null;
  const editorialMeta = [
    trip?.tripType && { label: String(trip.tripType).toUpperCase() },
    meaningfulTripName && { label: meaningfulTripName },
    tripDateLabel && { label: tripDateLabel },
    tripGuestCount > 0 && { label: `${tripGuestCount} GUEST${tripGuestCount !== 1 ? 'S' : ''}` },
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
      <div className="editorial-page pv-dashboard">

        <EditorialPageShell
          title={editorialHeadline}
          qualifier={editorialQualifier}
          subtitle={editorialSubtitle}
          meta={editorialMeta}
          backTo="/provisioning"
          backLabel="Back to boards"
          showDuty={false}
          bodyBg="#F8FAFC"
          rightRail={
            // Option-B split header: ribbon moves to the right rail as a
            // vertical action stack. Read actions (Add from… / Print-PDF)
            // above write actions (Receive Items / Send to Supplier /
            // Submit for Approval / ⋯). Send to Supplier is the lone
            // "primary" action — filled navy when hasSendableItems holds.
            // ⋯ sits on the same row as Submit for Approval, to its left.
            <div className="cargo-ribbon cargo-ribbon-vertical">
              {/* Read actions */}
              <div className="cargo-ribbon-group">
                {/* "Add from…" opens the bulk-import picker over four
                    sources (Suggestions / Past orders / Catalogue /
                    Frequent). Echoes the wizard's "Build from…" so the
                    parallelism is clear: this is the picker over external
                    sources, not the per-lane fast inline add. */}
                <button
                  type="button"
                  onClick={() => setAddItemsOpen(true)}
                  className="cargo-ribbon-btn"
                >
                  <Icon name="LayoutGrid" style={{ width: 13, height: 13 }} /> Add from…
                </button>
                {/* Captures the rendered board with html2canvas and
                    embeds the resulting tall image into a paginated
                    jsPDF, then opens the PDF in a new tab via a
                    blob URL. The chief gets the editorial page they
                    see on screen — typography, chips, spacing —
                    inside a real PDF viewer with proper save /
                    print / orientation controls (the browser's
                    print dialog hides orientation behind "More
                    settings", which is what kicked this off). */}
                <button
                  type="button"
                  onClick={() => openBoardPdf().catch((err) => {
                    console.error('[BoardPdf] export failed:', err);
                    window.alert('Could not generate the PDF. Try again, or check the browser console.');
                  })}
                  className="cargo-ribbon-btn"
                  title="Open a PDF of the board in a new tab"
                >
                  <Icon name="Printer" style={{ width: 13, height: 13 }} /> Print / PDF
                </button>
              </div>

              {/* Write actions — workflow order top→bottom: Submit for
                  Approval → Send to Supplier → Receive Items. Submit
                  starts the cycle (draft/pending only), Send dispatches
                  to the supplier, Receive closes it when goods land. */}
              <div className="cargo-ribbon-group">
                {canSubmitForApproval && (
                  // No-approver path: when the caller's tier doesn't
                  // require approval (per-vessel routing toggle in
                  // Vessel Settings → Provisioning), the chief acts
                  // as their own approver via "Confirm quote" —
                  // fires the same approveAllQuotes flow without
                  // going through the request-decide cycle.
                  quoteDecisionStage && confirmQuoteAllowed ? (
                    <button
                      type="button"
                      onClick={handleConfirmQuoteWithoutApprover}
                      className="cargo-ribbon-btn"
                      disabled={confirmingQuote}
                      title={hasManualQuote
                        ? 'Confirm the quote yourself — locks the board at the quoted prices, then you can email the supplier.'
                        : 'No approver configured — confirm the quote yourself. Locks all lines and notifies the supplier.'}
                    >
                      <Icon name="CheckCircle" style={{ width: 13, height: 13 }} />
                      {confirmingQuote ? 'Confirming…' : 'Confirm quote'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmitForApproval}
                      className="cargo-ribbon-btn"
                      title={quoteDecisionStage
                        ? 'Quote attached — submit for approval at the quoted prices'
                        : undefined}
                    >
                      <Icon name="Send" style={{ width: 13, height: 13 }} />
                      {quoteDecisionStage ? 'Submit quote for approval' : 'Submit for Approval'}
                    </button>
                  )
                )}
                {/* When current user is the assigned approver of a
                    pending request, the Send to Supplier slot is
                    swapped for the two decision buttons. Once they
                    decide the board returns to draft, the request
                    flips to approved/changes_requested, and this slot
                    reverts to Send to Supplier. */}
                {approvalRequest?.status === 'pending'
                  && approvalRequest?.approver_id === user?.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => { setDecisionComment(''); setDecisionModal('request_changes'); }}
                      className="cargo-ribbon-btn"
                    >
                      <Icon name="AlertTriangle" style={{ width: 13, height: 13 }} /> Request changes
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDecisionComment(''); setDecisionModal('approve'); }}
                      disabled={deciding}
                      className="cargo-ribbon-btn"
                    >
                      <Icon name="Check" style={{ width: 13, height: 13 }} /> Approve
                    </button>
                  </>
                ) : canSendToSupplier && (
                  <button
                    type="button"
                    onClick={handleSendToSupplier}
                    disabled={!hasSendableItems}
                    className="cargo-ribbon-btn"
                    title={!hasSendableItems ? 'Add items to the board before sending' : undefined}
                  >
                    <Icon name="Send" style={{ width: 13, height: 13 }} /> Send to Supplier
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(true)}
                  className="cargo-ribbon-btn"
                >
                  <Icon name="PackageCheck" style={{ width: 13, height: 13 }} /> Receive Items
                </button>
              </div>
            </div>
          }
          headerExtra={
            // Left column carries the chip row AND the tabs row so the
            // column extends down to the tabs hairline. With the ribbon's
            // `align-self: flex-end` on the right, this lands the bottom
            // button (Send to Supplier) on the same baseline as the tabs.
            // ⋯ and Submit for Approval sit between the tabs and the
            // ribbon stack on that same baseline.
            <>
            <div className="pv-board-chip-row">
              {statusLabel && (() => {
                // Status chip palette per board state. Pending review +
                // quote-in are the "needs attention" colours (warm cream),
                // post-shipping states use a quieter cool tint.
                const STATUS_CHIP_PALETTE = {
                  draft:                        { bg: '#F1F5F9', fg: '#475569', label: 'DRAFT' },
                  pending_approval:             { bg: '#FEF3C7', fg: '#92400E', label: 'PENDING APPROVAL' },
                  quote_received:               { bg: '#FFEDD5', fg: '#9A3412', label: 'QUOTE IN' },
                  confirmed:                    { bg: '#DCFCE7', fg: '#166534', label: 'CONFIRMED' },
                  partially_confirmed:          { bg: '#FEF3C7', fg: '#92400E', label: 'PARTIALLY CONFIRMED' },
                  sent_to_supplier:             { bg: '#DBEAFE', fg: '#1E40AF', label: 'SENT TO SUPPLIER' },
                  partially_delivered:          { bg: '#FEF3C7', fg: '#92400E', label: 'PARTIALLY DELIVERED' },
                  delivered_with_discrepancies: { bg: '#FEE2E2', fg: '#991B1B', label: 'DISCREPANCIES' },
                  delivered:                    { bg: '#D1FAE5', fg: '#065F46', label: 'DELIVERED' },
                };
                const cfg = STATUS_CHIP_PALETTE[list?.status] || { bg: '#FEF3C7', fg: '#92400E', label: statusLabel };
                return (
                  <span
                    className="pv-board-chip pv-board-chip-status"
                    style={{ background: cfg.bg, color: cfg.fg }}
                    data-status={list?.status || ''}
                  >
                    {cfg.label}
                  </span>
                );
              })()}
              {allergenGuests.length > 0 && (
                <div className="pv-board-chip-wrap" ref={allergenRef}>
                  <button
                    type="button"
                    className="pv-board-chip pv-board-chip-allergen"
                    aria-haspopup="dialog"
                    aria-expanded={allergenOpen}
                    onClick={() => setAllergenOpen(v => !v)}
                  >
                    <Icon name="AlertTriangle" style={{ width: 11, height: 11 }} aria-hidden="true" />
                    {allergenGuests.length} allergen{allergenGuests.length !== 1 ? 's' : ''}
                    <span aria-hidden="true" className="pv-board-chip-caret">{allergenOpen ? '▾' : '›'}</span>
                  </button>
                  {allergenOpen && (
                    <div className="pv-board-allergen-popover" role="dialog" aria-label="Allergen alert">
                      <div className="pv-board-allergen-popover-head">
                        <Icon
                          name="AlertTriangle"
                          style={{ width: 14, height: 14, color: 'var(--d-danger)', flexShrink: 0 }}
                          aria-hidden="true"
                          />
                          <span className="pv-board-allergen-popover-title">Allergen alert</span>
                        </div>
                        <div className="pv-board-allergen-popover-list">
                          {allergenGuests.map((g, i) => (
                            <div key={i} className="pv-board-allergen-popover-row">
                              <span className="pv-board-allergen-popover-name">{g.name}</span>
                              <span className="pv-board-allergen-popover-all">{g.allergies}</span>
                            </div>
                          ))}
                        </div>
                        <div className="pv-board-allergen-popover-foot">
                          Highlighted rows may be affected
                        </div>
                      </div>
                    )}
                  </div>
                )}
              {(() => {
                const totalItems = items.length;
                const receivedItems = items.filter(i => i.status === 'received').length;
                if (totalItems === 0) return null;
                const pct = receivedItems / totalItems;
                return (
                  <span className="pv-board-chip pv-board-chip-progress" title={`${receivedItems} of ${totalItems} items received`}>
                    <span className="pv-board-chip-progress-num">{receivedItems} / {totalItems}</span>
                    <span className="pv-board-chip-progress-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></span>
                    received
                  </span>
                );
              })()}
              {/* Note from supplier — pulses while there are
                  unseen supplier actions (sub / unavail / note) on
                  any line of any linked order. Mirrors the Note
                  from approver chip's anatomy + pulse keyframe.
                  Click opens a popover listing the actions; opening
                  marks the chip seen, pulse stops until the
                  supplier touches the order again. */}
              {supplierNoteActions.length > 0 && (
                <div className="pv-board-chip-wrap" ref={supplierNotesRef}>
                  <button
                    type="button"
                    className={[
                      'pv-board-chip',
                      'pv-board-chip-note',
                      'pv-board-chip-note-changes',
                      supplierNotesUnread ? 'is-unread' : null,
                    ].filter(Boolean).join(' ')}
                    onClick={handleSupplierNotesToggle}
                    aria-haspopup="dialog"
                    aria-expanded={supplierNotesOpen}
                    title={supplierNotesUnread
                      ? `New supplier activity on ${supplierNoteActions.length} line${supplierNoteActions.length === 1 ? '' : 's'} — click to review`
                      : 'Note from supplier — review the supplier\'s actions on this order'}
                  >
                    <Icon name="MessageSquare" style={{ width: 11, height: 11 }} aria-hidden="true" />
                    Note from supplier
                    <span aria-hidden="true" className="pv-board-chip-caret">{supplierNotesOpen ? '▾' : '›'}</span>
                  </button>
                  {supplierNotesOpen && (
                    <div className="pv-board-supplier-popover" role="dialog" aria-label="Note from supplier">
                      <div className="pv-board-supplier-popover-head">
                        <Icon name="MessageSquare" style={{ width: 14, height: 14, color: '#C65A1A', flexShrink: 0 }} aria-hidden="true" />
                        <span className="pv-board-supplier-popover-title">Note from supplier</span>
                      </div>
                      <div className="pv-board-supplier-popover-list">
                        {supplierNoteActions.map((a) => {
                          const tagLabel = {
                            sub:       'Sub',
                            unavail:   'Unavailable',
                            note:      'Note',
                            qty:       'Qty',
                            unit:      'Unit',
                            size:      'Size',
                            confirmed: 'Confirmed',
                          }[a.kind] || 'Update';
                          return (
                            <div key={a.key} className="pv-board-supplier-popover-row">
                              <span className={`pv-board-supplier-popover-tag pv-board-supplier-popover-tag-${a.kind}`}>
                                {tagLabel}
                              </span>
                              <span className="pv-board-supplier-popover-body">
                                <strong>{a.item}</strong>
                                {a.kind === 'sub'       && (<> — <em>{a.text}</em></>)}
                                {a.kind === 'note'      && (<> — <em>"{a.text}"</em></>)}
                                {a.kind === 'qty'       && (<> — <span className="pv-board-supplier-popover-diff">{a.text}</span></>)}
                                {a.kind === 'unit'      && (<> — <span className="pv-board-supplier-popover-diff">{a.text}</span></>)}
                                {a.kind === 'size'      && (<> — <span className="pv-board-supplier-popover-diff">{a.text}</span></>)}
                                {a.kind === 'confirmed' && (<> — <span className="pv-board-supplier-popover-meta">{a.text}</span></>)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Two-link footer. "Jump to items" stays the
                          primary action — the chief usually wants to
                          act on the line. "View in history" is the
                          new audit trail entrypoint: prefills the
                          History tab's source filter to 'supplier'
                          so the resulting timeline is just the
                          back-and-forth with the supplier, not the
                          crew's own edits. */}
                      <div className="pv-board-supplier-popover-foot pv-board-supplier-popover-foot-split">
                        <button
                          type="button"
                          className="pv-board-supplier-popover-link"
                          onClick={() => {
                            setSupplierNotesOpen(false);
                            setActiveTab('items');
                            setTimeout(() => {
                              document.querySelector('[data-board-items-anchor]')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 50);
                          }}
                        >
                          Jump to items →
                        </button>
                        <button
                          type="button"
                          className="pv-board-supplier-popover-link pv-board-supplier-popover-link-secondary"
                          onClick={() => {
                            setSupplierNotesOpen(false);
                            setHistorySourceFilter('supplier');
                            setActiveTab('history');
                          }}
                        >
                          View in history →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {(() => {
                if (!approvalRequest) return null;
                const isApprover = approvalRequest.approver_id === user?.id;
                const isPending  = approvalRequest.status === 'pending';
                const isChanges  = approvalRequest.status === 'changes_requested';
                const isApproved = approvalRequest.status === 'approved';
                const hasComment = !!(approvalRequest.comment && approvalRequest.comment.trim());
                // Only show the chip for states the user cares about
                // post-decision: pending review, changes-requested, OR
                // approved-with-note. A bare "approved" with no
                // comment doesn't earn a chip — it's just the
                // happy-path return to draft.
                if (!isPending && !isChanges && !(isApproved && hasComment)) return null;
                const approverName = approverProfile?.full_name
                  || (approverProfile?.email ? approverProfile.email.split('@')[0] : 'reviewer');
                const submitterName = submitterProfile?.full_name
                  || (submitterProfile?.email ? submitterProfile.email.split('@')[0] : 'someone');
                const isReApproval = approvalRequest.prev_status === PROVISIONING_STATUS.QUOTE_RECEIVED;
                if (isPending) {
                  const pendingLabel = isApprover
                    ? (isReApproval ? 'Your quote review' : 'Your review')
                    : (isReApproval
                        ? `Quote review · ${approverName}`
                        : `Awaiting ${approverName}`);
                  const pendingTitle = isApprover
                    ? `Submitted by ${submitterName} — ${isReApproval ? 'quote review' : 'your review'}`
                    : `${isReApproval ? 'Awaiting quote review by ' : 'Awaiting review by '}${approverName}`;
                  return (
                    <span
                      className="pv-board-chip pv-board-chip-review"
                      title={pendingTitle}
                    >
                      <Icon name="Send" style={{ width: 11, height: 11 }} aria-hidden="true" />
                      {pendingLabel}
                    </span>
                  );
                }
                // Decided with a comment — render the chip as a
                // button that opens a popover with the full note.
                // `isApproved` paints navy/cream (positive); `isChanges`
                // paints terracotta/cream (action-required).
                if (isApproved || isChanges) {
                  // Pulse while the current viewer hasn't opened it
                  // — drops the moment they click. Approvers don't
                  // see the pulse on their own note (handled by the
                  // seen-state effect above).
                  const unread = !reviewNoteSeen;
                  const chipClass = [
                    'pv-board-chip',
                    'pv-board-chip-note',
                    isApproved ? 'pv-board-chip-note-approved' : 'pv-board-chip-note-changes',
                    unread ? 'is-unread' : null,
                  ].filter(Boolean).join(' ');
                  const label = isApproved
                    ? 'Note from approver'
                    : 'Changes requested';
                  const decidedAt = approvalRequest.decided_at
                    ? new Date(approvalRequest.decided_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : null;
                  return (
                    <div className="pv-board-chip-wrap" ref={reviewNoteRef}>
                      <button
                        type="button"
                        className={chipClass}
                        onClick={handleReviewNoteToggle}
                        aria-haspopup="dialog"
                        aria-expanded={reviewNoteOpen}
                      >
                        <Icon name={isApproved ? 'CheckCircle' : 'AlertTriangle'} style={{ width: 11, height: 11 }} aria-hidden="true" />
                        {label}
                        <span aria-hidden="true" className="pv-board-chip-caret">{reviewNoteOpen ? '▾' : '›'}</span>
                      </button>
                      {reviewNoteOpen && (
                        <div className="pv-board-review-popover" role="dialog" aria-label="Reviewer note">
                          <div className="pv-board-review-popover-head">
                            <Icon
                              name={isApproved ? 'CheckCircle' : 'AlertTriangle'}
                              style={{ width: 14, height: 14, color: isApproved ? 'var(--d-navy-deep)' : 'var(--d-orange)', flexShrink: 0 }}
                              aria-hidden="true"
                            />
                            <span className="pv-board-review-popover-title">
                              {isApproved ? 'Approved' : 'Changes requested'}
                              {' · '}
                              {approverName}
                            </span>
                          </div>
                          {hasComment ? (
                            <p className="pv-board-review-popover-body">"{approvalRequest.comment}"</p>
                          ) : (
                            <p className="pv-board-review-popover-body" style={{ color: 'var(--d-muted)' }}>No note from the approver.</p>
                          )}
                          {decidedAt && (
                            <div className="pv-board-review-popover-foot">
                              {decidedAt}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            <div className="pv-board-tabs-row">
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
            </div>
            {/* Toolbar lives INSIDE the header's left column so the
                column stretches all the way down to the toolbar's bottom
                hairline. With the right rail's `align-self: flex-end`,
                this lands the 5-button stack's bottom (Receive Items)
                on that same hairline — the "divide line" the stack rests
                on. */}
            <div className="pv-board-toolbar">
              <div className="pv-board-toolbar-left">
                <SelectionCheckbox
                  checked={allChecked}
                  onChange={toggleAll}
                  ariaLabel={allChecked ? 'Deselect all items in view' : 'Select all items in view'}
                />
                <div className="pv-board-search-wrap">
                  <Icon name="Search" className="pv-board-search-icon" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Search items…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pv-board-search-input"
                  />
                </div>
                <select
                  value={deptFilter}
                  onChange={e => setDeptFilter(e.target.value)}
                  className="pv-board-filter-select"
                  aria-label="Filter by department"
                >
                  <option value="all">All depts</option>
                  {departments.map(d => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="pv-board-filter-select"
                  aria-label="Filter by status"
                >
                  <option value="all">All statuses</option>
                  {ITEM_STATUS_FILTER_ORDER.map(val => {
                    const cfg = ITEM_STATUS_CONFIG[val];
                    return <option key={val} value={val}>{cfg.label}</option>;
                  })}
                </select>
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
                  className="pv-board-filter-select"
                  aria-label="Group items"
                >
                  <option value="category">Group: Category</option>
                  <option value="none">Group: None</option>
                </select>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setDeptFilter('all'); setStatusFilter('all'); }}
                    className="pv-board-clear-filters"
                  >
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowReceived(p => !p)}
                  className="pv-board-toggle"
                  aria-pressed={showReceived}
                >
                  <span className={`pv-board-toggle-track${showReceived ? ' is-on' : ''}`}>
                    <span className="pv-board-toggle-knob" />
                  </span>
                  <span className="pv-board-toggle-lbl">Show received</span>
                </button>
              </div>
              {/* ⋯ menu sits at the right edge of the toolbar — on the
                  divide-line baseline alongside Receive Items in the
                  right rail, but NOT inside the stack column. The 24px
                  gap to the stack keeps it visually independent. */}
              <div className="pv-board-tabs-more">
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
                    <div className="pv-board-menu" role="menu">
                      {canEdit && (
                        <button onClick={() => { setShowMenu(false); setShowEditModal(true); }} className="pv-board-menu-item">
                          <Icon name="Pencil" style={{ width: 14, height: 14 }} /> Edit Board
                        </button>
                      )}
                      <button onClick={() => { setShowMenu(false); setShowShareModal(true); }} className="pv-board-menu-item">
                        <Icon name="Users" style={{ width: 14, height: 14 }} /> Collaborators
                      </button>
                      <button onClick={handleDuplicate} className="pv-board-menu-item">
                        <Icon name="Copy" style={{ width: 14, height: 14 }} /> Duplicate
                      </button>
                      <button onClick={handleSaveAsTemplateBoard} className="pv-board-menu-item">
                        <Icon name="FileText" style={{ width: 14, height: 14 }} /> Save as Template
                      </button>
                      <div className="pv-board-menu-divider" />
                      <button
                        onClick={() => { setShowMenu(false); quoteFileInputRef.current?.click(); }}
                        className="pv-board-menu-item"
                        disabled={uploadingQuote}
                      >
                        <Icon name="Upload" style={{ width: 14, height: 14 }} />
                        {list?.quote_file_url
                          ? (uploadingQuote ? 'Uploading…' : 'Replace quote file')
                          : (uploadingQuote ? 'Uploading…' : 'Upload supplier quote')}
                      </button>
                      {list?.quote_file_url && (
                        <button
                          onClick={() => { setShowMenu(false); window.open(list.quote_file_url, '_blank', 'noopener'); }}
                          className="pv-board-menu-item"
                        >
                          <Icon name="FileText" style={{ width: 14, height: 14 }} />
                          View quote file
                        </button>
                      )}
                      {canDelete && (
                        <>
                          <div className="pv-board-menu-divider" />
                          <button onClick={handleDeleteBoard} className="pv-board-menu-item pv-board-menu-item-danger">
                            <Icon name="Trash2" style={{ width: 14, height: 14 }} /> Delete Board
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            </>
          }
        >

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

        {/* Toolbar (filter row) moved into headerExtra above so the right
            rail stack extends down to the toolbar's bottom hairline. */}

        {/* ── Items area ────────────────────────────────────────────────── */}
        {activeTab === 'items' && <div data-board-items-anchor style={{ padding: '24px 0 48px' }}>
          {/* Supplier-response banner — at-a-glance count of what the
              supplier has actioned since the order was sent. Hidden
              when nothing yet (pre-send boards stay clean). Click a
              segment to filter the list to just that status — a quick
              way to scan unavailables vs subs. */}
          {totalSupplierResponses > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', marginBottom: 12,
              background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8,
              fontSize: 13, color: '#334155',
            }}>
              <span>
                <strong style={{ color: '#0F172A' }}>Supplier responded</strong>
                {' — '}
                {supplierResponseCounts.confirmed > 0 && (
                  <span style={{ marginRight: 12 }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#5C9B6A', marginRight: 6, verticalAlign: 'middle' }} />
                    {supplierResponseCounts.confirmed} confirmed
                  </span>
                )}
                {supplierResponseCounts.substituted > 0 && (
                  <span style={{ marginRight: 12 }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#D4A24C', marginRight: 6, verticalAlign: 'middle' }} />
                    {supplierResponseCounts.substituted} substituted
                  </span>
                )}
                {supplierResponseCounts.unavailable > 0 && (
                  <span>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#C8553D', marginRight: 6, verticalAlign: 'middle' }} />
                    {supplierResponseCounts.unavailable} unavailable
                  </span>
                )}
              </span>
              <span style={{ fontSize: 11, color: '#64748B' }}>
                {totalSupplierResponses} of {Object.keys(itemStatusMap).length} lines
              </span>
            </div>
          )}
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
              {/* Master select-all moved inline into the toolbar
                  (left of search). Per-dept-group select-alls live
                  inside each dept-group's table header below. */}
              {deptGroups.map(({ dept, deptObj, items: deptItems }) => {
                const deptChip = getDeptChip(dept);
                const deptSubtotal = deptItems.reduce((acc, i) => {
                  const cost = effectiveCost(i);
                  const qty = effectiveOrderedQty(i);
                  const iCurr = i.currency || currency;
                  return acc + qty * ((cost / (fxRates[iCurr] || 1)) * (fxRates[dispCurr] || 1));
                }, 0);
                const allDeptSel = deptItems.length > 0 && deptItems.every(i => selectedItems.has(i.id));
                return (
                  <div key={dept} style={{ marginBottom: 24 }}>
                    {/* Dept header row — total lives only in the subtotal
                        row at the bottom of the section ("Total: $X") so
                        it doesn't show twice for the same dept. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ background: deptChip.bg, color: deptChip.color, fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 4, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
                        {dept}
                      </span>
                      <span style={{ fontSize: 11, color: '#CBD5E1', flexShrink: 0 }}>{deptItems.length} item{deptItems.length !== 1 ? 's' : ''}</span>
                      <div style={{ flex: 1, height: 1, background: '#F1F5F9' }} />
                    </div>

                    {/* White card table */}
                    <div style={{ background: 'white', border: '1px solid #F1F5F9', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      {/* Table header */}
                      <div style={{ display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px', background: '#FAFAFA', borderBottom: '1px solid #F1F5F9' }}>
                        {/* Selection header — dept-group scope only.
                            Toggles select-all for THIS dept's items.
                            Cross-dept select-all lives on the top-level
                            master above all dept-groups. Two states
                            only: empty (none OR partial of this dept
                            selected) and ticked (all of this dept's
                            items selected). No indeterminate dash —
                            see SelectionCheckbox comment at module
                            level. */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0' }}>
                          <SelectionCheckbox
                            checked={allDeptSel}
                            onChange={() => toggleDept(deptItems)}
                            ariaLabel={allDeptSel ? `Deselect all ${dept} items` : `Select all ${dept} items`}
                          />
                        </div>
                        {[
                          // Item column isn't sortable when items are
                          // already grouped by category — the per-group
                          // sort would re-order rows inside each
                          // category and read as inconsistent. Hide
                          // the arrow + drop the click target in that
                          // case; the column header stays as a plain
                          // label.
                          { label: 'Item',      key: groupBy === 'category' ? null : 'item', helpHint: 'item' },
                          ...(groupBy === 'category' ? [] : [{ label: 'Category', key: 'category', helpHint: 'category' }]),
                          // Notes column header carries a (?) hint
                          // that opens an editorial popover with
                          // examples — teaches the chief by example
                          // what kinds of prose belong in the cell
                          // (prep / packing / state / special) so
                          // they don't have to guess. Hint rendered
                          // by the helpHint prop below; the column
                          // itself isn't sortable.
                          { label: 'Notes',     key: null, helpHint: 'notes' },
                          { label: 'Size',      key: null, helpHint: 'size' },
                          { label: 'Unit',      key: null, helpHint: 'unit' },
                          { label: 'Qty',       key: 'qty' },
                          { label: 'Unit Cost', key: 'unit_cost' },
                          { label: 'Total',     key: 'total' },
                          { label: 'Status',    key: 'status', centered: true, helpHint: 'status' },
                          { label: '',          key: null },
                        ].map(({ label, key, centered, helpHint }, idx) => {
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
                                justifyContent: centered ? 'center' : 'flex-start',
                                gap: 4,
                                cursor: sortable ? 'pointer' : 'default',
                                userSelect: sortable ? 'none' : undefined,
                              }}
                            >
                              {label}
                              {helpHint && COLUMN_HELP_HINTS[helpHint] && (
                                <HelpHint
                                  title={COLUMN_HELP_HINTS[helpHint].title}
                                  width={COLUMN_HELP_HINTS[helpHint].width}
                                  align={COLUMN_HELP_HINTS[helpHint].align || 'start'}
                                >
                                  <HelpHintBuckets buckets={COLUMN_HELP_HINTS[helpHint].buckets} />
                                </HelpHint>
                              )}
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
                        const isHovered = hoveredRow === item.id;
                        const isEditing = editingCell?.itemId === item.id;
                        const allergen = isAllergenRisk(item);
                        const isReceived = item.status === 'received';
                        const dim = isReceived ? '#CBD5E1' : null;
                        const itemCurr = item.currency || currency;
                        const convertCost = (amt) => (parseFloat(amt) / (fxRates[itemCurr] || 1)) * (fxRates[dispCurr] || 1);
                        const showOriginal = itemCurr !== dispCurr;
                        const origSymbol = CURR_SYMBOLS[itemCurr] || '£';

                        // Supplier-order linkage — drives row-editability lock AND
                        // the supplier/financial inputs to the derive function.
                        const itemOrder = itemStatusMap[(item.name || '').toLowerCase().trim()];
                        // Lock the row for crew edits the moment the supplier
                        // has acted on the line — confirmed / substituted /
                        // unavailable all mean the supplier has committed to
                        // a response and the crew should no longer be quietly
                        // changing qty/unit/size/cost behind their back. The
                        // old board-level isSent gate left the row editable
                        // even AFTER the supplier confirmed, so a chief
                        // could change "3 box" to "5 box" and the supplier
                        // never knew. To request a change after a confirm,
                        // the chief now leaves a note for the supplier (see
                        // the note-pencil affordance on locked rows).
                        const supplierActed = itemOrder
                          && ['confirmed', 'substituted', 'unavailable'].includes(itemOrder.status);
                        // Manual quote-confirmed line — locked like a
                        // supplier-confirmed one (see isQuoteConfirmed).
                        const quoteConfirmed = isQuoteConfirmed(item);
                        const isLocked = (isSent && !!itemOrder) || supplierActed || quoteConfirmed;
                        // The crew lives at quote_in / quoting / confirming for
                        // most of the order's life — the board-level "sent"
                        // flag only flips after Receive Items. So we use the
                        // looser hasSupplierMatch flag for surfacing supplier
                        // values (price / qty diff / notes) and reserve
                        // isLocked for actual edit-locking.
                        const hasSupplierMatch = !!itemOrder;
                        // Pulse the cells the supplier just changed
                        // (qty / unit / size / note / sub) until the
                        // chief opens the "Note from supplier" chip
                        // popover — gives the eye something to land on
                        // when there are subtle revisions on a long
                        // board.
                        const rowUnseen = rowHasUnseenSupplier(itemOrder);
                        const pulseCls = rowUnseen ? ' pv-supplier-pulse' : '';
                        // Unified pill: derive across (item, supplier_order_item,
                        // supplier_order). Single source of truth — no SUPPLIER_BADGE
                        // swap, no displayBadge fork.
                        let derived = deriveDisplayStatus(item, itemOrder, itemOrder?.parentOrder);
                        // A manual quote-confirmed line reads as 'confirmed'
                        // (green) even without a supplier order — otherwise a
                        // locked line would still show a grey 'draft' dot.
                        if (quoteConfirmed && (derived === 'draft' || derived === 'ordered')) {
                          derived = 'confirmed';
                        }
                        const derivedCfg = getItemStatusConfig(derived);
                        const badge = { ...derivedCfg.badge, label: derivedCfg.label };

                        return (
                          <div
                            key={item.id}
                            onMouseEnter={() => setHoveredRow(item.id)}
                            onMouseLeave={() => setHoveredRow(null)}
                            style={{
                              display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px',
                              // Locked (supplier-confirmed / substituted /
                              // unavailable, or sent) lines get a soft field
                              // tint so settled work recedes as a group and
                              // the still-actionable rows read as white.
                              background: allergen ? '#FFFBEB' : isHovered ? '#FAFCFF' : (isLocked ? '#FAFAF8' : 'white'),
                              borderBottom: rowIdx < totalRows - 1 ? '1px solid #F8FAFC' : 'none',
                              transition: 'background 0.1s',
                              opacity: (isLocked && itemOrder.status === 'unavailable') || item.status === 'unavailable' ? 0.7 : 1,
                            }}
                          >
                            {/* Selection checkbox (pure select — no
                                side effects). The received state still
                                renders a non-interactive ✓ as a visual
                                marker so the row reads as completed.
                                "Mark received" verb lives on the bulk
                                action bar. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0' }}>
                              {item.status === 'received' ? (
                                <Icon name="CheckCircle" style={{ width: 13, height: 13, color: '#4ADE80' }} />
                              ) : (
                                <SelectionCheckbox
                                  checked={selectedItems.has(item.id)}
                                  onChange={() => toggleItem(item.id)}
                                  ariaLabel={`Select ${item.name || 'item'}`}
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
                                        color: (itemOrder?.status === 'unavailable' || item.status === 'unavailable') ? '#94A3B8' : dim || '#0F172A',
                                        fontWeight: 500, cursor: 'default', lineHeight: 1.3,
                                        textDecoration: (itemOrder?.status === 'unavailable' || item.status === 'unavailable') ? 'line-through' : 'none',
                                      }}
                                    >
                                      {item.name}
                                    </span>
                                    {/* Inline SENT / Confirmed / Unavailable / Substituted
                                        tag removed in Phase 3 commit 4 — the unified status
                                        column carries this signal directly via the derived
                                        pill (no more duplicated supplier-response readout). */}
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
                              {hasSupplierMatch && itemOrder?.status === 'substituted' && itemOrder.substitution && (
                                <span className={`pv-supplier-diff${pulseCls}`} style={{ fontSize: 11, color: '#C65A1A', fontWeight: 600, paddingLeft: 6, marginTop: 2, display: 'inline-block' }}>
                                  Sub: {itemOrder.substitution}{itemOrder.subPrice ? ` (${itemOrder.subPrice})` : ''}
                                </span>
                              )}
                              {hasSupplierMatch && itemOrder?.hasNote && (
                                <span className={`pv-supplier-note${pulseCls}`} style={{
                                  fontSize: 11,
                                  fontStyle: 'italic',
                                  color: '#6B6F7A',
                                  paddingLeft: 6,
                                  marginTop: 2,
                                  letterSpacing: '0.005em',
                                  display: 'inline-block',
                                }}>
                                  “{itemOrder.supplierNote}”
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
                            {/* Notes — free-form prose for the supplier
                                brief (prep / packing / state / special).
                                Inline-editable until the supplier has
                                acted on the line; then becomes muted
                                read-only text. Empty state shows a
                                light placeholder so the cell still
                                reads as clickable. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {isReceived || supplierActed
                                ? <span style={{ fontSize: 12, fontStyle: 'italic', color: dim || (isLocked ? '#94A3B8' : '#6B6F7A'), letterSpacing: '0.005em', lineHeight: 1.4 }}>
                                    {item.notes || <span style={{ color: '#CBD5E1', fontStyle: 'normal' }}>-</span>}
                                  </span>
                                : <AlwaysEditCell
                                    value={item.notes ?? ''}
                                    placeholder="e.g. Skin on, pin boned, 1 per bag…"
                                    onSave={v => handleCellSave(item, 'notes', v)}
                                    inputStyle={{ fontSize: 12, color: '#0F172A', fontStyle: 'italic', letterSpacing: '0.005em' }}
                                  />
                              }
                            </div>
                            {/* Size — once the item lives inside a supplier
                                order, show the supplier's size with a
                                struck-through original when they overrode
                                the crew's ask. Editable only when no
                                supplier match exists yet. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {isReceived || supplierActed
                                ? (
                                    itemOrder?.sizeChanged
                                      ? (
                                          <span style={{ fontSize: 12 }}>
                                            <span style={{ textDecoration: 'line-through', color: '#9CA3AF', marginRight: 4 }}>{itemOrder.requestedSize}</span>
                                            <span className={`pv-supplier-diff${pulseCls}`} style={{ color: '#C65A1A', fontWeight: 700 }}>{itemOrder.size}</span>
                                          </span>
                                        )
                                      : <span style={{ fontSize: 12, color: dim || (isLocked ? '#94A3B8' : undefined) }}>{itemOrder?.size || item.size || ''}</span>
                                  )
                                : <AlwaysEditCell value={item.size ?? ''} placeholder="e.g. 750ml" onSave={v => handleCellSave(item, 'size', v)} inputStyle={{ fontSize: 12, color: '#0F172A' }} />
                              }
                            </div>
                            {/* Unit — same strikethrough treatment as Size. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {isReceived || supplierActed
                                ? (
                                    itemOrder?.unitChanged
                                      ? (
                                          <span style={{ fontSize: 11 }}>
                                            <span style={{ textDecoration: 'line-through', color: '#9CA3AF', marginRight: 4 }}>{itemOrder.requestedUnit}</span>
                                            <span className={`pv-supplier-diff${pulseCls}`} style={{ color: '#C65A1A', fontWeight: 700 }}>{itemOrder.unit}</span>
                                          </span>
                                        )
                                      : <span style={{ fontSize: 11, color: dim || (isLocked ? '#94A3B8' : undefined) }}>{itemOrder?.unit || item.unit || 'each'}</span>
                                  )
                                : <select value={item.unit || 'each'} onChange={e => handleCellSave(item, 'unit', e.target.value)} style={{ fontSize: 11, color: '#64748B', background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, width: '100%' }}>
                                    {PROVISION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                              }
                            </div>
                            {/* Qty — strikethrough requested_quantity next to
                                the supplier's actual quantity when it
                                differs. Editable only when no supplier
                                match exists yet. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px', gap: 3 }}>
                              {isReceived || supplierActed
                                ? (
                                    itemOrder?.qtyChanged
                                      ? (
                                          <span style={{ fontSize: 13, minWidth: 18, textAlign: 'center' }}>
                                            <span style={{ textDecoration: 'line-through', color: '#9CA3AF', marginRight: 4 }}>{itemOrder.requestedQuantity}</span>
                                            <span className={`pv-supplier-diff${pulseCls}`} style={{ color: '#C65A1A', fontWeight: 700 }}>{itemOrder.quantity}</span>
                                          </span>
                                        )
                                      : <span style={{ fontSize: 13, color: dim || (isLocked ? '#94A3B8' : undefined), minWidth: 18, textAlign: 'center' }}>{itemOrder?.quantity ?? item.quantity_ordered ?? '-'}</span>
                                  )
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
                            {/* Unit Cost — once the item lives in a supplier
                                order with a confirmed/quoted price, the
                                chief sees the supplier's figure (agreed >
                                quoted). Before any supplier match, the
                                row's estimate stays editable. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px', gap: 3 }}>
                              <span style={{ fontSize: 11, color: dim || '#94A3B8', flexShrink: 0 }}>{origSymbol}</span>
                              {item.quoted_unit_cost != null
                                // A manual quote has been APPLIED — it wins over
                                // any supplier/estimate figure (explicit chief
                                // action). Show the quoted price (editable, bold)
                                // on its own so the actual cost stays readable in
                                // the narrow column. The prior price is surfaced
                                // on hover (the before/after variance lives in the
                                // quote review modal, where there's room).
                                ? (() => {
                                    const sp = itemOrder?.supplierPrice;
                                    const prior = (sp != null && Number(sp) > 0)
                                      ? Number(sp)
                                      : (item.estimated_unit_cost != null ? Number(item.estimated_unit_cost) : null);
                                    const priorTitle = (prior != null && prior !== Number(item.quoted_unit_cost))
                                      ? `Quoted price · was ${origSymbol}${prior.toFixed(2)}`
                                      : 'Quoted price';
                                    return (
                                      <span title={priorTitle} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                        <AlwaysEditCell value={item.quoted_unit_cost ?? ''} placeholder="0.00" type="number" onSave={v => handleCellSave(item, 'quoted_unit_cost', v)} inputStyle={{ fontSize: 13, color: '#0F172A', textAlign: 'right', fontWeight: 700 }} />
                                      </span>
                                    );
                                  })()
                                : isReceived || supplierActed
                                  ? (() => {
                                      const supplierPrice = itemOrder?.supplierPrice;
                                      if (supplierPrice != null && Number(supplierPrice) > 0) {
                                        return (
                                          <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 700 }}>
                                            {Number(supplierPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        );
                                      }
                                      return <span style={{ fontSize: 13, color: dim || (isLocked ? '#94A3B8' : undefined) }}>{item.estimated_unit_cost ?? ''}</span>;
                                    })()
                                  : <AlwaysEditCell value={item.estimated_unit_cost ?? ''} placeholder="0.00" type="number" onSave={v => handleCellSave(item, 'estimated_unit_cost', v)} inputStyle={{ fontSize: 13, color: '#0F172A', textAlign: 'right' }} />
                              }
                            </div>
                            {/* Total — supplier's confirmed price × supplier's
                                (possibly overridden) qty when a match exists
                                and carries a price. Falls back to crew's
                                pre-send estimate × crew qty otherwise. */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {(() => {
                                // An applied manual quote wins over the supplier
                                // figure (matches effectiveCost + the Unit Cost
                                // cell), so the Total reflects what the chief
                                // just applied.
                                if (item.quoted_unit_cost != null && Number(item.quoted_unit_cost) > 0) {
                                  const qty = Number(item.quantity_ordered) || 0;
                                  const total = qty * convertCost(Number(item.quoted_unit_cost));
                                  return <span style={{ fontSize: 13, color: dim || '#0F172A', fontWeight: 600 }}>{dispSymbol}{total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
                                }
                                const supplierPrice = itemOrder?.supplierPrice;
                                const supplierQty = itemOrder?.quantity;
                                if (hasSupplierMatch && supplierPrice != null && Number(supplierPrice) > 0) {
                                  const qty = Number(supplierQty ?? item.quantity_ordered) || 0;
                                  const total = qty * convertCost(Number(supplierPrice));
                                  return <span style={{ fontSize: 13, color: dim || '#0F172A', fontWeight: 600 }}>{dispSymbol}{total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
                                }
                                const qty = parseFloat(item.quantity_ordered);
                                // Effective cost: quoted price when a manual
                                // quote was applied, else the estimate.
                                const cost = effectiveCost(item);
                                return !isNaN(qty) && cost > 0
                                  ? <span style={{ fontSize: 13, color: dim || '#0F172A', fontWeight: 500 }}>{dispSymbol}{(qty * convertCost(cost)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  : <span style={{ fontSize: 13, color: dim || '#CBD5E1' }}>-</span>;
                              })()}
                            </div>
                            {/* Status — bare coloured dot, no pill, no
                                border. Full label lives in the hover
                                tooltip. Editable variant overlays an
                                invisible native <select> on top of the
                                dot so clicking the dot opens the picker
                                without any visible chrome. Centered so
                                the dot sits directly under the "STATUS"
                                header above. */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '11px 8px' }}>
                              {/* Lock glyph on committed lines — an explicit,
                                  colour-independent "this is settled, don't
                                  edit or re-send" cue that pairs with the row
                                  tint. Shown whenever the row is edit-locked
                                  (supplier confirmed / substituted /
                                  unavailable, or the order's been sent). */}
                              {isLocked && (
                                <span
                                  title={supplierActed
                                    ? 'Locked — the supplier has committed to this line. Add a note to request a change.'
                                    : 'Locked — this line is quote-confirmed. It can’t be edited or re-sent.'}
                                  style={{ display: 'inline-flex', color: '#AEB4C2' }}
                                >
                                  <Icon name="Lock" style={{ width: 11, height: 11 }} />
                                </span>
                              )}
                              {/* Read-only status indicator. Status is now
                                  changed via the selection bar's "Set status"
                                  control, not an inline picker. */}
                              <span
                                title={badge.label}
                                aria-label={badge.label}
                                style={{
                                  display: 'inline-block',
                                  width: 10, height: 10,
                                  borderRadius: '50%',
                                  background: badge.dot,
                                }}
                              />
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
                              {/* Reopen — appears on confirmed / substituted /
                                  unavailable lines so the chief can ask the
                                  supplier to revise after they've committed.
                                  Click → confirm dialog → status drops back
                                  to pending, substitute_description cleared,
                                  and a 'line_reopened' activity event fires
                                  so the supplier sees a clear marker on
                                  their order detail. */}
                              {isHovered && supplierActed && (
                                <button
                                  onClick={() => handleReopenLine(item, itemOrder)}
                                  title="Reopen for changes — supplier will be notified"
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#94A3B8' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#FBEFE9'; e.currentTarget.style.color = '#C65A1A'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
                                >
                                  <Icon name="RotateCcw" style={{ width: 12, height: 12 }} />
                                </button>
                              )}
                              {/* Manual quote-confirmed line — reopen with no
                                  supplier to notify. Shown on hover for locked
                                  manual lines (quote-confirmed, not on a
                                  supplier order). */}
                              {isHovered && quoteConfirmed && !supplierActed && (
                                <button
                                  onClick={() => handleReopenManualLine(item)}
                                  title="Reopen for changes — unlocks the line, keeps its quoted price"
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#94A3B8' }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#FBEFE9'; e.currentTarget.style.color = '#C65A1A'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
                                >
                                  <Icon name="RotateCcw" style={{ width: 12, height: 12 }} />
                                </button>
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
                            // Editorial category header: neutral cool bg + slim
                            // 2px dept-coloured rail on the left so we still
                            // signal grouping at a glance, without bleeding the
                            // dept palette into the text. Names, subtotals, and
                            // chevrons render in the navy/muted system used
                            // everywhere else.
                            const railColor = getDepartmentColor(deptObj);
                            const key = `${dept}::${category}`;
                            const isCollapsed = collapsedCategories.has(key);
                            const subtotal = catItems.reduce((sum, i) => {
                              const cost = effectiveCost(i);
                              const qty  = effectiveOrderedQty(i);
                              const iCurr = i.currency || currency;
                              return sum + qty * ((cost / (fxRates[iCurr] || 1)) * (fxRates[dispCurr] || 1));
                            }, 0);
                            const sortedRows = sortItems(catItems);

                            return (
                              <React.Fragment key={key}>
                                <div
                                  onClick={() => toggleCategory(key)}
                                  style={{
                                    background: '#FAFBFC',
                                    borderLeft: `2px solid ${railColor}`,
                                    padding: '10px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    borderTop: '1px solid #F1F5F9',
                                    transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#F1F4F8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = '#FAFBFC'; }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ color: 'var(--d-muted-soft)', fontSize: 12 }}>{isCollapsed ? '▸' : '▾'}</span>
                                    <span style={{ color: 'var(--d-navy-deep)', fontWeight: 600, fontSize: 13 }}>{category}</span>
                                    <span style={{ fontSize: 11, color: 'var(--d-muted)', letterSpacing: '0.04em' }}>
                                      {catItems.length} {catItems.length === 1 ? 'item' : 'items'}
                                    </span>
                                  </div>
                                  <span style={{ color: 'var(--d-navy-deep)', fontWeight: 600, fontSize: 13, fontFamily: "'Outfit', system-ui, sans-serif", letterSpacing: '0.02em' }}>
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

                      {/* Subtotal row — the sole place this dept's total
                          renders. Mirrors the category header's flex
                          space-between layout so the figure on the right
                          sits at exactly the same x as each category's
                          per-section total above (e.g. Beer & Cider · $63
                          → 3 items · TOTAL · $90 directly underneath). */}
                      <div style={{ padding: '8px 16px', background: '#FAFAFA', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, color: '#94A3B8' }}>{deptItems.length} item{deptItems.length !== 1 ? 's' : ''}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748B' }}>Total</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>{dispSymbol}{deptSubtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
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

                // Phase Y — DeliveryBatchCard extraction. Header row migrated to
                // the shared component (same chrome + typography as the standalone
                // Delivered page). Body slot stays page-specific: items grid +
                // payment status per row + invoice button in the header's right
                // slot. See components/DeliveryBatchCard.jsx for the shared shape.
                const isCargo = supplierName && supplierName !== 'Manual receive';
                const accentBorder = isCargo ? '#378ADD' : '#1D9E75';
                const chipBg = isCargo ? 'rgba(55,138,221,0.12)' : 'rgba(30,158,117,0.12)';
                const chipFg = isCargo ? '#185FA5' : '#0F6E56';
                const metaParts = [
                  receivedAt ? new Date(receivedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                  receivedByName ? `Received by ${receivedByName}` : null,
                  `${batchItems.length} item${batchItems.length !== 1 ? 's' : ''}`,
                  batchTotalStr,
                ].filter(Boolean);

                const rightSlot = invoiceData ? (
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
                ) : null;

                return (
                  <DeliveryBatchCard
                    key={batchId || supplierName + receivedAt}
                    supplierName={displaySupplier}
                    sourceLabel={isCargo ? 'Delivery' : 'Manual'}
                    sourceChipBg={chipBg}
                    sourceChipFg={chipFg}
                    accentBorder={accentBorder}
                    metaParts={metaParts}
                    rightSlot={rightSlot}
                  >
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
                  </DeliveryBatchCard>
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
              // Normalize each merged event into a render-ready entry
              // (tag, source, dot colour, optional diff). Sort newest
              // first so the filter pills can slice the list without
              // re-deriving the order.
              const allEntries = activityEvents.map(ev => {
                const m = getHistoryActionMeta(ev.action);
                return {
                  key: ev.id,
                  date: ev.createdAt ? new Date(ev.createdAt) : null,
                  dot: m.dot,
                  tag: m.tag,
                  source: m.source,
                  diff: formatHistoryDiff(ev.action, ev.meta),
                  summary: ev.summary || ev.action,
                  meta: ev.meta || {},
                  action: ev.action,
                  actorName: ev.actorName,
                  actorDepartment: ev.actorDepartment,
                };
              }).filter(e => e.date).sort((a, b) => b.date - a.date);

              const filteredEntries = historySourceFilter === 'all'
                ? allEntries
                : allEntries.filter(e => e.source === historySourceFilter);

              const counts = {
                all:      allEntries.length,
                crew:     allEntries.filter(e => e.source === 'crew').length,
                supplier: allEntries.filter(e => e.source === 'supplier').length,
                system:   allEntries.filter(e => e.source === 'system').length,
              };

              // Filter pill row. Empty buckets stay clickable but
              // dimmed, so the chief can see at a glance that there
              // are no supplier events yet without having to click
              // and land on a confusing empty state.
              const FilterPills = () => {
                const pills = [
                  { value: 'all',      label: 'Everyone',  count: counts.all },
                  { value: 'crew',     label: 'Crew',      count: counts.crew },
                  { value: 'supplier', label: 'Supplier',  count: counts.supplier },
                ];
                if (counts.system > 0) {
                  pills.push({ value: 'system', label: 'System', count: counts.system });
                }
                return (
                  <div className="pv-history-filter-row">
                    {pills.map(p => (
                      <button
                        key={p.value}
                        type="button"
                        className={`pv-history-filter-pill${historySourceFilter === p.value ? ' is-active' : ''}${p.count === 0 ? ' is-empty' : ''}`}
                        onClick={() => setHistorySourceFilter(p.value)}
                      >
                        {p.label}
                        <span className="pv-history-filter-count">{p.count}</span>
                      </button>
                    ))}
                  </div>
                );
              };

              if (allEntries.length === 0) {
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
                  <FilterPills />
                  {filteredEntries.length === 0 && (
                    <div style={{ padding: '48px 0', textAlign: 'center' }}>
                      <p style={{ fontSize: 13, color: '#64748B' }}>
                        No {historySourceFilter} activity yet on this board.
                      </p>
                      <button
                        type="button"
                        onClick={() => setHistorySourceFilter('all')}
                        style={{ marginTop: 8, fontSize: 12, color: '#C65A1A', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Show everyone
                      </button>
                    </div>
                  )}
                  {filteredEntries.map((entry, idx) => {
                    let relTime = '';
                    let absTime = '';
                    try {
                      relTime = formatDistanceToNow(entry.date, { addSuffix: true });
                      absTime = entry.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + entry.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    } catch { absTime = ''; }
                    const isExpanded = expandedHistory === entry.key;
                    // Only show the chevron / make the row clickable
                    // when the expansion has something concrete to
                    // render. The expansion panel handles a fixed set
                    // of receive-event keys (items list + supplier /
                    // items_received / items_unmatched scalars) —
                    // supplier quote events whose payload is just
                    // { item_name, agreed_price, agreed_currency }
                    // would open an empty card otherwise. The summary
                    // line + diff chip already carry that info, so
                    // the row stays inert.
                    const hasExpandableMeta = (
                      (Array.isArray(entry.meta.items) && entry.meta.items.length > 0) ||
                      entry.meta.supplier != null ||
                      entry.meta.items_received != null ||
                      (entry.meta.items_unmatched != null && entry.meta.items_unmatched > 0)
                    );
                    return (
                      <div key={entry.key} style={{ borderBottom: idx < filteredEntries.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                        {/* Collapsed row */}
                        <div
                          onClick={() => hasExpandableMeta && setExpandedHistory(isExpanded ? null : entry.key)}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 0', cursor: hasExpandableMeta ? 'pointer' : 'default' }}
                        >
                          {/* Chevron / spacer occupy the same 14px
                              gutter so rows without an expansion
                              chevron (supplier quote / accept rows)
                              still line up with the crew rows that
                              have one. */}
                          {hasExpandableMeta && (
                            <span style={{ display: 'inline-block', width: 14, fontSize: 10, color: '#94A3B8', marginTop: 4, flexShrink: 0, textAlign: 'center' }}>
                              {isExpanded ? '▾' : '▸'}
                            </span>
                          )}
                          {!hasExpandableMeta && <span style={{ width: 14, flexShrink: 0 }} />}
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.dot, flexShrink: 0, marginTop: 6 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, color: '#0F172A', fontWeight: 500, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                              <span className={`pv-history-tag pv-history-tag-${entry.source}`}>{entry.tag}</span>
                              <span>{entry.summary}</span>
                              {entry.diff && (
                                <span className="pv-history-diff">{entry.diff}</span>
                              )}
                            </p>
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
                        {isExpanded && hasExpandableMeta && (
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
                            {/* Scalar meta fields. board_title is
                                deliberately omitted — the chief is
                                already on this board's History tab,
                                so "Board: <name>" is redundant. */}
                            {[
                              entry.meta.supplier && ['Supplier', entry.meta.supplier],
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
                {supplierOrders.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onNavigate={(orderId) => navigate(`/provisioning/${id}/orders/${orderId}`)}
                    canFavouriteOrder={canFavouriteOrder}
                    onToggleFavourite={handleToggleFavourite}
                    favouritingOrderId={favouritingOrderId}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        </EditorialPageShell>
      </div>

      {quoteReviewFile && list && (
        <QuoteReviewModal
          list={list}
          items={items}
          baselineCostById={baselineCostById}
          file={quoteReviewFile}
          onApplied={async (count) => {
            setQuoteReviewFile(null);
            if (count > 0) {
              showToast(`Applied ${count} quoted price${count === 1 ? '' : 's'} to the board`, 'success');
              // Re-pull the lines so the new unit costs + totals show.
              try {
                const fresh = await fetchListItems(id);
                setItems(fresh || []);
              } catch { /* best-effort */ }
            }
          }}
          onClose={() => setQuoteReviewFile(null)}
        />
      )}

      {confirmEmailPrompt && (
        <QuoteConfirmEmailModal
          boardTitle={list?.title}
          defaultEmail={confirmEmailPrompt.defaultEmail}
          quotedTotal={confirmEmailPrompt.quotedTotal}
          itemCount={confirmEmailPrompt.itemCount}
          onClose={() => setConfirmEmailPrompt(null)}
        />
      )}

      {showShareModal && list && (
        <ShareModal
          list={list}
          crewMembers={crewMembers}
          currentUserId={user?.id}
          onClose={() => {
            setShowShareModal(false);
            // Refresh this user's collaborator permission in case they
            // changed their own access (or were removed) while open.
            if (list?.id && user?.id) {
              fetchCollaborators(list.id)
                .then((rows) => {
                  const mine = (rows || []).find((c) => c.user_id === user.id);
                  setCollabPerm(mine?.permission || null);
                })
                .catch(() => {});
            }
          }}
        />
      )}

      {showEditModal && (
        <EditBoardModal
          list={list}
          // A board with any linked supplier order is supplier-managed:
          // the status flows from the supplier flow (sent → quoted →
          // confirmed → partially_delivered → delivered) plus from
          // receive events, not from a manual dropdown. Pass the flag
          // through so the modal can lock the field and explain why.
          supplierManaged={supplierOrders.length > 0}
          onSaved={(updated) => { setList(prev => ({ ...prev, ...updated })); setShowEditModal(false); showToast('Board saved', 'success'); }}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Hidden input drives the "Upload supplier quote" menu item.
          PDF / image only. Multiple = false; supplier sends one quote
          per board. */}
      <input
        ref={quoteFileInputRef}
        type="file"
        accept=".pdf,image/*"
        onChange={handleQuoteFileChange}
        style={{ display: 'none' }}
      />

      {/* Approve modal — confirmation step with optional advisory note
          when the approver clicks Approve from the board itself. Same
          shell + copy as the inbox right pane's modal so deciding from
          either surface feels uniform. Re-approval (prev_status was
          quote_received) flips the headline + body copy. */}
      {decisionModal === 'approve' && (
        <ModalShell
          onClose={() => { if (!deciding) { setDecisionModal(null); setDecisionComment(''); } }}
          isDirty={!!decisionComment.trim()}
          isBusy={deciding}
          panelClassName="pv-edit-modal pv-dashboard"
        >
          {(() => {
            const isReApproval = approvalRequest?.prev_status === PROVISIONING_STATUS.QUOTE_RECEIVED;
            const submitterFirst = submitterProfile?.full_name?.split(' ')[0]
              || (submitterProfile?.email ? submitterProfile.email.split('@')[0] : 'the submitter');
            return (
              <>
                <div className="pv-edit-modal-head">
                  <div>
                    <span className="pv-edit-modal-eyebrow">Reviewer decision</span>
                    <h2 className="pv-edit-modal-title">
                      {isReApproval ? <>Approve, <em>quote</em>.</> : <>Approve, <em>order</em>.</>}
                    </h2>
                  </div>
                  <button
                    onClick={() => { setDecisionModal(null); setDecisionComment(''); }}
                    className="pv-edit-modal-close"
                    aria-label="Close"
                    disabled={deciding}
                  >
                    <Icon name="X" style={{ width: 16, height: 16 }} />
                  </button>
                </div>
                <div className="pv-edit-modal-body">
                  <p style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 13,
                    color: 'var(--d-muted)',
                    margin: '0 0 14px',
                    lineHeight: 1.5,
                  }}>
                    {isReApproval ? (
                      <>Approving locks in the supplier's quote on this board. <strong style={{ color: 'var(--d-navy-deep)' }}>{submitterFirst}</strong> can then confirm the order with the supplier at the agreed prices.</>
                    ) : (
                      <>Approving releases the board back to <strong style={{ color: 'var(--d-navy-deep)' }}>{submitterFirst}</strong> so they can send it to a supplier.</>
                    )}
                  </p>
                  <div className="pv-edit-modal-field">
                    <label className="pv-edit-modal-label" htmlFor="pv-board-approve-note">
                      Note <span style={{ fontWeight: 500, color: 'var(--d-muted-soft)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                    </label>
                    <textarea
                      id="pv-board-approve-note"
                      value={decisionComment}
                      onChange={e => setDecisionComment(e.target.value)}
                      rows={3}
                      autoFocus
                      className="pv-edit-modal-textarea"
                      placeholder={isReApproval
                        ? 'e.g. Accept the £20 increase on tuna, confirm 10am delivery, hold the wine order until next week…'
                        : 'e.g. Use Frantoio Mediterranean for the oil, drop off at Antibes instead of Palma, delivery before 10am…'}
                    />
                  </div>
                </div>
                <div className="pv-edit-modal-foot">
                  <div className="pv-edit-modal-actions">
                    <button
                      type="button"
                      onClick={() => { setDecisionModal(null); setDecisionComment(''); }}
                      className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
                      disabled={deciding}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDecide('approve')}
                      disabled={deciding}
                      className="pv-edit-modal-btn pv-edit-modal-btn-primary"
                    >
                      {deciding ? 'Approving…' : (isReApproval ? 'Approve quote' : 'Approve & release')}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </ModalShell>
      )}

      {/* Confirm-quote modal — fires from the no-approver path's
          ribbon button. Editorial Cargo styling matching the
          approver decision modals above so the action reads as
          part of the app, not the browser. */}
      {confirmQuoteModalOpen && (
        <ModalShell
          onClose={() => { if (!confirmingQuote) setConfirmQuoteModalOpen(false); }}
          isDirty={false}
          isBusy={confirmingQuote}
          panelClassName="pv-edit-modal pv-dashboard"
        >
          <div className="pv-edit-modal-head">
            <div>
              <span className="pv-edit-modal-eyebrow">Confirm quote</span>
              <h2 className="pv-edit-modal-title">
                Lock in, <em>quoted</em>.
              </h2>
            </div>
            <button
              onClick={() => setConfirmQuoteModalOpen(false)}
              className="pv-edit-modal-close"
              aria-label="Close"
              disabled={confirmingQuote}
            >
              <Icon name="X" style={{ width: 16, height: 16 }} />
            </button>
          </div>
          <div className="pv-edit-modal-body">
            {hasManualQuote ? (
              // Manual quote: the supplier isn't a Cargo supplier (no
              // portal). Confirm locks the board and offers an email draft.
              <p style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--d-muted)',
                margin: 0,
                lineHeight: 1.5,
              }}>
                The board will flip to{' '}
                <strong style={{ color: 'var(--d-navy-deep)' }}>confirmed</strong>{' '}
                at the quoted prices. Afterwards you can email the supplier a
                confirmation — they're not on the Cargo portal, so nothing is
                sent automatically.
              </p>
            ) : (
              <>
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  color: 'var(--d-muted)',
                  margin: '0 0 14px',
                  lineHeight: 1.5,
                }}>
                  Every quoted line will lock at the supplier's price, the order will flip to{' '}
                  <strong style={{ color: 'var(--d-navy-deep)' }}>confirmed</strong>, and the supplier
                  will be notified in their portal.
                </p>
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  color: 'var(--d-muted-soft)',
                  fontStyle: 'italic',
                  margin: 0,
                  lineHeight: 1.5,
                }}>
                  Lines still awaiting a quote on this or another supplier stay where they are —
                  only the quoted ones move.
                </p>
              </>
            )}
          </div>
          <div className="pv-edit-modal-foot">
            <button
              type="button"
              className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
              onClick={() => setConfirmQuoteModalOpen(false)}
              disabled={confirmingQuote}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pv-edit-modal-btn pv-edit-modal-btn-primary"
              onClick={runConfirmQuote}
              disabled={confirmingQuote}
            >
              {confirmingQuote ? 'Confirming…' : 'Confirm quote'}
            </button>
          </div>
        </ModalShell>
      )}

      {decisionModal === 'request_changes' && (
        <ModalShell
          onClose={() => { if (!deciding) { setDecisionModal(null); setDecisionComment(''); } }}
          isDirty={!!decisionComment.trim()}
          isBusy={deciding}
          panelClassName="pv-edit-modal pv-dashboard"
        >
          <div className="pv-edit-modal-head">
            <div>
              <span className="pv-edit-modal-eyebrow">Reviewer decision</span>
              <h2 className="pv-edit-modal-title">Request, <em>changes</em>.</h2>
            </div>
            <button
              onClick={() => { setDecisionModal(null); setDecisionComment(''); }}
              className="pv-edit-modal-close"
              aria-label="Close"
              disabled={deciding}
            >
              <Icon name="X" style={{ width: 16, height: 16 }} />
            </button>
          </div>
          <div className="pv-edit-modal-body">
            <div className="pv-edit-modal-field">
              <label className="pv-edit-modal-label" htmlFor="ebm-comment">What needs to change?</label>
              <textarea
                id="ebm-comment"
                value={decisionComment}
                onChange={e => setDecisionComment(e.target.value)}
                rows={4}
                autoFocus
                className="pv-edit-modal-textarea"
                placeholder="Be specific so the submitter can act on it — quantities, missing items, supplier swap, etc."
              />
            </div>
          </div>
          <div className="pv-edit-modal-foot">
            <div className="pv-edit-modal-actions">
              <button
                type="button"
                onClick={() => { setDecisionModal(null); setDecisionComment(''); }}
                className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
                disabled={deciding}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDecide('request_changes')}
                disabled={deciding || !decisionComment.trim()}
                className="pv-edit-modal-btn pv-edit-modal-btn-primary"
              >
                {deciding ? 'Sending…' : 'Send to submitter'}
              </button>
            </div>
          </div>
        </ModalShell>
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
            // Refresh list status + supplier_orders so the cascade
            // result (board pill + order pill) reflects locally without
            // a hard reload.
            fetchProvisioningList(id).then(fresh => fresh && setList(prev => ({ ...prev, ...fresh }))).catch(() => {});
            fetchSupplierOrders(id).then(orders => setSupplierOrders(orders || [])).catch(() => {});
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
          onSent={async (order, { dispatched = false } = {}) => {
            // Refetch from DB so deduped 'both' rows collapse correctly
            try {
              const fresh = await fetchSupplierOrders(id);
              setSupplierOrders(fresh || []);
            } catch { /* non-fatal */ }
            // Optimistic board-status flip — only when the modal
            // confirms a real dispatch happened. The modal's
            // commitBoardStatusFlip guard already wrote the DB row;
            // this keeps the local UI in lockstep without lying
            // when nothing went out. Without this gate the UI would
            // show 'sent_to_supplier' for a moment then snap back
            // on next refetch — looks like a flicker bug, worse
            // than the original false-sent.
            if (dispatched) {
              setList(prev => ({ ...prev, status: 'sent_to_supplier' }));
              setActiveTab('orders');
            }
            showToast(`Order sent to ${order.supplier_name || 'supplier'}`, 'success');
          }}
          tenantId={activeTenantId}
          listId={id}
          items={items
            .filter(i => i.status !== 'received' && i.status !== 'unavailable' && !isQuoteConfirmed(i) && i.name?.trim())
            .filter(i => {
              const oi = itemStatusMap[(i.name || '').toLowerCase().trim()];
              return !oi;
            })
            .map(i => ({
              id: i.id,
              name: i.name,
              quantity: i.quantity_ordered,
              unit: i.unit,
              notes: i.notes,
              estimated_price: i.estimated_unit_cost || null,
              supplier_profile_id: i.supplier_profile_id || null,
              supplier_name: i.supplier_name || null,
              // Quick Add snapshot fields — threaded through the modal
              // to createSupplierOrder, which persists them on
              // supplier_order_items (migration 20260604120000). Apply-
              // favourite later reads them back so the new board item
              // restores brand/size/category/etc — not just the name.
              brand:          i.brand          || null,
              size:           i.size           || null,
              category:       i.category       || null,
              sub_category:   i.sub_category   || null,
              department:     i.department     || null,
              allergen_flags: i.allergen_flags || [],
            }))}
          vesselName={tenantVesselName || list?.title}
          vesselTypeLabel={tenantVesselTypeLabel}
          orderRef={null}
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

      {/* Quick Add — kept mounted for legacy callers (the templates drawer
          mode still serves the board-card Save-as-template flow).
          Standalone Quick Add ribbon button is gone; AddItemsModal below
          consolidates the bulk-import entry point. */}
      <BoardDrawer
        open={quickAddOpen}
        mode="templates"
        list={list}
        tenantId={activeTenantId}
        onAddItems={handleAddItemsFromQuickAdd}
        onClose={() => setQuickAddOpen(false)}
      />

      {/* Unified Add-items modal — full-screen takeover. Replaces the
          Suggestions inline panel + Quick Add side modal entry points.
          Sources: Suggestions / Past orders / Catalogue / Frequent. */}
      <AddItemsModal
        isOpen={addItemsOpen}
        onClose={() => setAddItemsOpen(false)}
        boardId={list?.id}
        tenantId={activeTenantId}
        tripId={list?.trip_id}
        currentItems={items}
        currentDepartment={primaryDept}
        isCommand={isCommand}
        onItemsAdded={handleAddItemsFromQuickAdd}
      />

      {/* Bulk action bar — floats over the items list when ≥1 item
          selected. Commit 1 ships Mark received + Clear only; Edit /
          Change dept / Delete enable in commits 2-4 by passing those
          handlers. Cool-surface palette; sits visually atop the
          warm-hex items table (item-table cool migration is a
          separate deferred job). */}
      <BulkActionBar
        selectedCount={selectedItems.size}
        busy={bulkBusy.kind === 'receive'}
        busyText={bulkBusy.total > 5 ? `Receiving ${bulkBusy.done} of ${bulkBusy.total}…` : ''}
        // True when ≥1 selected item lives inside a supplier order.
        // Drives the bulk-bar's Edit / Change dept / Delete lock —
        // those would silently mutate sent lines and the supplier
        // would never see the change. Mark received stays available.
        anySent={Array.from(selectedItems).some((id) => {
          const itm = items.find((i) => i.id === id);
          if (!itm) return false;
          return !!itemStatusMap[(itm.name || '').toLowerCase().trim()];
        })}
        onMarkReceived={() => handleBulkReceive()}
        onEdit={() => setBulkEditOpen(true)}
        onChangeDept={() => setBulkChangeDeptOpen(true)}
        onDelete={() => setBulkDeleteOpen(true)}
        // Set status — the single status control (the per-row dropdown is
        // gone; the row dot is now read-only). Applies to the non-portal
        // lines in the selection; disabled when every selected line is
        // portal-supplier-owned. 'Received'/'Partial' live on Mark received.
        onSetStatus={handleBulkSetStatus}
        statusOptions={BULK_STATUS_OPTIONS}
        {...(() => {
          const rows = items.filter(i => selectedItems.has(i.id));
          const eligible = rows.filter(i => !isPortalLocked(i));
          const anyPortalLocked = rows.some(i => isPortalLocked(i));
          return {
            statusDisabled: eligible.length === 0,
            statusTitle: eligible.length === 0
              ? 'Managed by the supplier — change status from the supplier side.'
              : (anyPortalLocked
                  ? 'Applies to the non-supplier lines only — supplier-owned lines are left as-is.'
                  : undefined),
          };
        })()}
        onClear={clearSelection}
      />

      <BulkDeleteConfirmModal
        isOpen={bulkDeleteOpen}
        count={selectedItems.size}
        busy={bulkBusy.kind === 'delete'}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
      />

      <BulkChangeDeptModal
        isOpen={bulkChangeDeptOpen}
        count={selectedItems.size}
        departments={departments}
        busy={bulkBusy.kind === 'changeDept'}
        onCancel={() => setBulkChangeDeptOpen(false)}
        onConfirm={handleBulkChangeDept}
      />

      <BulkEditModal
        isOpen={bulkEditOpen}
        count={selectedItems.size}
        selectedItemRows={items.filter(i => selectedItems.has(i.id))}
        departments={departments}
        busy={bulkBusy.kind === 'edit'}
        onCancel={() => setBulkEditOpen(false)}
        onConfirm={handleBulkEdit}
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
            zIndex: 'var(--z-overlay)', padding: 16,
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
