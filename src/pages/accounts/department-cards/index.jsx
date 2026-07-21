// Cargo Accounts — Department Cards (/accounts/cards). The hub between the vessel
// overview and a holder's month-end reconcile. Defaults to a scannable LIST of
// accounts; toggle to full card faces. Search + Filter + Sort across every
// department's cards & floats. Click one → /accounts/my.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  { value: 'balance', label: 'Balance (high → low)' },
  { value: 'name', label: 'Name (A → Z)' },
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
  const [view, setView] = useState('list'); // list | cards
  const [q, setQ] = useState('');
  const [funds, setFunds] = useState('all');
  const [sort, setSort] = useState('holder');
  const [menu, setMenu] = useState(null); // 'filter' | 'sort' | null
  const toolRef = useRef(null);

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

  // Close the Filter/Sort menus on outside click.
  useEffect(() => {
    const onDoc = (e) => { if (toolRef.current && !toolRef.current.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

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
  const fundsMeta = (a) => ({
    cls: a.kind === 'petty_cash' ? 'petty' : (a.funds_type === 'owner' ? 'owner' : a.funds_type === 'charter_apa' ? 'apa' : 'gen'),
    label: a.kind === 'petty_cash' ? 'Petty cash' : FUNDS_LABEL[a.funds_type] || 'General',
  });

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

  const renderRow = (holder, a) => {
    const st = statusFor(a.id);
    const fm = fundsMeta(a);
    return (
      <button key={a.id} type="button" className="dc-lrow" onClick={() => openReconcile(holder, a.id)}>
        <span className={`ca-aico ${a.kind}`}><Icon name={KIND_ICON[a.kind] || 'CreditCard'} size={17} /></span>
        <span className="dc-lwho">
          <span className="dc-lname">{a.name}{a.card_last4 ? ` ····${a.card_last4}` : ''}</span>
          <span className="dc-lsub">{a.provider || (a.kind === 'petty_cash' ? "Ship's float" : 'Card')}</span>
        </span>
        <span className={`ca-tag ${fm.cls}`}><i className="ca-tag-dot" />{fm.label}</span>
        <span className="dc-lcur">{a.currency}</span>
        <span className="dc-lbal ca-num">{formatMoney(a.balance, a.currency)}</span>
        <span className={`dc-cstat ${st.cls}`}><i />{st.label}</span>
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
          <div className="dc-tool" ref={toolRef}>
            <div className="dc-search">
              <Icon name="Search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a card or holder…" />
            </div>

            <div className="dc-dd">
              <button type="button" className={`dc-ddbtn ${funds !== 'all' ? 'active' : ''}`} onClick={() => setMenu(menu === 'filter' ? null : 'filter')}>
                <Icon name="Filter" size={15} /> Filter{funds !== 'all' && <span className="dc-dddot" />}
              </button>
              {menu === 'filter' && (
                <div className="dc-ddmenu">
                  <div className="dc-ddlabel">Funds</div>
                  {FUNDS_FILTERS.map((f) => (
                    <button key={f.value} type="button" className={`dc-ddopt ${funds === f.value ? 'on' : ''}`}
                      onClick={() => { setFunds(f.value); setMenu(null); }}>
                      {f.label}{funds === f.value && <Icon name="Check" size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-dd">
              <button type="button" className={`dc-ddbtn ${sort !== 'holder' ? 'active' : ''}`} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
                <Icon name="ArrowUpDown" size={15} /> Sort{sort !== 'holder' && <span className="dc-dddot" />}
              </button>
              {menu === 'sort' && (
                <div className="dc-ddmenu">
                  <div className="dc-ddlabel">Sort by</div>
                  {SORTS.map((s) => (
                    <button key={s.value} type="button" className={`dc-ddopt ${sort === s.value ? 'on' : ''}`}
                      onClick={() => { setSort(s.value); setMenu(null); }}>
                      {s.label}{sort === s.value && <Icon name="Check" size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-toggle">
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><Icon name="List" size={15} /> List</button>
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
                  : <div className="dc-list">{g.cards.map((a) => renderRow(g.holder, a))}</div>}
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
