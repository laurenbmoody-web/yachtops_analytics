// Cargo Accounts — the reconciliation detail for one ledger line, revealed by the
// row's chevron. The row itself carries the fast, always-needed bits (date, what it
// was, category, amount); everything that makes a line audit-proof lives here:
// what it was for, who owns it, who spent it, who bears it (owner vs charter),
// VAT/FX, the receipt, and any split across MYBA lines.
//
// Defaults come from src/services/lineDetail.js so the crew are asked as little as
// possible: department follows the category, the cardholder is the card's holder,
// and the allocation is implied by a dedicated charter/APA or owner card.
import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { DEPARTMENTS } from '../../../utils/authStorage';
import { formatMoney } from '../../../services/financeCalc';
import {
  departmentForCode, defaultAllocation, needsTripPick, isDedicatedCharterAccount,
  defaultCardholder, isBorrowedCard, splitRemainder, validateSplits,
  netOfVat, vatFromRate, baseFromFx,
} from '../../../services/lineDetail';
import './line-detail.css';

const CURRENCIES = ['GBP', 'EUR', 'USD', 'CHF', 'AUD'];
const blankSplit = () => ({ amount: '', category: '', category_code: '', department: '', note: '' });

export default function LineDetail({
  txn, account, crew = [], trips = [], chartGroups = [], attachments = [], splits = [],
  onSave, onUploadReceipt, onDeleteAttachment, onClose, canEdit = true,
}) {
  const [note, setNote] = useState(txn.description || '');
  const [department, setDepartment] = useState(txn.department || departmentForCode(txn.category_code) || '');
  const [cardholder, setCardholder] = useState(defaultCardholder(txn, account) || '');
  const [allocation, setAllocation] = useState(defaultAllocation(txn, account) || '');
  const [tripId, setTripId] = useState(txn.trip_id || '');
  const [vatAmount, setVatAmount] = useState(txn.vat_amount ?? '');
  const [vatRate, setVatRate] = useState(txn.vat_rate ?? '');
  const [currency, setCurrency] = useState(txn.currency || account?.currency || 'GBP');
  const [fxRate, setFxRate] = useState(txn.fx_rate ?? 1);
  const [rows, setRows] = useState(() => (splits.length ? splits.map((s) => ({ ...s })) : []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const askTrip = needsTripPick(allocation, account);
  const borrowed = isBorrowedCard(cardholder, account);
  const splitCheck = validateSplits(txn.amount, rows);
  const remainder = splitRemainder(txn.amount, rows);
  const baseValue = baseFromFx(txn.amount, fxRate);
  const showFx = currency !== (account?.currency || currency) || Number(fxRate) !== 1;

  const flatChart = useMemo(
    () => (chartGroups || []).flatMap((g) => g.lines.map((l) => ({ bucket: g.bucket, ...l }))),
    [chartGroups],
  );

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => {
    // Seed the first two parts so the crew only type amounts: part 1 takes the
    // line's own category, part 2 starts empty with whatever is left.
    if (!prev.length) {
      return [
        { ...blankSplit(), category: txn.category || '', category_code: txn.category_code || '', amount: '' },
        blankSplit(),
      ];
    }
    return [...prev, { ...blankSplit(), amount: remainder ? String(remainder) : '' }];
  });
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i));

  const pickSplitCategory = (i, value) => {
    const line = flatChart.find((l) => `${l.code}|${l.category}` === value);
    setRow(i, {
      category: line?.category || '',
      category_code: line?.code || '',
      department: line?.code ? (departmentForCode(line.code) || '') : '',
    });
  };

  const applyVatRate = () => { if (vatRate !== '') setVatAmount(String(vatFromRate(txn.amount, vatRate))); };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f || !onUploadReceipt) return;
    setBusy(true); setErr('');
    const res = await onUploadReceipt(txn.id, f);
    setBusy(false);
    if (res?.error) setErr('That receipt didn’t upload — try again.');
    e.target.value = '';
  };

  const save = async () => {
    if (rows.length && !splitCheck.ok) { setErr(splitCheck.reason); return; }
    if (askTrip && allocation === 'charter' && !tripId) { setErr('Pick which charter this belongs to.'); return; }
    setBusy(true); setErr('');
    const res = await onSave(txn.id, {
      detail: {
        description: note.trim() || null,
        department: department || null,
        crew_id: cardholder || null,
        allocation: allocation || null,
        trip_id: allocation === 'charter' ? (tripId || null) : null,
        vat_amount: vatAmount === '' ? null : Number(vatAmount),
        vat_rate: vatRate === '' ? null : Number(vatRate),
        currency,
        fx_rate: Number(fxRate) || 1,
        amount_base: baseValue,
      },
      splits: rows,
    });
    setBusy(false);
    if (res?.error) { setErr('Couldn’t save — please try again.'); return; }
    onClose?.();
  };

  const label = (text, opt) => (
    <span className="ld-label">{text}{opt ? <em className="ld-opt"> {opt}</em> : null}</span>
  );

  return (
    <div className="ld">
      {/* what it was for + who owns it */}
      <div className="ld-grid">
        <label className="ld-field ld-wide">
          {label('What was it for', 'recommended')}
          <input className="ld-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. hydraulic hose for the tender crane" disabled={!canEdit} />
        </label>

        <label className="ld-field">
          {label('Department')}
          <select className="ld-input" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!canEdit}>
            <option value="">Not set</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>

        <label className="ld-field">
          {label('Who spent it')}
          <select className="ld-input" value={cardholder} onChange={(e) => setCardholder(e.target.value)} disabled={!canEdit}>
            <option value="">Not set</option>
            {crew.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.id === account?.holder_user_id ? ' — cardholder' : ''}
              </option>
            ))}
          </select>
          {borrowed && <span className="ld-hint warn">Not this card’s holder — borrowed card</span>}
        </label>
      </div>

      {/* who bears it */}
      <div className="ld-row">
        <div className="ld-field">
          {label('Who pays for this')}
          <div className="ld-seg">
            {[['owner', 'Owner'], ['charter', 'Charter (APA)']].map(([k, t]) => (
              <button key={k} type="button" aria-pressed={allocation === k} disabled={!canEdit}
                onClick={() => { setAllocation(k); if (k !== 'charter') setTripId(''); }}>{t}</button>
            ))}
          </div>
          {isDedicatedCharterAccount(account) && (
            <span className="ld-hint">From a charter/APA card — charter by default</span>
          )}
        </div>

        {/* charter money on a general card must name the charter */}
        {askTrip && (
          <label className="ld-field ld-grow">
            {label('Which charter', 'required')}
            <select className={`ld-input${!tripId ? ' is-need' : ''}`} value={tripId}
              onChange={(e) => setTripId(e.target.value)} disabled={!canEdit}>
              <option value="">Pick a charter…</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.start_date ? ` · ${String(t.start_date).slice(0, 10).split('-').reverse().join('/')}` : ''}
                </option>
              ))}
            </select>
            {!trips.length && <span className="ld-hint">No charters recorded yet — add one in Trips.</span>}
          </label>
        )}
      </div>

      {/* receipt */}
      <div className="ld-block">
        {label('Receipt', 'proof for the owner / VAT')}
        <div className="ld-receipts">
          {attachments.map((a) => (
            <span key={a.id} className="ld-rec">
              <button type="button" className="ld-rec-open"
                onClick={() => a.url && window.open(a.url, '_blank', 'noopener')}>
                <Icon name="Paperclip" size={12} /> {a.file_name || 'Receipt'}
              </button>
              {canEdit && onDeleteAttachment && (
                <button type="button" className="ld-rec-x" title="Remove"
                  onClick={() => onDeleteAttachment(a.id, a.storage_path)}>×</button>
              )}
            </span>
          ))}
          {canEdit && (
            <label className="ld-attach">
              <Icon name="Upload" size={13} /> {attachments.length ? 'Add another' : 'Attach receipt'}
              <input type="file" accept="image/*,application/pdf" onChange={handleFile} hidden />
            </label>
          )}
          {!attachments.length && !canEdit && <span className="ld-hint">None attached</span>}
        </div>
      </div>

      {/* tax + currency */}
      <div className="ld-grid">
        <label className="ld-field">
          {label('VAT amount')}
          <input className="ld-input" inputMode="decimal" value={vatAmount}
            onChange={(e) => setVatAmount(e.target.value)} placeholder="0.00" disabled={!canEdit} />
          {vatAmount !== '' && Number(vatAmount) !== 0 && (
            <span className="ld-hint">Net {formatMoney(netOfVat(txn.amount, vatAmount), currency, { signed: true })}</span>
          )}
        </label>
        <label className="ld-field">
          {label('VAT rate %')}
          <div className="ld-inline">
            <input className="ld-input" inputMode="decimal" value={vatRate}
              onChange={(e) => setVatRate(e.target.value)} placeholder="20" disabled={!canEdit} />
            {canEdit && <button type="button" className="ld-mini" onClick={applyVatRate}>Work it out</button>}
          </div>
        </label>
        <label className="ld-field">
          {label('Currency')}
          <select className="ld-input" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canEdit}>
            {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="ld-field">
          {label('FX rate to base')}
          <input className="ld-input" inputMode="decimal" value={fxRate}
            onChange={(e) => setFxRate(e.target.value)} disabled={!canEdit} />
          {showFx && <span className="ld-hint">Base {formatMoney(baseValue, account?.currency || 'GBP', { signed: true })}</span>}
        </label>
      </div>

      {/* split */}
      <div className="ld-block">
        <div className="ld-blockhead">
          {label('Split across categories', 'one payment, several lines')}
          {canEdit && !rows.length && (
            <button type="button" className="ld-mini" onClick={addRow}>
              <Icon name="Split" size={12} /> Split this
            </button>
          )}
        </div>

        {rows.length > 0 && (
          <div className="ld-splits">
            {rows.map((r, i) => (
              <div key={i} className="ld-split">
                <input className="ld-input ld-split-amt" inputMode="decimal" value={r.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="0.00" disabled={!canEdit} />
                <select className="ld-input ld-split-cat"
                  value={r.category ? `${r.category_code || ''}|${r.category}` : ''}
                  onChange={(e) => pickSplitCategory(i, e.target.value)} disabled={!canEdit}>
                  <option value="">Pick a category…</option>
                  {chartGroups.map((g) => (
                    <optgroup key={g.bucket} label={g.bucket}>
                      {g.lines.map((l) => (
                        <option key={`${l.code}|${l.category}`} value={`${l.code || ''}|${l.category}`}>
                          {l.code ? `${l.code} · ` : ''}{l.category}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input className="ld-input ld-split-note" value={r.note || ''}
                  onChange={(e) => setRow(i, { note: e.target.value })} placeholder="note (optional)" disabled={!canEdit} />
                {canEdit && (
                  <button type="button" className="ld-split-x" title="Remove part" onClick={() => removeRow(i)}>×</button>
                )}
              </div>
            ))}
            <div className="ld-splitfoot">
              <span className={`ld-remain${Math.abs(remainder) > 0.004 ? ' is-off' : ' is-ok'}`}>
                {Math.abs(remainder) > 0.004
                  ? `${formatMoney(remainder, currency, { signed: true })} left to allocate`
                  : 'Adds up to the payment'}
              </span>
              {canEdit && <button type="button" className="ld-mini" onClick={addRow}>+ Add part</button>}
              {canEdit && <button type="button" className="ld-mini is-mut" onClick={() => setRows([])}>Clear split</button>}
            </div>
          </div>
        )}
      </div>

      {err && <p className="ld-err">{err}</p>}

      {canEdit && (
        <div className="ld-actions">
          <button type="button" className="ld-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ld-btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save detail'}
          </button>
        </div>
      )}
    </div>
  );
}
