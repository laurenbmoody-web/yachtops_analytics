import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import EditorialMetaStrip from '../../components/editorial/EditorialMetaStrip';
import '../pantry/pantry.css';
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
} from './utils/provisioningStorage';
import { showToast } from '../../utils/toast';
import { listSupportedCountries } from '../../data/countryTaxPresets';

// Build the ISO2 → display-name lookup once. Falls back to the raw code
// when a country is outside the supported set (rare, but won't crash).
const COUNTRY_NAMES_BY_ISO2 = (() => {
  const out = {};
  try {
    for (const { iso2, name } of listSupportedCountries()) {
      if (iso2) out[iso2.toUpperCase()] = name;
    }
  } catch { /* presets unavailable — fall through to raw codes */ }
  return out;
})();
const countryName = (iso) => {
  if (!iso) return null;
  const code = String(iso).toUpperCase();
  return COUNTRY_NAMES_BY_ISO2[code] || code;
};

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

const EDITORIAL_BG = '#F5F1EA';

// ───────────────────────────────────────────────────────────
// Helpers (migrated from SupplierOrderDrawer)
// ───────────────────────────────────────────────────────────

const fmtMoney = (n, currency = 'EUR') => {
  if (n == null || n === '') return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n)); }
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
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
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
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
    case 'confirmed':         return 2;
    case 'sent': {
      const hasQuoted = items.some((i) => i.quote_status === 'quoted');
      return hasQuoted ? 1 : 0;
    }
    default: return 0;
  }
}

function LifecycleTimeline({ order }) {
  const currentIdx = currentLifecycleIndex(order);
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
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Supplier info popover (anchored to the headline)
// ───────────────────────────────────────────────────────────
//
// No supplier-detail page exists yet, so the supplier name opens a
// lightweight popover with the contact card + a link out to the
// suppliers list. Once a per-supplier detail page lands (e.g.
// /provisioning/suppliers/:id), this can be replaced with a direct
// navigate without disturbing any of the row interactivity around it.

function SupplierInfoPopover({ order, onClose, onViewAll }) {
  const profile = order.supplier_profile || {};
  const name = profile.name || order.supplier_name || 'Supplier';
  const isoCountry = profile.business_country || null;
  const city = profile.business_city || null;
  const flag = flagEmoji(isoCountry);
  const email = order.supplier_email || null;
  const phone = order.supplier_phone || null;
  const address = order.supplier_address || null;
  const paymentTerms = profile.invoice_payment_terms_days != null
    ? `Net ${profile.invoice_payment_terms_days} days`
    : null;

  // Locale line: prefer "{country full name} · {city}" when both exist,
  // else whichever is present. Country code is resolved to its display
  // name so the chip doesn't read like a stray ISO code ("FR").
  const fullCountry = isoCountry ? countryName(isoCountry) : null;
  const localePieces = [fullCountry, city].filter(Boolean);
  const localeLine = localePieces.length > 0 ? localePieces.join(' · ') : null;

  // Each row is [label, value] — falsy values drop the entire row.
  const rows = [
    email && ['Email', <a key="e" href={`mailto:${email}`}>{email}</a>],
    phone && ['Phone', <a key="p" href={`tel:${phone}`}>{phone}</a>],
    address && ['Address', <span key="a">{address}</span>],
    paymentTerms && ['Payment terms', <span key="t">{paymentTerms}</span>],
  ].filter(Boolean);

  return (
    <div className="cargo-od-supplier-popover" role="dialog" aria-label={`${name} contact details`}>
      <button
        type="button"
        className="cargo-od-supplier-popover-close"
        onClick={onClose}
        aria-label="Close"
      >×</button>

      <div className="cargo-od-supplier-popover-header">
        <h4 className="cargo-od-supplier-popover-name">
          <span>{name}</span>
          {flag && <span className="cargo-od-supplier-popover-flag" aria-hidden="true">{flag}</span>}
        </h4>
        {localeLine && (
          <p className="cargo-od-supplier-popover-locale">{localeLine}</p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="cargo-od-supplier-popover-rows">
          {rows.map(([label, value]) => (
            <div className="cargo-od-supplier-popover-row" key={label}>
              <div className="cargo-od-supplier-popover-label">{label}</div>
              <div className="cargo-od-supplier-popover-value">{value}</div>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        <p className="cargo-od-supplier-popover-empty">
          No contact details on file.
        </p>
      )}

      <button
        type="button"
        className="cargo-od-supplier-popover-link"
        onClick={onViewAll}
      >
        View all suppliers ›
      </button>
    </div>
  );
}

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
  const invoicedTotal = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
  const overInvoice = invoicedTotal - agreedTotal;
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
        onClick={isOverBudget ? () => onOpenVariance({ overInvoice, agreedTotal, invoicedTotal, currency }) : undefined}
        onKeyDown={isOverBudget ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenVariance({ overInvoice, agreedTotal, invoicedTotal, currency });
          }
        } : undefined}
        title={isOverBudget
          ? `Invoice total exceeds agreed total by ${fmtMoney(overInvoice, currency)}. Click to view variance breakdown.`
          : undefined}
      >
        <span className="cargo-od-stat-label">Invoiced</span>
        <span className={`cargo-od-stat-value is-money${isOverBudget ? ' is-action' : ''}`}>
          {invoices.length > 0 ? fmtMoney(invoicedTotal, currency) : '—'}
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

function DocumentsSection({ order, dnPopoverOpen, setDnPopoverOpen, resendBusy, onResendSigningEmail, markPaidBusy, onMarkPaid }) {
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
      invHoverActions = (
        <button
          type="button"
          className="cargo-od-doc-hover-btn"
          onClick={(e) => { e.stopPropagation(); onMarkPaid(inv); }}
          disabled={isBusy}
          title="Mark this invoice as paid"
        >
          {isBusy ? 'Saving…' : 'Mark paid'}
        </button>
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

            let priceCell, statusCell;
            if (qStatus === 'agreed') {
              priceCell = (
                <>
                  <div style={{ fontWeight: 700 }}>{fmtMoney(it.agreed_price, cur)}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(30,39,66,0.5)', marginTop: 2 }}>Agreed</div>
                </>
              );
              statusCell = <span className="cargo-od-pill tonal-green">Agreed</span>;
            } else if (qStatus === 'awaiting_quote') {
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

            return (
              <tr key={it.id}>
                <td>
                  {it.item_name}
                  {it.substitute_description && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: '#D97706' }}>
                      → {it.substitute_description}
                    </span>
                  )}
                </td>
                <td className="center">{it.quantity} {it.unit || ''}</td>
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

function FooterBar({ status, onBack }) {
  const primary = primaryActionFor(status);
  return (
    <div className="editorial-footer-card">
      <button
        type="button"
        className="cargo-ribbon-btn cargo-ribbon-btn-primary"
        disabled
        title="Action wired in a later commit"
      >
        {primary.label}
      </button>
      <button type="button" className="cargo-ribbon-btn" disabled title="Wired in Commit 3">
        Receive items
      </button>
      <button type="button" className="cargo-ribbon-btn" disabled title="Wired in Commit 3">
        Email supplier
      </button>
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

  const [order, setOrder] = useState(null);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Quote workflow state — local to this page since it's now self-contained.
  const [quoteRowBusy, setQuoteRowBusy] = useState(null);
  const [acceptAllBusy, setAcceptAllBusy] = useState(null);
  const [queryModalItem, setQueryModalItem] = useState(null);

  // Sprint 9c.2 Commit 2 — interactive surface state.
  // Supplier-name popover anchored to the headline.
  const [supplierPopoverOpen, setSupplierPopoverOpen] = useState(false);
  // Delivery-note "awaiting signature" inline popover (open unsigned / resend).
  const [dnPopoverOpen, setDnPopoverOpen] = useState(false);
  // Invoiced over-budget breakdown dialog.
  const [varianceDialog, setVarianceDialog] = useState(null);
  // Async row state.
  const [resendBusy, setResendBusy] = useState(false);
  const [markPaidBusy, setMarkPaidBusy] = useState(null); // invoiceId currently saving

  // Lift body bg to editorial cream while this page is mounted (mirrors
  // EditorialPageShell's behavior — we don't use the shell because its
  // headline component force-uppercases the title).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  // Load order + list in parallel. Treat order-not-found OR
  // order.list_id !== boardId as a 404 and bounce back to the board.
  useEffect(() => {
    if (!orderId || !boardId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    Promise.all([
      fetchSupplierOrderById(orderId),
      fetchProvisioningList(boardId).catch(() => null),
    ])
      .then(([o, l]) => {
        if (cancelled) return;
        if (!o || (o.list_id && boardId && o.list_id !== boardId)) {
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
        navigate(`/provisioning/${boardId}`, { replace: true });
      });
    return () => { cancelled = true; };
  }, [orderId, boardId, navigate]);

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

  const handleBack = () => navigate(`/provisioning/${boardId}`);

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

  // Click-outside dismissal for supplier + delivery-note popovers. Both
  // panels carry a data attribute so a single document listener can decide
  // whether the click originated inside any open popover.
  useEffect(() => {
    if (!supplierPopoverOpen && !dnPopoverOpen) return;
    const onDocClick = (e) => {
      if (e.target.closest('[data-popover-anchor]')) return;
      setSupplierPopoverOpen(false);
      setDnPopoverOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [supplierPopoverOpen, dnPopoverOpen]);

  // ── Render ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Header />
        <div className="editorial-page">
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
      <div className="editorial-page">

        {/* Editorial header — back link · meta strip · headline · subline.
            Built manually because EditorialHeadline uppercases the title and
            display-case supplier names ("Marina Mercante Palma") need to
            survive intact. */}
        <div className="p-header-row">
          <div style={{ flex: 1 }}>
            <button
              className="p-back-link"
              onClick={handleBack}
              aria-label="Back to board"
            >
              Back to board
            </button>
            <EditorialMetaStrip meta={editorialMeta} />

            {/* Custom headline — Georgia display-case supplier name + italic
                terracotta board-type qualifier. Mirrors the EditorialHeadline
                pattern but preserves multi-word supplier-name casing.

                Sprint 9c.2 Commit 2 (follow-up): supplier name is a clickable
                trigger that opens an info popover. Convention: interactive
                triggers embedded in editorial typography MUST render visually
                identical to the original text at rest. The hover affordance
                (terracotta underline + ›) is the only place it appears, and
                the › lives in a ::after pseudo-element so it consumes zero
                inline space — no kerning shift around the comma. */}
            <h1 className="p-greeting" style={{ textTransform: 'none' }}>
              <span className="cargo-od-supplier-trigger-wrap" data-popover-anchor><button
                type="button"
                className="cargo-od-supplier-trigger"
                onClick={() => setSupplierPopoverOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={supplierPopoverOpen}
              >{supplierName}</button>{supplierPopoverOpen && (
                <SupplierInfoPopover
                  order={order}
                  onClose={() => setSupplierPopoverOpen(false)}
                  onViewAll={() => {
                    setSupplierPopoverOpen(false);
                    navigate('/provisioning/suppliers');
                  }}
                />
              )}</span><span className="p-greeting-punctuation">,</span>{' '}
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
        </div>

        {/* Page body — sections dissolve into the editorial background,
            separated by the section labels and hairline rules. */}
        <div className="cargo-od" style={{ marginTop: 24 }}>
          <HeroStats order={order} onOpenVariance={(v) => setVarianceDialog(v)} />

          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Lifecycle.</span>
            <LifecycleTimeline order={order} />
          </div>

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
          <FooterBar status={order.status} onBack={handleBack} />
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
            zIndex: 9000, padding: 16,
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
              Invoice total exceeds agreed total by{' '}
              <strong>{fmtMoney(varianceDialog.overInvoice, varianceDialog.currency)}</strong>.
            </p>
            <dl className="cargo-od-variance-grid">
              <dt>Agreed</dt>
              <dd>{fmtMoney(varianceDialog.agreedTotal, varianceDialog.currency)}</dd>
              <dt>Invoiced</dt>
              <dd>{fmtMoney(varianceDialog.invoicedTotal, varianceDialog.currency)}</dd>
              <dt>Delta</dt>
              <dd className="is-over">
                {fmtMoneyDelta(varianceDialog.overInvoice, varianceDialog.currency)}
              </dd>
            </dl>
            <p className="cargo-od-variance-note">
              Per-line variance attribution lands in a future sprint. For now,
              cross-reference the supplier invoice PDF with the Lines table
              above to spot which entries came in higher than agreed.
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
    </>
  );
}
