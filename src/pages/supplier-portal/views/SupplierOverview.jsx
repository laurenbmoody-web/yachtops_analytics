import React, { useEffect, useState } from 'react';
import { ShoppingBag, FileText, BookOpen, AlertTriangle } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchSupplierKPIs } from '../utils/supplierStorage';
import KPICard from '../components/KPICard';
import EmptyState from '../components/EmptyState';

const SupplierOverview = () => {
  const { supplier, loading: supplierLoading } = useSupplier();
  const [kpis, setKpis] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supplier?.id) return;
    setKpiLoading(true);
    fetchSupplierKPIs(supplier.id)
      .then(setKpis)
      .catch(e => setError(e.message))
      .finally(() => setKpiLoading(false));
  }, [supplier?.id]);

  if (supplierLoading) {
    return (
      <div className="sp-page">
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>Loading…</div>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="sp-page">
        <EmptyState icon="⚠️" title="Supplier not found" body="Your supplier profile could not be loaded. Please contact support." />
      </div>
    );
  }

  const fmt = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(n ?? 0);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Workspace · {supplier.name}</div>
          <h1 className="sp-page-title">Good <em>morning</em></h1>
          <p className="sp-page-sub">Here's what's happening across your supplier account today.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--red)' }}>
          Failed to load KPIs: {error}
        </div>
      )}

      <div className="sp-kpis" style={{ marginBottom: 32 }}>
        <KPICard
          label="Active orders"
          value={kpiLoading ? '…' : kpis?.pendingOrders ?? 0}
          sub="Awaiting confirmation"
          accent="var(--blue)"
          icon={ShoppingBag}
        />
        <KPICard
          label="Overdue invoices"
          value={kpiLoading ? '…' : kpis?.overdueInvoices ?? 0}
          sub={kpis?.overdueInvoices > 0 ? 'Needs attention' : 'All clear'}
          accent={kpis?.overdueInvoices > 0 ? 'var(--red)' : 'var(--green)'}
          icon={AlertTriangle}
        />
        <KPICard
          label="Outstanding"
          value={kpiLoading ? '…' : fmt(kpis?.outstandingAmount)}
          sub="Unpaid invoices"
          accent="var(--amber)"
          icon={FileText}
        />
        <KPICard
          label="Catalogue items"
          value={kpiLoading ? '…' : kpis?.catalogueCount ?? 0}
          sub="Active products"
          accent="var(--navy)"
          icon={BookOpen}
        />
      </div>

      {kpis?.pendingOrders === 0 && kpis?.overdueInvoices === 0 && (
        <div className="sp-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--fg)', marginBottom: 6 }}>All clear</div>
          <div style={{ fontSize: 13, color: 'var(--muted-s)' }}>No pending orders or overdue invoices. Enjoy the quiet.</div>
        </div>
      )}
    </div>
  );
};

export default SupplierOverview;
