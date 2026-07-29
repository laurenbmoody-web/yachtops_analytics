// Cargo Accounts — Ledger page (/accounts/ledger). One month at a time on the
// editorial system: step months with the navigator, and the bank feed is
// categorised inline — confident lines get a one-tap File, two-sided vendors
// (airline, supermarket, taxi) offer a guest-vs-crew choice instead of a guess.
// Tag chips deep-link to the operational record that caused the spend.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listAccounts, listTransactions, createTransaction, voidTransaction, assignTransactionAccount,
  uploadReceipt, listAttachments, deleteAttachment, fileTransaction, fileTransactions,
  listMerchantRules, setMerchantRule,
  updateTransactionDetail, listSplits, saveSplits, listTripsLite, listTenantCrew,
} from '../../../services/financeService';
import { getChartGrouped } from '../../../services/chartService';
import { resolveSuggestion, normalizeMerchant } from '../../../services/merchantClassify';
import { lineCompleteness, defaultAllocation } from '../../../services/lineDetail';
import LineDetail from '../components/LineDetail';
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

// Operational tag → { label, path }. Deep-links to the module that owns the record.
const TAGS = [
  { key: 'supplier_invoice_id', label: 'Invoice', path: () => '/provisioning' },
  { key: 'supplier_order_id', label: 'Order', path: () => '/provisioning' },
  { key: 'provisioning_item_id', label: 'Item', path: () => '/provisioning' },
  { key: 'trip_id', label: 'Trip', path: () => '/trips-management-dashboard' },
  { key: 'defect_id', label: 'Defect', path: () => '/defects' },
  { key: 'crew_id', label: 'Crew', path: (t) => `/profile/${t.crew_id}` },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const ymOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const ymLabel = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const thisYm = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };

// Every calendar month from the earliest transaction to the latest (or today,
// whichever is later), ascending — including empty ones, so stepping never
// silently skips a gap.
const buildAxis = (rows) => {
  const yms = rows.map((r) => ymOf(r.txn_date)).filter(Boolean);
  if (!yms.length) return [thisYm()];
  const min = yms.reduce((a, b) => (a < b ? a : b));
  const max = [...yms, thisYm()].reduce((a, b) => (a > b ? a : b));
  const [y0, m0] = min.split('-').map(Number);
  const [y1, m1] = max.split('-').map(Number);
  const out = [];
  let y = y0; let m = m0;
  while (y < y1 || (y === y1 && m <= m1)) { out.push(`${y}-${pad2(m)}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

// Row state — drives the segmented control and the per-month counts.
const isVoidRow = (t) => t.status === 'void';
const isFiledRow = (t) => t.status === 'reconciled';
const isLookRow = (t) => !isVoidRow(t) && (t.status === 'unreconciled' || !t.account_id);

export default function Ledger() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { hasCommandAccess } = useAuth();
  const canEdit = hasCommandAccess();

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [txns, setTxns] = useState([]);
  const [filters, setFilters] = useState({ accountId: '', source: '', category: '', search: '' });
  const [status, setStatus] = useState('all');   // all | look | filed  (default: All, so filed rows stay in view)
  const [sortOldest, setSortOldest] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeMonth, setActiveMonth] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignTxn, setAssignTxn] = useState(null);
  const [attByTxn, setAttByTxn] = useState({});   // txnId → [attachment w/ signed url]
  const [toast, setToast] = useState('');
  const [merchantRules, setMerchantRules] = useState([]);
  const [chart, setChart] = useState([]);         // grouped chart lines for the picker
  const [picker, setPicker] = useState(null);     // { rect, txn } for the category popover
  const [expandedId, setExpandedId] = useState(null);  // row whose detail panel is open
  const [splitsByTxn, setSplitsByTxn] = useState({});  // txnId → [split]
  const [trips, setTrips] = useState([]);
  const [crew, setCrew] = useState([]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  // Tier-A learned map: normalised merchant → MYBA line, for the suggestion engine.
  const ruleMap = useMemo(
    () => new Map((merchantRules || []).map((r) => [r.merchant_key, { bucket: r.bucket, category: r.category, code: r.code }])),
    [merchantRules],
  );
  const pickerGroups = chart.length ? chart : STANDARD_GROUPS;
  const activeFilterCount = ['accountId', 'source', 'category'].filter((k) => filters[k]).length;

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
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
    const { data } = await listTransactions(activeTenantId, clean);
    setTxns(data || []);
    setLoading(false);
    const ids = (data || []).map((t) => t.id);
    if (ids.length) {
      const [{ data: atts }, { data: sp }] = await Promise.all([listAttachments(ids), listSplits(ids)]);
      const map = {};
      (atts || []).forEach((a) => { (map[a.ledger_transaction_id] ||= []).push(a); });
      setAttByTxn(map);
      const smap = {};
      (sp || []).forEach((s) => { (smap[s.ledger_transaction_id] ||= []).push(s); });
      setSplitsByTxn(smap);
    } else {
      setAttByTxn({});
      setSplitsByTxn({});
    }
  }, [activeTenantId, filters]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadTxns(); }, [loadTxns]);
  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => {
    if (!activeTenantId) return;
    getChartGrouped(activeTenantId).then(({ data }) => setChart(data || []));
    // Pickers for the detail panel: charters to bill APA spend to, crew to name a spender.
    listTripsLite(activeTenantId).then(({ data }) => setTrips(data || []));
    listTenantCrew(activeTenantId).then(({ data }) => setCrew(data || []));
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

  // Month axis + per-month stats for the navigator and quick-jump strip.
  const axis = useMemo(() => buildAxis(rows), [rows]);
  const statsByMonth = useMemo(() => {
    const m = {};
    rows.forEach((t) => {
      const ym = ymOf(t.txn_date); if (!ym) return;
      const s = (m[ym] ||= { entries: 0, look: 0, filed: 0, net: 0, inSum: 0, outSum: 0 });
      s.entries += 1;
      if (isLookRow(t)) s.look += 1;
      if (isFiledRow(t)) s.filed += 1;
      if (isLiveTxn(t)) {
        const a = Number(t.amount || 0);
        s.net += a;
        if (a >= 0) s.inSum += a; else s.outSum += a;
      }
    });
    return m;
  }, [rows]);

  // Keep the active month valid: default to the newest month, re-clamp if the axis
  // changes (e.g. a filter narrows the set).
  useEffect(() => {
    if (!axis.length) return;
    setActiveMonth((cur) => (cur && axis.includes(cur) ? cur : axis[axis.length - 1]));
  }, [axis]);

  const monthRows = useMemo(() => {
    let list = rows.filter((t) => ymOf(t.txn_date) === activeMonth);
    if (status === 'look') list = list.filter(isLookRow);
    else if (status === 'filed') list = list.filter(isFiledRow);
    if (sortOldest) list = [...list].reverse();
    return list;
  }, [rows, activeMonth, status, sortOldest]);

  const monthStat = statsByMonth[activeMonth] || { entries: 0, look: 0, filed: 0, net: 0, inSum: 0, outSum: 0 };
  const axisIdx = axis.indexOf(activeMonth);
  const totalLook = txns.filter(isLookRow).length;
  const filedPct = monthStat.entries ? Math.round((monthStat.filed / monthStat.entries) * 100) : 0;
  const monthCur = monthRows[0]?.currency;

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));
  const stepMonth = (delta) => { const i = axisIdx + delta; if (i >= 0 && i < axis.length) setActiveMonth(axis[i]); };

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

  // File a line onto a MYBA category. Patches state in place — no full refetch —
  // so bulk categorising stays smooth (the row updates/leaves the queue without a
  // reload or scroll jump). Always remembers the merchant. For an unambiguous
  // vendor it also backfills sibling lines on screen (confirm once, clear the
  // vendor); for a two-sided vendor it does NOT — each charge is a separate
  // guest/crew call, so the learned side only pre-highlights next time.
  const handleFile = async (t, line) => {
    setPicker(null);
    const target = { bucket: line.bucket, category: line.category, code: line.code || null };
    const res = await fileTransaction(t.id, { category: target.category, category_code: target.code });
    if (res.error) { flash('Could not file — please try again'); return; }

    const filedIds = new Set([t.id]);
    if (t.payee) {
      const key = normalizeMerchant(t.payee);
      const twoSided = resolveSuggestion(t, ruleMap).kind === 'choice';
      if (!twoSided) {
        const siblingIds = txns
          .filter((x) => x.id !== t.id && !x.category && x.status === 'unreconciled'
            && normalizeMerchant(x.payee) === key)
          .map((x) => x.id);
        if (siblingIds.length) {
          await fileTransactions(siblingIds, { category: target.category, category_code: target.code });
          siblingIds.forEach((id) => filedIds.add(id));
        }
      }
      // Persist + locally learn the merchant so later rows suggest it without a reload.
      setMerchantRule(activeTenantId, t.payee, target);
      if (key) {
        setMerchantRules((prev) => [
          ...prev.filter((r) => r.merchant_key !== key),
          { merchant_key: key, bucket: target.bucket, category: target.category, code: target.code },
        ]);
      }
    }

    // Optimistic in-place patch: mark the filed rows reconciled, no server round-trip.
    setTxns((prev) => prev.map((x) => (filedIds.has(x.id)
      ? { ...x, category: target.category, category_code: target.code, status: 'reconciled' }
      : x)));
    flash(filedIds.size > 1 ? `Filed to ${target.category} · ${filedIds.size} lines` : `Filed to ${target.category}`);
  };

  const openPicker = (e, t) => { setPicker({ rect: e.currentTarget.getBoundingClientRect(), txn: t }); };
  const pickCategory = (o) => { if (picker) handleFile(picker.txn, o); };

  // Save the detail panel: the line's own fields plus its split set. Patches state
  // in place (same as filing) so the list doesn't reload underneath you.
  const handleSaveDetail = async (id, { detail, splits }) => {
    const res = await updateTransactionDetail(id, detail);
    if (res.error) return res;
    let savedSplits = splitsByTxn[id] || [];
    const wantSplits = (splits || []).filter((s) => s.category && Number(s.amount));
    if (wantSplits.length || savedSplits.length) {
      const sr = await saveSplits(id, { tenantId: activeTenantId, splits: wantSplits });
      if (sr.error) return sr;
      savedSplits = sr.data || [];
      setSplitsByTxn((prev) => ({ ...prev, [id]: savedSplits }));
    }
    setTxns((prev) => prev.map((x) => (x.id === id ? { ...x, ...(res.data || detail) } : x)));
    flash(wantSplits.length ? `Detail saved · split ${wantSplits.length} ways` : 'Detail saved');
    return { error: null };
  };

  const handleReceiptFor = async (txnId, file) => {
    const res = await uploadReceipt(txnId, file, { tenantId: activeTenantId });
    if (!res.error && res.data) {
      const { data: atts } = await listAttachments([txnId]);
      setAttByTxn((prev) => ({ ...prev, [txnId]: atts || [] }));
      flash('Receipt attached');
    }
    return res;
  };

  const handleDeleteAttachment = async (attId, storagePath) => {
    const { error } = await deleteAttachment(attId, storagePath);
    if (error) { flash('Could not remove that receipt'); return; }
    setAttByTxn((prev) => Object.fromEntries(
      Object.entries(prev).map(([k, list]) => [k, list.filter((a) => a.id !== attId)]),
    ));
    flash('Receipt removed');
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

  // The inline categorise affordance for an un-filed attention row.
  const renderSuggest = (t) => {
    const r = resolveSuggestion(t, ruleMap);
    if (r.kind === 'choice') {
      // Two-sided vendor — pick the side. Pre-highlight the learned preference.
      return (
        <div className="ca-suggest">
          <span className="ca-ask">{r.reason || 'Guest or crew?'}</span>
          {r.options.map((o) => (
            <button key={o.code} type="button"
              className={`ca-opt${r.preferred === o.category ? ' is-pref' : ''}`}
              onClick={() => handleFile(t, o)}>
              <span className="ca-opt-code">{o.code}</span> {o.category}
            </button>
          ))}
          <button type="button" className="ca-sug-change" onClick={(e) => openPicker(e, t)}>Other…</button>
        </div>
      );
    }
    if (r.kind === 'single') {
      const s = r.suggestion;
      return (
        <div className="ca-suggest">
          <span className="ca-sug-pill" title={s.reason}>
            <i className="ca-sug-dot" />{s.code ? `${s.code} · ` : ''}{s.category}
          </span>
          <button type="button" className="ca-sug-file" onClick={() => handleFile(t, s)}>File</button>
          <button type="button" className="ca-sug-change" onClick={(e) => openPicker(e, t)}>Change</button>
        </div>
      );
    }
    return (
      <div className="ca-suggest">
        <button type="button" className="ca-sug-change" onClick={(e) => openPicker(e, t)}>
          <Icon name="Tag" size={12} /> Categorise…
        </button>
      </div>
    );
  };

  const renderRow = (t) => {
    const acct = t.account_id ? accountsById[t.account_id] : null;
    const voided = isVoidRow(t);
    const look = isLookRow(t);
    const open = expandedId === t.id;
    const atts = attByTxn[t.id] || [];
    const rowSplits = splitsByTxn[t.id] || [];
    const alloc = t.allocation || defaultAllocation(t, acct);
    const { missing } = lineCompleteness(t, { account: acct, hasReceipt: atts.length > 0, splitCount: rowSplits.length });
    return (
      <React.Fragment key={t.id}>
      <div className={`ca-txn${voided ? ' is-void' : ''}${look ? ' is-attention' : ''}${open ? ' is-open' : ''}`}>
        <button type="button" className={`ca-exp-btn${open ? ' is-open' : ''}`}
          aria-expanded={open} aria-label={open ? 'Hide detail' : 'Show detail'}
          onClick={() => setExpandedId(open ? null : t.id)}>
          <Icon name="ChevronRight" size={15} />
        </button>
        <span className="ca-txn-date">{fmtDMY(t.txn_date)}</span>
        <div className="ca-txn-desc">
          <div className="ca-txn-title">{t.description || SOURCE_LABEL[t.source] || 'Transaction'}</div>
          <div className="ca-txn-cat">
            {t.category ? <span className="ca-txn-filed">✓ {t.category_code ? `${t.category_code} · ` : ''}{t.category}</span> : null}
            {t.category ? ' · ' : ''}{SOURCE_LABEL[t.source] || t.source}
            {voided ? ' · voided' : ''}
          </div>
          {look && !voided && canEdit && renderSuggest(t)}
          {renderChips(t)}
          {/* What this line still needs, at a glance — click through to fix it. */}
          {!voided && (
            <div className="ca-marks">
              {atts.length > 0 && (
                <button type="button" className="ca-mark is-on" title="View receipt"
                  onClick={() => atts[0].url && window.open(atts[0].url, '_blank', 'noopener')}>
                  <Icon name="Paperclip" size={10} /> {atts.length > 1 ? `${atts.length} receipts` : 'Receipt'}
                </button>
              )}
              {rowSplits.length > 0 && (
                <span className="ca-mark is-on"><Icon name="Split" size={10} /> Split {rowSplits.length} ways</span>
              )}
              {alloc && <span className={`ca-mark is-alloc${alloc === 'charter' ? ' is-charter' : ''}`}>
                {alloc === 'charter' ? 'Charter · APA' : 'Owner'}
              </span>}
              {t.category && missing.length > 0 && canEdit && (
                <button type="button" className="ca-mark is-need" onClick={() => setExpandedId(t.id)}
                  title="Open the detail to complete this line">
                  Needs {missing.slice(0, 2).join(' + ')}{missing.length > 2 ? ` +${missing.length - 2}` : ''}
                </button>
              )}
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
      {open && (
        <LineDetail
          txn={t}
          account={acct}
          crew={crew}
          trips={trips}
          chartGroups={pickerGroups}
          attachments={atts}
          splits={rowSplits}
          canEdit={canEdit}
          onSave={handleSaveDetail}
          onUploadReceipt={handleReceiptFor}
          onDeleteAttachment={handleDeleteAttachment}
          onClose={() => setExpandedId(null)}
        />
      )}
      </React.Fragment>
    );
  };

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
              {totalLook > 0 && (<><span className="bar" /><span className="muted">{totalLook} need a look</span></>)}
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

          {/* toolbar: status segmented · search · filters · sort */}
          <div className="ca-toolbar">
            <div className="ca-seg" role="tablist" aria-label="Show">
              {[['all', 'All', monthStat.entries], ['look', 'Needs a look', monthStat.look], ['filed', 'Filed', monthStat.filed]].map(([k, label, n]) => (
                <button key={k} type="button" role="tab" aria-selected={status === k}
                  data-k={k} onClick={() => setStatus(k)}>
                  {label} <span className="ca-seg-n">{n}</span>
                </button>
              ))}
            </div>
            <div className="ca-toolbar-sp" />
            <label className="ca-search">
              <Icon name="Search" size={15} />
              <input value={filters.search} onChange={(e) => setF({ search: e.target.value })}
                placeholder="Search this month…" aria-label="Search description" />
            </label>
            <div className="ca-filterwrap">
              <button type="button" className="ca-toolbtn" aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}>
                <Icon name="SlidersHorizontal" size={14} /> Filters
                {activeFilterCount > 0 && <span className="ca-toolbtn-badge">{activeFilterCount}</span>}
              </button>
              {filtersOpen && (
                <div className="ca-filterpop">
                  <label className="ca-fp-row"><span>Account</span>
                    <select className="ca-field" value={filters.accountId} onChange={(e) => setF({ accountId: e.target.value })}>
                      <option value="">All accounts</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <label className="ca-fp-row"><span>Source</span>
                    <select className="ca-field" value={filters.source} onChange={(e) => setF({ source: e.target.value })}>
                      <option value="">All sources</option>
                      {Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="ca-fp-row"><span>Category</span>
                    <input className="ca-field" value={filters.category} onChange={(e) => setF({ category: e.target.value })} placeholder="Any category" />
                  </label>
                  {activeFilterCount > 0 && (
                    <button type="button" className="ca-fp-clear" onClick={() => setF({ accountId: '', source: '', category: '' })}>Clear filters</button>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="ca-toolbtn" onClick={() => setSortOldest((v) => !v)} title="Sort by date">
              <Icon name={sortOldest ? 'ArrowUpNarrowWide' : 'ArrowDownWideNarrow'} size={14} /> {sortOldest ? 'Oldest' : 'Newest'}
            </button>
          </div>

          {/* month stepper (left) + KPIs (right) — borderless */}
          <div className="ca-monthbar">
            <div className="ca-stepper">
              <button type="button" className="ca-step-arrow" onClick={() => stepMonth(-1)} disabled={axisIdx <= 0} aria-label="Previous month">
                <Icon name="ChevronLeft" size={18} />
              </button>
              <div className="ca-step-name">{ymLabel(activeMonth)}</div>
              <button type="button" className="ca-step-arrow" onClick={() => stepMonth(1)} disabled={axisIdx >= axis.length - 1} aria-label="Next month">
                <Icon name="ChevronRight" size={18} />
              </button>
            </div>
            <div className="ca-kpis">
              <div className="ca-kpi meter">
                <span className="ca-kpi-l">Categorised</span>
                <span className="ca-kpi-v">{filedPct}%</span>
                <div className="ca-meter-track"><div className="ca-meter-fill" style={{ width: `${filedPct}%` }} /></div>
                <span className="ca-kpi-sub">{monthStat.filed} of {monthStat.entries} filed · {monthStat.look} to go</span>
              </div>
              <div className="ca-kpi">
                <span className="ca-kpi-l">Money out</span>
                <span className="ca-kpi-v neg">{formatMoney(monthStat.outSum, monthCur, { signed: true })}</span>
              </div>
              <div className="ca-kpi">
                <span className="ca-kpi-l">Money in</span>
                <span className="ca-kpi-v">{formatMoney(monthStat.inSum, monthCur, { signed: true })}</span>
              </div>
              <div className="ca-kpi">
                <span className="ca-kpi-l">Net</span>
                <span className="ca-kpi-v net">{formatMoney(monthStat.net, monthCur, { signed: true })}</span>
              </div>
            </div>
          </div>

          {/* list */}
          {loading ? (
            <div className="ca-empty"><p>Loading transactions…</p></div>
          ) : monthRows.length === 0 ? (
            <div className="ca-empty">
              <Icon name="Receipt" size={44} />
              <p>{statsByMonth[activeMonth] ? 'Nothing here for this filter' : `No transactions in ${ymLabel(activeMonth)}`}</p>
              <p className="ca-empty-sub">{status !== 'all' ? 'Try “All”, or step to another month.' : 'Step to another month, or add a manual transaction.'}</p>
            </div>
          ) : (
            <div className="ca-cat" style={{ marginTop: 8 }}>
              {monthRows.map(renderRow)}
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
