// Cargo Accounts — Ledger page (/accounts/ledger). Filterable transaction list on
// the editorial system. Tag chips deep-link to the operational record that caused
// the spend (the integration moat). "Needs attention" surfaces the auto-posted
// supplier-invoice queue; assigning an account clears it. COMMAND adds / voids.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listAccounts, listTransactions, createTransaction, voidTransaction, assignTransactionAccount,
  uploadReceipt, listAttachments, fileTransaction, fileTransactions,
  listMerchantRules, setMerchantRule,
} from '../../../services/financeService';
import { getChartGrouped } from '../../../services/chartService';
import { suggestWithRules, normalizeMerchant } from '../../../services/merchantClassify';
import { STANDARD_CHART_OF_ACCOUNTS, STANDARD_BUCKET_ORDER } from '../budgets/data/mybaChartOfAccounts';
import { formatMoney, isLiveTxn } from '../../../services/financeCalc';
import { ManualTxnModal, AssignAccountModal } from '../components/TransactionModals';
import StatementReconcileModal from '../components/StatementReconcileModal';
import CategoryPicker from '../components/CategoryPicker';
import AccountsShell from '../components/AccountsShell';
import '../accounts.css';

const SOURCE_LABEL = {
  manual: 'Manual', supplier_invoice: 'Supplier invoice', provisioning: 'Provisioning',
  defect_repair: 'Defect repair', charter: 'Charter', import: 'Import', bank_feed: 'Bank feed',
};

// Fallback picker groups from the standard MYBA chart, for tenants who haven't yet
// applied a chart template (so "Change category" always has lines to choose from).
const STANDARD_GROUPS = STANDARD_BUCKET_ORDER.map((bucket) => ({
  bucket,
  lines: STANDARD_CHART_OF_ACCOUNTS.filter((l) => l.bucket === bucket)
    .map((l) => ({ category: l.category, code: l.code })),
})).filter((g) => g.lines.length);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const monthKey = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'undated' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'Undated' : `${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`; };

// Group already-sorted (newest-first) rows into months, preserving order, with a
// per-month net total from the lines that actually move a balance.
const groupByMonth = (rows) => {
  const groups = [];
  const idx = {};
  for (const t of rows) {
    const k = monthKey(t.txn_date);
    if (!(k in idx)) { idx[k] = groups.length; groups.push({ key: k, label: monthLabel(t.txn_date), items: [], total: 0, currency: t.currency }); }
    const g = groups[idx[k]];
    g.items.push(t);
    if (isLiveTxn(t)) g.total += Number(t.amount || 0);
  }
  return groups;
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
  const [importOpen, setImportOpen] = useState(false);
  const [assignTxn, setAssignTxn] = useState(null);
  const [attByTxn, setAttByTxn] = useState({});   // txnId → [attachment w/ signed url]
  const [toast, setToast] = useState('');
  const [merchantRules, setMerchantRules] = useState([]);
  const [chart, setChart] = useState([]);         // grouped chart lines for the picker
  const [picker, setPicker] = useState(null);     // { rect, txn } for the category popover

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  // Tier-A learned map: normalised merchant → MYBA line, for the suggestion engine.
  const ruleMap = useMemo(
    () => new Map((merchantRules || []).map((r) => [r.merchant_key, { bucket: r.bucket, category: r.category, code: r.code }])),
    [merchantRules],
  );
  const pickerGroups = chart.length ? chart : STANDARD_GROUPS;

  const loadAccounts = useCallback(async () => {
    if (!activeTenantId) return;
    const { data } = await listAccounts(activeTenantId);
    if (data) setAccounts(data);
  }, [activeTenantId]);

  const loadRules = useCallback(async () => {
    if (!activeTenantId) return;
    const { data } = await listMerchantRules(activeTenantId);
    setMerchantRules(data || []);
  }, [activeTenantId]);

  const loadTxns = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== false));
    const { data } = await listTransactions(activeTenantId, clean);
    setTxns(data || []);
    setLoading(false);
    // Receipts for the visible rows (each carries a short-lived signed URL).
    const ids = (data || []).map((t) => t.id);
    if (ids.length) {
      const { data: atts } = await listAttachments(ids);
      const map = {};
      (atts || []).forEach((a) => { (map[a.ledger_transaction_id] ||= []).push(a); });
      setAttByTxn(map);
    } else {
      setAttByTxn({});
    }
  }, [activeTenantId, filters]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadTxns(); }, [loadTxns]);
  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => {
    if (!activeTenantId) return;
    getChartGrouped(activeTenantId).then(({ data }) => setChart(data || []));
  }, [activeTenantId]);

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

  const monthGroups = useMemo(() => groupByMonth(rows), [rows]);

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));

  const handleAdd = async (payload) => {
    const res = await createTransaction({ ...payload, tenant_id: activeTenantId });
    if (!res.error) { await Promise.all([loadTxns(), loadAccounts()]); flash('Transaction added'); }
    return res;
  };

  const handleUploadReceipt = async (txnId, file) => {
    const res = await uploadReceipt(txnId, file, { tenantId: activeTenantId });
    if (!res.error) await loadTxns();   // refresh so the receipt chip appears
    return res;
  };

  const handleAssign = async (id, accountId) => {
    const res = await assignTransactionAccount(id, accountId);
    if (!res.error) { await Promise.all([loadTxns(), loadAccounts()]); flash('Account assigned'); }
    return res;
  };

  // File a line onto a MYBA category. When `learn`, remember the merchant so every
  // future charge from it auto-files, and backfill any sibling lines already on
  // screen from the same merchant — so confirming once clears the whole vendor.
  const handleFile = async (t, line, { learn = true } = {}) => {
    setPicker(null);
    const target = { bucket: line.bucket, category: line.category, code: line.code || null };
    const res = await fileTransaction(t.id, { category: target.category, category_code: target.code });
    if (res.error) { flash('Could not file — please try again'); return; }
    let cleared = 1;
    if (learn && t.payee) {
      await setMerchantRule(activeTenantId, t.payee, target);
      const key = normalizeMerchant(t.payee);
      const siblingIds = txns
        .filter((x) => x.id !== t.id && !x.category && x.status === 'unreconciled'
          && normalizeMerchant(x.payee) === key)
        .map((x) => x.id);
      if (siblingIds.length) { await fileTransactions(siblingIds, { category: target.category, category_code: target.code }); cleared += siblingIds.length; }
    }
    await Promise.all([loadTxns(), loadRules()]);
    flash(cleared > 1 ? `Filed to ${target.category} · ${cleared} lines` : `Filed to ${target.category}`);
  };

  const openPicker = (e, t) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPicker({ rect, txn: t });
  };
  const pickCategory = (o) => { if (picker) handleFile(picker.txn, o); };

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
    // Suggest a MYBA line for un-categorised attention rows (learned map → seed → text).
    const needsCategory = attention && !voided && !t.category;
    const sug = needsCategory ? suggestWithRules(t, ruleMap).suggestion : null;
    return (
      <div key={t.id} className={`ca-txn${voided ? ' is-void' : ''}${attention && !voided ? ' is-attention' : ''}`}>
        <span className="ca-txn-date">{fmtDMY(t.txn_date)}</span>
        <div className="ca-txn-desc">
          <div className="ca-txn-title">{t.description || SOURCE_LABEL[t.source] || 'Transaction'}</div>
          <div className="ca-txn-cat">
            {t.category ? `${t.category} · ` : ''}{SOURCE_LABEL[t.source] || t.source}
            {voided ? ' · voided' : ''}
          </div>
          {needsCategory && canEdit && (
            <div className="ca-suggest">
              {sug ? (
                <>
                  <span className={`ca-sug-pill is-${sug.confidence}`} title={sug.reason}>
                    <i className="ca-sug-dot" />
                    {sug.code ? `${sug.code} · ` : ''}{sug.category}
                    {sug.confidence === 'low' ? <em className="ca-sug-check"> · check</em> : null}
                  </span>
                  <button type="button" className="ca-sug-file" onClick={() => handleFile(t, sug)}>File</button>
                  <button type="button" className="ca-sug-change" onClick={(e) => openPicker(e, t)}>Change</button>
                </>
              ) : (
                <button type="button" className="ca-sug-change" onClick={(e) => openPicker(e, t)}>
                  <Icon name="Tag" size={12} /> Categorise…
                </button>
              )}
            </div>
          )}
          {renderChips(t)}
          {attByTxn[t.id]?.length > 0 && (
            <div className="ca-chips">
              <button type="button" className="ca-chip" title="View receipt"
                onClick={() => attByTxn[t.id][0].url && window.open(attByTxn[t.id][0].url, '_blank', 'noopener')}>
                <Icon name="Paperclip" size={11} /> {attByTxn[t.id].length > 1 ? `${attByTxn[t.id].length} receipts` : 'Receipt'}
              </button>
            </div>
          )}
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
          {!t.account_id && !voided && canEdit && (
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
    <AccountsShell active="spending">
      <div className="ca-page">
        <div className="ca-wrap">
          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Spending</span>
              <span className="bar" />
              <span className="muted">{txns.length} entries</span>
              {attentionCount > 0 && (<><span className="bar" /><span className="muted">{attentionCount} need a look</span></>)}
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Money <em>in &amp; out</em>.</h1>
              <div className="ca-head-act">
                {canEdit && (
                  <>
                    <button type="button" className="ca-btn ca-btn-ghost" onClick={() => setImportOpen(true)}>
                      <Icon name="Upload" size={15} /> Import statement
                    </button>
                    <button type="button" className="ca-btn ca-btn-primary" onClick={() => setAddOpen(true)}>
                      <Icon name="Plus" size={16} /> Add spending
                    </button>
                  </>
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
            <div className="ca-months" style={{ marginTop: 18 }}>
              {monthGroups.map((g) => (
                <section key={g.key} className="ca-month">
                  <div className="ca-month-head">
                    <span className="ca-month-label">{g.label}</span>
                    <span className="ca-month-total">{formatMoney(g.total, g.currency, { signed: true })}</span>
                  </div>
                  <div className="ca-cat">{g.items.map(renderRow)}</div>
                </section>
              ))}
            </div>
          )}
        </div>

        {toast && <div className="ca-toast">{toast}</div>}
      </div>

      <ManualTxnModal open={addOpen} onClose={() => setAddOpen(false)} onSave={handleAdd} onUploadReceipt={handleUploadReceipt} accounts={accounts} tenantId={activeTenantId} />
      <AssignAccountModal open={Boolean(assignTxn)} onClose={() => setAssignTxn(null)} onAssign={handleAssign} txn={assignTxn} accounts={accounts} />
      <StatementReconcileModal open={importOpen} onClose={() => setImportOpen(false)} accounts={accounts} tenantId={activeTenantId}
        onDone={() => { flash('Statement reconciled'); loadTxns(); }} />
      {picker && (
        <CategoryPicker anchorRect={picker.rect} groups={pickerGroups}
          onPick={pickCategory} onClose={() => setPicker(null)} />
      )}
    </AccountsShell>
  );
}
