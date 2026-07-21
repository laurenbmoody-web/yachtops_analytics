// Cargo Accounts — Department Cards (/accounts/cards). The hub between the vessel
// overview and a holder's month-end reconcile. Defaults to a compact account
// summary (all visible, scannable); toggle to full card faces. Search + filter +
// sort across every department's cards & floats. Click one → /accounts/my.
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
const KIND_ICON = { card: 'CreditCard', cash: 'Wallet', petty_cash: 'Wallet' };
const FUNDS_LABEL = { owner: 'Owner', charter_apa: 'Charter APA', general: 'General' };
const FUNDS_FILTERS = [
  { value: 'all', label: 'All funds' },
  { value: 'owner', label: 'Owner' },
  { value: 'charter_apa', label: 'Charter APA' },
  { value: 'petty', label: 'Petty cash' },
];
const SORTS = [
  { value: 'holder', label: 'By department' },
  { value: 'balance', label: 'Balance (high→low)' },
  { value: 'name', label: 'Name (A→Z)' },
];
const initials = (role) => {
  if (!role) return '—';
  const p = role.trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};
const matchesFunds = (a, f) => f === 'all'
  || (f === 'petty' ? a.kind === 'petty_cash' : a.funds_type === f);

export default function DepartmentCards() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const now = new Date();
  const period = periodMonthISO(now.getFullYear(), now.getMonth() + 1);
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [reconByAccount, setReconByAccount] = useState({});
  const [view, setView] = useState('accounts'); // accounts | cards
  const [q, setQ] = useState('');
  const [funds, setFunds] = useState('all');
  const [sort, setSort] = useState('holder');

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

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sortCards = (list) => {
      const arr = [...list];
      if (sort === 'balance') arr.sort((a, b) => (b.balance || 0) - (a.balance || 0));
      else if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
      return arr;
    };
    return groupAccountsByHolder(accounts)
      .map((g) => ({
        ...g,
        cards: sortCards(g.accounts.filter((a) => a.kind !== 'bank'
          && matchesFunds(a, funds)
          && (!s || `${a.name} ${a.holder_role || ''} ${a.card_last4 || ''} ${FUNDS_LABEL[a.funds_type] || ''}`.toLowerCase().includes(s)))),
      }))
      .filter((g) => g.cards.length);
  }, [accounts, q, funds, sort]);

  const total = useMemo(() => groups.reduce((n, g) => n + g.cards.length, 0), [groups]);
  const openReconcile = (holder, accountId) =>
    navigate(`/accounts/my?holder=${encodeURIComponent(holder)}&account=${accountId}`);

  const statusFor = (id) => STATUS[reconByAccount[id] || 'open'];

  const renderCard = (holder, a) => {
    const st = statusFor(a.id);
    return (
      <button key={a.id} type="button" className="dc-card" onClick={() => openReconcile(holder, a.id)}>
        <CardVisual account={a} size="sm" />
        <div className="dc-cfoot">
          <div className="dc-cbal ca-num">{formatMoney(a.balance, a.currency)}</div>
          <span className={`dc-cstat ${st.cls}`}><i />{st.label}</span>
        </div>
      </button>
    );
  };

  const renderBox = (holder, a) => {
    const st = statusFor(a.id);
    const fundsCls = a.kind === 'petty_cash' ? 'petty' : (a.funds_type === 'owner' ? 'owner' : a.funds_type === 'charter_apa' ? 'apa' : 'gen');
    const fundsLabel = a.kind === 'petty_cash' ? 'Petty cash' : FUNDS_LABEL[a.funds_type] || 'General';
    return (
      <button key={a.id} type="button" className="dc-abox" onClick={() => openReconcile(holder, a.id)}>
        <div className="dc-abox-top">
          <span className={`ca-aico ${a.kind}`}><Icon name={KIND_ICON[a.kind] || 'CreditCard'} size={17} /></span>
          <div className="dc-abox-id">
            <div className="dc-abox-name">{a.name}{a.card_last4 ? ` ····${a.card_last4}` : ''}</div>
            <div className="dc-abox-sub">{a.provider || (a.kind === 'petty_cash' ? "Ship's float" : 'Card')} · {a.currency}</div>
          </div>
          <span className={`ca-tag ${fundsCls}`}><i className="ca-tag-dot" />{fundsLabel}</span>
        </div>
        <div className="dc-abox-bot">
          <span className="dc-abox-bal ca-num">{formatMoney(a.balance, a.currency)}</span>
          <span className={`dc-cstat ${st.cls}`}><i />{st.label}</span>
        </div>
      </button>
    );
  };

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
              <span className="dot">●</span><span>Department cards</span>
              <span className="bar" /><span className="muted">{monthLabel}</span>
              <span className="bar" /><span className="muted">{total} {total === 1 ? 'card' : 'cards'}</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Cards <em>by department</em>.</h1>
            </div>
          </div>

          {/* toolbar */}
          <div className="dc-tool">
            <div className="dc-search">
              <Icon name="Search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a card or holder…" />
            </div>
            <select className="dc-sel" value={funds} onChange={(e) => setFunds(e.target.value)}>
              {FUNDS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select className="dc-sel" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="dc-toggle">
              <button className={view === 'accounts' ? 'on' : ''} onClick={() => setView('accounts')}><Icon name="List" size={15} /> Accounts</button>
              <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}><Icon name="CreditCard" size={15} /> Cards</button>
            </div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading cards…</p></div>
          ) : groups.length === 0 ? (
            <div className="ca-empty">
              <Icon name="CreditCard" size={44} />
              <p>{accounts.length ? 'No cards match' : 'No department cards yet'}</p>
              <p className="ca-empty-sub">{accounts.length ? 'Try clearing the search or filter.' : 'Add crew cards or petty-cash floats from the Accounts overview.'}</p>
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
                {view === 'cards'
                  ? <div className="dc-cards">{g.cards.map((a) => renderCard(g.holder, a))}</div>
                  : <div className="dc-boxes">{g.cards.map((a) => renderBox(g.holder, a))}</div>}
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
