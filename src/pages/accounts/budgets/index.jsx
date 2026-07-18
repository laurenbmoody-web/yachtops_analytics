// Cargo Accounts — Budgets list (/accounts/budgets). Editorial hairline list of
// budgets; COMMAND creates a new one. Each row links to its vs-actual detail.
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { listBudgets, createBudget } from '../../../services/budgetService';
import { formatMoney } from '../../../services/financeCalc';
import BudgetFormModal from './components/BudgetFormModal';
import './budgets.css';

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const STATUS_PILL = { draft: 'bg-pill-draft', active: 'bg-pill-active', closed: 'bg-pill-closed' };

export default function Budgets() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { hasCommandAccess } = useAuth();
  const canEdit = hasCommandAccess();

  const [loading, setLoading] = useState(true);
  const [budgets, setBudgets] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const { data, error } = await listBudgets(activeTenantId);
    if (!error && data) setBudgets(data);
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    const res = await createBudget({ ...payload, tenant_id: activeTenantId });
    if (!res.error && res.data) { await load(); flash('Budget created'); navigate(`/accounts/budgets/${res.data.id}`); }
    return res;
  };

  return (
    <>
      <Header />
      <div className="bg-page">
        <div className="bg-wrap">
          <button type="button" className="bg-back" onClick={() => navigate('/accounts')}>
            <Icon name="ChevronLeft" size={16} /> Back to Accounts
          </button>

          <div className="bg-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Accounts</span>
              <span className="bar" />
              <span className="muted">Budgets</span>
              <span className="bar" />
              <span className="muted">{budgets.length} total</span>
            </p>
            <div className="bg-titlerow">
              <h1 className="bg-title">The <em>budgets</em>.</h1>
              <div className="bg-head-act">
                {canEdit && (
                  <button type="button" className="bg-btn bg-btn-primary" onClick={() => setModalOpen(true)}>
                    <Icon name="Plus" size={16} /> New budget
                  </button>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="bg-empty"><p>Loading budgets…</p></div>
          ) : budgets.length === 0 ? (
            <div className="bg-empty">
              <Icon name="Target" size={44} />
              <p>No budgets yet</p>
              <p className="bg-empty-sub">
                {canEdit ? 'Create a budget, then add buckets and breakdown lines to track spend against plan.' : 'A COMMAND user can create the first budget.'}
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 18 }}>
              {budgets.map((b) => (
                <button key={b.id} type="button" className="bg-list-row" onClick={() => navigate(`/accounts/budgets/${b.id}`)}>
                  <span className="bg-list-name">{b.name}</span>
                  <span className="bg-list-period">{fmtDMY(b.period_start)} – {fmtDMY(b.period_end)}</span>
                  <span><span className={`bg-pill ${STATUS_PILL[b.status] || 'bg-pill-draft'}`}>{b.status}</span></span>
                  <span className="bg-list-total bg-num">{formatMoney(b.budgeted_total, b.currency)}</span>
                  <span className="bg-list-chev"><Icon name="ChevronRight" size={16} /></span>
                </button>
              ))}
            </div>
          )}
        </div>
        {toast && <div className="bg-toast">{toast}</div>}
      </div>

      <BudgetFormModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave} />
    </>
  );
}
