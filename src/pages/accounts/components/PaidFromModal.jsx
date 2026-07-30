// Cargo Accounts — "which account settled this invoice?", asked once, at the
// moment of payment.
//
// It is asked here because here is the only place anyone knows the answer. Marking
// an invoice paid posts a line straight into Spending; without this the line lands
// Unassigned and the crew are asked days later to remember which of eight accounts
// — three of them called "Owner card" — the money left from.
import React, { useState, useEffect } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import { formatMoney } from '../../../services/financeCalc';
import { accountLabel, groupAccounts, defaultAccountId } from '../../../services/accountPick';
import '../accounts.css';

export default function PaidFromModal({ open, invoice, accounts = [], me = {}, onClose, onConfirm }) {
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const currency = invoice?.currency || 'EUR';
  useEffect(() => {
    if (!open || !invoice) return;
    setAccountId(defaultAccountId(accounts, { ...me, currency }));
    setErr('');
  }, [open, invoice?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !invoice) return null;

  const groups = groupAccounts(accounts, me);
  const chosen = accounts.find((a) => a.id === accountId);
  const mismatch = chosen && chosen.currency !== currency;

  const submit = async (e) => {
    e.preventDefault();
    if (!accountId) { setErr('Choose the account this was paid from.'); return; }
    setBusy(true); setErr('');
    const res = await onConfirm(invoice, accountId);
    setBusy(false);
    if (res?.error) { setErr(res.error.message || 'Could not mark it paid.'); return; }
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="ca-modal" isBusy={busy}>
      <form onSubmit={submit}>
        <h2 className="ca-modal-title">Mark paid</h2>
        <p className="ca-modal-sub">
          {invoice.invoice_number} · {invoice.supplier?.name || 'Supplier'} · {formatMoney(invoice.amount, currency)}
        </p>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="pf-acct">Paid from <span className="req">required</span></label>
          <select id="pf-acct" className="ca-select" value={accountId} autoFocus
            onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {mismatch && (
          <p className="ca-modal-sub" style={{ color: '#B14E16' }}>
            Heads up — the invoice is in {currency} but that account is in {chosen.currency}. The posted line will need an FX rate.
          </p>
        )}

        <p className="ca-modal-sub" style={{ marginBottom: 0 }}>
          This posts the spend to that account straight away, so it arrives in Spending already assigned.
        </p>

        {err && <div className="ca-modal-err">{err}</div>}

        <div className="ca-modal-foot">
          <button type="button" className="ca-btn ca-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="ca-btn ca-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Mark paid'}</button>
        </div>
      </form>
    </ModalShell>
  );
}
