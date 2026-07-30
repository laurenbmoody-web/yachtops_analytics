// Cargo Accounts — the reconciliation detail for one ledger line, revealed by the
// row's chevron.
//
// It deliberately holds ONLY what the row can't already do. The row shows the
// merchant, both dates and the amount, and handles the category and the receipt
// inline — so none of that is repeated here. What's left is the coding a line needs
// to be audit-proof: the crew's own description, department, who spent it, who
// bears it (owner vs charter), VAT/FX and any split.
//
// The bank's own narrative (`description`, e.g. "Tradingview") is never editable —
// a merchant is called what it's called. The crew's words go in `note`.
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
  defaultCardholder, isBorrowedCard, splitRemainder, validateSplits, signedSplits,
  netOfVat, vatFromRate, baseFromFx, clampSplitAmount,
} from '../../../services/lineDetail';
import './line-detail.css';

const CURRENCIES = ['GBP', 'EUR', 'USD', 'CHF', 'AUD'];
const blankSplit = () => ({ amount: '', category: '', category_code: '', department: '', note: '' });
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export default function LineDetail({
  txn, account, crew = [], trips = [], chartGroups = [], attachments = [], splits = [],
  onSave, onUploadReceipt, onDeleteAttachment, onClose, canEdit = true,
}) {
  const [note, setNote] = useState(txn.note || '');
  const [department, setDepartment] = useState(txn.department || departmentForCode(txn.category_code) || '');
  const [cardholder, setCardholder] = useState(defaultCardholder(txn, account) || '');
  const [allocation, setAllocation] = useState(defaultAllocation(txn, account) || '');
  // One free-text charter box with the known trips as suggestions: type anything,
  // and if it matches a trip we link the trip properly instead of storing loose text.
  const [charterText, setCharterText] = useState(
    txn.charter_ref || trips.find((t) => t.id === txn.trip_id)?.name || '',
  );
  const [vatAmount, setVatAmount] = useState(txn.vat_amount ?? '');
  const [vatRate, setVatRate] = useState(txn.vat_rate ?? '');
  const [currency, setCurrency] = useState(txn.currency || account?.currency || 'GBP');
  const [fxRate, setFxRate] = useState(txn.fx_rate ?? 1);
  const [spendDate, setSpendDate] = useState((txn.txn_date || '').slice(0, 10));
  // Split rows hold MAGNITUDES — the parent's direction is applied on save.
  const [rows, setRows] = useState(() => (splits.length
    ? splits.map((s) => ({ ...s, amount: String(Math.abs(Number(s.amount) || 0)) }))
    : []));
  const [shakeIdx, setShakeIdx] = useState(-1);   // part that just refused an over-allocation
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const askCharter = needsTripPick(allocation, account);
  const borrowed = isBorrowedCard(cardholder, account);
  const splitCheck = validateSplits(txn.amount, rows);
  const remainder = splitRemainder(txn.amount, rows);
  const balanced = Math.abs(remainder) <= 0.004;
  const baseValue = baseFromFx(txn.amount, fxRate);
  const showFx = Number(fxRate) !== 1;
  // A typed name that matches a trip links it; anything else is stored as free text.
  const matchedTrip = useMemo(
    () => trips.find((t) => t.name?.trim().toLowerCase() === charterText.trim().toLowerCase()) || null,
    [trips, charterText],
  );
  const charterNamed = Boolean(charterText.trim());

  const flatChart = useMemo(
    () => (chartGroups || []).flatMap((g) => g.lines.map((l) => ({ bucket: g.bucket, ...l }))),
    [chartGroups],
  );

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Refuse an over-allocation as it's typed: clamp to what's left and shake the
  // field, rather than accepting a figure that would never reconcile.
  const setRowAmount = (i, typed) => {
    const { value, clamped } = clampSplitAmount(txn.amount, rows, i, typed);
    setRow(i, { amount: value });
    if (clamped) {
      setShakeIdx(i);
      setErr('');
      setTimeout(() => setShakeIdx(-1), 420);
    }
  };
  const addRow = () => setRows((prev) => {
    // Seed two parts so the crew only type amounts: part 1 takes the line's own
    // category, part 2 starts empty pre-filled with whatever is left.
    if (!prev.length) {
      return [
        { ...blankSplit(), category: txn.category || '', category_code: txn.category_code || '' },
        blankSplit(),
      ];
    }
    return [...prev, { ...blankSplit(), amount: remainder > 0 ? String(remainder) : '' }];
  });
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i));

  const pickSplitCategory = (i, value) => {
    const line = flatChart.find((l) => `${l.code || ''}|${l.category}` === value);
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
    if (askCharter && allocation === 'charter' && !charterNamed) {
      setErr('Name the charter this belongs to.'); return;
    }
    setBusy(true); setErr('');
    const isCharter = allocation === 'charter';
    const res = await onSave(txn.id, {
      detail: {
        txn_date: spendDate || txn.txn_date,
        note: note.trim() || null,
        department: department || null,
        crew_id: cardholder || null,
        allocation: allocation || null,
        trip_id: isCharter ? (matchedTrip?.id || null) : null,
        charter_ref: isCharter && !matchedTrip ? (charterText.trim() || null) : null,
        vat_amount: vatAmount === '' ? null : Number(vatAmount),
        vat_rate: vatRate === '' ? null : Number(vatRate),
        currency,
        fx_rate: Number(fxRate) || 1,
        amount_base: baseValue,
      },
      // Give the typed magnitudes the payment's direction before they're stored.
      splits: signedSplits(txn.amount, rows),
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
      {/* Row A — the crew's own words, when, and who owns it. The merchant, both
          dates, the category and the receipt are all on the row already. */}
      <div className="ld-grid">
        <label className="ld-field ld-wide">
          {label('Description / note')}
          <input className="ld-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What this was actually for — e.g. hydraulic hose for the tender crane"
            disabled={!canEdit} />
        </label>

        <label className="ld-field">
          {label('Date spent')}
          <input className="ld-input" type="date" value={spendDate}
            onChange={(e) => setSpendDate(e.target.value)} disabled={!canEdit} />
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
          {borrowed && <span className="ld-hint warn">Borrowed card</span>}
        </label>
      </div>

      {/* Row B — who bears it, and which charter when that has to be stated */}
      <div className="ld-row">
        <div className="ld-field">
          {label('Who pays')}
          <div className="ld-seg">
            {[['owner', 'Owner'], ['charter', 'Charter (APA)']].map(([k, t]) => (
              <button key={k} type="button" aria-pressed={allocation === k} disabled={!canEdit}
                onClick={() => { setAllocation(k); if (k !== 'charter') setCharterText(''); }}>{t}</button>
            ))}
          </div>
          {isDedicatedCharterAccount(account) && (
            <span className="ld-hint">Charter/APA card — charter by default</span>
          )}
        </div>

        {askCharter && (
          <div className="ld-field ld-grow">
            {label('Which charter', 'required')}
            <input className={`ld-input${!charterNamed ? ' is-need' : ''}`} value={charterText}
              list="ld-charters" autoComplete="off"
              onChange={(e) => setCharterText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
              placeholder={trips.length ? 'Type or pick a charter…' : 'Charter name or reference'}
              disabled={!canEdit} />
            <datalist id="ld-charters">
              {trips.map((t) => (
                <option key={t.id} value={t.name}>{t.start_date ? dmy(t.start_date) : ''}</option>
              ))}
            </datalist>
            <span className="ld-hint">
              {matchedTrip
                ? `Linked to the ${matchedTrip.name} trip`
                : (charterText.trim() ? 'Saved as typed — not linked to a trip record' : 'Type it, or choose from your trips')}
            </span>
          </div>
        )}
      </div>

      {/* Receipts — attaching happens from the row's clip; this is view/remove only,
          so it takes no space when there's nothing attached. */}
      {attachments.length > 0 && (
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
              <Icon name="Upload" size={12} /> Add
              <input type="file" accept="image/*,application/pdf" onChange={handleFile} hidden />
            </label>
          )}
        </div>
      )}

      {/* Row C — tax + currency */}
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

      {/* Row D — split. Amounts are typed as plain figures; the direction follows
          the payment, so £26 split 14 / 12 balances. */}
      <div>
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
                <input className={`ld-input ld-split-amt${shakeIdx === i ? ' is-shake' : ''}`}
                  inputMode="decimal" value={r.amount}
                  onChange={(e) => setRowAmount(i, e.target.value)} placeholder="0.00" disabled={!canEdit} />
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
                  onChange={(e) => setRow(i, { note: e.target.value })} placeholder="Description / note" disabled={!canEdit} />
                {canEdit && (
                  <button type="button" className="ld-split-x" title="Remove part" onClick={() => removeRow(i)}>×</button>
                )}
              </div>
            ))}
            {/* The remainder is the thing that tells you whether the split is done,
                so it reads as a proper status bar, not a footnote. */}
            <div className={`ld-remainbar${balanced ? ' is-ok' : ''}`}>
              <span className="ld-remain">
                {balanced
                  ? <><Icon name="Check" size={13} /> Adds up to {formatMoney(Math.abs(txn.amount), currency)}</>
                  : <><Icon name="AlertCircle" size={13} /> {formatMoney(remainder, currency)} still to allocate</>}
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
          <button type="button" className="ld-btn primary" onClick={save}
            disabled={busy || (rows.length > 0 && !splitCheck.ok)}
            title={rows.length > 0 && !splitCheck.ok ? splitCheck.reason : undefined}>
            {busy ? 'Saving…' : 'Save detail'}
          </button>
        </div>
      )}
    </div>
  );
}
