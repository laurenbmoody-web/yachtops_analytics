import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { dateLocale } from '../../utils/dateFormat';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import EditorialMetaStrip from '../../components/editorial/EditorialMetaStrip';
import { useAuth } from '../../contexts/AuthContext';
import '../pantry/pantry.css';
import './provisioning-dashboard.css';
import {
  fetchSupplierOrderById,
  fetchSupplierOrderActivity,
  fetchProvisioningList,
  acceptOrderItemQuote,
  declineOrderItemQuote,
  queryOrderItemQuote,
  fetchDocumentSignedUrl,
  fetchInvoiceSignedUrl,
  sendDeliveryNoteEmails,
  markInvoicePaid,
  markSupplierOrderReceived,
  toggleSupplierOrderFavourite,
  startSupplierCardPayment,
} from './utils/provisioningStorage';
import { showToast } from '../../utils/toast';

// Live driver map is heavy (Google Maps) + only needed mid-delivery — lazy-load.
const DriverMap = React.lazy(() => import('../driver/DriverMap'));

// Sprint 9c.2 — supplier order detail page (replaces the drawer architecture).
//
// URL: /provisioning/:boardId/orders/:orderId
//
// The drawer composition migrated wholesale into a page so the order detail
// surface gets full viewport width, becomes URL-shareable, and is symmetric
// with /provisioning/:boardId. Section CSS (`cargo-od-*`) is reused — it's
// styling-semantic, not drawer-specific.
//
// Sections:
//   1. Editorial header — back link · meta strip · Georgia headline · subline
//   2. Hero stat cards   — Status · Countdown · Agreed · Invoiced
//   3. Lifecycle         — 8-step horizontal timeline
//   4. Documents         — 3 hairline rows, pulse on action-needed
//   5. Lines             — summary chips + items table + per-line quote actions
//   6. Activity          — top 3 with italic Georgia actor names
//   7. Sticky footer     — primary action + secondaries + back
//
// EditorialHeadline isn't used because it uppercases the title — supplier
// names are display-case multi-word strings ("Marina Mercante Palma") that
// don't survive ALL CAPS. Header rendered manually within the editorial-page
// token scope so the typography still inherits cleanly.

const EDITORIAL_BG = '#F8FAFC';

// ───────────────────────────────────────────────────────────
// Helpers (migrated from SupplierOrderDrawer)
// ───────────────────────────────────────────────────────────

const fmtMoney = (n, currency = 'EUR') => {
  if (n == null || n === '') return '—';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(n)); }
  catch { return `${currency} ${Number(n).toFixed(2)}`; }
};

const fmtMoneyDelta = (n, currency = 'EUR') => {
  const v = Number(n) || 0;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${fmtMoney(Math.abs(v), currency)}`;
};

const shortRef = (id) => String(id || '').slice(0, 8).toUpperCase();

const flagEmoji = (iso) => {
  if (!iso || typeof iso !== 'string' || iso.length !== 2) return '';
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  const u = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(u)) return '';
  return String.fromCodePoint(u.charCodeAt(0) + offset, u.charCodeAt(1) + offset);
};

const fmtDateShort = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }); }
  catch { return null; }
};

const fmtRelative = (iso) => {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
  } catch { return ''; }
};

const daysUntil = (iso) => {
  if (!iso) return null;
  try {
    const target = new Date(iso); target.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  } catch { return null; }
};

const statusSinceLabel = (order) => {
  const ts = order.confirmed_at || order.sent_at || order.created_at;
  const d = fmtDateShort(ts);
  return d ? `since ${d}` : '—';
};

// ───────────────────────────────────────────────────────────
// 8-step lifecycle indicator
// ───────────────────────────────────────────────────────────

const LIFECYCLE_STEPS = [
  { key: 'sent',             label: 'Sent' },
  { key: 'quoted',           label: 'Quoted' },     // derived, not stored
  { key: 'confirmed',        label: 'Confirmed' },
  { key: 'dispatched',       label: 'Dispatched' },
  { key: 'out_for_delivery', label: 'Out for del.' },
  { key: 'received',         label: 'Received' },
  { key: 'invoiced',         label: 'Invoiced' },
  { key: 'paid',             label: 'Paid' },
];

function currentLifecycleIndex(order) {
  const status = order.status;
  const items = order.supplier_order_items || [];
  switch (status) {
    case 'paid':              return 7;
    case 'invoiced':          return 6;
    case 'received':          return 5;
    case 'out_for_delivery':  return 4;
    case 'dispatched':        return 3;
    case 'confirmed':
    case 'partially_confirmed':
    case 'picking':           // supplier fulfilment stages — the vessel just
    case 'packed':            // sees the order as Confirmed until it's dispatched
      return 2;
    case 'sent': {
      const hasQuoted = items.some((i) => i.quote_status === 'quoted');
      return hasQuoted ? 1 : 0;
    }
    default: return 0;
  }
}

// Delivery ETA shown under the out-for-delivery step. Time-only when it's today,
// otherwise date + time.
function fmtEta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  return day.getTime() === today.getTime()
    ? `ETA ${time}`
    : `ETA ${d.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' })} ${time}`;
}

function LifecycleTimeline({ order }) {
  const currentIdx = currentLifecycleIndex(order);
  const eta = fmtEta(order.delivery_eta);
  return (
    <div className="cargo-od-timeline" role="list" aria-label="Order lifecycle">
      {LIFECYCLE_STEPS.map((step, i) => {
        const stateClass =
          i < currentIdx ? 'is-past'
          : i === currentIdx ? 'is-current'
          : 'is-future';
        return (
          <div key={step.key} className={`cargo-od-timeline-step ${stateClass}`} role="listitem">
            <span className="cargo-od-timeline-dot" aria-hidden="true" />
            <span className="cargo-od-timeline-label">{step.label}</span>
            {step.key === 'out_for_delivery' && eta && (
              <span className="cargo-od-timeline-eta">{eta}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Crew-facing "who's delivering this" panel. Reads the driver/courier fields
// the supplier set (see 20260716830000). Internal driver → show the teammate's
// name + a live status track; external courier → show the courier + a link out
// to their own tracking. Rendered only once there's something to show.
const DRV_LABELS = { assigned: 'Assigned', on_the_way: 'On the way', arrived: 'Arrived', delivered: 'Delivered' };
const DRV_TRACK = ['assigned', 'on_the_way', 'arrived', 'delivered'];
function TrackDelivery({ order }) {
  const eta = fmtEta(order.delivery_eta);
  const hasInternal = !!order.driver_name;
  const hasExternal = !!order.courier_name;
  if (!hasInternal && !hasExternal) return null;
  return (
    <div className="cargo-od-section">
      <span className="cargo-od-section-label">Track <em>delivery</em>.</span>
      <div className="cargo-od-track">
        {hasInternal ? (
          <>
            <div className="cargo-od-track-head">
              <div className="cargo-od-track-who">
                <span className="cargo-od-track-name">{order.driver_name}</span>
                <span className="cargo-od-track-sub">Delivering your order{eta ? ` · ${eta}` : ''}</span>
              </div>
              <span className="cargo-od-track-badge">{DRV_LABELS[order.driver_status] || 'Assigned'}</span>
            </div>
            <div className="cargo-od-track-rail" role="list" aria-label="Delivery progress">
              {DRV_TRACK.map((s) => {
                const idx = DRV_TRACK.indexOf(order.driver_status);
                const here = DRV_TRACK.indexOf(s);
                const cls = here < idx ? 'is-past' : here === idx ? 'is-current' : 'is-future';
                return (
                  <div key={s} className={`cargo-od-track-node ${cls}`} role="listitem">
                    <span className="cargo-od-track-dot" aria-hidden="true" />
                    <span className="cargo-od-track-step">{DRV_LABELS[s]}</span>
                  </div>
                );
              })}
            </div>
            {['on_the_way', 'arrived'].includes(order.driver_status) && (
              <React.Suspense fallback={<div className="cargo-od-track-mapwait">Loading map…</div>}>
                <DriverMap order={order} />
              </React.Suspense>
            )}
          </>
        ) : (
          <div className="cargo-od-track-head">
            <div className="cargo-od-track-who">
              <span className="cargo-od-track-name">{order.courier_name}</span>
              <span className="cargo-od-track-sub">External courier{eta ? ` · ${eta}` : ''}</span>
            </div>
            {order.tracking_url && (
              <a className="cargo-od-track-link" href={order.tracking_url} target="_blank" rel="noreferrer">Track delivery →</a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// (SupplierInfoPopover removed in 9c.2 FIX 1 — the headline supplier name
// now navigates straight to the supplier overview dashboard at
// /provisioning/suppliers/:id, which superseded this pre-overview-page
// contact popover. Its .cargo-od-supplier-popover* CSS is left in
// pantry.css untouched; harmless and out of scope for this PR.)

// ───────────────────────────────────────────────────────────
// Hero stat cards
// ───────────────────────────────────────────────────────────

function HeroStats({ order, onOpenVariance }) {
  const items = order.supplier_order_items || [];
  const invoices = order.supplier_invoices || [];
  const currency = order.currency
    || items[0]?.estimated_currency
    || items[0]?.agreed_currency
    || 'EUR';

  const agreedTotal = items.reduce((s, it) => {
    const val = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return s + val * (Number(it.quantity) || 0);
  }, 0);
  // Compare like-for-like: the agreed total is ex-VAT (sum of line prices), so
  // the variance must use the invoice NET (subtotal), not the VAT-inclusive
  // grand total — otherwise VAT reads as an overage. Legacy invoices predating
  // the subtotal column fall back to amount.
  const invoicedNet = invoices.reduce((s, inv) => s + (Number(inv.subtotal ?? inv.amount) || 0), 0);
  const invoicedGross = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
  const overInvoice = invoicedNet - agreedTotal;
  const isOverBudget = invoices.length > 0 && overInvoice > 0.01;

  const dDelta = daysUntil(order.delivery_date);
  const isOverdue = dDelta != null && dDelta < 0;
  const countdownValue =
    dDelta == null ? '—'
    : dDelta < 0 ? `${Math.abs(dDelta)}d overdue`
    : dDelta === 0 ? 'Today'
    : dDelta === 1 ? '1d to go'
    : `${dDelta}d to go`;
  const expectedSub = order.delivery_date
    ? `expected ${fmtDateShort(order.delivery_date)}`
    : '—';

  const agreedCount = items.filter((i) => i.quote_status === 'agreed').length;
  const totalCount = items.length;
  const agreedSub = totalCount === 0
    ? '—'
    : agreedCount === totalCount
    ? 'all lines accepted'
    : `${agreedCount} of ${totalCount} agreed`;

  const statusValue = (order.status || 'sent').replace(/_/g, ' ');

  return (
    <div className="cargo-od-stats">
      <div className="cargo-od-stat">
        <span className="cargo-od-stat-label">Status</span>
        <span className="cargo-od-stat-value">
          {statusValue.charAt(0).toUpperCase() + statusValue.slice(1)}
        </span>
        <span className="cargo-od-stat-sub">{statusSinceLabel(order)}</span>
      </div>

      <div className={`cargo-od-stat${isOverdue ? ' is-action' : ''}`}>
        <span className="cargo-od-stat-label">Countdown</span>
        <span className={`cargo-od-stat-value${isOverdue ? ' is-action' : ''}`}>
          {countdownValue}
        </span>
        <span className="cargo-od-stat-sub">{expectedSub}</span>
      </div>

      <div className="cargo-od-stat">
        <span className="cargo-od-stat-label">Agreed</span>
        <span className="cargo-od-stat-value is-money">
          {fmtMoney(agreedTotal, currency)}
        </span>
        <span className="cargo-od-stat-sub">{agreedSub}</span>
      </div>

      <div
        className={`cargo-od-stat${isOverBudget ? ' is-action is-clickable' : ''}`}
        role={isOverBudget ? 'button' : undefined}
        tabIndex={isOverBudget ? 0 : undefined}
        onClick={isOverBudget ? () => onOpenVariance({ overInvoice, agreedTotal, invoicedNet, invoicedGross, currency }) : undefined}
        onKeyDown={isOverBudget ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenVariance({ overInvoice, agreedTotal, invoicedNet, invoicedGross, currency });
          }
        } : undefined}
        title={isOverBudget
          ? `Invoice total exceeds agreed total by ${fmtMoney(overInvoice, currency)}. Click to view variance breakdown.`
          : undefined}
      >
        <span className="cargo-od-stat-label">Invoiced</span>
        <span className={`cargo-od-stat-value is-money${isOverBudget ? ' is-action' : ''}`}>
          {invoices.length > 0 ? fmtMoney(invoicedGross, currency) : '—'}
        </span>
        <span className={`cargo-od-stat-sub${isOverBudget ? ' is-action' : ''}`}>
          {invoices.length === 0
            ? 'not received'
            : isOverBudget
            ? `${fmtMoneyDelta(overInvoice, currency)} over`
            : 'matches agreed'}
        </span>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Documents (3-row hairline list — state-aware + interactive)
// ───────────────────────────────────────────────────────────

// Open a signed-URL document in a new tab. Centralised so each row's
// onClick is a one-liner; surfaces toast errors if the edge function
// rejects (RLS, missing path, etc.).
async function openSignedDocument(kind, id) {
  try {
    const res = await fetchDocumentSignedUrl(kind, id);
    if (res?.signed_url) window.open(res.signed_url, '_blank', 'noopener,noreferrer');
    else showToast('Document is no longer available', 'error');
  } catch (e) {
    showToast(`Could not open document: ${e.message || 'unknown error'}`, 'error');
  }
}

async function openSignedInvoice(invoiceId) {
  try {
    const res = await fetchInvoiceSignedUrl(invoiceId);
    if (res?.signed_url) window.open(res.signed_url, '_blank', 'noopener,noreferrer');
    else showToast('Invoice is no longer available', 'error');
  } catch (e) {
    showToast(`Could not open invoice: ${e.message || 'unknown error'}`, 'error');
  }
}

// Single document row. `interactive` toggles the clickable affordance
// (cursor, hover tint, terracotta › arrow). Row content stays identical
// across both modes — same name on the left, same state text on the right.
function DocRow({ name, stateNode, interactive, onClick, hoverActions }) {
  const handleKey = (e) => {
    if (!interactive || !onClick) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
  };
  return (
    <div
      className={`cargo-od-doc-row${interactive ? ' is-interactive' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? handleKey : undefined}
    >
      <span className="cargo-od-doc-name">{name}</span>
      <span className="cargo-od-doc-state-wrap">
        {stateNode}
        {hoverActions}
        {interactive && <span className="cargo-od-doc-arrow" aria-hidden="true">›</span>}
      </span>
    </div>
  );
}

function DocumentsSection({ order, dnPopoverOpen, setDnPopoverOpen, resendBusy, onResendSigningEmail, markPaidBusy, onMarkPaid, canPayCard, payingCardId, onPayByCard }) {
  // Order PDF — clickable iff a stored URL exists.
  const orderPdfInteractive = !!order.order_pdf_url;
  const orderPdfState = order.order_pdf_url
    ? (order.order_pdf_generated_at
        ? `Generated · ${fmtDateShort(order.order_pdf_generated_at)}`
        : 'Generated')
    : 'Not generated';

  // Delivery note — four states, three of them interactive.
  let dnState, dnClass = '', dnPulse = false;
  let dnInteractive = false;
  let dnOnClick = null;
  if (order.delivery_note_signed_pdf_url) {
    dnState = order.crew_signed_at
      ? `Signed · ${fmtDateShort(order.crew_signed_at)}`
      : 'Signed';
    dnClass = 'is-success';
    dnInteractive = true;
    dnOnClick = () => openSignedDocument('delivery_note_signed', order.id);
  } else if (order.delivery_note_emailed_at && order.delivery_note_pdf_url) {
    dnState = 'Awaiting signature';
    dnClass = 'is-action';
    dnPulse = true;
    dnInteractive = true;
    dnOnClick = () => setDnPopoverOpen((v) => !v);
  } else if (order.delivery_note_pdf_url) {
    dnState = order.delivery_note_generated_at
      ? `Generated · ${fmtDateShort(order.delivery_note_generated_at)}`
      : 'Generated';
    dnInteractive = true;
    dnOnClick = () => openSignedDocument('delivery_note', order.id);
  } else {
    dnState = 'Not generated';
  }

  // Invoice — pick the most recent for the row chip; older ones live
  // outside this row.
  const invoices = order.supplier_invoices || [];
  const inv = invoices.length > 0
    ? [...invoices].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    : null;
  let invState, invClass = '';
  let invInteractive = false;
  let invOnClick = null;
  let invHoverActions = null;
  if (inv) {
    const cur = inv.currency || order.currency || 'EUR';
    const isPaid = inv.status === 'paid';
    const dt = isPaid
      ? fmtDateShort(inv.paid_at || inv.created_at)
      : fmtDateShort(inv.created_at);
    invState = isPaid
      ? `Paid · ${dt}`
      : `Received · ${dt} · ${fmtMoney(inv.amount, cur)}`;
    invClass = 'is-success';
    invInteractive = true;
    invOnClick = () => openSignedInvoice(inv.id);
    if (!isPaid) {
      const isBusy = markPaidBusy === inv.id;
      // Pay by card shows when the supplier is card-ready and the viewer is
      // CHIEF+. Mirrors the board OrderCard so both surfaces offer it.
      const showPay = canPayCard && order.supplier_profile?.stripe_charges_enabled;
      const isPaying = payingCardId === inv.id;
      invHoverActions = (
        <>
          {showPay && (
            <button
              type="button"
              className="cargo-od-doc-hover-btn is-pay"
              onClick={(e) => { e.stopPropagation(); onPayByCard(inv); }}
              disabled={isPaying}
              title={`Pay ${inv.invoice_number || 'invoice'} by card`}
            >
              {isPaying ? 'Opening…' : '💳 Pay by card'}
            </button>
          )}
          <button
            type="button"
            className="cargo-od-doc-hover-btn"
            onClick={(e) => { e.stopPropagation(); onMarkPaid(inv); }}
            disabled={isBusy}
            title="Mark this invoice as paid"
          >
            {isBusy ? 'Saving…' : 'Mark paid'}
          </button>
        </>
      );
    }
  } else {
    invState = 'Not received';
  }

  return (
    <div>
      <DocRow
        name="Order PDF"
        stateNode={<span className="cargo-od-doc-state">{orderPdfState}</span>}
        interactive={orderPdfInteractive}
        onClick={orderPdfInteractive ? () => openSignedDocument('order_pdf', order.id) : null}
      />

      <div className="cargo-od-doc-row-wrap">
        <DocRow
          name="Delivery note"
          stateNode={
            <span className={`cargo-od-doc-state ${dnClass}`}>
              {dnPulse && <span className="cargo-od-doc-pulse" aria-hidden="true" />}
              {dnState}
            </span>
          }
          interactive={dnInteractive}
          onClick={dnOnClick}
        />
        {dnPopoverOpen && (
          <div className="cargo-od-doc-popover" role="dialog" aria-label="Delivery note actions">
            <button
              type="button"
              className="cargo-od-doc-popover-item"
              onClick={() => { setDnPopoverOpen(false); openSignedDocument('delivery_note', order.id); }}
            >
              Open unsigned PDF
            </button>
            <button
              type="button"
              className="cargo-od-doc-popover-item"
              onClick={() => { onResendSigningEmail(true); }}
              disabled={resendBusy}
            >
              {resendBusy ? 'Sending…' : 'Resend signing email'}
            </button>
          </div>
        )}
      </div>

      <DocRow
        name="Invoice"
        stateNode={<span className={`cargo-od-doc-state ${invClass}`}>{invState}</span>}
        interactive={invInteractive}
        onClick={invOnClick}
        hoverActions={invHoverActions}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Lines table — preserved per-line quote workflow
// ───────────────────────────────────────────────────────────

function LinesSection({ order, acceptAllBusy, quoteRowBusy, onAcceptAllQuoted, onAcceptItemQuote, onQueryItemQuote, onDeclineItemQuote }) {
  const items = order.supplier_order_items || [];
  const counts = useMemo(() => {
    const total = items.length;
    const pending = items.filter((i) => (i.status || i.quote_status || 'pending') === 'pending').length;
    const confirmed = items.filter((i) => i.status === 'confirmed' || i.quote_status === 'agreed').length;
    const unavailable = items.filter((i) => i.status === 'unavailable' || i.quote_status === 'unavailable').length;
    return { total, pending, confirmed, unavailable };
  }, [items]);

  const quotedCount = items.filter((x) => x.quote_status === 'quoted').length;
  const acceptAllBusyForThis = acceptAllBusy === order.id;

  return (
    <div>
      <p className="cargo-od-lines-summary">
        <span><strong>{counts.total}</strong> total</span>
        {counts.pending > 0 && <span className="is-pending"><strong>{counts.pending}</strong> pending</span>}
        {counts.confirmed > 0 && <span className="is-confirmed"><strong>{counts.confirmed}</strong> confirmed</span>}
        {counts.unavailable > 0 && <span className="is-unavail"><strong>{counts.unavailable}</strong> unavailable</span>}
      </p>

      {quotedCount >= 2 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="cargo-od-bulk-accept"
            onClick={() => onAcceptAllQuoted(order)}
            disabled={acceptAllBusyForThis}
          >
            {acceptAllBusyForThis ? 'Accepting…' : `Accept ${quotedCount} quoted prices`}
          </button>
        </div>
      )}

      <table className="cargo-od-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="center">Qty</th>
            <th className="num">Price</th>
            <th className="num">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const cur = it.estimated_currency || it.quoted_currency || it.agreed_currency || order.currency || 'EUR';
            const qStatus = it.quote_status || 'awaiting_quote';
            const isBusy = quoteRowBusy === it.id;

            let deltaChip = null;
            if (it.estimated_price != null && it.quoted_price != null
                && Number(it.estimated_price) > 0
                && Number(it.estimated_price) !== Number(it.quoted_price)) {
              const pct = ((Number(it.quoted_price) - Number(it.estimated_price)) / Number(it.estimated_price)) * 100;
              const up = pct >= 0;
              deltaChip = (
                <span className={`cargo-od-delta-chip ${up ? 'up' : 'down'}`}>
                  {up ? '+' : ''}{pct.toFixed(1)}%
                </span>
              );
            }

            // Defensive: if the supplier set a price (quoted_price /
            // agreed_price) but the auto-accept trigger hasn't moved
            // quote_status off 'awaiting_quote', fall through to the
            // quoted/agreed branches so the chief still sees the
            // figure. Order of preference: agreed > quoted > estimated.
            const hasAgreed = it.agreed_price != null && Number(it.agreed_price) > 0;
            const hasQuoted = it.quoted_price != null && Number(it.quoted_price) > 0;
            const effectiveQStatus =
              qStatus === 'awaiting_quote'
                ? (hasAgreed ? 'agreed' : (hasQuoted ? 'quoted' : 'awaiting_quote'))
                : qStatus;

            let priceCell, statusCell;
            if (effectiveQStatus === 'agreed') {
              priceCell = (
                <>
                  <div style={{ fontWeight: 700 }}>{fmtMoney(it.agreed_price ?? it.quoted_price, cur)}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(30,39,66,0.5)', marginTop: 2 }}>Final</div>
                </>
              );
              statusCell = <span className="cargo-od-pill tonal-green">Final</span>;
            } else if (effectiveQStatus === 'awaiting_quote') {
              priceCell = (
                <div style={{ color: 'rgba(30,39,66,0.55)' }}>est. {fmtMoney(it.estimated_price, cur)}</div>
              );
              statusCell = <span className="cargo-od-pill tonal-amber">Pending</span>;
            } else if (qStatus === 'unavailable') {
              priceCell = <span style={{ color: 'rgba(30,39,66,0.4)' }}>—</span>;
              statusCell = <span className="cargo-od-pill tonal-muted">Unavailable</span>;
            } else if (qStatus === 'declined') {
              priceCell = <div style={{ fontSize: 11, color: 'rgba(30,39,66,0.5)' }}>est. {fmtMoney(it.estimated_price, cur)}</div>;
              statusCell = <span className="cargo-od-pill tonal-rose">Declined</span>;
            } else {
              const isDiscussion = qStatus === 'in_discussion';
              priceCell = (
                <>
                  <div style={{ fontWeight: 700 }}>
                    {fmtMoney(it.quoted_price, cur)}
                    {deltaChip}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(30,39,66,0.5)', marginTop: 2 }}>
                    est. {fmtMoney(it.estimated_price, cur)}
                  </div>
                </>
              );
              statusCell = (
                <div className="cargo-od-line-actions">
                  <button type="button" className="cargo-od-line-btn accept"
                    onClick={() => onAcceptItemQuote(it)} disabled={isBusy}>
                    Accept
                  </button>
                  {!isDiscussion && (
                    <button type="button" className="cargo-od-line-btn query"
                      onClick={() => onQueryItemQuote(it)} disabled={isBusy}>
                      Query
                    </button>
                  )}
                  <button type="button" className="cargo-od-line-btn decline"
                    onClick={() => onDeclineItemQuote(it)} disabled={isBusy}>
                    Decline
                  </button>
                </div>
              );
            }

            // Render a struck-through original next to the current value
            // when the supplier overrode the crew's original ask. Used for
            // qty / unit / size so the chief can see exactly what the
            // supplier changed against the order they sent.
            const renderDiff = (requested, current, suffix = '') => {
              const reqStr = requested == null ? '' : String(requested);
              const curStr = current == null ? '' : String(current);
              if (reqStr === '' || reqStr === curStr) {
                return curStr ? <>{curStr}{suffix}</> : null;
              }
              return (
                <>
                  <span style={{ textDecoration: 'line-through', color: '#9CA3AF', marginRight: 4, fontSize: 11 }}>
                    {reqStr}{suffix}
                  </span>
                  <span style={{ color: '#C65A1A', fontWeight: 700 }}>{curStr}{suffix}</span>
                </>
              );
            };

            const sizeNode = (it.size || it.requested_size) ? renderDiff(it.requested_size, it.size) : null;

            return (
              <tr key={it.id}>
                <td>
                  {it.item_name}
                  {it.substitute_description && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: '#C65A1A', fontWeight: 600 }}>
                      Sub: {it.substitute_description}
                    </span>
                  )}
                  {it.supplier_item_note && (
                    <div style={{
                      marginTop: 4,
                      fontStyle: 'italic',
                      color: '#6B6F7A',
                      fontSize: 12,
                      letterSpacing: '0.005em',
                    }}>
                      “{it.supplier_item_note}”
                    </div>
                  )}
                </td>
                <td className="center">
                  {renderDiff(it.requested_quantity, it.quantity)}
                  {' '}
                  {renderDiff(it.requested_unit, it.unit)}
                  {sizeNode && (
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                      {sizeNode}
                    </div>
                  )}
                </td>
                <td className="num">{priceCell}</td>
                <td className="num">{statusCell}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="cargo-od-kbd-row" aria-hidden="true">
        <span><kbd>C</kbd> confirm</span>
        <span><kbd>S</kbd> substitute</span>
        <span><kbd>U</kbd> unavailable</span>
        <span><kbd>A</kbd> confirm all</span>
      </div>

      {order.supplier_notes && (
        <p className="cargo-od-supplier-notes">"{order.supplier_notes}"</p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Activity — top 3 with italic Georgia terracotta actor names
// ───────────────────────────────────────────────────────────

function renderActivityWhat(event) {
  const actor = event.actor_name || event.actor_role || 'system';
  const Actor = ({ name }) => <em className="cargo-od-activity-actor">{name}</em>;

  switch (event.event_type) {
    case 'order_received':
      return <>Order received by supplier</>;
    case 'status_advanced':
      return <>Status advanced — {event.payload?.from || '—'} → <strong>{event.payload?.to || '—'}</strong></>;
    case 'reassigned':
      return <>Order reassigned by <Actor name={actor} /></>;
    case 'delivery_edited':
      return <>Delivery edited by <Actor name={actor} /></>;
    case 'item_confirmed':
      return <>{event.payload?.item_name || 'Item'} confirmed by <Actor name={actor} /></>;
    case 'item_substituted':
      return <>{event.payload?.item_name || 'Item'} substituted by <Actor name={actor} /></>;
    case 'item_unavailable':
      return <>{event.payload?.item_name || 'Item'} marked unavailable by <Actor name={actor} /></>;
    case 'quote_received':
      return <>Quote received — {event.payload?.item_name || 'item'}{event.payload?.auto_accepted ? ' · auto-accepted' : ''}</>;
    case 'quote_accepted':
      return <>Quote accepted by <Actor name={actor} /> — {event.payload?.item_name || 'item'}</>;
    case 'quote_declined':
      return <>Quote declined by <Actor name={actor} /> — {event.payload?.item_name || 'item'}</>;
    case 'discussion_opened':
      return <>Query raised by <Actor name={actor} /> — {event.payload?.item_name || 'item'}</>;
    case 'order_pdf_generated':
      return <>Order PDF generated by <Actor name={actor} /></>;
    case 'delivery_note_generated':
      return <>Delivery note generated by <Actor name={actor} /></>;
    case 'delivery_note_emailed':
      return <>Delivery note signing link sent by <Actor name={actor} /></>;
    case 'delivery_signed':
      return <>Delivery signed by <Actor name={event.payload?.signer_name || actor} /></>;
    case 'invoice_generated':
      return <>Invoice <strong>{event.payload?.invoice_number || 'issued'}</strong> generated</>;
    default:
      return event.event_type;
  }
}

function ActivitySection({ orderId }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setLoading(true);
    fetchSupplierOrderActivity(orderId)
      .then((rows) => { if (!cancelled) { setActivity(rows); setLoading(false); } })
      .catch(() => { if (!cancelled) { setActivity([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [orderId]);

  if (loading) return <p className="cargo-od-activity-empty">Loading activity…</p>;
  if (activity.length === 0) return <p className="cargo-od-activity-empty">No activity yet.</p>;

  const visible = showAll ? activity : activity.slice(0, 3);

  return (
    <>
      <ul className="cargo-od-activity">
        {visible.map((event) => (
          <li key={event.id} className="cargo-od-activity-item">
            <p className="cargo-od-activity-when">{fmtRelative(event.created_at)}</p>
            <p className="cargo-od-activity-what">{renderActivityWhat(event)}</p>
          </li>
        ))}
      </ul>
      {!showAll && activity.length > 3 && (
        <button
          type="button"
          className="cargo-od-activity-link"
          onClick={() => setShowAll(true)}
        >
          View all activity ({activity.length}) →
        </button>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// Sticky footer
// ───────────────────────────────────────────────────────────

function primaryActionFor(status) {
  switch (status) {
    case 'sent':              return { label: 'Cancel order' };
    case 'confirmed':        return { label: 'Awaiting dispatch' };
    case 'dispatched':       return { label: 'Awaiting delivery' };
    case 'out_for_delivery': return { label: 'Mark received' };
    case 'received':          return { label: 'Awaiting invoice' };
    case 'invoiced':          return { label: 'Mark paid' };
    case 'paid':              return { label: 'Order closed' };
    default:                  return { label: 'Continue' };
  }
}

function FooterBar({ status, onBack, onMarkReceived, onReceiveOnBoard, receiveBusy, canReceiveOnBoard }) {
  const primary = primaryActionFor(status);
  // "Mark received" is a real action once goods are on the way; before that the
  // primary is just an informational label.
  const canMarkReceived = status === 'out_for_delivery' || status === 'dispatched';
  const notReceivedYet = !['received', 'invoiced', 'paid'].includes(status);
  return (
    <div className="editorial-footer-card">
      <button
        type="button"
        className="cargo-ribbon-btn cargo-ribbon-btn-primary"
        disabled={!canMarkReceived || receiveBusy}
        title={canMarkReceived ? 'Mark the whole order as received' : undefined}
        onClick={canMarkReceived ? onMarkReceived : undefined}
      >
        {receiveBusy ? 'Marking…' : primary.label}
      </button>
      {notReceivedYet && (
        <button
          type="button"
          className="cargo-ribbon-btn"
          disabled={!canReceiveOnBoard || receiveBusy}
          title={canReceiveOnBoard ? 'Receive line-by-line on the board (partials, delivery note)' : 'No board linked'}
          onClick={onReceiveOnBoard}
        >
          Receive on board
        </button>
      )}
      <span className="cargo-od-footer-spacer" />
      <button type="button" className="cargo-ribbon-btn" onClick={onBack}>
        Back to board
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────

export default function SupplierOrderPage() {
  const { boardId, orderId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenantRole } = useAuth();
  // Favourite star — UI gate only. Server gate is the RPC
  // toggle_supplier_order_favourite which checks tier + dept intersect.
  // CREW / VIEW_ONLY don't get the affordance; CHIEF/HOD/COMMAND do.
  const userTier = (tenantRole || '').toUpperCase();
  const canFavouriteOrder = ['COMMAND', 'CHIEF', 'HOD'].includes(userTier);
  // "Pay by card" surfacing gate — CHIEF+ only. The Netlify function re-checks
  // tier, supplier card-readiness and the amount floor, so this is UI-only.
  const canPayCard = ['COMMAND', 'CHIEF'].includes(userTier);
  const [favouriting, setFavouriting] = useState(false);
  const [payingCardId, setPayingCardId] = useState(null); // invoiceId opening checkout

  const [order, setOrder] = useState(null);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Quote workflow state — local to this page since it's now self-contained.
  const [quoteRowBusy, setQuoteRowBusy] = useState(null);
  const [acceptAllBusy, setAcceptAllBusy] = useState(null);
  const [queryModalItem, setQueryModalItem] = useState(null);

  // Sprint 9c.2 Commit 2 — interactive surface state.
  // Delivery-note "awaiting signature" inline popover (open unsigned / resend).
  const [dnPopoverOpen, setDnPopoverOpen] = useState(false);
  // Invoiced over-budget breakdown dialog.
  const [varianceDialog, setVarianceDialog] = useState(null);
  // Card payment success — in-app receipt shown on return from Stripe.
  const [paidReceipt, setPaidReceipt] = useState(null);
  // Async row state.
  const [resendBusy, setResendBusy] = useState(false);
  const [markPaidBusy, setMarkPaidBusy] = useState(null); // invoiceId currently saving
  const [receiveBusy, setReceiveBusy] = useState(false);  // marking the order received

  // Lift body bg to editorial cream while this page is mounted (mirrors
  // EditorialPageShell's behavior — we don't use the shell because its
  // headline component force-uppercases the title).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  // Load order + (optional) list in parallel. Two URL shapes:
  //
  //   /provisioning/:boardId/orders/:orderId  — board-context (existing)
  //   /provisioning/orders/:orderId           — board-agnostic (added with
  //                                              the Orders index page)
  //
  // In board-context, we still validate order.list_id === boardId and
  // bounce to the board on mismatch (URL forgery / stale link).
  // In board-agnostic, we skip the list fetch + the mismatch check; the
  // back nav routes to /provisioning/orders instead of the board.
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    Promise.all([
      fetchSupplierOrderById(orderId),
      boardId ? fetchProvisioningList(boardId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([o, l]) => {
        if (cancelled) return;
        if (!o) {
          setNotFound(true);
          showToast('Order not found', 'error');
          navigate(boardId ? `/provisioning/${boardId}` : '/provisioning/orders', { replace: true });
          return;
        }
        if (boardId && o.list_id && o.list_id !== boardId) {
          setNotFound(true);
          showToast('Order not found on this board', 'error');
          navigate(`/provisioning/${boardId}`, { replace: true });
          return;
        }
        setOrder(o);
        setList(l);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[SupplierOrderPage] load failed:', err);
        setNotFound(true);
        showToast('Could not load order', 'error');
        navigate(boardId ? `/provisioning/${boardId}` : '/provisioning/orders', { replace: true });
      });
    return () => { cancelled = true; };
  }, [orderId, boardId, navigate]);

  // Silent re-fetch (no spinner) — used after a card payment lands so the
  // invoice flips to Paid without a full page reload.
  const reloadOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const o = await fetchSupplierOrderById(orderId);
      if (o) setOrder(o);
    } catch (err) {
      console.error('[SupplierOrderPage] reload failed:', err);
    }
  }, [orderId]);

  // Return from Stripe Checkout (?paid=1[&inv=<id>]). Pop the in-app receipt
  // from the freshly-paid invoice, strip the query so a refresh won't re-open
  // it, and re-fetch shortly after to reflect Paid once the webhook lands.
  useEffect(() => {
    if (searchParams.get('paid') !== '1' || !order) return;
    const invId = searchParams.get('inv');
    const invs = order.supplier_invoices || [];
    const inv = (invId && invs.find((i) => i.id === invId))
      || [...invs].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
    if (inv) {
      setPaidReceipt({
        invoice_number: inv.invoice_number,
        amount: inv.amount,
        currency: inv.currency || order.currency || 'EUR',
        supplierName: order.supplier_profile?.name || order.supplier_name || 'the supplier',
        invoiceId: inv.id,
      });
      // Optimistically reflect Paid — Stripe only redirects here on a
      // completed Checkout, so mark the invoice + advance the order to 'paid'
      // right away. This lights the PAID lifecycle step without waiting on the
      // webhook; reloadOrder below reconciles from the DB (source of truth).
      setOrder((prev) => prev ? {
        ...prev,
        status: 'paid',
        supplier_invoices: (prev.supplier_invoices || []).map((i) =>
          i.id === inv.id
            ? { ...i, status: 'paid', paid_at: i.paid_at || new Date().toISOString() }
            : i),
      } : prev);
    }
    // Drop paid/inv/cancelled from the URL without adding a history entry.
    const next = new URLSearchParams(searchParams);
    next.delete('paid'); next.delete('inv'); next.delete('cancelled');
    setSearchParams(next, { replace: true });
    // Give the webhook a moment, then refresh to show Paid.
    const t = setTimeout(reloadOrder, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, searchParams]);

  // ── Quote handlers (mirror ProvisioningBoardDetail) ─────────────────
  const mergeUpdatedItem = useCallback((updated) => {
    if (!updated?.id) return;
    setOrder((prev) => prev
      ? { ...prev, supplier_order_items: (prev.supplier_order_items || []).map((it) => it.id === updated.id ? { ...it, ...updated } : it) }
      : prev);
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
    setQueryModalItem(item);
    setQuoteRowBusy(item.id);
    try {
      const updated = await queryOrderItemQuote(item.id);
      mergeUpdatedItem(updated);
    } catch (e) {
      console.warn('[queryOrderItemQuote] failed:', e.message);
    } finally {
      setQuoteRowBusy(null);
    }
  }, [mergeUpdatedItem]);

  const handleAcceptAllQuoted = useCallback(async (o) => {
    const quoted = (o.supplier_order_items || []).filter((i) => i.quote_status === 'quoted');
    if (quoted.length === 0) return;
    if (!window.confirm(`Accept all ${quoted.length} quoted price${quoted.length === 1 ? '' : 's'}?`)) return;
    setAcceptAllBusy(o.id);
    try {
      const results = await Promise.allSettled(quoted.map((it) => acceptOrderItemQuote(it.id)));
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

  // Back-nav: to the board if board-context, else to the Orders index.
  // The order's list_id is also a valid target (if not null) — fall through
  // in that order so users land somewhere familiar.
  // Favourite toggle — optimistic flip with revert on server rejection.
  // Same pattern as ProvisioningBoardDetail.handleToggleFavourite / the
  // Quick Add panel. Server RPC is the actual gate; UI gate is just
  // affordance-hiding.
  const handleToggleFavourite = async () => {
    if (favouriting || !order) return;
    setFavouriting(true);
    const next = !order.is_favourite;
    setOrder(prev => prev ? { ...prev, is_favourite: next, favourited_at: next ? new Date().toISOString() : null } : prev);
    try {
      await toggleSupplierOrderFavourite(order.id);
    } catch (err) {
      // Revert
      setOrder(prev => prev ? { ...prev, is_favourite: !next } : prev);
      const msg = err?.message || 'Could not update favourite';
      showToast(msg, 'error');
    } finally {
      setFavouriting(false);
    }
  };

  const handleBack = () => {
    if (boardId) navigate(`/provisioning/${boardId}`);
    else if (order?.list_id) navigate(`/provisioning/${order.list_id}`);
    else navigate('/provisioning/orders');
  };

  // Mark the whole order received — everything on its board arrived. For
  // partial / discrepancy receipts, "Receive on board" opens the detailed flow.
  const handleMarkReceived = useCallback(async () => {
    if (!order?.id || receiveBusy) return;
    if (!window.confirm('Mark this whole order as received? This marks every item on its board as delivered.')) return;
    setReceiveBusy(true);
    try {
      const updated = await markSupplierOrderReceived(order.id);
      setOrder((prev) => (prev ? { ...prev, status: 'received', delivered_at: updated?.delivered_at || new Date().toISOString() } : prev));
      showToast('Order marked as received', 'success');
    } catch (e) {
      showToast(`Could not mark received: ${e.message || 'unknown error'}`, 'error');
    } finally {
      setReceiveBusy(false);
    }
  }, [order?.id, receiveBusy]);

  // Open the order's board to receive line-by-line (partials, delivery note).
  const handleReceiveOnBoard = () => {
    if (order?.list_id) navigate(`/provisioning/${order.list_id}`);
  };

  // Resend the delivery-note signing email. force=true bypasses the
  // 30-min idempotency window so the user can deliberately retry.
  const handleResendSigningEmail = useCallback(async (force = false) => {
    if (!order?.id) return;
    setResendBusy(true);
    try {
      const res = await sendDeliveryNoteEmails(order.id, { force });
      if (res?.already_sent) {
        showToast(`Already sent — within idempotency window.`, 'info');
      } else {
        showToast(`Signing link sent to ${res?.sent_to || 'supplier'}`, 'success');
        // Update emailed_at so the row state stays in sync without a full refetch.
        setOrder((prev) => prev ? { ...prev, delivery_note_emailed_at: new Date().toISOString() } : prev);
      }
      setDnPopoverOpen(false);
    } catch (e) {
      showToast(`Could not send signing email: ${e.message || 'unknown error'}`, 'error');
    } finally {
      setResendBusy(false);
    }
  }, [order]);

  // Mark a single invoice as paid. Best-effort advances order.status to
  // 'paid' too — the helper handles the parent update internally.
  const handleMarkInvoicePaid = useCallback(async (invoice) => {
    if (!invoice?.id) return;
    if (!window.confirm(`Mark invoice ${invoice.invoice_number || ''} as paid?`)) return;
    setMarkPaidBusy(invoice.id);
    try {
      const updated = await markInvoicePaid(invoice.id);
      setOrder((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        next.supplier_invoices = (prev.supplier_invoices || []).map((inv) =>
          inv.id === updated.id ? { ...inv, status: 'paid', paid_at: updated.paid_at } : inv
        );
        next.status = 'paid';
        return next;
      });
      showToast('Invoice marked as paid', 'success');
    } catch (e) {
      showToast(`Could not mark paid: ${e.message || 'unknown error'}`, 'error');
    } finally {
      setMarkPaidBusy(null);
    }
  }, []);

  // "Pay by card" → Stripe Checkout on the supplier's connected account. The
  // Netlify function returns a hosted URL we redirect to.
  const handlePayByCard = useCallback(async (invoice) => {
    if (!invoice?.id || payingCardId) return;
    setPayingCardId(invoice.id);
    try {
      window.location.href = await startSupplierCardPayment(invoice.id);
    } catch (e) {
      showToast(e.message || 'Could not start card payment', 'error');
      setPayingCardId(null);
    }
  }, [payingCardId]);

  // Click-outside dismissal for the delivery-note popover. The anchor
  // carries a data attribute so the document listener can tell whether
  // the click originated inside the open popover.
  useEffect(() => {
    if (!dnPopoverOpen) return undefined;
    const onDocClick = (e) => {
      if (e.target.closest('[data-popover-anchor]')) return;
      setDnPopoverOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [dnPopoverOpen]);

  // ── Render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Header />
        <div className="editorial-page pv-dashboard">
          <p style={{ padding: '40px 0', color: 'rgba(30,39,66,0.5)' }}>Loading order…</p>
        </div>
      </>
    );
  }

  if (notFound || !order) {
    // Navigate effect already redirected; render nothing while it transitions.
    return null;
  }

  const supplierName = order.supplier_profile?.name || order.supplier_name || 'Supplier';
  // FK to supplier_profiles. Null on legacy orders that predate the
  // unified supplier directory — those render the name as static text.
  const supplierProfileId = order.supplier_profile?.id || order.supplier_profile_id || null;
  const boardType = list?.board_type || 'general';
  const country = order.supplier_profile?.business_country || null;
  const flag = flagEmoji(country);
  const totalCount = (order.supplier_order_items || []).length;
  const port = order.delivery_port || null;
  const vesselName = order.vessel_name || 'the vessel';
  const deptList = Array.isArray(list?.department) ? list.department.filter(Boolean) : [list?.department].filter(Boolean);
  const deptLabel = deptList[0] || 'Provisioning';

  // Editorial meta strip — uppercase tracked context row.
  const editorialMeta = [
    { icon: 'MapPin', label: vesselName.toUpperCase() },
    { label: boardType.toUpperCase() },
    { label: deptLabel.toUpperCase() },
    { label: `ORDER #${shortRef(order.id)}` },
  ].filter(Boolean);

  return (
    <>
      <Header />
      <div className="editorial-page pv-dashboard">

        {/* Editorial header — back link · meta strip · headline · subline.
            Built manually because EditorialHeadline uppercases the title and
            display-case supplier names ("Marina Mercante Palma") need to
            survive intact. */}
        <div className="p-header-row" style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <button
              className="p-back-link"
              onClick={handleBack}
              aria-label="Back to board"
            >
              Back to board
            </button>
            <EditorialMetaStrip meta={editorialMeta} />

            {/* Canonical editorial headline — same .p-greeting pattern as
                the standby page ("STANDBY, *Interior*."). The qualifier
                word (supplier name) is UPPERCASED via the parent rule's
                `text-transform: uppercase`; the styled word (board type)
                stays display-case via `.p-greeting em { text-transform:
                none }`. Punctuation spans inherit navy from the parent.

                FIX 1 (9c.2): the supplier name navigates to the supplier
                overview dashboard (/provisioning/suppliers/:id) when the
                order carries a supplier_profile_id. Legacy orders with a
                null supplier_profile_id render the name as static text —
                no button, no hover affordance, cursor default. The
                two-tone editorial pattern is unchanged either way; only
                the name portion's interactivity differs. The hover cue
                (terracotta underline) is the only at-rest signal — no
                chevron — so the headline reads identically to plain text
                until hovered. */}
            <h1 className="p-greeting">
              {supplierProfileId ? (
                <button
                  type="button"
                  className="cargo-od-supplier-trigger"
                  onClick={() => navigate(`/provisioning/suppliers/${supplierProfileId}`)}
                  aria-label={`View ${supplierName} supplier overview`}
                >{supplierName}</button>
              ) : (
                <span className="cargo-od-supplier-static">{supplierName}</span>
              )}<span className="p-greeting-punctuation">,</span>{' '}
              <em>{boardType}</em><span className="p-greeting-punctuation">.</span>
            </h1>
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              color: 'var(--ink-muted)',
              margin: '0 0 0',
              fontWeight: 400,
            }}>
              {totalCount} {totalCount === 1 ? 'item' : 'items'}
              {flag && <> · <span style={{ fontSize: 14 }}>{flag}</span></>}
              {port && <> · {port}</>}
              {order.delivery_date && <> · expected {fmtDateShort(order.delivery_date)}</>}
            </p>
          </div>
          {/* Favourite star — same affordance as the OrderCard on the
              standalone Orders index + the board's Orders tab. UI gate
              hides from CREW; server gate (toggle_supplier_order_favourite
              RPC) is the actual policy. */}
          {canFavouriteOrder && (
            <button
              type="button"
              onClick={handleToggleFavourite}
              disabled={favouriting}
              title={order.is_favourite ? 'Unfavourite this order' : 'Favourite this order'}
              aria-label={order.is_favourite ? 'Unfavourite' : 'Favourite'}
              style={{
                background: 'none',
                border: 0,
                padding: '4px 8px',
                cursor: favouriting ? 'default' : 'pointer',
                fontSize: 24,
                lineHeight: 1,
                color: order.is_favourite ? '#C65A1A' : '#94A3B8',
                opacity: favouriting ? 0.5 : 1,
                marginLeft: 12,
                flexShrink: 0,
              }}
            >
              {order.is_favourite ? '★' : '☆'}
            </button>
          )}
        </div>

        {/* Page body — sections dissolve into the editorial background,
            separated by the section labels and hairline rules. */}
        <div className="cargo-od" style={{ marginTop: 24 }}>
          <HeroStats order={order} onOpenVariance={(v) => setVarianceDialog(v)} />

          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Lifecycle.</span>
            <LifecycleTimeline order={order} />
          </div>

          <TrackDelivery order={order} />

          <div className="editorial-section-card">
            <span className="cargo-od-section-label">
              What's <em>in flight</em>.
            </span>
            <div data-popover-anchor>
              <DocumentsSection
                order={order}
                dnPopoverOpen={dnPopoverOpen}
                setDnPopoverOpen={setDnPopoverOpen}
                resendBusy={resendBusy}
                onResendSigningEmail={handleResendSigningEmail}
                markPaidBusy={markPaidBusy}
                onMarkPaid={handleMarkInvoicePaid}
                canPayCard={canPayCard}
                payingCardId={payingCardId}
                onPayByCard={handlePayByCard}
              />
            </div>
          </div>

          <div className="editorial-section-card">
            <span className="cargo-od-section-label">Lines.</span>
            <LinesSection
              order={order}
              acceptAllBusy={acceptAllBusy}
              quoteRowBusy={quoteRowBusy}
              onAcceptAllQuoted={handleAcceptAllQuoted}
              onAcceptItemQuote={handleAcceptItemQuote}
              onQueryItemQuote={handleQueryItemQuote}
              onDeclineItemQuote={handleDeclineItemQuote}
            />
          </div>

          <div className="editorial-section-card">
            <span className="cargo-od-section-label">
              Recent <em>activity</em>.
            </span>
            <ActivitySection orderId={order.id} />
          </div>

          {/* Action zone — in-flow card, slightly warmer cream tint. */}
          <FooterBar
            status={order.status}
            onBack={handleBack}
            onMarkReceived={handleMarkReceived}
            onReceiveOnBoard={handleReceiveOnBoard}
            receiveBusy={receiveBusy}
            canReceiveOnBoard={!!order.list_id}
          />
        </div>
      </div>

      {/* Query placeholder modal — Sprint 9.5 stub, copy-pasted from
          ProvisioningBoardDetail. Threaded discussions land in a future
          sprint; the RPC has already flipped quote_status to 'in_discussion'
          so the supplier sees the line being queried. */}
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

      {/* Sprint 9c.2 Commit 2 — variance breakdown dialog. Opens when the
          user clicks the over-budget Invoiced stat card. Shows per-line
          variance (agreed unit × qty vs. invoiced share) for any line
          whose agreed total deviates from the average invoice line, and
          falls back to the overall delta when per-line invoice attribution
          isn't available. Dispute / accept actions are stubs — full
          variance reconciliation is its own sprint. */}
      {varianceDialog && (
        <div
          onClick={() => setVarianceDialog(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 'var(--z-overlay)', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cargo-od-variance-dialog"
            role="dialog"
            aria-label="Invoice variance breakdown"
          >
            <h3 className="cargo-od-variance-title">
              Invoice <em>variance</em>.
            </h3>
            <p className="cargo-od-variance-subtitle">
              Invoiced goods exceed the agreed total by{' '}
              <strong>{fmtMoney(varianceDialog.overInvoice, varianceDialog.currency)}</strong>{' '}
              before tax.
            </p>
            <dl className="cargo-od-variance-grid">
              <dt>Agreed (ex-VAT)</dt>
              <dd>{fmtMoney(varianceDialog.agreedTotal, varianceDialog.currency)}</dd>
              <dt>Invoiced (ex-VAT)</dt>
              <dd>{fmtMoney(varianceDialog.invoicedNet, varianceDialog.currency)}</dd>
              <dt>Delta</dt>
              <dd className="is-over">
                {fmtMoneyDelta(varianceDialog.overInvoice, varianceDialog.currency)}
              </dd>
              <dt>VAT</dt>
              <dd>{fmtMoney((varianceDialog.invoicedGross || 0) - (varianceDialog.invoicedNet || 0), varianceDialog.currency)}</dd>
              <dt>Invoice total</dt>
              <dd>{fmtMoney(varianceDialog.invoicedGross, varianceDialog.currency)}</dd>
            </dl>
            <p className="cargo-od-variance-note">
              This compares the net (ex-VAT) invoiced goods against the agreed
              total, so tax isn’t counted as an overage. Per-line attribution
              lands in a future sprint — for now, cross-reference the supplier
              invoice PDF with the Lines table above to spot which entries came
              in higher than agreed.
            </p>
            <div className="cargo-od-variance-actions">
              <button
                type="button"
                className="cargo-ribbon-btn"
                disabled
                title="Dispute workflow lands in a later commit"
              >Dispute</button>
              <button
                type="button"
                className="cargo-ribbon-btn"
                onClick={() => setVarianceDialog(null)}
              >Close</button>
            </div>
          </div>
        </div>
      )}

      {paidReceipt && (
        <div
          onClick={() => setPaidReceipt(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 'var(--z-overlay)', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cargo-od-paid-dialog"
            role="dialog"
            aria-label="Payment confirmation"
          >
            <div className="cargo-od-paid-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <span className="cargo-od-paid-eyebrow">Payment sent</span>
            <div className="cargo-od-paid-amount">
              {fmtMoney(paidReceipt.amount, paidReceipt.currency)}
            </div>
            <p className="cargo-od-paid-to">
              to <strong>{paidReceipt.supplierName}</strong>
            </p>
            <dl className="cargo-od-paid-grid">
              <dt>Invoice</dt>
              <dd>{paidReceipt.invoice_number || '—'}</dd>
              <dt>Date</dt>
              <dd>{new Date().toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })}</dd>
              <dt>Method</dt>
              <dd>Card · via Stripe</dd>
            </dl>
            <p className="cargo-od-paid-note">
              The invoice is now marked paid. Stripe emails your card receipt
              once payments are live.
            </p>
            <div className="cargo-od-paid-actions">
              <button
                type="button"
                className="cargo-ribbon-btn"
                onClick={() => openSignedInvoice(paidReceipt.invoiceId)}
              >View invoice</button>
              <button
                type="button"
                className="cargo-od-paid-done"
                onClick={() => setPaidReceipt(null)}
              >Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
