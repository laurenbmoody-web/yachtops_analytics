// Add / edit a financial account — editorial modal (portaled via ModalShell).
// Command lists the vessel's accounts here: bank accounts, and the crew cards /
// petty-cash floats each holder carries (Owner vs Charter APA funds).
import React, { useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';

const KINDS = [
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'petty_cash', label: 'Petty cash' },
];
const FUNDS = [
  { value: 'general', label: 'General' },
  { value: 'owner', label: 'Owner' },
  { value: 'charter_apa', label: 'Charter APA' },
];
const CURRENCIES = ['EUR', 'GBP', 'USD'];
// Common holders — free text (a datalist), so any role/name works.
const HOLDER_SUGGESTIONS = ['Vessel', 'Captain', 'Chief Engineer', 'Chief Stewardess', 'Bosun', 'Chef', 'Purser'];

export default function AccountFormModal({ open, onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState(initial?.kind || 'bank');
  const [fundsType, setFundsType] = useState(initial?.funds_type || 'general');
  const [holderRole, setHolderRole] = useState(initial?.holder_role || '');
  const [currency, setCurrency] = useState(initial?.currency || 'EUR');
  const [cardLast4, setCardLast4] = useState(initial?.card_last4 || '');
  const [provider, setProvider] = useState(initial?.provider || '');
  const [openingBalance, setOpeningBalance] = useState(
    initial?.opening_balance != null ? String(initial.opening_balance) : '0',
  );
  const [notes, setNotes] = useState(initial?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;
  const isEdit = Boolean(initial?.id);
  const isCard = kind === 'card';

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the account a name.'); return; }
    const opening = Number(openingBalance);
    if (Number.isNaN(opening)) { setErr('Opening balance must be a number.'); return; }
    if (isCard && cardLast4 && !/^\d{4}$/.test(cardLast4.trim())) { setErr('Card last 4 should be four digits.'); return; }
    setBusy(true); setErr('');
    const { error } = await onSave({
      name: name.trim(),
      kind,
      currency,
      opening_balance: opening,
      notes: notes.trim() || null,
      funds_type: fundsType,
      holder_role: holderRole.trim() || null,
      card_last4: isCard ? (cardLast4.trim() || null) : null,
      provider: provider.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not save the account.'); return; }
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="ca-modal" isBusy={busy}>
      <form onSubmit={submit}>
        <h2 className="ca-modal-title">{isEdit ? 'Edit account' : 'Add account'}</h2>
        <p className="ca-modal-sub">A bank account, or a crew card / petty-cash float held by someone aboard.</p>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-acc-name">Name <span className="req">required</span></label>
          <input id="ca-acc-name" className="ca-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Operating account, or Owner card" autoFocus />
        </div>

        <div className="ca-form-row ca-form-grid">
          <div>
            <label className="ca-label" htmlFor="ca-acc-kind">Kind</label>
            <select id="ca-acc-kind" className="ca-select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label className="ca-label" htmlFor="ca-acc-funds">Funds</label>
            <select id="ca-acc-funds" className="ca-select" value={fundsType} onChange={(e) => setFundsType(e.target.value)}>
              {FUNDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>

        <div className="ca-form-row ca-form-grid">
          <div>
            <label className="ca-label" htmlFor="ca-acc-holder">Holder <span className="opt">who carries it</span></label>
            <input id="ca-acc-holder" className="ca-input" value={holderRole} onChange={(e) => setHolderRole(e.target.value)}
              placeholder="e.g. Captain, Chief Stewardess, Vessel" list="ca-holder-list" />
            <datalist id="ca-holder-list">
              {HOLDER_SUGGESTIONS.map((h) => <option key={h} value={h} />)}
            </datalist>
          </div>
          <div>
            <label className="ca-label" htmlFor="ca-acc-cur">Currency</label>
            <select id="ca-acc-cur" className="ca-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {isCard && (
          <div className="ca-form-row ca-form-grid">
            <div>
              <label className="ca-label" htmlFor="ca-acc-last4">Card last 4 <span className="opt">optional</span></label>
              <input id="ca-acc-last4" className="ca-input ca-num" value={cardLast4} inputMode="numeric" maxLength={4}
                onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="6614" />
            </div>
            <div>
              <label className="ca-label" htmlFor="ca-acc-provider">Provider <span className="opt">optional</span></label>
              <input id="ca-acc-provider" className="ca-input" value={provider} onChange={(e) => setProvider(e.target.value)}
                placeholder="e.g. issuing bank" />
            </div>
          </div>
        )}

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-acc-open">Opening balance <span className="opt">in account currency</span></label>
          <input id="ca-acc-open" className="ca-input ca-num" type="number" step="0.01" inputMode="decimal"
            value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
        </div>

        <div className="ca-form-row">
          <label className="ca-label" htmlFor="ca-acc-notes">Notes <span className="opt">optional</span></label>
          <textarea id="ca-acc-notes" className="ca-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {err && <div className="ca-modal-err">{err}</div>}

        <div className="ca-modal-foot">
          <button type="button" className="ca-btn ca-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="ca-btn ca-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Add account')}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
