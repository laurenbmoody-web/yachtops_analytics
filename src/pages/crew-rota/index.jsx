import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import '../pantry/pantry.css';
import './crew-rota.css';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import RestPanelPopover from './RestPanelPopover';
import { useRotaShifts } from './useRotaShifts';
import { useCurrentRota } from './useCurrentRota';
import { useRotaDepartmentStatus } from './useRotaDepartmentStatus';

const EDITORIAL_BG = '#F5F1EA';
const GRID_START_HOUR = 6;
const SHIFT_TYPE_PILLS = [
  ['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'],
  ['training', 'Training'], ['off', 'Off'], ['medical', 'Medical'],
];
// Sub-type defaults applied to newly-created shifts.
function subTypeFor(type) {
  if (type === 'watch') return 'navigation';
  if (type === 'standby') return 'maintenance';
  return null;
}

function fullDateLabel(d) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// Slot i (30-min) → wall-clock decimals in the 06:00→06:00 window.
function slotDecimals(i) {
  const startDec = GRID_START_HOUR + i * 0.5;
  return { startDec, endDec: startDec + 0.5 };
}
function decToHHMM(dec) {
  let d = dec % 24;
  if (d < 0) d += 24;
  const h = Math.floor(d);
  const m = Math.round((d - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
// Unclamped, overnight-aware decimal + slot span of a raw shift row
// (mirrors deriveCrew). Used for hole-punch start/middle/end math.
function shiftDecRange(s) {
  const toDec = (t) => {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    return h + (m || 0) / 60;
  };
  let st = toDec(s.startTime);
  let en = toDec(s.endTime);
  if (st == null || en == null) return null;
  if (en <= st) en += 24;
  return {
    startDec: st,
    endDec: en,
    sSlot: Math.round((st - GRID_START_HOUR) * 2),
    eSlot: Math.round((en - GRID_START_HOUR) * 2), // exclusive
  };
}

function RotaLegend({ now }) {
  const hhmmNow = now
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '';
  return (
    <div className="crew-rota-legend">
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#1C1B3A' }} />
        <span>Scheduled</span>
      </div>
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#F7F5F0' }} />
        <span>Off</span>
      </div>
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#EDEAE3' }} />
        <span>Saturday</span>
      </div>
      <div className="crew-rota-legend-item">
        <span style={{ width: 1.5, height: 14, background: '#C65A1A', opacity: 0.5, borderRadius: 1 }} />
        <span>Now ({hhmmNow})</span>
      </div>
      <div className="crew-rota-legend-item">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Below 10h MLC</span>
      </div>
    </div>
  );
}

// Tier-conditional footer CTA. Phase 1: actions are stubs (Phase 4).
function EditFooterCTA({ tier, draftCount, onStub }) {
  const n = draftCount;
  const pubLabel = `Publish (${n} draft${n === 1 ? '' : 's'})`;
  const subLabel = `Submit for approval (${n} draft${n === 1 ? '' : 's'})`;
  return (
    <div className="crew-rota-cta">
      {tier === 'COMMAND' && (
        <button type="button" className="v2-btn-filled" onClick={() => onStub('publish')}>
          {pubLabel}
        </button>
      )}
      {tier === 'CHIEF' && (
        <>
          <button type="button" className="v2-btn-ghost" onClick={() => onStub('submit')}>
            {subLabel}
          </button>
          <button type="button" className="v2-btn-filled" onClick={() => onStub('publish')}>
            {pubLabel}
          </button>
        </>
      )}
      {tier === 'HOD' && (
        <button type="button" className="v2-btn-filled" onClick={() => onStub('submit')}>
          {subLabel}
        </button>
      )}
      {!['COMMAND', 'CHIEF', 'HOD'].includes(tier) && (
        <span style={{ fontStyle: 'italic' }}>Read-only — your role can’t publish drafts.</span>
      )}
    </div>
  );
}

export default function CrewRotaPage() {
  const navigate = useNavigate();
  const now = new Date();
  const { user, tenantRole, activeTenantId } = useAuth();
  const [view, setView] = useState('grid');      // 'grid' | 'list'
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [shiftType, setShiftType] = useState('duty'); // active type for new shifts
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const tier = String(user?.permission_tier || tenantRole || '').toUpperCase();

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const {
    crew, loading, error, effectiveDate, draftCount,
    upsertCellShift, removeShift, updateShift, splitShift,
  } = useRotaShifts();
  const { rota } = useCurrentRota();
  const { statusByDept, ensureDraft } = useRotaDepartmentStatus(rota?.id);

  const total = crew.length;
  const onDuty = crew.filter(c => c.onNow && !c.offToday).length;
  const meta = `${fullDateLabel(now)} · ${total} crew on this trip · ${onDuty} on duty now`;

  const presentDepts = DEPT_ORDER.filter(d => crew.some(c => c.department === d));
  const cardContext = `${presentDepts.join(' · ')}  —  ${total} crew · ${onDuty} on duty`;

  // The acting user's own tenant_members.id — rota_shifts.created_by FKs
  // tenant_members(id), so stamp it on inserts when resolvable.
  const myMemberId = crew.find(c => c.userId === user?.id)?.id || null;

  // After any shift write, mark the affected department's status row as
  // draft (creating it for COMMAND/CHIEF; graceful toast for HOD if none).
  const syncDeptDraft = useCallback(async (crewMember) => {
    if (!crewMember?.departmentId) {
      showToast('No department on this crew member — draft saved, but state not tracked.');
      return;
    }
    if (!rota?.id) return;
    const res = await ensureDraft({
      departmentId: crewMember.departmentId,
      vesselId: rota.vesselId,
      tenantId: activeTenantId,
    });
    if (!res.ok && res.reason === 'no-init') {
      showToast('Department status not initialized — ask a CHIEF or COMMAND to enable editing.');
    } else if (!res.ok && res.reason === 'error') {
      showToast(`Couldn’t update department state: ${res.detail || 'unknown error'}`);
    }
  }, [ensureDraft, rota, activeTenantId, showToast]);

  // Cell click in edit mode. On an existing shift → punch a hole
  // (shrink start/end, split the middle, or delete a single cell). On an
  // empty cell → create a 30-min draft shift of the active type.
  const handleCellClick = useCallback(async (crewMember, slotIdx) => {
    if (!rota?.id) { showToast('No active rota resolved — cannot edit yet.'); return; }
    const { startDec } = slotDecimals(slotIdx);
    if (startDec >= 24) {
      // Post-midnight (Saturday) slots need next-day handling — Phase 1
      // edits the pre-midnight window only (documented limitation).
      showToast('Editing the post-midnight window ships in a later phase.');
      return;
    }
    const raws = crewMember.rawShifts || [];

    // Covering shift for this slot (overnight-aware, any type).
    let cover = null;
    for (const s of raws) {
      const r = shiftDecRange(s);
      if (r && slotIdx >= r.sSlot && slotIdx < r.eSlot) { cover = { s, ...r }; break; }
    }

    if (cover) {
      const { s, sSlot, eSlot, startDec: shStart, endDec: shEnd } = cover;
      let r;
      if (eSlot - sSlot <= 1) {
        // Only cell → delete the whole shift.
        r = await removeShift(s.id);
      } else if (slotIdx === sSlot) {
        // Start cell → shrink start by 30 min.
        r = await updateShift(s.id, { start_time: decToHHMM(shStart + 0.5) });
      } else if (slotIdx === eSlot - 1) {
        // End cell → shrink end by 30 min.
        r = await updateShift(s.id, { end_time: decToHHMM(shEnd - 0.5) });
      } else {
        // Middle cell → delete + recreate the two surviving pieces.
        // Punches exactly the clicked 30-min cell (consistent with the
        // start/end rules; see report re: the spec's middle example).
        const leftEndDec = GRID_START_HOUR + slotIdx * 0.5;
        const rightStartDec = GRID_START_HOUR + (slotIdx + 1) * 0.5;
        r = await splitShift({
          shiftId: s.id,
          meta: {
            rotaId: rota.id,
            memberId: crewMember.id,
            shiftDate: effectiveDate,
            shiftType: s.shiftType || 'duty',
            subType: s.subType ?? null,
            tripId: rota.ownerType === 'trip' ? rota.tripId : null,
            createdByMemberId: myMemberId,
          },
          pieces: [
            { startTime: decToHHMM(shStart), endTime: decToHHMM(leftEndDec) },
            { startTime: decToHHMM(rightStartDec), endTime: decToHHMM(shEnd) },
          ],
        });
      }
      if (!r.ok) { showToast(`Couldn’t edit shift: ${r.error}`); return; }
      await syncDeptDraft(crewMember);
      return;
    }

    // Empty cell → create a 30-min draft of the active type.
    const res = await upsertCellShift({
      rotaId: rota.id,
      memberId: crewMember.id,
      shiftDate: effectiveDate,
      startTime: decToHHMM(startDec),
      endTime: decToHHMM(startDec + 0.5),
      shiftType,
      subType: subTypeFor(shiftType),
      tripId: rota.ownerType === 'trip' ? rota.tripId : null,
      createdByMemberId: myMemberId,
    });
    if (!res.ok) { showToast(`Couldn’t save shift: ${res.error}`); return; }
    await syncDeptDraft(crewMember);
  }, [rota, effectiveDate, myMemberId, shiftType, upsertCellShift, removeShift,
      updateShift, splitShift, syncDeptDraft, showToast]);

  // Drag-paint commit: ONE continuous draft shift over slots [lo, hi].
  const handleCommitRange = useCallback(async (crewMember, loSlot, hiSlot) => {
    if (!rota?.id) { showToast('No active rota resolved — cannot edit yet.'); return; }
    const startDec = GRID_START_HOUR + loSlot * 0.5;
    let endDec = GRID_START_HOUR + (hiSlot + 1) * 0.5;
    if (startDec >= 24) {
      showToast('Editing the post-midnight window ships in a later phase.');
      return;
    }
    if (endDec > 24) endDec = 24; // clamp to the 06:00 next-day boundary
    const res = await upsertCellShift({
      rotaId: rota.id,
      memberId: crewMember.id,
      shiftDate: effectiveDate,
      startTime: decToHHMM(startDec),
      endTime: decToHHMM(endDec),
      shiftType,
      subType: subTypeFor(shiftType),
      tripId: rota.ownerType === 'trip' ? rota.tripId : null,
      createdByMemberId: myMemberId,
    });
    if (!res.ok) { showToast(`Couldn’t save shift: ${res.error}`); return; }
    await syncDeptDraft(crewMember);
  }, [rota, effectiveDate, myMemberId, shiftType, upsertCellShift, syncDeptDraft, showToast]);

  const canEdit = !!rota?.id && !loading && !error;

  return (
    <>
      <Header />
      <div className="editorial-page">

        <button type="button" className="crew-rota-back" onClick={() => navigate(-1)}>
          ← Back to trip
        </button>

        <div className="crew-rota-titleblock">
          <div className="crew-rota-meta">{meta}</div>
          <h1 className="crew-rota-title">
            The <em>rota</em>.
          </h1>
        </div>

        {/* Unified control bar — pills | date stepper */}
        <div className="crew-rota-controls">
          <div className="crew-rota-pillgroup">
            <button type="button" className="crew-rota-pill active">Today</button>
            <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Week</button>
            <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Hours of rest log</button>
          </div>
          <div className="crew-rota-divider" />
          <div className="crew-rota-stepper">
            <button type="button" className="crew-rota-stepper-btn" aria-label="Previous day" disabled>←</button>
            <span className="crew-rota-stepper-date">{fullDateLabel(now)}</span>
            <button type="button" className="crew-rota-stepper-btn" aria-label="Next day" disabled>→</button>
            <span className="crew-rota-stepper-helper">
              06:00 Fri — 06:00 Sat · 30-min cells · click any name for the rest panel
            </span>
          </div>
        </div>

        {/* Body card with its own header / body / footer */}
        <div className={`crew-rota-card${editMode ? ' is-editing' : ''}`}>
          <div className="crew-rota-card-header">
            <div className="crew-rota-card-context">{cardContext}</div>
            <div className="crew-rota-pillgroup">
              <button
                type="button"
                className={`crew-rota-pill${view === 'grid' ? ' active' : ''}`}
                onClick={() => setView('grid')}
              >Grid</button>
              <button
                type="button"
                className={`crew-rota-pill${view === 'list' ? ' active' : ''}`}
                onClick={() => setView('list')}
              >List</button>
              {editMode ? (
                <button
                  type="button"
                  className="crew-rota-pill active edit-pill"
                  onClick={() => setEditMode(false)}
                >Done</button>
              ) : (
                <button
                  type="button"
                  className={`crew-rota-pill edit-pill${canEdit ? '' : ' disabled'}`}
                  aria-disabled={!canEdit}
                  title={canEdit ? 'Edit the rota' : 'Rota not ready'}
                  onClick={() => { if (canEdit) setEditMode(true); }}
                ><Pencil size={12} /> Edit</button>
              )}
            </div>
          </div>

          {editMode && view === 'grid' && (
            <div className="crew-rota-typebar" role="radiogroup" aria-label="Shift type">
              <span className="crew-rota-typebar-label">New shift</span>
              {SHIFT_TYPE_PILLS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={shiftType === key}
                  className={`crew-rota-pill${shiftType === key ? ' active' : ''}`}
                  onClick={() => setShiftType(key)}
                >{label}</button>
              ))}
            </div>
          )}

          <div className="crew-rota-card-body">
            {loading ? (
              <div style={{
                padding: '48px 0', textAlign: 'center',
                fontFamily: 'var(--font-sans)', fontSize: 13,
                color: 'var(--ink-muted)', fontStyle: 'italic',
              }}>
                Loading the rota…
              </div>
            ) : error ? (
              <div style={{
                padding: '48px 0', textAlign: 'center',
                fontFamily: 'var(--font-sans)', fontSize: 13, color: '#7A2E1E',
              }}>
                Couldn't load the rota. {error}
              </div>
            ) : view === 'grid' ? (
              <RotaTodayGrid
                crew={crew}
                now={now}
                gridStartHour={GRID_START_HOUR}
                onCrewClick={setSelectedCrew}
                editMode={editMode}
                onCellClick={handleCellClick}
                onCommitRange={handleCommitRange}
                deptStatus={statusByDept}
              />
            ) : (
              <CrewListView crew={crew} onCrewClick={setSelectedCrew} />
            )}
          </div>

          <div className="crew-rota-card-footer">
            {editMode ? (
              <EditFooterCTA
                tier={tier}
                draftCount={draftCount}
                onStub={(kind) => showToast(
                  kind === 'publish'
                    ? 'Publishing ships in Phase 4.'
                    : 'Submit for approval ships in Phase 4.',
                )}
              />
            ) : (
              <>
                {view === 'grid'
                  ? <RotaLegend now={now} />
                  : <span>Click a name for their rest panel.</span>}
                <span style={{ fontStyle: 'italic' }}>
                  1 pending correction ·{' '}
                  <a href="#review" onClick={(e) => e.preventDefault()}>review</a>
                </span>
              </>
            )}
          </div>
        </div>

        {toast && <div className="crew-rota-toast" role="status">{toast}</div>}

      </div>

      <RestPanelPopover crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
    </>
  );
}
