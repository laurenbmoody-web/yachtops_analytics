// Cargo Accounts — Budget detail / budget-vs-actual (/accounts/budgets/:id).
// Two-level editorial table: buckets -> breakdown lines, each with Budgeted / Actual
// / Committed / Remaining and a % meter. Actual is live from the Phase 0 ledger,
// Committed from open supplier orders. COMMAND edits lines.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useAuth } from '../../../contexts/AuthContext';
import { getBudgetVsActual, getBudgetMonthly, updateBudget, closeBudget, upsertLine, deleteLine, seedStandardTemplate, updateLineAmount, updateLineMonthly, setCategoryOverride } from '../../../services/budgetService';
import { formatMoney } from '../../../services/financeCalc';
import BudgetFormModal from './components/BudgetFormModal';
import LineFormModal from './components/LineFormModal';
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
  const [amtEdit, setAmtEdit] = useState(null);     // { id, value } inline amount edit
  const [addRow, setAddRow] = useState(null);       // { bucket, kind, category, amount } inline add
  const [tab, setTab] = useState('summary');        // 'summary' | 'monthly'
  const [monthly, setMonthly] = useState(null);
  const [mMode, setMMode] = useState('budget');     // 'budget' | 'actual' | 'variance'
  const [mEdit, setMEdit] = useState(null);         // { id, ym, value } editing a budget cell
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  // fetchAll(true) shows the mount spinner; refresh() (spinner=false) reconciles
  // quietly after an edit so the page doesn't blank or jump — you keep your place
  // and the remaining rows stay put while you work through them.
  const fetchAll = useCallback(async (spinner) => {
    if (spinner) setLoading(true);
    const [vs, mr] = await Promise.all([getBudgetVsActual(id), getBudgetMonthly(id)]);
    if (!vs.error && vs.data) setView(vs.data);
    if (!mr.error && mr.data) setMonthly(mr.data);
    if (spinner) setLoading(false);
  }, [id]);
  const load = useCallback(() => fetchAll(true), [fetchAll]);
  const refresh = useCallback(() => fetchAll(false), [fetchAll]);

  useEffect(() => { load(); }, [load]);

  const budget = view?.budget;
  const cur = budget?.currency || 'EUR';

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

  const commitAmount = async () => {
    if (!amtEdit) return;
    const { id, value, original } = amtEdit;
    setAmtEdit(null);
    if (Number(value) === Number(original)) return;   // no change
    const res = await updateLineAmount(id, value);
    if (!res.error) { await refresh(); flash('Amount updated'); }
    else flash('Could not update amount');
  };

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
    const spent = row.actual + row.committed;
    const editing = amtEdit?.id === row.id;
    return (
      <div key={key} className={`bg-row${row.state === 'over' && row.kind !== 'revenue' ? ' is-over' : ''}`}>
        <div className="bg-row-cat">
          <b>{row.code ? <span className="bg-code">{row.code}</span> : null}{row.category}</b>
          {row.note ? <div className="bg-row-note">{row.note}</div> : null}
        </div>
        {editing ? (
          <input
            className="bg-inline-input bg-num" type="number" step="0.01" min="0" inputMode="decimal" autoFocus
            value={amtEdit.value}
            onChange={(e) => setAmtEdit({ ...amtEdit, value: e.target.value })}
            onBlur={commitAmount}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setAmtEdit(null); }}
          />
        ) : (
          <span
            className={`bg-fig${canEdit && row.id ? ' bg-editable' : ''}`}
            onClick={canEdit && row.id ? () => setAmtEdit({ id: row.id, value: String(row.budgeted), original: row.budgeted }) : undefined}
            title={canEdit && row.id ? 'Click to edit' : undefined}
          >{formatMoney(row.budgeted, cur)}</span>
        )}
        <span className="bg-fig c-actual">{formatMoney(row.actual, cur)}</span>
        <span className="bg-fig c-committed">{formatMoney(row.committed, cur)}</span>
        <span className={`bg-fig c-remaining${row.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(row.remaining, cur)}</span>
        <Meter pct={row.pct} state={row.state} spent={spent} />
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
            <select className="bg-assign" value=""
              onChange={(e) => {
                const v = e.target.value; e.target.value = '';
                if (v === '__new__') setLineModal({ line: { bucket: '', category: l.category, amount: 0 } });
                else if (v) assignUnbudgeted(l.category, v);
              }}>
              <option value="" disabled>Assign to…</option>
              {lineOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="__new__">＋ New line…</option>
            </select>
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

  const commitMonthCell = async (line, ym) => {
    if (!mEdit) return;
    const { value } = mEdit;
    setMEdit(null);
    const current = { ...line.budgetByMonth };
    if (Number(value) === Number(current[ym] || 0)) return;
    current[ym] = Number(value) || 0;
    const res = await updateLineMonthly(line.id, current);
    if (!res.error) { await refresh(); flash('Monthly budget saved'); }
    else flash('Could not save');
  };

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

    // Pick the matrix for the active mode.
    const lineRow = (l) => mMode === 'actual' ? l.byMonth : mMode === 'budget' ? l.budgetByMonth : minusRow(l.budgetByMonth, l.byMonth, M);
    const lineTot = (l) => mMode === 'actual' ? l.total : mMode === 'budget' ? l.budgetTotal : (l.budgetTotal - l.total);
    const subRow = (b) => mMode === 'actual' ? b.subtotalByMonth : mMode === 'budget' ? b.budgetSubtotalByMonth : minusRow(b.budgetSubtotalByMonth, b.subtotalByMonth, M);
    const subTot = (b) => mMode === 'actual' ? b.subtotalTotal : mMode === 'budget' ? b.budgetSubtotalTotal : (b.budgetSubtotalTotal - b.subtotalTotal);
    const expRow = mMode === 'actual' ? monthly.expenseByMonth : mMode === 'budget' ? monthly.budgetExpenseByMonth : minusRow(monthly.budgetExpenseByMonth, monthly.expenseByMonth, M);
    const revRow = mMode === 'actual' ? monthly.revenueByMonth : mMode === 'budget' ? monthly.budgetRevenueByMonth : minusRow(monthly.budgetRevenueByMonth, monthly.revenueByMonth, M);
    const netRow = mMode === 'actual' ? monthly.netByMonth : mMode === 'budget' ? monthly.budgetNetByMonth : minusRow(monthly.budgetNetByMonth, monthly.netByMonth, M);
    const expTot = mMode === 'actual' ? monthly.expenseTotal : mMode === 'budget' ? monthly.budgetExpenseTotal : (monthly.budgetExpenseTotal - monthly.expenseTotal);
    const revTot = mMode === 'actual' ? monthly.revenueTotal : mMode === 'budget' ? monthly.budgetRevenueTotal : (monthly.budgetRevenueTotal - monthly.revenueTotal);
    const netTot = mMode === 'actual' ? monthly.netTotal : mMode === 'budget' ? monthly.budgetNetTotal : (monthly.budgetNetTotal - monthly.netTotal);

    const roCells = (byMonth) => M.map((m) => <td key={m.ym} className={`bg-mcell${byMonth[m.ym] < 0 ? ' bg-neg' : ''}`}>{mfmt(byMonth[m.ym])}</td>);
    const editCells = (l) => M.map((m) => {
      const on = mEdit && mEdit.id === l.id && mEdit.ym === m.ym;
      return (
        <td key={m.ym} className="bg-mcell">
          {on ? (
            <input className="bg-minput" type="number" step="0.01" autoFocus value={mEdit.value}
              onChange={(e) => setMEdit({ ...mEdit, value: e.target.value })}
              onBlur={() => commitMonthCell(l, m.ym)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setMEdit(null); }} />
          ) : (
            <span className="bg-mcell-edit" onClick={() => setMEdit({ id: l.id, ym: m.ym, value: String(l.budgetByMonth[m.ym] || 0) })}>{mfmt(l.budgetByMonth[m.ym])}</span>
          )}
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

              <div className="bg-sum">
                {view.revenueTotals.budgeted > 0 || view.revenueTotals.actual > 0 ? (
                  <>
                    <div className="bg-s"><b className="bg-num bg-pos">{formatMoney(view.revenueTotals.actual, cur)}</b><span>Revenue</span></div>
                    <div className="bg-vr" />
                  </>
                ) : null}
                <div className="bg-s"><b className="bg-num">{formatMoney(view.totals.budgeted, cur)}</b><span>Budgeted (exp.)</span></div>
                <div className="bg-vr" />
                <div className="bg-s"><b className="bg-num">{formatMoney(view.totals.actual, cur)}</b><span>Spent</span></div>
                <div className="bg-vr" />
                <div className="bg-s"><b className="bg-num">{formatMoney(view.totals.committed, cur)}</b><span>On order</span></div>
                <div className="bg-vr" />
                <div className="bg-s"><b className={`bg-num ${view.totals.remaining < 0 ? 'bg-neg' : ''}`}>{formatMoney(view.totals.remaining, cur)}</b><span>Remaining</span></div>
                {view.revenueTotals.budgeted > 0 || view.revenueTotals.actual > 0 ? (
                  <>
                    <div className="bg-vr" />
                    <div className="bg-s"><b className={`bg-num ${view.net.actual < 0 ? 'bg-neg' : 'bg-pos'}`}>{formatMoney(view.net.actual, cur)}</b><span>Net rev. (exp.)</span></div>
                  </>
                ) : null}
              </div>
              <p className="bg-report-note">Figures reported in {cur}. Actual is live from the ledger; on-order is open supplier orders (VAT-exclusive), assumed same currency.</p>

              <div className="bg-tabs">
                <button type="button" className={`bg-tab${tab === 'summary' ? ' is-active' : ''}`} onClick={() => setTab('summary')}>Summary</button>
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

              {tab === 'monthly' ? renderMonthly() : (
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
                        <span className="bg-bucket-meta">{formatMoney(b.subtotal.budgeted, cur)} budgeted</span>
                      </div>
                      <div className="bg-cols">
                        <span>Line</span><span className="r">Budgeted</span><span className="r c-actual">Actual</span>
                        <span className="r c-committed">On order</span><span className="r c-remaining">Remaining</span><span>% used</span><span />
                      </div>
                      {b.lines.map((l) => renderRow(l, l.id))}
                      <div className="bg-row bg-subtotal">
                        <div className="bg-row-cat"><b>{b.bucket} subtotal</b></div>
                        <span className="bg-fig">{formatMoney(b.subtotal.budgeted, cur)}</span>
                        <span className="bg-fig c-actual">{formatMoney(b.subtotal.actual, cur)}</span>
                        <span className="bg-fig c-committed">{formatMoney(b.subtotal.committed, cur)}</span>
                        <span className={`bg-fig c-remaining${b.subtotal.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(b.subtotal.remaining, cur)}</span>
                        <Meter pct={b.subtotal.pct} state={b.subtotal.state} spent={b.subtotal.actual + b.subtotal.committed} />
                        <span />
                      </div>
                      {renderAddRow(b.bucket, b.kind)}
                    </div>
                  ))}

                  {(view.revenueTotals.budgeted > 0 || view.revenueTotals.actual > 0) && (
                    <div className="bg-row bg-grandtotal" style={{ borderTop: '1px solid #E6E8EF' }}>
                      <div className="bg-row-cat"><b>Total revenue</b></div>
                      <span className="bg-fig">{formatMoney(view.revenueTotals.budgeted, cur)}</span>
                      <span className="bg-fig c-actual bg-pos">{formatMoney(view.revenueTotals.actual, cur)}</span>
                      <span className="bg-fig c-committed">—</span>
                      <span className="bg-fig c-remaining">{formatMoney(view.revenueTotals.remaining, cur)}</span>
                      <span /><span />
                    </div>
                  )}
                  <div className="bg-row bg-grandtotal">
                    <div className="bg-row-cat"><b>Total expenditure</b></div>
                    <span className="bg-fig">{formatMoney(view.totals.budgeted, cur)}</span>
                    <span className="bg-fig c-actual">{formatMoney(view.totals.actual, cur)}</span>
                    <span className="bg-fig c-committed">{formatMoney(view.totals.committed, cur)}</span>
                    <span className={`bg-fig c-remaining${view.totals.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(view.totals.remaining, cur)}</span>
                    <Meter pct={view.totals.pct} state={view.totals.state} spent={view.totals.actual + view.totals.committed} />
                    <span />
                  </div>
                  {(view.revenueTotals.budgeted > 0 || view.revenueTotals.actual > 0) && (
                    <div className="bg-row bg-grandtotal">
                      <div className="bg-row-cat"><b>Net revenue (expenditure)</b></div>
                      <span className="bg-fig">{formatMoney(view.net.budgeted, cur)}</span>
                      <span className={`bg-fig c-actual ${view.net.actual < 0 ? 'bg-neg' : 'bg-pos'}`}>{formatMoney(view.net.actual, cur)}</span>
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
