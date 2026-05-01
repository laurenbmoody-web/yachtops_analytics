import React, { useEffect, useState, useMemo } from 'react';
import Drawer from './Drawer';
import { fetchSupplierOrderActivity } from '../utils/provisioningStorage';

// Sprint 9c.2 Commit 1.5c — drawer redesign.
//
// Editorial magazine spread + dashboard density. Drawer reads top-to-
// bottom like a periodical article about the order, but every section
// gives data at a glance. No card walls inside the drawer — sections
// dissolve into the page background, separated by hairline rules.
//
// Sections:
//   1. Hero       — kicker / headline / subline / 4 stat cards
//   2. Lifecycle  — 8-step horizontal timeline, current state terracotta
//   3. Documents  — 3 hairline rows, pulsing dot when action needed
//   4. Lines      — summary chip row + items table + keyboard shortcuts
//   5. Activity   — top 3 events with italic terracotta actor names
//   6. Footer     — sticky pill cluster: primary action + secondaries + close
//
// What survives from 1.5b:
//   - Drawer mount/open state in the parent (drawerOrderId)
//   - Drawer wrapper component
//   - Per-line quote workflow (Accept/Query/Decline) — restyled chrome,
//     same handlers
// What's thrown away:
//   - The placeholder card walls
//   - The thin items table — replaced by the structured one with summary
//     chips and keyboard shortcuts row

// ───────────────────────────────────────────────────────────
// Helpers
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

// Days until a date — negative if past.
const daysUntil = (iso) => {
  if (!iso) return null;
  try {
    const target = new Date(iso); target.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  } catch { return null; }
};

// Display label for status sub-line, e.g. "since 25 Apr"
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

// Compute current displayed step. Quoted is derived from per-line
// quote_status when order.status is still 'sent' but lines have been
// quoted by the supplier.
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
// Hero
// ───────────────────────────────────────────────────────────

function HeroBlock({ order, list, onClose }) {
  const items = order.supplier_order_items || [];
  const invoices = order.supplier_invoices || [];
  const currency = order.currency
    || items[0]?.estimated_currency
    || items[0]?.agreed_currency
    || 'EUR';

  // Money totals
  const sumLines = (key) => items.reduce(
    (s, it) => s + (Number(it[key]) || 0) * (Number(it.quantity) || 0),
    0,
  );
  const estimatedTotal = sumLines('estimated_price');
  const agreedTotal = items.reduce((s, it) => {
    const val = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return s + val * (Number(it.quantity) || 0);
  }, 0);
  const invoicedTotal = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
  const overInvoice = invoicedTotal - agreedTotal;
  const isOverBudget = invoices.length > 0 && overInvoice > 0.01;

  // Countdown
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

  // Agreed sub — "all lines accepted" / "N of M agreed"
  const agreedCount = items.filter((i) => i.quote_status === 'agreed').length;
  const totalCount = items.length;
  const agreedSub = totalCount === 0
    ? '—'
    : agreedCount === totalCount
    ? 'all lines accepted'
    : `${agreedCount} of ${totalCount} agreed`;

  // Headline composition
  const supplierName = order.supplier_profile?.name || order.supplier_name || 'Supplier';
  const boardType = list?.board_type || 'general';     // canonical lowercase value
  const country = order.supplier_profile?.business_country || null;
  const flag = flagEmoji(country);

  // Kicker pieces
  const vesselName = order.vessel_name || 'the vessel';
  const deptList = Array.isArray(list?.department) ? list.department.filter(Boolean) : [list?.department].filter(Boolean);
  const deptLabel = deptList[0] || 'Provisioning';
  const kickerPieces = [
    `From ${vesselName}`,
    boardType,
    deptLabel,
  ].filter(Boolean);

  const port = order.delivery_port || null;

  // Status sub (always shows the most recent state-change anchor we have)
  const statusValue = (order.status || 'sent').replace(/_/g, ' ');

  return (
    <div className="cargo-od-hero">
      <button
        type="button"
        className="cargo-od-hero-close"
        onClick={onClose}
        aria-label="Close drawer"
      >×</button>

      <p className="cargo-od-kicker">
        {kickerPieces.join(' · ')}
      </p>

      <h2 className="cargo-od-headline">
        {supplierName}
        <span className="cargo-od-headline-punct">,</span>
        {' '}
        <em>{boardType}</em>
        <span className="cargo-od-headline-punct">.</span>
      </h2>

      <p className="cargo-od-subline">
        Order #{shortRef(order.id)}
        {flag && <> · <span className="cargo-od-subline-flag">{flag}</span></>}
        {' · '}{totalCount} {totalCount === 1 ? 'item' : 'items'}
        {port && <> · {port}</>}
      </p>

      {/* 4 stat cards */}
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

        <div className={`cargo-od-stat${isOverBudget ? ' is-action' : ''}`}>
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
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Documents (3-row hairline list)
// ───────────────────────────────────────────────────────────

function DocumentsSection({ order }) {
  // Order PDF
  const orderPdfState = order.order_pdf_url
    ? (order.order_pdf_generated_at
        ? `Generated · ${fmtDateShort(order.order_pdf_generated_at)}`
        : 'Generated')
    : 'Not generated';
  const orderPdfClass = order.order_pdf_url ? '' : '';

  // Delivery note state
  let dnState, dnClass = '', dnPulse = false;
  if (order.delivery_note_signed_pdf_url) {
    dnState = order.crew_signed_at
      ? `Signed · ${fmtDateShort(order.crew_signed_at)}`
      : 'Signed';
    dnClass = 'is-success';
  } else if (order.delivery_note_emailed_at && order.delivery_note_pdf_url) {
    dnState = 'Awaiting signature';
    dnClass = 'is-action';
    dnPulse = true;
  } else if (order.delivery_note_pdf_url) {
    dnState = order.delivery_note_generated_at
      ? `Generated · ${fmtDateShort(order.delivery_note_generated_at)}`
      : 'Generated';
  } else {
    dnState = 'Not generated';
  }

  // Invoice — first / most recent
  const invoices = order.supplier_invoices || [];
  const inv = invoices.length > 0
    ? [...invoices].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    : null;
  let invState, invClass = '';
  if (inv) {
    const cur = inv.currency || order.currency || 'EUR';
    const dt = fmtDateShort(inv.created_at);
    invState = `Received · ${dt} · ${fmtMoney(inv.amount, cur)}`;
    invClass = 'is-success';
  } else {
    invState = 'Not received';
  }

  // Click handlers — placeholder per spec; wired in Commit 3.
  const noop = () => {};

  return (
    <div>
      <div className="cargo-od-doc-row" role="button" tabIndex={0} onClick={noop} onKeyDown={(e) => { if (e.key === 'Enter') noop(); }}>
        <span className="cargo-od-doc-name">Order PDF</span>
        <span className={`cargo-od-doc-state ${orderPdfClass}`}>{orderPdfState}</span>
      </div>
      <div className="cargo-od-doc-row" role="button" tabIndex={0} onClick={noop} onKeyDown={(e) => { if (e.key === 'Enter') noop(); }}>
        <span className="cargo-od-doc-name">Delivery note</span>
        <span className={`cargo-od-doc-state ${dnClass}`}>
          {dnPulse && <span className="cargo-od-doc-pulse" aria-hidden="true" />}
          {dnState}
        </span>
      </div>
      <div className="cargo-od-doc-row" role="button" tabIndex={0} onClick={noop} onKeyDown={(e) => { if (e.key === 'Enter') noop(); }}>
        <span className="cargo-od-doc-name">Invoice</span>
        <span className={`cargo-od-doc-state ${invClass}`}>{invState}</span>
      </div>
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
    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const pending = items.filter((i) => (i.status || i.quote_status || 'pending') === 'pending').length;
    const confirmed = items.filter((i) => i.status === 'confirmed' || i.quote_status === 'agreed').length;
    const unavailable = items.filter((i) => i.status === 'unavailable' || i.quote_status === 'unavailable').length;
    return { total, totalQty, pending, confirmed, unavailable };
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

            // Delta chip
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
              // 'quoted' or 'in_discussion'
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

      {/* Keyboard shortcut row — visual parity with supplier portal.
          Handlers wire in a future commit; row stays decorative for now. */}
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

// Render an activity event with the actor's name embedded inline as
// <em class="cargo-od-activity-actor"> for the editorial voice moment.
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

function ActivitySection({ orderId, onViewAll }) {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const top3 = activity.slice(0, 3);

  return (
    <>
      <ul className="cargo-od-activity">
        {top3.map((event) => (
          <li key={event.id} className="cargo-od-activity-item">
            <p className="cargo-od-activity-when">{fmtRelative(event.created_at)}</p>
            <p className="cargo-od-activity-what">{renderActivityWhat(event)}</p>
          </li>
        ))}
      </ul>
      {activity.length > 3 && (
        <button
          type="button"
          className="cargo-od-activity-link"
          onClick={onViewAll}
        >
          View all activity ({activity.length}) →
        </button>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// Footer
// ───────────────────────────────────────────────────────────

// State-appropriate primary action label. Real handlers wired in
// Commits 3-5 alongside document chips, payment style, authorization.
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

function FooterBar({ status, onClose }) {
  const primary = primaryActionFor(status);
  return (
    <div className="cargo-od-footer">
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
      <button type="button" className="cargo-ribbon-btn" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Main drawer
// ───────────────────────────────────────────────────────────

export default function SupplierOrderDrawer({
  open,
  order,
  list,
  acceptAllBusy,
  quoteRowBusy,
  onAcceptAllQuoted,
  onAcceptItemQuote,
  onQueryItemQuote,
  onDeclineItemQuote,
  onClose,
}) {
  const handleViewAllActivity = () => {
    // Inline expand isn't requested — defer to a follow-up. For now,
    // scroll the user back to top so they can see the link disappears
    // (placeholder UX).
    // eslint-disable-next-line no-console
    console.info('[SupplierOrderDrawer] View all activity — wire in a later commit');
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      theme="light"
      width={720}
      panelBg="#FFFEFB"
      hideHeader
      bodyClassName="flex-1 overflow-y-auto"
      footer={order ? <FooterBar status={order.status} onClose={onClose} /> : null}
    >
      {order ? (
        <div className="cargo-od">
          <HeroBlock order={order} list={list} onClose={onClose} />

          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Lifecycle.</span>
            <LifecycleTimeline order={order} />
          </div>

          <div className="cargo-od-section">
            <span className="cargo-od-section-label">
              What's <em>in flight</em>.
            </span>
            <DocumentsSection order={order} />
          </div>

          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Lines.</span>
            <LinesSection
              order={order}
              acceptAllBusy={acceptAllBusy}
              quoteRowBusy={quoteRowBusy}
              onAcceptAllQuoted={onAcceptAllQuoted}
              onAcceptItemQuote={onAcceptItemQuote}
              onQueryItemQuote={onQueryItemQuote}
              onDeclineItemQuote={onDeclineItemQuote}
            />
          </div>

          <div className="cargo-od-section">
            <span className="cargo-od-section-label">
              Recent <em>activity</em>.
            </span>
            <ActivitySection orderId={order.id} onViewAll={handleViewAllActivity} />
          </div>
        </div>
      ) : (
        <p style={{ padding: '2rem 1.5rem', fontSize: 13, color: 'rgba(30,39,66,0.55)' }}>
          No order selected.
        </p>
      )}
    </Drawer>
  );
}
