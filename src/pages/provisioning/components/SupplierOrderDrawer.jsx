import React from 'react';
import Drawer from './Drawer';

// Sprint 9c.2 Commit 1.5 — slide-in drawer for the supplier order detail.
// Replaces the inline expansion that was getting too dense (per-line quote
// workflow + items list + soon: lifecycle indicator + document chips +
// payment style + activity feed). Drawer pattern matches the Edit Board
// drawer that already lives on the kanban index page.
//
// Subsequent commits will add inside this drawer:
//   - 9c.2 Commit 2b: full editorial timeline with adaptive label density
//                     (compact 8-dot indicator lives on the summary card,
//                     not here)
//   - 9c.2 Commit 3:  document chips with status states
//   - 9c.2 Commit 4:  payment style chip + actions
//   - 9c.2 Commit 5:  authorization popover at Quoted → Confirmed
//
// Commit 1.5 ships the architecture only — pulls the existing per-line
// quote workflow JSX into the drawer body verbatim. Visual unchanged.

const fmtMoney = (n, currency) => {
  if (n == null) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n)); }
  catch { return `${currency} ${Number(n).toFixed(2)}`; }
};

const stateBadge = (label, bg, color) => (
  <span style={{
    display: 'inline-block', fontSize: 10, fontWeight: 700,
    letterSpacing: '0.05em', textTransform: 'uppercase',
    padding: '2px 8px', borderRadius: 999,
    background: bg, color,
  }}>{label}</span>
);

function ItemsTable({
  order,
  quoteRowBusy,
  onAcceptItemQuote,
  onQueryItemQuote,
  onDeclineItemQuote,
}) {
  const items = order.supplier_order_items || [];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
      <thead>
        <tr style={{ background: '#F8FAFC' }}>
          <th style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Item</th>
          <th style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qty</th>
          <th style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Price</th>
          <th style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: '#94A3B8', textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => {
          const cur = it.estimated_currency || it.quoted_currency || it.agreed_currency || order.currency || 'EUR';
          const qStatus = it.quote_status || 'awaiting_quote';
          const isBusy = quoteRowBusy === it.id;

          // Delta chip (quoted vs estimated, when both exist + differ).
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
            actionCell = (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>Awaiting supplier quote</span>
            );
          } else if (qStatus === 'unavailable') {
            priceCell = <span style={{ color: '#94A3B8' }}>—</span>;
            actionCell = stateBadge('Unavailable', '#FEE2E2', '#991B1B');
          } else if (qStatus === 'declined') {
            priceCell = <div style={{ fontSize: 11, color: '#94A3B8' }}>est. {fmtMoney(it.estimated_price, cur)}</div>;
            actionCell = (
              <span style={{ fontSize: 11, color: '#92400E' }}>Declined — awaiting re-quote</span>
            );
          } else {
            // 'quoted' OR 'in_discussion' → show price + actions
            const isDiscussion = qStatus === 'in_discussion';
            priceCell = (
              <>
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(it.quoted_price, cur)}
                  {deltaChip}
                </div>
                <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>est. {fmtMoney(it.estimated_price, cur)}</div>
                {isDiscussion && (
                  <div style={{ marginTop: 4 }}>
                    {stateBadge('Query open', '#FEF3C7', '#92400E')}
                  </div>
                )}
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
              <td style={{ padding: '8px 10px', fontSize: 13, color: '#0F172A' }}>
                {it.item_name}
                {it.substitute_description && <span style={{ marginLeft: 6, fontSize: 11, color: '#D97706' }}>→ {it.substitute_description}</span>}
              </td>
              <td style={{ padding: '8px 10px', fontSize: 13, color: '#475569', textAlign: 'center' }}>{it.quantity} {it.unit || ''}</td>
              <td style={{ padding: '8px 10px', fontSize: 13, color: '#0F172A', textAlign: 'right' }}>{priceCell}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{actionCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function SupplierOrderDrawer({
  open,
  order,
  drawerTitle,
  acceptAllBusy,
  quoteRowBusy,
  onAcceptAllQuoted,
  onAcceptItemQuote,
  onQueryItemQuote,
  onDeclineItemQuote,
  onClose,
}) {
  // Drawer width slightly wider than the default 480 because the items
  // table needs room for 4 columns + action button rows.
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={drawerTitle || 'Order'}
      theme="light"
      width={560}
    >
      {order ? (
        <>
          {(() => {
            const items = order.supplier_order_items || [];
            const quotedCount = items.filter((x) => x.quote_status === 'quoted').length;
            if (quotedCount < 2) return null;
            const isBusy = acceptAllBusy === order.id;
            return (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => onAcceptAllQuoted(order)}
                  disabled={isBusy}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 12px',
                    borderRadius: 20, border: '1px solid #1E40AF',
                    background: isBusy ? '#DBEAFE' : '#EFF6FF',
                    color: '#1E40AF', cursor: isBusy ? 'wait' : 'pointer',
                  }}
                >
                  {isBusy ? 'Accepting…' : `Accept ${quotedCount} quoted prices`}
                </button>
              </div>
            );
          })()}

          <ItemsTable
            order={order}
            quoteRowBusy={quoteRowBusy}
            onAcceptItemQuote={onAcceptItemQuote}
            onQueryItemQuote={onQueryItemQuote}
            onDeclineItemQuote={onDeclineItemQuote}
          />

          {order.supplier_notes && (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748B', fontStyle: 'italic' }}>
              "{order.supplier_notes}"
            </p>
          )}
        </>
      ) : (
        <p style={{ fontSize: 13, color: '#94A3B8' }}>No order selected.</p>
      )}
    </Drawer>
  );
}
