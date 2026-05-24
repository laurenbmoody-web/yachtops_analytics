// ─────────────────────────────────────────────────────────────────────────────
// Delivery Inbox — editorial redesign.
// Two-region layout (wide main + 290px rail), editorial header system
// (.editorial-meta + .editorial-greeting from src/styles/editorial.css), page-
// scoped styles in delivery-inbox.css under .di. The Inbox tab keeps the
// existing group-by-scanner+date logic; the Returns tab now splits into three
// lifecycle stages (slip / awaiting signature / supplier confirmed).
//
// Every claim / dismiss / return / generate-slip / mark-archived / cancel-
// return action reuses the existing storage helpers verbatim. The CHIEF / HOD
// `scanned_by || department` filter is preserved as-is (a separate PR removes
// it; that PR and this redesign land independently). CREW remains hard-blocked
// and `canReturn` (COMMAND + CHIEF only) still gates the Return action.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { showToast } from '../../utils/toast';
import {
  fetchDeliveryInbox,
  claimInboxItem,
  dismissInboxItem,
  returnInboxItem,
  fetchPendingReturns,
  fetchPortalEnabledSuppliers,
  sendReturnToPortal,
  confirmReturned,
  cancelReturns,
  fetchProvisioningLists,
} from './utils/provisioningStorage';
import { logActivity } from '../../utils/activityStorage';
import { supabase } from '../../lib/supabaseClient';
import './delivery-inbox.css';
import '../../styles/editorial.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtCurrency = (val) => {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return `£${n.toFixed(2)}`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(typeof iso === 'string' && iso.length === 10 ? iso + 'T12:00:00' : iso)
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(iso); }
};

const fmtDateShort = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  catch { return '—'; }
};

// Expiry chip + group bottom-edge predicate. ≤2 days (including expired) =
// rust signal; the group card edge goes rust if any item triggers this.
const expiryDays = (expiresAt) => {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt) - Date.now()) / (1000 * 60 * 60 * 24));
};
const expiringSoonForCardEdge = (item) => {
  const d = expiryDays(item.expires_at);
  return d != null && d <= 2;
};

// Returns lifecycle. Only `status === 'pending_return'` rows ever land in a
// stage; archived returns surface separately under "Show archived".
const stageOf = (item) => {
  if (item.status !== 'pending_return') return null;
  if (item.supplier_confirmed_at) return 3;
  if (item.return_slip_token) return 2;
  return 1;
};

const STAGE_SECTION_LABEL = {
  1: 'Needs a return slip',
  2: 'Awaiting supplier signature',
  3: 'Supplier confirmed',
};
const STAGE_PILL_LABEL = {
  1: 'Slip not generated',
  2: 'Awaiting signature',
  3: 'Supplier signed',
};
const STAGE_EDGE_CLASS = {
  1: 'di-card',           // sand default
  2: 'di-card di-card-amber',
  3: 'di-card di-card-sage',
};

// Return-reason → short readable tag.
const REASON_TAGS = {
  damaged: 'Damaged',
  short: 'Short-delivered',
  wrong: 'Wrong item',
  over: 'Over-delivered',
  other: 'Other',
};
const formatReasonTag = (reason) => {
  if (!reason) return null;
  const key = String(reason).toLowerCase().trim();
  if (REASON_TAGS[key]) return REASON_TAGS[key];
  // Best-effort title-case for free-text reasons.
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
};

// ─── ExpiryBadge ─────────────────────────────────────────────────────────────
const ExpiryBadge = ({ expiresAt }) => {
  const d = expiryDays(expiresAt);
  if (d == null) return null;
  if (d < 0) return <span className="di-chip di-chip-rust">Expired</span>;
  if (d === 0) return <span className="di-chip di-chip-rust">Expires today</span>;
  if (d <= 1) return <span className="di-chip di-chip-rust">Expires 1d</span>;
  if (d <= 3) return <span className="di-chip di-chip-amber">Expires {d}d</span>;
  return <span className="di-chip di-chip-quiet">Expires {d}d</span>;
};

// ─── Detail panel (expandable below a row) ───────────────────────────────────
const DetailField = ({ label, value }) => {
  if (value == null || value === '') return null;
  return (
    <div className="di-detail-field">
      <p className="di-detail-label">{label}</p>
      <p className="di-detail-value">{value}</p>
    </div>
  );
};

const ItemDetailPanel = ({ item }) => {
  const hasSupplierInfo = item.supplier_name || item.supplier_phone || item.supplier_email || item.supplier_address;
  const hasOrderInfo = item.order_ref || item.order_date || item.item_reference || item.delivery_note_ref;
  const hasPricing = item.unit_price || item.line_total || item.ordered_qty;

  return (
    <div className="di-detail-panel">
      <div className="di-detail-card">
        {hasSupplierInfo && (
          <div className="di-detail-row">
            <DetailField label="Supplier" value={item.supplier_name} />
            <DetailField label="Phone" value={item.supplier_phone} />
            <DetailField label="Email" value={item.supplier_email} />
            {item.supplier_address && !item.supplier_name && (
              <DetailField label="Address" value={item.supplier_address} />
            )}
          </div>
        )}
        {hasPricing && (
          <div className="di-detail-row">
            <DetailField label="Unit price" value={fmtCurrency(item.unit_price)} />
            <DetailField label="Line total" value={fmtCurrency(item.line_total)} />
            <DetailField label="Ordered qty" value={item.ordered_qty} />
            <DetailField label="Unit" value={item.unit} />
          </div>
        )}
        {hasOrderInfo && (
          <div className="di-detail-row">
            <DetailField label="Item ref" value={item.item_reference} />
            <DetailField label="Order ref" value={item.order_ref} />
            <DetailField label="Order date" value={item.order_date} />
            <DetailField label="Delivery note ref" value={item.delivery_note_ref} />
          </div>
        )}
        {item.supplier_address && hasSupplierInfo && item.supplier_name && (
          <DetailField label="Supplier address" value={item.supplier_address} />
        )}
      </div>
    </div>
  );
};

// ─── Per-row claim flow (idle → boards → qty) ────────────────────────────────
const ClaimInline = ({ item, boards, userId, onClaimed, onPartialClaim, onExpandChange }) => {
  const [step, setStep] = useState('idle'); // 'idle' | 'boards' | 'qty'
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [claimQty, setClaimQty] = useState(item.quantity ?? 1);
  const [claiming, setClaiming] = useState(false);

  const goToStep = (s) => { setStep(s); onExpandChange?.(s !== 'idle'); };

  const handleBoardSelect = (board) => {
    setSelectedBoard(board);
    setClaimQty(item.quantity ?? 1);
    goToStep('qty');
  };

  const handleConfirm = async () => {
    setClaiming(true);
    const result = await claimInboxItem(item.id, userId, selectedBoard.id, claimQty);
    if (result) {
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: selectedBoard.id,
        summary: `claimed ${claimQty} × "${result.raw_name}" from Delivery Inbox`,
        meta: {
          inbox_item_id: item.id,
          raw_name: result.raw_name,
          quantity_claimed: claimQty,
          remainder: result._remainder,
          board_id: selectedBoard.id,
          original_scanned_by: result.scanned_by,
        },
      });
      if (result._partial) {
        showToast(`${claimQty} × "${result.raw_name}" claimed to ${selectedBoard.title} · ${result._remainder} remaining`, 'success');
        onPartialClaim?.();
      } else {
        showToast(`"${result.raw_name}" claimed to ${selectedBoard.title}`, 'success');
        onClaimed(item.id);
      }
    } else {
      showToast('Failed to claim item', 'error');
      setClaiming(false);
    }
  };

  if (claiming) return <span className="di-claim-step-label">Claiming…</span>;

  if (step === 'idle') {
    return (
      <button onClick={() => goToStep('boards')} className="di-btn di-btn-primary di-btn-sm">
        Claim
      </button>
    );
  }

  if (step === 'boards') {
    return (
      <div className="di-claim-step">
        {boards.length === 0 ? (
          <span className="di-claim-step-label">No boards</span>
        ) : boards.map(b => (
          <button key={b.id} onClick={() => handleBoardSelect(b)} className="di-claim-board-pill">
            {b.title}
          </button>
        ))}
        <button onClick={() => goToStep('idle')} className="di-btn di-btn-quiet di-btn-sm">Cancel</button>
      </div>
    );
  }

  // qty
  return (
    <div className="di-claim-step">
      <span className="di-claim-step-label">To {selectedBoard.title} · qty</span>
      <input
        type="number" min="1" max={item.quantity ?? 1}
        value={claimQty}
        onChange={e => setClaimQty(Math.max(1, Math.min(item.quantity ?? 1, Number(e.target.value) || 1)))}
        className="di-claim-qty-input"
      />
      <button onClick={handleConfirm} className="di-btn di-btn-primary di-btn-sm">Confirm</button>
      <button onClick={() => goToStep('boards')} className="di-btn di-btn-quiet di-btn-sm">Back</button>
    </div>
  );
};

// ─── Group-level "Claim all to a board" picker ───────────────────────────────
const ClaimAllToBoard = ({ groupItems, boards, userId, onAllSucceeded }) => {
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const claimable = groupItems.filter(i => i.status === 'pending');

  const handlePick = async (board) => {
    setClaiming(true);
    setOpen(false);
    const ids = claimable.map(i => i.id);
    const results = await Promise.allSettled(ids.map(id => claimInboxItem(id, userId, board.id)));
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);
    succeededIds.forEach(id => {
      const item = claimable.find(i => i.id === id);
      if (!item) return;
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: board.id,
        summary: `claimed "${item.raw_name}" from Delivery Inbox`,
        meta: { inbox_item_id: id, raw_name: item.raw_name, quantity: item.quantity, board_id: board.id, original_scanned_by: item.scanned_by },
      });
    });
    if (succeededIds.length > 0) {
      showToast(`${succeededIds.length} item${succeededIds.length !== 1 ? 's' : ''} claimed to ${board.title}`, 'success');
      onAllSucceeded(succeededIds);
    }
    if (succeededIds.length < ids.length) {
      showToast(`${ids.length - succeededIds.length} failed to claim`, 'error');
    }
    setClaiming(false);
  };

  // Click-away.
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (!e.target.closest('.di-claim-all')) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (claimable.length === 0) return null;

  return (
    <div className="di-claim-all">
      <button onClick={() => setOpen(v => !v)} disabled={claiming} className="di-btn di-btn-ghost di-btn-sm">
        <Icon name="Inbox" style={{ width: 12, height: 12 }} />
        {claiming ? 'Claiming…' : 'Claim all to a board'}
        <Icon name="ChevronDown" style={{ width: 12, height: 12 }} />
      </button>
      {open && !claiming && (
        <div className="di-claim-all-pop">
          {boards.length === 0
            ? <div className="di-claim-all-empty">No boards available</div>
            : boards.map(b => (
              <button key={b.id} onClick={() => handlePick(b)} className="di-claim-all-opt">{b.title}</button>
            ))}
        </div>
      )}
    </div>
  );
};

// ─── Inbox item row ──────────────────────────────────────────────────────────
const InboxItemRow = ({
  item, boards, userId, selected, onToggle,
  onClaimed, onPartialClaim, onDismiss, onReturn,
  canReturn, bulkFading, docUrl, archived,
}) => {
  const [indivFading, setIndivFading] = useState(false);
  const [claimExpanded, setClaimExpanded] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const handleClaimedLocal = (id) => {
    setIndivFading(true);
    setTimeout(() => onClaimed(id), 320);
  };
  const handleReturnLocal = async () => {
    setReturning(true);
    const ok = await onReturn(item.id);
    if (!ok) setReturning(false);
  };
  const handleDismissLocal = async () => {
    setDismissing(true);
    const ok = await onDismiss(item.id);
    if (!ok) setDismissing(false);
  };

  const fading = bulkFading || indivFading;
  const qty = item.quantity ?? '—';
  const orderedQty = item.ordered_qty;
  const isShort = orderedQty != null && item.quantity != null && Number(item.quantity) < Number(orderedQty);
  const shortBy = isShort ? Number(orderedQty) - Number(item.quantity) : 0;
  const detailLine = isShort
    ? `${qty} ${item.unit || ''} received · ${orderedQty} ordered`
    : `${qty} ${item.unit || ''}${item.unit_price ? ` · ${fmtCurrency(item.unit_price)} each` : ''}${item.line_total ? ` · ${fmtCurrency(item.line_total)} total` : ''}`;

  return (
    <>
      <div className={`di-row${selected ? ' is-selected' : ''}${fading ? ' is-fading' : ''}${archived ? ' is-archived' : ''}`}>
        {archived
          ? <div className="di-row-spacer-check" />
          : <input type="checkbox" checked={selected} onChange={onToggle} className="di-row-check" />}
        <div className="di-row-main">
          <button onClick={() => setDetailOpen(v => !v)} className="di-row-name" title="Click to view parsed details">
            {item.raw_name}
            <Icon name={detailOpen ? 'ChevronUp' : 'ChevronDown'} style={{ width: 12, height: 12, opacity: 0.6 }} />
          </button>
          {docUrl && !detailOpen && (
            <a href={docUrl} target="_blank" rel="noopener noreferrer" className="di-row-doc-link" onClick={e => e.stopPropagation()}>
              <Icon name="FileText" style={{ width: 11, height: 11 }} />
              View doc
            </a>
          )}
          <p className="di-row-detail">
            {detailLine}
            {isShort && <span className="di-row-shortfall"> — {shortBy} short</span>}
            {item.supplier_name && !isShort && ` · ${item.supplier_name}`}
          </p>
        </div>
        <div className="di-row-right">
          {archived
            ? <span className="di-chip di-chip-archived">{item.archive_reason === 'returned' ? 'Returned' : 'Archived'}</span>
            : <ExpiryBadge expiresAt={item.expires_at} />}
          {!archived && (
            <div className="di-row-actions">
              <ClaimInline
                item={item}
                boards={boards}
                userId={userId}
                onClaimed={handleClaimedLocal}
                onPartialClaim={onPartialClaim}
                onExpandChange={setClaimExpanded}
              />
              {!claimExpanded && (
                <>
                  {canReturn && (
                    <button onClick={handleReturnLocal} disabled={returning} className="di-btn di-btn-ghost di-btn-sm">
                      {returning ? 'Returning…' : 'Return'}
                    </button>
                  )}
                  <button onClick={handleDismissLocal} disabled={dismissing} className="di-btn di-btn-quiet di-btn-sm">
                    {dismissing ? 'Hiding…' : 'Not my order'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {detailOpen && <ItemDetailPanel item={item} />}
    </>
  );
};

// ─── Inbox group card ────────────────────────────────────────────────────────
const InboxGroupCard = ({
  group, boards, userId, scannerNames, selectedIds, batchDocUrls,
  onToggleSelect, onToggleGroup, onItemClaimed, onPartialClaim, onItemDismiss, onItemReturn,
  onGroupClaimAllSucceeded, canReturn, bulkFadingIds,
}) => {
  const claimable = group.items.filter(i => i.status === 'pending');
  const allSelected = claimable.length > 0 && claimable.every(i => selectedIds.has(i.id));
  const hasUrgent = group.items.some(i => i.status !== 'archived' && expiringSoonForCardEdge(i));
  const scannerName = group.scannedBy && scannerNames[group.scannedBy] ? scannerNames[group.scannedBy] : null;
  const titleText = group.supplierName && group.supplierName !== 'Manual receive'
    ? group.supplierName
    : (scannerName ? `Scanned by ${scannerName}` : 'Unknown source');
  const subText = scannerName
    ? `Scanned by ${scannerName} · ${fmtDate(group.date)}`
    : fmtDate(group.date);

  return (
    <div className={`di-card${hasUrgent ? ' di-card-rust' : ''}`}>
      <div className="di-card-band">
        <input type="checkbox" className="di-card-band-check" checked={allSelected} onChange={() => onToggleGroup(claimable, allSelected)} />
        <div className="di-card-band-icon"><Icon name="Package" style={{ width: 16, height: 16 }} /></div>
        <div className="di-card-band-text">
          <p className="di-card-band-title">{titleText}</p>
          <p className="di-card-band-sub">{subText}</p>
        </div>
        <div className="di-card-band-actions">
          <span className="di-card-band-count">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
          {claimable.length > 0 && (
            <ClaimAllToBoard
              groupItems={claimable}
              boards={boards}
              userId={userId}
              onAllSucceeded={onGroupClaimAllSucceeded}
            />
          )}
        </div>
      </div>
      <div className="di-card-body">
        {group.items.map(item => (
          <InboxItemRow
            key={item.id}
            item={item}
            boards={boards}
            userId={userId}
            selected={selectedIds.has(item.id)}
            onToggle={() => onToggleSelect(item.id)}
            onClaimed={onItemClaimed}
            onPartialClaim={onPartialClaim}
            onDismiss={onItemDismiss}
            onReturn={onItemReturn}
            canReturn={canReturn}
            bulkFading={bulkFadingIds.has(item.id)}
            docUrl={item.delivery_batch_id ? batchDocUrls[item.delivery_batch_id] : null}
            archived={item.status === 'archived'}
          />
        ))}
      </div>
    </div>
  );
};

// ─── Side rail: Inbox tab ───────────────────────────────────────────────────
const ExpiringSoonCard = ({ items }) => {
  const expiring = items
    .filter(i => i.status === 'pending')
    .map(i => ({ item: i, days: expiryDays(i.expires_at) }))
    .filter(x => x.days != null && x.days <= 2)
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);

  if (expiring.length === 0) return null;

  return (
    <div className="di-rail-card di-rail-card-rust">
      <p className="di-rail-title">Expiring soon</p>
      <div>
        {expiring.map(({ item }) => (
          <div key={item.id} className="di-rail-expiring-item">
            <span className="di-rail-expiring-name" title={item.raw_name}>{item.raw_name}</span>
            <ExpiryBadge expiresAt={item.expires_at} />
          </div>
        ))}
      </div>
      <p className="di-rail-explainer">
        Unclaimed items archive automatically 7 days after scanning. Claim or return these before they go.
      </p>
    </div>
  );
};

const InboxStatsCard = ({ items, deliveryCount }) => {
  const totalUnclaimed = items.filter(i => i.status === 'pending').length;
  const totalValue = items
    .filter(i => i.status === 'pending')
    .reduce((sum, i) => sum + (Number(i.line_total) || 0), 0);
  return (
    <div className="di-rail-card">
      <p className="di-rail-title">This inbox</p>
      <div className="di-rail-stats-grid">
        <div>
          <span className="di-rail-stat">{totalUnclaimed}</span>
          <span className="di-rail-stat-label">Items unclaimed</span>
        </div>
        <div>
          <span className="di-rail-stat">{deliveryCount}</span>
          <span className="di-rail-stat-label">Deliveries waiting</span>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <span className="di-rail-stat">{totalValue > 0 ? fmtCurrency(totalValue) : '—'}</span>
          <span className="di-rail-stat-label">Estimated value held</span>
        </div>
      </div>
    </div>
  );
};

const FilterBySupplierCard = ({ items, selected, onSelect }) => {
  const counts = useMemo(() => {
    const map = new Map();
    items.filter(i => i.status === 'pending').forEach(i => {
      const s = i.supplier_name || 'Unknown supplier';
      map.set(s, (map.get(s) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (counts.length === 0) return null;

  return (
    <div className="di-rail-card">
      <p className="di-rail-title">Filter by supplier</p>
      <div className="di-rail-list">
        {counts.map(([supplier, count]) => (
          <button
            key={supplier}
            onClick={() => onSelect(selected === supplier ? null : supplier)}
            className={`di-rail-list-item${selected === supplier ? ' is-active' : ''}`}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{supplier}</span>
            <span className="di-rail-list-item-count">{count}</span>
          </button>
        ))}
      </div>
      {selected && (
        <button onClick={() => onSelect(null)} className="di-rail-clear-filter">Clear filter ↺</button>
      )}
    </div>
  );
};

// ─── Side rail: Returns tab ─────────────────────────────────────────────────
const ReturnPipelineCard = ({ stages }) => (
  <div className="di-rail-card">
    <p className="di-rail-title">Return pipeline</p>
    <div className="di-rail-stats-grid">
      <div>
        <span className="di-rail-stat">{stages[1].length}</span>
        <span className="di-rail-stat-label">Need a slip</span>
      </div>
      <div>
        <span className="di-rail-stat">{stages[2].length}</span>
        <span className="di-rail-stat-label">Awaiting supplier</span>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <span className="di-rail-stat">{stages[3].length}</span>
        <span className="di-rail-stat-label">Signed, ready to archive</span>
      </div>
    </div>
  </div>
);

const NeedsActionCard = ({ stages }) => {
  const supplierActions = useMemo(() => {
    const out = [];
    // Stage 1: needs slip
    const stage1Groups = groupBySupplier(stages[1]);
    Object.entries(stage1Groups).forEach(([supplier, items]) => {
      out.push({ supplier, label: 'Send slip', count: items.length });
    });
    // Stage 3: needs archive
    const stage3Groups = groupBySupplier(stages[3]);
    Object.entries(stage3Groups).forEach(([supplier, items]) => {
      out.push({ supplier, label: 'Archive', count: items.length });
    });
    return out;
  }, [stages]);

  if (supplierActions.length === 0 && stages[2].length === 0) return null;

  return (
    <div className="di-rail-card">
      <p className="di-rail-title">Needs your action</p>
      {supplierActions.length > 0 ? (
        <div>
          {supplierActions.map((a, i) => (
            <div key={`${a.supplier}-${a.label}-${i}`} className="di-rail-action-item">
              <span className="di-rail-action-supplier" title={a.supplier}>
                {a.supplier} <span style={{ color: 'var(--di-muted)' }}>({a.count})</span>
              </span>
              <span className="di-rail-action-label">{a.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="di-rail-explainer" style={{ margin: 0 }}>Nothing waiting on you right now.</p>
      )}
      {stages[2].length > 0 && (
        <p className="di-rail-explainer">
          {stages[2].length} item{stages[2].length === 1 ? '' : 's'} awaiting the supplier’s signature don’t need you.
        </p>
      )}
    </div>
  );
};

// ─── Returns: stage classification + grouping ───────────────────────────────
const groupBySupplier = (items) => {
  return items.reduce((acc, i) => {
    const s = i.supplier_name || 'Unknown supplier';
    if (!acc[s]) acc[s] = [];
    acc[s].push(i);
    return acc;
  }, {});
};

// ─── Returns: stage-aware group card ────────────────────────────────────────
const ReturnsGroupCard = ({
  supplier, items, stage, selectedIds, requesterNames,
  onToggleSelect, onToggleGroup, onCancelReturn, onGenerateSlip, onMarkArchived,
  onSendToPortal, isPortalEnabled, portalSupplierName, acting,
}) => {
  // The canonical supplier_profiles.name for portal-enabled groups,
  // falling back to the OCR'd group key. Used wherever the routing-
  // destination supplier name appears in the UI.
  const displaySupplier = portalSupplierName || supplier;
  const allSelected = items.length > 0 && items.every(i => selectedIds.has(i.id));
  const requesterIds = [...new Set(items.map(i => i.return_requested_by).filter(Boolean))];
  const requesterName = requesterIds.length === 1 ? (requesterNames[requesterIds[0]] || 'someone') : null;
  const requestedAtDates = items.map(i => i.return_requested_at).filter(Boolean).sort();
  const earliest = requestedAtDates[0];
  const subParts = [
    `${items.length} item${items.length === 1 ? '' : 's'}`,
    requesterName && `requested by ${requesterName}`,
    earliest && fmtDateShort(earliest),
  ].filter(Boolean);

  return (
    <div className={STAGE_EDGE_CLASS[stage]}>
      <div className="di-card-band">
        <input type="checkbox" className="di-card-band-check" checked={allSelected} onChange={() => onToggleGroup(items, allSelected)} />
        <div className="di-card-band-icon">
          <Icon name={stage === 3 ? 'CheckCircle' : 'PackageX'} style={{ width: 16, height: 16 }} />
        </div>
        <div className="di-card-band-text">
          <p className="di-card-band-title">{supplier}</p>
          <p className="di-card-band-sub">{subParts.join(' · ')}</p>
        </div>
        <div className="di-card-band-actions">
          <span className={`di-stage-pill di-stage-pill-${stage}`}>{STAGE_PILL_LABEL[stage]}</span>
        </div>
      </div>
      <div className="di-card-body">
        {items.map(item => {
          const reasonTag = formatReasonTag(item.return_reason);
          const detailLine = `Qty: ${item.return_qty ?? item.quantity ?? '—'}${item.unit ? ` ${item.unit}` : ''}${item.return_notes ? ` · ${item.return_notes}` : ''}${stage === 3 && item.supplier_signer_name ? ` · Signed by ${item.supplier_signer_name}` : ''}`;
          return (
            <div key={item.id} className={`di-row${selectedIds.has(item.id) ? ' is-selected' : ''}`}>
              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggleSelect(item.id)} className="di-row-check" />
              <div className="di-row-main">
                <div className="di-row-name">
                  <span>{item.raw_name}</span>
                  {reasonTag && <span className="di-reason-tag">{reasonTag}</span>}
                </div>
                <p className="di-row-detail">{detailLine}</p>
              </div>
            </div>
          );
        })}
      </div>
      {stage === 1 && isPortalEnabled && (
        <p className="di-portal-route-note">
          {displaySupplier} uses Cargo — the return goes to their portal.
        </p>
      )}
      <div className="di-card-footer">
        {stage === 1 && (
          <>
            <button onClick={() => onCancelReturn(items)} disabled={acting} className="di-btn di-btn-ghost">Cancel return</button>
            {isPortalEnabled ? (
              <button onClick={() => onSendToPortal(items)} disabled={acting} className="di-btn di-btn-primary">
                Send return to {displaySupplier}&rsquo;s Cargo portal
              </button>
            ) : (
              <button onClick={() => onGenerateSlip(items)} disabled={acting} className="di-btn di-btn-primary">Generate &amp; send slip</button>
            )}
          </>
        )}
        {stage === 2 && (
          <>
            <button onClick={() => onGenerateSlip(items)} disabled={acting} className="di-btn di-btn-ghost">Resend slip</button>
            <button onClick={() => onMarkArchived(items)} disabled={acting} className="di-btn di-btn-sage">Mark returned &amp; archive</button>
          </>
        )}
        {stage === 3 && (
          <button onClick={() => onMarkArchived(items)} disabled={acting} className="di-btn di-btn-sage">Mark returned &amp; archive</button>
        )}
      </div>
    </div>
  );
};

// ─── Error card (reused by both tabs) ───────────────────────────────────────
const ErrorCard = ({ onRetry, message }) => (
  <div className="di-error-card">
    <div className="di-error-icon-tile"><Icon name="AlertCircle" style={{ width: 18, height: 18 }} /></div>
    <p className="di-error-title">{message || "Couldn't load the delivery inbox"}</p>
    <p className="di-error-body">
      A query against Supabase failed. Check your connection and try again.
    </p>
    <button onClick={onRetry} className="di-btn di-btn-primary">Retry</button>
  </div>
);

// ─── Returns view ───────────────────────────────────────────────────────────
const ReturnsView = ({
  tenantId, userId, userFullName, showArchived, supplierFilter, setSupplierFilter,
  selectedIds, setSelectedIds,
}) => {
  const navigate = useNavigate();
  const [returnItems, setReturnItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [requesterNames, setRequesterNames] = useState({});
  // Map<supplier_profile_id, canonical supplier_profiles.name> for the
  // subset of return suppliers with active Cargo portal accounts.
  const [portalEnabledSuppliers, setPortalEnabledSuppliers] = useState(() => new Map());
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const items = await fetchPendingReturns(tenantId, showArchived);
      setReturnItems(items);
      const reqIds = [...new Set(items.map(i => i.return_requested_by).filter(Boolean))];
      if (reqIds.length > 0) {
        const { data: profiles } = await supabase
          ?.from('profiles')?.select('id, full_name')?.in('id', reqIds);
        const map = {};
        (profiles || []).forEach(p => { map[p.id] = p.full_name; });
        setRequesterNames(map);
      } else {
        setRequesterNames({});
      }
      // Which of the distinct supplier_profile_ids on these returns have an
      // active Cargo portal account? Drives the stage-1 footer branch.
      // The map's values are canonical supplier_profiles.name for label use.
      const supplierProfileIds = [...new Set(items.map(i => i.supplier_profile_id).filter(Boolean))];
      const portalMap = await fetchPortalEnabledSuppliers(supplierProfileIds);
      setPortalEnabledSuppliers(portalMap);
    } catch (err) {
      console.error('[ReturnsView load]', err);
      setLoadError(err?.message || 'fetch failed');
      setReturnItems([]);
      setPortalEnabledSuppliers(new Map());
    } finally {
      setLoading(false);
    }
  }, [tenantId, showArchived]);

  useEffect(() => { load(); }, [load]);

  // ── Stage classification ─────────────────────────────────────────────────
  const filteredItems = supplierFilter
    ? returnItems.filter(i => (i.supplier_name || 'Unknown supplier') === supplierFilter)
    : returnItems;

  const stages = useMemo(() => {
    const s = { 1: [], 2: [], 3: [], archived: [] };
    filteredItems.forEach(item => {
      if (item.status === 'archived') { s.archived.push(item); return; }
      const stg = stageOf(item);
      if (stg) s[stg].push(item);
    });
    return s;
  }, [filteredItems]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleGenerateSlip = (items) => {
    const ids = items.map(i => i.id);
    navigate(`/provisioning/return-slip?items=${ids.join(',')}`);
  };

  const handleMarkArchived = async (items) => {
    setActing(true);
    const ok = await confirmReturned(items.map(i => i.id), userId);
    if (ok) {
      showToast(`${items.length} item${items.length === 1 ? '' : 's'} archived`, 'success');
      await load();
    } else {
      showToast('Failed to archive', 'error');
    }
    setActing(false);
  };

  const handleCancelReturn = async (items) => {
    setActing(true);
    const ok = await cancelReturns(items.map(i => i.id));
    if (ok) {
      showToast('Items moved back to inbox', 'info');
      await load();
    } else {
      showToast('Failed to cancel returns', 'error');
    }
    setActing(false);
  };

  // Pick the single non-null supplier_profile_id shared across the group.
  // If items in the group disagree (mixed ids or any null), return null so
  // the group falls through to the slip flow — never silently route the
  // wrong supplier.
  const getGroupSupplierProfileId = (groupItems) => {
    const ids = new Set(groupItems.map(i => i.supplier_profile_id).filter(Boolean));
    return ids.size === 1 ? [...ids][0] : null;
  };

  const handleSendToPortal = async (items) => {
    const supplierProfileId = getGroupSupplierProfileId(items);
    if (!supplierProfileId) {
      showToast('Cannot route — supplier ambiguous on this return', 'error');
      return;
    }
    // Canonical name from the portal-enabled map; fall back to the OCR
    // snapshot only if the canonical somehow isn't available.
    const supplierName = portalEnabledSuppliers.get(supplierProfileId) || items[0]?.supplier_name || 'supplier';
    const itemsSnapshot = items.map(i => ({
      raw_name:      i.raw_name,
      quantity:      i.return_qty ?? i.quantity ?? null,
      unit:          i.unit ?? null,
      unit_price:    i.unit_price ?? null,
      return_reason: i.return_reason ?? null,
    }));
    setActing(true);
    const result = await sendReturnToPortal({
      supplierProfileId,
      tenantId,
      inboxIds: items.map(i => i.id),
      items:    itemsSnapshot,
      createdBy: userId,
    });
    if (result.ok) {
      showToast(`Return routed to ${supplierName}'s Cargo portal.`, 'success');
      await load();
    } else {
      showToast('Failed to route return — please try again.', 'error');
    }
    setActing(false);
  };

  const handleToggleSelect = (itemId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };
  const handleToggleGroup = (groupItems, allSelected) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      groupItems.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
      return next;
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="di-layout">
        <div className="di-main"><ErrorCard onRetry={load} message="Couldn't load returns" /></div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="di-layout">
        <div className="di-main"><div className="di-loading">Loading…</div></div>
      </div>
    );
  }
  const totalActive = stages[1].length + stages[2].length + stages[3].length;
  if (totalActive === 0 && (!showArchived || stages.archived.length === 0)) {
    return (
      <div className="di-layout">
        <div className="di-main">
          <div className="di-empty-card">
            <div className="di-empty-tile"><Icon name="PackageX" style={{ width: 20, height: 20 }} /></div>
            <h2 className="di-empty-headline">
              No pending returns<span className="di-empty-period">.</span>
            </h2>
            <p className="di-empty-text">
              Anything you flag for return shows up here, grouped by lifecycle stage.
            </p>
          </div>
        </div>
        <div className="di-rail">
          {/* Honest-zeros rail — pipeline reads 0/0/0; the filter and
              needs-action cards auto-collapse when there's nothing. */}
          <ReturnPipelineCard stages={stages} />
          <FilterBySupplierCard
            items={returnItems}
            selected={supplierFilter}
            onSelect={setSupplierFilter}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="di-layout">
      <div className="di-main">
        {[1, 2, 3].map(stage => (
          <section key={stage} className="di-stage-section">
            <p className="di-stage-section-label">
              {STAGE_SECTION_LABEL[stage]}
              <span className="di-stage-section-label-count">{stages[stage].length}</span>
            </p>
            {stages[stage].length === 0 ? (
              <p className="di-stage-section-empty">Nothing in this stage.</p>
            ) : (
              Object.entries(groupBySupplier(stages[stage])).map(([supplier, items]) => {
                const groupSupplierProfileId = getGroupSupplierProfileId(items);
                const canonicalName = groupSupplierProfileId ? portalEnabledSuppliers.get(groupSupplierProfileId) : null;
                const isPortalEnabled = !!canonicalName;
                return (
                  <ReturnsGroupCard
                    key={`${stage}-${supplier}`}
                    supplier={supplier}
                    items={items}
                    stage={stage}
                    selectedIds={selectedIds}
                    requesterNames={requesterNames}
                    onToggleSelect={handleToggleSelect}
                    onToggleGroup={handleToggleGroup}
                    onCancelReturn={handleCancelReturn}
                    onGenerateSlip={handleGenerateSlip}
                    onMarkArchived={handleMarkArchived}
                    onSendToPortal={handleSendToPortal}
                    isPortalEnabled={isPortalEnabled}
                    portalSupplierName={canonicalName}
                    acting={acting}
                  />
                );
              })
            )}
          </section>
        ))}
        {showArchived && stages.archived.length > 0 && (
          <section className="di-stage-section">
            <p className="di-stage-section-label">
              Archived returns
              <span className="di-stage-section-label-count">{stages.archived.length}</span>
            </p>
            {Object.entries(groupBySupplier(stages.archived)).map(([supplier, items]) => (
              <div key={`archived-${supplier}`} className="di-card">
                <div className="di-card-band">
                  <div className="di-card-band-icon"><Icon name="Archive" style={{ width: 16, height: 16 }} /></div>
                  <div className="di-card-band-text">
                    <p className="di-card-band-title">{supplier}</p>
                    <p className="di-card-band-sub">{items.length} item{items.length === 1 ? '' : 's'} · archived</p>
                  </div>
                  <div className="di-card-band-actions">
                    <span className="di-chip di-chip-archived">Archived</span>
                  </div>
                </div>
                <div className="di-card-body">
                  {items.map(item => (
                    <div key={item.id} className="di-row is-archived">
                      <div className="di-row-spacer-check" />
                      <div className="di-row-main">
                        <div className="di-row-name"><span>{item.raw_name}</span></div>
                        <p className="di-row-detail">
                          Qty: {item.return_qty ?? item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}
                          {item.return_confirmed_at && ` · archived ${fmtDateShort(item.return_confirmed_at)}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
      <div className="di-rail">
        <ReturnPipelineCard stages={stages} />
        <NeedsActionCard stages={stages} />
        <FilterBySupplierCard items={returnItems} selected={supplierFilter} onSelect={setSupplierFilter} />
      </div>
    </div>
  );
};

// ─── Bulk bar ───────────────────────────────────────────────────────────────
const BulkBar = ({ count, deliveryCount, boards, onClaimAll, onReturnAll, onDismissAll, onClear, claiming, tab, canReturn }) => {
  const [boardsOpen, setBoardsOpen] = useState(false);

  useEffect(() => {
    if (!boardsOpen) return;
    const h = (e) => { if (!e.target.closest('.di-bulkbar')) setBoardsOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [boardsOpen]);

  // The bar appears on the inbox tab for claim/return/dismiss bulk actions.
  // Returns-tab bulk is handled by its own per-stage footer actions.
  if (tab !== 'inbox') return null;

  return (
    <div className="di-bulkbar">
      <span className="di-bulkbar-label">
        {count} item{count === 1 ? '' : 's'} selected{deliveryCount > 0 ? ` across ${deliveryCount} deliver${deliveryCount === 1 ? 'y' : 'ies'}` : ''}
      </span>
      <div className="di-bulkbar-sep" />
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setBoardsOpen(v => !v)}
          disabled={claiming}
          className="di-bulkbar-btn di-bulkbar-btn-primary"
        >
          {claiming ? 'Claiming…' : 'Claim to board…'}
        </button>
        {boardsOpen && !claiming && (
          <div className="di-claim-all-pop" style={{ bottom: 'calc(100% + 6px)', top: 'auto' }}>
            {boards.length === 0
              ? <div className="di-claim-all-empty">No boards</div>
              : boards.map(b => (
                <button key={b.id} onClick={() => { setBoardsOpen(false); onClaimAll(b); }} className="di-claim-all-opt">
                  {b.title}
                </button>
              ))}
          </div>
        )}
      </div>
      {canReturn && (
        <button onClick={onReturnAll} disabled={claiming} className="di-bulkbar-btn di-bulkbar-btn-ghost">
          Return to supplier
        </button>
      )}
      <button onClick={onDismissAll} disabled={claiming} className="di-bulkbar-btn di-bulkbar-btn-ghost">
        Not my orders
      </button>
      <div className="di-bulkbar-spacer" />
      <button onClick={onClear} className="di-bulkbar-btn di-bulkbar-btn-quiet">Clear</button>
    </div>
  );
};

// ─── Main page ──────────────────────────────────────────────────────────────
const DeliveryInbox = () => {
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const userTier = (tenantRole || '').toUpperCase();
  const isCrew = userTier === 'CREW';
  const canReturn = userTier === 'COMMAND' || userTier === 'CHIEF';

  const [activeTab, setActiveTab] = useState('inbox');
  const [items, setItems] = useState([]);
  const [returnsCount, setReturnsCount] = useState(0);
  const [boards, setBoards] = useState([]);
  const [scannerNames, setScannerNames] = useState({});
  const [batchDocUrls, setBatchDocUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkFadingIds, setBulkFadingIds] = useState(new Set());
  const [bulkClaiming, setBulkClaiming] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [userFullName, setUserFullName] = useState('');
  const [inboxSupplierFilter, setInboxSupplierFilter] = useState(null);
  const [returnsSupplierFilter, setReturnsSupplierFilter] = useState(null);

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [inboxItems, userBoards, pendingReturns] = await Promise.all([
        fetchDeliveryInbox(activeTenantId, showArchived, user?.id),
        fetchProvisioningLists(activeTenantId, user?.id).catch(() => []),
        fetchPendingReturns(activeTenantId).catch(() => []),
      ]);
      setItems(inboxItems || []);
      setBoards(userBoards || []);
      setReturnsCount((pendingReturns || []).length);

      if (user?.id && !userFullName) {
        const { data: profile } = await supabase?.from('profiles')?.select('full_name')?.eq('id', user.id)?.maybeSingle();
        if (profile?.full_name) setUserFullName(profile.full_name);
      }

      const scannerIds = [...new Set((inboxItems || []).map(i => i.scanned_by).filter(Boolean))];
      if (scannerIds.length > 0) {
        const { data: profiles } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', scannerIds);
        const nameMap = {};
        (profiles || []).forEach(p => { nameMap[p.id] = p.full_name; });
        setScannerNames(nameMap);
      }

      const batchIds = [...new Set((inboxItems || []).map(i => i.delivery_batch_id).filter(Boolean))];
      if (batchIds.length > 0) {
        const { data: batches } = await supabase
          ?.from('provisioning_deliveries')?.select('id, invoice_file_url')?.in('id', batchIds);
        const urlMap = {};
        (batches || []).forEach(b => { if (b.invoice_file_url) urlMap[b.id] = b.invoice_file_url; });
        setBatchDocUrls(urlMap);
      }
    } catch (err) {
      console.error('[DeliveryInbox load]', err);
      setLoadError(err?.message || 'fetch failed');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, user?.id, showArchived, userFullName]);

  useEffect(() => { load(); }, [load]);

  // ── Reset selection when switching tabs ──────────────────────────────────
  useEffect(() => { setSelectedIds(new Set()); }, [activeTab]);

  // ── Action handlers (existing logic preserved verbatim) ──────────────────
  const handleClaimed = (itemId) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
  };

  const handleDismiss = async (itemId) => {
    const ok = await dismissInboxItem(itemId, user?.id);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      showToast('Item hidden from your inbox', 'info');
    } else {
      showToast('Failed to dismiss item', 'error');
    }
    return ok;
  };

  const handleReturn = async (itemId) => {
    const ok = await returnInboxItem(itemId, user?.id);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== itemId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      setReturnsCount(c => c + 1);
      showToast('Marked for return — see Returns tab', 'info');
    } else {
      showToast('Failed to mark for return', 'error');
    }
    return ok;
  };

  const handleToggleSelect = (itemId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };
  const handleToggleGroup = (groupItems, allSelected) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      groupItems.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
      return next;
    });
  };

  const handleBulkReturn = async () => {
    const selected = items.filter(i => selectedIds.has(i.id));
    if (!selected.length) return;
    const results = await Promise.allSettled(selected.map(item => returnInboxItem(item.id, user?.id)));
    const succeededItems = selected.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);
    const succeededIds = new Set(succeededItems.map(i => i.id));
    if (succeededItems.length > 0) {
      setItems(prev => prev.filter(i => !succeededIds.has(i.id)));
      setSelectedIds(new Set());
      setReturnsCount(c => c + succeededItems.length);
      setActiveTab('returns');
      showToast(`${succeededItems.length} queued for return`, 'info');
    }
    if (succeededItems.length < selected.length) {
      showToast(`${selected.length - succeededItems.length} failed`, 'error');
    }
  };

  const handleBulkDismiss = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map(id => dismissInboxItem(id, user?.id)));
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);
    if (succeededIds.length > 0) {
      setItems(prev => prev.filter(i => !succeededIds.includes(i.id)));
      setSelectedIds(new Set());
      showToast(`${succeededIds.length} hidden`, 'info');
    }
    if (succeededIds.length < ids.length) {
      showToast(`${ids.length - succeededIds.length} failed`, 'error');
    }
  };

  const handleBulkClaim = async (board) => {
    setBulkClaiming(true);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map(id => claimInboxItem(id, user?.id, board.id)));
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled' && results[i].value);
    succeededIds.forEach(id => {
      const item = items.find(i => i.id === id);
      if (!item) return;
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_INBOX_CLAIMED',
        entityType: 'provisioning_list',
        entityId: board.id,
        summary: `claimed "${item.raw_name}" from Delivery Inbox`,
        meta: { inbox_item_id: id, raw_name: item.raw_name, quantity: item.quantity, board_id: board.id, original_scanned_by: item.scanned_by },
      });
    });
    if (succeededIds.length > 0) {
      showToast(`${succeededIds.length} claimed to ${board.title}`, 'success');
      setBulkFadingIds(new Set(succeededIds));
      setTimeout(() => {
        setItems(prev => prev.filter(i => !succeededIds.includes(i.id)));
        setSelectedIds(prev => { const next = new Set(prev); succeededIds.forEach(id => next.delete(id)); return next; });
        setBulkFadingIds(new Set());
      }, 340);
    }
    if (succeededIds.length < ids.length) {
      showToast(`${ids.length - succeededIds.length} failed`, 'error');
    }
    setBulkClaiming(false);
  };

  // Group-level "Claim all" — uses the same path as bulk-claim but scoped to
  // one group's items, no checkbox selection required.
  const handleGroupClaimAllSucceeded = (succeededIds) => {
    setBulkFadingIds(new Set(succeededIds));
    setTimeout(() => {
      setItems(prev => prev.filter(i => !succeededIds.includes(i.id)));
      setSelectedIds(prev => { const next = new Set(prev); succeededIds.forEach(id => next.delete(id)); return next; });
      setBulkFadingIds(new Set());
    }, 340);
  };

  // ── CREW: hard-blocked (must come after hooks) ───────────────────────────
  if (isCrew) {
    return (
      <>
        <Header />
        <div className="di-blocked">
          <div className="di-blocked-card">
            <p className="di-blocked-title">You don’t have permission to view the Delivery Inbox.</p>
            <p className="di-blocked-body">It’s available to Command, Chief, and HOD officers.</p>
            <button onClick={() => navigate('/provisioning')} className="di-blocked-back">‹ Back to Provisioning</button>
          </div>
        </div>
      </>
    );
  }

  // The Delivery Inbox is a shared vessel-level pool — COMMAND / CHIEF /
  // HOD all see the same full pending pool (minus each user's own
  // dismissals, which fetchDeliveryInbox already filters out via
  // dismissed_by). CREW is hard-blocked above. PR #685 stripped this
  // filter once; the inbox editorial redesign (PR #692) accidentally
  // reintroduced it by rewriting the page with the filter copy-pasted
  // back in. This restores the fix.
  const visibleItems = items;

  // ── Inbox-tab: filter + group ────────────────────────────────────────────
  const inboxItems = inboxSupplierFilter
    ? visibleItems.filter(i => (i.supplier_name || 'Unknown supplier') === inboxSupplierFilter)
    : visibleItems;

  const groups = inboxItems.reduce((acc, item) => {
    const date = item.scanned_at ? new Date(item.scanned_at).toISOString().split('T')[0] : '1970-01-01';
    const key = `${item.scanned_by || 'unknown'}__${date}`;
    if (!acc[key]) acc[key] = { date, scannedBy: item.scanned_by, supplierName: item.supplier_name, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {});
  const sortedGroups = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));

  // ── Meta-strip counts (derived from already-loaded data) ─────────────────
  const pendingCount = visibleItems.filter(i => i.status === 'pending').length;
  const expiringSoonCount = visibleItems.filter(i => i.status === 'pending' && expiringSoonForCardEdge(i)).length;
  const deliveryCount = sortedGroups.length;

  // ── Selected items live across groups ─────────────────────────────────────
  const selectedItemsAcrossGroups = visibleItems.filter(i => selectedIds.has(i.id));
  const selectedDeliveryCount = new Set(
    selectedItemsAcrossGroups.map(i =>
      `${i.scanned_by || 'unknown'}__${i.scanned_at ? new Date(i.scanned_at).toISOString().split('T')[0] : '1970-01-01'}`)
  ).size;

  // ── Render ───────────────────────────────────────────────────────────────
  const inboxTabCount = pendingCount;
  const returnsTabCount = returnsCount;

  return (
    <>
      <Header />
      <div className="di">
        <div className="di-page">
          <button className="di-back" onClick={() => navigate('/provisioning')}>
            ‹ Back to Provisioning
          </button>

          {/* Editorial header — meta strip + serif headline (per tab) */}
          <div className="di-headblock">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Delivery Inbox</span>
              {activeTab === 'inbox' ? (
                <>
                  <span className="bar" />
                  <span className="muted">{deliveryCount} deliver{deliveryCount === 1 ? 'y' : 'ies'}</span>
                  <span className="bar" />
                  <span className="muted">{pendingCount} unclaimed item{pendingCount === 1 ? '' : 's'}</span>
                  <span className="bar" />
                  <span className="muted">{expiringSoonCount} expiring soon</span>
                </>
              ) : (
                <>
                  <span className="bar" />
                  <span className="muted">{returnsCount} item{returnsCount === 1 ? '' : 's'} to return</span>
                </>
              )}
            </p>
            <h1 className="editorial-greeting">
              {activeTab === 'inbox' ? (
                <>INBOX<span className="period">,</span> <em>unclaimed</em><span className="period">.</span></>
              ) : (
                <>RETURNS<span className="period">,</span> <em>in flight</em><span className="period">.</span></>
              )}
            </h1>
          </div>

          {/* Tabs */}
          <div className="di-tabs">
            <button
              onClick={() => setActiveTab('inbox')}
              className={`di-tab${activeTab === 'inbox' ? ' is-active' : ''}`}
            >
              Inbox
              {inboxTabCount > 0 && <span className="di-tab-count">{inboxTabCount}</span>}
            </button>
            <button
              onClick={() => setActiveTab('returns')}
              className={`di-tab${activeTab === 'returns' ? ' is-active' : ''}`}
            >
              Returns
              {returnsTabCount > 0 && <span className="di-tab-count">{returnsTabCount}</span>}
            </button>
            <div className="di-tabs-spacer" />
            <label className="di-archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>

          {/* Main + Rail */}
          {activeTab === 'returns' ? (
            <ReturnsView
              tenantId={activeTenantId}
              userId={user?.id}
              userFullName={userFullName}
              showArchived={showArchived}
              supplierFilter={returnsSupplierFilter}
              setSupplierFilter={setReturnsSupplierFilter}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
            />
          ) : loadError ? (
            <div className="di-layout">
              <div className="di-main"><ErrorCard onRetry={load} message="Couldn't load the delivery inbox" /></div>
            </div>
          ) : loading ? (
            <div className="di-layout">
              <div className="di-main"><div className="di-loading">Loading…</div></div>
            </div>
          ) : sortedGroups.length === 0 ? (
            <div className="di-layout">
              <div className="di-main">
                <div className="di-empty-card">
                  <div className="di-empty-tile"><Icon name="Inbox" style={{ width: 20, height: 20 }} /></div>
                  <h2 className="di-empty-headline">
                    {inboxSupplierFilter ? 'Nothing from this supplier' : 'All clear'}<span className="di-empty-period">.</span>
                  </h2>
                  <p className="di-empty-text">
                    {inboxSupplierFilter
                      ? 'Try clearing the supplier filter to see the rest of the inbox.'
                      : 'No unclaimed delivery items. New scans land here for the whole vessel to triage.'}
                  </p>
                </div>
              </div>
              <div className="di-rail">
                <InboxStatsCard items={visibleItems} deliveryCount={deliveryCount} />
                <FilterBySupplierCard items={visibleItems} selected={inboxSupplierFilter} onSelect={setInboxSupplierFilter} />
              </div>
            </div>
          ) : (
            <div className="di-layout">
              <div className="di-main">
                {sortedGroups.map(group => {
                  const groupKey = `${group.scannedBy || 'unknown'}__${group.date}`;
                  return (
                    <InboxGroupCard
                      key={groupKey}
                      group={group}
                      boards={boards}
                      userId={user?.id}
                      scannerNames={scannerNames}
                      selectedIds={selectedIds}
                      batchDocUrls={batchDocUrls}
                      onToggleSelect={handleToggleSelect}
                      onToggleGroup={handleToggleGroup}
                      onItemClaimed={handleClaimed}
                      onPartialClaim={load}
                      onItemDismiss={handleDismiss}
                      onItemReturn={handleReturn}
                      onGroupClaimAllSucceeded={handleGroupClaimAllSucceeded}
                      canReturn={canReturn}
                      bulkFadingIds={bulkFadingIds}
                    />
                  );
                })}
              </div>
              <div className="di-rail">
                <ExpiringSoonCard items={visibleItems} />
                <InboxStatsCard items={visibleItems} deliveryCount={deliveryCount} />
                <FilterBySupplierCard items={visibleItems} selected={inboxSupplierFilter} onSelect={setInboxSupplierFilter} />
              </div>
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <BulkBar
            count={selectedIds.size}
            deliveryCount={selectedDeliveryCount}
            boards={boards}
            onClaimAll={handleBulkClaim}
            onReturnAll={handleBulkReturn}
            onDismissAll={handleBulkDismiss}
            onClear={() => setSelectedIds(new Set())}
            claiming={bulkClaiming}
            tab={activeTab}
            canReturn={canReturn}
          />
        )}
      </div>
    </>
  );
};

export default DeliveryInbox;
