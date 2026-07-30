// Cargo Accounts — "where do I balance the accounts?", answered on the page.
//
// Balancing is per account, so the close itself (MonthEndStrip) can only appear
// once one account is chosen. That made it invisible: the page defaults to all
// accounts, so nothing about balancing was on screen until you happened to set an
// account filter — a step nobody has a reason to take.
//
// This is what stands in its place: every account that moved money this month,
// what it spent, and whether it's balanced. Picking one opens the close.
import React from 'react';
import Icon from '../../../components/AppIcon';
import { formatMoney } from '../../../services/financeCalc';
import { accountLabel } from '../../../services/accountPick';
import './month-end-overview.css';

const STATE = {
  approved: { label: 'Signed off', tone: 'done' },
  submitted: { label: 'Awaiting sign-off', tone: 'wait' },
  open: { label: 'Not balanced yet', tone: 'open' },
};

export default function MonthEndOverview({
  monthLabel, rows = [], accounts = [], reconciliations = [], onPick,
}) {
  const reconByAccount = Object.fromEntries(reconciliations.map((r) => [r.account_id, r]));

  // Only accounts that actually moved money this month — a dormant card is not
  // an outstanding job, and listing it as one is how a close-list gets ignored.
  const active = accounts
    .map((a) => {
      const mine = rows.filter((t) => t.account_id === a.id);
      const out = mine.reduce((s, t) => (Number(t.amount) < 0 ? s + Number(t.amount) : s), 0);
      return { account: a, count: mine.length, out, recon: reconByAccount[a.id] || null };
    })
    .filter((x) => x.count > 0)
    .sort((x, y) => x.out - y.out);

  const unassigned = rows.filter((t) => !t.account_id).length;
  if (!active.length && !unassigned) return null;

  const done = active.filter((x) => (x.recon?.status || 'open') !== 'open').length;

  return (
    <section className="meo">
      <div className="meo-head">
        <span className="meo-title">Balance {monthLabel}</span>
        <span className="meo-rule" />
        <span className="meo-meta">{done} of {active.length} balanced</span>
      </div>

      {active.map(({ account, count, out, recon }) => {
        const state = STATE[recon?.status || 'open'] || STATE.open;
        return (
          <button key={account.id} type="button" className="meo-row" onClick={() => onPick?.(account.id)}>
            <span className="meo-name">{accountLabel(account, { withCurrency: false })}</span>
            <span className="meo-count">{count} {count === 1 ? 'line' : 'lines'}</span>
            <span className="meo-out">{formatMoney(out, account.currency, { signed: true })}</span>
            <span className={`meo-state is-${state.tone}`}>{state.label}</span>
            <Icon name="ChevronRight" size={15} />
          </button>
        );
      })}

      {/* Spend that belongs to no account can't be balanced against any statement,
          so it would silently sit outside every close. Say so. */}
      {unassigned > 0 && (
        <p className="meo-orphan">
          <Icon name="AlertCircle" size={14} />
          {unassigned} {unassigned === 1 ? 'line has' : 'lines have'} no account yet — they belong to no statement
          until you assign one, so they can&rsquo;t be balanced.
        </p>
      )}
    </section>
  );
}
