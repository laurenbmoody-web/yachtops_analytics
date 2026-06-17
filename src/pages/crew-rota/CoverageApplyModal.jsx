import React, { useMemo, useState } from 'react';
import {
  buildCandidates, defaultSpread, sliceFreed, recipientAfter, buildApplyPlan,
} from './coverageEngine';

// CoverageApplyModal — turns a rest suggestion into real grid edits. The hours
// the suggestion frees from the breaching crew are spread across same-dept crew
// who have rest headroom; every recipient is re-checked against the two
// hour-based MLC limits before anything is written. Two steps: assign → preview.
//
// Props:
//   open          bool
//   suggestion    enriched suggestion incl. { headline, freedBlock, change }
//   sourceCrew    the breaching crew member (id, name, department, departmentId)
//   crew          full crew list (deriveCrew shape) for candidate lookup
//   base          { tenantId, rotaId, tripId, createdBy }
//   ensureDraft   (departmentId) => Promise — flip dept to draft before writing
//   applyTemplate ({ rows, deleteIds }) => Promise<{ ok }>
//   onApplied     () => void  — success callback (parent closes + toasts)
//   onClose       () => void
//   onToast       (msg, opts?) => void
export default function CoverageApplyModal({
  open, suggestion, sourceCrew, crew, base,
  ensureDraft, applyTemplate, onApplied, onClose, onToast,
}) {
  const freed = suggestion?.freedBlock || null;
  const candidates = useMemo(
    () => (freed && sourceCrew ? buildCandidates({ sourceMember: sourceCrew, crew }) : []),
    [freed, sourceCrew, crew],
  );

  const [step, setStep] = useState('assign'); // 'assign' | 'preview'
  const [alloc, setAlloc] = useState(null);    // { [memberId]: hours }
  const [busy, setBusy] = useState(false);

  // Seed the default spread once we have a block + candidates.
  React.useEffect(() => {
    if (!open || !freed) return;
    setStep('assign');
    setAlloc(defaultSpread(candidates, freed.hours).alloc);
  }, [open, freed, candidates]);

  if (!open || !freed) return null;

  const freedH = Math.round(freed.hours);
  const assigned = Object.values(alloc || {}).reduce((a, h) => a + h, 0);
  const remaining = freedH - assigned;

  const setHours = (id, next, cap) => {
    const clamped = Math.max(0, Math.min(next, Math.floor(cap)));
    // Don't let the total exceed the freed hours.
    const others = assigned - (alloc?.[id] || 0);
    const allowed = Math.min(clamped, freedH - others);
    setAlloc((prev) => ({ ...prev, [id]: allowed }));
  };

  // Ordered recipient slices (only those taking >0h), carved sequentially.
  const orderedAllocs = candidates
    .map((c) => ({ id: c.id, hours: alloc?.[c.id] || 0 }))
    .filter((a) => a.hours > 0);
  const slices = sliceFreed(freed, orderedAllocs);
  const candById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (ensureDraft && sourceCrew?.departmentId) await ensureDraft(sourceCrew.departmentId);
      const plan = buildApplyPlan({
        base: { ...base, sourceMemberId: sourceCrew.id },
        freed,
        slices,
      });
      const res = await applyTemplate(plan);
      if (res?.ok) {
        onToast?.(`Applied — ${freedH - remaining}h reassigned across ${slices.length} crew`, { type: 'success' });
        onApplied?.();
      } else {
        onToast?.(res?.error || 'Could not apply to grid', { type: 'error' });
      }
    } catch (e) {
      onToast?.(e?.message || 'Could not apply to grid', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const fmt = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

  return (
    <>
      <div className="cov-backdrop" onClick={onClose} />
      <div className="cov-modal" role="dialog" aria-modal="true" aria-label="Apply suggestion to grid">
        <div className="cov-head">
          <div>
            <div className="cov-eyebrow">{step === 'assign' ? 'Assign coverage' : 'Preview & confirm'}</div>
            <div className="cov-title">{suggestion.headline}</div>
          </div>
          <button type="button" className="cov-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === 'assign' && (
          <div className="cov-body">
            <div className="cov-freed">
              <div className="cov-freed-t">
                Freeing <b>{freed.start}–{freed.end}</b> from {sourceCrew.name} · <b>{fmt(freed.hours)}</b> to cover
              </div>
              <div className={`cov-tally ${remaining === 0 ? 'full' : 'part'}`}>
                {assigned}h of {freedH}h allocated{remaining === 0 ? ' ✓' : ` · ${remaining}h unassigned`}
              </div>
            </div>

            {candidates.length === 0 ? (
              <div className="cov-empty">
                No same-department crew have rest headroom to absorb these hours.
                You can still free the block and assign cover manually in the grid.
              </div>
            ) : candidates.map((c) => {
              const hours = alloc?.[c.id] || 0;
              const after = recipientAfter(c, hours);
              return (
                <div key={c.id} className={`cov-cand${hours > 0 ? ' picked' : ''}`}>
                  <div className="cov-cand-top">
                    <div className="cov-cand-av">{c.initials}</div>
                    <div>
                      <div className="cov-cand-name">{c.name}</div>
                      <div className="cov-cand-role">{c.role}</div>
                    </div>
                    <div className="cov-cand-room">
                      <div className="h">Headroom</div>
                      <div className="v">+{fmt(c.headroom)}</div>
                    </div>
                  </div>
                  <div className="cov-alloc">
                    <div className="cov-alloc-lbl">
                      {hours > 0
                        ? <>Takes <b>{slices.find((s) => s.id === c.id)?.start}–{slices.find((s) => s.id === c.id)?.end}</b> · {fmt(after.rest24)} rest today</>
                        : 'Available — none assigned'}
                    </div>
                    <div className="cov-stepper">
                      <button type="button" onClick={() => setHours(c.id, hours - 1, c.headroom)} disabled={hours <= 0}>–</button>
                      <span className="val">{hours}h</span>
                      <button type="button" onClick={() => setHours(c.id, hours + 1, c.headroom)} disabled={hours >= Math.floor(c.headroom) || remaining <= 0}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="cov-actions">
              <button
                type="button"
                className="cov-btn primary"
                disabled={assigned === 0}
                onClick={() => setStep('preview')}
              >
                Review changes →
              </button>
              <button type="button" className="cov-btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="cov-body">
            <div className="cov-sec-label">{slices.length + 1} crew affected · {freed.date}</div>

            {/* Source */}
            <div className="cov-pv">
              <div className="cov-pv-name">{sourceCrew.name} <span className="cov-pv-delta">+{fmt(assigned)} rest</span></div>
              <div className="cov-pv-diff">
                {freed.action === 'shorten'
                  ? <span className="rm">– trim to {freed.keep.start}–{freed.keep.end}</span>
                  : <span className="rm">– remove {freed.start}–{freed.end}</span>}
              </div>
            </div>

            {/* Recipients */}
            {slices.map((s) => {
              const c = candById.get(s.id);
              const after = recipientAfter(c, s.hours);
              return (
                <div key={s.id} className="cov-pv">
                  <div className="cov-pv-name">{c.name} · {c.role}</div>
                  <div className="cov-pv-diff"><span className="add">+ add {s.start}–{s.end}</span></div>
                  <div className="cov-pv-line">
                    Daily <span className={`cov-chip ${after.dailyOk ? 'ok' : 'warn'}`}>{fmt(after.rest24)}{after.dailyOk ? ' ✓' : ' ✗'}</span>
                    Weekly <span className={`cov-chip ${after.weeklyOk ? 'ok' : 'warn'}`}>{fmt(after.week)}{after.weeklyOk ? ' ✓' : ' ✗'}</span>
                  </div>
                </div>
              );
            })}

            {remaining > 0 && (
              <div className="cov-note warn">{remaining}h still unassigned — the source keeps that portion. Go back to allocate it fully.</div>
            )}
            <div className="cov-note">Recipients re-checked against the 10h daily / 77h weekly limits. Confirm writes all edits to the grid as draft.</div>

            <div className="cov-actions">
              <button type="button" className="cov-btn primary" disabled={busy} onClick={handleConfirm}>
                {busy ? 'Applying…' : 'Confirm & apply'}
              </button>
              <button type="button" className="cov-btn ghost" disabled={busy} onClick={() => setStep('assign')}>Back</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
