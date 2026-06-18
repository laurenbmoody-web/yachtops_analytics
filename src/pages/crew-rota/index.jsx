import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import '../pantry/pantry.css';
import './crew-rota.css';
import RotaWorkspace, { fullDateLabel, weekRangeLabel } from './RotaWorkspace';
import { computeReviewerEdits } from './reviewerEditsDiff';
import { useCurrentRota } from './useCurrentRota';
import { usePendingReviewCount } from './usePendingReviewCount';
import {
  submitRotaDepartment,
  publishRotaDepartmentDirect,
} from './useRotaLifecycleWriters';
import { getDraftShiftCount, getDraftDepartmentIds } from './rotaLifecycleChecks';
import { supabase } from '../../lib/supabaseClient';

// CrewRotaPage — page chrome around the shared RotaWorkspace composition.
// Phase 4a-split extracted the control bar / grid / edit mode / templates
// into RotaWorkspace; this file keeps the page-level title block, the
// submitter footer (Submit/Publish wired to the lifecycle writers), and the
// toast. The title block and footer are passed to RotaWorkspace as render-
// props so they can react to the workspace's live state (selectedDate,
// crew, editMode, draftDayCount, …) without lifting any of it.

const EDITORIAL_BG = '#F5F1EA';

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
      {now && (
        <div className="crew-rota-legend-item">
          <span style={{ width: 1.5, height: 14, background: '#C65A1A', opacity: 0.5, borderRadius: 1 }} />
          <span>Now ({hhmmNow})</span>
        </div>
      )}
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

// Tier-conditional submitter footer CTA. Wired to the lifecycle writers,
// targets a single department (targetDeptId).
function EditFooterCTA({
  tier, draftDayCount, targetDeptId, targetDeptName,
  busy, onSubmit, onPublish, onSaveDraft,
}) {
  const n = draftDayCount;
  const dayLabel = `${n} ${n === 1 ? 'day' : 'days'}`;
  const pubLabel = busy === 'publish' ? 'Publishing…' : `Publish (${dayLabel})`;
  const subLabel = busy === 'submit' ? 'Sending…' : `Send for acceptance (${dayLabel})`;
  const noTargetDept = !targetDeptId;
  const noTargetTitle = noTargetDept ? 'Use the review inbox to publish departments individually.' : undefined;
  const isEditor = ['COMMAND', 'CHIEF', 'HOD'].includes(tier);
  return (
    <div className="crew-rota-cta">
      {/* Save draft — keeps the autosaved edits as a draft and leaves edit mode.
          An explicit button (separate from Cancel) so it's clear work is kept. */}
      {isEditor && (
        <button
          type="button"
          className="v2-btn-ghost"
          onClick={onSaveDraft}
          disabled={!!busy}
          aria-label="Save draft and close"
        >Save draft</button>
      )}
      {tier === 'COMMAND' && (
        // COMMAND edits span departments, so Publish commits ALL draft
        // departments (validated in the handler) — not gated to their own dept.
        <button
          type="button"
          className="v2-btn-filled"
          onClick={onPublish}
          disabled={!!busy}
          aria-label="Publish all changed departments"
        >{busy === 'publish' ? 'Publishing…' : 'Publish changes'}</button>
      )}
      {tier === 'CHIEF' && (
        <>
          <button
            type="button"
            className="v2-btn-ghost"
            onClick={onSubmit}
            disabled={!!busy || n === 0 || noTargetDept}
            title={noTargetTitle}
            aria-label={`Submit ${targetDeptName || 'department'} for approval`}
          >{subLabel}</button>
          <button
            type="button"
            className="v2-btn-filled"
            onClick={onPublish}
            disabled={!!busy || n === 0 || noTargetDept}
            title={noTargetTitle}
            aria-label={`Publish ${targetDeptName || 'department'}`}
          >{pubLabel}</button>
        </>
      )}
      {tier === 'HOD' && (
        <button
          type="button"
          className="v2-btn-filled"
          onClick={onSubmit}
          disabled={!!busy || n === 0 || noTargetDept}
          aria-label={`Submit ${targetDeptName || 'department'} for approval`}
        >{subLabel}</button>
      )}
      {!['COMMAND', 'CHIEF', 'HOD'].includes(tier) && (
        <span style={{ fontStyle: 'italic' }}>Read-only — your role can’t publish drafts.</span>
      )}
    </div>
  );
}

export default function CrewRotaPage() {
  const navigate = useNavigate();
  const { user, currentUser, tenantRole, activeTenantId } = useAuth();
  const [toast, setToast] = useState(null);

  const tier = String(user?.permission_tier || tenantRole || '').toUpperCase();

  // Permission-scoped view. COMMAND and CHIEF can load the whole vessel
  // (CHIEF defaults to their own department but can expand others into view);
  // HOD and crew are scoped to their own department only. Edit access is
  // enforced separately inside RotaWorkspace (crew read-only, HOD edit→submit,
  // CHIEF edit→publish own dept only, COMMAND edit any). A user with no
  // department falls back to the full view.
  const canSeeAllDepts = tier === 'COMMAND' || tier === 'CHIEF';
  const scopeDeptId = canSeeAllDepts ? null : (currentUser?.department_id || null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  const showToast = useCallback((msg, opts) => {
    setToast({ msg, error: !!opts?.error });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const { rota } = useCurrentRota();
  const { count: pendingReviewCount } = usePendingReviewCount(rota?.id);
  const showPendingReviewNotice =
    pendingReviewCount > 0 && (tier === 'CHIEF' || tier === 'COMMAND');

  // ?changed=<rotaId>:<deptId> — set by the "accepted with edits"
  // notification. Diff the submitted vs approved snapshots and pulse the
  // cells the reviewer changed, opening on the first changed day so the
  // HOD lands straight on the edits.
  const [searchParams] = useSearchParams();
  const changedParam = searchParams.get('changed');
  const [reviewerEdits, setReviewerEdits] = useState(null); // null | { ids, dates }
  useEffect(() => {
    if (!changedParam) { setReviewerEdits(null); return undefined; }
    const [cRota, cDept] = changedParam.split(':');
    if (!cRota || !cDept) { setReviewerEdits(null); return undefined; }
    let cancelled = false;
    (async () => {
      const diff = await computeReviewerEdits(supabase, { rotaId: cRota, departmentId: cDept });
      if (cancelled) return;
      setReviewerEdits(diff);
      if (diff.slots.size === 0) {
        showToast('Couldn’t locate the reviewer’s edits — showing the rota as published.');
      }
    })();
    return () => { cancelled = true; };
  }, [changedParam, showToast]);

  // Submitter footer dept context — the acting user's own dept.
  const targetDeptId = currentUser?.department_id || null;
  const [ctaBusy, setCtaBusy] = useState(null);

  // Resolve the target dept name for the footer's toasts / aria-labels.
  // (The departments list lives inside RotaWorkspace for the editors; the
  // footer only needs this one name, so resolve it independently.)
  const [targetDeptName, setTargetDeptName] = useState(null);
  useEffect(() => {
    if (!activeTenantId || !targetDeptId) { setTargetDeptName(null); return undefined; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('name')
        .eq('id', targetDeptId)
        .maybeSingle();
      if (cancelled) return;
      if (error) { console.error('[CrewRotaPage] dept fetch failed:', error); return; }
      setTargetDeptName(data?.name || null);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId, targetDeptId]);

  // onDone (= the workspace's exitEdit) leaves edit mode + silent refetch on
  // success, matching the pre-extraction behavior.
  const handleFooterSubmit = useCallback(async (onDone) => {
    if (!rota?.id || !targetDeptId || ctaBusy) return;
    setCtaBusy('submit');
    const draftCheck = await getDraftShiftCount(rota.id, rota.tenantId, targetDeptId);
    if (!draftCheck.ok) {
      setCtaBusy(null);
      showToast(`Couldn’t check shifts — ${draftCheck.error || 'try again.'}`, { error: true });
      return;
    }
    if (draftCheck.count === 0) {
      setCtaBusy(null);
      showToast(
        `Cannot submit — no shifts for ${targetDeptName || 'this department'}.`,
        { error: true },
      );
      return;
    }
    // No CHIEF gate any more: a department without an available CHIEF still
    // submits — COMMAND is the fallback reviewer for CHIEF-less departments
    // (20260610120000_command_fallback_reviewer + hooks/inboxScope.js).
    const res = await submitRotaDepartment({
      rotaId: rota.id,
      departmentId: targetDeptId,
    });
    setCtaBusy(null);
    if (!res.ok) {
      showToast(`Couldn’t submit — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    showToast(`Submitted ${targetDeptName || 'department'} for approval.`);
    // Notify the reviewer(s) — CHIEF(s) in the dept, else COMMAND fallback —
    // via bell + email. Fire-and-forget server-side (service role resolves
    // recipients); never blocks or fails the submit. (sendRotaSubmission)
    if (res.data?.review_item_id) {
      supabase.functions
        .invoke('sendRotaSubmission', { body: { reviewItemId: res.data.review_item_id } })
        .then(() => {}).catch(() => {});
    }
    onDone?.();
  }, [rota, targetDeptId, ctaBusy, targetDeptName, showToast]);

  const handleFooterPublish = useCallback(async (onDone) => {
    if (!rota?.id || ctaBusy) return;
    setCtaBusy('publish');
    // COMMAND edits span departments, so they publish EVERY department that has
    // draft shifts — not just their own. CHIEF publishes their own department.
    let deptIds;
    if (tier === 'COMMAND') {
      const r = await getDraftDepartmentIds(rota.id, rota.tenantId);
      if (!r.ok) {
        setCtaBusy(null);
        showToast(`Couldn’t check drafts — ${r.error || 'try again.'}`, { error: true });
        return;
      }
      deptIds = r.departmentIds;
    } else {
      if (!targetDeptId) { setCtaBusy(null); return; }
      const draftCheck = await getDraftShiftCount(rota.id, rota.tenantId, targetDeptId);
      if (!draftCheck.ok) {
        setCtaBusy(null);
        showToast(`Couldn’t check shifts — ${draftCheck.error || 'try again.'}`, { error: true });
        return;
      }
      deptIds = draftCheck.count > 0 ? [targetDeptId] : [];
    }
    if (deptIds.length === 0) {
      setCtaBusy(null);
      showToast('Nothing to publish — no draft changes.', { error: true });
      return;
    }
    const results = await Promise.allSettled(deptIds.map((d) => publishRotaDepartmentDirect({
      rotaId: rota.id, departmentId: d, note: null,
    })));
    setCtaBusy(null);
    const failed = results.filter((r) => r.status === 'rejected' || (r.value && !r.value.ok));
    if (failed.length) {
      const detail = failed[0].reason?.message || failed[0].value?.error || 'try again.';
      showToast(`Couldn’t publish ${failed.length} of ${deptIds.length} department(s) — ${detail}`, { error: true });
      return;
    }
    showToast(deptIds.length === 1
      ? `Published ${targetDeptName || 'department'}.`
      : `Published ${deptIds.length} departments.`);
    onDone?.();
  }, [rota, tier, targetDeptId, ctaBusy, targetDeptName, showToast]);

  // Title block — reacts to the workspace's selected date / crew counts.
  const renderHeader = ({ view, selectedDate, selectedDateObj, isToday, total, onDuty }) => {
    const meta = view === 'week'
      ? `Week of ${weekRangeLabel(selectedDate)} · ${total} crew on board`
      : isToday
        ? `${fullDateLabel(selectedDateObj)} · ${total} crew on board · ${onDuty} on duty now`
        : `${fullDateLabel(selectedDateObj)} · ${total} crew on board`;
    return (
      <div className="crew-rota-titleblock">
        <div className="crew-rota-meta">{meta}</div>
        <h1 className="crew-rota-title">
          The <em>rota</em>.
        </h1>
      </div>
    );
  };

  // Footer — submitter CTA in edit mode; legend + review notice otherwise.
  const renderFooter = ({ editMode, draftDayCount, view, now, exitEdit }) => (
    editMode ? (
      <EditFooterCTA
        tier={tier}
        draftDayCount={draftDayCount}
        targetDeptId={targetDeptId}
        targetDeptName={targetDeptName}
        busy={ctaBusy}
        onSubmit={() => handleFooterSubmit(exitEdit)}
        onPublish={() => handleFooterPublish(exitEdit)}
        onSaveDraft={() => {
          showToast('Draft saved — publish or send it for acceptance when you’re ready.');
          exitEdit();
        }}
      />
    ) : (
      <>
        {view === 'grid' ? (
          <RotaLegend now={now} />
        ) : view === 'week' ? (
          <span>Click any cell to open that day’s grid.</span>
        ) : (
          <span>Click a name for their rest panel.</span>
        )}
        {showPendingReviewNotice && (
          <span style={{ fontStyle: 'italic' }}>
            {pendingReviewCount} submission{pendingReviewCount === 1 ? '' : 's'} awaiting review ·{' '}
            <a href="/reviews">review</a>
          </span>
        )}
      </>
    )
  );

  return (
    <>
      <Header />
      <div className="editorial-page">

        <button type="button" className="crew-rota-back" onClick={() => navigate('/dashboard')}>
          ← Back to dashboard
        </button>

        <RotaWorkspace
          // initialDate is read once at mount, but the reviewer-edits diff
          // resolves async — key the workspace on the first changed day so it
          // remounts opening there when the diff lands.
          key={reviewerEdits?.dates?.[0] || 'default'}
          rota={rota}
          departmentId={scopeDeptId}
          mode="submitter"
          initialDate={reviewerEdits?.dates?.[0] || null}
          highlightSlots={reviewerEdits?.slots?.size ? reviewerEdits.slots : null}
          onToast={showToast}
          header={renderHeader}
          footer={renderFooter}
        />

        {toast && (
          <div
            className={`crew-rota-toast${toast.error ? ' error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >{toast.msg}</div>
        )}

      </div>
    </>
  );
}
