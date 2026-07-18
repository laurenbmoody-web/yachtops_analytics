// New / edit budget — editorial modal (portaled via ModalShell).
import React, { useState } from 'react';
import ModalShell from '../../../../components/ui/ModalShell';
import EditorialDatePicker from '../../../../components/editorial/EditorialDatePicker';
import { datePlaceholder } from '../../../../utils/dateFormat';

const CURRENCIES = ['EUR', 'GBP', 'USD'];

export default function BudgetFormModal({ open, onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || '');
  const [start, setStart] = useState(initial?.period_start || '');
  const [end, setEnd] = useState(initial?.period_end || '');
  const [currency, setCurrency] = useState(initial?.currency || 'EUR');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;
  const isEdit = Boolean(initial?.id);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the budget a name.'); return; }
    if (!start || !end) { setErr('Set a start and end date.'); return; }
    if (end < start) { setErr('End date must be on or after the start date.'); return; }
    setBusy(true); setErr('');
    const { error } = await onSave({ name: name.trim(), period_start: start, period_end: end, currency });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not save the budget.'); return; }
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="bg-modal" isBusy={busy}>
      <form onSubmit={submit}>
        <h2 className="bg-modal-title">{isEdit ? 'Edit budget' : 'New budget'}</h2>
        <p className="bg-modal-sub">A spending plan for a period, e.g. "2026 Season".</p>

        <div className="bg-form-row">
          <label className="bg-label" htmlFor="bg-name">Name <span className="req">required</span></label>
          <input id="bg-name" className="bg-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2026 Season" autoFocus />
        </div>

        <div className="bg-form-row bg-form-grid">
          <div>
            <label className="bg-label">Period start <span className="req">required</span></label>
            <EditorialDatePicker value={start} onChange={setStart} ariaLabel="Period start" placeholder={datePlaceholder()} />
          </div>
          <div>
            <label className="bg-label">Period end <span className="req">required</span></label>
            <EditorialDatePicker value={end} onChange={setEnd} ariaLabel="Period end" rangeStart={start} placeholder={datePlaceholder()} />
          </div>
        </div>

        <div className="bg-form-row">
          <label className="bg-label" htmlFor="bg-cur">Currency</label>
          <select id="bg-cur" className="bg-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {err && <div className="bg-modal-err">{err}</div>}

        <div className="bg-modal-foot">
          <span className="spacer" />
          <button type="button" className="bg-btn bg-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="bg-btn bg-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save' : 'Create budget')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
