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
  listMerchantRules, setMerchantRule, linkRefund, currentUserId,
  updateTransactionDetail, listSplits, saveSplits, listTripsLite, listTenantCrew,
} from '../../../services/financeService';
import { getChartGrouped } from '../../../services/chartService';
import { parseReceipt } from '../../../services/documentParser';
import { resolveSuggestion, normalizeMerchant } from '../../../services/merchantClassify';
import {
  defaultAllocation, effectiveDate, datesDiffer, straddlesMonth,
  lineState, outstandingText,
  maxSpendDate, isSpendDateValid, canVoidTxn, voidBlockedReason,
  looksLikeRefund, findRefundCandidate, hasEvidence, receiptWaiverPatch,
} from '../../../services/lineDetail';
import LineDetail from '../components/LineDetail';
import ReceiptScanner from '../components/ReceiptScanner';
import ReceiptClip from '../components/ReceiptClip';
import { walletAccounts, accountLabel } from '../../../services/accountPick';
import { monthFigures, statementChecks } from '../../../services/monthEnd';

// A scope, not an account id — "the lines that aren't on any card".
export const UNASSIGNED = '__unassigned__';
import MonthEndStrip from '../components/MonthEndStrip';
import AccountStack from '../components/AccountStack';
import MonthMoney from '../components/MonthMoney';
import {
  getReconciliation, listReconciliationsForMonth, saveStatementFigures, closeMonth,
} from '../../../services/reconcileService';
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

// Where a line came from operationally → the module that owns that record. Only
// records the line was *raised against* belong here: the crew member who spent it
// is a field on the line, not an operational source, so there's no profile link.
const TAGS = [
  { key: 'supplier_invoice_id', label: 'supplier invoice', path: () => '/provisioning' },
  { key: 'supplier_order_id', label: 'purchase order', path: () => '/provisioning' },
  { key: 'provisioning_item_id', label: 'provisioning item', path: () => '/provisioning' },
  { key: 'trip_id', label: 'trip', path: () => '/trips-management-dashboard' },
  { key: 'defect_id', label: 'defect', path: () => '/defects' },
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
const buildAxis = (rows, basis) => {
  const yms = rows.map((r) => ymOf(effectiveDate(r, basis))).filter(Boolean);
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
  const [dateBasis, setDateBasis] = useState('spend');   // spend = when it happened | statement = when the bank posted it
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
  const [editDateId, setEditDateId] = useState(null);   // row whose date is being changed
  const [meId, setMeId] = useState(null);         // who's reconciling — the last-resort department
  const [recon, setRecon] = useState(null);        // this account+month's reconciliation row
  const [monthRecons, setMonthRecons] = useState([]);  // every account's, for the overview
  const [reconTick, setReconTick] = useState(0);       // bumped on close, to refresh it
  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanSeed, setScanSeed] = useState(null);   // parsed receipt → prefills Add spending
  const [photoFor, setPhotoFor] = useState(null);   // line being photographed from its clip
  const [attaching, setAttaching] = useState(false);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  // Who's reconciling — used to surface their own cards first. Most accounts name
  // their holder by role rather than user id, so both are needed.
  const me = useMemo(() => {
    const mine = crew.find((c) => c.id === meId);
    return { userId: meId, roleName: mine?.role || null };
  }, [crew, meId]);

  // Tier-A learned map: normalised merchant → MYBA line, for the suggestion engine.
  const ruleMap = useMemo(
    () => new Map((merchantRules || []).map((r) => [r.merchant_key, { bucket: r.bucket, category: r.category, code: r.code }])),
    [merchantRules],
  );
  const pickerGroups = chart.length ? chart : STANDARD_GROUPS;
  // Counts what's narrowing the list, so the badge tells you why rows are missing.
  // 'Show' counts too, now that it lives in here rather than on its own switch.
  const activeFilterCount = ['accountId', 'source', 'category'].filter((k) => filters[k]).length
    + (status !== 'all' ? 1 : 0);

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
    // The account narrows client-side, not here: the wallet stack has to show every
    // card's month at once, and choosing one shouldn't cost a refetch.
    const clean = Object.fromEntries(
      Object.entries(filters).filter(([k, v]) => v !== '' && k !== 'accountId'),
    );
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
    // accountId deliberately absent — it no longer changes what's fetched.
  }, [activeTenantId, filters.source, filters.category, filters.search, filters.from, filters.to]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadTxns(); }, [loadTxns]);
  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => {
    if (!activeTenantId) return;
    getChartGrouped(activeTenantId).then(({ data }) => setChart(data || []));
    // Pickers for the detail panel: charters to bill APA spend to, crew to name a spender.
    listTripsLite(activeTenantId).then(({ data }) => setTrips(data || []));
    listTenantCrew(activeTenantId).then(({ data }) => setCrew(data || []));
    currentUserId().then(setMeId);
  }, [activeTenantId]);

  // Running balance only when a single account is filtered: cumulate opening + live
  // amounts oldest→newest, then present newest-first.
  const rows = useMemo(() => {
    // Lines that were imported or typed without a card. They belong to no
    // statement, so no close covers them — which is why they get their own scope
    // rather than sitting invisibly inside "all".
    if (filters.accountId === UNASSIGNED) {
      return txns.filter((t) => !t.account_id).map((t) => ({ ...t, running: null }));
    }
    if (!filters.accountId) return txns.map((t) => ({ ...t, running: null }));
    const acct = accountsById[filters.accountId];
    const opening = Number(acct?.opening_balance || 0);
    const mine = txns.filter((t) => t.account_id === filters.accountId);
    const oldestFirst = [...mine].reverse();
    let bal = opening;
    const withRun = oldestFirst.map((t) => {
      if (isLiveTxn(t)) bal += Number(t.amount || 0);
      return { ...t, running: bal };
    });
    return withRun.reverse();
  }, [txns, filters.accountId, accountsById]);

  // Month axis + per-month stats for the navigator and quick-jump strip.
  const axis = useMemo(() => buildAxis(rows, dateBasis), [rows, dateBasis]);
  const statsByMonth = useMemo(() => {
    const m = {};
    rows.forEach((t) => {
      const ym = ymOf(effectiveDate(t, dateBasis)); if (!ym) return;
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
  }, [rows, dateBasis]);

  // Keep the active month valid: default to the newest month, re-clamp if the axis
  // changes (e.g. a filter narrows the set).
  // Reconciliation is per account, so it only loads once one is filtered.
  const periodMonth = activeMonth ? `${activeMonth}-01` : null;
  useEffect(() => {
    if (!filters.accountId || !periodMonth) { setRecon(null); return; }
    getReconciliation(filters.accountId, periodMonth).then(({ data }) => setRecon(data || null));
  }, [filters.accountId, periodMonth]);

  // Every account's state for the month — the wallet stack marks each card with
  // it, including the ones behind the front. Reloaded after a close so the stack
  // reflects it without a refresh.
  useEffect(() => {
    if (!activeTenantId || !periodMonth) { setMonthRecons([]); return; }
    listReconciliationsForMonth(activeTenantId, periodMonth)
      .then(({ data }) => setMonthRecons(data || []));
  }, [activeTenantId, periodMonth, reconTick]);

  useEffect(() => {
    if (!axis.length) return;
    setActiveMonth((cur) => (cur && axis.includes(cur) ? cur : axis[axis.length - 1]));
  }, [axis]);

  // Everything in the month, before the Show filter. Balancing is about the whole
  // month's money — a list narrowed to "needs a look" would total the wrong figure.
  const monthAll = useMemo(
    () => rows.filter((t) => ymOf(effectiveDate(t, dateBasis)) === activeMonth),
    [rows, activeMonth, dateBasis],
  );

  // Per-account figures for the wallet stack — taken from every account's rows,
  // not the scoped ones, so the cards behind the front one still read correctly.
  const stackStats = useMemo(() => {
    const m = {};
    txns.forEach((t) => {
      if (ymOf(effectiveDate(t, dateBasis)) !== activeMonth) return;
      const k = t.account_id || '';
      const s = (m[k] ||= { count: 0, out: 0 });
      s.count += 1;
      if (isLiveTxn(t) && Number(t.amount) < 0) s.out += Number(t.amount);
    });
    return m;
  }, [txns, activeMonth, dateBasis]);

  // See walletAccounts: the vessel's own money, plus any card that moved money
  // this month. Showing every account put all twelve of the boat's cards in the
  // wallet — most of which are in individual crew pockets and reconciled on their
  // own page. Busiest first, so quiet cards fall to the back of the fan.
  const stackAccounts = useMemo(
    () => walletAccounts(accounts, (a) => stackStats[a.id]?.count)
      .sort((x, y) => (stackStats[x.id]?.out || 0) - (stackStats[y.id]?.out || 0)),
    [accounts, stackStats],
  );

  // The typed statement is read by the money panel (which shows the fields and
  // whether each agrees) and by the close panel (which won't close on a
  // difference), so it belongs to the page that renders both.
  const [statement, setStatement] = useState({ moneyOut: '', moneyIn: '', closing: '' });
  useEffect(() => {
    setStatement({
      moneyOut: recon?.stmt_money_out ?? '',
      moneyIn: recon?.stmt_money_in ?? '',
      closing: recon?.stmt_closing ?? '',
    });
  }, [recon]);

  const monthRows = useMemo(() => {
    let list = monthAll;
    if (status === 'look') list = list.filter(isLookRow);
    else if (status === 'filed') list = list.filter(isFiledRow);
    if (sortOldest) list = [...list].reverse();
    return list;
  }, [monthAll, status, sortOldest]);

  const scopedAccount = accountsById[filters.accountId] || null;
  // One computation of the month's money, read by the panel beside the wallet and
  // by the close below it — they can't drift apart because there's nothing to drift.
  const monthFigs = useMemo(
    () => monthFigures(scopedAccount?.opening_balance, monthAll),
    [scopedAccount, monthAll],
  );
  const monthChecks = useMemo(() => statementChecks(monthFigs, statement), [monthFigs, statement]);
  const [savingStatement, setSavingStatement] = useState(false);
  const monthStat = statsByMonth[activeMonth] || { entries: 0, look: 0, filed: 0, net: 0, inSum: 0, outSum: 0 };
  const axisIdx = axis.indexOf(activeMonth);
  const totalLook = txns.filter(isLookRow).length;
  const filedPct = monthStat.entries ? Math.round((monthStat.filed / monthStat.entries) * 100) : 0;
  const monthCur = monthRows[0]?.currency;

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));

  const handleSaveStatement = async () => {
    setSavingStatement(true);
    const res = await saveStatementFigures({
      tenantId: activeTenantId, accountId: filters.accountId, periodMonth, statement,
    });
    setSavingStatement(false);
    if (res.error) { flash('Could not save those figures'); return res; }
    setRecon(res.data);
    flash('Statement figures saved');
    return res;
  };

  const handleCloseMonth = async ({ openingBalance, closingBalance, fundingDue, statement }) => {
    await saveStatementFigures({ tenantId: activeTenantId, accountId: filters.accountId, periodMonth, statement });
    const res = await closeMonth({
      tenantId: activeTenantId, accountId: filters.accountId, periodMonth,
      openingBalance, closingBalance, fundingDue,
    });
    if (res.error) { flash('Could not close the month'); return res; }
    setRecon(res.data);
    setReconTick((n) => n + 1);   // so the overview shows it balanced on the way back
    flash(`${ymLabel(activeMonth)} closed and submitted for sign-off`);
    return res;
  };
  const stepMonth = (delta) => { const i = axisIdx + delta; if (i >= 0 && i < axis.length) setActiveMonth(axis[i]); };

  // Jump to a line a month-end suggestion points at. Clears Show first, or a line
  // that's already filed would be pointed at and then not be in the list.
  const showLine = (txnId) => {
    if (!txnId) return;
    setStatus('all');
    setExpandedId(txnId);
    requestAnimationFrame(() => {
      document.getElementById(`ca-txn-${txnId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // Scan a receipt: the scanner hands back a flattened, contrast-boosted crop, which
  // is what makes the figures readable. We then only trust what was actually printed —
  // no invented VAT, no assumed exchange rate — and flag anything to eyeball.
  const handleScan = async (file) => {
    if (!file) return;
    setScanning(true);
    try {
      const r = await parseReceipt(file);
      const sug = r.merchant ? resolveSuggestion({ payee: r.merchant, description: r.summary || '' }, ruleMap) : null;
      const line = sug?.kind === 'single' ? sug.suggestion : null;
      setScanSeed({
        file,
        payee: r.merchant || '',
        note: r.summary || '',
        amount: r.total != null ? String(r.total) : '',
        txn_date: r.date || '',
        // VAT only when the receipt printed a separate tax figure — UK retail usually
        // doesn't, and inventing one would misstate a reclaim.
        vat_amount: r.vatPrinted && r.vatAmount != null ? String(r.vatAmount) : '',
        vat_rate: r.vatPrinted && r.vatRate != null ? String(r.vatRate) : '',
        currency: r.currency || '',
        category: line?.category || '',
        category_code: line?.code || '',
        // Shown in the modal so a misread is caught before it reaches the ledger.
        readAs: { total: r.totalText, date: r.dateText, confidence: r.confidence },
      });
      setScanOpen(false);
      setAddOpen(true);
      if (r.confidence === 'low' || r.total == null) flash('Check the figures — that receipt was hard to read');
      else if (!r.date) flash(`Read: ${r.merchant || 'receipt'} — no date found, set it`);
      else flash(`Read: ${r.merchant || 'receipt'}`);
    } catch {
      flash('Couldn’t read that receipt — add it manually');
    } finally {
      setScanning(false);
    }
  };

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

  // Inline date edit — the spend date decides the month, so it's editable on the row.
  const handleDateChange = async (t, value) => {
    if (!value || value === (t.txn_date || '').slice(0, 10)) return;
    // A card is used before — or on — the day the bank posts it. Later is impossible.
    if (!isSpendDateValid(value, t.statement_date)) {
      flash(`Can’t be after the bank posted it (${fmtDMY(t.statement_date)})`);
      return;
    }
    setTxns((prev) => prev.map((x) => (x.id === t.id ? { ...x, txn_date: value } : x)));
    const { error } = await updateTransactionDetail(t.id, { txn_date: value });
    if (error) { flash('Could not change the date'); await loadTxns(); return; }
    flash('Date updated');
  };

  // The spend a money-in line most likely reverses (null when there's no match).
  const refundFor = useCallback(
    (t) => (looksLikeRefund(t) ? findRefundCandidate(t, txns, normalizeMerchant) : null),
    [txns],
  );

  const handleLinkRefund = async (refund, original) => {
    const res = await linkRefund(refund.id, original);
    if (res.error) { flash('Could not link that refund'); return; }
    setTxns((prev) => prev.map((x) => (x.id === refund.id ? { ...x, ...(res.data || {}) } : x)));
    flash(`Linked as a refund of ${original.category || original.description || 'that spend'}`);
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
    if (res.error) { flash('Could not attach that receipt'); return res; }
    if (res.data) {
      const { data: atts } = await listAttachments([txnId]);
      setAttByTxn((prev) => ({ ...prev, [txnId]: atts || [] }));
      // A receipt supersedes any "no receipt" declaration — the excuse is now moot.
      const t = txns.find((x) => x.id === txnId);
      if (t?.receipt_waived) await handleWaiveReceipt(txnId, null, { quiet: true });
      flash('Receipt attached');
    }
    return res;
  };

  // The other way a line gets its evidence: a stated reason there'll never be a
  // receipt. Passing null clears it again. Patched in place — no reload.
  const handleWaiveReceipt = async (txnId, reason, { quiet = false } = {}) => {
    const detail = receiptWaiverPatch(reason);
    const res = await updateTransactionDetail(txnId, detail);
    if (res.error) { flash('Could not save that'); return res; }
    setTxns((prev) => prev.map((x) => (x.id === txnId ? { ...x, ...detail } : x)));
    if (!quiet) flash(reason ? 'Noted — no receipt for this line' : 'Receipt still needed');
    return res;
  };

  // Photographing a receipt for a line that already exists: the scanner flattens
  // the shot exactly as it does for a new line, we just file it instead of reading it.
  const handlePhotoAttach = async (file) => {
    if (!photoFor || !file) return;
    setAttaching(true);
    const res = await handleReceiptFor(photoFor, file);
    setAttaching(false);
    if (!res?.error) setPhotoFor(null);
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
    const blocked = voidBlockedReason(t);
    if (blocked) { flash(blocked); return; }
    if (!window.confirm('Void this transaction? It will no longer affect any balance.')) return;
    const { error } = await voidTransaction(t.id);
    if (!error) { await Promise.all([loadTxns(), loadAccounts()]); flash('Transaction voided'); }
    else flash('Could not void — please try again');
  };

  // Where the line came from, as a sentence rather than a row of badges: "raised
  // against a supplier invoice". Only rendered when the line actually carries one.
  const renderLinks = (t) => {
    const links = TAGS.filter((tag) => t[tag.key]);
    if (!links.length) return null;
    return (
      <div className="ca-links">
        <span className="ca-links-l">raised against</span>
        {links.map((tag, i) => (
          <React.Fragment key={tag.key}>
            {i > 0 && <span className="ca-links-sep">·</span>}
            <button type="button" className="ca-link" onClick={() => navigate(tag.path(t))}>
              {tag.label}
            </button>
          </React.Fragment>
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
    const ctx = { account: acct, hasReceipt: atts.length > 0, splitCount: rowSplits.length };
    const state = voided ? 'void' : lineState(t, ctx);
    const outstanding = voided ? '' : outstandingText(t, ctx);
    return (
      <React.Fragment key={t.id}>
      <div id={`ca-txn-${t.id}`}
        className={`ca-txn is-${state}${voided ? ' is-void' : ''}${open ? ' is-open' : ''}`}>
        <button type="button" className={`ca-exp-btn${open ? ' is-open' : ''}`}
          aria-expanded={open} aria-label={open ? 'Hide detail' : 'Show detail'}
          onClick={() => setExpandedId(open ? null : t.id)}>
          <Icon name="ChevronRight" size={15} />
        </button>
        <span className="ca-dates">
          {/* Click the spend date to change it. Shown as dd/mm/yyyy text rather than a
              native date input, which renders in the browser's own locale and clips. */}
          {editDateId === t.id ? (
            <input type="date" className="ca-dedit" autoFocus
              max={maxSpendDate(t) || undefined}
              defaultValue={(t.txn_date || '').slice(0, 10)}
              onBlur={(e) => { handleDateChange(t, e.target.value); setEditDateId(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditDateId(null); }} />
          ) : canEdit && !voided ? (
            <button type="button" className="ca-d1 ca-dbtn" title="Change the date spent"
              onClick={() => setEditDateId(t.id)}>{fmtDMY(t.txn_date)}</button>
          ) : (
            <span className="ca-d1">{fmtDMY(t.txn_date)}</span>
          )}
          {/* The posted date sits under the spend date. Amber when the two fall in
              different months — the case that moves a cost between periods. */}
          <span className={`ca-d2${straddlesMonth(t) ? ' is-straddle' : ''}${datesDiffer(t) ? ' is-diff' : ''}`}
            title={t.statement_date
              ? `Spent ${fmtDMY(t.txn_date)} · posted to the statement ${fmtDMY(t.statement_date)}`
              : 'The feed gave no statement date'}>
            {t.statement_date ? fmtDMY(t.statement_date) : '—'}
          </span>
        </span>
        <div className="ca-txn-desc">
          <div className="ca-txn-title">{t.description || SOURCE_LABEL[t.source] || 'Transaction'}</div>
          <div className="ca-txn-cat">
            {t.category ? <span className="ca-txn-filed">✓ {t.category_code ? `${t.category_code} · ` : ''}{t.category}</span> : null}
            {t.category ? ' · ' : ''}{SOURCE_LABEL[t.source] || t.source}
            {t.note ? <span className="ca-txn-note"> · {t.note}</span> : null}
            {voided ? ' · voided' : ''}
          </div>
          {/* A money-in bank line from a merchant we've paid is almost certainly a
              refund — link it so the same budget line nets down, not income. */}
          {!voided && canEdit && refundFor(t) && (
            <div className="ca-refund">
              <span className="ca-refund-l">Refund of</span>
              <button type="button" className="ca-refund-btn" onClick={() => handleLinkRefund(t, refundFor(t))}>
                {formatMoney(refundFor(t).amount, refundFor(t).currency)} · {refundFor(t).description || refundFor(t).payee} · {fmtDMY(refundFor(t).txn_date)}
              </button>
            </div>
          )}
          {t.refund_of_id && (
            <div className="ca-refund is-done">
              <span className="ca-refund-l">✓ Refund</span>
              <span className="ca-refund-of">nets off the original spend</span>
            </div>
          )}
          {look && !voided && canEdit && rowSplits.length === 0 && !looksLikeRefund(t) && renderSuggest(t)}
          {/* Inline split breakdown — a split line shows its parts, the same way an
              unsplit line shows its single category. */}
          {rowSplits.length > 0 && (
            <div className="ca-splitline">
              {rowSplits.map((sp) => (
                <span key={sp.id} className="ca-splitpart">
                  <b>{formatMoney(Math.abs(sp.amount), t.currency)}</b>
                  {sp.category_code ? ` ${sp.category_code} · ` : ' '}{sp.category}
                </span>
              ))}
            </div>
          )}
          {/* What's outstanding, in words. A row of anonymous ticks couldn't say what
              was actually needed — you had to hover to find out — so this states it
              as ordinary muted text alongside the category and source. */}
          {!voided && (outstanding || t.is_pending || straddlesMonth(t) || alloc) && (
            <div className="ca-state">
              {outstanding && <span className="ca-needs">{outstanding}</span>}
              {t.is_pending && <span className="ca-pend" title="Card authorisation not settled">pending</span>}
              {straddlesMonth(t) && (
                <span className="ca-straddle" title={`Spent ${fmtDMY(t.txn_date)} but posted ${fmtDMY(t.statement_date)} — different months`}>crosses month</span>
              )}
              {alloc && <span className={`ca-allocx${alloc === 'charter' ? ' is-charter' : ''}`}>{alloc === 'charter' ? 'charter · APA' : 'owner'}</span>}
            </div>
          )}
          {renderLinks(t)}
        </div>
        <span className={`ca-txn-acct${!t.account_id ? ' is-unassigned' : ''}`}>
          {acct ? accountLabel(acct, { withCurrency: false }) : 'Unassigned'}
        </span>
        <span className="ca-txn-amt">
          <b className={t.amount < 0 ? 'ca-neg' : 'ca-pos'}>{formatMoney(t.amount, t.currency, { signed: true })}</b>
          {t.running != null && !voided && (
            <span className="ca-txn-run">bal {formatMoney(t.running, accountsById[filters.accountId]?.currency || t.currency)}</span>
          )}
        </span>
        <span className="ca-txn-act">
          {/* Receipt, or the reason there isn't one — both behind the clip, so a line
              can be finished without opening the detail panel. */}
          {!voided && (
            <ReceiptClip txn={t} attachments={atts} canEdit={canEdit}
              onPhotograph={(txn) => setPhotoFor(txn.id)}
              onUpload={handleReceiptFor}
              onWaive={handleWaiveReceipt}
              onDeleteAttachment={handleDeleteAttachment} />
          )}
          {!t.account_id && !voided && canEdit && (
            <button type="button" className="ca-link" onClick={() => setAssignTxn(t)}>Assign →</button>
          )}
          {/* Only lines Cargo created can be voided — a bank line's money really
              moved, so a reversal has to arrive as its own refund. */}
          {canEdit && canVoidTxn(t) && (
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
          meId={meId}
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
            {/* The month scopes this whole page — the figures, the close, the list
                — so it steps from the top rather than from the middle of the card
                row. And the running totals say WHICH months they count: unlabelled,
                356/328 sat directly above 106/101 as the same kind of number at a
                scope nothing on screen declared. */}
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Spending</span>
              <span className="bar" />
              <span className="ca-mstep">
                <button type="button" onClick={() => stepMonth(-1)} disabled={axisIdx <= 0} aria-label="Previous month">
                  <Icon name="ChevronLeft" size={14} />
                </button>
                <b>{ymLabel(activeMonth)}</b>
                <button type="button" onClick={() => stepMonth(1)} disabled={axisIdx >= axis.length - 1} aria-label="Next month">
                  <Icon name="ChevronRight" size={14} />
                </button>
              </span>
              {totalLook > 0 && (
                <><span className="bar" />
                <span className="muted">{totalLook} to sort across all months</span></>
              )}
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Money <em>in &amp; out</em>.</h1>
              <div className="ca-head-act">
                {canEdit && (
                  <>
                    <button type="button" className="ca-btn ca-btn-ghost" onClick={() => setScanOpen(true)}
                      title="Photograph a receipt, flatten it, and let Cargo read it">
                      <Icon name="Camera" size={15} /> Scan receipt
                    </button>
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

          {/* The vessel's cards for this month. Choosing one scopes everything
              below — the month's figures and its close are per card, because each
              card is balanced against its own statement. */}
          <AccountStack
            accounts={stackAccounts}
            activeId={filters.accountId}
            monthKey={activeMonth}
            reconFor={(id) => monthRecons.find((r) => r.account_id === id)}
            unassigned={stackStats['']?.count || 0}
            unassignedOn={filters.accountId === UNASSIGNED}
            onShowUnassigned={() => setF({
              accountId: filters.accountId === UNASSIGNED ? '' : UNASSIGNED,
            })}
            onSelect={(id) => { setF({ accountId: id }); setFiltersOpen(false); }}
            figures={(
              <MonthMoney
                currency={monthCur}
                scoped={Boolean(scopedAccount)}
                figures={monthFigs}
                monthStat={monthStat}
                statement={statement}
                checks={monthChecks}
                canEdit={canEdit}
                locked={(recon?.status || 'open') !== 'open'}
                busy={savingStatement}
                onField={(k, v) => setStatement((p) => ({ ...p, [k]: v }))}
                onSave={handleSaveStatement}
              />
            )}
          />

          {/* Month-end close — per account, so only once one is filtered. Fed the
              whole month rather than the visible rows: a close computed over a
              "needs a look" filter would balance against a partial month. */}
          {filters.accountId && accountsById[filters.accountId] && (
            <MonthEndStrip
              account={accountsById[filters.accountId]}
              monthLabel={ymLabel(activeMonth)}
              monthKey={activeMonth}
              txns={monthAll}
              allTxns={txns}
              reconciliation={recon}
              figures={monthFigs}
              statement={statement}
              hasReceipt={(t) => hasEvidence(t, (attByTxn[t.id] || []).length > 0)}
              splitCount={(t) => (splitsByTxn[t.id] || []).length}
              canEdit={canEdit}
              onClose={handleCloseMonth}
              onShowLine={showLine}
            />
          )}

          {/* toolbar: search · filters · sort. Which rows to show is a filter like
              any other, so it lives in the Filters panel rather than as its own
              switch competing with the month for the top of the page. */}
          <div className="ca-toolbar">
            {/* How much of the month is categorised is a fact about THIS LIST, not
                a fourth money figure — it was sat in the band beside money out, in
                and net, which is why it read as stranded there. It belongs to the
                count of the thing you're about to work through.
                The month is the stepper's job and the close bar says it in a
                sentence between the two, so no third "JULY 2026" here. */}
            <p className="ca-toolbar-lab">
              <span>
                {monthRows.length < monthStat.entries
                  ? `${monthRows.length} of ${monthStat.entries} lines`
                  : `${monthStat.entries} ${monthStat.entries === 1 ? 'line' : 'lines'}`}
              </span>
              {monthStat.entries > 0 && (
                <>
                  <span className="ca-tl-meter" title={`${monthStat.filed} of ${monthStat.entries} filed`}>
                    <i style={{ width: `${filedPct}%` }} />
                  </span>
                  <span className="ca-tl-prog">
                    {filedPct}% categorised
                    {monthStat.look > 0 && ` · ${monthStat.look} to go`}
                  </span>
                </>
              )}
            </p>
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
                  <div className="ca-fp-row">
                    <span>Show</span>
                    <div className="ca-fp-seg">
                      {[['all', 'All', monthStat.entries], ['look', 'Needs a look', monthStat.look],
                        ['filed', 'Filed', monthStat.filed]].map(([k, lbl, n]) => (
                          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
                            {lbl} <em>{n}</em>
                          </button>
                      ))}
                    </div>
                  </div>
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
                  {/* Which date decides the month: when it was spent (management
                      accounts) or when the bank posted it (tying to a statement). */}
                  <div className="ca-fp-row">
                    <span>Month by</span>
                    <div className="ca-fp-seg">
                      {[['spend', 'Date spent'], ['statement', 'Date on statement']].map(([k, lbl]) => (
                        <button key={k} type="button" aria-pressed={dateBasis === k}
                          onClick={() => setDateBasis(k)}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {activeFilterCount > 0 && (
                    <button type="button" className="ca-fp-clear"
                      onClick={() => { setF({ accountId: '', source: '', category: '' }); setStatus('all'); }}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="ca-toolbtn" onClick={() => setSortOldest((v) => !v)} title="Sort by date">
              <Icon name={sortOldest ? 'ArrowUpNarrowWide' : 'ArrowDownWideNarrow'} size={14} /> {sortOldest ? 'Oldest' : 'Newest'}
            </button>
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
            <>
            <div className="ca-txnhead" aria-hidden="true">
              <span />
              <span>Spent / posted</span>
              <span>Detail</span>
              <span className="h-acct">Account</span>
              <span className="r">Amount</span>
              <span className="r">Actions</span>
            </div>
            <div className="ca-cat" style={{ marginTop: 0 }}>
              {monthRows.map(renderRow)}
            </div>
            </>
          )}
        </div>

        {toast && <div className="ca-toast">{toast}</div>}
      </div>

      <ManualTxnModal open={addOpen} onClose={() => { setAddOpen(false); setScanSeed(null); }}
        onSave={handleAdd} onUploadReceipt={handleUploadReceipt} accounts={accounts} tenantId={activeTenantId}
        seed={scanSeed} crew={crew} trips={trips} chartGroups={pickerGroups} />
      <AssignAccountModal open={Boolean(assignTxn)} onClose={() => setAssignTxn(null)} onAssign={handleAssign}
        txn={assignTxn} accounts={accounts} me={me} />
      <StatementReconcileModal open={importOpen} onClose={() => setImportOpen(false)} accounts={accounts} tenantId={activeTenantId}
        onDone={() => { flash('Statement reconciled'); loadTxns(); }} />
      <ReceiptScanner open={scanOpen} busy={scanning}
        onClose={() => { if (!scanning) setScanOpen(false); }} onScan={handleScan} />
      {/* Same scanner, filing rather than reading — opened from a row's clip. */}
      <ReceiptScanner open={Boolean(photoFor)} busy={attaching}
        heading="Photograph the receipt" cta="Attach it" busyCta="Attaching…"
        onClose={() => { if (!attaching) setPhotoFor(null); }} onScan={handlePhotoAttach} />
      {picker && (
        <CategoryPicker anchorRect={picker.rect} groups={pickerGroups}
          onPick={pickCategory} onClose={() => setPicker(null)} />
      )}
    </AccountsShell>
  );
}
