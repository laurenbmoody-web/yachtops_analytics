// Cargo Accounts — Outstanding invoices (/accounts/payables). The crew
// "money owed" surface: every unpaid supplier invoice for the tenant, newest
// due first, with the amount owed and (for COMMAND) a Mark-paid action that
// settles it and posts it to the ledger. Editorial (Cargo) system, reusing the
// accounts.css page shell.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { formatMoney } from '../../../services/financeCalc';
import {
  fetchOutstandingInvoices,
  markInvoicePaid,
  fetchInvoiceSignedUrl,
  fetchCardPaymentConfig,
  startSupplierCardPayment,
} from '../../provisioning/utils/provisioningStorage';
import '../accounts.css';
import './payables.css';

const fmtDmy = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

export default function Payables() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { hasCommandAccess, hasChiefAccess } = useAuth();
  const canSettle = hasCommandAccess();
  const canPayCard = hasChiefAccess(); // CHIEF+ can pay by card

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [cardMin, setCardMin] = useState(50);
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try { setRows(await fetchOutstandingInvoices(activeTenantId)); }
    catch { setRows([]); }
    finally { setLoading(false); }
  }, [activeTenantId]);
  useEffect(() => { load(); }, [load]);

  // Card floor for the "Pay by card" gate.
  useEffect(() => { fetchCardPaymentConfig().then((c) => setCardMin(c.cardMinAmount)).catch(() => {}); }, []);

  // Returning from Stripe Checkout — the webhook marks it paid a moment later.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('paid') === '1') { flash('Payment received — updating…'); const t = setTimeout(load, 1800); return () => clearTimeout(t); }
  }, [load]);

  const payByCard = async (r) => {
    if (payingId) return;
    setPayingId(r.id);
    try { window.location.href = await startSupplierCardPayment(r.id); }
    catch (e) { flash(e.message || 'Could not start card payment'); setPayingId(null); }
  };

  const cardEligible = (r) => canPayCard && r.supplier?.stripe_charges_enabled && Number(r.amount || 0) >= cardMin;

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (r) => r.due_date && String(r.due_date).slice(0, 10) < today;

  // Totals per currency (invoices can span currencies; don't sum across them).
  const totals = useMemo(() => {
    const byCur = {};
    rows.forEach((r) => { const c = r.currency || 'EUR'; byCur[c] = (byCur[c] || 0) + Number(r.amount || 0); });
    return Object.entries(byCur);
  }, [rows]);
  const overdueCount = rows.filter(isOverdue).length;

  const openPdf = async (r) => {
    try {
      const res = await fetchInvoiceSignedUrl(r.id);
      if (res?.signed_url) window.open(res.signed_url, '_blank', 'noopener,noreferrer');
      else flash('Invoice is no longer available');
    } catch { flash('Could not open the invoice PDF'); }
  };

  const settle = async (r) => {
    if (!canSettle) return;
    if (!window.confirm(`Mark ${r.invoice_number} as paid? This records the payment and posts it to the ledger.`)) return;
    setBusyId(r.id);
    try { await markInvoicePaid(r.id); flash(`${r.invoice_number} marked paid`); await load(); }
    catch { flash('Could not mark paid'); }
    finally { setBusyId(null); }
  };

  return (
    <>
      <Header />
      <div className="ca-page">
        <div className="ca-wrap">
          <button type="button" className="ca-back" onClick={() => navigate('/accounts')}>
            <Icon name="ChevronLeft" size={16} /> Back to Accounts
          </button>

          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Accounts</span>
              <span className="bar" />
              <span className="muted">{rows.length} outstanding</span>
              {overdueCount > 0 && (<><span className="bar" /><span className="muted">{overdueCount} overdue</span></>)}
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Money <em>owed</em>.</h1>
              <div className="ca-head-act">
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => navigate('/accounts/ledger')}>
                  <Icon name="BookOpen" size={16} /> Ledger
                </button>
              </div>
            </div>
          </div>

          <div className="ca-sum">
            {totals.length ? totals.map(([cur, amt], i) => (
              <React.Fragment key={cur}>
                {i > 0 && <div className="ca-vr" />}
                <div className="ca-s"><b className="ca-num">{formatMoney(amt, cur)}</b><span>Outstanding · {cur}</span></div>
              </React.Fragment>
            )) : (
              <div className="ca-s"><b className="ca-num">{formatMoney(0, 'EUR')}</b><span>Outstanding</span></div>
            )}
            <div className="ca-vr" />
            <div className="ca-s"><b className="ca-num">{overdueCount}</b><span>Overdue</span></div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading outstanding invoices…</p></div>
          ) : rows.length === 0 ? (
            <div className="ca-empty">
              <Icon name="CheckCircle2" size={44} />
              <p>Nothing outstanding</p>
              <p className="ca-empty-sub">Every issued invoice has been paid.</p>
            </div>
          ) : (
            <div className="ca-cat">
              <div className="ca-cat-head">
                <span className="ca-cat-name">Outstanding invoices</span>
                <span className="ca-cat-rule" />
                <span className="ca-cat-meta">{rows.length}</span>
              </div>
              {rows.map((r) => (
                <div key={r.id} className={`pay-row${isOverdue(r) ? ' is-overdue' : ''}`}>
                  <div className="pay-who">
                    <div className="pay-name">{r.supplier?.name || 'Supplier'}</div>
                    <div className="pay-sub">
                      <span className="pay-num">{r.invoice_number}</span>
                      {r.yacht_name ? <span className="pay-dim"> · {r.yacht_name}</span> : null}
                    </div>
                  </div>
                  <div className="pay-dates">
                    <div className="pay-due">Due {fmtDmy(r.due_date)}</div>
                    {isOverdue(r) && <span className="pay-pill">Overdue</span>}
                  </div>
                  <div className="pay-amt ca-num">{formatMoney(r.amount, r.currency)}</div>
                  <div className="pay-act">
                    <button type="button" className="ca-link is-mut" onClick={() => openPdf(r)}>Open</button>
                    {cardEligible(r) && (
                      <button type="button" className="pay-card" disabled={payingId === r.id} onClick={() => payByCard(r)}>
                        {payingId === r.id ? 'Opening…' : 'Pay by card'}
                      </button>
                    )}
                    {canSettle && (
                      <button type="button" className="pay-settle" disabled={busyId === r.id} onClick={() => settle(r)}>
                        {busyId === r.id ? 'Saving…' : 'Mark paid'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {toast && <div className="ca-toast">{toast}</div>}
      </div>
    </>
  );
}
