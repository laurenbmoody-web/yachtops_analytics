import React, { useMemo, useState } from 'react';
import {
  buildCandidates, assessRecipient, buildApplyPlan, planCoverage, freeHoursInWindow,
} from './coverageEngine';
import { ON_DUTY_TYPES, MLC_DAILY_REST_MIN, MLC_WEEKLY_REST_MIN } from './restHours';

const toDecLocal = (hhmm) => {
  const [h, m] = String(hhmm || '').slice(0, 5).split(':').map(Number);
  return (Number.isNaN(h) ? 0 : h) + ((m || 0) / 60);
};

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
  open, suggestion, sourceCrew, crew, windowShifts, base,
  ensureDraft, applyTemplate, onApplied, onClose, onToast, publishImmediately = false,
  realToday = null, nowHHMM = null,
}) {
  const freed = suggestion?.freedBlock || null;
  // Already-worked hours can't be reassigned — block any freed slot on a past
  // day or one that's already started today. (Engine already filters these;
  // this is the last line of defence before a write.)
  const freedIsPast = !!freed && !!realToday && (
    freed.date < realToday
    || (freed.date === realToday && !!nowHHMM && (freed.start || '').slice(0, 5) <= nowHHMM)
  );
  // Every same-dept candidate with rest headroom; planCoverage decides who is
  // free for which part of the block (several can make up one block).
  const candidates = useMemo(
    () => (freed && sourceCrew ? buildCandidates({ sourceMember: sourceCrew, crew }) : []),
    [freed, sourceCrew, crew],
  );
  const candById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  // How many hours each candidate is actually free for inside the block —
  // caps their stepper, and 0 means they're on duty then (unavailable).
  const availById = useMemo(() => {
    const m = new Map();
    if (freed) {
      for (const c of candidates) {
        const free = freeHoursInWindow({
          memberId: c.id, date: freed.date, start: freed.start, end: freed.end, windowShifts,
        });
        m.set(c.id, Math.max(0, Math.min(free, Math.floor(c.headroom))));
      }
    }
    return m;
  }, [candidates, freed, windowShifts]);

  const [step, setStep] = useState('assign'); // 'assign' | 'preview'
  const [alloc, setAlloc] = useState(null);    // { [memberId]: hour cap }
  const [busy, setBusy] = useState(false);

  // Seed from an uncapped plan: each covered member's planned hours become their
  // default cap, so the chief sees a sensible multi-person spread to adjust.
  React.useEffect(() => {
    if (!open || !freed) return;
    setStep('assign');
    const base = planCoverage({ freed, candidates, date: freed.date, windowShifts });
    const a = {};
    for (const c of candidates) a[c.id] = 0; // explicit caps for everyone
    for (const s of base.slices) if (!s.gap && s.id) a[s.id] = (a[s.id] || 0) + s.hours;
    setAlloc(a);
  }, [open, freed, candidates, windowShifts]);

  // All hooks must run before any early return (React rules-of-hooks).
  if (!open || !freed) return null;

  const freedH = Math.round(freed.hours);

  // Plan the actual time-correct coverage given the current per-person caps.
  const plan = planCoverage({ freed, candidates, date: freed.date, windowShifts, caps: alloc || {} });
  const slices = plan.slices.filter((s) => !s.gap && s.id);
  const gapSlices = plan.slices.filter((s) => s.gap);
  const gapHours = plan.gapHours;
  const assigned = Math.round((freed.hours - gapHours) * 10) / 10;
  const remaining = Math.round(gapHours * 10) / 10;

  const setHours = (id, next, cap) => {
    const clamped = Math.max(0, Math.min(next, Math.floor(cap)));
    setAlloc((prev) => ({ ...prev, [id]: clamped }));
  };

  // Build a recipient's resulting day as a 24h bar: their existing on-duty
  // blocks on the freed date PLUS the new covering slice (highlighted), with
  // the gaps shown as rest — so the chief sees where the cover actually lands.
  const daySegments = (memberId, slice) => {
    const dur = (st, en) => { let d = toDecLocal(en) - toDecLocal(st); if (d <= 0) d += 24; return d; };
    const raw = [];
    for (const s of (windowShifts || [])) {
      if (s.memberId === memberId && s.date === freed.date && ON_DUTY_TYPES.has(s.shiftType)) {
        raw.push({ start: toDecLocal(s.startTime), hours: dur(s.startTime, s.endTime), kind: 'duty' });
      }
    }
    if (slice) raw.push({ start: toDecLocal(slice.start), hours: dur(slice.start, slice.end), kind: 'new' });
    raw.sort((a, b) => a.start - b.start);
    const segs = [];
    let cursor = 0;
    for (const b of raw) {
      const end = Math.min(24, b.start + b.hours);
      if (b.start > cursor) segs.push({ kind: 'rest', hours: b.start - cursor });
      if (end > Math.max(b.start, cursor)) segs.push({ kind: b.kind, hours: end - Math.max(b.start, cursor) });
      cursor = Math.max(cursor, end);
    }
    if (cursor < 24) segs.push({ kind: 'rest', hours: 24 - cursor });
    return segs;
  };

  // Source's RESULTING day as a 24h bar: their existing on-duty blocks with the
  // COVERED intervals subtracted (any uncovered gap stays on them, so it still
  // shows as duty). Lets the chief see exactly how much relief actually lands.
  const sourceDaySegments = () => {
    const dur = (st, en) => { let d = toDecLocal(en) - toDecLocal(st); if (d <= 0) d += 24; return d; };
    const covered = slices.map((s) => [toDecLocal(s.start), Math.min(24, toDecLocal(s.start) + dur(s.start, s.end))]);
    const subtractCovered = (start, end) => {
      let pieces = [[start, end]];
      for (const [cs, ce] of covered) {
        const next = [];
        for (const [ps, pe] of pieces) {
          if (ce <= ps || cs >= pe) { next.push([ps, pe]); continue; }
          if (ps < cs) next.push([ps, cs]);
          if (pe > ce) next.push([ce, pe]);
        }
        pieces = next;
      }
      return pieces;
    };
    const duties = [];
    for (const s of (windowShifts || [])) {
      if (s.memberId !== sourceCrew.id || s.date !== freed.date || !ON_DUTY_TYPES.has(s.shiftType)) continue;
      const start = toDecLocal(s.startTime);
      const end = Math.min(24, start + dur(s.startTime, s.endTime));
      for (const [ps, pe] of subtractCovered(start, end)) if (pe > ps) duties.push({ start: ps, end: pe });
    }
    duties.sort((a, b) => a.start - b.start);
    const segs = [];
    let cursor = 0;
    for (const b of duties) {
      if (b.start > cursor) segs.push({ kind: 'rest', hours: b.start - cursor });
      if (b.end > Math.max(b.start, cursor)) segs.push({ kind: 'duty', hours: b.end - Math.max(b.start, cursor) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < 24) segs.push({ kind: 'rest', hours: 24 - cursor });
    return segs;
  };

  // Full four-rule MLC re-check for a recipient given their carved slice.
  const assessFor = (id) => {
    const slice = slices.find((s) => s.id === id);
    return assessRecipient({
      memberId: id,
      windowShifts,
      date: freed.date,
      block: slice ? { ...slice, shiftType: freed.sourceShiftType } : null,
    });
  };
  // True if any chosen recipient would breach ANY MLC rule — blocks Confirm.
  const recipientBreach = slices.some((s) => assessFor(s.id).anyBreach);

  const handleConfirm = async () => {
    if (recipientBreach) return;
    if (freedIsPast) {
      onToast?.('That block is already in the past — already-worked hours can’t be reassigned.', { type: 'error' });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      // Publish-capable tiers write live and skip the draft revert; everyone
      // else flips the dept to draft first (the normal review workflow).
      if (!publishImmediately && ensureDraft && sourceCrew?.departmentId) {
        await ensureDraft(sourceCrew.departmentId);
      }
      const applyPlan = buildApplyPlan({
        base: { ...base, sourceMemberId: sourceCrew.id, status: publishImmediately ? 'published' : 'draft' },
        freed,
        slices,
        // Any uncovered gap stays on the source rather than vanishing.
        sourceKeep: gapSlices.map((g) => ({ start: g.start, end: g.end })),
      });
      const res = await applyTemplate(applyPlan);
      if (res?.ok) {
        const gapNote = remaining > 0 ? ` · ${remaining}h left with ${sourceCrew.name.split(' ')[0]} (no cover)` : '';
        onToast?.(`${publishImmediately ? 'Published' : 'Applied'} — ${assigned}h reassigned across ${slices.length} crew${gapNote}`, { type: 'success' });
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

  // 24h timeline pieces, shared by both source + recipient bars.
  const Bar = ({ segs, label }) => (
    <div className="cov-bar" aria-label={label}>
      {segs.map((seg, i) => (
        <div
          key={i}
          className={`cov-seg ${seg.kind}`}
          title={`${seg.kind === 'new' ? 'New cover' : seg.kind === 'duty' ? 'On duty' : 'Rest'} · ${seg.hours.toFixed(1)}h`}
          style={{ width: `${(seg.hours / 24) * 100}%` }}
        />
      ))}
    </div>
  );
  const Ticks = () => (
    <div className="cov-ticks" aria-hidden="true">
      {['00', '06', '12', '18', '24'].map((t, i) => (
        <span key={t} style={{ left: `${i * 25}%` }}>{t}</span>
      ))}
    </div>
  );

  // Source's resulting rest once the freed hours come off its day/week.
  const srcRest24 = (sourceCrew.rest24hDecimal ?? 0) + assigned;
  const srcWeek = (sourceCrew.pastWeekHours ?? 0) + assigned;
  const srcDailyOk = srcRest24 >= MLC_DAILY_REST_MIN;
  const srcWeeklyOk = srcWeek >= MLC_WEEKLY_REST_MIN;

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
                {assigned}h of {freedH}h covered{remaining === 0 ? ' ✓' : ` · ${remaining}h no one free (stays with ${sourceCrew.name.split(' ')[0]})`}
              </div>
            </div>

            {candidates.length === 0 ? (
              <div className="cov-empty">
                No same-department crew have the rest headroom to absorb these hours. You can
                still free the block and arrange cover manually in the grid.
              </div>
            ) : candidates.map((c) => {
              const hours = alloc?.[c.id] || 0;
              const avail = availById.get(c.id) || 0;
              const a = assessFor(c.id);
              const slice = slices.find((s) => s.id === c.id);
              const breaks = hours > 0 && a.anyBreach;
              const unavailable = avail <= 0;
              return (
                <div key={c.id} className={`cov-cand${hours > 0 ? ' picked' : ''}${breaks ? ' breach' : ''}${unavailable ? ' muted' : ''}`}>
                  <div className="cov-cand-top">
                    <div className="cov-cand-av">{c.initials}</div>
                    <div>
                      <div className="cov-cand-name">{c.name}</div>
                      <div className="cov-cand-role">{c.role}</div>
                    </div>
                    <div className="cov-cand-room">
                      <div className="h">{unavailable ? 'Free now' : 'Headroom'}</div>
                      <div className="v">{unavailable ? '0h' : `+${fmt(c.headroom)}`}</div>
                    </div>
                  </div>
                  <div className="cov-alloc">
                    <div className="cov-alloc-lbl">
                      {unavailable
                        ? <span className="warn">On duty during this block — unavailable</span>
                        : hours > 0
                          ? (breaks
                              ? <span className="warn">Takes <b>{slice?.start}–{slice?.end}</b> · would breach — {a.structuralNote || (!a.dailyOk ? 'under 10h rest' : 'under 77h week')}</span>
                              : <>Takes <b>{slice?.start}–{slice?.end}</b> · {fmt(a.rest24)} rest today</>)
                          : `Free up to ${fmt(avail)} of this block — none assigned`}
                    </div>
                    <div className="cov-stepper">
                      <button type="button" onClick={() => setHours(c.id, hours - 1, avail)} disabled={hours <= 0}>–</button>
                      <span className="val">{hours}h</span>
                      <button type="button" onClick={() => setHours(c.id, hours + 1, avail)} disabled={hours >= Math.floor(avail)}>+</button>
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
            <div className="cov-meta">
              <span className="cov-sec-label">{slices.length + 1} crew affected · {freed.date}</span>
              <span className="cov-legend">
                <span><i className="n" />cover</span>
                <span><i className="d" />duty</span>
                <span><i className="r" />rest</span>
              </span>
            </div>

            {/* Source — resulting day (the removal was confirmed last step, so
                the freed time just shows as rest and the rest gain is flush-right) */}
            <div className="cov-unit">
              <div className="cov-av">{sourceCrew.initials}</div>
              <div className="cov-unit-main">
                <div className="cov-who">
                  <div className="cov-who-name">{sourceCrew.name}<span className="cov-who-role">{sourceCrew.role}</span></div>
                  <div className="cov-delta">+{fmt(assigned)} rest</div>
                </div>
                <Bar segs={sourceDaySegments()} label={`${sourceCrew.name} resulting day on ${freed.date}`} />
                <Ticks />
                <div className="cov-compliance">
                  <span className="k">Daily</span><span className={`cov-chip ${srcDailyOk ? 'ok' : 'warn'}`}>{fmt(srcRest24)}{srcDailyOk ? ' ✓' : ' ✗'}</span>
                  <span className="k">Weekly</span><span className={`cov-chip ${srcWeeklyOk ? 'ok' : 'warn'}`}>{fmt(srcWeek)}{srcWeeklyOk ? ' ✓' : ' ✗'}</span>
                </div>
              </div>
            </div>

            {/* Recipients — new cover highlighted, full four-rule re-check */}
            {slices.map((s) => {
              const c = candById.get(s.id);
              const a = assessFor(s.id);
              return (
                <div key={s.id} className="cov-unit">
                  <div className="cov-av">{c.initials}</div>
                  <div className="cov-unit-main">
                    <div className="cov-who">
                      <div className="cov-who-name">{c.name}<span className="cov-who-role">{c.role}</span></div>
                      <div className="cov-delta cover">+{fmt(s.hours)} cover</div>
                    </div>
                    <div className="cov-change"><span className="add">+ add {s.start}–{s.end}</span></div>
                    <Bar segs={daySegments(s.id, s)} label={`${c.name} resulting day on ${freed.date}`} />
                    <Ticks />
                    <div className="cov-compliance">
                      <span className="k">Daily</span><span className={`cov-chip ${a.dailyOk ? 'ok' : 'warn'}`}>{fmt(a.rest24)}{a.dailyOk ? ' ✓' : ' ✗'}</span>
                      <span className="k">Weekly</span><span className={`cov-chip ${a.weeklyOk ? 'ok' : 'warn'}`}>{fmt(a.week)}{a.weeklyOk ? ' ✓' : ' ✗'}</span>
                      {a.structuralNote && <span className="cov-chip warn">{a.structuralNote} ✗</span>}
                    </div>
                  </div>
                </div>
              );
            })}

            {freedIsPast && (
              <div className="cov-note warn">This block is already in the past — already-worked hours can’t be reassigned. Pick a suggestion for an upcoming day instead.</div>
            )}
            {recipientBreach && (
              <div className="cov-note warn">This split would push a recipient into an MLC breach. Go back and re-allocate — coverage can't create a new breach.</div>
            )}
            {remaining > 0 && (
              <div className="cov-note warn">
                {gapSlices.map((g) => `${g.start}–${g.end}`).join(', ')} — no one is free to cover
                ({remaining}h), so {sourceCrew.name.split(' ')[0]} keeps that portion. The rest of the block is still handed off.
              </div>
            )}
            <div className="cov-note">Recipients re-checked against all four MLC rules (10h daily · 77h weekly · rest split · 14h continuous). Confirm {publishImmediately ? 'publishes all edits to the grid live' : 'writes all edits to the grid as draft'}.</div>

            <div className="cov-actions">
              <button type="button" className="cov-btn primary" disabled={busy || recipientBreach || freedIsPast} onClick={handleConfirm}>
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
