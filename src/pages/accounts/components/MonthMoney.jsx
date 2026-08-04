// Cargo Accounts — the month's money for one card, and closing it.
//
// This was three blocks on one page: a summary beside the wallet, an opening →
// closing ladder inside a month-end section below, and the statement fields down
// there with it. Same account, same month, same figures — and the numbers were
// never on screen beside the statement that tests them. It's one panel now.
//
// The section that used to sit underneath is gone rather than moved. What it held:
//   the ladder            already up here, twice over
//   the statement fields  already up here
//   spend to reimburse    with no float target set this is |money out| exactly,
//                         so it only appears when the funding model makes it a
//                         different number
//   the blockers          kept — they're the reasons Close is disabled, and they
//                         belong next to the button
//   the difference hunt   kept — it explains a gap between two figures that are
//                         now side by side
//
// The statement half still waits for the month to be over (see monthEndStage):
// you can't match July against a statement the bank hasn't issued. It collapses
// to a line rather than a whole section, and a click always overrides.
//
// There is deliberately no way to plug a difference. An unexplained gap is the
// thing this panel exists to surface.
import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { formatMoney } from '../../../services/financeCalc';
import {
  monthEndStage, opensByDefault, stageSummary, lastDayOfMonth, closeDrift,
} from '../../../services/monthEnd';
import { findDifferenceCandidates, differenceLead, isFedAccount } from '../../../services/differenceHunt';
import './month-money.css';

// Same order as the ladder above them — in, then out, then what that leaves.
// They used to run out-then-in, so the eye had to jump back up and re-pair them.
const FIELDS = [
  { key: 'moneyIn', label: 'Total in', ours: 'moneyIn' },
  { key: 'moneyOut', label: 'Total out', ours: 'moneyOut', abs: true },
  { key: 'closing', label: 'Closing balance', ours: 'closing' },
];

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export default function MonthMoney({
  account, scoped, monthKey, monthLabel, txns = [], allTxns = [], monthStat,
  figures, statement, checks = [], blockers = [], outcome, reconciliation, today,
  canEdit, busy, onField, onSave, onClose, onShowLine, onExport,
}) {
  const cur = account?.currency;
  const money = (n) => formatMoney(n, cur);
  const signed = (n) => formatMoney(n, cur, { signed: true });

  const status = reconciliation?.status || 'open';
  const locked = status !== 'open';
  const stage = monthEndStage(monthKey, today || new Date(), status);

  const ready = scoped && blockers.length === 0;
  const diffs = blockers.filter((b) => b.key.startsWith('diff:'));
  const work = blockers.filter((b) => b.count > 0);

  // Computed by the page, because it's also written onto the reconciliation when
  // the month closes — one figure, not one for the screen and one for the record.
  // With no float target, an imprest month's "reimbursement" IS the money out —
  // the same figure four rows up — so it only shows when it says something else.
  const outcomeWorthSaying = scoped && outcome
    && Math.abs(outcome.amount - Math.abs(figures?.moneyOut || 0)) > 0.005;

  const candidates = useMemo(() => (diffs.length
    ? findDifferenceCandidates({
      difference: diffs[0].ours - diffs[0].theirs,
      monthTxns: txns, poolTxns: allTxns, accountId: account?.id, monthKey,
    })
    : []), [diffs, txns, allTxns, account?.id, monthKey]);

  // Management often close before the last day of the month, or the day after.
  // Lines keep arriving either way, so a closed month has to say when it has
  // stopped matching what was signed off.
  const drift = scoped ? closeDrift(reconciliation, txns, figures?.opening) : null;

  const [userOpen, setUserOpen] = useState(null);
  const open = userOpen == null ? opensByDefault(stage) : userOpen;
  const summary = stageSummary(stage, { monthLabel, blockers, statementDue: dmy(lastDayOfMonth(monthKey)) });

  return (
    <div className="mm">
      <p className="mm-lab">The month</p>

      {scoped ? (
        <div className="mm-eq">
          <div className="r"><span>Opening balance</span><b>{money(figures.opening)}</b></div>
          <div className="r"><span>Money in</span><b>{money(figures.moneyIn)}</b></div>
          <div className="r"><span>Money out</span><b>{money(Math.abs(figures.moneyOut))}</b></div>
          <div className="r is-tot"><span>Closing balance</span><b>{money(figures.closing)}</b></div>
        </div>
      ) : (
        // No opening or closing across every card at once — those belong to one
        // account and one statement, and summing them would mean nothing.
        <div className="mm-eq">
          <div className="r"><span>Money out</span><b className="neg">{signed(monthStat.outSum)}</b></div>
          <div className="r"><span>Money in</span><b>{signed(monthStat.inSum)}</b></div>
          <div className="r is-tot"><span>Net</span><b>{signed(monthStat.net)}</b></div>
        </div>
      )}

      {scoped && (
        <div className="mm-close">
          <div className="mm-closehead">
            <p className="mm-lab">
              Against the statement
              {!locked && open && <em className="mm-req"> required</em>}
            </p>
            <button type="button" className="mm-toggle" aria-expanded={open}
              onClick={() => setUserOpen(!open)}>
              {open ? 'Hide' : (stage === 'due' ? 'Balance it' : 'Open')}
              <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
            </button>
          </div>

          {/* Shut, this still has to be worth reading — it says where the month
              stands rather than just naming a drawer. */}
          {!open && <p className="mm-say">{summary}</p>}

          {/* The office sent it back. This is the one thing on the page the crew
              didn't put there, so it says so plainly and stays visible whether
              the panel is open or shut — a query the boat doesn't see is a month
              that quietly never closes. */}
          {reconciliation?.queried_at && status === 'open' && (
            <div className="mm-query">
              <p className="mm-query-head">
                <Icon name="Undo2" size={15} />
                Management sent this back on {dmy(reconciliation.queried_at)}
              </p>
              {reconciliation.query_note && <p className="mm-query-note">{reconciliation.query_note}</p>}
            </div>
          )}

          {status === 'approved' && (
            <p className="mm-signed">
              <Icon name="BadgeCheck" size={14} />
              Signed off by management{reconciliation?.approved_at ? ` on ${dmy(reconciliation.approved_at)}` : ''}.
              {reconciliation?.signoff_note && <em> {reconciliation.signoff_note}</em>}
            </p>
          )}

          {/* Shown whether the panel is open or shut: a signed-off figure that no
              longer matches the ledger is not a detail to go looking for. */}
          {drift && (
            <div className="mm-drift">
              <p className="mm-drift-head">
                <Icon name="AlertCircle" size={15} />
                {monthLabel} was closed on {dmy(drift.closedAt)}, and has moved since.
              </p>
              <div className="mm-drift-rows">
                {drift.lines > 0 && (
                  <div className="r">
                    <span>{drift.lines} {drift.lines === 1 ? 'line' : 'lines'} arrived after the close</span>
                    <b>{money(Math.abs(drift.lineTotal))}</b>
                  </div>
                )}
                <div className="r">
                  <span>Closing balance signed off</span>
                  <b>{drift.recordedClosing == null ? '—' : money(drift.recordedClosing)}</b>
                </div>
                <div className="r is-now">
                  <span>Closing balance now</span>
                  <b>{money(drift.closingNow)}</b>
                </div>
              </div>
              <p className="mm-drift-foot">
                The office balanced against the figure above, so it needs reopening and
                closing again — or these lines moving into {monthLabel === 'this month' ? 'the next month' : 'the following month'}.
              </p>
            </div>
          )}

          {open && (
            <>
              <div className="mm-fields">
                {FIELDS.map((f) => {
                  const c = checks.find((x) => x.key === f.key);
                  const ours = f.abs ? Math.abs(figures[f.ours]) : figures[f.ours];
                  return (
                    <label key={f.key} className="mm-field">
                      {/* One line, always. "Total out · Cargo says £12,923.90" wrapped
                          on two of the three, so the inputs sat at three different
                          heights — what Cargo makes it moved below the box, which is
                          where your eye already is while you're typing anyway. */}
                      <span>{f.label}</span>
                      <input inputMode="decimal" value={statement[f.key]} disabled={locked || !canEdit}
                        onChange={(e) => onField?.(f.key, e.target.value)} placeholder="—"
                        className={c?.ok === false ? 'is-off' : (c?.ok ? 'is-ok' : '')} />
                      <span className="mm-vs">
                        Cargo says {money(ours)}
                        {c?.ok === false && (
                          <b className="mm-diff">
                            {c.difference > 0 ? 'over by ' : 'short by '}{money(Math.abs(c.difference))}
                          </b>
                        )}
                        {c?.ok === true && <b className="mm-match">agrees</b>}
                        {c?.ok == null && <b className="mm-none">not stated</b>}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* Cargo holds every line, both dates, the pending flag and the
                  unassigned pile — so it names what would account for the gap
                  rather than telling the crew to go and find it. */}
              {diffs.length > 0 && (
                <div className="mm-hunt">
                  <p className="mm-hunt-lead">
                    {differenceLead(candidates, {
                      fed: isFedAccount(txns),
                      key: diffs[0].key.replace('diff:', ''),
                      ours: diffs[0].ours,
                      theirs: diffs[0].theirs,
                      amountText: money(Math.abs(diffs[0].ours - diffs[0].theirs)),
                    })}
                  </p>
                  {candidates.map((c) => (
                    <div key={c.key} className="mm-cand">
                      <span className="mm-cand-amt">{money(c.amount)}</span>
                      <span className="mm-cand-txt">{c.label}<em>{c.action}</em></span>
                      {onShowLine && (
                        <button type="button" className="mm-cand-go" onClick={() => onShowLine(c.txnIds[0])}>
                          Show {c.txnIds.length > 1 ? 'them' : 'it'} <Icon name="ArrowRight" size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="mm-hunt-foot">
                    Suggestions only &mdash; Cargo changes nothing on a hunch, and won&rsquo;t
                    close a month it can&rsquo;t explain.
                  </p>
                </div>
              )}

              {outcomeWorthSaying && (
                <p className="mm-outcome">
                  <span>{outcome.label}</span><b>{money(outcome.amount)}</b>
                  {outcome.overspent > 0 && <em className="over">overspent by {money(outcome.overspent)}</em>}
                </p>
              )}

              {ready && !locked && (
                <p className="mm-ok"><Icon name="Check" size={14} /> Everything agrees</p>
              )}

              {/* The detail sits beside the wallet; a disabled button still has to
                  say why it's disabled from where it is. */}
              {!locked && work.length > 0 && (
                <p className="mm-why">
                  {work.reduce((n, b) => n + b.count, 0)} lines still to sort before it can close.
                </p>
              )}

              {canEdit && !locked && (
                <div className="mm-act">
                  <button type="button" className="mm-btn ghost" onClick={onSave} disabled={busy}>
                    {busy ? 'Saving…' : 'Save figures'}
                  </button>
                  <button type="button" className="mm-btn primary" onClick={onClose} disabled={busy || !ready}
                    title={ready ? `Close ${monthLabel}` : 'There is still work outstanding'}>
                    Close {monthLabel}
                  </button>
                </div>
              )}
              {locked && (
            <div className="mm-done">
              {/* Once management have signed off, the line above already says so
                  — repeating "it's closed" underneath it is noise. */}
              {!drift && status === 'submitted' && (
                <p className="mm-locked">{monthLabel} is closed and with management. Reopen it from Check-off if something needs changing.</p>
              )}
              {/* The office balances the owner's funds against this month, so the
                  closed pack is the thing they actually need — summary and every
                  line under it, in one file. */}
              {onExport && (
                <button type="button" className="mm-btn ghost" onClick={onExport}>
                  <Icon name="Download" size={14} /> Export for management
                </button>
              )}
            </div>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
