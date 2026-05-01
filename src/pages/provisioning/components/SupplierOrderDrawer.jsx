import React, { useEffect, useState, useMemo } from 'react';
import Drawer from './Drawer';
import { fetchSupplierOrderActivity } from '../utils/provisioningStorage';

// Sprint 9c.2 Commit 1.5b — full drawer skeleton.
//
// Sections (top to bottom):
//   1. Title (rich) — Georgia name + mono ref + flag, in Drawer header
//   2. Hero block — status, countdown, delivery facts, money summary
//   3. Lifecycle timeline — placeholder (Commit 2b fills)
//   4. Documents — placeholder slot list (Commit 3 wires)
//   5. Activity feed — LIVE (5 most recent + toggle for full)
//   6. Item count summary — LIVE chips
//   7. Action affordances — placeholder pills
//   8. Items table — existing per-line quote workflow
//   9. Footer — primary action placeholder + close
//
// Subsequent commits replace the placeholders with real interactivity.

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

const fmtMoney = (n, currency = 'EUR') => {
  if (n == null || n === '') return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n)); }
  catch { return `${currency} ${Number(n).toFixed(2)}`; }
};

const shortRef = (id) => String(id || '').slice(0, 8).toUpperCase();

const flagEmoji = (iso) => {
  if (!iso || typeof iso !== 'string' || iso.length !== 2) return '';
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  const u = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(u)) return '';
  return String.fromCodePoint(u.charCodeAt(0) + offset, u.charCodeAt(1) + offset);
};

// Status chip colour palette — same as the summary card. Subsequent commits
// will replace this with the lifecycle indicator's colour scheme.
const statusChipStyle = (status) => {
  if (status === 'paid' || status === 'received' || status === 'confirmed') {
    return { background: '#D1FAE5', color: '#065F46' };
  }
  if (status === 'sent') return { background: '#DBEAFE', color: '#1E40AF' };
  if (status === 'partially_confirmed') return { background: '#FEF3C7', color: '#92400E' };
  if (status === 'invoiced') return { background: '#FED7AA', color: '#9A3412' };
  return { background: '#F1F5F9', color: '#475569' };
};

const fmtStatusLabel = (s) => {
  if (!s) return '';
  if (s === 'partially_confirmed') return 'Partial';
  return s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const fmtDateShort = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return iso; }
};

const fmtTime = (t) => (t ? String(t).slice(0, 5) : null);

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
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return ''; }
};

// Countdown to a future date — null if past.
const daysUntil = (iso) => {
  if (!iso) return null;
  try {
    const target = new Date(iso);
    target.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  } catch { return null; }
};

// ───────────────────────────────────────────────────────────
// Activity event renderer (vessel-side flavour)
// ───────────────────────────────────────────────────────────

// Mirrors the supplier-portal pattern at a slightly simpler level —
// vessel-relevant event types only. Sprint 9c (later) will filter purely
// supplier-internal events (reassigned, delivery_edited) so the feed
// stays useful for chief stews; for now we render everything we receive.
const fmtActivityEvent = (event) => {
  const when = fmtRelative(event.created_at);
  const actor = event.actor_name || event.actor_role || 'system';
  const dot =
    event.event_type === 'order_received' ? 'is-done'
    : event.event_type === 'status_advanced' ? 'is-done'
    : event.event_type === 'item_confirmed' ? 'is-done'
    : event.event_type === 'quote_accepted' ? 'is-done'
    : event.event_type === 'delivery_signed' ? 'is-done'
    : event.event_type === 'delivery_note_emailed' ? 'is-done'
    : event.event_type === 'invoice_generated' ? 'is-done'
    : '';

  switch (event.event_type) {
    case 'order_received':
      return { when, dot, what: `Order received by supplier`, who: `From ${event.payload?.vessel_name || 'vessel'}` };
    case 'status_advanced':
      return { when, dot, what: <>Status: {event.payload?.from || '—'} → <strong>{event.payload?.to || '—'}</strong></>, who: `By ${actor}` };
    case 'reassigned':
      return { when, dot: '', what: 'Order reassigned', who: `By ${actor}` };
    case 'delivery_edited':
      return { when, dot: '', what: `Delivery details edited`, who: `By ${actor}` };
    case 'item_confirmed':
    case 'item_substituted':
    case 'item_unavailable':
      return {
        when, dot,
        what: <>{event.payload?.item_name || 'Item'} {event.event_type.replace('item_', '')}</>,
        who: `By ${actor}`,
      };
    case 'quote_received': {
      const auto = event.payload?.auto_accepted;
      return {
        when, dot: auto ? 'is-done' : '',
        what: <>Quote received — <em>{event.payload?.item_name || 'item'}</em>{auto ? ' · auto-accepted' : ''}</>,
        who: `By ${actor}`,
      };
    }
    case 'quote_accepted':
      return { when, dot, what: <>Quote accepted — <em>{event.payload?.item_name || 'item'}</em></>, who: `By ${actor}` };
    case 'quote_declined':
      return { when, dot: '', what: <>Quote declined — <em>{event.payload?.item_name || 'item'}</em></>, who: `By ${actor}` };
    case 'discussion_opened':
      return { when, dot: '', what: <>Query raised — <em>{event.payload?.item_name || 'item'}</em></>, who: `By ${actor}` };
    case 'order_pdf_generated':
      return { when, dot, what: 'Order PDF generated', who: `By ${actor}` };
    case 'delivery_note_generated':
      return { when, dot, what: <>Delivery note generated{event.payload?.signing_token_minted ? ' · signing link minted' : ''}</>, who: `By ${actor}` };
    case 'delivery_note_emailed':
      return { when, dot, what: 'Delivery note signing link sent', who: `By ${actor}` };
    case 'delivery_signed':
      return { when, dot, what: <>Delivery signed by <strong>{event.payload?.signer_name || actor}</strong></>, who: 'Crew signature' };
    case 'invoice_generated':
      return { when, dot, what: <>Invoice <strong>{event.payload?.invoice_number || 'issued'}</strong></>, who: `By ${actor}` };
    default:
      return { when, dot: '', what: event.event_type, who: actor };
  }
};

// ───────────────────────────────────────────────────────────
// Hero / sections
// ───────────────────────────────────────────────────────────

function HeroBlock({ order }) {
  const items = order.supplier_order_items || [];
  const invoices = order.supplier_invoices || [];
  const currency = order.currency
    || items[0]?.estimated_currency
    || items[0]?.agreed_currency
    || 'EUR';

  const sumOf = (key) => items.reduce((s, it) => s + (Number(it[key]) || 0) * (Number(it.quantity) || 0), 0);
  const estimatedTotal = sumOf('estimated_price');
  const agreedTotal = items.reduce((s, it) => {
    const val = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return s + val * (Number(it.quantity) || 0);
  }, 0);
  const invoicedTotal = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);

  const countdown = daysUntil(order.delivery_date);
  const countdownLabel = countdown == null ? '—'
    : countdown < 0 ? `${Math.abs(countdown)}d overdue`
    : countdown === 0 ? 'Today'
    : countdown === 1 ? 'Tomorrow'
    : `${countdown}d`;

  const status = order.status || 'sent';
  const supplierName = order.supplier_profile?.name || order.supplier_name || 'Supplier';

  return (
    <div className="cargo-od-hero">
      <div className="cargo-od-hero-row">
        <div className="cargo-od-hero-cell">
          <span className="cargo-od-hero-label">Status</span>
          <span className="cargo-od-hero-status" style={statusChipStyle(status)}>
            {fmtStatusLabel(status)}
          </span>
        </div>
        <div className="cargo-od-hero-cell" style={{ textAlign: 'right' }}>
          <span className="cargo-od-hero-label">Countdown</span>
          <span className="cargo-od-hero-value-strong">{countdownLabel}</span>
        </div>
      </div>

      <div className="cargo-od-hero-row">
        <div className="cargo-od-hero-cell">
          <span className="cargo-od-hero-label">Delivery</span>
          <span className="cargo-od-hero-value">
            {fmtDate(order.delivery_date)}
            {fmtTime(order.delivery_time) && ` · ${fmtTime(order.delivery_time)}`}
          </span>
          {order.delivery_port && (
            <span className="cargo-od-hero-value" style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 500, marginTop: 2 }}>
              {order.delivery_port}
            </span>
          )}
        </div>
        <div className="cargo-od-hero-cell">
          <span className="cargo-od-hero-label">To · Contact</span>
          <span className="cargo-od-hero-value">{supplierName}</span>
          {order.delivery_contact && (
            <span className="cargo-od-hero-value" style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 500, marginTop: 2 }}>
              Attn: {order.delivery_contact}
            </span>
          )}
        </div>
      </div>

      <div className="cargo-od-money">
        <div className="cargo-od-money-cell">
          <span className="cargo-od-money-label">Estimated</span>
          <span className="cargo-od-money-value">{fmtMoney(estimatedTotal, currency)}</span>
        </div>
        <div className="cargo-od-money-cell">
          <span className="cargo-od-money-label">Agreed</span>
          <span className="cargo-od-money-value">{fmtMoney(agreedTotal, currency)}</span>
        </div>
        <div className="cargo-od-money-cell">
          <span className="cargo-od-money-label">Invoiced</span>
          <span className="cargo-od-money-value">
            {invoices.length > 0 ? fmtMoney(invoicedTotal, currency) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

function LifecycleTimelinePlaceholder() {
  return (
    <div className="cargo-od-placeholder">
      Lifecycle timeline · 8 stages with adaptive label density · lands in Sprint 9c.2 Commit 2b.
    </div>
  );
}

function DocumentsPlaceholder({ order }) {
  const slots = [
    {
      name: 'Order PDF',
      state: order.order_pdf_url ? 'Generated' : 'Not generated',
    },
    {
      name: 'Delivery note',
      state: order.delivery_note_signed_pdf_url
        ? 'Signed'
        : order.delivery_note_pdf_url
        ? (order.delivery_note_emailed_at ? 'Sent for signature' : 'Generated')
        : 'Not generated',
    },
    {
      name: 'Invoice',
      state: (order.supplier_invoices || []).length > 0 ? 'Received' : 'Not received',
    },
  ];
  return (
    <ul className="cargo-od-doc-slots">
      {slots.map((s) => (
        <li key={s.name} className="cargo-od-doc-slot">
          <span className="cargo-od-doc-slot-name">{s.name}</span>
          <span className="cargo-od-doc-slot-state">{s.state}</span>
        </li>
      ))}
    </ul>
  );
}

function ActivityFeed({ orderId }) {
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

  if (loading) {
    return <p className="cargo-od-activity-empty">Loading activity…</p>;
  }
  if (activity.length === 0) {
    return <p className="cargo-od-activity-empty">No activity yet.</p>;
  }

  const visible = showAll ? activity : activity.slice(0, 5);
  const truncated = !showAll && activity.length > 5;

  return (
    <>
      <ul className="cargo-od-activity">
        {visible.map((event) => {
          const { when, dot, what, who } = fmtActivityEvent(event);
          return (
            <li key={event.id} className={`cargo-od-activity-item ${dot}`}>
              <p className="cargo-od-activity-when">{when}</p>
              <p className="cargo-od-activity-what">{what}</p>
              {who && <p className="cargo-od-activity-who">{who}</p>}
            </li>
          );
        })}
      </ul>
      {(truncated || showAll) && activity.length > 5 && (
        <button
          type="button"
          className="cargo-od-activity-toggle"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show 5 most recent ↑' : `View all activity (${activity.length}) →`}
        </button>
      )}
    </>
  );
}

function ItemCounts({ items }) {
  const counts = useMemo(() => {
    const total = items.length;
    const byStatus = items.reduce((acc, it) => {
      const s = it.status || it.quote_status || 'pending';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    return { total, byStatus, totalQty };
  }, [items]);

  if (counts.total === 0) {
    return <p className="cargo-od-activity-empty">No items on this order.</p>;
  }

  const chips = [
    { label: 'Items', value: counts.total },
    { label: 'Total qty', value: counts.totalQty },
    { label: 'Pending', value: counts.byStatus.pending || 0, hideIfZero: true },
    { label: 'Confirmed', value: counts.byStatus.confirmed || 0, hideIfZero: true },
    { label: 'Substituted', value: counts.byStatus.substituted || 0, hideIfZero: true },
    { label: 'Unavailable', value: counts.byStatus.unavailable || 0, hideIfZero: true },
  ].filter((c) => !c.hideIfZero || c.value > 0);

  return (
    <div className="cargo-od-counts">
      {chips.map((c) => (
        <span key={c.label} className="cargo-od-count-chip">
          <strong>{c.value}</strong> {c.label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

function ActionPills({ status }) {
  // Stage-appropriate placeholder pills. Real handlers wired in
  // Commits 3-5 alongside document chips, payment style variants,
  // and the authorization workflow.
  const pills = [];
  if (status === 'sent' || status === 'confirmed') {
    pills.push({ label: 'Awaiting supplier' });
  }
  if (status === 'dispatched' || status === 'out_for_delivery') {
    pills.push({ label: 'Mark received' });
    pills.push({ label: 'Report issue' });
  }
  if (status === 'received') {
    pills.push({ label: 'Awaiting invoice' });
  }
  if (status === 'invoiced') {
    pills.push({ label: 'Mark paid' });
    pills.push({ label: 'Dispute' });
  }
  if (pills.length === 0) {
    pills.push({ label: 'No actions yet' });
  }

  return (
    <div className="cargo-od-actions">
      {pills.map((p) => (
        <button
          key={p.label}
          type="button"
          className="cargo-ribbon-btn"
          disabled
          title="Action wired in a later commit"
          style={{ fontSize: 11 }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Items table — existing per-line quote workflow (verbatim from C1.5)
// ───────────────────────────────────────────────────────────

const stateBadge = (label, bg, color) => (
  <span style={{
    display: 'inline-block', fontSize: 10, fontWeight: 700,
    letterSpacing: '0.05em', textTransform: 'uppercase',
    padding: '2px 8px', borderRadius: 999,
    background: bg, color,
  }}>{label}</span>
);

function ItemsTable({ order, quoteRowBusy, onAcceptItemQuote, onQueryItemQuote, onDeclineItemQuote }) {
  const items = order.supplier_order_items || [];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
      <thead>
        <tr style={{ background: '#F8FAFC' }}>
          <th style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Item</th>
          <th style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Qty</th>
          <th style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Price</th>
          <th style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => {
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
              <span style={{
                display: 'inline-block', marginLeft: 6,
                fontSize: 10, fontWeight: 700,
                padding: '1px 6px', borderRadius: 999,
                background: up ? '#FEF3C7' : '#D1FAE5',
                color: up ? '#92400E' : '#065F46',
              }}>{up ? '+' : ''}{pct.toFixed(1)}%</span>
            );
          }

          let priceCell, actionCell;
          if (qStatus === 'agreed') {
            priceCell = (
              <>
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(it.agreed_price, cur)}</div>
                <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>Agreed</div>
              </>
            );
            actionCell = stateBadge('Agreed', '#D1FAE5', '#065F46');
          } else if (qStatus === 'awaiting_quote') {
            priceCell = (
              <div style={{ fontVariantNumeric: 'tabular-nums', color: '#64748B' }}>est. {fmtMoney(it.estimated_price, cur)}</div>
            );
            actionCell = <span style={{ fontSize: 11, color: '#94A3B8' }}>Awaiting supplier quote</span>;
          } else if (qStatus === 'unavailable') {
            priceCell = <span style={{ color: '#94A3B8' }}>—</span>;
            actionCell = stateBadge('Unavailable', '#FEE2E2', '#991B1B');
          } else if (qStatus === 'declined') {
            priceCell = <div style={{ fontSize: 11, color: '#94A3B8' }}>est. {fmtMoney(it.estimated_price, cur)}</div>;
            actionCell = <span style={{ fontSize: 11, color: '#92400E' }}>Declined — awaiting re-quote</span>;
          } else {
            const isDiscussion = qStatus === 'in_discussion';
            priceCell = (
              <>
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(it.quoted_price, cur)}
                  {deltaChip}
                </div>
                <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>est. {fmtMoney(it.estimated_price, cur)}</div>
                {isDiscussion && <div style={{ marginTop: 4 }}>{stateBadge('Query open', '#FEF3C7', '#92400E')}</div>}
              </>
            );
            actionCell = (
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <button type="button" onClick={() => onAcceptItemQuote(it)} disabled={isBusy}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #059669', background: '#D1FAE5', color: '#065F46', cursor: isBusy ? 'wait' : 'pointer' }}>
                  Accept
                </button>
                {!isDiscussion && (
                  <button type="button" onClick={() => onQueryItemQuote(it)} disabled={isBusy}
                    style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #D97706', background: '#FEF3C7', color: '#92400E', cursor: isBusy ? 'wait' : 'pointer' }}>
                    Query
                  </button>
                )}
                <button type="button" onClick={() => onDeclineItemQuote(it)} disabled={isBusy}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 14, border: '1px solid #DC2626', background: '#FEE2E2', color: '#991B1B', cursor: isBusy ? 'wait' : 'pointer' }}>
                  Decline
                </button>
              </div>
            );
          }

          return (
            <tr key={it.id} style={{ borderBottom: i < items.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
              <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink)' }}>
                {it.item_name}
                {it.substitute_description && <span style={{ marginLeft: 6, fontSize: 11, color: '#D97706' }}>→ {it.substitute_description}</span>}
              </td>
              <td style={{ padding: '8px 10px', fontSize: 13, color: '#475569', textAlign: 'center' }}>{it.quantity} {it.unit || ''}</td>
              <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink)', textAlign: 'right' }}>{priceCell}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{actionCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ───────────────────────────────────────────────────────────
// Main drawer
// ───────────────────────────────────────────────────────────

export default function SupplierOrderDrawer({
  open,
  order,
  acceptAllBusy,
  quoteRowBusy,
  onAcceptAllQuoted,
  onAcceptItemQuote,
  onQueryItemQuote,
  onDeclineItemQuote,
  onClose,
}) {
  const items = order?.supplier_order_items || [];
  const quotedCount = items.filter((x) => x.quote_status === 'quoted').length;
  const acceptAllBusyForThis = order && acceptAllBusy === order.id;

  // Rich header title — Georgia name + mono ref + flag.
  const titleNode = order ? (
    <div className="cargo-od-title">
      <span className="cargo-od-title-name">
        {order.supplier_profile?.name || order.supplier_name || 'Order'}
      </span>
      <span className="cargo-od-title-ref">#{shortRef(order.id)}</span>
      {order.supplier_profile?.business_country && (
        <span className="cargo-od-title-flag" title={order.supplier_profile.business_country}>
          {flagEmoji(order.supplier_profile.business_country)}
        </span>
      )}
    </div>
  ) : 'Order';

  // Footer primary action — placeholder per status. Wired in later commits.
  const primaryAction = (() => {
    if (!order) return { label: 'Close', disabled: true };
    switch (order.status) {
      case 'draft':            return { label: 'Send to supplier',   disabled: true };
      case 'sent':              return { label: 'Awaiting confirmation', disabled: true };
      case 'confirmed':        return { label: 'Awaiting dispatch', disabled: true };
      case 'dispatched':       return { label: 'Awaiting delivery', disabled: true };
      case 'out_for_delivery': return { label: 'Mark received',     disabled: true };
      case 'received':          return { label: 'Awaiting invoice',  disabled: true };
      case 'invoiced':          return { label: 'Mark paid',         disabled: true };
      case 'paid':              return { label: 'Order closed',      disabled: true };
      default:                  return { label: 'Continue',          disabled: true };
    }
  })();

  // Custom footer — back link on left, primary on right
  const footerNode = order && (
    <div className="cargo-od-footer">
      <button type="button" className="cargo-od-footer-back" onClick={onClose}>← Close</button>
      <button
        type="button"
        className="cargo-od-footer-primary"
        disabled={primaryAction.disabled}
        title="Wired in later commits"
      >
        {primaryAction.label}
      </button>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={titleNode}
      theme="light"
      width={720}
      footer={footerNode}
    >
      {order ? (
        <div className="cargo-od">
          {/* 1. Hero block */}
          <div className="cargo-od-section">
            <HeroBlock order={order} />
          </div>

          {/* 2. Lifecycle timeline (placeholder) */}
          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Lifecycle</span>
            <LifecycleTimelinePlaceholder />
          </div>

          {/* 3. Documents (placeholder slot list) */}
          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Documents</span>
            <DocumentsPlaceholder order={order} />
          </div>

          {/* 4. Activity feed — LIVE */}
          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Activity</span>
            <ActivityFeed orderId={order.id} />
          </div>

          {/* 5. Item count summary — LIVE */}
          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Items at a glance</span>
            <ItemCounts items={items} />
          </div>

          {/* 6. Action affordances — placeholder pills */}
          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Actions</span>
            <ActionPills status={order.status} />
          </div>

          {/* 7. Items table — existing per-line quote workflow */}
          <div className="cargo-od-section">
            <span className="cargo-od-section-label">Lines</span>
            {quotedCount >= 2 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => onAcceptAllQuoted(order)}
                  disabled={acceptAllBusyForThis}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 12px',
                    borderRadius: 20, border: '1px solid #1E40AF',
                    background: acceptAllBusyForThis ? '#DBEAFE' : '#EFF6FF',
                    color: '#1E40AF', cursor: acceptAllBusyForThis ? 'wait' : 'pointer',
                  }}
                >
                  {acceptAllBusyForThis ? 'Accepting…' : `Accept ${quotedCount} quoted prices`}
                </button>
              </div>
            )}
            <ItemsTable
              order={order}
              quoteRowBusy={quoteRowBusy}
              onAcceptItemQuote={onAcceptItemQuote}
              onQueryItemQuote={onQueryItemQuote}
              onDeclineItemQuote={onDeclineItemQuote}
            />
            {order.supplier_notes && (
              <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
                "{order.supplier_notes}"
              </p>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No order selected.</p>
      )}
    </Drawer>
  );
}
