// Cargo Accounts — Budget detail / budget-vs-actual (/accounts/budgets/:id).
// Two-level editorial table: buckets -> breakdown lines, each with Budgeted / Actual
// / Committed / Remaining and a % meter. Actual is live from the Phase 0 ledger,
// Committed from open supplier orders. COMMAND edits lines.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useAuth } from '../../../contexts/AuthContext';
import { getBudgetVsActual, getBudgetMonthly, updateBudget, closeBudget, upsertLine, deleteLine, seedStandardTemplate, updateLineAmount, updateLineMonthly, setCategoryOverride } from '../../../services/budgetService';
import { formatMoney } from '../../../services/financeCalc';
import { stateOf } from '../../../services/budgetCalc';
import BudgetFormModal from './components/BudgetFormModal';
import LineFormModal from './components/LineFormModal';
import AssignMenu from './components/AssignMenu';
import BudgetOverview from './components/BudgetOverview';
import { computeOverview } from '../../../services/budgetOverview';
import { STANDARD_CHART_OF_ACCOUNTS, STANDARD_BUCKET_ORDER } from './data/mybaChartOfAccounts';
import { exportBudgetXlsx, exportBudgetMonthlyXlsx } from './budgetExport';
import './budgets.css';

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const STATUS_PILL = { draft: 'bg-pill-draft', active: 'bg-pill-active', closed: 'bg-pill-closed' };
const DEFAULT_BUCKETS = ['Provisioning', 'Maintenance', 'Berthing', 'Fuel', 'Crew', 'Admin', 'Interior', 'Deck', 'Engineering'];
const r2 = (n) => Math.round(n * 100) / 100;
const metricsFor = (budgeted, actual, committed) => {
  const spent = actual + committed;
  return { budgeted, actual, committed, remaining: r2(budgeted - spent), pct: budgeted > 0 ? spent / budgeted : null, state: stateOf(budgeted, spent) };
};

const Meter = ({ pct, state, spent }) => {
  const width = pct == null ? (spent > 0 ? 100 : 0) : Math.min(100, Math.round(pct * 100));
  const label = pct == null ? (spent > 0 ? 'over' : '—') : `${Math.round(pct * 100)}%`;
  return (
    <div className="bg-meter">
      <span className="bg-meter-track"><span className={`bg-meter-fill ${state}`} style={{ width: `${width}%` }} /></span>
      <span className={`bg-meter-pct ${state === 'over' ? 'over' : ''}`}>{label}</span>
    </div>
  );
};

export default function BudgetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasCommandAccess } = useAuth();
  const canEdit = hasCommandAccess();

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);   // { budget, buckets, unbudgeted, totals }
  const [editBudget, setEditBudget] = useState(false);
  const [lineModal, setLineModal] = useState(null); // { line } or {} for new
  const [addRow, setAddRow] = useState(null);       // { bucket, kind, category, amount } inline add
  const [tab, setTab] = useState('overview');        // 'overview' | 'summary' | 'monthly'
  const [monthly, setMonthly] = useState(null);
  const [mMode, setMMode] = useState('budget');     // 'budget' | 'actual' | 'variance'
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  // Draft budget values so month cells (and the summary Budgeted column) are real,
  // tab-able inputs that persist on a debounce in the background — no per-cell save +
  // refresh. Keyed `${lineId}` (summary annual) and `${lineId}:${ym}` (monthly).
  const [drafts, setDrafts] = useState({});
  const draftsRef = useRef({});
  const saveTimers = useRef({});
  const setDraft = (key, val) => {
    draftsRef.current = { ...draftsRef.current, [key]: val };
    setDrafts(draftsRef.current);
  };

  // Debounced background persistence. scheduleSave stashes a save thunk per key and
  // fires it ~700ms after the last keystroke; flushSaves runs anything pending now
  // (called before any reload so a mid-typing edit is never lost).
  const pendingThunks = useRef({});
  const scheduleSave = (key, thunk) => {
    pendingThunks.current[key] = thunk;
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      const t = pendingThunks.current[key];
      delete pendingThunks.current[key]; delete saveTimers.current[key];
      if (t) t();
    }, 700);
  };
  const flushSaves = async () => {
    const thunks = Object.values(pendingThunks.current);
    pendingThunks.current = {};
    Object.values(saveTimers.current).forEach(clearTimeout);
    saveTimers.current = {};
    await Promise.all(thunks.map((t) => t()));
  };

  // fetchAll(true) shows the mount spinner; refresh() (spinner=false) reconciles
  // quietly after an edit so the page doesn't blank or jump. Pending draft saves are
  // flushed first, then drafts reset to the freshly-loaded server truth.
  const fetchAll = useCallback(async (spinner) => {
    if (spinner) setLoading(true);
    await flushSaves();
    const [vs, mr] = await Promise.all([getBudgetVsActual(id), getBudgetMonthly(id)]);
    if (!vs.error && vs.data) setView(vs.data);
    if (!mr.error && mr.data) setMonthly(mr.data);
    draftsRef.current = {}; setDrafts({});
    if (spinner) setLoading(false);
  }, [id]);
  const load = useCallback(() => fetchAll(true), [fetchAll]);
  const refresh = useCallback(() => fetchAll(false), [fetchAll]);

  useEffect(() => { load(); }, [load]);

  const budget = view?.budget;
  const cur = budget?.currency || 'EUR';

  // Current calendar month, for the Overview pace/forecast (how far through the period).
  const todayYm = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }, []);
  const overview = useMemo(() => (view && monthly ? computeOverview(view, monthly, todayYm) : null), [view, monthly, todayYm]);

  // Suggestions for the line modal: existing buckets, plus categories that already
  // carry spend (so you can quickly budget something that's already showing).
  const { bucketSuggestions, categorySuggestions } = useMemo(() => {
    const bs = new Set(DEFAULT_BUCKETS);
    const cs = new Set();
    (view?.buckets || []).forEach((b) => { bs.add(b.bucket); b.lines.forEach((l) => cs.add(l.category)); });
    (view?.unbudgeted?.lines || []).forEach((l) => cs.add(l.category));
    return { bucketSuggestions: [...bs], categorySuggestions: [...cs] };
  }, [view]);

  const saveBudget = async (patch) => {
    const res = await updateBudget(id, patch);
    if (!res.error) { await refresh(); flash('Budget updated'); }
    return res;
  };
  const saveLine = async (payload) => {
    const res = await upsertLine({ ...payload, budget_id: id });
    if (!res.error) { await refresh(); flash('Line saved'); }
    return res;
  };
  const removeLine = async (lineId) => {
    const res = await deleteLine(lineId);
    if (!res.error) { await refresh(); flash('Line deleted'); }
    return res;
  };
  const toggleClose = async () => {
    if (budget.status === 'closed') return saveBudget({ status: 'active' });
    if (!window.confirm('Close this budget? You can reopen it later.')) return;
    const res = await closeBudget(id);
    if (!res.error) { await refresh(); flash('Budget closed'); }
  };
  const loadTemplate = async () => {
    if (!window.confirm('Load the standard yacht (MYBA) chart of accounts? Existing lines are kept; standard lines are added at £0 for you to fill in.')) return;
    const res = await seedStandardTemplate(id, STANDARD_CHART_OF_ACCOUNTS);
    if (!res.error) { await refresh(); flash('Standard template loaded'); }
    else flash('Could not load template');
  };

  // Expense budget lines as dropdown options for assigning Unbudgeted spend.
  const lineOptions = useMemo(() => {
    const opts = [];
    (view?.buckets || []).forEach((b) => {
      if (b.kind === 'revenue') return;
      b.lines.forEach((l) => opts.push({ value: l.category, label: `${b.bucket} › ${l.category}`, bucket: b.bucket, code: l.code }));
    });
    return opts;
  }, [view]);

  const assignUnbudgeted = async (sourceCategory, targetValue) => {
    const opt = lineOptions.find((o) => o.value === targetValue);
    if (!opt) return;
    const res = await setCategoryOverride(budget.tenant_id, sourceCategory, { bucket: opt.bucket, category: opt.value, code: opt.code });
    if (!res.error) { await refresh(); flash('Categorised — it’ll auto-route next time'); }
    else flash('Could not save the mapping');
  };

  // Revenue sections first, then expenditure groups in the standard report order.
  const orderedBuckets = useMemo(() => {
    const list = [...(view?.buckets || [])];
    const rank = (b) => {
      if (b.kind === 'revenue') return -1;
      const i = STANDARD_BUCKET_ORDER.indexOf(b.bucket);
      return i === -1 ? 999 : i;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }, [view]);

  // Live (draft-aware) subtotals + grand totals for the summary view.
  const effBucketSubtotal = (b) => {
    let bud = 0; let act = 0; let com = 0;
    b.lines.forEach((l) => { bud += effAnnual(l); act += l.actual; com += l.committed; });
    return metricsFor(r2(bud), r2(act), r2(com));
  };
  const summaryTotals = () => {
    let eBud = 0; let eAct = 0; let eCom = 0; let rBud = 0; let rAct = 0; let rCom = 0;
    orderedBuckets.forEach((b) => b.lines.forEach((l) => {
      if (b.kind === 'revenue') { rBud += effAnnual(l); rAct += l.actual; rCom += l.committed; }
      else { eBud += effAnnual(l); eAct += l.actual; eCom += l.committed; }
    }));
    (view?.unbudgeted?.lines || []).forEach((l) => { eAct += l.actual; eCom += l.committed; });
    return {
      totals: metricsFor(r2(eBud), r2(eAct), r2(eCom)),
      revenueTotals: metricsFor(r2(rBud), r2(rAct), r2(rCom)),
      net: { budgeted: r2(rBud - eBud), actual: r2(rAct - eAct) },
    };
  };

  // Effective (draft-aware) budget values, so inputs and totals stay live while you
  // tab through — the save happens quietly on a debounce, no refresh.
  const effAnnual = (line) => { const d = draftsRef.current[line.id]; return d !== undefined ? (Number(d) || 0) : Number(line.budgeted || 0); };
  const effMonth = (line, ym) => { const d = draftsRef.current[`${line.id}:${ym}`]; return d !== undefined ? (Number(d) || 0) : Number((line.budgetByMonth && line.budgetByMonth[ym]) || 0); };
  const persistAnnual = (line) => updateLineAmount(line.id, effAnnual(line));
  const persistMonthly = (line, months) => {
    const map = {};
    months.forEach((m) => { const v = effMonth(line, m.ym); if (v) map[m.ym] = v; });
    return updateLineMonthly(line.id, map);
  };
  const editAnnual = (line, val) => { setDraft(line.id, val); scheduleSave(line.id, () => persistAnnual(line)); };
  const editMonth = (line, ym, val, months) => { setDraft(`${line.id}:${ym}`, val); scheduleSave(`${line.id}:${ym}`, () => persistMonthly(line, months)); };

  const commitAdd = async () => {
    if (!addRow || !addRow.category.trim()) { setAddRow(null); return; }
    const res = await upsertLine({
      budget_id: id, bucket: addRow.bucket, kind: addRow.kind,
      category: addRow.category.trim(), amount: Number(addRow.amount) || 0,
    });
    if (!res.error) { await refresh(); flash('Line added'); setAddRow({ ...addRow, category: '', amount: '' }); }
    else { flash(/duplicate|unique/i.test(res.error.message || '') ? 'That line already exists' : 'Could not add line'); }
  };

  const openFullEdit = (row) => setLineModal({ line: {
    id: row.id, bucket: row.bucket, category: row.category, code: row.code,
    kind: row.kind, amount: row.budgeted, notes: row.note,
  } });

  const renderRow = (row, key) => {
    const m = row.id ? metricsFor(effAnnual(row), row.actual, row.committed) : row;
    const spent = m.actual + m.committed;
    const draftKey = row.id;
    const val = draftKey != null && drafts[draftKey] !== undefined ? drafts[draftKey] : (row.budgeted ? String(row.budgeted) : '');
    return (
      <div key={key} className={`bg-row${m.state === 'over' && row.kind !== 'revenue' ? ' is-over' : ''}`}>
        <div className="bg-row-cat">
          <b>{row.code ? <span className="bg-code">{row.code}</span> : null}{row.category}</b>
          {row.note ? <div className="bg-row-note">{row.note}</div> : null}
        </div>
        {canEdit && row.id ? (
          <input
            className="bg-cellinput bg-num" type="number" step="0.01" min="0" inputMode="decimal"
            value={val} placeholder="0"
            onChange={(e) => editAnnual(row, e.target.value)}
            onBlur={() => scheduleSave(row.id, () => persistAnnual(row))}
          />
        ) : (
          <span className="bg-fig">{formatMoney(m.budgeted, cur)}</span>
        )}
        <span className="bg-fig c-actual">{formatMoney(m.actual, cur)}</span>
        <span className="bg-fig c-committed">{formatMoney(m.committed, cur)}</span>
        <span className={`bg-fig c-remaining${m.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(m.remaining, cur)}</span>
        <Meter pct={m.pct} state={m.state} spent={spent} />
        <span className="bg-row-act">
          {canEdit && row.id && (
            <button type="button" className="bg-icon-btn" onClick={() => openFullEdit(row)} aria-label="Edit line" title="Edit code, comment, delete">
              <Icon name="Pencil" size={13} color="#CFCABF" />
            </button>
          )}
        </span>
      </div>
    );
  };

  const renderAddRow = (bucket, kind) => {
    if (!canEdit) return null;
    const active = addRow?.bucket === bucket;
    if (!active) {
      return (
        <button type="button" className="bg-addline-btn" onClick={() => setAddRow({ bucket, kind, category: '', amount: '' })}>
          <Icon name="Plus" size={14} /> Add line to {bucket}
        </button>
      );
    }
    return (
      <div className="bg-addrow">
        <input className="bg-inline-input" autoFocus placeholder="New breakdown line…" value={addRow.category}
          onChange={(e) => setAddRow({ ...addRow, category: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAddRow(null); }} />
        <input className="bg-inline-input bg-num" type="number" step="0.01" min="0" placeholder="0.00" value={addRow.amount}
          onChange={(e) => setAddRow({ ...addRow, amount: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') setAddRow(null); }} />
        <button type="button" className="bg-btn bg-btn-primary bg-btn-sm" onClick={commitAdd}>Add</button>
        <button type="button" className="bg-link is-mut" onClick={() => setAddRow(null)}>Done</button>
      </div>
    );
  };

  // The "Needs a category" review list — rendered at the TOP of the budget so it
  // reads as the to-do it is.
  const renderNeedsCategory = () => (
    <div className="bg-bucket">
      <div className="bg-bucket-head">
        <span className="bg-bucket-name">Needs a category</span>
        <span className="bg-bucket-rule" />
        <span className="bg-bucket-meta">{view.unbudgeted.lines.length} to review · assign a line</span>
      </div>
      <div className="bg-cols">
        <span>Line</span><span className="r">Budgeted</span><span className="r c-actual">Actual</span>
        <span className="r c-committed">On order</span><span className="r c-remaining">Remaining</span><span>Assign to</span><span />
      </div>
      {view.unbudgeted.lines.map((l, i) => (
        <div key={`u-${i}`} className="bg-row bg-review">
          <div className="bg-row-cat">
            <b>{l.category}</b>
            <div className="bg-row-note">Unrecognised — pick the budget line it belongs to</div>
          </div>
          <span className="bg-fig muted">—</span>
          <span className="bg-fig c-actual">{formatMoney(l.actual, cur)}</span>
          <span className="bg-fig c-committed">{formatMoney(l.committed, cur)}</span>
          <span className="bg-fig c-remaining bg-neg">{formatMoney(l.remaining, cur)}</span>
          {canEdit ? (
            <AssignMenu
              options={lineOptions}
              onSelect={(v) => assignUnbudgeted(l.category, v)}
              onNew={() => setLineModal({ line: { bucket: '', category: l.category, amount: 0 } })}
            />
          ) : <span className="bg-fig muted">review</span>}
          <span />
        </div>
      ))}
    </div>
  );

  // ── Month-by-month view ────────────────────────────────────────────────────
  const mfmt = (v) => (v ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(v) : '—');
  const rankBucket = (b) => (b.kind === 'revenue' ? -1 : (STANDARD_BUCKET_ORDER.indexOf(b.bucket) === -1 ? 999 : STANDARD_BUCKET_ORDER.indexOf(b.bucket)));

  const minusRow = (a, b, months) => Object.fromEntries(months.map((m) => [m.ym, Math.round(((a[m.ym] || 0) - (b[m.ym] || 0)) * 100) / 100]));

  const spreadEvenly = async (line, months) => {
    const per = Math.round((Number(line.annual || 0) / months.length) * 100) / 100;
    if (!per) { flash('Set an annual amount first, then spread'); return; }
    const map = Object.fromEntries(months.map((m) => [m.ym, per]));
    const res = await updateLineMonthly(line.id, map);
    if (!res.error) { await refresh(); flash('Spread evenly across the period'); }
  };

  const renderMonthly = () => {
    if (!monthly) return <div className="bg-empty" style={{ marginTop: 20 }}><p>Loading…</p></div>;
    const M = monthly.months || [];
    if (!M.length) return <div className="bg-empty" style={{ marginTop: 20 }}><p>Set a valid period to see the month-by-month view.</p></div>;
    const mBuckets = [...(monthly.buckets || [])].sort((a, b) => rankBucket(a) - rankBucket(b));
    const editable = mMode === 'budget' && canEdit;

    // Draft-aware budget matrices, so per-month totals stay live as you tab/type.
    const budRowOf = (lines) => Object.fromEntries(M.map((m) => [m.ym, r2(lines.reduce((s, l) => s + effMonth(l, m.ym), 0))]));
    const budTotOf = (lines) => r2(lines.reduce((s, l) => s + M.reduce((ss, m) => ss + effMonth(l, m.ym), 0), 0));
    const expLines = mBuckets.filter((b) => b.kind !== 'revenue').flatMap((b) => b.lines);
    const revLines = mBuckets.filter((b) => b.kind === 'revenue').flatMap((b) => b.lines);
    const budExpRow = budRowOf(expLines); const budRevRow = budRowOf(revLines);
    const budNetRow = Object.fromEntries(M.map((m) => [m.ym, r2((budRevRow[m.ym] || 0) - (budExpRow[m.ym] || 0))]));

    // Pick the matrix for the active mode.
    const lineRow = (l) => mMode === 'actual' ? l.byMonth : mMode === 'budget' ? budRowOf([l]) : minusRow(budRowOf([l]), l.byMonth, M);
    const lineTot = (l) => mMode === 'actual' ? l.total : mMode === 'budget' ? budTotOf([l]) : (budTotOf([l]) - l.total);
    const subRow = (b) => mMode === 'actual' ? b.subtotalByMonth : mMode === 'budget' ? budRowOf(b.lines) : minusRow(budRowOf(b.lines), b.subtotalByMonth, M);
    const subTot = (b) => mMode === 'actual' ? b.subtotalTotal : mMode === 'budget' ? budTotOf(b.lines) : (budTotOf(b.lines) - b.subtotalTotal);
    const expRow = mMode === 'actual' ? monthly.expenseByMonth : mMode === 'budget' ? budExpRow : minusRow(budExpRow, monthly.expenseByMonth, M);
    const revRow = mMode === 'actual' ? monthly.revenueByMonth : mMode === 'budget' ? budRevRow : minusRow(budRevRow, monthly.revenueByMonth, M);
    const netRow = mMode === 'actual' ? monthly.netByMonth : mMode === 'budget' ? budNetRow : minusRow(budNetRow, monthly.netByMonth, M);
    const expTot = mMode === 'actual' ? monthly.expenseTotal : mMode === 'budget' ? budTotOf(expLines) : (budTotOf(expLines) - monthly.expenseTotal);
    const revTot = mMode === 'actual' ? monthly.revenueTotal : mMode === 'budget' ? budTotOf(revLines) : (budTotOf(revLines) - monthly.revenueTotal);
    const netTot = mMode === 'actual' ? monthly.netTotal : mMode === 'budget' ? r2(budTotOf(revLines) - budTotOf(expLines)) : r2((budTotOf(revLines) - budTotOf(expLines)) - monthly.netTotal);

    const roCells = (byMonth) => M.map((m) => <td key={m.ym} className={`bg-mcell${byMonth[m.ym] < 0 ? ' bg-neg' : ''}`}>{mfmt(byMonth[m.ym])}</td>);
    // Budget mode: every month cell is a real, tab-able input that saves on a debounce.
    const editCells = (l) => M.map((m) => {
      const key = `${l.id}:${m.ym}`;
      const val = drafts[key] !== undefined ? drafts[key] : (l.budgetByMonth[m.ym] ? String(l.budgetByMonth[m.ym]) : '');
      return (
        <td key={m.ym} className="bg-mcell">
          <input className="bg-minput" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0"
            value={val}
            onChange={(e) => editMonth(l, m.ym, e.target.value, M)}
            onBlur={() => scheduleSave(key, () => persistMonthly(l, M))} />
        </td>
      );
    });
    const totalCell = (v) => <td className={`bg-mcell bg-mcum${v < 0 ? ' bg-neg' : ''}`}>{mfmt(v)}</td>;

    return (
      <>
        <div className="bg-mbar">
          <div className="bg-tabs">
            <button type="button" className={`bg-tab${mMode === 'budget' ? ' is-active' : ''}`} onClick={() => setMMode('budget')}>Budget</button>
            <button type="button" className={`bg-tab${mMode === 'actual' ? ' is-active' : ''}`} onClick={() => setMMode('actual')}>Actual</button>
            <button type="button" className={`bg-tab${mMode === 'variance' ? ' is-active' : ''}`} onClick={() => setMMode('variance')}>Variance</button>
          </div>
          <span className="bg-mbar-note">
            {mMode === 'budget' ? (editable ? 'Click a month to set its target — plan seasonally (nil off-season, top-ups through the year).' : 'Per-month budget targets.')
              : mMode === 'actual' ? 'Actual spend per month, live from the ledger.'
              : 'Budget − actual. Terracotta = over budget that month.'}
          </span>
        </div>
        <div className="bg-mwrap">
          <table className="bg-mtable">
            <thead>
              <tr>
                <th className="bg-mcode">Code</th><th className="bg-mline">Line</th>
                {M.map((m) => <th key={m.ym} className="bg-mcell">{m.label}</th>)}
                <th className="bg-mcell bg-mcum">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {mBuckets.map((b) => (
                <React.Fragment key={b.bucket}>
                  <tr className="bg-msection"><td colSpan={M.length + 3}>{b.bucket}</td></tr>
                  {b.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="bg-mcode">{l.code || ''}</td>
                      <td className="bg-mline">
                        {l.category}
                        {editable && <button type="button" className="bg-spread" title="Spread the annual amount evenly across the period" onClick={() => spreadEvenly(l, M)}>spread</button>}
                      </td>
                      {editable ? editCells(l) : roCells(lineRow(l))}
                      {totalCell(lineTot(l))}
                    </tr>
                  ))}
                  <tr className="bg-msubtotal">
                    <td className="bg-mcode" /><td className="bg-mline">Total {b.bucket}</td>
                    {roCells(subRow(b))}{totalCell(subTot(b))}
                  </tr>
                </React.Fragment>
              ))}
              {monthly.other && mMode !== 'budget' && (
                <React.Fragment>
                  <tr className="bg-msection"><td colSpan={M.length + 3}>Other (uncategorised)</td></tr>
                  {monthly.other.lines.map((l, i) => (
                    <tr key={`o-${i}`}><td className="bg-mcode" /><td className="bg-mline">{l.category}</td>{roCells(mMode === 'variance' ? minusRow({}, l.byMonth, M) : l.byMonth)}{totalCell(mMode === 'variance' ? -l.total : l.total)}</tr>
                  ))}
                </React.Fragment>
              )}
              {(revTot !== 0 || monthly.budgetRevenueTotal !== 0) && (
                <tr className="bg-mgrand"><td className="bg-mcode" /><td className="bg-mline">Total revenue</td>{roCells(revRow)}{totalCell(revTot)}</tr>
              )}
              <tr className="bg-mgrand"><td className="bg-mcode" /><td className="bg-mline">Total expenditure</td>{roCells(expRow)}{totalCell(expTot)}</tr>
              {(revTot !== 0 || monthly.budgetRevenueTotal !== 0) && (
                <tr className="bg-mgrand bg-mnet"><td className="bg-mcode" /><td className="bg-mline">Net revenue (expenditure)</td>{roCells(netRow)}{totalCell(netTot)}</tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const sT = view ? summaryTotals() : { totals: {}, revenueTotals: {}, net: {} };
  const hasRevenue = (sT.revenueTotals.budgeted || 0) > 0 || (sT.revenueTotals.actual || 0) > 0;
  const kpiUsed = r2((sT.totals.actual || 0) + (sT.totals.committed || 0));
  const kpiPct = (sT.totals.budgeted || 0) > 0 ? kpiUsed / sT.totals.budgeted : null;
  const kpiState = stateOf(sT.totals.budgeted || 0, kpiUsed);

  return (
    <>
      <Header />
      <div className="bg-page">
        <div className="bg-wrap">
          <button type="button" className="bg-back" onClick={() => navigate('/accounts/budgets')}>
            <Icon name="ChevronLeft" size={16} /> Back to Budgets
          </button>

          {loading ? (
            <div className="bg-empty"><p>Loading…</p></div>
          ) : !budget ? (
            <div className="bg-empty"><Icon name="AlertCircle" size={40} /><p>Budget not found</p></div>
          ) : (
            <>
              <div className="bg-head">
                <p className="editorial-meta">
                  <span className="dot">●</span><span>Budget</span>
                  <span className="bar" />
                  <span className="muted">{fmtDMY(budget.period_start)} – {fmtDMY(budget.period_end)}</span>
                  <span className="bar" />
                  <span className="muted"><span className={`bg-pill ${STATUS_PILL[budget.status]}`}>{budget.status}</span></span>
                </p>
                <div className="bg-titlerow">
                  <h1 className="bg-title">{budget.name}</h1>
                  <div className="bg-head-act">
                    <button type="button" className="bg-btn bg-btn-ghost" onClick={() => (tab === 'monthly' && monthly ? exportBudgetMonthlyXlsx(monthly) : exportBudgetXlsx(view))}>
                      <Icon name="Download" size={15} /> Export
                    </button>
                    {canEdit && (
                      <>
                        <button type="button" className="bg-btn bg-btn-ghost" onClick={toggleClose}>
                          {budget.status === 'closed' ? 'Reopen' : 'Close'}
                        </button>
                        <button type="button" className="bg-btn bg-btn-ghost" onClick={() => setEditBudget(true)}>
                          <Icon name="Pencil" size={15} /> Edit
                        </button>
                        <button type="button" className="bg-btn bg-btn-primary" onClick={() => setLineModal({ line: null })}>
                          <Icon name="Plus" size={16} /> Add line
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-kpis">
                <div className={`bg-kpi bg-kpi-hero is-${kpiState}`}>
                  <span className="bg-kpi-label">Budget used</span>
                  <div className="bg-kpi-herorow">
                    <b className="bg-kpi-big">{kpiPct == null ? '—' : `${Math.round(kpiPct * 100)}%`}</b>
                    <span className={`bg-kpi-tag is-${sT.totals.remaining < 0 ? 'over' : 'ok'}`}>
                      {sT.totals.remaining < 0 ? `${formatMoney(-sT.totals.remaining, cur)} over` : `${formatMoney(sT.totals.remaining, cur)} left`}
                    </span>
                  </div>
                  <div className="bg-kpi-meter">
                    <span className={`bg-kpi-fill is-${kpiState}`} style={{ width: `${kpiPct == null ? 0 : Math.min(100, Math.round(kpiPct * 100))}%` }} />
                    {overview && overview.elapsed > 0 && overview.elapsed < overview.months.length && (
                      <span className="bg-kpi-pace" style={{ left: `${Math.min(100, Math.round(overview.pctYear * 100))}%` }} title="How far through the period" />
                    )}
                  </div>
                  <span className="bg-kpi-sub">{formatMoney(kpiUsed, cur)} of {formatMoney(sT.totals.budgeted, cur)}{sT.totals.committed ? ` · incl. ${formatMoney(sT.totals.committed, cur)} on order` : ''}{overview && overview.pctYear > 0 && overview.pctYear < 1 ? ` · ${Math.round(overview.pctYear * 100)}% of the period gone` : ''}</span>
                </div>
                <div className="bg-kpi" title="Actual spend, live from the ledger"><span className="bg-kpi-label">Spent</span><b className="bg-kpi-fig">{formatMoney(sT.totals.actual, cur)}</b></div>
                <div className="bg-kpi" title="Open supplier orders (not yet paid)"><span className="bg-kpi-label">On order</span><b className="bg-kpi-fig">{formatMoney(sT.totals.committed, cur)}</b></div>
                <div className="bg-kpi" title="Budget − spent − on order"><span className="bg-kpi-label">Remaining</span><b className={`bg-kpi-fig ${sT.totals.remaining < 0 ? 'bg-neg' : 'bg-pos'}`}>{formatMoney(sT.totals.remaining, cur)}</b></div>
                {hasRevenue && <div className="bg-kpi" title="Charter income, live from the ledger"><span className="bg-kpi-label">Revenue</span><b className="bg-kpi-fig bg-pos">{formatMoney(sT.revenueTotals.actual, cur)}</b></div>}
                {hasRevenue && <div className="bg-kpi" title="Revenue − expenditure"><span className="bg-kpi-label">Net rev. (exp.)</span><b className={`bg-kpi-fig ${sT.net.actual < 0 ? 'bg-neg' : 'bg-pos'}`}>{formatMoney(sT.net.actual, cur)}</b></div>}
              </div>
              <p className="bg-report-note"><span title="Actual is live from the ledger; on-order is open supplier orders (VAT-exclusive), assumed the budget currency.">Figures in {cur} · hover any tile for detail</span></p>

              <div className="bg-tabs">
                <button type="button" className={`bg-tab${tab === 'overview' ? ' is-active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
                <button type="button" className={`bg-tab${tab === 'summary' ? ' is-active' : ''}`} onClick={() => setTab('summary')}>Detail</button>
                <button type="button" className={`bg-tab${tab === 'monthly' ? ' is-active' : ''}`} onClick={() => setTab('monthly')}>By month</button>
              </div>

              {canEdit && view.buckets.length === 0 && view.unbudgeted && (
                <div className="bg-setup">
                  <div className="bg-setup-msg"><b>No budget lines yet.</b> Load the standard yacht chart of accounts, or add your own — then this spend files itself against them.</div>
                  <div className="bg-setup-act">
                    <button type="button" className="bg-btn bg-btn-ghost" onClick={() => setLineModal({ line: null })}>Add line</button>
                    <button type="button" className="bg-btn bg-btn-primary" onClick={loadTemplate}>Load standard template</button>
                  </div>
                </div>
              )}

              {tab === 'overview' ? (
                <BudgetOverview view={view} monthly={monthly} cur={cur} todayYm={todayYm} />
              ) : tab === 'monthly' ? renderMonthly() : (
              view.buckets.length === 0 && !view.unbudgeted ? (
                <div className="bg-empty" style={{ marginTop: 20 }}>
                  <Icon name="ListTree" size={40} />
                  <p>No lines yet</p>
                  <p className="bg-empty-sub">{canEdit ? 'Add lines yourself, or load the standard yacht chart of accounts to get every coded category in one click.' : 'A COMMAND user can add budget lines.'}</p>
                  {canEdit && (
                    <button type="button" className="bg-btn bg-btn-primary" style={{ marginTop: 16 }} onClick={loadTemplate}>
                      <Icon name="ListChecks" size={16} /> Load standard template
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {view.unbudgeted && renderNeedsCategory()}
                  {orderedBuckets.map((b) => (
                    <div key={b.bucket} className="bg-bucket">
                      <div className="bg-bucket-head">
                        <span className="bg-bucket-name">{b.bucket}</span>
                        <span className="bg-bucket-rule" />
                        <span className="bg-bucket-meta">{formatMoney(effBucketSubtotal(b).budgeted, cur)} budgeted</span>
                      </div>
                      <div className="bg-cols">
                        <span>Line</span><span className="r">Budgeted</span><span className="r c-actual">Actual</span>
                        <span className="r c-committed">On order</span><span className="r c-remaining">Remaining</span><span>% used</span><span />
                      </div>
                      {b.lines.map((l) => renderRow(l, l.id))}
                      <div className="bg-row bg-subtotal">
                        <div className="bg-row-cat"><b>{b.bucket} subtotal</b></div>
                        <span className="bg-fig">{formatMoney(effBucketSubtotal(b).budgeted, cur)}</span>
                        <span className="bg-fig c-actual">{formatMoney(effBucketSubtotal(b).actual, cur)}</span>
                        <span className="bg-fig c-committed">{formatMoney(effBucketSubtotal(b).committed, cur)}</span>
                        <span className={`bg-fig c-remaining${effBucketSubtotal(b).remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(effBucketSubtotal(b).remaining, cur)}</span>
                        <Meter pct={effBucketSubtotal(b).pct} state={effBucketSubtotal(b).state} spent={effBucketSubtotal(b).actual + effBucketSubtotal(b).committed} />
                        <span />
                      </div>
                      {renderAddRow(b.bucket, b.kind)}
                    </div>
                  ))}

                  {(sT.revenueTotals.budgeted > 0 || sT.revenueTotals.actual > 0) && (
                    <div className="bg-row bg-grandtotal" style={{ borderTop: '1px solid #E6E8EF' }}>
                      <div className="bg-row-cat"><b>Total revenue</b></div>
                      <span className="bg-fig">{formatMoney(sT.revenueTotals.budgeted, cur)}</span>
                      <span className="bg-fig c-actual bg-pos">{formatMoney(sT.revenueTotals.actual, cur)}</span>
                      <span className="bg-fig c-committed">—</span>
                      <span className="bg-fig c-remaining">{formatMoney(sT.revenueTotals.remaining, cur)}</span>
                      <span /><span />
                    </div>
                  )}
                  <div className="bg-row bg-grandtotal">
                    <div className="bg-row-cat"><b>Total expenditure</b></div>
                    <span className="bg-fig">{formatMoney(sT.totals.budgeted, cur)}</span>
                    <span className="bg-fig c-actual">{formatMoney(sT.totals.actual, cur)}</span>
                    <span className="bg-fig c-committed">{formatMoney(sT.totals.committed, cur)}</span>
                    <span className={`bg-fig c-remaining${sT.totals.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(sT.totals.remaining, cur)}</span>
                    <Meter pct={sT.totals.pct} state={sT.totals.state} spent={sT.totals.actual + sT.totals.committed} />
                    <span />
                  </div>
                  {(sT.revenueTotals.budgeted > 0 || sT.revenueTotals.actual > 0) && (
                    <div className="bg-row bg-grandtotal">
                      <div className="bg-row-cat"><b>Net revenue (expenditure)</b></div>
                      <span className="bg-fig">{formatMoney(sT.net.budgeted, cur)}</span>
                      <span className={`bg-fig c-actual ${sT.net.actual < 0 ? 'bg-neg' : 'bg-pos'}`}>{formatMoney(sT.net.actual, cur)}</span>
                      <span className="bg-fig c-committed" /><span className="bg-fig c-remaining" /><span /><span />
                    </div>
                  )}
                </>
              ))}
            </>
          )}
        </div>
        {toast && <div className="bg-toast">{toast}</div>}
      </div>

      {budget && (
        <BudgetFormModal open={editBudget} onClose={() => setEditBudget(false)} onSave={saveBudget} initial={budget} />
      )}
      <LineFormModal
        open={Boolean(lineModal)}
        onClose={() => setLineModal(null)}
        onSave={saveLine}
        onDelete={removeLine}
        initial={lineModal?.line}
        buckets={bucketSuggestions}
        categories={categorySuggestions}
      />
    </>
  );
}
