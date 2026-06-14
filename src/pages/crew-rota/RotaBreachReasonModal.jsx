import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle, ChevronRight, Check } from 'lucide-react';
import ModalShell from '../../components/ui/ModalShell';
import { upsertBreachReason, signOffBreachReason } from '../crew-profile/utils/horBreachReasons';

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
// `breaches`: [{ key, userId, name, role, date, dateLabel, breachLabel, breachTypes }]
export default function RotaBreachReasonModal({ isOpen, onClose, tenantId, breaches = [], onSaved }) {
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
    setOpen({}); // always start collapsed — the user expands a crew member to fill
  }, [isOpen, breaches]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const setNote = (key, v) => setNotes((p) => ({ ...p, [key]: v }));
  const applyTo = (items) => {
    const v = bulk.trim();
    if (!v) return;
    setNotes((p) => { const n = { ...p }; items.forEach((b) => { n[b.key] = v; }); return n; });
  };
  const filledIn = (items) => items.filter((b) => (notes[b.key] || '').trim()).length;
  const filledCount = filledIn(breaches);
  const dirty = filledCount > 0 || bulk.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const targets = breaches.filter((b) => (notes[b.key] || '').trim());
    const results = await Promise.allSettled(targets.map(async (b) => {
      await upsertBreachReason({
        tenantId, subjectUserId: b.userId, date: b.date,
        breachTypes: b.breachTypes || [], note: notes[b.key].trim(),
      });
      await signOffBreachReason({ tenantId, subjectUserId: b.userId, date: b.date });
    }));
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
        <h2 className="rbr-title">Planned breaches, <em>justified.</em></h2>
        <p className="rbr-sub">
          Record why each non-compliant day was operationally necessary. As a sign-off authority, your reason is recorded as the sign-off (✓) on the record.
        </p>
        <button className="rbr-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>

      <div className="rbr-bulk">
        <p className="rbr-label">One reason for all {breaches.length} days</p>
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

      <div className="rbr-list">
        {groups.map((g) => {
          const done = filledIn(g.items);
          const allDone = done === g.items.length;
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
                  <button type="button" className="rbr-groupapply" onClick={() => applyTo(g.items)} disabled={!bulk.trim()}>
                    Apply reason above to these {g.items.length} days
                  </button>
                  {g.items.map((b) => (
                    <div key={b.key} className="rbr-row">
                      <span className="rbr-date">{b.dateLabel}</span>
                      <span className="rbr-chipcell"><span className="rbr-chip">{b.breachLabel}</span></span>
                      <input
                        className="rbr-rowinput"
                        value={notes[b.key] || ''}
                        onChange={(e) => setNote(b.key, e.target.value)}
                        placeholder="Reason…"
                      />
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
          : <span className="rbr-count">{filledCount} of {breaches.length} given</span>}
        <div className="rbr-btns">
          <button type="button" className="rbr-btn-ghost" onClick={onClose} disabled={saving}>Close without</button>
          <button type="button" className="rbr-btn-primary" onClick={handleSave} disabled={saving || filledCount === 0}>
            <CheckCircle size={16} />
            {saving ? 'Saving…' : 'Record & sign off'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
