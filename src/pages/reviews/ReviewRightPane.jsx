import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RotaWorkspace from '../crew-rota/RotaWorkspace';
import { fmtDateRange } from './reviewFormat';
import { computeSubmissionBreaches } from './submissionBreaches';
import BreachSignoffModal from './BreachSignoffModal';
import { sendNotification, SEVERITY } from '../team-jobs-management/utils/notifications';
import {
  approveRotaDepartment,
  rejectRotaDepartment,
} from '../crew-rota/useRotaLifecycleWriters';

// ReviewRightPane — the right column of the split-view inbox. Renders the
// selected submission: an editorial header (vessel · dept eyebrow, rota_name
// title, submitted/days/shifts metadata) above the shared RotaWorkspace,
// scoped to the submission's department and rota, in reviewer mode.
//
// The decision footer lives in RotaWorkspace's footer slot (Reject / Accept).
// In edit mode the reviewer's paints write straight to the draft shifts, so
// "Accept with edits" is just Accept committing the current state — the
// dedicated diff-confirmation modal is a later polish.

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function ReviewRightPane({ item, onToast, onResolved }) {
  const [rotaFull, setRotaFull] = useState(null);
  const [vesselName, setVesselName] = useState(null);
  const [busy, setBusy] = useState(null);          // 'check' | 'accept' | 'reject' | null
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [breachModal, setBreachModal] = useState(null); // null | { summary, withEdits }
  const [breachReason, setBreachReason] = useState('');

  // Reset transient state whenever the selected item changes.
  useEffect(() => {
    setRejectOpen(false);
    setRejectNote('');
    setBusy(null);
    setBreachModal(null);
    setBreachReason('');
  }, [item?.id]);

  // Resolve the full rota object (for RotaWorkspace's paint/dept-status
  // wiring). A minimal { id, tenantId } is available immediately so read
  // mode renders without waiting; the fetch upgrades it for edit mode.
  useEffect(() => {
    if (!item?.rota_id) { setRotaFull(null); return undefined; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('rotas')
        .select('id, owner_type, trip_id, vessel_id, tenant_id')
        .eq('id', item.rota_id)
        .maybeSingle();
      if (cancelled || error || !data) return;
      setRotaFull({
        id: data.id,
        ownerType: data.owner_type,
        tripId: data.trip_id,
        vesselId: data.vessel_id,
        tenantId: data.tenant_id,
      });
    })();
    return () => { cancelled = true; };
  }, [item?.rota_id]);

  useEffect(() => {
    const vesselId = rotaFull?.vesselId;
    if (!vesselId) { setVesselName(null); return undefined; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('vessels').select('name').eq('id', vesselId).maybeSingle();
      if (!cancelled) setVesselName(data?.name || null);
    })();
    return () => { cancelled = true; };
  }, [rotaFull?.vesselId]);

  const rota = useMemo(() => {
    if (!item?.rota_id) return null;
    if (rotaFull && rotaFull.id === item.rota_id) return rotaFull;
    return { id: item.rota_id, tenantId: item.tenant_id };
  }, [item, rotaFull]);

  const submitterFirst = (item?.submitter_name || 'the submitter').split(' ')[0];
  const deptCopy = item?.department_name || 'this department';

  // Notify the submitting HOD of the decision (best-effort, client-side insert
  // into the same notifications table the rest of the app uses).
  const notifySubmitter = (type, title, message, severity = SEVERITY.INFO) => {
    if (!item?.submitter_id) return;
    // The nav-bar bell reads the localStorage notification channel
    // (team-jobs util via getUserNotifications/getUnreadCount) — not the DB
    // table — so the submitter sees the decision there. Tagged with the
    // submitter's auth UUID, which is what the bell's unread count matches.
    sendNotification(item.submitter_id, { type, title, message, actionUrl: '/crew', severity });
  };

  // Self-heal a drifted department before a decision. If an edit (legacy bug,
  // or any edge) left the dept in 'draft' while its review is still pending,
  // the approve/reject writers reject it ("expected pending_approval"). RLS
  // lets a CHIEF/COMMAND set the status; scope the update to status='draft' so
  // it's a no-op when the dept is already pending_approval/published.
  const restorePendingIfDrifted = async () => {
    if (!item?.rota_id || !item?.department_id) return;
    await supabase
      .from('rota_department_status')
      .update({ status: 'pending_approval' })
      .eq('rota_id', item.rota_id)
      .eq('department_id', item.department_id)
      .eq('status', 'draft')
      .then(() => {}).catch(() => {});
  };

  // The actual approval. `overrideNote` carries the MLC breach sign-off reason
  // when the chief accepts non-compliant hours; it lands on the approval's
  // decision note + audit event.
  const doApprove = async (withEdits, overrideNote) => {
    setBusy('accept');
    await restorePendingIfDrifted();
    const res = await approveRotaDepartment({ reviewItemId: item.id, note: overrideNote || null });
    setBusy(null);
    if (!res.ok) {
      onToast?.(`Couldn’t accept — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    onToast?.(`Accepted. ${submitterFirst}’s submission is now published.`);
    const base = withEdits ? 'reviewed, edited and published' : 'accepted and published';
    notifySubmitter(
      'ROTA_ACCEPTED',
      withEdits ? 'Rota accepted with edits' : 'Rota submission accepted',
      overrideNote
        ? `Your ${deptCopy} rota was ${base} — hours breach signed off by the reviewer.`
        : `Your ${deptCopy} rota was ${base}.`,
    );
    onResolved?.(item.id);
  };

  const handleAccept = async (withEdits) => {
    if (busy) return;
    // Check MLC compliance across the whole submission first (fresh, so it
    // reflects any edits). A breach blocks the plain accept — the chief must
    // edit or sign off with a reason.
    setBusy('check');
    const summary = await computeSubmissionBreaches(supabase, {
      rotaId: item.rota_id,
      departmentId: item.department_id,
      tenantId: item.tenant_id,
      dateStart: item.date_start,
      dateEnd: item.date_end,
    });
    setBusy(null);
    if (summary.hasBreaches) {
      setBreachReason('');
      setBreachModal({ summary, withEdits });
      return;
    }
    await doApprove(withEdits, null);
  };

  const handleBreachConfirm = async () => {
    const reason = breachReason.trim();
    if (!reason || !breachModal) return;
    const { withEdits } = breachModal;
    setBreachModal(null);
    await doApprove(withEdits, `Accepted despite MLC breach — ${reason}`);
  };

  const handleRejectSend = async () => {
    if (busy) return;
    const note = rejectNote.trim();
    if (!note) return;
    setBusy('reject');
    await restorePendingIfDrifted();
    const res = await rejectRotaDepartment({ reviewItemId: item.id, note });
    setBusy(null);
    if (!res.ok) {
      onToast?.(`Couldn’t reject — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    onToast?.(`Rejected. ${deptCopy} is back to draft.`);
    notifySubmitter(
      'ROTA_REJECTED',
      'Rota submission rejected',
      `Your ${deptCopy} rota was sent back to draft. Reason: ${note}`,
      SEVERITY.WARN,
    );
    onResolved?.(item.id);
  };

  const eyebrow = `${vesselName ? `${vesselName} · ` : ''}${item?.department_name || ''}`;
  const range = fmtDateRange(item?.date_start, item?.date_end);
  const metaBits = [
    `Submitted ${timeAgo(item?.created_at)}`,
    ...(range ? [range] : []),
    `${item?.day_count} day${item?.day_count === 1 ? '' : 's'}`,
    `${item?.shift_count} shift${item?.shift_count === 1 ? '' : 's'}`,
  ];

  // Decision footer rendered into RotaWorkspace's footer slot.
  const renderFooter = ({ editMode }) => {
    if (rejectOpen) {
      return (
        <div className="rv-rp-reject">
          <div className="rv-rp-reject-label">Rejection reason</div>
          <textarea
            className="rv-rp-reject-textarea"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Required — explain what needs to change before resubmission"
            rows={3}
            aria-label="Rejection reason"
          />
          <div className="rv-rp-reject-actions">
            <button
              type="button"
              className="rv-btn ghost"
              onClick={() => { setRejectOpen(false); setRejectNote(''); }}
              disabled={busy === 'reject'}
            >Cancel</button>
            <button
              type="button"
              className="rv-btn danger"
              onClick={handleRejectSend}
              disabled={busy === 'reject' || !rejectNote.trim()}
            >{busy === 'reject' ? 'Sending…' : 'Send rejection'}</button>
          </div>
        </div>
      );
    }
    return (
      <div className="rv-rp-footer">
        <span className="rv-rp-helper">
          {editMode
            ? 'Editing · Accept with edits publishes the current state.'
            : 'Read-only · click Edit to make changes before accepting.'}
        </span>
        <div className="rv-rp-actions">
          <button
            type="button"
            className="rv-btn ghost"
            onClick={() => { setRejectOpen(true); setRejectNote(''); }}
            disabled={!!busy}
            aria-label={`Reject ${deptCopy}`}
          >Reject</button>
          <button
            type="button"
            className={`rv-btn ${editMode ? 'terracotta' : 'primary'}`}
            onClick={() => handleAccept(editMode)}
            disabled={!!busy}
            aria-label={editMode ? `Accept ${deptCopy} with edits` : `Accept ${deptCopy}`}
          >{busy === 'check' ? 'Checking…' : busy === 'accept' ? 'Accepting…' : (editMode ? 'Accept with edits' : 'Accept')}</button>
        </div>
      </div>
    );
  };

  if (!item) return null;

  return (
    <div className="rv-rp">
      <div className="rv-rp-header">
        <div className="rv-rp-eyebrow">{eyebrow}</div>
        <h2 className="rv-rp-title">{item.rota_name || 'Rota'}</h2>
        <div className="rv-rp-meta">
          {metaBits.join(' · ')}
          {item.mlc_override_count > 0 && (
            <span className="rv-rp-meta-mlc">
              {' · '}{item.mlc_override_count} MLC override{item.mlc_override_count === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <RotaWorkspace
        rota={rota}
        departmentId={item.department_id}
        mode="reviewer"
        initialDate={item.date_start || null}
        onToast={onToast}
        footer={renderFooter}
      />

      <BreachSignoffModal
        open={!!breachModal}
        summary={breachModal?.summary}
        busy={busy === 'accept'}
        reason={breachReason}
        onReasonChange={setBreachReason}
        onCancel={() => setBreachModal(null)}
        onConfirm={handleBreachConfirm}
      />
    </div>
  );
}
