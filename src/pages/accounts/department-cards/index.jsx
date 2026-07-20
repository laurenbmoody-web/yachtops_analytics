// Cargo Accounts — Department Cards (/accounts/cards). The hub between the vessel
// overview and a holder's month-end reconcile: every department's cards & floats
// shown as real card faces, with this month's reconcile status. Command can open
// any; a holder sees their own. Click a card → /accounts/my for that holder.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { getAccountsOverview } from '../../../services/financeService';
import { listReconciliationsForMonth } from '../../../services/reconcileService';
import { periodMonthISO } from '../../../services/reconcileState';
import { groupAccountsByHolder } from '../../../services/accountsView';
import { formatMoney } from '../../../services/financeCalc';
import CardVisual from '../components/CardVisual';
import '../accounts.css';
import './department-cards.css';

const STATUS = {
  approved: { label: 'Signed off', cls: 'ok' },
  submitted: { label: 'Submitted', cls: 'sub' },
  open: { label: 'In progress', cls: 'due' },
};
const initials = (role) => {
  if (!role) return '—';
  const p = role.trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};

export default function DepartmentCards() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const now = new Date();
  const period = periodMonthISO(now.getFullYear(), now.getMonth() + 1);
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [reconByAccount, setReconByAccount] = useState({});

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [{ data }, { data: recs }] = await Promise.all([
      getAccountsOverview(activeTenantId),
      listReconciliationsForMonth(activeTenantId, period),
    ]);
    if (data) setAccounts(data.accounts);
    const map = {};
    (recs || []).forEach((r) => { map[r.account_id] = r.status; });
    setReconByAccount(map);
    setLoading(false);
  }, [activeTenantId, period]);

  useEffect(() => { load(); }, [load]);

  // Departments = holder groups, but this page is card-forward: skip pure bank
  // accounts (they reconcile against statements on the overview, not here).
  const groups = useMemo(() => groupAccountsByHolder(accounts)
    .map((g) => ({ ...g, cards: g.accounts.filter((a) => a.kind !== 'bank') }))
    .filter((g) => g.cards.length), [accounts]);

  const openReconcile = (holder, accountId) =>
    navigate(`/accounts/my?holder=${encodeURIComponent(holder)}&account=${accountId}`);

  return (
    <>
      <Header />
      <div className="ca-page">
        <div className="ca-wrap">
          <button type="button" className="ca-back" onClick={() => navigate('/accounts')}>
            <Icon name="ChevronLeft" size={16} /> Accounts
          </button>

          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Department cards</span>
              <span className="bar" />
              <span className="muted">{monthLabel}</span>
              <span className="bar" />
              <span className="muted">Month-end reconcile</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Cards <em>by department</em>.</h1>
            </div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading cards…</p></div>
          ) : groups.length === 0 ? (
            <div className="ca-empty">
              <Icon name="CreditCard" size={44} />
              <p>No department cards yet</p>
              <p className="ca-empty-sub">Add crew cards or petty-cash floats from the Accounts overview.</p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.holder} className="dc-dept">
                <div className="dc-dh">
                  <span className="dc-ga">{initials(g.holder)}</span>
                  <span className="dc-gn">{g.holder}</span>
                  <span className="dc-grole">{g.cards.length} {g.cards.length === 1 ? 'card' : 'cards'}</span>
                  <span className="dc-grule" />
                  <span className="dc-gtot">balance <b className="ca-num">{formatMoney(g.total, 'EUR')}</b></span>
                </div>
                <div className="dc-cards">
                  {g.cards.map((a) => {
                    const st = STATUS[reconByAccount[a.id] || 'open'];
                    return (
                      <button key={a.id} type="button" className="dc-card" onClick={() => openReconcile(g.holder, a.id)}>
                        <CardVisual account={a} size="sm" />
                        <div className="dc-cfoot">
                          <div className="dc-cbal ca-num">{formatMoney(a.balance, a.currency)}</div>
                          <span className={`dc-cstat ${st.cls}`}><i />{st.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
