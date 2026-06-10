import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import RotaWorkspace from '../crew-rota/RotaWorkspace';
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
  const [busy, setBusy] = useState(null);          // 'accept' | 'reject' | null
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  // Reset transient state whenever the selected item changes.
  useEffect(() => {
    setRejectOpen(false);
    setRejectNote('');
    setBusy(null);
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

  const handleAccept = async () => {
    if (busy) return;
    setBusy('accept');
    const res = await approveRotaDepartment({ reviewItemId: item.id, note: null });
    setBusy(null);
    if (!res.ok) {
      onToast?.(`Couldn’t accept — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    onToast?.(`Accepted. ${submitterFirst}’s submission is now published.`);
    onResolved?.(item.id);
  };

  const handleRejectSend = async () => {
    if (busy) return;
    const note = rejectNote.trim();
    if (!note) return;
    setBusy('reject');
    const res = await rejectRotaDepartment({ reviewItemId: item.id, note });
    setBusy(null);
    if (!res.ok) {
      onToast?.(`Couldn’t reject — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    onToast?.(`Rejected. ${deptCopy} is back to draft.`);
    onResolved?.(item.id);
  };

  const eyebrow = `${vesselName ? `${vesselName} · ` : ''}${item?.department_name || ''}`;
  const metaBits = [
    `Submitted ${timeAgo(item?.created_at)}`,
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
            onClick={handleAccept}
            disabled={!!busy}
            aria-label={editMode ? `Accept ${deptCopy} with edits` : `Accept ${deptCopy}`}
          >{busy === 'accept' ? 'Accepting…' : (editMode ? 'Accept with edits' : 'Accept')}</button>
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
    </div>
  );
}
