import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrderById, updateOrderStatus, updateOrderItem, fetchOrderActivity, fetchInvoiceSignedUrl, fetchDocumentSignedUrl, generateOrderPdf, generateDeliveryNote, quoteOrderItem, confirmOrderItem } from '../utils/supplierStorage';
import { usePermission } from '../../../contexts/SupplierPermissionContext';
import EditDeliveryModal from '../components/EditDeliveryModal';
import ReassignModal from '../components/ReassignModal';
import GenerateInvoiceModal from '../components/GenerateInvoiceModal';
import SupplierModal from '../components/SupplierModal';

const NO_PERMISSION_TITLE = "Your role doesn't have permission for this action.";

// ─── Timeline state machine ──────────────────────────────────────────────────
// Server status → which timeline step is "current". Statuses past `confirmed`
// (picking, packed, dispatched, invoiced) may not exist as DB enum values yet —
// they're rendered as future steps until the data layer catches up.
// Sprint 9c.2a: Schema migrated supplier_orders.status to a canonical
// 8-stage lifecycle (draft / sent / confirmed / dispatched /
// out_for_delivery / received / invoiced / paid). The supplier portal
// keeps its existing 7-step Timeline + supplier-friendly vocabulary —
// the editorial 8-stage indicator lands on the vessel side in the
// /provisioning/{boardId} Orders tab (Sprint 9c.2). The map below
// folds the new canonical values into the old supplier-side step
// indexes so this Timeline renders identically to its pre-migration
// behaviour.
const TIMELINE_STEPS = [
  { key: 'sent',       label: 'Sent' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'picking',    label: 'Picking' },
  { key: 'packed',     label: 'Packed' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered',  label: 'Delivered' },
  { key: 'invoiced',   label: 'Invoiced' },
];

const STATUS_TO_STEP_INDEX = {
  // Original supplier-portal mappings — preserved for legacy rows that
  // somehow retain old values + for the supplier-side display vocabulary.
  draft:               0,
  sent:                1,
  pending:             1,
  partially_confirmed: 1,
  confirming:          1,
  confirmed:           2,
  picking:             2,
  packed:              3,
  dispatched:          4,
  delivered:           5,
  invoiced:            6,
  // Canonical schema values added in 9c.2a → mapped to nearest existing
  // supplier-side display step. Vessel-side editorial Timeline is
  // separate and renders these natively.
  out_for_delivery:    4,    // → 'Dispatched' display
  received:            5,    // → 'Delivered' display
  paid:                6,    // → 'Invoiced' display
};

// ─── Date / number helpers ──────────────────────────────────────────────────

const safeDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
};

// "Thursday"
const fmtWeekday = (d) => {
  const dt = safeDate(d);
  return dt ? dt.toLocaleDateString('en-GB', { weekday: 'long' }) : null;
};

// "7"
const fmtDay = (d) => {
  const dt = safeDate(d);
  return dt ? dt.getDate() : null;
};

// "May"
const fmtMonth = (d) => {
  const dt = safeDate(d);
  return dt ? dt.toLocaleDateString('en-GB', { month: 'short' }) : null;
};

// "25 Apr · 09:14"
const fmtTimestamp = (d) => {
  const dt = safeDate(d);
  if (!dt) return null;
  const date = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
};

// "2 hours ago" / "5d ago"
const fmtRelative = (d) => {
  const dt = safeDate(d);
  if (!dt) return null;
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

// Whole days from today (00:00 local) to delivery date. Negative if past.
const daysUntil = (d) => {
  const dt = safeDate(d);
  if (!dt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dt);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
};

const formatCurrency = (amount, currency = 'USD') => {
  if (amount == null || isNaN(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
};

const initialsOf = (name) => {
  if (!name) return '—';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const firstNameOf = (name) => {
  if (!name) return null;
  return String(name).trim().split(/\s+/)[0] || null;
};

// Stub for actions whose backing flows aren't built yet (Sprints 8/9/10).
// Better than a silent click — see the dropdown action triage in the
// follow-up backlog notes.
const showComingSoon = (action) => window.alert(`"${action}" is coming soon.`);

// ─── Hero + action dropdowns ────────────────────────────────────────────────

const ActionDropdown = ({ open, top, children }) => {
  if (!open) return null;
  return (
    <div className="sod-action-dropdown" role="menu" style={{ top }}>
      {children}
    </div>
  );
};

const DropdownRow = ({ icon, name, link, empty, disabled, onClick }) => (
  <button
    type="button"
    role="menuitem"
    className={`sod-dd-row${empty ? ' sod-dd-empty' : ''}${disabled ? ' sod-dd-disabled' : ''}`}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
  >
    <span className="sod-dd-ico" aria-hidden="true">{icon}</span>
    <span className="sod-dd-info">
      <span className="sod-dd-name">{name}</span>
    </span>
    {link && <span className="sod-dd-link">{link}</span>}
  </button>
);

const HeroActions = ({
  documentsCount,
  openMenu,
  onToggle,
  onOpenDock,
  onOpenReturns,
  onOpenEditDelivery,
  onOpenReassign,
  onGenerateInvoice,
  onOpenInvoice,
  invoice,             // most-recent supplier_invoices row, or null/undefined
  orderHasPdf,         // boolean — supplier_orders.order_pdf_url is set
  orderPdfBusy,        // boolean — generation in flight
  onGenerateOrderPdf,
  onOpenOrderPdf,
  deliveryNote,        // { hasUnsigned, hasSigned } — derived from supplier_orders cols
  deliveryNoteBusy,
  onGenerateDeliveryNote,
  onOpenDeliveryNote,
  onOpenSignedDeliveryNote,
  canEdit,
}) => {
  const isOpen = (id) => openMenu === id;
  return (
    <div className="sod-hero-actions">
      <button
        type="button"
        className={isOpen('docs') ? 'sod-menu-open' : ''}
        onClick={(e) => { e.stopPropagation(); onToggle('docs'); }}
        aria-haspopup="menu"
        aria-expanded={isOpen('docs')}
      >
        <span className="sod-left">Documents</span>
        <span className="sod-left" style={{ gap: 0 }}>
          {documentsCount > 0 && <span className="sod-count-badge">{documentsCount}</span>}
          <span className="sod-caret" style={{ marginLeft: 6 }}>›</span>
        </span>
      </button>

      <button
        type="button"
        className={isOpen('actions') ? 'sod-menu-open' : ''}
        onClick={(e) => { e.stopPropagation(); onToggle('actions'); }}
        aria-haspopup="menu"
        aria-expanded={isOpen('actions')}
      >
        <span className="sod-left">Actions</span>
        <span className="sod-caret">›</span>
      </button>

      <button
        type="button"
        className={isOpen('returns') ? 'sod-menu-open' : ''}
        onClick={(e) => { e.stopPropagation(); onToggle('returns'); }}
        aria-haspopup="menu"
        aria-expanded={isOpen('returns')}
      >
        <span className="sod-left">Returns</span>
        <span className="sod-caret">›</span>
      </button>

      {/* Dropdowns positioned to the left of the action stack */}
      <ActionDropdown open={isOpen('docs')} top={0}>
        {/* Sprint 9b: Order PDF wired (Cargo-branded). Delivery note still
            pending later in this sprint. Invoice (supplier-branded) below.
            When a PDF exists we expose a primary "Open" row plus a compact
            secondary "Regenerate" row underneath — second click overwrites
            the same storage path and writes a fresh activity event. */}
        {orderHasPdf ? (
          <>
            <DropdownRow
              icon="📄"
              name="Order PDF"
              link="Open"
              onClick={onOpenOrderPdf}
            />
            <button
              type="button"
              role="menuitem"
              className={`sod-dd-row sod-dd-subrow${orderPdfBusy || !canEdit ? ' sod-dd-disabled' : ''}`}
              onClick={canEdit && !orderPdfBusy ? onGenerateOrderPdf : undefined}
              disabled={!canEdit || orderPdfBusy}
              aria-label="Regenerate order PDF"
            >
              <span className="sod-dd-name">
                ↻ {orderPdfBusy ? 'Regenerating…' : 'Regenerate'}
              </span>
            </button>
          </>
        ) : (
          <DropdownRow
            icon="📄"
            name={orderPdfBusy ? 'Generating order PDF…' : 'Generate order PDF'}
            disabled={!canEdit || orderPdfBusy}
            onClick={canEdit && !orderPdfBusy ? onGenerateOrderPdf : undefined}
          />
        )}
        {invoice ? (
          <DropdownRow
            icon="🧾"
            name={`Invoice ${invoice.invoice_number}`}
            link="Open"
            onClick={() => onOpenInvoice?.(invoice)}
          />
        ) : (
          <DropdownRow
            icon="🧾"
            name="Generate invoice"
            disabled={!canEdit}
            onClick={canEdit ? onGenerateInvoice : undefined}
          />
        )}
        {/* Delivery note: three states — none / unsigned generated / signed.
            Once signed, regenerate is locked (server returns 409). The signed
            row, when present, replaces the unsigned one rather than stacking
            on top — the signed copy is the canonical record. */}
        {deliveryNote.hasSigned ? (
          <DropdownRow
            icon="🚚"
            name="Signed delivery note"
            link="Open"
            onClick={onOpenSignedDeliveryNote}
          />
        ) : deliveryNote.hasUnsigned ? (
          <>
            <DropdownRow
              icon="🚚"
              name="Delivery note"
              link="Open"
              onClick={onOpenDeliveryNote}
            />
            <button
              type="button"
              role="menuitem"
              className={`sod-dd-row sod-dd-subrow${deliveryNoteBusy || !canEdit ? ' sod-dd-disabled' : ''}`}
              onClick={canEdit && !deliveryNoteBusy ? onGenerateDeliveryNote : undefined}
              disabled={!canEdit || deliveryNoteBusy}
              aria-label="Regenerate delivery note"
            >
              <span className="sod-dd-name">
                ↻ {deliveryNoteBusy ? 'Regenerating…' : 'Regenerate'}
              </span>
            </button>
          </>
        ) : (
          <DropdownRow
            icon="🚚"
            name={deliveryNoteBusy ? 'Generating delivery note…' : 'Generate delivery note'}
            disabled={!canEdit || deliveryNoteBusy}
            onClick={canEdit && !deliveryNoteBusy ? onGenerateDeliveryNote : undefined}
          />
        )}
      </ActionDropdown>

      <ActionDropdown open={isOpen('actions')} top={42}>
        {/* Duplicate / Message vessel are still placeholders pending their own
            sprints. Edit delivery + Reassign are wired to real modals. */}
        <DropdownRow
          icon="✎"
          name="Edit delivery"
          disabled={!canEdit}
          onClick={canEdit ? onOpenEditDelivery : undefined}
        />
        <DropdownRow
          icon="👤"
          name="Reassign"
          disabled={!canEdit}
          onClick={canEdit ? onOpenReassign : undefined}
        />
        <DropdownRow icon="⚓" name="Dock access notes" onClick={onOpenDock} />
        <div className="sod-dd-divider" role="separator" />
        <DropdownRow icon="⎘" name="Duplicate order"   onClick={() => showComingSoon('Duplicate order')} />
        <DropdownRow icon="✉" name="Message vessel"    onClick={() => showComingSoon('Message vessel')} />
      </ActionDropdown>

      <ActionDropdown open={isOpen('returns')} top={84}>
        <DropdownRow icon="+" name="Add return" onClick={onOpenReturns} />
        <DropdownRow icon="⮌" name="No returns yet" empty disabled />
      </ActionDropdown>
    </div>
  );
};

const Hero = ({
  order,
  orderShortId,
  documentsCount,
  openMenu,
  onToggleMenu,
  onOpenDock,
  onOpenReturns,
  onOpenEditDelivery,
  onOpenReassign,
  onGenerateInvoice,
  onOpenInvoice,
  invoice,
  orderHasPdf,
  orderPdfBusy,
  onGenerateOrderPdf,
  onOpenOrderPdf,
  deliveryNote,
  deliveryNoteBusy,
  onGenerateDeliveryNote,
  onOpenDeliveryNote,
  onOpenSignedDeliveryNote,
  canEdit,
}) => {
  const days = daysUntil(order.delivery_date);
  const showDays = days != null && days >= 0;

  const weekday = fmtWeekday(order.delivery_date);
  const day = fmtDay(order.delivery_date);
  const month = fmtMonth(order.delivery_date);
  const time = order.delivery_time
    ? String(order.delivery_time).slice(0, 5) // HH:mm
    : null;
  const portText = order.delivery_port || null;

  return (
    <div className="sod-hero">
      <div className="sod-hero-id">
        <div className="sod-hero-l">Order</div>
        <div className="sod-hero-id-n">#{orderShortId}</div>
      </div>

      <div className="sod-hero-countdown">
        <div className="sod-hero-l">Countdown</div>
        <div className="sod-hero-countdown-n">{showDays ? days : '—'}</div>
        <div className="sod-hero-countdown-u">{showDays ? (days === 1 ? 'day' : 'days') : 'no date'}</div>
      </div>

      <div className="sod-hero-when-block">
        <div className="sod-hero-when-eyebrow">
          Delivery{weekday ? ` · ${weekday}` : ''}
        </div>
        <div className="sod-hero-when">
          {day != null ? (
            <>
              <span className="sod-day">{day}</span>
              <span className="sod-month">{month}</span>
            </>
          ) : (
            <span className="sod-day" style={{ color: 'var(--muted)' }}>TBC</span>
          )}
        </div>
        <div className="sod-hero-where">
          {time && <span className="sod-mtag">{time}</span>}
          {portText ? <strong>{portText}</strong> : <span style={{ color: 'var(--muted)' }}>Port TBC</span>}
          {order.delivery_contact && (
            <>
              {' · '}
              {order.delivery_contact}
            </>
          )}
        </div>
      </div>

      <div className="sod-hero-right">
        <HeroActions
          documentsCount={documentsCount}
          openMenu={openMenu}
          onToggle={onToggleMenu}
          onOpenDock={onOpenDock}
          onOpenReturns={onOpenReturns}
          onOpenEditDelivery={onOpenEditDelivery}
          onOpenReassign={onOpenReassign}
          onGenerateInvoice={onGenerateInvoice}
          onOpenInvoice={onOpenInvoice}
          invoice={invoice}
          orderHasPdf={orderHasPdf}
          orderPdfBusy={orderPdfBusy}
          onGenerateOrderPdf={onGenerateOrderPdf}
          onOpenOrderPdf={onOpenOrderPdf}
          deliveryNote={deliveryNote}
          deliveryNoteBusy={deliveryNoteBusy}
          onGenerateDeliveryNote={onGenerateDeliveryNote}
          onOpenDeliveryNote={onOpenDeliveryNote}
          onOpenSignedDeliveryNote={onOpenSignedDeliveryNote}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
};

// ─── Timeline ───────────────────────────────────────────────────────────────

// Map order status to the index of the "current" step in TIMELINE_STEPS.
// Anything before the current index is "done"; anything after is "future".
const currentStepIndexFor = (status) => {
  const idx = STATUS_TO_STEP_INDEX[status];
  return typeof idx === 'number' ? idx : 1;  // fallback to "Confirming"
};

const Timeline = ({ order, items, canEdit, onAdvance }) => {
  const currentIdx = currentStepIndexFor(order.status);
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const totalCount = items.length;

  // Progress bar width as a fraction of the full track between dots. The
  // track sits inside 9px-from-each-edge (matches the CSS `left:9px;right:9px`),
  // so we scale by (currentIdx / (steps-1)).
  const progressFraction = currentIdx > 0
    ? Math.min(1, currentIdx / (TIMELINE_STEPS.length - 1))
    : 0;

  const stepWhen = (idx) => {
    if (idx === 0) {
      return fmtTimestamp(order.sent_at || order.created_at) || 'Sent';
    }
    if (idx === currentIdx) {
      // "Confirming" gets the X of Y progress hint.
      if (TIMELINE_STEPS[idx].key === 'confirming' && totalCount > 0) {
        return `Now · ${totalCount - pendingCount} of ${totalCount}`;
      }
      return 'Now';
    }
    if (idx < currentIdx) {
      // TODO(schema): per-step timestamps (picking_at, packed_at, …) need columns.
      return '✓';
    }
    // Future delivery step gets the planned date if we have one.
    if (TIMELINE_STEPS[idx].key === 'delivered' && order.delivery_date) {
      const dt = safeDate(order.delivery_date);
      return dt ? dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
    }
    return '—';
  };

  const handleStepClick = (idx) => {
    if (idx === currentIdx) return;             // no-op on current
    if (idx < currentIdx) {
      // Walking backward isn't supported via the UI — flag intent in console
      // and bail. Future work: an explicit "revert" affordance.
      console.warn('[SupplierOrderDetail] Backward step click ignored:', TIMELINE_STEPS[idx].key);
      return;
    }
    if (idx > currentIdx + 1) {
      window.alert(`Advance one step at a time. Next step: ${TIMELINE_STEPS[currentIdx + 1].label}.`);
      return;
    }
    if (!canEdit) {
      window.alert(NO_PERMISSION_TITLE);
      return;
    }
    const target = TIMELINE_STEPS[idx];
    const ok = window.confirm(`Advance order to "${target.label}"? This is logged on the order.`);
    if (!ok) return;
    onAdvance(target.key);
  };

  return (
    <div className="sod-timeline-card">
      <div className="sod-stepper-line">
        <div className="sod-stepper-progress" style={{ width: `calc((100% - 18px) * ${progressFraction})` }} />
        {TIMELINE_STEPS.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const cls = `sod-step${isDone ? ' sod-done' : ''}${isCurrent ? ' sod-current' : ''}`;
          return (
            <button
              key={step.key}
              type="button"
              className={cls}
              onClick={() => handleStepClick(idx)}
              aria-current={isCurrent ? 'step' : undefined}
              title={isCurrent ? 'Current step' : (idx > currentIdx ? `Advance to ${step.label}` : 'Already completed')}
            >
              <div className="sod-step-dot" />
              <div className="sod-step-name">{step.label}</div>
              <div className="sod-step-when">{stepWhen(idx)}</div>
            </button>
          );
        })}
      </div>
      <div className="sod-timeline-meta">
        Click a step to advance — confirmation required before any state change.
      </div>
    </div>
  );
};

// ─── Items table ────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  substituted: 'Substituted',
  unavailable: 'Unavailable',
  question: 'Question',
};

const STATUS_TO_ROW_CLASS = {
  pending:     'sod-row-pending',
  confirmed:   'sod-row-confirmed',
  substituted: 'sod-row-substituted',
  unavailable: 'sod-row-unavail',
  question:    'sod-row-question',
};

const STATUS_TO_LABEL_CLASS = {
  pending:     'sod-pending',
  confirmed:   'sod-confirmed',
  substituted: 'sod-substituted',
  unavailable: 'sod-unavail',
  question:    'sod-question',
};

// First-letter circle is the thumb fallback until we have item.category +
// dedicated icons. Cleaner than a generic 📦 box and never misleading.
const thumbLetterFor = (item) =>
  String(item?.item_name ?? '?').trim().charAt(0).toUpperCase() || '?';

const SendArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

// ─── Status-aware price cell ─────────────────────────────────────────────
//
// Renders the Price column based on the line's quote_status. Encapsulates
// the inline editor for awaiting_quote / declined states, the read-only
// renderings for quoted / agreed / in_discussion, and the muted greyed-out
// state for unavailable.
//
// Live-edit semantics:
//   - draft state holds whatever the supplier types
//   - blur OR Enter commits via onQuote
//   - Esc reverts to the last server-confirmed value
//   - Saves are debounced only by the explicit blur/Enter trigger — no
//     auto-save on keystroke (safer; predictable behaviour)
//
// The auto-accept BEFORE trigger handles the rest. See migration
// 20260429100100.

const PriceCell = ({ item, currency, canEdit, onQuote }) => {
  const status = item.quote_status || 'awaiting_quote';
  const fallbackCurrency = item.estimated_currency || currency || 'EUR';

  const editable = (status === 'awaiting_quote' || status === 'declined') && canEdit;

  const [draft, setDraft] = useState(() =>
    item.quoted_price != null
      ? String(item.quoted_price)
      : (item.estimated_price != null ? String(item.estimated_price) : '')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset the draft whenever the upstream item changes (e.g. after a save
  // round-trip, vessel decline that re-opens editing, etc.).
  useEffect(() => {
    setDraft(
      item.quoted_price != null
        ? String(item.quoted_price)
        : (item.estimated_price != null ? String(item.estimated_price) : '')
    );
    setError(null);
  }, [item.id, item.quoted_price, item.estimated_price, item.quote_status]);

  const commit = async () => {
    if (!editable || saving) return;
    const trimmed = (draft ?? '').trim();
    if (!trimmed) return; // empty = no save
    const next = Number(trimmed);
    if (Number.isNaN(next) || next < 0) {
      setError('Invalid price');
      return;
    }
    // No-op if the draft equals the current quoted_price — saves a round-trip.
    if (item.quoted_price != null && Number(item.quoted_price) === next) return;
    setSaving(true);
    setError(null);
    try {
      await onQuote(item.id, { quoted_price: next, quoted_currency: fallbackCurrency });
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(item.quoted_price != null ? String(item.quoted_price) : String(item.estimated_price ?? ''));
      e.target.blur();
    }
  };

  // Delta vs estimate for the active draft.
  const draftNum = Number(draft);
  const estNum = Number(item.estimated_price);
  let deltaChip = null;
  if (editable && !Number.isNaN(draftNum) && estNum > 0 && draftNum !== estNum) {
    const pct = ((draftNum - estNum) / estNum) * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const sign = pct >= 0 ? '+' : '';
    deltaChip = <span className={`sod-price-delta ${cls}`}>{sign}{pct.toFixed(1)}%</span>;
  }

  // ── Branch by status ──────────────────────────────────────────────────

  if (status === 'unavailable') {
    return (
      <div className="sod-price-cell">
        <span className="sod-price-readonly" style={{ color: 'var(--muted)' }}>—</span>
      </div>
    );
  }

  if (status === 'agreed') {
    const agreedFmt = formatCurrency(item.agreed_price, item.agreed_currency || fallbackCurrency);
    const drift = item.estimated_price != null
      && item.agreed_price != null
      && Number(item.estimated_price) !== Number(item.agreed_price);
    return (
      <div className="sod-price-cell">
        <span className="sod-price-quoted-label">Agreed</span>
        <span className="sod-price-readonly">{agreedFmt}</span>
        {drift && (
          <span className="sod-price-readonly-sub">
            est. {formatCurrency(item.estimated_price, item.estimated_currency || fallbackCurrency)}
          </span>
        )}
      </div>
    );
  }

  if (status === 'quoted' || status === 'in_discussion') {
    const quotedFmt = formatCurrency(item.quoted_price, item.quoted_currency || fallbackCurrency);
    const estFmt = formatCurrency(item.estimated_price, item.estimated_currency || fallbackCurrency);
    return (
      <div className="sod-price-cell">
        <span className="sod-price-quoted-label">
          {status === 'in_discussion' ? 'Quoted (in query)' : 'Quoted · awaiting vessel'}
        </span>
        <span className="sod-price-readonly">{quotedFmt}</span>
        {item.estimated_price != null && (
          <span className="sod-price-readonly-sub">est. {estFmt}</span>
        )}
        {status === 'in_discussion' && (
          <span className="sod-price-discussion-badge">In discussion</span>
        )}
      </div>
    );
  }

  // awaiting_quote / declined → editable
  return (
    <div className="sod-price-cell">
      <span className="sod-price-quoted-label">
        {status === 'declined' ? 'Re-quote' : 'Your quote'}
      </span>
      <div className="sod-price-input-wrap">
        <input
          type="number"
          step="0.01"
          min="0"
          className="sod-price-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          disabled={!canEdit || saving}
          title={canEdit ? 'Set your quoted price — Enter to save, Esc to revert' : NO_PERMISSION_TITLE}
        />
        <span className="sod-price-input-currency">{fallbackCurrency}</span>
        {deltaChip}
      </div>
      {item.estimated_price != null && (
        <span className="sod-price-readonly-sub">
          est. {formatCurrency(item.estimated_price, item.estimated_currency || fallbackCurrency)}
        </span>
      )}
      {status === 'declined' && (
        <span className="sod-price-declined-tag">Declined — adjust and confirm</span>
      )}
      {saving && <span className="sod-price-saving">saving…</span>}
      {error && <span className="sod-price-saving" style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
};

const ItemRow = ({ item, currency, canEdit, threadOpen, onToggleThread, onUpdate, onQuote }) => {
  const status = item.status || 'pending';
  const rowClass = STATUS_TO_ROW_CLASS[status] || '';
  const labelClass = STATUS_TO_LABEL_CLASS[status] || '';

  const messageCount = Number(item.message_count ?? 0);    // TODO(schema): item.message_count
  const unreadCount = Number(item.unread_message_count ?? 0); // TODO(schema): item.unread_message_count
  const showMsgIcon = messageCount > 0 || threadOpen;

  // TODO(schema): item.size, item.pack, item.brand, item.category, item.subcategory,
  //               item.type, item.requires_chilled, item.vintage_year, item.grade,
  //               item.unit_price (currently inferred from server only when available)
  const unitPrice = item.unit_price != null ? Number(item.unit_price) : null;

  const handleAct = async (next) => {
    try {
      const updates = { status: next };
      if (next === 'substituted' && item.substitute_description) {
        updates.substitute_description = item.substitute_description;
      }
      await onUpdate(item.id, updates);
    } catch (e) {
      window.alert(`Update failed: ${e.message}`);
    }
  };

  const isPending = status === 'pending';

  return (
    <>
      <tr className={`${rowClass}${threadOpen ? ' sod-has-thread' : ''}`}>
        <td>
          <div className="sod-item-cell">
            <div className="sod-item-thumb" aria-hidden="true">
              <span className="sod-item-thumb-letter">{thumbLetterFor(item)}</span>
            </div>
            <div>
              <div className="sod-item-name-row">
                <span className="sod-item-name">
                  {item.item_name}
                  {item.brand && <span className="sod-brand">{item.brand}</span>}
                </span>
                {STATUS_LABEL[status] && (
                  <span className={`sod-item-status ${labelClass}`}>{STATUS_LABEL[status]}</span>
                )}
                {showMsgIcon && (
                  <button
                    type="button"
                    className={`sod-msg-icon${unreadCount > 0 ? ' sod-has-new' : ''}`}
                    onClick={() => onToggleThread(item.id)}
                    title={threadOpen ? 'Hide messages' : 'View messages'}
                  >
                    <ChatIcon />
                    <span className="sod-msg-count">{messageCount}</span>
                  </button>
                )}
              </div>

              {/* TODO(schema): item.category / subcategory / type — breadcrumb */}
              {item.category && (
                <div className="sod-item-category">
                  {[item.category, item.subcategory, item.type]
                    .filter(Boolean)
                    .map((part, i, arr) => (
                      <React.Fragment key={i}>
                        {part}
                        {i < arr.length - 1 && <span className="sod-cat-sep">›</span>}
                      </React.Fragment>
                    ))}
                </div>
              )}

              {/* TODO(schema): item.requires_chilled / vintage_year / grade — chips */}
              {(item.requires_chilled || item.vintage_year || item.grade) && (
                <div className="sod-item-tags">
                  {item.requires_chilled && <span className="sod-tag sod-tag-cold">❄ Chilled</span>}
                  {item.vintage_year && <span className="sod-tag">{item.vintage_year} vintage</span>}
                  {item.grade && <span className="sod-tag">{item.grade}</span>}
                </div>
              )}

              {item.notes && <div className="sod-item-note">{item.notes}</div>}
              {status === 'substituted' && item.substitute_description && (
                <div className="sod-item-note">{item.substitute_description}</div>
              )}
            </div>
          </div>
        </td>

        <td className="sod-num">{item.unit ?? '—'}</td>
        <td className="sod-num">{item.size ?? '—'}{/* TODO(schema): item.size */}</td>
        <td className="sod-num">{item.quantity ?? '—'}</td>
        <td className={`sod-pack${item.pack ? '' : ' sod-empty'}`}>
          {item.pack ? String(item.pack).toLowerCase() : '—'}
          {/* TODO(schema): item.pack */}
        </td>
        <td>
          <PriceCell item={item} currency={currency} canEdit={canEdit} onQuote={onQuote} />
        </td>
        <td>
          <div className="sod-row-actions">
            {isPending ? (
              <>
                <button
                  type="button"
                  className="sod-confirm-btn"
                  disabled={!canEdit}
                  title={canEdit ? 'Confirm' : NO_PERMISSION_TITLE}
                  onClick={() => handleAct('confirmed')}
                >Confirm</button>
                <button
                  type="button"
                  className="sod-action-text-btn sod-act-sub"
                  disabled={!canEdit}
                  title={canEdit ? 'Substitute' : NO_PERMISSION_TITLE}
                  onClick={() => handleAct('substituted')}
                >Sub</button>
                <button
                  type="button"
                  className="sod-action-icon sod-act-unavail"
                  disabled={!canEdit}
                  title={canEdit ? 'Unavailable' : NO_PERMISSION_TITLE}
                  onClick={() => handleAct('unavailable')}
                ><SendArrow /></button>
              </>
            ) : (
              canEdit && (
                <button
                  type="button"
                  className="sod-pill sod-ghost"
                  style={{ fontSize: 11.5, padding: '4px 10px' }}
                  onClick={() => handleAct('pending')}
                  title="Reset to pending"
                >Edit</button>
              )
            )}
          </div>
        </td>
      </tr>

      {threadOpen && (
        <tr className="sod-thread-row">
          <td colSpan={7}>
            <div className="sod-thread">
              {/* TODO(out-of-scope): real threaded messages (storage + send + realtime) */}
              <div className="sod-thread-empty">
                No messages yet. Threaded messaging is not wired up — this is a UI stub.
              </div>
              <div className="sod-thread-input">
                <input
                  type="text"
                  placeholder="Send a follow-up — Cmd↵ to send"
                  disabled
                />
                <button type="button" disabled>Send</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const ItemsCard = ({
  items,
  currency,
  canEdit,
  openThreadId,
  onToggleThread,
  onItemUpdate,
  onItemQuote,
  onConfirmAll,
}) => {
  const itemCount = items.length;
  const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const counts = items.reduce((acc, i) => {
    const k = i.status || 'pending';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const subtotal = items.reduce((s, i) => {
    const price = Number(i.unit_price) || 0;
    const qty = Number(i.quantity) || 0;
    return s + price * qty;
  }, 0);

  const segs = [
    counts.pending     && { cls: 'sod-seg-pending',   label: `${counts.pending} pending` },
    counts.confirmed   && { cls: 'sod-seg-confirmed', label: `${counts.confirmed} confirmed` },
    counts.question    && { cls: 'sod-seg-question',  label: `${counts.question} question${counts.question === 1 ? '' : 's'}` },
    counts.substituted && { cls: 'sod-seg-question',  label: `${counts.substituted} substituted` },
    counts.unavailable && { cls: 'sod-seg-unavail',   label: `${counts.unavailable} unavailable` },
  ].filter(Boolean);

  const hasPending = (counts.pending || 0) > 0;

  return (
    <div className="sod-card">
      <div className="sod-items-toolbar">
        <div className="sod-items-summary">
          <span><strong>{itemCount} item{itemCount === 1 ? '' : 's'}</strong> · {totalQty} total</span>
          {segs.length > 0 && (
            <span className="sod-seg">
              {segs.map((s, i) => (
                <span key={i} className={s.cls}>{s.label}</span>
              ))}
            </span>
          )}
        </div>
        <div className="sod-items-actions">
          <button type="button" className="sod-pill sod-ghost" disabled title="Coming soon">+ Add line</button>
          <button
            type="button"
            className="sod-pill sod-primary"
            disabled={!canEdit || !hasPending}
            title={!canEdit ? NO_PERMISSION_TITLE : (!hasPending ? 'Nothing to confirm' : 'Confirm all available items')}
            onClick={onConfirmAll}
          >
            Confirm all available
            <span className="sod-kbd">A</span>
          </button>
        </div>
      </div>

      <table className="sod-items-table">
        <colgroup>
          <col className="sod-col-item" />
          <col className="sod-col-unit" />
          <col className="sod-col-size" />
          <col className="sod-col-qty" />
          <col className="sod-col-pack" />
          <col className="sod-col-price" />
          <col className="sod-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>Item</th>
            <th>Unit</th>
            <th>Size</th>
            <th>Qty</th>
            <th>Pack</th>
            <th>Price</th>
            <th className="sod-th-action">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              currency={currency}
              canEdit={canEdit}
              threadOpen={openThreadId === item.id}
              onToggleThread={onToggleThread}
              onUpdate={onItemUpdate}
              onQuote={onItemQuote}
            />
          ))}
        </tbody>
      </table>

      <div className="sod-totals-footer">
        <div className="sod-totals-row">
          <div className="sod-totals-label">Subtotal</div>
          <div className="sod-totals-value">{formatCurrency(subtotal, currency)}</div>
        </div>
        <div className="sod-totals-row">
          <div className="sod-totals-label">Delivery</div>
          <div className="sod-totals-value">{formatCurrency(0, currency)}</div>
        </div>
        <div className="sod-totals-row">
          <div className="sod-totals-label">VAT (estimated)</div>
          <div className="sod-totals-value">—</div>
        </div>
        <div className="sod-totals-row sod-totals-grand">
          <div className="sod-totals-label">Estimated Total</div>
          <div className="sod-totals-value">{formatCurrency(subtotal, currency)}</div>
        </div>
      </div>
    </div>
  );
};

// ─── Yacht client + standing notes + charter context + activity ────────────

const YachtClientCard = ({ order }) => {
  // TODO(schema): order.yacht_client_name, yacht_size_m, yacht_home_port,
  //               client_since, last_order_at, lifetime_total, lifetime_order_count
  const yachtName = order.yacht_client_name || order.vessel_name || order.yacht_name || null;
  const sizeM = order.yacht_size_m;
  const homePort = order.yacht_home_port;
  const since = safeDate(order.client_since);
  const sinceLabel = since ? since.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null;

  const specParts = [
    sizeM ? `${sizeM}m` : null,
    homePort ? `${homePort}-based` : null,
    sinceLabel ? `since ${sinceLabel}` : null,
  ].filter(Boolean);

  const lastOrderAt = safeDate(order.last_order_at);
  const lastOrderRel = lastOrderAt ? fmtRelative(lastOrderAt) : null;
  const lifetimeTotal = order.lifetime_total != null ? Number(order.lifetime_total) : null;
  const lifetimeCount = order.lifetime_order_count != null ? Number(order.lifetime_order_count) : null;

  return (
    <div className="sod-card">
      <div className="sod-card-head">
        <h4>Yacht client</h4>
        <button type="button" className="sod-card-link" onClick={() => { /* TODO(schema): yacht client profile route */ }}>
          View profile →
        </button>
      </div>
      <div className="sod-yacht-card-body">
        <div>
          <div className="sod-yacht-name">
            {yachtName ? <em>{yachtName}</em> : <em>—</em>}
          </div>
          <div className="sod-yacht-spec">
            {specParts.length > 0 ? specParts.join(' · ') : '—'}
          </div>
        </div>
        <div className="sod-yacht-stats">
          <div>
            <div className="sod-yacht-l">Last order</div>
            <div className="sod-yacht-v">
              {lastOrderRel ?? '—'}
              {/* TODO(schema): on-time/late flag for last order */}
            </div>
          </div>
          <div>
            <div className="sod-yacht-l">Lifetime</div>
            <div className="sod-yacht-v">
              {lifetimeTotal != null ? formatCurrency(lifetimeTotal, order.currency || 'USD') : '—'}
              {lifetimeCount != null && (
                <small>· {lifetimeCount} order{lifetimeCount === 1 ? '' : 's'}</small>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StandingNotesCard = ({ order }) => {
  // TODO(schema): order.delivery_window, order.dock_contact, order.on_arrival_notes
  const windowText = order.delivery_window || null;
  const dockContact = order.dock_contact || order.delivery_contact || null;
  const onArrivalText = order.on_arrival_notes || order.delivery_instructions || null;

  return (
    <div className="sod-card">
      <div className="sod-card-head">
        <h4>Standing notes</h4>
        <span className="sod-card-meta">Delivery rules</span>
      </div>
      <div className="sod-standing-card-body">
        <div className="sod-standing-row">
          <div className="sod-standing-l">Window</div>
          <div className="sod-standing-v">{windowText || '—'}</div>
        </div>
        <div className="sod-standing-row">
          <div className="sod-standing-l">Dock contact</div>
          <div className="sod-standing-v">
            {dockContact ? <strong>{dockContact}</strong> : '—'}
          </div>
        </div>
        <div className="sod-standing-row">
          <div className="sod-standing-l">On arrival</div>
          <div className="sod-standing-v">{onArrivalText || '—'}</div>
        </div>
      </div>
    </div>
  );
};

const CharterContextCard = ({ order, yachtDisplayName }) => {
  // TODO(schema): order.charter_context, charter_allergens, owner_aboard_dates
  const charterText = order.charter_context || order.special_instructions || null;
  return (
    <div className="sod-card" style={{ marginTop: 18 }}>
      <div className="sod-card-head">
        <h4>Charter context</h4>
        <span className="sod-card-meta">From {yachtDisplayName}'s provisioning board</span>
      </div>
      <div className="sod-ctx-body">
        <span className="sod-ctx-mark" aria-hidden="true">"</span>
        <div>
          {charterText ? (
            <>{charterText}</>
          ) : (
            <span style={{ color: 'var(--muted-strong)' }}>
              No charter context shared yet. The chief stew can attach trip details from the provisioning board.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// Format a single supplier_order_activity row for the Activity card. Returns
// { when, dotClass, title, sub } where dotClass keys the timeline marker
// colour (defined in supplier-portal.css).
const fmtActivityEvent = (event) => {
  const actor = event.actor_name
    || (event.actor_role === 'system' ? 'System' : 'Someone');
  const dt = new Date(event.created_at);
  const when = isNaN(dt.getTime())
    ? ''
    : dt.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

  switch (event.event_type) {
    case 'order_received':
      return {
        when, dotClass: 'sod-act-now',
        title: <>Order received from <em>{event.payload?.vessel_name || 'vessel'}</em></>,
        sub: `Sent via ${event.payload?.sent_via || 'email'}`,
      };
    case 'delivery_edited': {
      const fields = event.payload?.fields_changed || [];
      const labels = fields.map((f) => f.replace('delivery_', '').replace('_', ' '));
      return {
        when, dotClass: '',
        title: <>Delivery {labels.join(', ') || 'details'} updated</>,
        sub: `By ${actor}`,
      };
    }
    case 'reassigned':
      return {
        when, dotClass: '',
        title: 'Order reassigned',
        sub: `By ${actor}`,
      };
    case 'status_advanced':
      return {
        when, dotClass: 'sod-act-done',
        title: <>Status: {event.payload?.from} → <strong>{event.payload?.to}</strong></>,
        sub: `By ${actor}`,
      };
    case 'invoice_generated': {
      const cur = event.payload?.currency || 'EUR';
      const amt = event.payload?.amount;
      let amtStr = '';
      if (amt != null) {
        try {
          amtStr = ' · ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(amt));
        } catch { amtStr = ` · ${cur} ${Number(amt).toFixed(2)}`; }
      }
      return {
        when, dotClass: 'sod-act-done',
        title: <>Invoice <strong>{event.payload?.invoice_number || 'issued'}</strong>{amtStr}{event.payload?.bonded_supply ? ' · bonded' : ''}</>,
        sub: `By ${actor}`,
      };
    }
    case 'item_confirmed':
    case 'item_substituted':
    case 'item_unavailable':
      return {
        when, dotClass: '',
        title: <>{event.payload?.item_name || 'Item'} {event.event_type.replace('item_', '')}</>,
        sub: `By ${actor}`,
      };

    // Sprint 9.5 quote workflow events. Use the same fmt-money helper
    // pattern as invoice_generated so currency falls back gracefully.
    case 'quote_received': {
      const cur = event.payload?.quoted_currency || 'EUR';
      const amt = event.payload?.quoted_price;
      let amtStr = '';
      if (amt != null) {
        try { amtStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(amt)); }
        catch { amtStr = `${cur} ${Number(amt).toFixed(2)}`; }
      }
      const auto = event.payload?.auto_accepted;
      return {
        when,
        dotClass: auto ? 'sod-act-done' : '',
        title: <>Quote received — <em>{event.payload?.item_name || 'item'}</em>{amtStr ? ` at ${amtStr}` : ''}{auto ? ' · auto-accepted' : ''}</>,
        sub: `By ${actor}`,
      };
    }
    case 'quote_accepted': {
      const cur = event.payload?.agreed_currency || 'EUR';
      const amt = event.payload?.agreed_price;
      let amtStr = '';
      if (amt != null) {
        try { amtStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(amt)); }
        catch { amtStr = `${cur} ${Number(amt).toFixed(2)}`; }
      }
      return {
        when,
        dotClass: 'sod-act-done',
        title: <>Quote accepted — <em>{event.payload?.item_name || 'item'}</em>{amtStr ? ` at ${amtStr}` : ''}</>,
        sub: `By ${actor}`,
      };
    }
    case 'quote_declined':
      return {
        when, dotClass: '',
        title: <>Quote declined — <em>{event.payload?.item_name || 'item'}</em></>,
        sub: `By ${actor}`,
      };
    case 'order_pdf_generated':
      return {
        when, dotClass: 'sod-act-done',
        title: <>Order PDF generated</>,
        sub: `By ${actor}`,
      };
    case 'delivery_note_generated':
      return {
        when, dotClass: 'sod-act-done',
        title: <>Delivery note generated{event.payload?.signing_token_minted ? ' · signing link minted' : ''}</>,
        sub: `By ${actor}`,
      };
    case 'delivery_signed': {
      const advanced = event.payload?.status_advanced;
      const flagsBits = [];
      if (event.payload?.has_discrepancy_notes) flagsBits.push('discrepancies noted');
      if (advanced) flagsBits.push(`status → ${event.payload?.status_to || 'delivered'}`);
      const suffix = flagsBits.length ? ' · ' + flagsBits.join(' · ') : '';
      // actor on this event is the crew signer's typed name (no auth.uid()
      // because the capability URL is anonymous). fmtActivityEvent's
      // upstream `actor` resolves to that via actor_name.
      return {
        when, dotClass: 'sod-act-done',
        title: <>Delivery signed by <strong>{event.payload?.signer_name || actor}</strong>{suffix}</>,
        sub: 'Crew signature',
      };
    }
    case 'discussion_opened':
      return {
        when, dotClass: '',
        title: <>Query raised — <em>{event.payload?.item_name || 'item'}</em></>,
        sub: `By ${actor}`,
      };
    default:
      return { when, dotClass: '', title: event.event_type, sub: actor };
  }
};

const ACTIVITY_CARD_LIMIT = 5;

const ActivityCard = ({ activity, onViewAll }) => {
  const total = activity.length;
  const truncated = total > ACTIVITY_CARD_LIMIT;
  const visible = truncated ? activity.slice(0, ACTIVITY_CARD_LIMIT) : activity;
  return (
    <div className="sod-card" style={{ marginTop: 18 }}>
      <div className="sod-card-head">
        <h4>Activity</h4>
        <span className="sod-card-meta">
          {truncated ? `${ACTIVITY_CARD_LIMIT} most recent of ${total}` : 'All events on this order'}
        </span>
      </div>
      <div className="sod-activity-body">
        <ul className="sod-activity">
          {total === 0 && (
            <li style={{ color: 'var(--muted-strong)', fontSize: 13 }}>
              No activity yet.
            </li>
          )}
          {visible.map((event) => {
            const { when, dotClass, title, sub } = fmtActivityEvent(event);
            return (
              <li key={event.id} className={dotClass || undefined}>
                <div className="sod-act-when">{when}</div>
                <div className="sod-act-what">{title}</div>
                {sub && <div className="sod-act-who">{sub}</div>}
              </li>
            );
          })}
        </ul>
        {truncated && (
          <div className="sod-activity-viewall">
            <button type="button" onClick={onViewAll}>
              View all activity ({total}) →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Full chronological list inside a SupplierModal shell. Reuses
// fmtActivityEvent so styling matches the on-page card exactly.
const ActivityDrawer = ({ open, onClose, activity }) => (
  <SupplierModal open={open} onClose={onClose} title="Activity">
    <div className="sod-activity-drawer-body">
      <ul className="sod-activity">
        {activity.length === 0 && (
          <li style={{ color: 'var(--muted-strong)', fontSize: 13 }}>
            No activity yet.
          </li>
        )}
        {activity.map((event) => {
          const { when, dotClass, title, sub } = fmtActivityEvent(event);
          return (
            <li key={event.id} className={dotClass || undefined}>
              <div className="sod-act-when">{when}</div>
              <div className="sod-act-what">{title}</div>
              {sub && <div className="sod-act-who">{sub}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  </SupplierModal>
);

// ─── Drawer ─────────────────────────────────────────────────────────────────

const Drawer = ({ open, onClose, title, children }) => {
  // Lock body scroll while a drawer is open + add an Escape-to-close handler.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="sod-drawer-overlay" onClick={onClose} />
      <aside className="sod-drawer sod-drawer-open" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sod-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="sod-drawer-close" onClick={onClose}>Close</button>
        </div>
        <div className="sod-drawer-body">{children}</div>
      </aside>
    </>
  );
};

const ReturnsDrawerBody = () => (
  <div className="sod-drawer-empty">
    <div className="sod-drawer-empty-ico" aria-hidden="true">↺</div>
    <p>No returns recorded on this order yet. Returns are filed against confirmed items after delivery.</p>
    <button type="button" className="sod-drawer-cta" disabled title="Coming soon">+ Add return</button>
  </div>
);

const DockDrawerBody = ({ order }) => {
  // TODO(schema): order.delivery_window, dock_contact, on_arrival_notes
  const windowText = order.delivery_window || null;
  const dockContact = order.dock_contact || order.delivery_contact || null;
  const onArrivalText = order.on_arrival_notes || order.delivery_instructions || null;
  const portText = order.delivery_port || null;

  return (
    <>
      <section>
        <h5>Marina</h5>
        <p>{portText ? <strong>{portText}</strong> : '—'}</p>
      </section>
      <section>
        <h5>Window</h5>
        <p>{windowText || '—'}</p>
      </section>
      <section>
        <h5>Dock contact</h5>
        <p>{dockContact ? <strong>{dockContact}</strong> : '—'}</p>
      </section>
      <section>
        <h5>On arrival</h5>
        <p>{onArrivalText || '—'}</p>
      </section>
    </>
  );
};

// ─── Page ───────────────────────────────────────────────────────────────────

const SupplierOrderDetail = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { allowed: canEdit } = usePermission('orders:edit');

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);          // 'docs' | 'actions' | 'returns' | null
  const [openThreadId, setOpenThreadId] = useState(null);  // item.id whose thread is expanded
  const [returnsDrawerOpen, setReturnsDrawerOpen] = useState(false);
  const [dockDrawerOpen, setDockDrawerOpen] = useState(false);
  const [editDeliveryOpen, setEditDeliveryOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [generateInvoiceOpen, setGenerateInvoiceOpen] = useState(false);
  const [orderPdfBusy, setOrderPdfBusy] = useState(false);
  const [deliveryNoteBusy, setDeliveryNoteBusy] = useState(false);
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const heroRef = useRef(null);

  // Activity feed state — declared early so all the modal-save handlers below
  // can close over `refetchActivity` without hitting a temporal-dead-zone
  // error in the minified bundle.
  const [activity, setActivity] = useState([]);
  const refetchActivity = useCallback(() => {
    if (!orderId) return;
    fetchOrderActivity(orderId).then(setActivity).catch(() => setActivity([]));
  }, [orderId]);

  const toggleThread = useCallback((itemId) => {
    setOpenThreadId((prev) => (prev === itemId ? null : itemId));
  }, []);

  const toggleMenu = useCallback((id) => {
    setOpenMenu((prev) => (prev === id ? null : id));
  }, []);

  // Click-outside on the hero closes any open dropdown.
  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = (e) => {
      if (heroRef.current && !heroRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openMenu]);

  const handleOpenDock = useCallback(() => {
    setOpenMenu(null);
    setDockDrawerOpen(true);
  }, []);

  const handleOpenReturns = useCallback(() => {
    setOpenMenu(null);
    setReturnsDrawerOpen(true);
  }, []);

  const handleOpenEditDelivery = useCallback(() => {
    setOpenMenu(null);
    setEditDeliveryOpen(true);
  }, []);

  const handleOpenReassign = useCallback(() => {
    setOpenMenu(null);
    setReassignOpen(true);
  }, []);

  const handleOpenGenerateInvoice = useCallback(() => {
    setOpenMenu(null);
    setGenerateInvoiceOpen(true);
  }, []);

  // Open the existing invoice's PDF in a new tab. Mints a fresh signed URL
  // each time — the row's pdf_url is the storage path, not a URL.
  const handleOpenInvoice = useCallback(async (invoice) => {
    setOpenMenu(null);
    if (!invoice?.id) return;
    try {
      const res = await fetchInvoiceSignedUrl(invoice.id);
      if (res?.signed_url) {
        window.open(res.signed_url, '_blank', 'noopener');
      } else {
        window.alert('Could not open invoice — no signed URL returned.');
      }
    } catch (e) {
      window.alert(`Could not open invoice: ${e.message}`);
    }
  }, []);

  // After a fresh invoice is generated, refetch the order so the
  // Documents row flips from "Generate" to "Open".
  const handleInvoiceGenerated = useCallback(() => {
    fetchOrderById(orderId).then(setOrder).catch(() => {});
    refetchActivity();
  }, [orderId, refetchActivity]);

  // Generate or regenerate the Cargo-branded order PDF. Server overwrites
  // order_pdf_url; we refetch to pick up the new path + timestamp, then open
  // the freshly minted signed URL.
  const handleGenerateOrderPdf = useCallback(async () => {
    setOpenMenu(null);
    if (orderPdfBusy) return;
    setOrderPdfBusy(true);
    try {
      const res = await generateOrderPdf(orderId);
      if (res?.signed_url) {
        window.open(res.signed_url, '_blank', 'noopener');
      }
      // Pick up the new pdf_url + generated_at on the order row.
      fetchOrderById(orderId).then(setOrder).catch(() => {});
      refetchActivity();
    } catch (e) {
      window.alert(`Could not generate order PDF: ${e.message || e}`);
    } finally {
      setOrderPdfBusy(false);
    }
  }, [orderId, orderPdfBusy, refetchActivity]);

  // Open the (already-generated) order PDF in a new tab via a fresh
  // signed URL.
  const handleOpenOrderPdf = useCallback(async () => {
    setOpenMenu(null);
    if (!orderId) return;
    try {
      const res = await fetchDocumentSignedUrl('order_pdf', orderId);
      if (res?.signed_url) {
        window.open(res.signed_url, '_blank', 'noopener');
      } else {
        window.alert('Could not open order PDF — no signed URL returned.');
      }
    } catch (e) {
      window.alert(`Could not open order PDF: ${e.message || e}`);
    }
  }, [orderId]);

  // Generate or regenerate the unsigned delivery note. Server mints (or
  // reuses) the delivery_signing_token, embeds it as a QR code, overwrites
  // the storage path. Refuses if the order has already been signed (409).
  const handleGenerateDeliveryNote = useCallback(async () => {
    setOpenMenu(null);
    if (deliveryNoteBusy) return;
    setDeliveryNoteBusy(true);
    try {
      const res = await generateDeliveryNote(orderId);
      if (res?.signed_url) {
        window.open(res.signed_url, '_blank', 'noopener');
      }
      fetchOrderById(orderId).then(setOrder).catch(() => {});
      refetchActivity();
    } catch (e) {
      window.alert(`Could not generate delivery note: ${e.message || e}`);
    } finally {
      setDeliveryNoteBusy(false);
    }
  }, [orderId, deliveryNoteBusy, refetchActivity]);

  const handleOpenDeliveryNote = useCallback(async () => {
    setOpenMenu(null);
    if (!orderId) return;
    try {
      const res = await fetchDocumentSignedUrl('delivery_note', orderId);
      if (res?.signed_url) {
        window.open(res.signed_url, '_blank', 'noopener');
      } else {
        window.alert('Could not open delivery note — no signed URL returned.');
      }
    } catch (e) {
      window.alert(`Could not open delivery note: ${e.message || e}`);
    }
  }, [orderId]);

  const handleOpenSignedDeliveryNote = useCallback(async () => {
    setOpenMenu(null);
    if (!orderId) return;
    try {
      const res = await fetchDocumentSignedUrl('delivery_note_signed', orderId);
      if (res?.signed_url) {
        window.open(res.signed_url, '_blank', 'noopener');
      } else {
        window.alert('Could not open signed delivery note — no signed URL returned.');
      }
    } catch (e) {
      window.alert(`Could not open signed delivery note: ${e.message || e}`);
    }
  }, [orderId]);

  // Modal save handlers — merge the row payload (which includes the joined
  // assigned_contact) back into local state so the page reflects the change
  // without a refetch, and fetch fresh activity entries written by the
  // log_supplier_order_changes trigger.
  const applyOrderUpdate = useCallback((updated) => {
    setOrder((prev) => prev ? { ...prev, ...updated } : prev);
    refetchActivity();
  }, [refetchActivity]);

  const handleStatusAdvance = useCallback(async (newStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      setOrder((prev) => prev ? { ...prev, status: newStatus } : prev);
      refetchActivity();
    } catch (e) {
      window.alert(`Failed to advance status: ${e.message}`);
    }
  }, [orderId, refetchActivity]);

  // Merge an updated supplier_order_items row back into local state.
  const mergeItem = useCallback((updated) => {
    if (!updated?.id) return;
    setOrder((prev) => prev ? {
      ...prev,
      supplier_order_items: prev.supplier_order_items.map((i) =>
        i.id === updated.id ? { ...i, ...updated } : i
      ),
    } : prev);
  }, []);

  // Status / sub / unavailable / reset-to-pending. The 'confirmed' branch
  // routes through confirmOrderItem so the quote auto-seeds at
  // estimated_price (which lets the auto-accept BEFORE trigger flip the
  // line straight to quote_status='agreed' on the no-change path).
  const handleItemUpdate = useCallback(async (itemId, updates) => {
    let updated;
    if (updates && updates.status === 'confirmed') {
      updated = await confirmOrderItem(itemId, {
        quoted_price: updates.quoted_price,
        quoted_currency: updates.quoted_currency,
      });
    } else {
      updated = await updateOrderItem(itemId, updates);
    }
    mergeItem(updated);
    refetchActivity();
  }, [mergeItem, refetchActivity]);

  // Pure quote save — supplier types a price into the inline input.
  // The auto-accept BEFORE trigger handles the rest server-side.
  const handleItemQuote = useCallback(async (itemId, payload) => {
    const updated = await quoteOrderItem(itemId, payload);
    mergeItem(updated);
    refetchActivity();
  }, [mergeItem, refetchActivity]);

  const handleConfirmAll = useCallback(async () => {
    if (!window.confirm('Confirm every pending item on this order?')) return;
    try {
      await updateOrderStatus(orderId, 'confirmed');
      setOrder((prev) => prev ? {
        ...prev,
        status: 'confirmed',
        supplier_order_items: prev.supplier_order_items.map((i) =>
          i.status === 'pending' ? { ...i, status: 'confirmed' } : i
        ),
      } : prev);
      refetchActivity();
    } catch (e) {
      window.alert(`Failed to confirm: ${e.message}`);
    }
  }, [orderId, refetchActivity]);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchOrderById(orderId)
      .then(setOrder)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [orderId]);

  // Activity feed: fire the initial fetch when orderId resolves. The state +
  // refetcher are declared at the top of the component so the modal-save
  // handlers above can close over them without hitting a TDZ error.
  useEffect(refetchActivity, [refetchActivity]);

  if (loading) {
    return (
      <div className="sod-page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
          Loading order…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sod-page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red)' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!order) return null;

  const items = order.supplier_order_items ?? [];
  const orderShortId = order.id.slice(0, 8).toUpperCase();
  const assigneeContact = order.assigned_contact || null;
  const assigneeName = assigneeContact?.name || null;
  // TODO(schema): order.created_by_name / sender role — for now we lean on
  // supplier_orders.vessel_name + the implicit "chief stew" role.
  const senderName = order.created_by_name || null;
  const senderRole = order.created_by_role || 'Chief stew';
  const sentRelative = fmtRelative(order.sent_at || order.created_at);
  const yachtDisplayName = order.vessel_name || order.yacht_name || 'the yacht';

  return (
    <div className="sod-page">

      {/* ── Crumb ── */}
      <div className="sod-crumb">
        <a onClick={() => navigate('/supplier/orders')}>Orders</a>
        <span className="sep">›</span>
        #{orderShortId}
      </div>

      {/* ── Page header: title + assignee chip ── */}
      <header className="sod-order-header">
        <div>
          <h1 className="sod-order-title">
            FROM{' '}
            <button
              type="button"
              className="sod-yacht-link"
              onClick={() => { /* TODO(schema): yacht client page link */ }}
            >
              {yachtDisplayName}.
            </button>
          </h1>
          <div className="sod-order-sub">
            {senderName
              ? <strong>{senderName}</strong>
              : <strong>{order.vessel_name || order.yacht_name || 'Vessel crew'}</strong>}
            {senderRole && <>, {senderRole}</>}
            {sentRelative && (
              <>
                <span className="sep">·</span>
                sent {sentRelative}
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`sod-header-assignee${assigneeName ? '' : ' sod-unassigned'}`}
          title={
            !canEdit
              ? NO_PERMISSION_TITLE
              : (assigneeName ? `Assigned to ${assigneeName} — click to reassign` : 'Unassigned — click to assign')
          }
          onClick={canEdit ? handleOpenReassign : undefined}
          disabled={!canEdit}
        >
          <span className="sod-av">{assigneeName ? initialsOf(assigneeName) : '—'}</span>
          <span className="sod-info">
            <span className="sod-label-tiny">{assigneeName ? 'Assigned' : 'Status'}</span>
            <span className="sod-name">{assigneeName ? firstNameOf(assigneeName) : 'Unassigned'}</span>
          </span>
        </button>
      </header>

      {/* ── Delivery hero with action dropdowns ── */}
      <div ref={heroRef}>
        {(() => {
          const latestInvoice = (order.invoices && order.invoices.length > 0) ? order.invoices[0] : null;
          const orderHasPdf = !!order.order_pdf_url;
          const deliveryNote = {
            hasUnsigned: !!order.delivery_note_pdf_url,
            hasSigned: !!order.delivery_note_signed_pdf_url,
          };
          // Documents badge counts each kind once. The signed delivery note
          // replaces the unsigned one rather than stacking.
          const docsCount =
            (latestInvoice ? 1 : 0) +
            (orderHasPdf ? 1 : 0) +
            (deliveryNote.hasSigned || deliveryNote.hasUnsigned ? 1 : 0);
          return (
            <Hero
              order={order}
              orderShortId={orderShortId}
              documentsCount={docsCount}
              openMenu={openMenu}
              onToggleMenu={toggleMenu}
              onOpenDock={handleOpenDock}
              onOpenReturns={handleOpenReturns}
              onOpenEditDelivery={handleOpenEditDelivery}
              onOpenReassign={handleOpenReassign}
              onGenerateInvoice={handleOpenGenerateInvoice}
              onOpenInvoice={handleOpenInvoice}
              invoice={latestInvoice}
              orderHasPdf={orderHasPdf}
              orderPdfBusy={orderPdfBusy}
              onGenerateOrderPdf={handleGenerateOrderPdf}
              onOpenOrderPdf={handleOpenOrderPdf}
              deliveryNote={deliveryNote}
              deliveryNoteBusy={deliveryNoteBusy}
              onGenerateDeliveryNote={handleGenerateDeliveryNote}
              onOpenDeliveryNote={handleOpenDeliveryNote}
              onOpenSignedDeliveryNote={handleOpenSignedDeliveryNote}
              canEdit={canEdit}
            />
          );
        })()}
      </div>

      {/* ── 7-state timeline ── */}
      <Timeline
        order={order}
        items={items}
        canEdit={canEdit}
        onAdvance={handleStatusAdvance}
      />

      {/* ── Items: toolbar, table with status stripes + thread row, totals footer ── */}
      <ItemsCard
        items={items}
        currency={order.currency || 'USD'}
        canEdit={canEdit}
        openThreadId={openThreadId}
        onToggleThread={toggleThread}
        onItemUpdate={handleItemUpdate}
        onItemQuote={handleItemQuote}
        onConfirmAll={handleConfirmAll}
      />

      {/* ── Yacht client + Standing notes (locked equal heights) ── */}
      <div className="sod-yacht-standing-row">
        <YachtClientCard order={order} />
        <StandingNotesCard order={order} />
      </div>

      {/* ── Charter context ── */}
      <CharterContextCard order={order} yachtDisplayName={yachtDisplayName} />

      {/* ── Activity ── */}
      <ActivityCard activity={activity} onViewAll={() => setActivityDrawerOpen(true)} />

      {/* ── Keyboard hint footer ── */}
      <div className="sod-kb-hint">
        <span className="sod-kb-key">C</span> confirm &nbsp;·&nbsp;
        <span className="sod-kb-key">S</span> substitute &nbsp;·&nbsp;
        <span className="sod-kb-key">U</span> unavailable &nbsp;·&nbsp;
        <span className="sod-kb-key">A</span> confirm all
      </div>

      {/* ── Drawers ── */}
      <Drawer
        open={returnsDrawerOpen}
        onClose={() => setReturnsDrawerOpen(false)}
        title="Returns"
      >
        <ReturnsDrawerBody />
      </Drawer>

      <Drawer
        open={dockDrawerOpen}
        onClose={() => setDockDrawerOpen(false)}
        title="Dock access"
      >
        <DockDrawerBody order={order} />
      </Drawer>

      {/* ── Edit delivery + Reassign modals ── */}
      <EditDeliveryModal
        order={order}
        open={editDeliveryOpen}
        onClose={() => setEditDeliveryOpen(false)}
        onSaved={applyOrderUpdate}
      />
      <ReassignModal
        order={order}
        open={reassignOpen}
        onClose={() => setReassignOpen(false)}
        onSaved={applyOrderUpdate}
      />
      <GenerateInvoiceModal
        orderId={order.id}
        items={items}
        supplierId={order.supplier_profile_id}
        open={generateInvoiceOpen}
        onClose={() => setGenerateInvoiceOpen(false)}
        onGenerated={handleInvoiceGenerated}
      />
      <ActivityDrawer
        open={activityDrawerOpen}
        onClose={() => setActivityDrawerOpen(false)}
        activity={activity}
      />
    </div>
  );
};

export default SupplierOrderDetail;
