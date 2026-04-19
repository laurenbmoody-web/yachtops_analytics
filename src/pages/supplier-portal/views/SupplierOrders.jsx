import React, { useEffect, useState } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
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

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const fmtAmt  = (a, cur = 'EUR') => {
  if (a == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: 0 }).format(a);
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

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{loading ? '…' : `${orders.length} orders`}</div>
          <h1 className="sp-page-title">Your <em>orders</em></h1>
          <p className="sp-page-sub">Provisioning requests from your yacht clients.</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill" onClick={load}><RefreshCw size={12} />Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
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
        <EmptyState icon="📦" title="No orders yet" body="Orders placed by your yacht clients will appear here." />
      )}

      {orders.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Yacht</th>
                <th>Delivery</th>
                <th>Items</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/supplier/orders/${o.id}`)}>
                  <td>
                    <div className="sp-line-name" style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}>#{o.id.slice(0, 8).toUpperCase()}</div>
                    <div className="sp-line-sku">{fmtDate(o.created_at)}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{o.supplier_name}</div>
                    {o.delivery_port && <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>{o.delivery_port}</div>}
                  </td>
                  <td>
                    <div style={{ fontSize: 13 }}>{fmtDate(o.delivery_date)}</div>
                    {o.delivery_time && <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>{o.delivery_time}</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>{o.supplier_order_items?.length ?? 0} items</td>
                  <td className="sp-amount">
                    {fmtAmt(
                      o.supplier_order_items?.reduce((sum, i) => sum + (i.unit_price ?? 0) * (i.quantity ?? 1), 0),
                      o.currency
                    )}
                  </td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>
                    <button
                      className="sp-rb"
                      onClick={e => { e.stopPropagation(); navigate(`/supplier/orders/${o.id}`); }}
                    >View →</button>
                  </td>
                </tr>
              ))}
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
