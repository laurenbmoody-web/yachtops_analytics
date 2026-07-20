// Cargo Accounts — Accounts page (/accounts). Rebuilt onto the editorial (Cargo)
// system per CLAUDE.md — hairline lists, DM Serif Display + Plus Jakarta Sans,
// tabular figures, dd/mm/yyyy. Shows the tenant cash position as the hero figure
// and each financial_account with its computed balance. COMMAND adds/edits.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import '../../styles/editorial.css';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { getAccountsOverview, createAccount, updateAccount } from '../../services/financeService';
import { formatMoney } from '../../services/financeCalc';
import AccountFormModal from './components/AccountFormModal';
import './accounts.css';

const KIND_ICON = { bank: 'Landmark', card: 'CreditCard', cash: 'Banknote' };

export default function Accounts() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { hasCommandAccess } = useAuth();
  const canEdit = hasCommandAccess();

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [cashPosition, setCashPosition] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const { data, error } = await getAccountsOverview(activeTenantId);
    if (!error && data) { setAccounts(data.accounts); setCashPosition(data.cashPosition); }
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { load(); }, [load]);

  // The cash-position hero renders in the reporting currency. Phase 0 has no
  // per-tenant reporting-currency setting yet, so use the most common account
  // currency (EUR fallback) rather than inventing one.
  const positionCurrency = useMemo(() => {
    const counts = {};
    accounts.filter((a) => a.is_active !== false).forEach((a) => { counts[a.currency] = (counts[a.currency] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EUR';
  }, [accounts]);

  const activeAccounts = accounts.filter((a) => a.is_active !== false);
  const inactiveAccounts = accounts.filter((a) => a.is_active === false);

  const handleSave = async (payload) => {
    const res = editing?.id
      ? await updateAccount(editing.id, payload)
      : await createAccount({ ...payload, tenant_id: activeTenantId });
    if (!res.error) { await load(); flash(editing?.id ? 'Account updated' : 'Account added'); }
    return res;
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (a) => { setEditing(a); setModalOpen(true); };

  const renderRow = (a) => (
    <div key={a.id} className={`ca-acct${a.is_active === false ? ' is-inactive' : ''}`}>
      <span className="ca-acct-ico"><Icon name={KIND_ICON[a.kind] || 'Landmark'} size={19} /></span>
      <div className="ca-acct-who">
        <div className="ca-acct-name">{a.name}</div>
        <div className="ca-acct-sub">
          <span className="ca-pill ca-pill-kind">{a.kind}</span>
          {a.is_active === false && <span className="ca-pill ca-pill-muted" style={{ marginLeft: 6 }}>Inactive</span>}
        </div>
      </div>
      <span className="ca-acct-cur">{a.currency}</span>
      <span className={`ca-acct-bal ca-num ${a.balance < 0 ? 'ca-neg' : ''}`}>{formatMoney(a.balance, a.currency)}</span>
      <span className="ca-acct-act">
        {canEdit && (
          <button type="button" className="ca-link is-mut" onClick={() => openEdit(a)} aria-label={`Edit ${a.name}`}>
            <Icon name="Pencil" size={15} />
          </button>
        )}
      </span>
    </div>
  );

  return (
    <>
      <Header />
      <div className="ca-page">
        <div className="ca-wrap">
          <button type="button" className="ca-back" onClick={() => navigate('/dashboard')}>
            <Icon name="ChevronLeft" size={16} /> Back to Dashboard
          </button>

          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Accounts</span>
              <span className="bar" />
              <span className="muted">{activeAccounts.length} active</span>
              <span className="bar" />
              <span className="muted">Financial core</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Cash <em>position</em>.</h1>
              <div className="ca-head-act">
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => navigate('/accounts/payables')}>
                  <Icon name="ReceiptText" size={16} /> Outstanding
                </button>
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => navigate('/accounts/ledger')}>
                  <Icon name="BookOpen" size={16} /> Ledger
                </button>
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => navigate('/accounts/budgets')}>
                  <Icon name="Target" size={16} /> Budgets
                </button>
                {canEdit && (
                  <button type="button" className="ca-btn ca-btn-primary" onClick={openAdd}>
                    <Icon name="Plus" size={16} /> Add account
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="ca-sum">
            <div className="ca-s">
              <b className="ca-num">{formatMoney(cashPosition, positionCurrency)}</b>
              <span>Cash position · {positionCurrency}</span>
            </div>
            <div className="ca-vr" />
            <div className="ca-s">
              <b className="ca-num">{activeAccounts.length}</b>
              <span>Active accounts</span>
            </div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading accounts…</p></div>
          ) : accounts.length === 0 ? (
            <div className="ca-empty">
              <Icon name="Wallet" size={44} />
              <p>No accounts yet</p>
              <p className="ca-empty-sub">
                {canEdit ? 'Add a bank, card or cash account to start tracking balances.' : 'A COMMAND user can add the first account.'}
              </p>
            </div>
          ) : (
            <>
              <div className="ca-cat">
                <div className="ca-cat-head">
                  <span className="ca-cat-name">Accounts</span>
                  <span className="ca-cat-rule" />
                  <span className="ca-cat-meta">{activeAccounts.length} active</span>
                </div>
                {activeAccounts.map(renderRow)}
              </div>

              {inactiveAccounts.length > 0 && (
                <div className="ca-cat">
                  <div className="ca-cat-head">
                    <span className="ca-cat-name">Inactive</span>
                    <span className="ca-cat-rule" />
                    <span className="ca-cat-meta">{inactiveAccounts.length}</span>
                  </div>
                  {inactiveAccounts.map(renderRow)}
                </div>
              )}
            </>
          )}
        </div>

        {toast && <div className="ca-toast">{toast}</div>}
      </div>

      <AccountFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initial={editing}
      />
    </>
  );
}
