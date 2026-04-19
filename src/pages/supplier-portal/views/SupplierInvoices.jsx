import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchInvoices } from '../utils/supplierStorage';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';

const TABS = [
  { key: 'all',     label: 'All' },
  { key: 'sent',    label: 'Sent' },
  { key: 'paid',    label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
];

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
const fmtAmt  = (a, cur = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: 0 }).format(a ?? 0);

const SupplierInvoices = () => {
  const { supplier } = useSupplier();
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    setError(null);
    fetchInvoices(supplier.id, { status: tab })
      .then(setInvoices)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id, tab]);

  const totalOutstanding = invoices
    .filter(i => ['sent', 'overdue'].includes(i.status))
    .reduce((s, i) => s + (i.amount ?? 0), 0);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{loading ? '…' : `${invoices.length} invoices`}</div>
          <h1 className="sp-page-title">Your <em>invoices</em></h1>
          <p className="sp-page-sub">
            Outstanding: {fmtAmt(totalOutstanding)} · track payments from your yacht clients.
          </p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill" onClick={load}><RefreshCw size={12} />Refresh</button>
        </div>
      </div>

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

      {!loading && invoices.length === 0 && (
        <EmptyState icon="🧾" title="No invoices yet" body="Invoices will appear here once you start billing." />
      )}

      {invoices.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Yacht</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td>
                    <div className="sp-line-name" style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}>{inv.invoice_number}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>{inv.yacht_name ?? '—'}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--muted-s)' }}>{fmtDate(inv.issue_date)}</td>
                  <td className="mono" style={{ fontSize: 12, color: inv.status === 'overdue' ? 'var(--red)' : 'var(--muted-s)' }}>{fmtDate(inv.due_date)}</td>
                  <td className="sp-amount">{fmtAmt(inv.amount, inv.currency)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading invoices…</div>
      )}
    </div>
  );
};

export default SupplierInvoices;
