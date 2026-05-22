import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import '../pantry/pantry.css';
import './crew-rota.css';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import RestPanelPopover from './RestPanelPopover';
import PatternPicker from './PatternPicker';
import SimpleTemplateEditor from './SimpleTemplateEditor';
import RotationTemplateEditor from './RotationTemplateEditor';
import ApplyTemplateModal from './ApplyTemplateModal';
import { useRotaShifts } from './useRotaShifts';
import { useRotaTemplates } from './useRotaTemplates';
import { useCurrentRota } from './useCurrentRota';
import { useRotaDepartmentStatus } from './useRotaDepartmentStatus';

const EDITORIAL_BG = '#F5F1EA';
const GRID_START_HOUR = 6;
// Brush pills. "Off" is no longer a shift type — an empty cell IS the off
// state (absence of a working shift). Erase removes the working shift,
// which is how you "set someone to off."
const SHIFT_TYPE_PILLS = [
  ['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'],
  ['training', 'Training'], ['medical', 'Medical'],
  ['erase', 'Erase'],
];
// Last paintable slot index (pre-midnight, given a 06:00 grid start).
const LAST_PRE_MIDNIGHT_SLOT = (24 - GRID_START_HOUR) * 2 - 1; // 35

function fullDateLabel(d) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// (slot ↔ decimal helpers and shift-range math are now owned by
// useRotaShifts.applyPaint — the page only deals in slot indices.)

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
  const { user, currentUser, tenantRole, activeTenantId } = useAuth();
  const [view, setView] = useState('grid');      // 'grid' | 'list'
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [shiftType, setShiftType] = useState('duty'); // active type for new shifts
  const [pickerOpen, setPickerOpen] = useState(false);
  // editor: null | { kind: 'simple'|'rotation', template: object|null }
  const [editor, setEditor] = useState(null);
  // applyTarget: the template a user clicked to apply (3a). null = closed.
  const [applyTarget, setApplyTarget] = useState(null);
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
    applyPaint, applyTemplate, refetch,
  } = useRotaShifts();
  const { rota } = useCurrentRota();
  const { statusByDept, ensureDraft } = useRotaDepartmentStatus(rota?.id);
  const {
    templates, loading: templatesLoading, error: templatesError,
    toggleStar, createTemplate, updateTemplate, deleteTemplate,
  } = useRotaTemplates();

  // Departments for the template editors. Fetched via get_tenant_departments,
  // then INTERSECTED with vessels.departments_in_use so the list shows only
  // the departments this tenant actually uses (5 for the test tenant, not
  // the 11-row global table). The RPC's p_tenant_id is a membership gate,
  // not a real scope filter (TODO(backlog) on migration 20260430110100);
  // until that lands at the schema level, intersect client-side.
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!activeTenantId) { setDepartments([]); return; }
    let alive = true;
    (async () => {
      const [veRes, dpRes] = await Promise.all([
        supabase.from('vessels')
          .select('departments_in_use').eq('tenant_id', activeTenantId).maybeSingle(),
        supabase.rpc('get_tenant_departments', { p_tenant_id: activeTenantId }),
      ]);
      if (!alive) return;
      if (dpRes.error) {
        console.error('[crew-rota] get_tenant_departments error:', dpRes.error);
        setDepartments([]);
        return;
      }
      const all = (dpRes.data || []).map((d) => ({ id: d.id, name: d.name }));
      const inUse = Array.isArray(veRes.data?.departments_in_use)
        ? veRes.data.departments_in_use
        : null;
      // If departments_in_use is populated, filter strictly; otherwise fall
      // back to the full RPC list (covers any tenant that hasn't migrated
      // to the uuid[] column yet, so the picker never goes empty).
      let list = all;
      if (inUse && inUse.length > 0) {
        const set = new Set(inUse);
        list = all.filter((d) => set.has(d.id));
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setDepartments(list);
    })();
    return () => { alive = false; };
  }, [activeTenantId]);

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

  // Single paint handler — used for both single click (lo === hi) and drag
  // ranges. Clamps to the pre-midnight window (Phase 1 limitation) and
  // routes to useRotaShifts.applyPaint, which does the optimistic local
  // update + background DB write. ensureDraft is fired in parallel so the
  // dept badge updates in the same frame as the cells.
  const handlePaint = useCallback(async (crewMember, loSlot, hiSlot) => {
    if (!rota?.id) { showToast('No active rota resolved — cannot edit yet.'); return; }
    const lo0 = Math.min(loSlot, hiSlot);
    const hi0 = Math.max(loSlot, hiSlot);
    if (lo0 > LAST_PRE_MIDNIGHT_SLOT) {
      showToast('Editing the post-midnight window ships in a later phase.');
      return;
    }
    const lo = lo0;
    const hi = Math.min(hi0, LAST_PRE_MIDNIGHT_SLOT); // silently clamp range
    const erase = shiftType === 'erase';

    // Dept draft sync runs in parallel — its result only matters for the
    // HOD-no-init error toast; it does NOT block the paint.
    syncDeptDraft(crewMember);

    const res = await applyPaint({
      crewMember,
      loSlot: lo,
      hiSlot: hi,
      type: erase ? null : shiftType,
      erase,
      rotaId: rota.id,
      tripId: rota.ownerType === 'trip' ? rota.tripId : null,
      createdByMemberId: myMemberId,
      gridStartHour: GRID_START_HOUR,
    });
    if (!res.ok) showToast(`Couldn’t save that change — try again. (${res.error})`);
  }, [rota, shiftType, myMemberId, applyPaint, syncDeptDraft, showToast]);

  const canEdit = !!rota?.id && !loading && !error;
  const enterEdit = useCallback(() => {
    if (!canEdit) return;
    setEditMode(true);
    refetch({ silent: true });
  }, [canEdit, refetch]);
  const exitEdit = useCallback(() => {
    setEditMode(false);
    refetch({ silent: true });
  }, [refetch]);

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
                  onClick={exitEdit}
                >Done</button>
              ) : (
                <button
                  type="button"
                  className={`crew-rota-pill edit-pill${canEdit ? '' : ' disabled'}`}
                  aria-disabled={!canEdit}
                  title={canEdit ? 'Edit the rota' : 'Rota not ready'}
                  onClick={enterEdit}
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
              <span className="crew-rota-typebar-sep" aria-hidden />
              <button
                type="button"
                className="crew-rota-pill"
                onClick={() => setPickerOpen(true)}
                title="Open template library"
              >Templates</button>
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
                onPaint={handlePaint}
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

        <PatternPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          toggleStar={toggleStar}
          departments={departments}
          myDeptId={currentUser?.department_id || null}
          onToast={showToast}
          onPick={(t) => {
            // Phase 3a — open apply modal for any kind. Simple flows
            // through to a working apply; shift patterns render the 3b
            // stub inside the modal until that path lands.
            setPickerOpen(false);
            setApplyTarget(t);
          }}
          onEdit={(t) => {
            setPickerOpen(false);
            setEditor({ kind: t.kind === 'rotation' ? 'rotation' : 'simple', template: t });
          }}
          onNew={(kind) => {
            setPickerOpen(false);
            setEditor({ kind: kind === 'rotation' ? 'rotation' : 'simple', template: null });
          }}
        />

        <SimpleTemplateEditor
          open={editor?.kind === 'simple'}
          template={editor?.template || null}
          departments={departments}
          myDeptId={currentUser?.department_id || null}
          vesselId={rota?.vesselId || null}
          onClose={() => { setEditor(null); setPickerOpen(true); }}
          createTemplate={createTemplate}
          updateTemplate={updateTemplate}
          deleteTemplate={deleteTemplate}
          onToast={showToast}
        />

        <RotationTemplateEditor
          open={editor?.kind === 'rotation'}
          template={editor?.template || null}
          departments={departments}
          myDeptId={currentUser?.department_id || null}
          vesselId={rota?.vesselId || null}
          crew={crew}
          onClose={() => { setEditor(null); setPickerOpen(true); }}
          createTemplate={createTemplate}
          updateTemplate={updateTemplate}
          deleteTemplate={deleteTemplate}
          onToast={showToast}
        />

        <ApplyTemplateModal
          open={!!applyTarget}
          template={applyTarget}
          rota={rota}
          trip={null /* /crew is the standing rota — no trip context. Trip rotas land in a later phase. */}
          crew={crew}
          currentUser={currentUser}
          tier={tier}
          myMemberId={myMemberId}
          applyTemplate={applyTemplate}
          ensureDraft={ensureDraft}
          onToast={showToast}
          onClose={() => { setApplyTarget(null); setPickerOpen(true); }}
        />

        {toast && <div className="crew-rota-toast" role="status">{toast}</div>}

      </div>

      <RestPanelPopover crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
    </>
  );
}
