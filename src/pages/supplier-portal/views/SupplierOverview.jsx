import React, { useEffect, useState } from 'react';
import { ShoppingBag, FileText, BookOpen, AlertTriangle } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchSupplierKPIs } from '../utils/supplierStorage';
import { SUPPLIER_PORTAL_DEFAULTS } from '../config';
import KPICard from '../components/KPICard';
import EmptyState from '../components/EmptyState';

const DAY_NAMES   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

const formatDateLine = () => {
  const now = new Date();
  const day   = DAY_NAMES[now.getDay()];
  const date  = now.getDate();
  const month = MONTH_NAMES[now.getMonth()];
  const year  = now.getFullYear();
  return `${day} · ${date} ${month} ${year}`;
};

const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const ShieldCheck = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
    <path d="M12 3l7 3.5v5c0 4.5-3 8.25-7 9.5-4-1.25-7-5-7-9.5v-5L12 3z" fill="#e8f5e9" stroke="#4caf50" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M9 12.5l2 2 4-4.5" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SupplierOverview = () => {
  const { supplier, loading: supplierLoading, error: supplierError } = useSupplier();
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

  if (supplierError || !supplier) {
    return (
      <div className="sp-page">
        <EmptyState
          icon="⚠️"
          title="Supplier profile not found"
          body={supplierError ?? 'Your supplier profile could not be loaded. Please contact support.'}
        />
      </div>
    );
  }

  const fmt = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(n ?? 0);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">
            <PinIcon />
            {formatDateLine()} · {SUPPLIER_PORTAL_DEFAULTS.location} · {SUPPLIER_PORTAL_DEFAULTS.temperature}
          </div>
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
          color="blue"
          icon={ShoppingBag}
        />
        <KPICard
          label="Overdue invoices"
          value={kpiLoading ? '…' : kpis?.overdueInvoices ?? 0}
          sub={kpis?.overdueInvoices > 0 ? 'Needs attention' : 'All clear'}
          color={kpis?.overdueInvoices > 0 ? 'orange' : 'green'}
          icon={AlertTriangle}
        />
        <KPICard
          label="Outstanding"
          value={kpiLoading ? '…' : fmt(kpis?.outstandingAmount)}
          sub="Unpaid invoices"
          color="amber"
          icon={FileText}
        />
        <KPICard
          label="Catalogue items"
          value={kpiLoading ? '…' : kpis?.catalogueCount ?? 0}
          sub="Active products"
          icon={BookOpen}
        />
      </div>

      {kpis?.pendingOrders === 0 && kpis?.overdueInvoices === 0 && (
        <div className="sp-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><ShieldCheck /></div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--fg)', marginBottom: 6 }}>All clear</div>
          <div style={{ fontSize: 13, color: 'var(--muted-s)' }}>No pending orders or overdue invoices. Enjoy the quiet.</div>
        </div>
      )}
    </div>
  );
};

export default SupplierOverview;
