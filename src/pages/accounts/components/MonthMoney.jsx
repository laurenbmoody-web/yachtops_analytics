// Cargo Accounts — the month's money, beside the wallet it belongs to.
//
// This used to be two blocks on one page: a money out / money in / net summary up
// here, and a second opening → closing ladder inside the month-end section a few
// hundred pixels below. Same month, same account, same figures, written twice —
// and the statement you check them against was down with the second copy, so the
// numbers and the check on them were never on screen together.
//
// One panel now. When a card is chosen it carries the whole cash-book equation
// and the statement fields that test it; on "All" there is no single statement to
// test against, so it stays the summary it was.
import React from 'react';
import { formatMoney } from '../../../services/financeCalc';
import './month-money.css';

const FIELDS = [
  { key: 'moneyOut', label: 'Total out', ours: 'moneyOut', abs: true },
  { key: 'moneyIn', label: 'Total in', ours: 'moneyIn' },
  { key: 'closing', label: 'Closing balance', ours: 'closing' },
];

export default function MonthMoney({
  currency, scoped, figures, monthStat, statement, checks = [],
  canEdit, locked, busy, onField, onSave,
}) {
  const money = (n) => formatMoney(n, currency);
  const signed = (n) => formatMoney(n, currency, { signed: true });

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
        // account and one statement, and adding them up would mean nothing.
        <div className="mm-eq">
          <div className="r"><span>Money out</span><b className="neg">{signed(monthStat.outSum)}</b></div>
          <div className="r"><span>Money in</span><b>{signed(monthStat.inSum)}</b></div>
          <div className="r is-tot"><span>Net</span><b>{signed(monthStat.net)}</b></div>
        </div>
      )}

      {scoped && (
        <div className="mm-stmt">
          <p className="mm-lab">
            Against the statement
            {!locked && <em className="mm-req"> required</em>}
          </p>
          <div className="mm-fields">
            {FIELDS.map((f) => {
              const c = checks.find((x) => x.key === f.key);
              const ours = f.abs ? Math.abs(figures[f.ours]) : figures[f.ours];
              return (
                <label key={f.key} className="mm-field">
                  {/* Cargo's own figure sits in the label, so the thing you're
                      checking against is never off-screen while you type. */}
                  <span>{f.label} <em>· Cargo says {money(ours)}</em></span>
                  <input inputMode="decimal" value={statement[f.key]} disabled={locked || !canEdit}
                    onChange={(e) => onField?.(f.key, e.target.value)} placeholder="—"
                    className={c?.ok === false ? 'is-off' : (c?.ok ? 'is-ok' : '')} />
                  {c?.ok === false && (
                    <b className="mm-diff">
                      {c.difference > 0 ? 'over by ' : 'short by '}{money(Math.abs(c.difference))}
                    </b>
                  )}
                  {c?.ok === true && <b className="mm-match">agrees</b>}
                  {c?.ok == null && <b className="mm-none">not stated</b>}
                </label>
              );
            })}
          </div>
          {/* Saving is what you do to these fields, so it lives with them. Closing
              the month is a different act and sits with the reasons it can't. */}
          {canEdit && !locked && (
            <button type="button" className="mm-save" onClick={onSave} disabled={busy}>
              {busy ? 'Saving…' : 'Save figures'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
