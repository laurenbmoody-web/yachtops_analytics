// Ledger modals — add a manual transaction, and assign an account to an
// unreconciled (auto-posted) row. Both editorial, portaled via ModalShell.
import React, { useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import { deriveAmountBase, formatMoney } from '../../../services/financeCalc';

const CURRENCIES = ['EUR', 'GBP', 'USD'];
const todayISO = () => new Date().toISOString().slice(0, 10);

// ── Manual transaction ────────────────────────────────────────────────────────
export function ManualTxnModal({ open, onClose, onSave, accounts }) {
  const [direction, setDirection] = useState('out'); // out = money out (negative)
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;
  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency || 'EUR';

  const submit = async (e) => {
    e.preventDefault();
    const mag = Number(amount);
    if (!mag || Number.isNaN(mag) || mag <= 0) { setErr('Enter a positive amount.'); return; }
    setBusy(true); setErr('');
    const signed = direction === 'out' ? -Math.abs(mag) : Math.abs(mag);
    const { error } = await onSave({
      account_id: accountId || null,
      txn_date: date,
      amount: signed,
      currency,
      fx_rate: 1,
      amount_base: deriveAmountBase(signed, 1),
      category: category.trim() || null,
      description: description.trim() || null,
      source: 'manual',
    });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not add the transaction.'); return; }
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="ca-modal" isBusy={busy}>
      <form onSubmit={submit}>
        <h2 className="ca-modal-title">Add transaction</h2>
        <p className="ca-modal-sub">A manual money movement in the ledger.</p>

        <div className="ca-form-row ca-form-grid">
          <div>
            <label className="ca-label" htmlFor="ca-tx-dir">Direction</label>
            <select id="ca-tx-dir" className="ca-select" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="out">Money out (−)</option>
              <option value="in">Money in (+)</option>
            </select>
          </div>
          <div>
            <label className="ca-label" htmlFor="ca-tx-amt">Amount <span className="req">required</span></label>
            <input id="ca-tx-amt" className="ca-input ca-num" type="number" step="0.01" min="0" inputMode="decimal"
              value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>
        </div>

        <div className="ca-form-row ca-form-grid">
          <div>
            <label className="ca-label" htmlFor="ca-tx-acct">Account <span className="opt">optional</span></label>
            <select id="ca-tx-acct" className="ca-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Unassigned</option>
              {accounts.filter((a) => a.is_active !== false).map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="ca-label" htmlFor="ca-tx-date">Date</label>
            <input id="ca-tx-date" className="ca-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-tx-cat">Category <span className="opt">optional</span></label>
          <input id="ca-tx-cat" className="ca-input" value={category} onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. fuel, provisioning, dockage" />
        </div>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-tx-desc">Description <span className="opt">optional</span></label>
          <input id="ca-tx-desc" className="ca-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {amount && !Number.isNaN(Number(amount)) && (
          <p className="ca-modal-sub" style={{ marginBottom: 0 }}>
            Will post{' '}
            <span className={direction === 'out' ? 'ca-neg' : 'ca-pos'}>
              {formatMoney(direction === 'out' ? -Math.abs(Number(amount)) : Math.abs(Number(amount)), currency, { signed: true })}
            </span>
            {account ? ` to ${account.name}` : ' to the Needs-attention queue'}.
          </p>
        )}

        {err && <div className="ca-modal-err">{err}</div>}

        <div className="ca-modal-foot">
          <button type="button" className="ca-btn ca-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="ca-btn ca-btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add transaction'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Assign account to an unreconciled row ─────────────────────────────────────
export function AssignAccountModal({ open, onClose, onAssign, txn, accounts }) {
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open || !txn) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!accountId) { setErr('Choose an account.'); return; }
    setBusy(true); setErr('');
    const { error } = await onAssign(txn.id, accountId);
    setBusy(false);
    if (error) { setErr(error.message || 'Could not assign the account.'); return; }
    onClose();
  };

  const eligible = accounts.filter((a) => a.is_active !== false);
  const currencyMismatch = accountId
    && eligible.find((a) => a.id === accountId)?.currency !== txn.currency;

  return (
    <ModalShell onClose={onClose} panelClassName="ca-modal" isBusy={busy}>
      <form onSubmit={submit}>
        <h2 className="ca-modal-title">Assign account</h2>
        <p className="ca-modal-sub">
          {formatMoney(txn.amount, txn.currency, { signed: true })} · {txn.description || 'transaction'}
        </p>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-assign">Account <span className="req">required</span></label>
          <select id="ca-assign" className="ca-select" value={accountId} onChange={(e) => setAccountId(e.target.value)} autoFocus>
            <option value="">Choose…</option>
            {eligible.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </div>

        {currencyMismatch && (
          <p className="ca-modal-sub" style={{ color: '#B14E16' }}>
            Heads up — this row is in {txn.currency} but the account isn’t. Its converted value may need a manual FX rate.
          </p>
        )}

        <p className="ca-modal-sub" style={{ marginBottom: 0 }}>Assigning marks the row reconciled and clears it from Needs attention.</p>

        {err && <div className="ca-modal-err">{err}</div>}

        <div className="ca-modal-foot">
          <button type="button" className="ca-btn ca-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="ca-btn ca-btn-primary" disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
        </div>
      </form>
    </ModalShell>
  );
}
