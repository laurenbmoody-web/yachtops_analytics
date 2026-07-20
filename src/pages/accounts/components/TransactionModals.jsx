// Ledger modals — add a manual transaction, and assign an account to an
// unreconciled (auto-posted) row. Both editorial, portaled via ModalShell.
import React, { useState, useEffect, useMemo } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import { deriveAmountBase, formatMoney } from '../../../services/financeCalc';
import { STANDARD_CHART_OF_ACCOUNTS, STANDARD_BUCKET_ORDER } from '../budgets/data/mybaChartOfAccounts';
import { getChartGrouped } from '../../../services/chartService';

const CURRENCIES = ['EUR', 'GBP', 'USD'];
const todayISO = () => new Date().toISOString().slice(0, 10);

// Fallback grouped chart from the MYBA standard template — used only until a
// tenant's own chart_of_accounts loads (or if they haven't set one up yet).
const FALLBACK_GROUPS = STANDARD_BUCKET_ORDER
  .map((bucket) => ({ bucket, lines: STANDARD_CHART_OF_ACCOUNTS.filter((c) => c.bucket === bucket) }))
  .filter((g) => g.lines.length);

// Build the category picker (grouped options + a key→line lookup) from either the
// tenant's chart or the fallback. A chosen line stamps both category + code so the
// spend reconciles into the right bucket deterministically. Lines may have no code
// (custom charts), so the option key falls back to id, then the category label.
function buildPicker(groups) {
  const lineByKey = {};
  const uiGroups = (groups || []).map((g) => ({
    bucket: g.bucket,
    lines: g.lines.map((l) => {
      const key = l.code || l.id || `cat:${l.category}`;
      lineByKey[key] = { code: l.code || null, category: l.category };
      return { key, code: l.code || null, category: l.category };
    }),
  })).filter((g) => g.lines.length);
  return { uiGroups, lineByKey };
}

// ── Manual transaction ────────────────────────────────────────────────────────
export function ManualTxnModal({ open, onClose, onSave, onUploadReceipt, accounts, tenantId }) {
  const [chartGroups, setChartGroups] = useState(null); // null until loaded → use fallback
  const [direction, setDirection] = useState('out'); // out = money out (negative)
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [catCode, setCatCode] = useState('');        // '' none | code | '__other__'
  const [customCat, setCustomCat] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [payee, setPayee] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [vatRate, setVatRate] = useState('');
  const [currencyOverride, setCurrencyOverride] = useState('');
  const [fxRate, setFxRate] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Load the tenant's own chart of accounts when the modal opens; fall back to
  // the MYBA template if the tenant has no chart yet or the load fails.
  useEffect(() => {
    if (!open || !tenantId) return;
    let alive = true;
    getChartGrouped(tenantId).then(({ data, error }) => {
      if (alive && !error && data?.length) setChartGroups(data);
    });
    return () => { alive = false; };
  }, [open, tenantId]);

  const { uiGroups, lineByKey } = useMemo(
    () => buildPicker(chartGroups || FALLBACK_GROUPS),
    [chartGroups],
  );

  if (!open) return null;
  const account = accounts.find((a) => a.id === accountId);
  const acctCurrency = account?.currency || 'EUR';
  const currency = currencyOverride || acctCurrency;
  const crossCurrency = currencyOverride && currencyOverride !== acctCurrency;

  const submit = async (e) => {
    e.preventDefault();
    const mag = Number(amount);
    if (!mag || Number.isNaN(mag) || mag <= 0) { setErr('Enter a positive amount.'); return; }
    const fx = crossCurrency ? (Number(fxRate) || 1) : 1;
    setBusy(true); setErr('');
    const signed = direction === 'out' ? -Math.abs(mag) : Math.abs(mag);
    const line = catCode && catCode !== '__other__' ? lineByKey[catCode] : null;
    const res = await onSave({
      account_id: accountId || null,
      txn_date: date,
      amount: signed,
      currency,
      fx_rate: fx,
      amount_base: deriveAmountBase(signed, fx),
      category: line ? line.category : (customCat.trim() || null),
      category_code: line ? line.code : null,
      payee: payee.trim() || null,
      vat_amount: vatAmount !== '' ? Number(vatAmount) : null,
      vat_rate: vatRate !== '' ? Number(vatRate) : null,
      description: description.trim() || null,
      source: 'manual',
    });
    if (res?.error) { setBusy(false); setErr(res.error.message || 'Could not add the transaction.'); return; }
    // Attach the receipt to the freshly-created row, if one was chosen.
    if (receipt && res?.data?.id && onUploadReceipt) {
      const up = await onUploadReceipt(res.data.id, receipt);
      if (up?.error) { setBusy(false); setErr('Transaction saved, but the receipt didn’t upload. Try re-attaching it.'); return; }
    }
    setBusy(false);
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
          <select id="ca-tx-cat" className="ca-select" value={catCode} onChange={(e) => setCatCode(e.target.value)}>
            <option value="">— None —</option>
            {uiGroups.map((g) => (
              <optgroup key={g.bucket} label={g.bucket}>
                {g.lines.map((c) => (
                  <option key={c.key} value={c.key}>{c.code ? `${c.code} — ${c.category}` : c.category}</option>
                ))}
              </optgroup>
            ))}
            <option value="__other__">Other (type your own)…</option>
          </select>
          {catCode === '__other__' && (
            <input className="ca-input" style={{ marginTop: 8 }} value={customCat} onChange={(e) => setCustomCat(e.target.value)}
              placeholder="e.g. dockage, courier" />
          )}
        </div>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-tx-desc">Description <span className="opt">optional</span></label>
          <input id="ca-tx-desc" className="ca-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-tx-rcpt">Receipt <span className="opt">optional</span></label>
          <input id="ca-tx-rcpt" className="ca-input" type="file" accept="image/*,application/pdf"
            onChange={(e) => setReceipt(e.target.files?.[0] || null)} />
          {receipt && <p className="ca-modal-sub" style={{ margin: '6px 0 0' }}>Attached: {receipt.name}</p>}
        </div>

        <button type="button" className="ca-link" style={{ marginTop: 4 }} onClick={() => setShowDetail((v) => !v)}>
          {showDetail ? '− Hide detail' : '+ Add detail (payee, VAT, currency)'}
        </button>

        {showDetail && (
          <>
            <div className="ca-form-row" style={{ marginTop: 12 }}>
              <label className="ca-label" htmlFor="ca-tx-payee">Payee <span className="opt">optional</span></label>
              <input id="ca-tx-payee" className="ca-input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Who was paid / who paid" />
            </div>
            <div className="ca-form-row ca-form-grid">
              <div>
                <label className="ca-label" htmlFor="ca-tx-vat">VAT amount <span className="opt">optional</span></label>
                <input id="ca-tx-vat" className="ca-input ca-num" type="number" step="0.01" min="0" inputMode="decimal"
                  value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="ca-label" htmlFor="ca-tx-vatr">VAT rate % <span className="opt">optional</span></label>
                <input id="ca-tx-vatr" className="ca-input ca-num" type="number" step="0.1" min="0" inputMode="decimal"
                  value={vatRate} onChange={(e) => setVatRate(e.target.value)} placeholder="20" />
              </div>
            </div>
            <div className="ca-form-row ca-form-grid">
              <div>
                <label className="ca-label" htmlFor="ca-tx-cur">Currency</label>
                <select id="ca-tx-cur" className="ca-select" value={currency} onChange={(e) => setCurrencyOverride(e.target.value)}>
                  {[...new Set([acctCurrency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {crossCurrency && (
                <div>
                  <label className="ca-label" htmlFor="ca-tx-fx">FX rate → {acctCurrency}</label>
                  <input id="ca-tx-fx" className="ca-input ca-num" type="number" step="0.0001" min="0" inputMode="decimal"
                    value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1.00" />
                </div>
              )}
            </div>
            {crossCurrency && (
              <p className="ca-modal-sub" style={{ marginTop: 0 }}>
                Reporting value: {formatMoney((direction === 'out' ? -Math.abs(Number(amount) || 0) : Math.abs(Number(amount) || 0)) * (Number(fxRate) || 1), acctCurrency, { signed: true })}
              </p>
            )}
          </>
        )}

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
