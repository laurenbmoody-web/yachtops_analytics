// Cargo Accounts — balancing one card's month, on the page where the work happens.
//
// The job is one question: does Cargo's arithmetic agree with the bank statement?
// So the section is laid out as that question, in order — what Cargo makes it,
// what the statement says, what's stopping it closing — with a single instruction
// at the top saying which of those to act on next.
//
// There is deliberately no way to plug a difference. An unexplained gap is the
// thing this screen exists to surface, and a "close anyway" button would make
// every closed month meaningless.
//
// What it asks for after the match depends on how the account is funded — a float
// wants its top-up, a prepaid card wants a balance check, an APA owes money back.
import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { formatMoney } from '../../../services/financeCalc';
import {
  fundingModel, fundingModelLabel, monthFigures, statementChecks,
  fundingOutcome, closeBlockers, closeHeadline,
} from '../../../services/monthEnd';
import { findDifferenceCandidates, differenceLead } from '../../../services/differenceHunt';
import './month-end-strip.css';

const FIELDS = [
  { key: 'moneyOut', label: 'Total out', hint: 'the figure to match' },
  { key: 'moneyIn', label: 'Total in' },
  { key: 'closing', label: 'Closing balance' },
];

export default function MonthEndStrip({
  account, monthLabel, monthKey, txns, allTxns = [], openingBalance, reconciliation,
  hasReceipt, splitCount, canEdit, onSaveStatement, onClose, onShowLine,
  requireReceipts = true,
}) {
  const [statement, setStatement] = useState({
    moneyOut: reconciliation?.stmt_money_out ?? '',
    moneyIn: reconciliation?.stmt_money_in ?? '',
    closing: reconciliation?.stmt_closing ?? '',
  });
  const [busy, setBusy] = useState(false);

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
  const headline = closeHeadline(blockers, status, monthLabel, (n) => formatMoney(n, cur));

  // Once it's signed off there is nothing to do here, so it takes no space until asked.
  const [open, setOpen] = useState(true);
  const showBody = open && !locked;

  const setF = (k, v) => setStatement((p) => ({ ...p, [k]: v }));

  const save = async () => { setBusy(true); await onSaveStatement?.(statement); setBusy(false); };

  const close = async () => {
    setBusy(true);
    await onClose?.({
      openingBalance: figures.opening,
      closingBalance: figures.closing,
      fundingDue: outcome.amount,
      statement,
    });
    setBusy(false);
  };

  // Lines to fix live in the list below; a figure that disagrees is this section's
  // own problem. Separating them stops "97 to categorise" from burying "out by £40".
  const diffs = blockers.filter((b) => b.key.startsWith('diff:'));
  const work = blockers.filter((b) => b.count > 0);

  // What would account for the gap. Driven off the first disagreeing figure —
  // chasing several at once produces noise, and fixing one usually fixes the rest.
  const candidates = useMemo(() => (diffs.length
    ? findDifferenceCandidates({
      difference: diffs[0].ours - diffs[0].theirs,
      monthTxns: txns, poolTxns: allTxns, accountId: account?.id, monthKey,
    })
    : []), [diffs, txns, allTxns, account?.id, monthKey]);

  return (
    <section className={`mes${ready ? ' is-ready' : ''}${locked ? ' is-locked' : ''}`}>
      <div className="mes-head">
        <span className="mes-eyebrow">Month-end</span>
        <span className="mes-rule" />
        <span className="mes-model">{fundingModelLabel(model)}</span>
        {locked && (
          <button type="button" className="mes-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'} figures
          </button>
        )}
      </div>

      {/* The one thing to do next. Everything below is the detail behind it. */}
      <p className="mes-headline">
        <Icon name={ready || locked ? 'CheckCircle2' : 'AlertCircle'} size={16} />
        <span>{headline}</span>
      </p>

      {(showBody || (locked && open)) && (
        <div className="mes-body">
          {/* Cargo's own arithmetic for the month */}
          <div className="mes-block">
            <p className="mes-lab">What Cargo makes it</p>
            <div className="mes-eq">
              <span><i>Opening</i><b>{formatMoney(figures.opening, cur)}</b></span>
              <em>+</em>
              <span><i>In</i><b>{formatMoney(figures.moneyIn, cur)}</b></span>
              <em>−</em>
              <span><i>Out</i><b>{formatMoney(Math.abs(figures.moneyOut), cur)}</b></span>
              <em>=</em>
              <span className="is-total"><i>Closing</i><b>{formatMoney(figures.closing, cur)}</b></span>
            </div>
          </div>

          {/* What the statement says, and whether we agree */}
          <div className="mes-block">
            <p className="mes-lab">
              What the statement says
              {!locked && <em className="mes-req"> required</em>}
            </p>
            <div className="mes-fields">
              {FIELDS.map((f) => {
                const c = checks.find((x) => x.key === f.key);
                return (
                  <label key={f.key} className="mes-field">
                    <span>{f.label}{f.hint ? <em> · {f.hint}</em> : null}</span>
                    <input inputMode="decimal" value={statement[f.key]} disabled={locked || !canEdit}
                      onChange={(e) => setF(f.key, e.target.value)} placeholder="—"
                      className={c?.ok === false ? 'is-off' : (c?.ok ? 'is-ok' : '')} />
                    {c?.ok === false && (
                      <b className="mes-diff">
                        {c.difference > 0 ? 'Cargo is over by ' : 'Cargo is short by '}
                        {formatMoney(Math.abs(c.difference), cur)}
                      </b>
                    )}
                    {c?.ok === true && <b className="mes-match">matches</b>}
                  </label>
                );
              })}
            </div>
            {/* Cargo holds every line, both dates, the pending flag and the
                unassigned pile — so rather than telling the crew to go and find
                the gap, it names the lines that would account for it. Suggestions
                only: nothing is edited, and the month still can't be plugged. */}
            {diffs.length > 0 && (
              <div className="mes-hunt">
                <p className="mes-hunt-lead">{differenceLead(candidates, diffs[0].ours > diffs[0].theirs)}</p>
                {candidates.map((c) => (
                  <div key={c.key} className="mes-cand">
                    <span className="mes-cand-amt">{formatMoney(c.amount, cur)}</span>
                    <span className="mes-cand-txt">
                      {c.label}
                      <em>{c.action}</em>
                    </span>
                    {onShowLine && (
                      <button type="button" className="mes-cand-go"
                        onClick={() => onShowLine(c.txnIds[0])}>
                        Show {c.txnIds.length > 1 ? 'them' : 'it'}
                        <Icon name="ArrowRight" size={13} />
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
          </div>

          {/* Lines that still need work — the fixing happens in the list below */}
          {work.length > 0 && (
            <div className="mes-block">
              <p className="mes-lab">Still to sort, in the lines below</p>
              <ul className="mes-blockers">
                {work.map((b) => (
                  <li key={b.key}><b>{b.count}</b> {b.count === 1 ? 'line' : 'lines'} {b.label}</li>
                ))}
              </ul>
            </div>
          )}

          {/* What this account's funding model needs next */}
          <div className="mes-block mes-outcome">
            <p className="mes-lab">{outcome.label}</p>
            <b>{formatMoney(outcome.amount, cur)}</b>
            {outcome.overspent > 0 && (
              <em className="mes-over">overspent by {formatMoney(outcome.overspent, cur)}</em>
            )}
            <em>{outcome.note}</em>
          </div>

          {canEdit && !locked && (
            <div className="mes-act">
              <button type="button" className="mes-btn ghost" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save statement figures'}
              </button>
              <button type="button" className="mes-btn primary" onClick={close} disabled={busy || !ready}
                title={ready ? `Close ${monthLabel}` : headline}>
                Close {monthLabel}
              </button>
            </div>
          )}
        </div>
      )}

      {locked && <p className="mes-locked">Reopen it from Check-off if something needs changing.</p>}
    </section>
  );
}
