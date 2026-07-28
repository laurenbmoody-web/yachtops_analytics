// Cargo Accounts — vessel overview (/accounts), COMMAND-only. Cash position split
// by Owner / Charter APA / Petty cash, and every account grouped by the holder who
// carries it (Vessel/Command first, then each Chief) with a month-end reconcile
// indicator. Editorial (Cargo) system per CLAUDE.md.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import '../../styles/editorial.css';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { getAccountsOverview, createAccount, updateAccount } from '../../services/financeService';
import { formatMoney } from '../../services/financeCalc';
import { groupAccountsByHolder, fundsTotals } from '../../services/accountsView';
import { listConnections, syncAll, syncConnection, disconnectConnection } from '../../services/plaidService';
import AccountFormModal from './components/AccountFormModal';
import AccountsShell from './components/AccountsShell';
import ConnectBankModal from './components/ConnectBankModal';
import './accounts.css';

const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

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
  const { hasCommandAccess, hasAccountsAccess, hasOwnerReporting } = useAuth();
  const canEdit = hasCommandAccess();

  // Role-aware landing — "you land where you live". The vessel Overview is for
  // Command/those with full Accounts access; everyone else is sent to their own
  // home (an owner/viewer seat → the report, a card holder → My money).
  const canSeeOverview = hasAccountsAccess();
  const ownerOnly = !canSeeOverview && hasOwnerReporting();

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [cashPosition, setCashPosition] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState('');
  const [expanded, setExpanded] = useState({}); // holder → open? (dashboard drills in on demand)
  const toggleHolder = (h) => setExpanded((e) => ({ ...e, [h]: !e[h] }));

  const [connections, setConnections] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const autoRan = useRef(false);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const loadConnections = useCallback(async () => {
    if (!activeTenantId) return;
    const { data } = await listConnections(activeTenantId);
    setConnections(data || []);
  }, [activeTenantId]);

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [{ data, error }] = await Promise.all([getAccountsOverview(activeTenantId), loadConnections()]);
    if (!error && data) { setAccounts(data.accounts); setCashPosition(data.cashPosition); }
    setLoading(false);
  }, [activeTenantId, loadConnections]);

  // Manual "Sync now" — pull every connected bank, then refresh balances.
  const runSyncAll = useCallback(async () => {
    if (!activeTenantId || syncing) return;
    setSyncing(true);
    const { data } = await syncAll(activeTenantId);
    setLastSync(new Date().toISOString());
    await load();
    setSyncing(false);
    if (data) flash(data.posted > 0 ? `${data.posted} new ${data.posted === 1 ? 'transaction' : 'transactions'}` : 'Up to date');
  }, [activeTenantId, syncing, load]);

  // Auto-sync once per session so balances are fresh when Command opens Accounts.
  useEffect(() => {
    if (!activeTenantId || autoRan.current) return;
    const key = `cargo_synced_${activeTenantId}`;
    if (sessionStorage.getItem(key)) return;
    autoRan.current = true;
    (async () => {
      const { data } = await listConnections(activeTenantId);
      if ((data || []).some((c) => c.status === 'linked')) {
        sessionStorage.setItem(key, '1');
        setSyncing(true);
        await syncAll(activeTenantId);
        setLastSync(new Date().toISOString());
        await load();
        setSyncing(false);
      }
    })();
  }, [activeTenantId, load]);

  const syncOne = async (id) => {
    setSyncing(true);
    await syncConnection(id);
    setLastSync(new Date().toISOString());
    await load();
    setSyncing(false);
  };
  const disconnect = async (c) => {
    if (!window.confirm(`Disconnect ${c.institution_name || 'this bank'}? The feed stops; existing accounts and history stay.`)) return;
    await disconnectConnection(c.id);
    await loadConnections();
    flash('Bank disconnected');
  };

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

  if (!canSeeOverview) return <Navigate to={ownerOnly ? '/accounts/owner' : '/accounts/my'} replace />;

  const reconcilePill = (toReconcile) => (
    toReconcile > 0
      ? <button type="button" className="ca-ov-grec due link" onClick={(e) => { e.stopPropagation(); navigate('/accounts/checkoff'); }}>{toReconcile} to check off</button>
      : <span className="ca-ov-grec ok">Checked off</span>
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
          <i className="ca-arec-dot" />{a.unreconciled > 0 ? `${a.unreconciled} to look at` : 'Checked off'}
        </span>
      </button>
    );
  };

  return (
    <AccountsShell active="overview">
      <div className="ca-page">
        <div className="ca-wrap">
          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Overview</span>
              <span className="bar" />
              <span className="muted">{funds.holders} holders · {activeCount} accounts</span>
              <span className="bar" />
              <span className="muted">The boat’s money</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">The boat’s <em>money</em>.</h1>
              <div className="ca-head-act">
                {canEdit && (
                  <>
                    {connections.some((c) => c.status === 'linked') && (
                      <button type="button" className="ca-btn ca-btn-ghost" onClick={runSyncAll} disabled={syncing}>
                        <Icon name="RefreshCw" size={15} className={syncing ? 'ca-spin' : undefined} /> {syncing ? 'Syncing…' : 'Sync now'}
                      </button>
                    )}
                    <button type="button" className="ca-btn ca-btn-ghost" onClick={() => setConnectOpen(true)}>
                      <Icon name="Link" size={16} /> Connect a bank
                    </button>
                    <button type="button" className="ca-btn ca-btn-primary" onClick={openAdd}>
                      <Icon name="Plus" size={16} /> Add account
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="ca-ov-kpis">
            <div className="ca-ov-hero">
              <span className="ca-ov-hl">In the accounts · {positionCurrency}</span>
              <b className="ca-ov-hbig ca-num">{formatMoney(cashPosition, positionCurrency)}</b>
              <span className="ca-ov-hsub">across {activeCount} accounts · {funds.holders} holders</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">Owner funds</span>
              <b className="ca-ov-kv owner ca-num">{formatMoney(funds.owner, positionCurrency)}</b>
              <span className="ca-ov-km">{funds.ownerCards} cards</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">Charter (APA)</span>
              <b className="ca-ov-kv apa ca-num">{formatMoney(funds.charterApa, positionCurrency)}</b>
              <span className="ca-ov-km">{funds.apaCards} cards</span>
            </div>
            <div className="ca-ov-kpi">
              <span className="ca-ov-kl">Petty cash</span>
              <b className="ca-ov-kv ca-num">{formatMoney(funds.pettyCash, positionCurrency)}</b>
              <span className="ca-ov-km">{funds.pettyFloats} floats</span>
            </div>
            <button type="button" className="ca-ov-kpi ca-ov-kpi-btn" onClick={() => navigate('/accounts/checkoff')}>
              <span className="ca-ov-kl">To check off</span>
              <b className="ca-ov-kv ca-num">{funds.toReconcile}</b>
              <span className="ca-ov-km">this month-end →</span>
            </button>
          </div>

          {/* Connected banks (live feed) */}
          {connections.length > 0 && (
            <div className="ca-conn">
              <div className="ca-conn-head">
                <span className="ca-ov-listtitle">Connected banks</span>
                <span className="ca-conn-sub">{lastSync ? `Synced ${timeAgo(lastSync)}` : 'Live feed via Plaid'}</span>
              </div>
              {connections.map((c) => (
                <div key={c.id} className={`ca-conn-row ${c.status}`}>
                  <span className="ca-conn-ico"><Icon name="Landmark" size={16} /></span>
                  <span className="ca-conn-name">{c.institution_name || 'Bank'}</span>
                  <span className={`ca-conn-stat ${c.status}`}>
                    <i />{c.status === 'linked' ? 'Connected' : c.status === 'error' ? 'Needs attention' : c.status}
                  </span>
                  <span className="ca-conn-rule" />
                  {c.status === 'error' && c.error_detail && <span className="ca-conn-err" title={c.error_detail}>{c.error_detail.slice(0, 40)}…</span>}
                  <button type="button" className="ca-conn-btn" disabled={syncing} onClick={() => syncOne(c.id)}>
                    <Icon name="RefreshCw" size={13} className={syncing ? 'ca-spin' : undefined} /> Sync
                  </button>
                  <button type="button" className="ca-conn-btn danger" onClick={() => disconnect(c)}>Disconnect</button>
                </div>
              ))}
            </div>
          )}

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
            <>
              <div className="ca-ov-listhead">
                <span className="ca-ov-listtitle">By holder</span>
                <span className="ca-ov-note">
                  Balances are worked out from the ledger — {' '}
                  <button type="button" className="ca-ov-link" onClick={() => navigate('/accounts/ledger')}>log spend or import a statement</button>
                  {' '} to keep them current. Open a holder to see or edit their accounts.
                </span>
              </div>
              {groups.map((g) => {
                const open = !!expanded[g.holder];
                return (
                  <div key={g.holder} className="ca-ov-group">
                    <div className={`ca-ov-gh ${open ? 'open' : ''}`} role="button" tabIndex={0}
                      onClick={() => toggleHolder(g.holder)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHolder(g.holder); } }}>
                      <span className={`ca-ov-ga ${g.holder === 'Vessel' ? 'vessel' : ''}`}>
                        {g.holder === 'Vessel' ? <Icon name="Landmark" size={17} /> : initials(g.holder)}
                      </span>
                      <span className="ca-ov-gn">{g.holder}</span>
                      <span className="ca-ov-grole">{g.holder === 'Vessel' ? 'Command' : `${g.accounts.length} ${g.accounts.length === 1 ? 'account' : 'accounts'}`}</span>
                      <span className="ca-ov-grule" />
                      <span className="ca-ov-gtot">balance <b className="ca-num">{formatMoney(g.total, positionCurrency)}</b></span>
                      {reconcilePill(g.toReconcile)}
                      <Icon name="ChevronDown" size={16} className={`ca-ov-gchev ${open ? 'open' : ''}`} />
                    </div>
                    {open && <div className="ca-ov-gaccts">{g.accounts.map(renderRow)}</div>}
                  </div>
                );
              })}
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
      <ConnectBankModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </AccountsShell>
  );
}
