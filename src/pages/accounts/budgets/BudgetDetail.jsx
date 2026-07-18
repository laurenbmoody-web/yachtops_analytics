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
import { getBudgetVsActual, updateBudget, closeBudget, upsertLine, deleteLine } from '../../../services/budgetService';
import { formatMoney } from '../../../services/financeCalc';
import BudgetFormModal from './components/BudgetFormModal';
import LineFormModal from './components/LineFormModal';
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
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await getBudgetVsActual(id);
    if (!error && data) setView(data);
    setLoading(false);
  }, [id]);

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
    if (!res.error) { await load(); flash('Budget updated'); }
    return res;
  };
  const saveLine = async (payload) => {
    const res = await upsertLine({ ...payload, budget_id: id });
    if (!res.error) { await load(); flash('Line saved'); }
    return res;
  };
  const removeLine = async (lineId) => {
    const res = await deleteLine(lineId);
    if (!res.error) { await load(); flash('Line deleted'); }
    return res;
  };
  const toggleClose = async () => {
    if (budget.status === 'closed') return saveBudget({ status: 'active' });
    if (!window.confirm('Close this budget? You can reopen it later.')) return;
    const res = await closeBudget(id);
    if (!res.error) { await load(); flash('Budget closed'); }
  };

  const Fig = ({ v, muted }) => <span className={`bg-fig ${muted ? 'muted' : ''}${v < 0 ? ' bg-neg' : ''}`}>{formatMoney(v, cur)}</span>;

  const renderRow = (row, key) => {
    const spent = row.actual + row.committed;
    const clickable = canEdit && row.id;
    return (
      <div key={key} className={`bg-row${row.state === 'over' ? ' is-over' : ''}`}
        style={clickable ? { cursor: 'pointer' } : undefined}
        onClick={clickable ? () => setLineModal({ line: { id: row.id, bucket: row.bucket, category: row.category, amount: row.budgeted } }) : undefined}>
        <div className="bg-row-cat"><b>{row.category}</b></div>
        <span className="bg-fig">{formatMoney(row.budgeted, cur)}</span>
        <span className="bg-fig c-actual">{formatMoney(row.actual, cur)}</span>
        <span className="bg-fig c-committed">{formatMoney(row.committed, cur)}</span>
        <span className={`bg-fig c-remaining${row.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(row.remaining, cur)}</span>
        <Meter pct={row.pct} state={row.state} spent={spent} />
        <span className="bg-row-act">{clickable && <Icon name="Pencil" size={13} color="#CFCABF" />}</span>
      </div>
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
                  {canEdit && (
                    <div className="bg-head-act">
                      <button type="button" className="bg-btn bg-btn-ghost" onClick={toggleClose}>
                        {budget.status === 'closed' ? 'Reopen' : 'Close'}
                      </button>
                      <button type="button" className="bg-btn bg-btn-ghost" onClick={() => setEditBudget(true)}>
                        <Icon name="Pencil" size={15} /> Edit
                      </button>
                      <button type="button" className="bg-btn bg-btn-primary" onClick={() => setLineModal({ line: null })}>
                        <Icon name="Plus" size={16} /> Add line
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-sum">
                <div className="bg-s"><b className="bg-num">{formatMoney(view.totals.budgeted, cur)}</b><span>Budgeted</span></div>
                <div className="bg-vr" />
                <div className="bg-s"><b className="bg-num">{formatMoney(view.totals.actual, cur)}</b><span>Actual</span></div>
                <div className="bg-vr" />
                <div className="bg-s"><b className="bg-num">{formatMoney(view.totals.committed, cur)}</b><span>On order</span></div>
                <div className="bg-vr" />
                <div className="bg-s"><b className={`bg-num ${view.totals.remaining < 0 ? 'bg-neg' : ''}`}>{formatMoney(view.totals.remaining, cur)}</b><span>Remaining</span></div>
              </div>
              <p className="bg-report-note">Figures reported in {cur}. Actual is live from the ledger; on-order is open supplier orders (VAT-exclusive), assumed same currency.</p>

              {view.buckets.length === 0 && !view.unbudgeted ? (
                <div className="bg-empty" style={{ marginTop: 20 }}>
                  <Icon name="ListTree" size={40} />
                  <p>No lines yet</p>
                  <p className="bg-empty-sub">{canEdit ? 'Add a bucket and breakdown lines to start tracking against plan.' : 'A COMMAND user can add budget lines.'}</p>
                </div>
              ) : (
                <>
                  {view.buckets.map((b) => (
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
                    </div>
                  ))}

                  {view.unbudgeted && (
                    <div className="bg-bucket">
                      <div className="bg-bucket-head">
                        <span className="bg-bucket-name">Unbudgeted</span>
                        <span className="bg-bucket-rule" />
                        <span className="bg-bucket-meta">spend with no matching line</span>
                      </div>
                      <div className="bg-cols">
                        <span>Line</span><span className="r">Budgeted</span><span className="r c-actual">Actual</span>
                        <span className="r c-committed">On order</span><span className="r c-remaining">Remaining</span><span>% used</span><span />
                      </div>
                      {view.unbudgeted.lines.map((l, i) => (
                        <div key={`u-${i}`} className="bg-row is-over"
                          style={canEdit ? { cursor: 'pointer' } : undefined}
                          onClick={canEdit ? () => setLineModal({ line: { bucket: '', category: l.category, amount: 0 } }) : undefined}>
                          <div className="bg-row-cat"><b>{l.category}</b></div>
                          <span className="bg-fig muted">—</span>
                          <span className="bg-fig c-actual">{formatMoney(l.actual, cur)}</span>
                          <span className="bg-fig c-committed">{formatMoney(l.committed, cur)}</span>
                          <span className="bg-fig c-remaining bg-neg">{formatMoney(l.remaining, cur)}</span>
                          <Meter pct={null} state="over" spent={l.actual + l.committed} />
                          <span className="bg-row-act">{canEdit && <Icon name="Plus" size={13} color="#C65A1A" />}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-row bg-grandtotal">
                    <div className="bg-row-cat"><b>Total</b></div>
                    <span className="bg-fig">{formatMoney(view.totals.budgeted, cur)}</span>
                    <span className="bg-fig c-actual">{formatMoney(view.totals.actual, cur)}</span>
                    <span className="bg-fig c-committed">{formatMoney(view.totals.committed, cur)}</span>
                    <span className={`bg-fig c-remaining${view.totals.remaining < 0 ? ' bg-neg' : ''}`}>{formatMoney(view.totals.remaining, cur)}</span>
                    <Meter pct={view.totals.pct} state={view.totals.state} spent={view.totals.actual + view.totals.committed} />
                    <span />
                  </div>
                </>
              )}
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
