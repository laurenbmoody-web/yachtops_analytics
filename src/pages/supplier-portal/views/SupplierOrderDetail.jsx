import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrderById, updateOrderStatus, updateOrderItem, fetchOrderActivity, fetchInvoiceSignedUrl, fetchDocumentSignedUrl, generateOrderPdf, generateDeliveryNote, sendDeliveryNoteEmails, quoteOrderItem, confirmOrderItem, markVesselApprovedSeen, supplierRequestLineReopen } from '../utils/supplierStorage';
import { fetchReturnTasksByOrderId, fetchReturnTasksCountForOrder, acknowledgeSupplierReturnTask, completeSupplierReturnTask } from '../utils/supplierReturnTasks';
import { TaskRow, TaskDetail } from '../components/SupplierReturnTaskCard';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';
import { usePermission } from '../../../contexts/SupplierPermissionContext';
import { UNIT_GROUPS, UNIT_GROUP_VALUES, normalizeUnit } from '../../../data/unitGroups';
import EditDeliveryModal from '../components/EditDeliveryModal';
import ReassignModal from '../components/ReassignModal';
import GenerateInvoiceModal from '../components/GenerateInvoiceModal';
import '../../../styles/editorial.css'; // shared editorial meta strip + serif greeting (matches orders list / marketplace)
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
  // Step 0 keys off the server-side 'sent' status but reads as "Received"
  // in the supplier UI — from the supplier's POV the order just landed
  // in their inbox; "Sent" is how the crew side describes the same event.
  { key: 'sent',       label: 'Received' },
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
    return new Intl.NumberFormat('en-GB', {
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
  returnsCount,        // integer — drives the count badge on the Returns button
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
  deliveryNote,        // { hasUnsigned, hasSigned, emailedAt } — derived from supplier_orders cols
  deliveryNoteBusy,
  deliveryNoteEmailBusy,
  onGenerateDeliveryNote,
  onOpenDeliveryNote,
  onOpenSignedDeliveryNote,
  onEmailDeliveryNote,
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

      {/* Returns: direct drawer trigger (no dropdown). Returns originate
          crew-side only, so the supplier's only action is "view" — wiring
          the button straight to the drawer is the honest UX. Count badge
          shows when ≥1 return is filed against this order. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenReturns(); }}
        aria-label={returnsCount > 0 ? `Returns (${returnsCount})` : 'Returns'}
      >
        <span className="sod-left">
          Returns
          {returnsCount > 0 && <span className="sod-count-badge">{returnsCount}</span>}
        </span>
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
            {/* Email signing link — disabled within the 30-min idempotency
                window. Server enforces the window too; the disable here is
                purely UX hint so the user doesn't click into a 200-already-sent
                response. */}
            {(() => {
              const emailedAt = deliveryNote.emailedAt;
              const minsAgo = emailedAt
                ? Math.floor((Date.now() - new Date(emailedAt).getTime()) / 60000)
                : null;
              const recentlyEmailed = minsAgo !== null && minsAgo < 30;
              const wasEverEmailed  = emailedAt != null;

              let label;
              if (deliveryNoteEmailBusy) {
                label = '✉ Sending…';
              } else if (recentlyEmailed) {
                label = `✉ Sent ${minsAgo === 0 ? 'just now' : `${minsAgo} min ago`}`;
              } else {
                label = wasEverEmailed ? '✉ Resend signing link' : '✉ Email signing link';
              }

              const disabled = !canEdit || deliveryNoteEmailBusy || recentlyEmailed;
              const tooltip = recentlyEmailed
                ? `Try again in ${30 - minsAgo} min.`
                : undefined;

              return (
                <button
                  type="button"
                  role="menuitem"
                  className={`sod-dd-row sod-dd-subrow${disabled ? ' sod-dd-disabled' : ''}`}
                  onClick={!disabled ? onEmailDeliveryNote : undefined}
                  disabled={disabled}
                  title={tooltip}
                  aria-label={wasEverEmailed ? 'Resend delivery note signing link' : 'Email delivery note signing link'}
                >
                  <span className="sod-dd-name">{label}</span>
                </button>
              );
            })()}
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

      {/* No returns dropdown — the Returns button above is a direct drawer
          trigger. Suppliers don't create returns from the portal; the
          drawer (with the real per-order task list) is the only surface. */}
    </div>
  );
};

const Hero = ({
  order,
  orderShortId,
  documentsCount,
  returnsCount,
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
  deliveryNoteEmailBusy,
  onGenerateDeliveryNote,
  onOpenDeliveryNote,
  onOpenSignedDeliveryNote,
  onEmailDeliveryNote,
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
          returnsCount={returnsCount}
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
          deliveryNoteEmailBusy={deliveryNoteEmailBusy}
          onGenerateDeliveryNote={onGenerateDeliveryNote}
          onOpenDeliveryNote={onOpenDeliveryNote}
          onOpenSignedDeliveryNote={onOpenSignedDeliveryNote}
          onEmailDeliveryNote={onEmailDeliveryNote}
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
      return fmtTimestamp(order.sent_at || order.created_at) || 'Received';
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

// Square-ish chat panel with a tail — used as the per-line "note to
// vessel" trigger AND the yacht-client "open inbox" affordance. The
// rectangular silhouette reads as sturdier than the rounded speech
// bubble it replaces; the two stacked lines hint at a written note.
const NoteBubble = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="13" rx="2.5" />
    <path d="M8 20l-1-3" />
    <line x1="7.5" y1="9" x2="16.5" y2="9" />
    <line x1="7.5" y1="13" x2="13.5" y2="13" />
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

  // Item-level status takes precedence — once marked unavailable, the
  // price input goes inert regardless of where quote_status sits.
  // Without this, "Unavailable" rows kept showing an editable quote
  // box, which let the supplier dirty the line accidentally.
  const itemUnavailable = item.status === 'unavailable';
  const editable = !itemUnavailable && (status === 'awaiting_quote' || status === 'declined') && canEdit;

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

  // ── Branch by status ──────────────────────────────────────────────────

  if (status === 'unavailable' || itemUnavailable) {
    return (
      <div className="sod-price-cell">
        <span className="sod-price-readonly" style={{ color: 'var(--muted)' }}>—</span>
      </div>
    );
  }

  // Single price column that flows with the line's status — the crew's
  // estimate is never surfaced here (intentional: supplier prices from
  // their own cost, not from a vessel-side budget guess). The label
  // tells the supplier where the line is in the lifecycle:
  //   awaiting_quote → "Quote required"   (editable input)
  //   quoted         → "Awaiting vessel"  (readonly)
  //   in_discussion  → "In query"         (readonly)
  //   agreed         → "Final"            (readonly, locked)
  //   declined       → "Re-quote"         (editable input)
  if (status === 'agreed') {
    const agreedFmt = formatCurrency(item.agreed_price, item.agreed_currency || fallbackCurrency);
    return (
      <div className="sod-price-cell">
        <span className="sod-price-quoted-label sod-price-final-label">Final</span>
        <span className="sod-price-readonly">{agreedFmt}</span>
      </div>
    );
  }

  if (status === 'quoted' || status === 'in_discussion') {
    const quotedFmt = formatCurrency(item.quoted_price, item.quoted_currency || fallbackCurrency);
    return (
      <div className="sod-price-cell">
        <span className="sod-price-quoted-label">
          {status === 'in_discussion' ? 'In query' : 'Awaiting vessel'}
        </span>
        <span className="sod-price-readonly">{quotedFmt}</span>
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
        {status === 'declined' ? 'Re-quote' : 'Quote required'}
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
      </div>
      {status === 'declined' && (
        <span className="sod-price-declined-tag">Declined — adjust and re-quote</span>
      )}
      {saving && <span className="sod-price-saving">saving…</span>}
      {error && <span className="sod-price-saving" style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
};

// ─── Editable cell (qty / unit / size) ─────────────────────────────────────
//
// Click-to-edit cell. Persists on blur / Enter, reverts on Escape. When the
// supplier overrides the crew's original value (qty/unit/size) we strike
// through the original (requested_*) alongside the new value so both sides
// can see exactly what changed against the original ask.
const EditableCell = ({
  value, requested, canEdit, onCommit,
  type = 'text', placeholder = '—', step,
  align = 'left', width,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);

  const requestedKey = requested == null ? '' : String(requested);
  const valueKey = value == null ? '' : String(value);
  const changed = canEdit && requestedKey !== '' && requestedKey !== valueKey;

  const begin = () => {
    if (!canEdit) return;
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = async () => {
    const trimmed = (draft ?? '').trim();
    let next;
    if (type === 'number') {
      if (trimmed === '') {
        next = null;
      } else {
        const n = Number(trimmed);
        if (Number.isNaN(n) || n < 0) { setEditing(false); return; }
        next = n;
      }
    } else {
      next = trimmed === '' ? null : trimmed;
    }
    const currentKey = value == null ? '' : String(value);
    const nextKey = next == null ? '' : String(next);
    if (currentKey === nextKey) { setEditing(false); return; }
    setSaving(true);
    try { await onCommit(next); }
    catch (e) { window.alert(`Save failed: ${e.message}`); }
    finally { setSaving(false); setEditing(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') {
      setDraft(value == null ? '' : String(value));
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        step={step}
        min={type === 'number' ? 0 : undefined}
        className={`sod-wq-edit sod-wq-edit-${align}`}
        style={width ? { width } : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        disabled={saving}
      />
    );
  }

  return (
    <button
      type="button"
      className={`sod-wq-edit-display sod-wq-edit-display-${align}${changed ? ' sod-wq-changed' : ''}${canEdit ? '' : ' sod-wq-readonly'}`}
      onClick={begin}
      title={changed ? `Vessel asked for ${requestedKey}` : (canEdit ? 'Click to edit' : '')}
      disabled={!canEdit}
    >
      {changed && <span className="sod-wq-strike">{requestedKey}</span>}
      <span className="sod-wq-val">{value == null || value === '' ? placeholder : valueKey}</span>
    </button>
  );
};

// ─── Unit select cell ──────────────────────────────────────────────────────
//
// Mirrors EditableCell's read-only display + strike-through-on-change
// semantics, but renders the value through a grouped <select> using
// the shared UNIT_GROUPS taxonomy (same list the captain sees on the
// provisioning board). Keeps Unit ↔ Size paired with the same
// vocabulary on both ends of the order.
//
// Legacy values that pre-date UNIT_GROUPS (e.g. "litre", "tin") are
// surfaced as a sticky option at the top of the list so the cell
// still reflects the saved value; once the supplier picks something
// from the dropdown, the row settles into the canonical vocabulary.
const UnitSelectCell = ({ value, requested, canEdit, onCommit }) => {
  const [saving, setSaving] = useState(false);

  // Normalise legacy spellings ("litre" → "l") so the saved value resolves to
  // the shared vocabulary. Only genuinely unknown (custom) values stay sticky.
  const norm = normalizeUnit(value);
  const requestedKey = requested == null ? '' : normalizeUnit(String(requested));
  const valueKey = value == null || value === '' ? '' : String(norm);
  const changed = canEdit && requestedKey !== '' && requestedKey !== valueKey;
  const legacy = value && !UNIT_GROUP_VALUES.has(norm);

  if (!canEdit) {
    return (
      <button
        type="button"
        className={`sod-wq-edit-display sod-wq-edit-display-left sod-wq-readonly${changed ? ' sod-wq-changed' : ''}`}
        disabled
      >
        {changed && <span className="sod-wq-strike">{requestedKey}</span>}
        <span className="sod-wq-val">{value == null || value === '' ? '—' : valueKey}</span>
      </button>
    );
  }

  const handleChange = async (e) => {
    const next = e.target.value || null;
    if ((next ?? '') === (value ?? '')) return;
    setSaving(true);
    try { await onCommit(next); }
    catch (err) { window.alert(`Save failed: ${err.message}`); }
    finally { setSaving(false); }
  };

  return (
    <span className={`sod-wq-unit-select${changed ? ' sod-wq-changed' : ''}`}>
      {changed && <span className="sod-wq-strike">{requestedKey}</span>}
      <select
        className="sod-wq-unit-select-control"
        value={legacy ? value : (norm || '')}
        onChange={handleChange}
        disabled={saving}
        title={changed ? `Vessel asked for ${requestedKey}` : 'Choose a unit'}
      >
        <option value="">—</option>
        {legacy && <option value={value}>{value}</option>}
        {UNIT_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((u) => <option key={u} value={u}>{u}</option>)}
          </optgroup>
        ))}
      </select>
    </span>
  );
};

// ─── Note / Sub column ─────────────────────────────────────────────────────
//
// One text input per row. Two writing conventions:
//   1. Type "Sub: <description>" → flip status to substituted +
//      set substitute_description = <description>.
//   2. Anything else → save as supplier_item_note. If the line was
//      previously substituted, that gets cleared (back to pending).
//
// Display value: shows "Sub: <description>" when substituted, else the
// supplier note, else empty (placeholder).
const NoteCell = ({ item, canEdit, onUpdate }) => {
  const isSub = item.status === 'substituted' && !!item.substitute_description;
  const initial = isSub
    ? `Sub: ${item.substitute_description}`
    : (item.supplier_item_note || '');

  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef(initial);

  useEffect(() => {
    setDraft(initial);
    lastSavedRef.current = initial;
  }, [item.id, item.status, item.substitute_description, item.supplier_item_note]);

  const commit = async () => {
    const trimmed = (draft ?? '').trim();
    if (trimmed === (lastSavedRef.current ?? '').trim()) return;
    const subMatch = trimmed.match(/^sub:\s*(.+)$/i);
    const updates = {};
    if (subMatch) {
      updates.status = 'substituted';
      updates.substitute_description = subMatch[1].trim();
      updates.supplier_item_note = null;
    } else {
      updates.supplier_item_note = trimmed || null;
      // Clearing the Sub: prefix on a substituted line drops it back to
      // pending so the price/confirm flow can resume.
      if (item.status === 'substituted') {
        updates.status = 'pending';
        updates.substitute_description = null;
      }
    }
    setSaving(true);
    try {
      await onUpdate(item.id, updates);
      lastSavedRef.current = trimmed;
    } catch (e) {
      window.alert(`Save failed: ${e.message}`);
      setDraft(lastSavedRef.current);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') {
      setDraft(lastSavedRef.current);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      className={`sod-wq-note-input${isSub ? ' sod-wq-note-sub' : ''}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      placeholder='Note or "Sub: …"'
      disabled={!canEdit || saving}
    />
  );
};

// Status dot — the single visual signal for status on the new layout.
// Inline label chips (CONFIRMED / UNAVAILABLE / SUBSTITUTED) are gone.
const StatusDot = ({ status, revised = false }) => (
  <span
    className={`sod-wq-dot sod-wq-dot-${status || 'pending'}${revised ? ' is-revised' : ''}`}
    aria-hidden="true"
  />
);

// Reset (↺) icon used to drop a completed line back into the To do
// section. Replaces the old "Edit" ghost pill.
const ResetIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <polyline points="3 4 3 11 10 11" />
  </svg>
);

// X (Unavailable) icon.
const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="6" y1="18" x2="18" y2="6" />
  </svg>
);

// Tick (Confirm) icon — paired with X on every pending row so the
// supplier can commit a single priced line without using the bulk CTA.
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="4 12 10 18 20 6" />
  </svg>
);

const ItemRow = ({ item, currency, canEdit, onUpdate, onQuote }) => {
  const status = item.status || 'pending';
  const isPending = status === 'pending';
  const completed = !isPending;

  const setUnavailable = async () => {
    try { await onUpdate(item.id, { status: 'unavailable' }); }
    catch (e) { window.alert(`Update failed: ${e.message}`); }
  };
  // The reset/reopen affordance splits two ways:
  //
  //   - quote_status !== 'agreed' (supplier acted on their own;
  //     vessel hasn't approved yet) → silent flip back to pending.
  //     Lets the supplier fix typos / accidental confirms before
  //     the chief has signed off.
  //
  //   - quote_status === 'agreed' (vessel approved the quote, line
  //     is locked at the DB level too — see migration
  //     20260617260000) → "Request changes" path: prompt for a
  //     reason, write a 'supplier_requested_reopen' activity event
  //     so the crew board chip + pulse can flag the line for review.
  const vesselAgreed = item.quote_status === 'agreed';
  const handleResetOrReopen = async () => {
    if (vesselAgreed) {
      const reason = window.prompt(
        `Request changes on "${item.item_name}"?\n\n`
        + 'The vessel has already approved this line. Tell them why you need to revise '
        + '(supplier issue, stock, delivery delay, etc.) and the chief will be notified.',
      );
      if (!reason || !reason.trim()) return;
      try {
        await supplierRequestLineReopen(item.id, reason);
        // Bubble the change up through the order refetch so the
        // row re-renders as pending + the activity feed lights up.
        window.dispatchEvent(new Event('supplier-order-items-changed'));
        await onUpdate(item.id, {}); // no-op update to trigger parent re-fetch
      } catch (e) { window.alert(`Could not request changes: ${e.message}`); }
      return;
    }
    try {
      await onUpdate(item.id, {
        status: 'pending',
        substitute_description: null,
      });
    } catch (e) { window.alert(`Update failed: ${e.message}`); }
  };

  // Per-line confirm. Requires a quote price on the row — the vessel
  // needs the number to act on. The bulk "Confirm all available" CTA
  // sweeps the same path across every priced pending line.
  const hasQuote = item.quoted_price != null && Number(item.quoted_price) > 0;
  const hasAgreed = item.agreed_price != null && Number(item.agreed_price) > 0;
  const canConfirm = hasQuote || hasAgreed;
  const confirmLine = async () => {
    if (!canConfirm) {
      window.alert('Enter a quote price before confirming this line.');
      return;
    }
    try { await onUpdate(item.id, { status: 'confirmed' }); }
    catch (e) { window.alert(`Update failed: ${e.message}`); }
  };

  // Line total for the right-most column — same precedence the subtotal uses.
  const linePrice = Number(
    item.agreed_price ?? item.quoted_price ?? item.estimated_price ?? item.unit_price ?? 0,
  ) || 0;
  const lineTotal = linePrice * (Number(item.quantity) || 0);

  return (
    <div className={`sod-wq-row sod-wq-row-${status}${completed ? ' sod-wq-row-completed' : ''}`}>
      <div className="sod-wq-cell sod-wq-cell-status">
        <StatusDot status={status} revised={isPending && !!item.revised_at} />
      </div>

      <div className="sod-wq-cell sod-wq-cell-item">
        <div className="sod-wq-name">
          {status === 'substituted' && item.substitute_description ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{item.item_name}</span>
              <span style={{ color: 'var(--muted)' }}>→</span>
              <span style={{ color: 'var(--orange)', fontWeight: 600 }}>{item.substitute_description}</span>
              <span className="sod-wq-revised-chip" title="Substitute proposed for the vessel" style={{ background: '#FBEFE9', color: '#C65A1A' }}>Sub</span>
            </span>
          ) : (
            <>
              {item.item_name}
              {item.brand && <span className="sod-wq-brand">{item.brand}</span>}
            </>
          )}
          {isPending && item.revised_at && (
            <span
              className="sod-wq-revised-chip"
              title="Vessel reopened this line after you confirmed it — qty / unit / size / notes may have changed."
            >Revised</span>
          )}
        </div>
        {item.notes && (
          <div className="sod-wq-vessel-note">{item.notes}</div>
        )}
      </div>

      {/* Size before Unit — matches the captain-side board's reading
          rhythm (Size = the number, Unit = the measure from the
          shared UNIT_GROUPS dropdown). */}
      <div className="sod-wq-cell sod-wq-cell-size">
        <EditableCell
          value={item.size}
          requested={item.requested_size}
          canEdit={canEdit && !completed}
          onCommit={(v) => onUpdate(item.id, { size: v })}
          placeholder="—"
        />
      </div>

      <div className="sod-wq-cell sod-wq-cell-unit">
        <UnitSelectCell
          value={item.unit}
          requested={item.requested_unit}
          canEdit={canEdit && !completed}
          onCommit={(v) => onUpdate(item.id, { unit: v })}
        />
      </div>

      <div className="sod-wq-cell sod-wq-cell-qty">
        <EditableCell
          value={item.quantity}
          requested={item.requested_quantity}
          canEdit={canEdit && !completed}
          onCommit={(v) => onUpdate(item.id, { quantity: v })}
          type="number"
          step="1"
          align="right"
          placeholder="—"
        />
      </div>

      <div className="sod-wq-cell sod-wq-cell-price">
        <PriceCell item={item} currency={currency} canEdit={canEdit} onQuote={onQuote} />
      </div>

      <div className="sod-wq-cell sod-wq-cell-note">
        <NoteCell item={item} canEdit={canEdit} onUpdate={onUpdate} />
      </div>

      <div className="sod-wq-cell sod-wq-cell-total">
        {status === 'unavailable'
          ? <span className="sod-wq-unavail">Unavailable</span>
          : (linePrice > 0
              ? <span className="sod-wq-total">{formatCurrency(lineTotal, currency)}</span>
              : <span className="sod-wq-muted">—</span>)}
      </div>

      <div className="sod-wq-cell sod-wq-cell-action">
        {canEdit && (
          isPending ? (
            <>
              <button
                type="button"
                className="sod-wq-icon-btn sod-wq-icon-check"
                onClick={confirmLine}
                disabled={!canConfirm}
                title={canConfirm ? 'Confirm this line' : 'Enter a quote price first'}
                aria-label="Confirm this line"
              ><CheckIcon /></button>
              <button
                type="button"
                className="sod-wq-icon-btn sod-wq-icon-x"
                onClick={setUnavailable}
                title="Mark unavailable"
                aria-label="Mark unavailable"
              ><XIcon /></button>
            </>
          ) : (
            <button
              type="button"
              className="sod-wq-icon-btn"
              onClick={handleResetOrReopen}
              title={vesselAgreed
                ? 'Request changes — vessel will be notified'
                : 'Reset to pending'}
              aria-label={vesselAgreed ? 'Request changes' : 'Reset to pending'}
            ><ResetIcon /></button>
          )
        )}
      </div>
    </div>
  );
};

// ─── ItemsCard — work-queue + spreadsheet hybrid ───────────────────────────
//
// Header carries a progress bar + "Confirm all available" CTA. Items are
// split into two sections — "To do" (pending) at the top, "Done"
// (everything else, dimmed) at the bottom. Rows are spreadsheet-density
// with inline editable qty / unit / size / price / note; the Sub flow
// is folded into the note column ("Sub: …" prefix).
const ItemsCard = ({
  items,
  currency,
  canEdit,
  onItemUpdate,
  onItemQuote,
  onConfirmAll,
  onPriceAll,
  onMarkRestUnavailable,
}) => {
  const itemCount = items.length;
  const counts = items.reduce((acc, i) => {
    const k = i.status || 'pending';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const pendingItems = items.filter((i) => (i.status || 'pending') === 'pending');
  const doneItems    = items.filter((i) => (i.status || 'pending') !== 'pending');

  // Subtotal honours the strongest price signal available per line:
  // agreed > quoted > estimated > unit. Unavailable lines and lines with
  // no usable price at any level are excluded so the total reflects what
  // will actually invoice.
  //
  // VAT pulls from supplier_order_items.vat_rate_snapshot — that column
  // is populated at invoice generation time using the supplier's VAT
  // rules. Before then it's null on every line, so we show "on invoice"
  // rather than "—" / 0.00 to make clear the figure will land later.
  let subtotal = 0;
  let vatTotal = 0;
  let anyVatRate = false;
  for (const i of items) {
    if (i.status === 'unavailable') continue;
    const price = Number(
      i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0,
    ) || 0;
    const qty = Number(i.quantity) || 0;
    const lineTotal = price * qty;
    subtotal += lineTotal;
    const rate = Number(i.vat_rate_snapshot);
    if (!Number.isNaN(rate) && rate > 0) {
      anyVatRate = true;
      vatTotal += lineTotal * (rate / 100);
    }
  }
  const grandTotal = subtotal + vatTotal;

  // Value the supplier has proposed (re-quoted) that the vessel hasn't yet
  // agreed — the slice of the total still hanging on the buyer's approval.
  let pendingApprovalCount = 0;
  let pendingApprovalValue = 0;
  for (const i of items) {
    if (i.status === 'unavailable') continue;
    if (i.quote_status === 'quoted' && i.agreed_price == null) {
      pendingApprovalCount += 1;
      pendingApprovalValue += (Number(i.quoted_price) || 0) * (Number(i.quantity) || 0);
    }
  }

  // Progress segments for the header bar — done / sub / unavailable widths
  // sum to (done + sub + un) / total; the remaining gap is the "to do"
  // share. Each segment shows up only when its count is non-zero.
  const denom = itemCount || 1;
  const doneCt   = (counts.confirmed || 0);
  const subCt    = (counts.substituted || 0);
  const unCt     = (counts.unavailable || 0);
  const readyCt  = doneCt + subCt;

  const hasPending = (counts.pending || 0) > 0;

  return (
    <div className="sod-card sod-wq-card">

      {/* progress + CTA header */}
      <div className="sod-wq-head">
        <div className="sod-wq-progress">
          <div className="sod-wq-progress-label">
            <strong>{readyCt} of {itemCount} lines</strong> ready to send
            {(doneCt > 0 || subCt > 0 || unCt > 0) && (
              <span className="sod-wq-progress-meta">
                {doneCt > 0 && <> · {doneCt} confirmed</>}
                {subCt  > 0 && <> · {subCt} substituted</>}
                {unCt   > 0 && <> · {unCt} unavailable</>}
              </span>
            )}
          </div>
          <div className="sod-wq-bar">
            {doneCt > 0 && <i className="done" style={{ width: `${(doneCt / denom) * 100}%` }} />}
            {subCt  > 0 && <i className="sub"  style={{ width: `${(subCt  / denom) * 100}%` }} />}
            {unCt   > 0 && <i className="un"   style={{ width: `${(unCt   / denom) * 100}%` }} />}
          </div>
        </div>
        <div className="sod-wq-cta-wrap" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && hasPending && (
            <>
              <button type="button" onClick={onPriceAll} title="Set every unpriced pending line to its estimated price"
                style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--muted-s)' }}>
                Price all
              </button>
              <button type="button" onClick={onMarkRestUnavailable} title="Mark all remaining pending lines unavailable"
                style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--red)' }}>
                Mark rest unavailable
              </button>
            </>
          )}
          <button
            type="button"
            className="sod-wq-cta"
            disabled={!canEdit || !hasPending}
            title={!canEdit ? NO_PERMISSION_TITLE : (!hasPending ? 'Nothing to confirm' : 'Confirm all available items')}
            onClick={onConfirmAll}
          >
            Confirm all available
            <span className="sod-wq-kbd">A</span>
          </button>
        </div>
      </div>

      {/* column header strip — Size before Unit to match the captain
          board's order. */}
      <div className="sod-wq-cols">
        <div className="sod-wq-cell sod-wq-cell-status" />
        <div className="sod-wq-cell sod-wq-cell-item">Item</div>
        <div className="sod-wq-cell sod-wq-cell-size">Size</div>
        <div className="sod-wq-cell sod-wq-cell-unit">Unit</div>
        <div className="sod-wq-cell sod-wq-cell-qty">Qty</div>
        <div className="sod-wq-cell sod-wq-cell-price">Price</div>
        <div className="sod-wq-cell sod-wq-cell-note">Note / Sub</div>
        <div className="sod-wq-cell sod-wq-cell-total">Line total</div>
        <div className="sod-wq-cell sod-wq-cell-action" />
      </div>

      {/* Vessel-revised banner — lights when ≥1 pending line carries
          revised_at (set by reopenOrderItem on the vessel side). The
          supplier needs to know which lines went back to pending
          because the chief asked for changes, not because they were
          fresh. Banner sits above the To do section + each affected
          row also flags a per-line REVISED chip so it's discoverable
          even when scrolled. */}
      {(() => {
        const revisedCount = items.filter(
          (i) => (i.status || 'pending') === 'pending' && !!i.revised_at,
        ).length;
        if (revisedCount === 0) return null;
        return (
          <div className="sod-wq-revised-banner">
            <span className="sod-wq-revised-banner-dot" />
            <span className="sod-wq-revised-banner-text">
              <strong>Vessel revised {revisedCount} line{revisedCount === 1 ? '' : 's'}</strong>
              {' — please review the change'}{revisedCount === 1 ? '' : 's'}{' and re-confirm.'}
            </span>
          </div>
        );
      })()}

      {/* To do */}
      {pendingItems.length > 0 && (
        <div className="sod-wq-sec sod-wq-sec-todo">
          <div className="sod-wq-sec-head">
            <div className="sod-wq-sec-title">To do</div>
            <div className="sod-wq-sec-meta">
              {pendingItems.length} line{pendingItems.length === 1 ? '' : 's'} blocking send
            </div>
          </div>
          {pendingItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              currency={currency}
              canEdit={canEdit}
              onUpdate={onItemUpdate}
              onQuote={onItemQuote}
            />
          ))}
        </div>
      )}

      {/* Done */}
      {doneItems.length > 0 && (
        <div className="sod-wq-sec sod-wq-sec-done">
          <div className="sod-wq-sec-head">
            <div className="sod-wq-sec-title">Done</div>
            <div className="sod-wq-sec-meta">
              {doneCt > 0 && <span><span className="sod-wq-dot sod-wq-dot-confirmed" /> {doneCt} confirmed</span>}
              {subCt  > 0 && <span><span className="sod-wq-dot sod-wq-dot-substituted" /> {subCt} substituted</span>}
              {unCt   > 0 && <span><span className="sod-wq-dot sod-wq-dot-unavailable" /> {unCt} unavailable</span>}
            </div>
          </div>
          {doneItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              currency={currency}
              canEdit={canEdit}
              onUpdate={onItemUpdate}
              onQuote={onItemQuote}
            />
          ))}
        </div>
      )}

      {pendingItems.length === 0 && doneItems.length === 0 && (
        <div className="sod-wq-empty">No items on this order.</div>
      )}

      <div className="sod-totals-footer">
        <div className="sod-totals-row">
          <div className="sod-totals-label">Subtotal</div>
          <div className="sod-totals-value">{formatCurrency(subtotal, currency)}</div>
        </div>
        {pendingApprovalCount > 0 && (
          <div className="sod-totals-row" style={{ color: '#9A6700' }}>
            <div className="sod-totals-label" style={{ color: '#9A6700' }}>Awaiting vessel approval · {pendingApprovalCount} line{pendingApprovalCount === 1 ? '' : 's'}</div>
            <div className="sod-totals-value" style={{ color: '#9A6700' }}>{formatCurrency(pendingApprovalValue, currency)}</div>
          </div>
        )}
        <div className="sod-totals-row">
          <div className="sod-totals-label">Delivery</div>
          <div className="sod-totals-value">{formatCurrency(0, currency)}</div>
        </div>
        <div className="sod-totals-row">
          <div className="sod-totals-label">VAT</div>
          <div className="sod-totals-value">
            {anyVatRate
              ? formatCurrency(vatTotal, currency)
              : <span className="sod-totals-deferred">on invoice</span>}
          </div>
        </div>
        <div className="sod-totals-row sod-totals-grand">
          <div className="sod-totals-label">Estimated Total</div>
          <div className="sod-totals-value">{formatCurrency(grandTotal, currency)}</div>
        </div>
      </div>
    </div>
  );
};

// ─── Yacht client + standing notes + charter context + activity ────────────

const YachtClientCard = ({ order }) => {
  // TODO(schema): order.yacht_client_name, yacht_size_m, yacht_home_port,
  //               client_since, last_order_at, lifetime_total, lifetime_order_count
  const navigate = useNavigate();
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

  // Open the Messages inbox scoped to this order/yacht — the inbox view
  // currently shows a "coming soon" stub, but the query params let it
  // pre-select the right conversation once threaded messaging is wired
  // up (WhatsApp-style per-yacht thread list).
  const openMessages = () => {
    const params = new URLSearchParams();
    if (order.id) params.set('orderId', order.id);
    const yachtId = order.yacht_id || order.yacht_client_id;
    if (yachtId) params.set('yachtId', yachtId);
    const qs = params.toString();
    navigate(qs ? `/supplier/messages?${qs}` : '/supplier/messages');
  };

  return (
    <div className="sod-card">
      <div className="sod-card-head">
        <h4>Yacht client</h4>
        <div className="sod-card-head-actions">
          <button
            type="button"
            className="sod-card-msg-btn"
            onClick={openMessages}
            title="Message this yacht client"
            aria-label="Message this yacht client"
          >
            <NoteBubble />
          </button>
          <button type="button" className="sod-card-link" onClick={() => { /* TODO(schema): yacht client profile route */ }}>
            View profile →
          </button>
        </div>
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
          amtStr = ' · ' + new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(Number(amt));
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
        try { amtStr = new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(Number(amt)); }
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
        try { amtStr = new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(Number(amt)); }
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
    case 'delivery_note_emailed': {
      const recipientCount = event.payload?.recipient_count || (event.payload?.to?.length ?? 1);
      const resolution = event.payload?.resolution;
      const force = event.payload?.force;
      const bits = [];
      if (recipientCount > 1) bits.push(`${recipientCount} recipients`);
      if (resolution === 'role_match') bits.push('rotation match');
      if (resolution === 'command_fallback') bits.push('command fallback');
      if (force) bits.push('forced');
      const suffix = bits.length ? ' · ' + bits.join(' · ') : '';
      return {
        when, dotClass: 'sod-act-done',
        title: <>Delivery note signing link sent{suffix}</>,
        sub: `By ${actor}`,
      };
    }
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

// Returns drawer body — real, no longer a stub. Fetches
// supplier_return_tasks filed against THIS order (via order_id FK
// added in migration 20260527120000) and renders them using the same
// TaskRow / TaskDetail components that drive /supplier/returns, so
// the visual language is consistent. Returns originate crew-side
// only (slip page → route_return_to_portal); the drawer does NOT
// expose a "+ Add return" — the disabled stub button has been removed.
const ReturnsDrawerBody = ({ orderId, isOpen }) => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchReturnTasksByOrderId(orderId);
      setTasks(rows);
    } catch (e) {
      console.error('[ReturnsDrawerBody load]', e);
      setError(e.message || 'Failed to load returns');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  // Reload whenever the drawer opens — picks up newly-routed returns
  // and acknowledged-elsewhere status changes between opens.
  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const toggleExpanded = (taskId) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else                  next.add(taskId);
      return next;
    });
  };

  const handleAcknowledge = async (taskId, note) => {
    setActingId(taskId);
    setError(null);
    try {
      await acknowledgeSupplierReturnTask(taskId, {
        acknowledgedBy: user?.id || null,
        supplierNote:   note,
      });
      await load();
      window.dispatchEvent(new CustomEvent('supplier-return-tasks-changed'));
    } catch (e) {
      console.error('[ReturnsDrawerBody acknowledge]', e);
      setError(e.message || 'Failed to acknowledge return');
    } finally {
      setActingId(null);
    }
  };

  const handleComplete = async (taskId) => {
    setActingId(taskId);
    setError(null);
    try {
      await completeSupplierReturnTask(taskId);
      await load();
      window.dispatchEvent(new CustomEvent('supplier-return-tasks-changed'));
    } catch (e) {
      console.error('[ReturnsDrawerBody complete]', e);
      setError(e.message || 'Failed to mark completed');
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return (
      <div className="sod-drawer-empty">
        <p style={{ color: 'var(--muted)' }}>Loading returns…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>
        {error}
      </div>
    );
  }
  if (tasks.length === 0) {
    return (
      <div className="sod-drawer-empty">
        <div className="sod-drawer-empty-ico" aria-hidden="true">↺</div>
        <p>No returns recorded against this order.</p>
      </div>
    );
  }
  return (
    <div className="sp-return-rows">
      {tasks.map((t) => (
        <div key={t.id} className="sp-return-row-wrap">
          {/* hideOrderBadge — every task in this drawer is for THIS
              order, so the "From order #XXXX" badge would be redundant. */}
          <TaskRow
            task={t}
            expanded={expandedIds.has(t.id)}
            onToggle={() => toggleExpanded(t.id)}
            hideOrderBadge
          />
          {expandedIds.has(t.id) && (
            <TaskDetail
              task={t}
              onAcknowledge={handleAcknowledge}
              onComplete={handleComplete}
              busy={actingId === t.id}
            />
          )}
        </div>
      ))}
    </div>
  );
};

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
  const [returnsDrawerOpen, setReturnsDrawerOpen] = useState(false);
  // Count of supplier_return_tasks filed against this order — drives the
  // "Returns (N)" badge. Refreshed when the drawer closes and on the
  // shared 'supplier-return-tasks-changed' event so acknowledge/complete
  // from elsewhere stays in sync.
  const [returnsCount, setReturnsCount] = useState(0);
  const [dockDrawerOpen, setDockDrawerOpen] = useState(false);
  const [editDeliveryOpen, setEditDeliveryOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [generateInvoiceOpen, setGenerateInvoiceOpen] = useState(false);
  const [orderPdfBusy, setOrderPdfBusy] = useState(false);
  const [deliveryNoteBusy, setDeliveryNoteBusy] = useState(false);
  const [deliveryNoteEmailBusy, setDeliveryNoteEmailBusy] = useState(false);
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

  // Returns count for the page-header badge. Fetched on mount and re-
  // fetched whenever the drawer closes (the supplier may have actioned a
  // task, but the COUNT itself is invariant under status updates — only
  // the rare case of a new task arriving from outside changes it) and
  // on the shared 'supplier-return-tasks-changed' event for symmetry
  // with the layout-level nav badge.
  const refreshReturnsCount = useCallback(() => {
    if (!orderId) return;
    fetchReturnTasksCountForOrder(orderId).then(setReturnsCount).catch(() => setReturnsCount(0));
  }, [orderId]);
  useEffect(() => {
    refreshReturnsCount();
    const onChange = () => refreshReturnsCount();
    window.addEventListener('supplier-return-tasks-changed', onChange);
    return () => window.removeEventListener('supplier-return-tasks-changed', onChange);
  }, [refreshReturnsCount]);

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

  // Email the delivery note signing link to the receiving party (Sprint 9b
  // Commit 7). Server runs the 4-step recipient resolution chain, sends via
  // Resend, stamps delivery_note_emailed_at, and writes a delivery_note_emailed
  // activity event. The Documents dropdown button is gated on
  // delivery_note_pdf_url existing and outside the 30-min idempotency window;
  // this handler is defensive against both states (server returns 409/200
  // already_sent appropriately).
  const handleEmailDeliveryNote = useCallback(async () => {
    setOpenMenu(null);
    if (deliveryNoteEmailBusy) return;
    setDeliveryNoteEmailBusy(true);
    try {
      const res = await sendDeliveryNoteEmails(orderId);
      if (res?.already_sent) {
        const mins = Math.max(1, Math.ceil((res.remaining_window_seconds || 0) / 60));
        showToast(`Already sent — try again in ${mins} min`, 'info');
      } else {
        const sentTo = res?.sent_to || [];
        const label = sentTo.length === 0
          ? 'recipient'
          : sentTo.length === 1
          ? sentTo[0]
          : `${sentTo[0]} +${sentTo.length - 1} more`;
        showToast(`Signing link sent to ${label}`, 'success');
      }
      // Pick up the new emailed_at + activity row
      fetchOrderById(orderId).then(setOrder).catch(() => {});
      refetchActivity();
    } catch (e) {
      showToast(`Could not send: ${e?.message || e}`, 'error');
    } finally {
      setDeliveryNoteEmailBusy(false);
    }
  }, [orderId, deliveryNoteEmailBusy, refetchActivity]);

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

  // Bulk: price every unpriced pending line at its estimate (so the supplier
  // can then confirm in one sweep).
  const handlePriceAll = useCallback(async () => {
    const pend = (order?.supplier_order_items || []).filter(
      (i) => (i.status || 'pending') === 'pending' && i.quoted_price == null && i.estimated_price != null,
    );
    if (pend.length === 0) { window.alert('Every pending line already has a price.'); return; }
    if (!window.confirm(`Set ${pend.length} unpriced line${pend.length === 1 ? '' : 's'} to their estimated price?`)) return;
    try {
      for (const i of pend) await quoteOrderItem(i.id, { quoted_price: i.estimated_price, quoted_currency: i.estimated_currency });
      load();
      refetchActivity();
    } catch (e) { window.alert(`Failed to price: ${e.message}`); }
  }, [order, refetchActivity]);

  // Bulk: mark every remaining pending line unavailable.
  const handleMarkRestUnavailable = useCallback(async () => {
    const pend = (order?.supplier_order_items || []).filter((i) => (i.status || 'pending') === 'pending');
    if (pend.length === 0) { window.alert('No pending lines to mark.'); return; }
    if (!window.confirm(`Mark ${pend.length} remaining pending line${pend.length === 1 ? '' : 's'} as unavailable?`)) return;
    try {
      for (const i of pend) await updateOrderItem(i.id, { status: 'unavailable' });
      load();
      refetchActivity();
    } catch (e) { window.alert(`Failed: ${e.message}`); }
  }, [order, refetchActivity]);

  // Auto-ack the vessel-approved marker the first time the supplier
  // opens this order. Cheap no-op when the order doesn't carry one.
  // Fires the supplier-order-items-changed event so the topbar bell
  // re-polls its count and drops the badge immediately.
  useEffect(() => {
    if (!orderId) return;
    markVesselApprovedSeen(orderId).then(() => {
      try { window.dispatchEvent(new Event('supplier-order-items-changed')); } catch { /* noop */ }
    });
  }, [orderId]);

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

  // Meta-strip stats — line states + overall status from the timeline.
  const mItems = order.supplier_order_items || [];
  const mCur = order.currency || 'EUR';
  const mLineVal = (i) => (i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0) * (i.quantity ?? 1);
  const mTotal = mItems.reduce((s, i) => s + mLineVal(i), 0);
  const mConfirmed = mItems.filter(i => i.status === 'confirmed').length;
  const mSub = mItems.filter(i => i.status === 'substituted').length;
  const mUnavail = mItems.filter(i => i.status === 'unavailable').length;
  const mStatus = TIMELINE_STEPS[STATUS_TO_STEP_INDEX[order.status] ?? 1]?.label || order.status;
  const mMoney = (a) => new Intl.NumberFormat(undefined, { style: 'currency', currency: mCur, maximumFractionDigits: 0 }).format(a || 0);

  // Line-confirmation sub-state — surfaced as a pill under the title.
  const mPending = mItems.filter(i => (i.status || 'pending') === 'pending').length;
  const lineState = mItems.length === 0 ? null
    : mPending === 0 ? { bg: '#EAF6EF', fg: '#1D7A4D', dot: '#1D9E75', label: `All ${mItems.length} lines actioned` }
    : mPending === mItems.length ? { bg: '#F6F5F2', fg: '#8B8478', dot: '#AEB4C2', label: `Awaiting confirmation · ${mPending} line${mPending === 1 ? '' : 's'}` }
    : { bg: '#FEF6E7', fg: '#9A6700', dot: '#E0A63E', label: `Partially confirmed · ${mPending} to action` };

  return (
    <div className="sod-page">

      {/* ── Editorial meta strip ── */}
      <p className="editorial-meta" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <span className="dot">●</span>
        <span>#{orderShortId}</span>
        {sentRelative && <><span className="bar" /><span className="muted">sent {sentRelative}</span></>}
        <span className="bar" />
        <span className="muted">{mItems.length} items</span>
        <span className="bar" />
        <span className="muted">{mMoney(mTotal)} total</span>
        <span className="bar" />
        <span className="muted">{mConfirmed} confirmed</span>
        {mSub > 0 && <><span className="bar" /><span className="muted" style={{ color: 'var(--orange)' }}>{mSub} sub</span></>}
        {mUnavail > 0 && <><span className="bar" /><span className="muted" style={{ color: 'var(--red)' }}>{mUnavail} unavailable</span></>}
        <span className="bar" />
        <span className="muted" style={{ color: '#C65A1A' }}>{mStatus}</span>
      </p>

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
          {lineState && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, background: lineState.bg, color: lineState.fg, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: lineState.dot }} />{lineState.label}
            </span>
          )}
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
            emailedAt: order.delivery_note_emailed_at || null,
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
              returnsCount={returnsCount}
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
              deliveryNoteEmailBusy={deliveryNoteEmailBusy}
              onGenerateDeliveryNote={handleGenerateDeliveryNote}
              onOpenDeliveryNote={handleOpenDeliveryNote}
              onOpenSignedDeliveryNote={handleOpenSignedDeliveryNote}
              onEmailDeliveryNote={handleEmailDeliveryNote}
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

      {/* ── Pick-list entry (Phase 3) — once lines are confirmed, the
          warehouse flow moves to the dedicated picking screen. ── */}
      {['confirmed', 'partially_confirmed', 'picking'].includes(order.status) && (
        <div className="sod-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 18px' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {order.status === 'picking' ? 'Picking in progress' : 'Ready to pick'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted-strong)' }}>
              Count lines off the shelf — tap or scan barcodes. Short picks carry a note to the yacht.
            </div>
          </div>
          <button
            type="button"
            className="sp-pill primary"
            onClick={() => navigate(`/supplier/orders/${order.id}/pick`)}
          >
            {order.status === 'picking' ? 'Continue picking' : 'Start picking'}
          </button>
        </div>
      )}

      {/* ── Items: progress header, To do / Done sections, totals footer ── */}
      <ItemsCard
        items={items}
        currency={order.currency || 'USD'}
        canEdit={canEdit}
        onItemUpdate={handleItemUpdate}
        onItemQuote={handleItemQuote}
        onConfirmAll={handleConfirmAll}
        onPriceAll={handlePriceAll}
        onMarkRestUnavailable={handleMarkRestUnavailable}
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
        <ReturnsDrawerBody orderId={orderId} isOpen={returnsDrawerOpen} />
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
