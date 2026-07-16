// Shared defect detail — Direction B "Ops Workspace". One component for both the
// map drawer and the Defects page: left column is the record (photos, description,
// comments), the right rail is the control panel (status, owner, facts, activity
// timeline). When opened away from the map, a "View on map" link deep-links to the
// pin so you can see exactly where it is.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import VmdSelect from '../../vessel-map/components/VmdSelect';
import { useDefectActor } from '../utils/useDefectActor';
import {
  DefectStatus, DefectPriority,
  getDefectComments, getDefectEvents,
  updateDefect, addDefectComment, acceptDefect, declineDefect,
  closeDefectWithNotes, reopenDefect, assignDefect, claimDefect, canEditDefect,
} from '../utils/defectsStorage';
import './DefectDetail.css';

const PRIORITY_CLASS = { Critical: 'dd-p-Critical', High: 'dd-p-High', Medium: 'dd-p-Medium', Low: 'dd-p-Low' };
const STATUS_META = {
  pending_acceptance: { cls: 'dd-s-pending', label: 'Pending acceptance' },
  New: { cls: 'dd-s-open', label: 'New' }, Reopened: { cls: 'dd-s-open', label: 'Reopened' }, Assigned: { cls: 'dd-s-open', label: 'Assigned' },
  InProgress: { cls: 'dd-s-progress', label: 'In progress' }, WaitingParts: { cls: 'dd-s-progress', label: 'Waiting parts' },
  Fixed: { cls: 'dd-s-fixed', label: 'Fixed' }, Closed: { cls: 'dd-s-closed', label: 'Closed' }, declined: { cls: 'dd-s-declined', label: 'Declined' },
};
const WORKFLOW = [DefectStatus.NEW, DefectStatus.ASSIGNED, DefectStatus.IN_PROGRESS, DefectStatus.WAITING_PARTS, DefectStatus.FIXED];
const GOOD_EVENTS = new Set(['accepted', 'claimed', 'closed', 'fixed']);
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export default function DefectDetail({ defect, onChanged, onClose, mapHref, locationLabel }) {
  const actor = useDefectActor();
  const navigate = useNavigate();
  const [comments, setComments] = useState([]);
  const [events, setEvents] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    if (!defect?.id) return;
    const [c, e] = await Promise.all([getDefectComments(defect.id), getDefectEvents(defect.id)]);
    setComments(c || []);
    setEvents(e || []);
  }, [defect?.id]);

  useEffect(() => { reload(); }, [reload, defect?.updatedAt]);

  if (!defect) return <div className="dd"><p className="dd-loading">Loading defect…</p></div>;

  const canManage = canEditDefect(actor, defect);
  const isAssignee = defect.assignedToUserId && defect.assignedToUserId === actor.userId;
  const canWork = canManage || isAssignee;
  const isPending = defect.status === DefectStatus.PENDING_ACCEPTANCE;
  const isClosed = defect.status === DefectStatus.CLOSED;
  const teamUnclaimed = defect.assigneeKind === 'team' && !defect.claimedByUserId;
  const sMeta = STATUS_META[defect.status] || { cls: 'dd-s-open', label: defect.status };
  const loc = locationLabel || defect.locationPathLabel || defect.locationFreeText || '—';

  let ownerName = 'Unassigned'; let ownerRole = 'No one owns this yet'; let avCls = 'none';
  if (defect.assigneeKind === 'team') {
    ownerName = `${defect.assignedTeamName || defect.departmentOwner || 'Team'} team`;
    ownerRole = defect.claimedByUserId ? `Claimed by ${defect.claimedByName}` : 'Unclaimed — first to accept owns it';
    avCls = 'team';
  } else if (defect.assignedToUserId) {
    ownerName = defect.assignedToName || 'Assigned';
    ownerRole = defect.claimedByUserId ? 'Claimed' : 'Assigned';
    avCls = '';
  }

  const guard = (fn) => async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); await onChanged?.(); await reload(); }
    catch (e) { setErr(e?.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  const setStatus = (v) => guard(() => updateDefect(defect.id, { status: v }, actor))();
  const doClaim = guard(() => claimDefect(defect.id, actor));
  const doAccept = guard(() => acceptDefect(defect.id, '', actor));
  const doDecline = guard(async () => { const r = window.prompt('Reason for declining?'); if (r == null) return; await declineDefect(defect.id, r, actor); });
  const doClose = guard(async () => { const n = window.prompt('Close-out notes (what was done)?'); if (n == null) return; await closeDefectWithNotes(defect.id, n, null, actor); });
  const doReopen = guard(async () => { const n = window.prompt('Why re-open?'); if (n == null) return; await reopenDefect(defect.id, n, actor); });
  const doAssignTeam = guard(() => assignDefect(defect.id, { kind: 'team', teamDepartmentId: defect.departmentId, teamName: defect.departmentOwner }, actor));
  const addComment = guard(async () => { if (!newComment.trim()) return; await addDefectComment(defect.id, newComment, actor); setNewComment(''); });

  const photos = defect.photos || [];
  const openMap = () => { if (mapHref) { onClose?.(); navigate(mapHref); } };

  return (
    <div className="dd">
      {/* header */}
      <div className="dd-head">
        <h2>{defect.title}</h2>
        <div className="dd-chips">
          <span className={`dd-chip ${PRIORITY_CLASS[defect.priority] || 'dd-p-Medium'}`}><span className="cd" />{defect.priority}</span>
          <span className={`dd-chip ${sMeta.cls}`}><span className="cd" />{sMeta.label}</span>
        </div>
        <span className="dd-ref">{defect.ref}</span>
        <span className="spring" />
        {onClose && <button className="dd-x" onClick={onClose} aria-label="Close">×</button>}
      </div>

      <div className="dd-cols">
        {/* left — the record */}
        <div className="dd-main">
          {photos.length > 0 ? (
            <div className="dd-gallery">
              {photos.slice(0, 3).map((p, i) => (
                <div className="dd-ph" key={i} onClick={() => window.open(p, '_blank')}>
                  <img src={p} alt={`Defect photo ${i + 1}`} />
                  {i === 2 && photos.length > 3 && <span className="more">+{photos.length - 3}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="dd-noph">No photos on this defect</div>
          )}

          {defect.description && <p className="dd-desc">{defect.description}</p>}

          <div>
            <p className="dd-lbl">Comments</p>
            {comments.length === 0 ? <p className="dd-comment-empty">No comments yet.</p> : comments.map((c) => (
              <div className="dd-comment" key={c.id}>
                <div className="dd-comment-h"><span className="dd-comment-n">{c.userName || 'Crew'}</span><span className="dd-comment-w">{fmt(c.createdAt)}</span></div>
                <div className="dd-comment-b">{c.text}</div>
              </div>
            ))}
            <div className="dd-comment-add">
              <input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Add a comment…"
                onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }} />
              <button className="dd-btn ghost" disabled={busy || !newComment.trim()} onClick={addComment}>Post</button>
            </div>
          </div>
        </div>

        {/* right — the control rail */}
        <div className="dd-rail">
          {mapHref && defect.hotspotId && (
            <button className="dd-btn map block" onClick={openMap}><Icon name="MapPin" size={15} /> View on map</button>
          )}

          {isPending && canManage ? (
            <div>
              <p className="dd-lbl">Awaiting your acceptance</p>
              <div className="dd-actions">
                <button className="dd-btn primary block" disabled={busy} onClick={doAccept}>Accept</button>
                <button className="dd-btn ghost block" disabled={busy} onClick={doDecline}>Decline</button>
              </div>
            </div>
          ) : (
            canWork && !isClosed && (
              <div>
                <p className="dd-lbl">Status</p>
                <VmdSelect value={defect.status} onChange={setStatus} ariaLabel="Defect status"
                  options={(WORKFLOW.includes(defect.status) ? WORKFLOW : [defect.status, ...WORKFLOW]).map((s) => ({ value: s, label: STATUS_META[s]?.label || s }))} />
              </div>
            )
          )}

          {/* owner */}
          <div>
            <p className="dd-lbl">Owner</p>
            <div className="dd-owner-card">
              <span className={`dd-avatar ${avCls}`}>{avCls === 'none' ? '?' : initials(defect.assigneeKind === 'team' ? ownerName : defect.assignedToName)}</span>
              <div className="dd-owner-who"><div className="dd-owner-n">{ownerName}</div><div className="dd-owner-r">{ownerRole}</div></div>
            </div>
            <div className="dd-actions" style={{ marginTop: 8 }}>
              {teamUnclaimed && actor.userId && !isClosed && <button className="dd-btn primary block" disabled={busy} onClick={doClaim}>Claim &amp; start</button>}
              {canManage && !isClosed && defect.assigneeKind !== 'team' && <button className="dd-btn ghost block" disabled={busy} onClick={doAssignTeam}>Assign whole team</button>}
            </div>
          </div>

          {/* facts */}
          <div className="dd-panel">
            <div className="dd-row"><span className="k">Priority</span><span className={`v${defect.priority === 'Critical' ? ' crit' : ''}`}>{defect.priority}</span></div>
            <div className="dd-row"><span className="k">Department</span><span className="v">{defect.departmentOwner || '—'}</span></div>
            <div className="dd-row"><span className="k">Reported by</span><span className="v">{defect.reportedByName || '—'}</span></div>
            <div className="dd-row"><span className="k">Logged</span><span className="v">{fmt(defect.createdAt)}</span></div>
            {defect.dueDate && <div className="dd-row"><span className="k">Due</span><span className="v">{fmt(defect.dueDate)}</span></div>}
            <div className="dd-row"><span className="k">Location</span><span className="v" title={loc}>{loc}</span></div>
            {defect.notifyUsers?.length > 0 && <div className="dd-row"><span className="k">Also notified</span><span className="v">{defect.notifyUsers.map((n) => n.name).filter(Boolean).join(', ')}</span></div>}
          </div>

          {/* activity */}
          <div>
            <p className="dd-lbl">Activity</p>
            {events.length === 0 ? <p className="dd-comment-empty">No activity yet.</p> : (
              <ul className="dd-tl">
                {events.map((ev) => (
                  <li key={ev.id} className={ev.type === 'created' ? 'hot' : GOOD_EVENTS.has(ev.type) ? 'good' : ''}>
                    <span className="n" />
                    <div className="t">{ev.summary || ev.type}{ev.actor_name ? ` · ${ev.actor_name}` : ''}</div>
                    <div className="when">{fmt(ev.created_at)} · {fmtTime(ev.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {err && <p className="dd-err">{err}</p>}

          <div className="dd-actions">
            {canManage && !isClosed && <button className="dd-btn ghost block" disabled={busy} onClick={doClose}>Mark fixed &amp; close</button>}
            {canManage && isClosed && <button className="dd-btn ghost block" disabled={busy} onClick={doReopen}>Re-open</button>}
            <button className="dd-btn ghost block" onClick={() => navigate(`/defects/${defect.id}`)}>Open in Defects ↗</button>
          </div>
        </div>
      </div>
    </div>
  );
}
