import React, { useEffect, useState } from 'react';
import { RefreshCw, ArrowRight, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchSupplierOrders } from '../utils/supplierStorage';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

const TABS = [
  { key: 'all',                 label: 'All' },
  { key: 'sent',                label: 'New' },
  { key: 'confirmed',           label: 'Confirmed' },
  { key: 'partially_confirmed', label: 'Partial' },
  { key: 'draft',               label: 'Draft' },
];

// Orders still to fulfil — used for deliver-by urgency (a delivered order is
// never "overdue").
const OPEN_STATUSES = new Set([
  'draft', 'sent', 'confirmed', 'partially_confirmed', 'picking', 'packed',
  'dispatched', 'out_for_delivery',
]);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtAmt  = (a, cur = 'EUR') => (a == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: 0 }).format(a));

// The agreed price wins, then the supplier's quote, then the buyer's estimate.
// (unit_price is a legacy column that's empty on marketplace orders — summing
// it alone showed €0 totals.)
const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);

// The yacht that placed the order (mirrors the order-detail priority).
const yachtOf = (o) => o.yacht_client_name || o.vessel_name || o.yacht_name || 'Yacht client';
const initialsOf = (name) => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—';
// Stable soft tint per yacht so rows are scannable.
const TINTS = [
  { bg: '#EAF1FB', fg: '#3B6BA5' }, { bg: '#FBEFE9', fg: '#C65A1A' }, { bg: '#EAF6EF', fg: '#1D7A4D' },
  { bg: '#F3EEFB', fg: '#6D4BA5' }, { bg: '#FDF2E7', fg: '#B07A16' }, { bg: '#FBEAF0', fg: '#B23A6B' },
];
const tintOf = (name) => TINTS[[...(name || 'x')].reduce((h, c) => (h + c.charCodeAt(0)) | 0, 0) % TINTS.length];

// Items the supplier still needs to resolve (couldn't supply / swapped).
const flaggedCount = (o) => (o.supplier_order_items ?? []).filter(i => i.status === 'unavailable' || i.status === 'substituted').length;

// Deliver-by urgency for an open order.
const deliverUrgency = (o) => {
  if (!o.delivery_date || !OPEN_STATUSES.has(o.status)) return null;
  const days = Math.ceil((new Date(o.delivery_date) - new Date()) / 86400000);
  if (days < 0)  return { tone: 'var(--red)',   label: 'overdue' };
  if (days === 0) return { tone: 'var(--red)',   label: 'today' };
  if (days <= 2) return { tone: 'var(--amber)', label: `in ${days}d` };
  return null;
};

const SupplierOrders = () => {
  const { supplier } = useSupplier();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    setError(null);
    fetchSupplierOrders(supplier.id, { status: tab })
      .then(setOrders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id, tab]);

  const newCount = orders.filter(o => o.status === 'sent').length;
  const sub = loading
    ? 'Loading…'
    : orders.length === 0
      ? 'Provisioning requests from your yacht clients land here.'
      : newCount > 0
        ? `${newCount} new order${newCount === 1 ? '' : 's'} waiting on you.`
        : 'All caught up — nothing new to confirm.';

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow"><span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#C65A1A', marginRight: 6, verticalAlign: 'middle' }} />{loading ? '…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`}</div>
          <h1 className="sp-page-title">Your orders <em>inbox</em></h1>
          <p className="sp-page-sub">{sub}</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill" onClick={load}><RefreshCw size={12} />Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: tab === t.key ? 700 : 500,
              border: tab === t.key ? '1px solid var(--navy)' : '1px solid var(--line)',
              background: tab === t.key ? 'var(--navy)' : 'var(--card)',
              color: tab === t.key ? '#fff' : 'var(--muted-s)',
              cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <EmptyState icon="📦" title={tab === 'all' ? 'No orders yet' : 'Nothing in this list'} body={tab === 'all' ? 'Orders placed by your yacht clients will appear here.' : 'Try another tab — orders move through as you work them.'} />
      )}

      {orders.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Yacht</th>
                <th>Deliver by</th>
                <th>Items</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const yacht = yachtOf(o);
                const tint = tintOf(yacht);
                const flagged = flaggedCount(o);
                const urg = deliverUrgency(o);
                const isNew = o.status === 'sent';
                return (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/supplier/orders/${o.id}`)}>
                    <td>
                      <div className="sp-line-name" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 12 }}>#{o.id.slice(0, 8).toUpperCase()}</div>
                      <div className="sp-line-sku">{fmtDate(o.created_at)}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: tint.bg, color: tint.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{initialsOf(yacht)}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{yacht}</div>
                          {o.delivery_port && <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>{o.delivery_port}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: urg ? 700 : 400, color: urg ? urg.tone : 'var(--fg-2)' }}>{fmtDate(o.delivery_date)}</div>
                      {urg
                        ? <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: urg.tone, marginTop: 2 }}>{urg.label}</div>
                        : o.delivery_time && <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>{o.delivery_time}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{o.supplier_order_items?.length ?? 0}</span> <span style={{ color: 'var(--muted-s)' }}>items</span>
                      {flagged > 0 && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--amber)', marginTop: 2 }}>
                          <AlertTriangle size={10} /> {flagged} flagged
                        </div>
                      )}
                    </td>
                    <td className="sp-amount">{fmtAmt(orderTotal(o), o.currency || 'EUR')}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        className={isNew ? 'sp-pill primary' : 'sp-pill'}
                        style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                        onClick={() => navigate(`/supplier/orders/${o.id}`)}
                      >{isNew ? <>Review <ArrowRight size={11} /></> : 'View →'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading orders…</div>
      )}
    </div>
  );
};

export default SupplierOrders;
