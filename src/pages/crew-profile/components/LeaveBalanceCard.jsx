// Leave balance — accrued, taken, remaining, and why the number is what it is.
//
// Lives under Employment, beside the entitlement figure it is derived from.
// Deliberately states its own workings: an entitlement that comes from a 4:2
// rotation, a statutory minimum and a figure somebody typed in are three very
// different claims, and a crew member checking their own leave should be able to
// see which one they're looking at.
//
// It also refuses to look more certain than it is. The count comes from status
// changes logged in Cargo, so leave taken without the status being changed is
// invisible to it — which on real data means a crew member on rotation since
// 2024 with nothing logged shows hundreds of days banked. Where that is the
// case the card says so rather than presenting the figure as settled.
import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { getLeaveBalance } from '../../../services/leaveService';
import { basisLabel, formatDays, toHalfDays } from '../../../services/leaveBalance';
import './leave-balance.css';

const dmy = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export default function LeaveBalanceCard({ tenantId, userId }) {
  const [state, setState] = useState({ loading: true, bal: null, err: null });

  useEffect(() => {
    if (!tenantId || !userId) { setState({ loading: false, bal: null, err: null }); return undefined; }
    let live = true;
    setState({ loading: true, bal: null, err: null });
    getLeaveBalance(tenantId, userId).then(({ data, error }) => {
      if (!live) return;
      setState({ loading: false, bal: data, err: error ? (error.message || 'Could not load leave') : null });
    });
    return () => { live = false; };
  }, [tenantId, userId]);

  const { loading, bal, err } = state;
  if (loading) return <div className="lv-card lv-quiet">Working out leave…</div>;
  if (err) return <div className="lv-card lv-quiet">{err}</div>;
  if (!bal) return null;

  // Can't compute — say which input is missing instead of showing zeros that
  // look like a real balance.
  if (!bal.ok) {
    return (
      <div className="lv-card">
        <div className="lv-head">
          <h4 className="lv-title">Leave</h4>
        </div>
        <p className="lv-none">
          {bal.reason === 'not-started'
            ? 'This contract hasn’t started yet, so no leave has accrued.'
            : 'Add a contract start date under Employment and leave will accrue from it.'}
        </p>
      </div>
    );
  }

  const remaining = toHalfDays(bal.remaining);

  return (
    <div className="lv-card">
      <div className="lv-head">
        <h4 className="lv-title">Leave</h4>
        <span className="lv-asof">as at {dmy(bal.asOf)}</span>
      </div>

      <div className="lv-figs">
        <div className="lv-fig">
          <b>{formatDays(bal.accrued)}</b>
          <em>Accrued</em>
        </div>
        <div className="lv-fig">
          <b>{formatDays(bal.taken)}</b>
          <em>Taken</em>
        </div>
        <div className="lv-fig lv-rem">
          <b data-neg={bal.overdrawn ? 'y' : undefined}>{formatDays(remaining)}</b>
          <em>{bal.overdrawn ? 'Overdrawn' : 'Remaining'}</em>
        </div>
      </div>

      {/* The workings, in one line. */}
      <p className="lv-basis">
        {bal.annualDays % 1 === 0 ? bal.annualDays : bal.annualDays.toFixed(1)} days a year
        {' · '}{basisLabel(bal.basis, bal.rotation)}
        {' · '}accruing since {dmy(bal.startDate)}
      </p>

      {/* Days away that are NOT annual leave. Shown so nobody wonders why a
          fortnight signed off sick didn't move the balance. */}
      {bal.notCounted > 0 && (
        <p className="lv-note">
          {formatDays(bal.notCounted)} away not charged to leave
          {bal.rotational > 0 && !bal.isRotational ? ' (including rotation)' : ''}
          {bal.byStatus.medical_leave ? ` · ${bal.byStatus.medical_leave} medical` : ''}
          {bal.byStatus.training_leave ? ` · ${bal.byStatus.training_leave} training` : ''}
        </p>
      )}

      {bal.banked && (
        <p className="lv-warn">
          <Icon name="AlertTriangle" size={14} />
          <span>
            That’s more than a year’s entitlement banked, which usually means leave was
            taken without the status being changed here. Treat it as a lower bound on
            days taken{bal.historyStartsLate ? `, and note the status log only starts ${dmy(bal.historyFrom)}` : ''}.
          </span>
        </p>
      )}

      {!bal.banked && bal.historyStartsLate && (
        <p className="lv-note">
          Counted from status changes since {dmy(bal.historyFrom)} — anything before that isn’t included.
        </p>
      )}
    </div>
  );
}
