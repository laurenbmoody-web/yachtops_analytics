import React from 'react';
import { fetchInvoiceSignedUrl } from '../utils/provisioningStorage';

// ── OrderCard ──────────────────────────────────────────────────────────────
// Canonical visual for a supplier_order. Same card used by:
//   - ProvisioningBoardDetail's Orders tab (board-context, opens detail
//     at /provisioning/:boardId/orders/:orderId)
//   - SupplierOrdersIndex tenant-wide list (no board context, opens
//     detail at /provisioning/orders/:orderId)
//
// Lifted directly from the inline rendering that lived in
// ProvisioningBoardDetail.jsx so the two surfaces are now guaranteed
// pixel-identical. CSS lives in pages/pantry/pantry.css (.cargo-order-card-*
// classes) — consumers must ensure that stylesheet is loaded.
//
// Props:
//   order              — supplier_orders row with joined supplier_order_items
//                        + supplier_invoices + supplier_profile. The same
//                        shape both fetchSupplierOrders (per-board) and
//                        fetchAllSupplierOrders (tenant-wide) return.
//   onNavigate(id)     — card click + Enter/Space. Callers compose the URL
//                        (with or without :boardId).
//   canFavouriteOrder  — gates the star toggle; UI gate only, server RPC
//                        is the source of truth.
//   onToggleFavourite  — handler for the star.
//   favouritingOrderId — disables the star while a toggle is in flight.

const flagEmoji = (iso) => {
  if (!iso || typeof iso !== 'string' || iso.length !== 2) return '';
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  const u = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(u)) return '';
  return String.fromCodePoint(u.charCodeAt(0) + offset, u.charCodeAt(1) + offset);
};

const shortOrderRef = (id) => String(id || '').slice(0, 8).toUpperCase();

// Active lifecycle states get the 5px navy bottom edge. Terminal states
// (paid / draft) keep just the hairline. Mirrors the set defined inline
// in ProvisioningBoardDetail.
const ACTIVE_ORDER_STATES = new Set([
  'sent',
  'confirmed',
  'dispatched',
  'out_for_delivery',
  'received',
  'invoiced',
]);

const STATUS_PALETTE = {
  confirmed:           { bg: '#D1FAE5', text: '#065F46' },
  partially_confirmed: { bg: '#FEF3C7', text: '#92400E' },
  paid:                { bg: '#D1FAE5', text: '#065F46' },
  received:            { bg: '#D1FAE5', text: '#065F46' },
  sent:                { bg: '#DBEAFE', text: '#1E40AF' },
};
const DEFAULT_STATUS_COLOR = { bg: '#F1F5F9', text: '#475569' };

const fmtCur = (a, c = 'EUR') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(a) || 0);
  } catch { return `${c} ${Number(a || 0).toFixed(2)}`; }
};

export default function OrderCard({
  order,
  onNavigate,
  canFavouriteOrder = false,
  onToggleFavourite,
  favouritingOrderId = null,
}) {
  const statusColor = STATUS_PALETTE[order.status] || DEFAULT_STATUS_COLOR;
  const orderItems = order.supplier_order_items || [];
  const isActive = ACTIVE_ORDER_STATES.has(order.status);
  const country = order.supplier_profile?.business_country || null;
  const flag = flagEmoji(country);
  const displayName = order.supplier_profile?.name || order.supplier_name || 'Supplier';
  const orderRef = shortOrderRef(order.id);

  // Most-recent invoice (sorted desc by created_at) for the bottom action row.
  const invoices = order.supplier_invoices || [];
  const invoice = invoices.length > 0
    ? [...invoices].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    : null;

  const handleClick = () => onNavigate?.(order.id);
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onNavigate?.(order.id);
    }
  };

  return (
    <div className={`cargo-order-card${isActive ? ' cargo-order-card-active' : ''}`}>
      <div
        className="cargo-order-card-row"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <span className="cargo-order-card-chevron" aria-hidden="true">›</span>
        <div className="cargo-order-card-identity">
          <h3 className="cargo-order-card-supplier">
            {displayName}
            {/* Always show a static ★ next to favourited orders so the
                indicator persists on read-only contexts (Orders index,
                board detail) where the toggle button isn't rendered.
                Interactive toggle button still rendered below when
                canFavouriteOrder + onToggleFavourite are both provided. */}
            {order.is_favourite && !canFavouriteOrder && (
              <span style={{ color: '#C65A1A', marginLeft: 8, fontSize: '0.9em' }} aria-label="Favourited">★</span>
            )}
          </h3>
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
        {canFavouriteOrder && onToggleFavourite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavourite(order); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
            disabled={favouritingOrderId === order.id}
            title={order.is_favourite ? 'Unfavourite this order' : 'Favourite this order'}
            aria-label={order.is_favourite ? 'Unfavourite' : 'Favourite'}
            style={{
              background: 'none', border: 0, padding: '2px 6px',
              cursor: favouritingOrderId === order.id ? 'default' : 'pointer',
              fontSize: 18, lineHeight: 1,
              color: order.is_favourite ? '#C65A1A' : '#94A3B8',
              opacity: favouritingOrderId === order.id ? 0.5 : 1,
            }}
          >
            {order.is_favourite ? '★' : '☆'}
          </button>
        )}
        <span
          className="cargo-order-card-status"
          style={{ background: statusColor.bg, color: statusColor.text }}
        >
          {order.status === 'partially_confirmed' ? 'Partial'
            : order.status === 'out_for_delivery' ? 'Out for delivery'
            : (order.status || '').replace(/_/g, ' ')}
        </span>
      </div>

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
}
