// Cargo Accounts — balancing one card's month.
//
// Two columns, because the crew alternate between two questions and stacking them
// put 400px between: LEFT is the money (what Cargo makes it, what the statement
// says), RIGHT is everything stopping the close, with the close button beside the
// reasons it's disabled.
//
// Each statement field carries Cargo's own figure in its label. That pairing is the
// point of the screen — separated into two lists you end up doing the arithmetic in
// your head, which is what the previous layout asked for.
//
// It only opens itself once the month is actually over (see monthEndStage): you
// can't match July against a statement the bank hasn't issued. While the month is
// still running it collapses to the half you CAN act on — categories and receipts —
// so that work gets chipped away instead of landing in a heap on the 1st.
//
// There is deliberately no way to plug a difference. An unexplained gap is the
// thing this screen exists to surface.
import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { formatMoney } from '../../../services/financeCalc';
import {
  fundingModel, fundingModelLabel, monthFigures, statementChecks,
  fundingOutcome, closeBlockers, closeHeadline,
  monthEndStage, opensByDefault, stageSummary, lastDayOfMonth,
} from '../../../services/monthEnd';
import { findDifferenceCandidates, differenceLead } from '../../../services/differenceHunt';
import './month-end-strip.css';

const FIELDS = [
  { key: 'moneyOut', label: 'Total out', ours: 'moneyOut', abs: true },
  { key: 'moneyIn', label: 'Total in', ours: 'moneyIn' },
  { key: 'closing', label: 'Closing balance', ours: 'closing' },
];

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export default function MonthEndStrip({
  account, monthLabel, monthKey, txns, allTxns = [], openingBalance, reconciliation,
  hasReceipt, splitCount, canEdit, onSaveStatement, onClose, onShowLine,
  requireReceipts = true, today,
}) {
  const [statement, setStatement] = useState({
    moneyOut: reconciliation?.stmt_money_out ?? '',
    moneyIn: reconciliation?.stmt_money_in ?? '',
    closing: reconciliation?.stmt_closing ?? '',
  });
  const [busy, setBusy] = useState(false);
  const panelId = `mes-panel-${account?.id || 'x'}`;

  const model = fundingModel(account);
  const figures = useMemo(() => monthFigures(openingBalance, txns), [openingBalance, txns]);
  const checks = useMemo(() => statementChecks(figures, statement), [figures, statement]);
  const blockers = useMemo(
    () => closeBlockers({ txns, figures, statement, hasReceipt, splitCount, requireReceipts }),
    [txns, figures, statement, hasReceipt, splitCount, requireReceipts],
  );
  const outcome = fundingOutcome(model, figures, account);
  const status = reconciliation?.status || 'open';
  const locked = status !== 'open';
  const ready = blockers.length === 0;
  const cur = account?.currency;
  const money = (n) => formatMoney(n, cur);

  const stage = monthEndStage(monthKey, today || new Date(), status);
  const statementDue = dmy(lastDayOfMonth(monthKey));
  const summary = stageSummary(stage, { monthLabel, blockers, statementDue });

  // The stage decides the opening position; the crew member's click always wins
  // after that, so a running month can still be worked ahead of time.
  const [userOpen, setUserOpen] = useState(null);
  const open = userOpen == null ? opensByDefault(stage) : userOpen;

  const setF = (k, v) => setStatement((p) => ({ ...p, [k]: v }));
  const save = async () => { setBusy(true); await onSaveStatement?.(statement); setBusy(false); };
  const close = async () => {
    setBusy(true);
    await onClose?.({
      openingBalance: figures.opening, closingBalance: figures.closing,
      fundingDue: outcome.amount, statement,
    });
    setBusy(false);
  };

  const diffs = blockers.filter((b) => b.key.startsWith('diff:'));
  const work = blockers.filter((b) => b.count > 0);
  const headline = closeHeadline(blockers, status, monthLabel, money);

  // What would account for the gap — driven off the first disagreeing figure.
  const candidates = useMemo(() => (diffs.length
    ? findDifferenceCandidates({
      difference: diffs[0].ours - diffs[0].theirs,
      monthTxns: txns, poolTxns: allTxns, accountId: account?.id, monthKey,
    })
    : []), [diffs, txns, allTxns, account?.id, monthKey]);

  return (
    <section className={`mes is-${stage}${ready ? ' is-ready' : ''}`}>
      {/* The control is a control and the sentence is a sentence. The whole status
          line used to BE the button, so a paragraph of ordinary prose was a click
          target — it read as something to understand, not something to press, and
          the width of it meant collapsing the section by accident. */}
      <div className="mes-head">
        <span className="mes-eyebrow">Month-end</span>
        <span className="mes-rule" />
        <span className="mes-model">{fundingModelLabel(model)}</span>
        <button type="button" className="mes-toggle" aria-expanded={open} aria-controls={panelId}
          onClick={() => setUserOpen(!open)}>
          {open ? 'Hide' : (stage === 'due' ? 'Balance it' : 'Open')}
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
        </button>
      </div>

      {/* Says where the month stands and what's worth doing today — the section is
          worth having on screen even shut. */}
      <p className={`mes-say${ready || locked ? ' is-ok' : ''}`}>
        <Icon name={ready || locked ? 'CheckCircle2' : 'AlertCircle'} size={16} />
        <span>{open ? headline : summary}</span>
      </p>

      {open && (
        <div className="mes-cols" id={panelId}>
          {/* ── the money ────────────────────────────────────────────────── */}
          <div className="mes-left">
            <p className="mes-lab">The month</p>
            <div className="mes-eq">
              <div className="r"><span>Opening balance</span><b>{money(figures.opening)}</b></div>
              <div className="r"><span>Money in</span><b>{money(figures.moneyIn)}</b></div>
              <div className="r"><span>Money out</span><b>{money(Math.abs(figures.moneyOut))}</b></div>
              <div className="r is-tot"><span>Closing balance</span><b>{money(figures.closing)}</b></div>
            </div>

            <div className="mes-stmt">
              <p className="mes-lab">
                Against the statement
                {!locked && <em className="mes-req"> required</em>}
              </p>
              <div className="mes-fields">
                {FIELDS.map((f) => {
                  const c = checks.find((x) => x.key === f.key);
                  const oursRaw = figures[f.ours];
                  const ours = f.abs ? Math.abs(oursRaw) : oursRaw;
                  return (
                    <label key={f.key} className="mes-field">
                      {/* Cargo's figure lives in the label, so the thing you're
                          checking against is never off-screen. */}
                      <span>{f.label} <em>· Cargo says {money(ours)}</em></span>
                      <input inputMode="decimal" value={statement[f.key]} disabled={locked || !canEdit}
                        onChange={(e) => setF(f.key, e.target.value)} placeholder="—"
                        className={c?.ok === false ? 'is-off' : (c?.ok ? 'is-ok' : '')} />
                      {c?.ok === false && (
                        <b className="mes-diff">
                          {c.difference > 0 ? 'over by ' : 'short by '}{money(Math.abs(c.difference))}
                        </b>
                      )}
                      {c?.ok === true && <b className="mes-match">agrees</b>}
                      {c?.ok == null && <b className="mes-none">not stated</b>}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── the work ─────────────────────────────────────────────────── */}
          <div className="mes-right">
            <p className="mes-lab">Before it can close</p>
            <ul className="mes-todo">
              {work.map((b) => (
                <li key={b.key}><b>{b.count}</b> {b.count === 1 ? 'line' : 'lines'} {b.label}</li>
              ))}
              {diffs.map((b) => (
                <li key={b.key} className="is-diff"><b>{money(b.amount)}</b> unexplained against the statement</li>
              ))}
              {ready && <li className="is-done"><Icon name="Check" size={14} /> Everything agrees</li>}
            </ul>

            {/* Cargo holds every line, both dates, the pending flag and the
                unassigned pile — so it names what would account for the gap
                rather than telling the crew to go and find it. */}
            {diffs.length > 0 && (
              <div className="mes-hunt">
                <p className="mes-hunt-lead">{differenceLead(candidates, diffs[0].ours > diffs[0].theirs)}</p>
                {candidates.map((c) => (
                  <div key={c.key} className="mes-cand">
                    <span className="mes-cand-amt">{money(c.amount)}</span>
                    <span className="mes-cand-txt">
                      {c.label}<em>{c.action}</em>
                    </span>
                    {onShowLine && (
                      <button type="button" className="mes-cand-go" onClick={() => onShowLine(c.txnIds[0])}>
                        Show {c.txnIds.length > 1 ? 'them' : 'it'} <Icon name="ArrowRight" size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <p className="mes-hunt-foot">
                  Suggestions only &mdash; Cargo changes nothing on a hunch, and won&rsquo;t
                  close a month it can&rsquo;t explain.
                </p>
              </div>
            )}

            <div className="mes-out">
              <p className="mes-lab">{outcome.label}</p>
              <b>{money(outcome.amount)}</b>
              {outcome.overspent > 0 && (
                <em className="mes-over">overspent by {money(outcome.overspent)}</em>
              )}
              <em>{outcome.note}</em>
            </div>

            {canEdit && !locked && (
              <div className="mes-act">
                <button type="button" className="mes-btn ghost" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save figures'}
                </button>
                <button type="button" className="mes-btn primary" onClick={close} disabled={busy || !ready}
                  title={ready ? `Close ${monthLabel}` : headline}>
                  Close {monthLabel}
                </button>
              </div>
            )}
            {locked && <p className="mes-locked">Reopen it from Check-off if something needs changing.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
