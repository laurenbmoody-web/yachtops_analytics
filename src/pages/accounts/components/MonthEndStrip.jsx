// Cargo Accounts — the month-end close, on the page where the work happens.
//
// Reconciliation is per account, so this only appears once an account is chosen.
// It shows the month's own arithmetic against what the bank statement says, and
// refuses to close while they disagree. There is deliberately no way to plug a
// difference: an unexplained gap is the thing this screen exists to surface.
//
// What it asks for after that depends on how the account is funded — a float wants
// its top-up, a prepaid card wants a balance check, an APA owes money back.
import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { formatMoney } from '../../../services/financeCalc';
import {
  fundingModel, fundingModelLabel, monthFigures, statementChecks,
  fundingOutcome, closeBlockers, closeMessage,
} from '../../../services/monthEnd';
import './month-end-strip.css';

const FIELDS = [
  { key: 'moneyOut', label: 'Total out', hint: 'the figure to match' },
  { key: 'moneyIn', label: 'Total in' },
  { key: 'closing', label: 'Closing balance' },
];

export default function MonthEndStrip({
  account, monthLabel, txns, openingBalance, reconciliation,
  hasReceipt, splitCount, canEdit, onSaveStatement, onClose, requireReceipts = true,
}) {
  const [statement, setStatement] = useState({
    moneyOut: reconciliation?.stmt_money_out ?? '',
    moneyIn: reconciliation?.stmt_money_in ?? '',
    closing: reconciliation?.stmt_closing ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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

  const setF = (k, v) => setStatement((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    await onSaveStatement?.(statement);
    setBusy(false);
  };

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

  return (
    <section className={`mes${ready ? ' is-ready' : ''}${locked ? ' is-locked' : ''}`}>
      <button type="button" className="mes-bar" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={ready || locked ? 'CheckCircle2' : 'AlertCircle'} size={16} />
        <span className="mes-title">{monthLabel} · {account?.name}</span>
        <span className="mes-msg">{closeMessage(blockers, status)}</span>
        <span className="mes-model">{fundingModelLabel(model)}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} />
      </button>

      {open && (
        <div className="mes-body">
          {/* Cargo's own arithmetic for the month */}
          <div className="mes-eq">
            <span><i>Opening</i><b>{formatMoney(figures.opening, cur)}</b></span>
            <em>+</em>
            <span><i>In</i><b>{formatMoney(figures.moneyIn, cur)}</b></span>
            <em>−</em>
            <span><i>Out</i><b>{formatMoney(Math.abs(figures.moneyOut), cur)}</b></span>
            <em>=</em>
            <span className="is-total"><i>Closing</i><b>{formatMoney(figures.closing, cur)}</b></span>
          </div>

          {/* What the statement says, and whether we agree */}
          <div className="mes-stmt">
            <p className="mes-lab">From the bank statement</p>
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
          </div>

          {/* Why it can't close yet */}
          {!ready && (
            <ul className="mes-blockers">
              {blockers.map((b) => (
                <li key={b.key}>
                  {b.count ? <b>{b.count}</b> : null} {b.label}
                  {b.amount != null ? <b> · {formatMoney(b.amount, cur)}</b> : null}
                </li>
              ))}
            </ul>
          )}

          {/* What this account's funding model needs next */}
          <div className="mes-outcome">
            <span className="mes-lab">{outcome.label}</span>
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
                title={ready ? 'Close this month' : closeMessage(blockers, status)}>
                Close {monthLabel}
              </button>
            </div>
          )}
          {locked && <p className="mes-locked">{closeMessage(blockers, status)} Reopen it from Check-off if something needs changing.</p>}
        </div>
      )}
    </section>
  );
}
