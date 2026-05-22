import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// Phase 3a — Apply-template modal.
//
// Opens when the user clicks a template row body in the picker.
// Simple-template path is fully wired; shift-pattern templates render
// a stub pointing to Phase 3b. Writes nothing on open — only on the
// explicit "Apply to rota" button after a conflict review (if any).
//
// Date handling: all dates are PLAIN LOCAL 'YYYY-MM-DD' strings —
// never toISOString() (which would UTC-shift across midnight and
// reintroduce an off-by-one). All week math runs on local Date
// constructors with the local components extracted.

const TYPE_COLOR = {
  duty: '#1C1B3A', watch: '#C65A1A', standby: '#B8935E',
  training: '#6B7F6B', medical: '#7A2E1E',
};

const pad = (n) => String(n).padStart(2, '0');

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

// Monday-start week (yachting / UK convention).
function startOfThisWeekMonday(today = new Date()) {
  const x = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = x.getDay();                       // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day;       // back to Monday
  x.setDate(x.getDate() + shift);
  return x;
}

function rangeDays(startStr, endStr) {
  if (!startStr || !endStr || startStr > endStr) return [];
  const [ys, ms, ds] = startStr.split('-').map(Number);
  const [ye, me, de] = endStr.split('-').map(Number);
  const start = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toLocalDateStr(d));
  }
  return out;
}

function fmtTime(t) { return t ? String(t).slice(0, 5) : ''; }

// Pretty range label for the header (matches editorial copy style).
function prettyRange(start, end) {
  if (!start) return '';
  if (start === end) return start;
  return `${start} – ${end}`;
}

function PatternStub({ template, onClose }) {
  return (
    <>
      <div className="rest-popover-backdrop" onClick={onClose} />
      <div className="te-panel ap-panel ap-panel-stub" role="dialog" aria-modal="true"
        aria-label={`Apply ${template?.name}`}>
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">Apply shift pattern</div>
            <h2 className="tp-title">{template?.name}</h2>
          </div>
          <button type="button" className="tp-close"
            aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ap-stub-body">
          <p>Applying a shift pattern ships in Phase 3b.</p>
          <p className="ap-stub-sub">
            For now you can preview the pattern via Edit.
            Picking and applying lands once Phase 3b is built.
          </p>
        </div>
        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            <button type="button" className="v2-btn-filled" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ApplyTemplateModal({
  open, template, rota, trip, crew = [], currentUser, tier, myMemberId,
  applyTemplate, ensureDraft, onClose, onToast,
}) {
  const isPattern = template?.kind === 'rotation';

  // Crew the user can tick. HOD restricted to own dept; all eligible
  // crew always shown (we filter on permission, not on template scope —
  // see report §4 decision).
  const hodDeptId = tier === 'HOD' ? (currentUser?.department_id || null) : null;
  const visibleCrew = useMemo(() => {
    if (!hodDeptId) return crew;
    return crew.filter((c) => c.departmentId === hodDeptId);
  }, [crew, hodDeptId]);

  // Today for date math (real wall-clock today, not effectiveDate).
  const todayStr = toLocalDateStr(new Date());

  // Date preset state. Computed start/end derive in renderable defaults.
  const [preset, setPreset] = useState('thisWeek');
  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);
  const [ticked, setTicked] = useState(() => new Set());
  const [phase, setPhase] = useState('select');        // 'select' | 'conflicts' | 'applying'
  const [conflicts, setConflicts] = useState(null);    // { total, conflictIds, conflictKeys, conflictRows }
  const [busy, setBusy] = useState(false);

  // Re-seed every time the modal OPENS (or opens with a different
  // template). Deps are intentionally narrow so a background `crew`
  // refetch while the modal is open does NOT clobber the user's choices.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    let initial;
    if (template?.scope === 'department' && template?.departmentId) {
      initial = new Set(visibleCrew
        .filter((c) => c.departmentId === template.departmentId)
        .map((c) => c.id));
    } else {
      initial = new Set();
    }
    setPreset('thisWeek');
    setCustomStart(todayStr);
    setCustomEnd(todayStr);
    setTicked(initial);
    setPhase('select');
    setConflicts(null);
    setBusy(false);
  }, [open, template?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Hooks MUST be called unconditionally on every render — keep all
  // useMemo / useEffect calls above any early returns. Cheap to compute
  // even when the modal is closed or rendering the pattern stub.
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    if (preset === 'today') {
      return { rangeStart: todayStr, rangeEnd: todayStr };
    }
    if (preset === 'thisWeek') {
      const monday = startOfThisWeekMonday(today);
      return {
        rangeStart: toLocalDateStr(monday),
        rangeEnd: toLocalDateStr(addDays(monday, 6)),
      };
    }
    if (preset === 'nextWeek') {
      const nextMonday = addDays(startOfThisWeekMonday(today), 7);
      return {
        rangeStart: toLocalDateStr(nextMonday),
        rangeEnd: toLocalDateStr(addDays(nextMonday, 6)),
      };
    }
    if (preset === 'wholeTrip' && trip?.dateStart && trip?.dateEnd) {
      return { rangeStart: trip.dateStart, rangeEnd: trip.dateEnd };
    }
    return { rangeStart: customStart, rangeEnd: customEnd };
  }, [preset, customStart, customEnd, trip, todayStr]);

  const dates = useMemo(() => rangeDays(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  // tickedCrew also needs to live above the early returns (uses useMemo
  // and is referenced in the JSX below).
  const tickedCrewMemo = useMemo(
    () => visibleCrew.filter((c) => ticked.has(c.id)),
    [visibleCrew, ticked],
  );

  if (!open || !template) return null;
  if (isPattern) return <PatternStub template={template} onClose={onClose} />;

  // ── Header detail ────────────────────────────────────────────────────────
  const headerScope = template.scope === 'vessel'
    ? 'All departments'
    : (template.departmentName || 'Department');
  // Every template now carries times (no-fixed-hours retired 2026-05-22).
  // Show "—" as a defensive fallback only if data is somehow malformed.
  const headerHours = template.body?.start_time && template.body?.end_time
    ? `${fmtTime(template.body.start_time)} – ${fmtTime(template.body.end_time)}`
    : '—';
  const headerType = template.body?.shift_type || 'duty';

  // ── Build target rows the apply WOULD insert ─────────────────────────────
  const tickedMemberIds = Array.from(ticked);
  const tickedCrew = tickedCrewMemo;
  const totalToWrite = tickedCrew.length * dates.length;

  const buildInsertRow = (memberId, dateStr) => {
    const body = template.body || {};
    const row = {
      tenant_id: rota?.tenantId,
      rota_id: rota?.id,
      member_id: memberId,
      shift_date: dateStr,
      start_time: body.start_time || '00:00',
      end_time: body.end_time || '00:00',
      shift_type: body.shift_type || 'duty',
    };
    if (body.sub_type) row.sub_type = body.sub_type;
    if (rota?.ownerType === 'trip' && rota?.tripId) row.trip_id = rota.tripId;
    if (myMemberId) row.created_by = myMemberId;
    return row;
  };

  // ── Apply (with conflict review) ─────────────────────────────────────────
  const runConflictCheck = async () => {
    if (totalToWrite === 0) {
      onToast?.('Pick at least one crew member to apply this template.');
      return;
    }
    setBusy(true);
    try {
      const { data, error: qErr } = await supabase
        .from('rota_shifts')
        .select('id, member_id, shift_date')
        .eq('tenant_id', rota.tenantId)
        .in('member_id', tickedMemberIds)
        .in('shift_date', dates);
      if (qErr) throw qErr;

      const targetKeys = new Set();
      for (const m of tickedMemberIds) for (const d of dates) targetKeys.add(`${m}|${d}`);
      const conflictRows = (data || []).filter((r) =>
        targetKeys.has(`${r.member_id}|${r.shift_date}`),
      );

      if (conflictRows.length === 0) {
        await commit({ mode: 'skip', conflictKeys: new Set(), conflictIds: [] });
        return;
      }
      setConflicts({
        total: totalToWrite,
        clashes: conflictRows.length,
        conflictKeys: new Set(conflictRows.map((r) => `${r.member_id}|${r.shift_date}`)),
        conflictIds: conflictRows.map((r) => r.id),
      });
      setPhase('conflicts');
    } catch (e) {
      onToast?.(`Conflict check failed — ${e.message || 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async ({ mode, conflictKeys, conflictIds }) => {
    setBusy(true);
    setPhase('applying');
    const rows = [];
    for (const m of tickedMemberIds) {
      for (const d of dates) {
        if (mode === 'skip' && conflictKeys.has(`${m}|${d}`)) continue;
        rows.push(buildInsertRow(m, d));
      }
    }
    const deleteIds = mode === 'overwrite' ? (conflictIds || []) : [];
    const res = await applyTemplate({ rows, deleteIds });
    if (!res.ok) {
      onToast?.(`Couldn’t apply — ${res.error || 'try again'}`);
      setBusy(false);
      setPhase(conflicts ? 'conflicts' : 'select');
      return;
    }

    // Ensure rota_department_status draft per affected department.
    const memberDeptMap = new Map(visibleCrew.map((c) => [c.id, c.departmentId]));
    const affectedDeptIds = new Set();
    for (const r of rows) {
      const did = memberDeptMap.get(r.member_id);
      if (did) affectedDeptIds.add(did);
    }
    for (const departmentId of affectedDeptIds) {
      // Fire-and-forget; the helper is itself optimistic + non-throwing.
      // eslint-disable-next-line no-await-in-loop
      const er = await ensureDraft({
        departmentId,
        vesselId: rota.vesselId,
        tenantId: rota.tenantId,
      });
      if (!er.ok && er.reason === 'no-init') {
        onToast?.('Department status not initialized — ask a CHIEF or COMMAND to enable editing.');
      }
    }

    onToast?.(
      `Wrote ${res.inserted} draft shift${res.inserted === 1 ? '' : 's'}` +
      (res.deleted ? ` (overwrote ${res.deleted}).` : '.'),
    );
    onClose?.();
  };

  // ── Render: select phase ─────────────────────────────────────────────────
  const dateChips = [
    ['today',    'Just today'],
    ['thisWeek', 'This week'],
    ['nextWeek', 'Next week'],
  ];
  const hasTrip = rota?.ownerType === 'trip' && trip?.dateStart && trip?.dateEnd;

  const toggleAll = (target) => {
    if (target) {
      setTicked(new Set(visibleCrew.map((c) => c.id)));
    } else {
      setTicked(new Set());
    }
  };

  return (
    <>
      <div className="rest-popover-backdrop" onClick={busy ? undefined : onClose} />
      <div
        className="te-panel ap-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Apply ${template.name}`}
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">Apply template</div>
            <h2 className="tp-title">{template.name}</h2>
            <div className="ap-header-sub">
              <span
                className="ap-header-swatch"
                style={{ background: TYPE_COLOR[headerType] || '#B4B2A9' }}
                aria-hidden
              />
              <span>{headerScope}</span>
              <span className="tp-dot">·</span>
              <span>{headerHours}</span>
            </div>
          </div>
          <button type="button" className="tp-close"
            aria-label="Close" onClick={busy ? undefined : onClose}><X size={16} /></button>
        </div>

        {phase !== 'conflicts' && (
          <div className="te-body ap-body">
            <div className="te-field">
              <span className="te-field-label">When</span>
              <div className="ap-chips">
                {dateChips.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    className={`crew-rota-pill${preset === k ? ' active' : ''}`}
                    onClick={() => setPreset(k)}
                  >{l}</button>
                ))}
                {hasTrip && (
                  <button
                    type="button"
                    className={`crew-rota-pill${preset === 'wholeTrip' ? ' active' : ''}`}
                    onClick={() => setPreset('wholeTrip')}
                    title={`Trip: ${trip.dateStart} → ${trip.dateEnd}`}
                  >Whole trip ({rangeDays(trip.dateStart, trip.dateEnd).length}d)</button>
                )}
                <button
                  type="button"
                  className={`crew-rota-pill${preset === 'custom' ? ' active' : ''}`}
                  onClick={() => setPreset('custom')}
                >Custom…</button>
              </div>
              {preset === 'custom' && (
                <div className="ap-custom">
                  <label className="te-field-sub">
                    <span className="te-field-label">From</span>
                    <input type="date" className="te-input"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)} />
                  </label>
                  <label className="te-field-sub">
                    <span className="te-field-label">To</span>
                    <input type="date" className="te-input"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)} />
                  </label>
                </div>
              )}
              <div className="ap-range-line">
                {dates.length > 0
                  ? <>Range: <strong>{prettyRange(rangeStart, rangeEnd)}</strong> · {dates.length} day{dates.length === 1 ? '' : 's'}</>
                  : <em>No days selected.</em>}
              </div>
            </div>

            <div className="te-field">
              <div className="ap-crew-head">
                <span className="te-field-label">Crew</span>
                <div className="ap-crew-actions">
                  <button type="button" className="ap-linkbtn"
                    onClick={() => toggleAll(true)}>Select all</button>
                  <span className="tp-dot">·</span>
                  <button type="button" className="ap-linkbtn"
                    onClick={() => toggleAll(false)}>None</button>
                </div>
              </div>
              {hodDeptId && (
                <div className="ap-hod-hint">
                  HOD scope — only your department’s crew can be assigned.
                </div>
              )}
              <div className="ap-crew-list">
                {visibleCrew.length === 0 && (
                  <div className="ap-empty">No eligible crew.</div>
                )}
                {visibleCrew.map((c) => {
                  const isOn = ticked.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`te-dept-row${isOn ? ' is-selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => {
                          setTicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                            return next;
                          });
                        }}
                      />
                      <span className="ap-crew-name">{c.name}</span>
                      <span className="ap-crew-role">{c.role || ''}</span>
                      <span className="ap-crew-dept">{c.department || ''}</span>
                    </label>
                  );
                })}
              </div>
              <div className="ap-summary">
                <strong>{ticked.size}</strong> crew × <strong>{dates.length}</strong> day{dates.length === 1 ? '' : 's'} =
                {' '}<strong>{totalToWrite}</strong> draft shift{totalToWrite === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        )}

        {phase === 'conflicts' && conflicts && (
          <div className="te-body ap-body">
            <div className="ap-conflict">
              <div className="ap-conflict-head">
                <AlertTriangle size={16} color="#7A2E1E" />
                <span>Existing shifts in this range</span>
              </div>
              <div className="ap-conflict-body">
                This will create <strong>{conflicts.total}</strong> shift{conflicts.total === 1 ? '' : 's'}.
                {' '}<strong>{conflicts.clashes}</strong> of them clash with an existing shift.
              </div>
              <div className="ap-conflict-help">
                Pick one rule for the whole batch:
              </div>
              <ul className="ap-conflict-options">
                <li><strong>Skip the clashing days</strong> — only write where the crew member is free; existing shifts stay.</li>
                <li><strong>Overwrite</strong> — replace the clashing shifts with this template (still as drafts).</li>
              </ul>
            </div>
          </div>
        )}

        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            {phase === 'select' && (
              <>
                <button type="button" className="v2-btn-ghost"
                  onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="v2-btn-filled"
                  onClick={runConflictCheck}
                  disabled={busy || totalToWrite === 0}>
                  {busy ? 'Checking…' : `Apply to rota`}
                </button>
              </>
            )}
            {phase === 'conflicts' && conflicts && (
              <>
                <button type="button" className="v2-btn-ghost"
                  onClick={() => setPhase('select')} disabled={busy}>Back</button>
                <button type="button" className="v2-btn-ghost"
                  onClick={() => commit({
                    mode: 'skip',
                    conflictKeys: conflicts.conflictKeys,
                    conflictIds: [],
                  })}
                  disabled={busy}>Skip conflicts</button>
                <button type="button" className="v2-btn-filled"
                  onClick={() => commit({
                    mode: 'overwrite',
                    conflictKeys: new Set(),
                    conflictIds: conflicts.conflictIds,
                  })}
                  disabled={busy}>Overwrite</button>
              </>
            )}
            {phase === 'applying' && (
              <button type="button" className="v2-btn-filled" disabled>Applying…</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
