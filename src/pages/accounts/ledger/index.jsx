// Cargo Accounts — Ledger page (/accounts/ledger). Filterable transaction list on
// the editorial system. Tag chips deep-link to the operational record that caused
// the spend (the integration moat). "Needs attention" surfaces the auto-posted
// supplier-invoice queue; assigning an account clears it. COMMAND adds / voids.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listAccounts, listTransactions, createTransaction, voidTransaction, assignTransactionAccount,
} from '../../../services/financeService';
import { formatMoney, isLiveTxn } from '../../../services/financeCalc';
import { ManualTxnModal, AssignAccountModal } from '../components/TransactionModals';
import '../accounts.css';

const SOURCE_LABEL = {
  manual: 'Manual', supplier_invoice: 'Supplier invoice', provisioning: 'Provisioning',
  defect_repair: 'Defect repair', charter: 'Charter', import: 'Import',
};

// Operational tag → { label, path }. Deep-links to the module that owns the record.
const TAGS = [
  { key: 'supplier_invoice_id', label: 'Invoice', path: () => '/provisioning' },
  { key: 'supplier_order_id', label: 'Order', path: () => '/provisioning' },
  { key: 'provisioning_item_id', label: 'Item', path: () => '/provisioning' },
  { key: 'trip_id', label: 'Trip', path: () => '/trips-management-dashboard' },
  { key: 'defect_id', label: 'Defect', path: () => '/defects' },
  { key: 'crew_id', label: 'Crew', path: (t) => `/profile/${t.crew_id}` },
];

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export default function Ledger() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { hasCommandAccess } = useAuth();
  const canEdit = hasCommandAccess();

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [txns, setTxns] = useState([]);
  const [filters, setFilters] = useState({ accountId: '', source: '', category: '', from: '', to: '', search: '', needsAttention: false });
  const [addOpen, setAddOpen] = useState(false);
  const [assignTxn, setAssignTxn] = useState(null);
  const [toast, setToast] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const loadAccounts = useCallback(async () => {
    if (!activeTenantId) return;
    const { data } = await listAccounts(activeTenantId);
    if (data) setAccounts(data);
  }, [activeTenantId]);

  const loadTxns = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== false));
    const { data } = await listTransactions(activeTenantId, clean);
    setTxns(data || []);
    setLoading(false);
  }, [activeTenantId, filters]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  // Running balance only when a single account is filtered: cumulate opening + live
  // amounts oldest→newest, then present newest-first.
  const rows = useMemo(() => {
    if (!filters.accountId) return txns.map((t) => ({ ...t, running: null }));
    const acct = accountsById[filters.accountId];
    const opening = Number(acct?.opening_balance || 0);
    const oldestFirst = [...txns].reverse();
    let bal = opening;
    const withRun = oldestFirst.map((t) => {
      if (isLiveTxn(t)) bal += Number(t.amount || 0);
      return { ...t, running: bal };
    });
    return withRun.reverse();
  }, [txns, filters.accountId, accountsById]);

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));

  const handleAdd = async (payload) => {
    const res = await createTransaction({ ...payload, tenant_id: activeTenantId });
    if (!res.error) { await Promise.all([loadTxns(), loadAccounts()]); flash('Transaction added'); }
    return res;
  };

  const handleAssign = async (id, accountId) => {
    const res = await assignTransactionAccount(id, accountId);
    if (!res.error) { await Promise.all([loadTxns(), loadAccounts()]); flash('Account assigned'); }
    return res;
  };

  const handleVoid = async (t) => {
    if (!window.confirm('Void this transaction? It will no longer affect any balance.')) return;
    const { error } = await voidTransaction(t.id);
    if (!error) { await Promise.all([loadTxns(), loadAccounts()]); flash('Transaction voided'); }
    else flash('Could not void — please try again');
  };

  const renderChips = (t) => {
    const chips = TAGS.filter((tag) => t[tag.key]);
    if (!chips.length) return null;
    return (
      <div className="ca-chips">
        {chips.map((tag) => (
          <button key={tag.key} type="button" className="ca-chip" title={`Open ${tag.label}`}
            onClick={() => navigate(tag.path(t))}>
            {tag.label}
          </button>
        ))}
      </div>
    );
  };

  const renderRow = (t) => {
    const attention = !t.account_id || t.status === 'unreconciled';
    const acct = t.account_id ? accountsById[t.account_id] : null;
    const voided = t.status === 'void';
    return (
      <div key={t.id} className={`ca-txn${voided ? ' is-void' : ''}${attention && !voided ? ' is-attention' : ''}`}>
        <span className="ca-txn-date">{fmtDMY(t.txn_date)}</span>
        <div className="ca-txn-desc">
          <div className="ca-txn-title">{t.description || SOURCE_LABEL[t.source] || 'Transaction'}</div>
          <div className="ca-txn-cat">
            {t.category ? `${t.category} · ` : ''}{SOURCE_LABEL[t.source] || t.source}
            {voided ? ' · voided' : ''}
          </div>
          {renderChips(t)}
        </div>
        <span className={`ca-txn-acct${!t.account_id ? ' is-unassigned' : ''}`}>
          {acct ? acct.name : 'Unassigned'}
        </span>
        <span className="ca-txn-amt">
          <b className={t.amount < 0 ? 'ca-neg' : 'ca-pos'}>{formatMoney(t.amount, t.currency, { signed: true })}</b>
          {t.running != null && !voided && (
            <span className="ca-txn-run">bal {formatMoney(t.running, accountsById[filters.accountId]?.currency || t.currency)}</span>
          )}
        </span>
        <span className="ca-txn-act">
          {attention && !voided && canEdit && (
            <button type="button" className="ca-link" onClick={() => setAssignTxn(t)}>Assign →</button>
          )}
          {!voided && canEdit && (
            <button type="button" className="ca-link is-mut" onClick={() => handleVoid(t)} title="Void">
              <Icon name="Ban" size={15} />
            </button>
          )}
        </span>
      </div>
    );
  };

  const attentionCount = txns.filter((t) => (!t.account_id || t.status === 'unreconciled') && t.status !== 'void').length;

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
              <span>Ledger</span>
              <span className="bar" />
              <span className="muted">{txns.length} transactions</span>
              {attentionCount > 0 && (<><span className="bar" /><span className="muted">{attentionCount} need attention</span></>)}
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">The <em>ledger</em>.</h1>
              <div className="ca-head-act">
                {canEdit && (
                  <button type="button" className="ca-btn ca-btn-primary" onClick={() => setAddOpen(true)}>
                    <Icon name="Plus" size={16} /> Add transaction
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="ca-filters">
            <select className="ca-field" value={filters.accountId} onChange={(e) => setF({ accountId: e.target.value })} aria-label="Account">
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="ca-field" value={filters.source} onChange={(e) => setF({ source: e.target.value })} aria-label="Source">
              <option value="">All sources</option>
              {Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className="ca-field" value={filters.category} onChange={(e) => setF({ category: e.target.value })} placeholder="Category" aria-label="Category" />
            <input className="ca-field" type="date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} aria-label="From date" />
            <input className="ca-field" type="date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} aria-label="To date" />
            <input className="ca-field" value={filters.search} onChange={(e) => setF({ search: e.target.value })} placeholder="Search description" aria-label="Search" />
            <div className="ca-filters-spacer" />
            <button type="button" className="ca-toggle" aria-pressed={filters.needsAttention}
              onClick={() => setF({ needsAttention: !filters.needsAttention })}>
              <Icon name="AlertCircle" size={14} /> Needs attention
            </button>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading transactions…</p></div>
          ) : rows.length === 0 ? (
            <div className="ca-empty">
              <Icon name="Receipt" size={44} />
              <p>No transactions match</p>
              <p className="ca-empty-sub">Adjust the filters, or add a manual transaction.</p>
            </div>
          ) : (
            <div className="ca-cat" style={{ marginTop: 18 }}>
              {rows.map(renderRow)}
            </div>
          )}
        </div>

        {toast && <div className="ca-toast">{toast}</div>}
      </div>

      <ManualTxnModal open={addOpen} onClose={() => setAddOpen(false)} onSave={handleAdd} accounts={accounts} />
      <AssignAccountModal open={Boolean(assignTxn)} onClose={() => setAssignTxn(null)} onAssign={handleAssign} txn={assignTxn} accounts={accounts} />
    </>
  );
}
