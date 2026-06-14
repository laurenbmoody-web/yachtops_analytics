import React, { useEffect, useState } from 'react';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import ModalShell from '../../components/ui/ModalShell';
import { QUICK_TAGS } from '../crew-profile/utils/horBreachNotesStorage';
import { upsertBreachReason, signOffBreachReason } from '../crew-profile/utils/horBreachReasons';

// RotaBreachReasonModal — rota-stage capture of breach reasons by a chief/command.
// Lists the planned MLC breach days that don't yet have a recorded reason and
// lets the approver record one per day. Because an approver is entering it, the
// reason doubles as the sign-off (✓): we upsert the reason then sign it off.
//
// Non-blocking ("allow override"): the approver can close without filling every
// row — unfilled days simply stay without a reason (shown as "—" on the record).
//
// `breaches`: [{ key, userId, name, role, date, dateLabel, breachLabel, breachTypes }]
export default function RotaBreachReasonModal({ isOpen, onClose, tenantId, breaches = [], onSaved }) {
  const [notes, setNotes] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setNotes({});
  }, [isOpen, breaches]);

  if (!isOpen) return null;

  const setNote = (key, v) => setNotes((p) => ({ ...p, [key]: v }));
  const filledCount = breaches.filter((b) => (notes[b.key] || '').trim()).length;

  const handleSave = async () => {
    setSaving(true);
    const writes = breaches
      .filter((b) => (notes[b.key] || '').trim())
      .map(async (b) => {
        try {
          await upsertBreachReason({
            tenantId,
            subjectUserId: b.userId,
            date: b.date,
            breachTypes: b.breachTypes || [],
            note: notes[b.key].trim(),
          });
          // Reason entered by an approver = signed off (✓ on the record).
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
    <ModalShell onClose={onClose} panelClassName="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-6 border-b border-border">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Planned breaches need a reason</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Record why each non-compliant day is operationally necessary. As a sign-off authority, your reason is also recorded as the sign-off (✓) on the record.
          </p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth" aria-label="Close">
          <Icon name="X" size={20} className="text-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {breaches.map((b) => (
          <div key={b.key} className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">{b.name}{b.role ? ` · ${b.role}` : ''}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{b.dateLabel}</p>
              </div>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-right">
                {b.breachLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_TAGS?.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setNote(b.key, tag.prefix + (notes[b.key] || '').replace(/^[^:]+:\s*/, ''))}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-smooth"
                >
                  {tag.label}
                </button>
              ))}
            </div>
            <textarea
              value={notes[b.key] || ''}
              onChange={(e) => setNote(b.key, e.target.value)}
              placeholder="Reason this breach was operationally necessary…"
              rows={2}
              className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 p-6 border-t border-border">
        <span className="text-xs text-muted-foreground">{filledCount} of {breaches.length} given</span>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>Close without</Button>
          <Button onClick={handleSave} disabled={saving || filledCount === 0}>
            <Icon name="CheckCircle" size={18} />
            {saving ? 'Saving…' : 'Record & sign off'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
