import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle, ChevronRight, Check } from 'lucide-react';
import ModalShell from '../../components/ui/ModalShell';
import { upsertBreachReason } from '../crew-profile/utils/horBreachReasons';

// A few common operational reasons — clicking one seeds the bulk field as a
// starting point; it stays fully editable so the actual reason still gets
// written rather than rubber-stamped.
const PRESETS = [
  'Guest trip — extended service',
  'Turnaround / provisioning',
  'Charter operations',
  'Drill / safety operations',
];

// RotaBreachReasonModal — rota-stage capture of breach reasons by a chief/command.
// Crew are collapsed to one row each (name · breach-day count · progress) and
// expand on click to reveal that crew's breach days. Because an approver is
// entering it, the reason doubles as the sign-off (✓): we upsert the reason then
// sign it off. Non-blocking ("allow override") — they can close without filling
// every row; unfilled days stay "—" on the record.
//
// `breaches`: [{ key, userId, name, role, date, dateLabel, breachLabel,
//   breachTypes, reason?, signedOff? }]
// When `canEdit` is false (or a row already carries a `reason`), the modal is a
// read-only breach-detail view; otherwise outstanding rows can be recorded.
export default function RotaBreachReasonModal({ isOpen, onClose, tenantId, breaches = [], onSaved, initialExpandedUserId = null, canEdit = true }) {
  const [notes, setNotes] = useState({});
  const [bulk, setBulk] = useState('');
  const [open, setOpen] = useState({}); // userId -> expanded
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Collapse breaches under each crew member.
  const groups = useMemo(() => {
    const m = new Map();
    breaches.forEach((b) => {
      if (!m.has(b.userId)) m.set(b.userId, { userId: b.userId, name: b.name, role: b.role, items: [] });
      m.get(b.userId).items.push(b);
    });
    return Array.from(m.values());
  }, [breaches]);

  useEffect(() => {
    if (!isOpen) return;
    setNotes({});
    setBulk('');
    setError('');
    // Pre-expand the member the approver drilled into; otherwise start collapsed.
    setOpen(initialExpandedUserId ? { [initialExpandedUserId]: true } : {});
  }, [isOpen, breaches, initialExpandedUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  // A row is editable when it has no recorded reason yet AND the viewer can sign
  // off. Recorded rows render read-only; everything else is review-only.
  const isEditable = (b) => !b.reason && canEdit;
  const editableItems = breaches.filter(isEditable);
  const recordedCount = breaches.filter((b) => b.reason).length;
  const hasEditable = editableItems.length > 0;

  const setNote = (key, v) => setNotes((p) => ({ ...p, [key]: v }));
  const applyTo = (items) => {
    const v = bulk.trim();
    if (!v) return;
    // Never overwrite an already-recorded reason — only seed the editable rows.
    setNotes((p) => { const n = { ...p }; items.filter(isEditable).forEach((b) => { n[b.key] = v; }); return n; });
  };
  // Progress counts a day as resolved if it's already recorded OR just filled in.
  const resolvedIn = (items) => items.filter((b) => b.reason || (notes[b.key] || '').trim()).length;
  const filledCount = editableItems.filter((b) => (notes[b.key] || '').trim()).length;
  const dirty = filledCount > 0 || bulk.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const targets = breaches.filter((b) => isEditable(b) && (notes[b.key] || '').trim());
    // Recording the reason is NOT a sign-off — it's the record of WHY the breach
    // happened. The crew member signs their own breaches off at month end.
    const results = await Promise.allSettled(targets.map((b) => upsertBreachReason({
      tenantId, subjectUserId: b.userId, date: b.date,
      breachTypes: b.breachTypes || [], note: notes[b.key].trim(),
    })));
    setSaving(false);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      onSaved?.(); // refetch only — do NOT optimistically clear rows that didn't save
      const msg = failed[0].reason?.message || String(failed[0].reason) || 'Unknown error.';
      setError(`Couldn’t save ${failed.length} of ${targets.length} — ${msg}`);
      return; // keep the modal open so the reason isn't lost and they can retry
    }
    // All saved — hand the entries up so the banner/list update instantly.
    onSaved?.(targets.map((b) => ({ userId: b.userId, date: b.date, note: notes[b.key].trim() })));
    onClose?.();
  };

  return (
    <ModalShell onClose={onClose} isDirty={dirty} isBusy={saving} panelClassName="rbr-panel">
      <div className="rbr-head">
        <h2 className="rbr-title">
          {hasEditable ? <>Planned breaches, <em>justified.</em></> : <>Breach detail</>}
        </h2>
        <p className="rbr-sub">
          {hasEditable
            ? 'Record why each non-compliant day was operationally necessary. This is the record of the cause — the crew member signs their own breaches off at month end.'
            : 'Each non-compliant day, the rule it broke, and any reason already recorded against it.'}
        </p>
        <button className="rbr-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>

      {hasEditable && (
        <div className="rbr-bulk">
          <p className="rbr-label">One reason for all {editableItems.length} open day{editableItems.length === 1 ? '' : 's'}</p>
          <div className="rbr-presets">
            {PRESETS.map((p) => (
              <button key={p} type="button" className="rbr-preset" onClick={() => setBulk(p)}>{p}</button>
            ))}
          </div>
          <div className="rbr-bulk-row">
            <input
              className="rbr-input"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder="e.g. Guest trip — service ran past 22:00, early start for breakfast service"
            />
            <button type="button" className="rbr-apply" onClick={() => applyTo(breaches)} disabled={!bulk.trim()}>
              Apply to all
            </button>
          </div>
        </div>
      )}

      <div className="rbr-list">
        {groups.map((g) => {
          const done = resolvedIn(g.items);
          const allDone = done === g.items.length;
          const gEditable = g.items.some(isEditable);
          const isOpen = !!open[g.userId];
          return (
            <div key={g.userId} className="rbr-acc">
              <button
                type="button"
                className="rbr-acc-head"
                onClick={() => setOpen((p) => ({ ...p, [g.userId]: !p[g.userId] }))}
                aria-expanded={isOpen}
              >
                <ChevronRight size={16} className={`rbr-chev${isOpen ? ' open' : ''}`} />
                <span><span className="rbr-acc-name">{g.name}</span>{g.role ? <span className="rbr-acc-role">{g.role}</span> : null}</span>
                <span className="rbr-acc-meta">
                  <span className="rbr-acc-days">{g.items.length} breach day{g.items.length === 1 ? '' : 's'}</span>
                  {allDone
                    ? <span className="rbr-acc-prog done"><Check size={13} /> done</span>
                    : <span className="rbr-acc-prog">{done}/{g.items.length}</span>}
                </span>
              </button>
              {isOpen && (
                <div className="rbr-acc-body">
                  {gEditable && (
                    <button type="button" className="rbr-groupapply" onClick={() => applyTo(g.items)} disabled={!bulk.trim()}>
                      Apply reason above to this crew’s open days
                    </button>
                  )}
                  {g.items.map((b) => (
                    <div key={b.key} className="rbr-row">
                      <span className="rbr-date">{b.dateLabel}</span>
                      <span className="rbr-chipcell"><span className="rbr-chip">{b.breachLabel}</span></span>
                      {b.reason ? (
                        <span className="rbr-recorded" title={b.signedOff ? 'Recorded & signed off' : 'Recorded'}>
                          {b.signedOff && <Check size={13} className="rbr-recorded-tick" />}
                          <span className="rbr-recorded-text">{b.reason}</span>
                        </span>
                      ) : canEdit ? (
                        <input
                          className="rbr-rowinput"
                          value={notes[b.key] || ''}
                          onChange={(e) => setNote(b.key, e.target.value)}
                          placeholder="Reason…"
                        />
                      ) : (
                        <span className="rbr-norec">No reason recorded yet</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rbr-foot">
        {error
          ? <span className="rbr-error">{error}</span>
          : hasEditable
            ? <span className="rbr-count">{filledCount} of {editableItems.length} to record</span>
            : <span className="rbr-count">{recordedCount} of {breaches.length} recorded</span>}
        <div className="rbr-btns">
          <button type="button" className="rbr-btn-ghost" onClick={onClose} disabled={saving}>
            {hasEditable ? 'Close without' : 'Close'}
          </button>
          {hasEditable && (
            <button type="button" className="rbr-btn-primary" onClick={handleSave} disabled={saving || filledCount === 0}>
              <CheckCircle size={16} />
              {saving ? 'Saving…' : `Record ${filledCount === 1 ? 'reason' : 'reasons'}`}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
