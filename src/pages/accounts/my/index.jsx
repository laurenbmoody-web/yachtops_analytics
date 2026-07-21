// Cargo Accounts — per-user month-end reconcile (/accounts/my). What a holder sees
// for their own cards: a Wallet-style card stack, the opening→in−out=closing
// equation with a reconcile ring, and their transactions as a working register
// (categorise to sort, then submit the month to Command). Command can open any
// holder via ?holder=; a holder sees their own. Built to the approved mock.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { getAccountsOverview, listTransactions, setTransactionCategory } from '../../../services/financeService';
import { getChartGrouped } from '../../../services/chartService';
import { getReconciliation, submitReconciliation } from '../../../services/reconcileService';
import { periodMonthISO, canSubmit as canSubmitFn, reconcileMessage } from '../../../services/reconcileState';
import { formatMoney } from '../../../services/financeCalc';
import CardVisual from '../components/CardVisual';
import CategoryPicker from '../components/CategoryPicker';
import './my-reconcile.css';

const STACK = [
  { x: 0, y: 0, s: 1, o: 1, z: 30 },
  { x: 18, y: 16, s: 0.955, o: 0.9, z: 20 },
  { x: 36, y: 32, s: 0.912, o: 0.78, z: 10 },
];
const inMonth = (iso, period) => iso && iso.slice(0, 7) === period.slice(0, 7);
const needsCat = (t) => Number(t.amount) < 0 && !t.category;

export default function MyReconcile() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { activeTenantId } = useTenant();
  const holder = params.get('holder') || '';
  const accountParam = params.get('account') || '';

  const now = new Date();
  const period = periodMonthISO(now.getFullYear(), now.getMonth() + 1);
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const [cards, setCards] = useState([]);
  const [activeId, setActiveId] = useState(accountParam);
  const [txns, setTxns] = useState([]);
  const [chart, setChart] = useState([]);
  const [recon, setRecon] = useState(null);
  const [filter, setFilter] = useState('sort');
  const [picker, setPicker] = useState(null); // { txId, rect }
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // Holder's own cards & floats (not bank accounts).
  const loadCards = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const { data } = await getAccountsOverview(activeTenantId);
    const mine = (data?.accounts || []).filter(
      (a) => a.is_active !== false && a.kind !== 'bank' && (!holder || a.holder_role === holder),
    );
    setCards(mine);
    setActiveId((cur) => (mine.some((a) => a.id === cur) ? cur : mine[0]?.id || ''));
    setLoading(false);
  }, [activeTenantId, holder]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => {
    if (!activeTenantId) return;
    getChartGrouped(activeTenantId).then(({ data }) => setChart(data || []));
  }, [activeTenantId]);

  const loadTxns = useCallback(async () => {
    if (!activeTenantId || !activeId) { setTxns([]); setRecon(null); return; }
    const [{ data }, { data: r }] = await Promise.all([
      listTransactions(activeTenantId, { accountId: activeId }),
      getReconciliation(activeId, period),
    ]);
    setTxns(data || []);
    setRecon(r || null);
  }, [activeTenantId, activeId, period]);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  const active = cards.find((c) => c.id === activeId) || null;

  const view = useMemo(() => {
    const month = txns.filter((t) => inMonth(t.txn_date, period) && t.status !== 'void');
    const prior = txns.filter((t) => t.txn_date < period && t.status !== 'void');
    const opening = (Number(active?.opening_balance) || 0) + prior.reduce((s, t) => s + Number(t.amount || 0), 0);
    const inSum = month.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const outSum = month.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);
    const toSort = month.filter(needsCat);
    const cleared = month.filter((t) => !needsCat(t));
    return {
      month, opening, inSum, outSum, closing: opening + inSum + outSum,
      toSort, cleared, total: month.length, sorted: cleared.length,
    };
  }, [txns, active, period]);

  const counts = { toSort: view.toSort.length, matched: view.sorted, total: view.total };
  const status = recon?.status || 'open';
  const ready = canSubmitFn(counts) && status === 'open';
  const msg = reconcileMessage(counts, status);
  const pct = view.total ? Math.round((view.sorted / view.total) * 100) : 0;
  const cur = active?.currency || 'EUR';
  const mx = Math.max(view.inSum, Math.abs(view.outSum), 1);

  const setActive = (id) => { setActiveId(id); setFilter('sort'); setPicker(null); };

  const openPicker = (e, txId) => setPicker({ txId, rect: e.currentTarget.getBoundingClientRect() });
  const pickCategory = async (o) => {
    if (!picker) return;
    const id = picker.txId; setPicker(null); setBusy(true);
    await setTransactionCategory(id, { category: o.category, category_code: o.code || null });
    await loadTxns(); setBusy(false);
  };

  const doSubmit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    await submitReconciliation({
      tenantId: activeTenantId, accountId: activeId, periodMonth: period,
      openingBalance: view.opening, closingBalance: view.closing,
    });
    await loadTxns(); setBusy(false);
  };

  // Wallet-style stack layout
  const order = active ? [active.id, ...cards.filter((c) => c.id !== active.id).map((c) => c.id)] : [];
  const cardStyle = (id) => {
    const pos = order.indexOf(id);
    const s = STACK[Math.min(pos, STACK.length - 1)] || STACK[STACK.length - 1];
    return { transform: `translate(${s.x}px,${s.y}px) scale(${s.s})`, opacity: s.o, zIndex: s.z, cursor: pos === 0 ? 'default' : 'pointer' };
  };

  const rows = filter === 'sort' ? view.toSort : filter === 'cleared' ? view.cleared : view.month;

  return (
    <>
      <Header />
      <div className="ca-page">
        <div className="ca-wrap mr-wrap">
          <button type="button" className="ca-back" onClick={() => navigate('/accounts/cards')}>
            <Icon name="ChevronLeft" size={16} /> Department cards
          </button>

          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span><span>My accounts</span>
              <span className="bar" /><span className="muted">{holder || 'Holder'}</span>
              <span className="bar" /><span className="muted">Month-end</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">My card<span>,</span> <em>to balance</em>.</h1>
            </div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading…</p></div>
          ) : !active ? (
            <div className="ca-empty"><Icon name="CreditCard" size={44} /><p>No cards for this holder</p></div>
          ) : (
            <>
              <div className="mr-herotop">
                <div className="mr-eyebrow">Your cards <span className="mr-n">{cards.length}</span></div>
                <div className="mr-month">{monthLabel}</div>
              </div>

              <div className="mr-hero">
                <div className="mr-heroL">
                  <div className="mr-stage" style={{ minWidth: 320, height: 228 }}>
                    {cards.map((c) => (
                      <div key={c.id} className="mr-cardslot" style={cardStyle(c.id)}
                        onClick={() => c.id !== activeId && setActive(c.id)}>
                        <CardVisual account={c} size="lg"
                          flip={c.id === activeId ? 'hover' : 'none'}
                          status={c.id === activeId
                            ? (counts.toSort > 0 ? { text: `${counts.toSort} to sort`, tone: 'due' } : { text: 'Balanced', tone: 'ok' })
                            : undefined} />
                      </div>
                    ))}
                  </div>
                  <div className="mr-dots">
                    {cards.map((c) => (
                      <button key={c.id} type="button" className={`mr-dot ${c.id === activeId ? 'on' : ''}`}
                        style={c.id === activeId ? { background: '#C65A1A' } : undefined}
                        onClick={() => setActive(c.id)} aria-label={c.name} />
                    ))}
                  </div>
                </div>

                {/* data hero: equation + ring */}
                <div className="mr-panel">
                  <div className="mr-accent" />
                  <div className="mr-peyebrow">{monthLabel} · {active.name}</div>
                  <div className="mr-cols">
                    <div className="mr-left">
                      <div className="mr-eqn">
                        <div className="mr-eqrow open"><span className="mr-eqlab">Opening</span><span /><span className="mr-eqval ca-num">{formatMoney(view.opening, cur)}</span></div>
                        <div className="mr-eqrow"><span className="mr-eqlab"><b className="pl">+</b> In</span><div className="mr-fbar"><i style={{ width: `${Math.round(view.inSum / mx * 100)}%`, background: '#6FBF8B' }} /></div><span className="mr-eqval ca-num" style={{ color: '#3F7A52' }}>{formatMoney(view.inSum, cur)}</span></div>
                        <div className="mr-eqrow"><span className="mr-eqlab"><b className="mn">−</b> Out</span><div className="mr-fbar"><i style={{ width: `${Math.round(Math.abs(view.outSum) / mx * 100)}%`, background: '#C65A1A' }} /></div><span className="mr-eqval ca-num" style={{ color: '#B14E16' }}>{formatMoney(Math.abs(view.outSum), cur)}</span></div>
                        <div className="mr-eqrule" />
                        <div className="mr-eqresult"><span className="mr-clab">Closing balance</span><span className="mr-cbal ca-num">{formatMoney(view.closing, cur)}</span></div>
                      </div>
                    </div>
                    <div className="mr-div" />
                    <div className="mr-right">
                      <div className="mr-prec">
                        <div className="mr-ring">
                          <svg width="100" height="100" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="44" fill="none" stroke="#EEF0F4" strokeWidth="9" />
                            <circle cx="50" cy="50" r="44" fill="none" stroke="#6FBF8B" strokeWidth="9" strokeLinecap="round"
                              strokeDasharray={2 * Math.PI * 44}
                              strokeDashoffset={(2 * Math.PI * 44) * (1 - (view.total ? view.sorted / view.total : 0))}
                              style={{ transition: 'stroke-dashoffset .6s', transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }} />
                          </svg>
                          <div className="mr-rc"><div className="mr-rp ca-num">{pct}%</div><div className="mr-rl">sorted</div></div>
                        </div>
                        <div className="mr-legend">
                          <div className="mr-lrow"><span className="mr-k"><i style={{ background: '#6FBF8B' }} />Sorted</span><span className="mr-v ca-num">{view.sorted}</span></div>
                          <div className="mr-lrow"><span className="mr-k"><i style={{ background: counts.toSort ? '#C65A1A' : '#E6E8EF' }} />Still to sort</span><span className="mr-v ca-num">{counts.toSort}</span></div>
                        </div>
                      </div>
                      <div className="mr-raction"><span className={`mr-rmsg ${msg.tone === 'ok' ? 'ok' : ''}`}>{msg.text}</span></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* register */}
              <div className="mr-reg">
                <div className="mr-rtool">
                  <div className="mr-filters">
                    <button className={filter === 'sort' ? 'on' : ''} onClick={() => setFilter('sort')}>To sort <span className="b">{counts.toSort}</span></button>
                    <button className={filter === 'cleared' ? 'on' : ''} onClick={() => setFilter('cleared')}>Cleared <span className="b">{view.sorted}</span></button>
                    <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All <span className="b">{view.total}</span></button>
                  </div>
                </div>
                <div className="mr-colh">
                  <span>Date</span><span>Description</span><span>Supplier</span><span>Category</span><span className="r">Amount</span><span className="r">Status</span>
                </div>
                {rows.length === 0 ? (
                  <div className="mr-empty">{filter === 'sort' ? 'Nothing to sort — this card is ready.' : 'No transactions this month.'}</div>
                ) : rows.map((t) => {
                  const spend = Number(t.amount) < 0;
                  const need = needsCat(t);
                  return (
                    <div key={t.id} className="mr-row">
                      <span className="mr-date">{(t.txn_date || '').slice(8, 10)}/{(t.txn_date || '').slice(5, 7)}</span>
                      <span className="mr-desc">{t.description || '—'}</span>
                      <span className="mr-sup">{t.payee || '—'}</span>
                      {t.category
                        ? <span className="mr-cat"><i className="mr-cdot" />{t.category_code ? `${t.category_code} · ` : ''}{t.category}</span>
                        : <span className="mr-cat">{spend ? <button type="button" className="mr-setlink" disabled={busy} onClick={(e) => openPicker(e, t.id)}><Icon name="Plus" size={13} /> Set category</button> : <span className="mr-muted">—</span>}</span>}
                      <span className={`mr-amt ca-num ${spend ? 'ca-neg' : ''}`} style={!spend ? { color: '#3F7A52' } : undefined}>{formatMoney(t.amount, t.currency)}</span>
                      <span className="mr-stat">
                        {need
                          ? <button type="button" className="mr-bsm pri" disabled={busy} onClick={(e) => openPicker(e, t.id)}>Categorise</button>
                          : <span className="mr-ok"><Icon name="Check" size={13} /> Sorted</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* submit footer */}
        {active && (
          <div className="mr-foot">
            <div className="mr-footin">
              <div className="mr-fctx"><span className="mr-fci"><Icon name="CreditCard" size={15} /></span><span><b>{active.name}</b> · {monthLabel}</span></div>
              <div className="mr-fright">
                <span className={`mr-fmsg ${msg.tone === 'ok' ? 'ok' : ''}`}>{msg.text}</span>
                <button type="button" className={`mr-submit ${status === 'submitted' || status === 'approved' ? 'sent' : ready ? 'ready' : 'locked'}`}
                  disabled={!ready || busy} onClick={doSubmit}>
                  {status === 'submitted' ? <><Icon name="Check" size={16} /> Submitted — awaiting Command</>
                    : status === 'approved' ? <><Icon name="Check" size={16} /> Signed off</>
                    : <><Icon name="Send" size={16} /> Submit for sign-off</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {picker && <CategoryPicker anchorRect={picker.rect} groups={chart} onPick={pickCategory} onClose={() => setPicker(null)} />}
    </>
  );
}
