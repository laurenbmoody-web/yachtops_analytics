import React, { useEffect, useState } from 'react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchClients } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

const SupplierClients = () => {
  const { supplier } = useSupplier();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supplier?.id) return;
    setLoading(true);
    fetchClients(supplier.id)
      .then(setClients)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [supplier?.id]);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{loading ? '…' : `${clients.length} yacht clients`}</div>
          <h1 className="sp-page-title">Yacht <em>clients</em></h1>
          <p className="sp-page-sub">Vessels that have placed orders through your supplier account.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!loading && clients.length === 0 && (
        <EmptyState icon="⛵" title="No clients yet" body="Yachts that have ordered from you will appear here." />
      )}

      {clients.length > 0 && (
        <div className="sp-clients">
          {clients.map(c => {
            const tenant = c.tenants;
            const vesselName = tenant?.vessel_name ?? tenant?.name ?? 'Unknown vessel';
            return (
              <div key={c.id} className="sp-cc">
                <div className="sp-cc-head">
                  <div className="sp-ym m2" style={{ width: 40, height: 40, borderRadius: 11, fontSize: 12 }}>
                    {vesselName.slice(0, 3).toUpperCase()}
                  </div>
                  <div>
                    <h3>{vesselName}</h3>
                    <div className="sub" style={{ textTransform: 'capitalize' }}>{c.status}</div>
                  </div>
                </div>
                {c.payment_terms && (
                  <div style={{ fontSize: 12, color: 'var(--muted-s)', padding: '8px 0 0' }}>
                    Payment terms: {c.payment_terms}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading clients…</div>
      )}
    </div>
  );
};

export default SupplierClients;
