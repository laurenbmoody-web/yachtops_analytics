import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle } from 'lucide-react';
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
// Lists the planned MLC breach days that don't yet have a recorded reason. Because
// an approver is entering it, the reason doubles as the sign-off (✓): we upsert
// the reason then sign it off. Non-blocking ("allow override") — they can close
// without filling every row; unfilled days stay "—" on the record.
//
// `breaches`: [{ key, userId, name, role, date, dateLabel, breachLabel, breachTypes }]
export default function RotaBreachReasonModal({ isOpen, onClose, tenantId, breaches = [], onSaved }) {
  const [notes, setNotes] = useState({});
  const [bulk, setBulk] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { setNotes({}); setBulk(''); }
  }, [isOpen, breaches]);

  // Group breach days under each crew member so the same reason reads naturally
  // down a run of consecutive days (the common guest-ops case).
  const groups = useMemo(() => {
    const m = new Map();
    breaches.forEach((b) => {
      if (!m.has(b.userId)) m.set(b.userId, { userId: b.userId, name: b.name, role: b.role, items: [] });
      m.get(b.userId).items.push(b);
    });
    return Array.from(m.values());
  }, [breaches]);

  if (!isOpen) return null;

  const setNote = (key, v) => setNotes((p) => ({ ...p, [key]: v }));
  const applyToAll = () => {
    const v = bulk.trim();
    if (!v) return;
    const next = {};
    breaches.forEach((b) => { next[b.key] = v; });
    setNotes(next);
  };
  const filledCount = breaches.filter((b) => (notes[b.key] || '').trim()).length;
  const dirty = filledCount > 0 || bulk.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    const writes = breaches
      .filter((b) => (notes[b.key] || '').trim())
      .map(async (b) => {
        try {
          await upsertBreachReason({
            tenantId, subjectUserId: b.userId, date: b.date,
            breachTypes: b.breachTypes || [], note: notes[b.key].trim(),
          });
          await signOffBreachReason({ tenantId, subjectUserId: b.userId, date: b.date });
        } catch (err) {
          console.warn('[rota breach reason] save failed:', err);
        }
      });
    await Promise.allSettled(writes);
    setSaving(false);
    onSaved?.();
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
          <button type="button" className="rbr-apply" onClick={applyToAll} disabled={!bulk.trim()}>
            Apply to all
          </button>
        </div>
      </div>

      <div className="rbr-list">
        {groups.map((g) => (
          <div key={g.userId}>
            <p className="rbr-group-label">{g.name}{g.role ? ` · ${g.role}` : ''}</p>
            {g.items.map((b) => (
              <div key={b.key} className="rbr-row">
                <span className="rbr-date">{b.dateLabel}</span>
                <span className="rbr-chip">{b.breachLabel}</span>
                <input
                  className="rbr-rowinput"
                  value={notes[b.key] || ''}
                  onChange={(e) => setNote(b.key, e.target.value)}
                  placeholder="Reason…"
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="rbr-foot">
        <span className="rbr-count">{filledCount} of {breaches.length} given</span>
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
