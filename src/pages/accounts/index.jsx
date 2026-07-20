// Cargo Accounts — vessel overview (/accounts), COMMAND-only. Cash position split
// by Owner / Charter APA / Petty cash, and every account grouped by the holder who
// carries it (Vessel/Command first, then each Chief) with a month-end reconcile
// indicator. Editorial (Cargo) system per CLAUDE.md.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import '../../styles/editorial.css';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { getAccountsOverview, createAccount, updateAccount } from '../../services/financeService';
import { formatMoney } from '../../services/financeCalc';
import { groupAccountsByHolder, fundsTotals } from '../../services/accountsView';
import AccountFormModal from './components/AccountFormModal';
import './accounts.css';

const KIND_ICON = { bank: 'Landmark', card: 'CreditCard', cash: 'Wallet', petty_cash: 'Wallet' };
const FUNDS_LABEL = { owner: 'Owner', charter_apa: 'Charter APA', general: 'General' };
const initials = (role) => {
  if (!role) return '—';
  const parts = role.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
};

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

  const positionCurrency = useMemo(() => {
    const counts = {};
    accounts.filter((a) => a.is_active !== false).forEach((a) => { counts[a.currency] = (counts[a.currency] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EUR';
  }, [accounts]);

  const groups = useMemo(() => groupAccountsByHolder(accounts), [accounts]);
  const funds = useMemo(() => fundsTotals(accounts), [accounts]);
  const activeCount = accounts.filter((a) => a.is_active !== false).length;

  const handleSave = async (payload) => {
    const res = editing?.id
      ? await updateAccount(editing.id, payload)
      : await createAccount({ ...payload, tenant_id: activeTenantId });
    if (!res.error) { await load(); flash(editing?.id ? 'Account updated' : 'Account added'); }
    return res;
  };

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (a) => { setEditing(a); setModalOpen(true); };

  const reconcilePill = (toReconcile) => (
    toReconcile > 0
      ? <span className="ca-ov-grec due">{toReconcile} to reconcile</span>
      : <span className="ca-ov-grec ok">Reconciled</span>
  );

  const renderRow = (a) => {
    const cur = a.currency;
    const fundsCls = a.kind === 'petty_cash' ? 'petty' : (a.funds_type === 'owner' ? 'owner' : a.funds_type === 'charter_apa' ? 'apa' : 'gen');
    const fundsLabel = a.kind === 'petty_cash' ? 'Petty cash' : FUNDS_LABEL[a.funds_type] || 'General';
    const sub = a.kind === 'card'
      ? `${a.provider || 'Card'}${a.card_last4 ? ` ····${a.card_last4}` : ''}`
      : (a.provider || (a.kind === 'petty_cash' ? "Ship's float" : a.kind));
    return (
      <button key={a.id} type="button" className="ca-arow" onClick={() => canEdit && openEdit(a)}>
        <span className={`ca-aico ${a.kind}`}><Icon name={KIND_ICON[a.kind] || 'Landmark'} size={18} /></span>
        <span className="ca-awho">
          <span className="ca-aname">{a.name}{a.kind === 'card' && a.card_last4 ? ` ····${a.card_last4}` : ''}</span>
          <span className="ca-asub">{sub}</span>
        </span>
        <span className={`ca-tag ${fundsCls}`}><i className="ca-tag-dot" />{fundsLabel}</span>
        <span className="ca-acur">{cur}</span>
        <span className={`ca-abal ca-num ${a.balance < 0 ? 'ca-neg' : ''}`}>{formatMoney(a.balance, cur)}</span>
        <span className={`ca-arec ${a.unreconciled > 0 ? 'rev' : 'ok'}`}>
          <i className="ca-arec-dot" />{a.unreconciled > 0 ? `${a.unreconciled} to review` : 'Reconciled'}
        </span>
      </button>
    );
  };

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
              <span className="muted">{funds.holders} holders · {activeCount} accounts</span>
              <span className="bar" />
              <span className="muted">Financial core</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Cash <em>position</em>.</h1>
              <div className="ca-head-act">
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => navigate('/accounts/cards')}>
                  <Icon name="CreditCard" size={16} /> Cards
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

          {/* KPI strip */}
          <div className="ca-ov-kpis">
            <div className="ca-ov-hero">
              <span className="ca-ov-hl">Total cash position · {positionCurrency}</span>
              <b className="ca-ov-hbig ca-num">{formatMoney(cashPosition, positionCurrency)}</b>
              <span className="ca-ov-hsub">across {activeCount} accounts · {funds.holders} holders</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">Owner funds</span>
              <b className="ca-ov-kv owner ca-num">{formatMoney(funds.owner, positionCurrency)}</b>
              <span className="ca-ov-km">{funds.ownerCards} cards</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">Charter APA</span>
              <b className="ca-ov-kv apa ca-num">{formatMoney(funds.charterApa, positionCurrency)}</b>
              <span className="ca-ov-km">{funds.apaCards} cards</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">Petty cash</span>
              <b className="ca-ov-kv ca-num">{formatMoney(funds.pettyCash, positionCurrency)}</b>
              <span className="ca-ov-km">{funds.pettyFloats} floats</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">To reconcile</span>
              <b className="ca-ov-kv ca-num">{funds.toReconcile}</b>
              <span className="ca-ov-km">this month-end</span>
            </div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading accounts…</p></div>
          ) : accounts.length === 0 ? (
            <div className="ca-empty">
              <Icon name="Wallet" size={44} />
              <p>No accounts yet</p>
              <p className="ca-empty-sub">
                {canEdit ? 'Add the vessel bank accounts and each holder’s cards to start tracking balances.' : 'A COMMAND user can add the first account.'}
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.holder} className="ca-ov-group">
                <div className="ca-ov-gh">
                  <span className={`ca-ov-ga ${g.holder === 'Vessel' ? 'vessel' : ''}`}>
                    {g.holder === 'Vessel' ? <Icon name="Landmark" size={17} /> : initials(g.holder)}
                  </span>
                  <span className="ca-ov-gn">{g.holder}</span>
                  <span className="ca-ov-grole">{g.holder === 'Vessel' ? 'Command' : `${g.accounts.length} accounts`}</span>
                  <span className="ca-ov-grule" />
                  <span className="ca-ov-gtot">balance <b className="ca-num">{formatMoney(g.total, positionCurrency)}</b></span>
                  {reconcilePill(g.toReconcile)}
                </div>
                {g.accounts.map(renderRow)}
              </div>
            ))
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
