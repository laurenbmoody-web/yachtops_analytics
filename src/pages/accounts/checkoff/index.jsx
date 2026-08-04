// Cargo Accounts — Command's month-end Check-off queue (/accounts/checkoff).
// Every holder's card/float for the month, bucketed by where it sits: waiting on
// Command, being tidied, not started, or checked off. Command approves a
// submitted month or sends it back. The plain-voice counterpart to the crew
// "Send to check off" on /accounts/my. Editorial (Cargo) system per CLAUDE.md.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { getAccountsOverview } from '../../../services/financeService';
import { listReconciliationsForMonth, approveReconciliation, reopenReconciliation } from '../../../services/reconcileService';
import { periodMonthISO } from '../../../services/reconcileState';
import { buildCheckoffRows, groupByLane, checkoffCounts } from '../../../services/checkoffState';
import { formatMoney } from '../../../services/financeCalc';
import AccountsShell from '../components/AccountsShell';
import '../accounts.css';
import './checkoff.css';

const initials = (role) => {
  if (!role) return '—';
  const parts = role.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
};
const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function Checkoff() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();

  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const period = periodMonthISO(ym.y, ym.m);
  const monthLabel = new Date(ym.y, ym.m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const [accounts, setAccounts] = useState([]);
  const [recons, setRecons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [{ data: ov }, { data: rs }] = await Promise.all([
      getAccountsOverview(activeTenantId),
      listReconciliationsForMonth(activeTenantId, period),
    ]);
    setAccounts(ov?.accounts || []);
    setRecons(rs || []);
    setLoading(false);
  }, [activeTenantId, period]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => buildCheckoffRows(accounts, recons), [accounts, recons]);
  const lanes = useMemo(() => groupByLane(rows), [rows]);
  const counts = useMemo(() => checkoffCounts(rows), [rows]);

  const stepMonth = (delta) => setYm((cur) => {
    const d = new Date(cur.y, cur.m - 1 + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });

  const approve = async (r) => {
    if (!r.recon?.id || busy) return;
    setBusy(r.account.id);
    const { error } = await approveReconciliation(r.recon.id);
    if (!error) { await load(); flash(`${r.account.name} checked off`); } else { flash('Could not check off'); }
    setBusy('');
  };
  const sendBack = async (r) => {
    if (!r.recon?.id || busy) return;
    setBusy(r.account.id);
    const { error } = await reopenReconciliation(r.recon.id);
    if (!error) { await load(); flash(`Sent back to ${r.account.holder_role || 'holder'}`); } else { flash('Could not send back'); }
    setBusy('');
  };

  const renderRow = (r) => {
    const a = r.account;
    const cur = a.currency;
    const holder = a.holder_role || 'Unassigned';
    const closing = r.recon?.closing_balance;
    return (
      <div key={a.id} className={`co-row ${r.lane}`}>
        <span className="co-who">
          <span className={`co-ava ${holder === 'Vessel' ? 'vessel' : ''}`}>{holder === 'Vessel' ? <Icon name="Landmark" size={15} /> : initials(holder)}</span>
          <span className="co-wt">
            <span className="co-name">{a.name}{a.kind === 'card' && a.card_last4 ? ` ····${a.card_last4}` : ''}</span>
            <span className="co-sub">{holder}{a.kind === 'petty_cash' ? ' · petty cash' : ''}</span>
          </span>
        </span>
        <span className="co-bal">
          {closing != null
            ? <><span className="co-ball">Closing</span><b className="ca-num">{formatMoney(closing, cur)}</b></>
            : <span className="co-muted">{formatMoney(a.balance, cur)}</span>}
        </span>
        <span className="co-when">
          {r.lane === 'waiting' && r.recon?.submitted_at ? `Sent ${fmtWhen(r.recon.submitted_at)}`
            : r.lane === 'done' && r.recon?.approved_at ? `Done ${fmtWhen(r.recon.approved_at)}`
            : r.lane === 'progress' ? 'In progress'
            : 'Not started'}
        </span>
        <span className="co-act">
          {r.lane === 'waiting' ? (
            <>
              <button type="button" className="co-btn ghost" disabled={busy === a.id} onClick={() => sendBack(r)}>Send back</button>
              <button type="button" className="co-btn pri" disabled={busy === a.id} onClick={() => approve(r)}><Icon name="Check" size={14} /> Check off</button>
            </>
          ) : r.lane === 'done' ? (
            <span className="co-donetag"><Icon name="Check" size={13} /> Checked off</span>
          ) : (
            <button type="button" className="co-btn ghost" onClick={() => navigate(`/accounts/my?account=${a.id}`)}>Open</button>
          )}
        </span>
      </div>
    );
  };

  return (
    <AccountsShell active="checkoff">
      <div className="ca-page">
        <div className="ca-wrap">
          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span><span>Check-off</span>
              <span className="bar" /><span className="muted">{monthLabel}</span>
              <span className="bar" /><span className="muted">{counts.waiting} waiting on you</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">Cards<span>,</span> <em>signed off</em>.</h1>
              <div className="ca-head-act">
                <div className="co-step">
                  <button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
                  <span>{monthLabel}</span>
                  <button type="button" onClick={() => stepMonth(1)} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="ca-empty"><p>Loading…</p></div>
          ) : rows.length === 0 ? (
            <div className="ca-empty">
              <Icon name="CheckCircle" size={44} />
              <p>Nothing to check off</p>
              <p className="ca-empty-sub">No cards or floats for {monthLabel}. Once a holder starts their month, it shows up here.</p>
            </div>
          ) : (
            lanes.map((lane) => (
              <div key={lane.key} className="co-lane">
                <div className="co-lh">
                  <span className={`co-ldot ${lane.tone}`} />
                  <span className="co-ll">{lane.label}</span>
                  <span className="co-lc">{lane.rows.length}</span>
                  <span className="co-lrule" />
                </div>
                {lane.rows.map(renderRow)}
              </div>
            ))
          )}
        </div>
        {toast && <div className="ca-toast">{toast}</div>}
      </div>
    </AccountsShell>
  );
}
