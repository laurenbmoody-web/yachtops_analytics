import React, { useEffect, useState } from 'react';
import { Truck, RefreshCw } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchDeliveries } from '../utils/supplierStorage';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';

const SupplierDeliveries = () => {
  const { supplier } = useSupplier();
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    setError(null);
    fetchDeliveries(supplier.id)
      .then(setDeliveries)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id]);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{loading ? '…' : `${deliveries.length} deliveries`}</div>
          <h1 className="sp-page-title">Delivery <em>schedule</em></h1>
          <p className="sp-page-sub">Upcoming and recent deliveries to your yacht clients.</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill" onClick={load}><RefreshCw size={12} />Refresh</button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!loading && deliveries.length === 0 && (
        <EmptyState icon="🚚" title="No deliveries scheduled" body="Confirmed orders will generate deliveries here." />
      )}

      {deliveries.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Yacht</th>
                <th>Date &amp; time</th>
                <th>Berth</th>
                <th>Driver</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{d.yacht_name ?? '—'}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{fmtDate(d.scheduled_date)}</div>
                    {d.scheduled_time && <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>{d.scheduled_time.slice(0,5)}</div>}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted-s)' }}>{d.berth ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>{d.driver ?? '—'}</td>
                  <td><StatusBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading deliveries…</div>
      )}
    </div>
  );
};

export default SupplierDeliveries;
