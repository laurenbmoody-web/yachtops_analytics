// Add / edit a budget breakdown line (bucket + category + amount). Editorial modal.
import React, { useState } from 'react';
import ModalShell from '../../../../components/ui/ModalShell';

export default function LineFormModal({ open, onClose, onSave, onDelete, initial, buckets = [], categories = [] }) {
  const [bucket, setBucket] = useState(initial?.bucket || '');
  const [category, setCategory] = useState(initial?.category || '');
  const [code, setCode] = useState(initial?.code || '');
  const [kind, setKind] = useState(initial?.kind || 'expense');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;
  const isEdit = Boolean(initial?.id);

  const submit = async (e) => {
    e.preventDefault();
    if (!bucket.trim()) { setErr('Choose or name a bucket.'); return; }
    if (!category.trim()) { setErr('Name the breakdown line.'); return; }
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt < 0) { setErr('Amount must be zero or more.'); return; }
    setBusy(true); setErr('');
    const { error } = await onSave({
      id: initial?.id, bucket: bucket.trim(), category: category.trim(),
      code: code.trim() || null, kind, amount: amt, notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(/duplicate|unique/i.test(error.message || '') ? 'That bucket + line already exists on this budget.' : (error.message || 'Could not save.'));
      return;
    }
    onClose();
  };

  const remove = async () => {
    if (!window.confirm('Delete this budget line?')) return;
    setBusy(true);
    const { error } = await onDelete(initial.id);
    setBusy(false);
    if (error) { setErr('Could not delete — please try again.'); return; }
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="bg-modal" isBusy={busy}>
      <form onSubmit={submit}>
        <h2 className="bg-modal-title">{isEdit ? 'Edit line' : 'Add line'}</h2>
        <p className="bg-modal-sub">A breakdown line under a bucket. The category matches how spend is tagged in the ledger.</p>

        <div className="bg-form-row">
          <label className="bg-label" htmlFor="bg-bucket">Bucket <span className="req">required</span></label>
          <input id="bg-bucket" className="bg-input" list="bg-buckets" value={bucket} onChange={(e) => setBucket(e.target.value)}
            placeholder="e.g. Provisioning" autoFocus />
          <datalist id="bg-buckets">{buckets.map((b) => <option key={b} value={b} />)}</datalist>
        </div>

        <div className="bg-form-row bg-form-grid">
          <div>
            <label className="bg-label" htmlFor="bg-code">Code <span className="opt">optional</span></label>
            <input id="bg-code" className="bg-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. FLE" maxLength={8} />
          </div>
          <div>
            <label className="bg-label" htmlFor="bg-kind">Type</label>
            <select id="bg-kind" className="bg-select" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="expense">Expenditure</option>
              <option value="revenue">Revenue</option>
            </select>
          </div>
        </div>

        <div className="bg-form-row">
          <label className="bg-label" htmlFor="bg-cat">Breakdown line <span className="req">required</span></label>
          <input id="bg-cat" className="bg-input" list="bg-cats" value={category} onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Galley food" />
          <datalist id="bg-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>

        <div className="bg-form-row">
          <label className="bg-label" htmlFor="bg-amt">Budgeted amount <span className="opt">in the budget's currency</span></label>
          <input id="bg-amt" className="bg-input bg-num" type="number" step="0.01" min="0" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>

        <div className="bg-form-row">
          <label className="bg-label" htmlFor="bg-notes">Comment <span className="opt">optional — variance note</span></label>
          <input id="bg-notes" className="bg-input" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Will reduce — no guests next 6 months" />
        </div>

        {err && <div className="bg-modal-err">{err}</div>}

        <div className="bg-modal-foot">
          {isEdit ? <button type="button" className="bg-link is-mut" onClick={remove} disabled={busy}>Delete</button> : <span className="spacer" />}
          <span className="spacer" />
          <button type="button" className="bg-btn bg-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bg-btn bg-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </ModalShell>
  );
}
