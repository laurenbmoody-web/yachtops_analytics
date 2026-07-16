// Shared defect detail — Direction B "Ops Workspace". One component for both the
// map drawer and the Defects page: left column is the record (photos, description,
// comments), the right rail is the control panel (status, owner, facts, activity
// timeline). When opened away from the map, a "View on map" link deep-links to the
// pin so you can see exactly where it is.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import VmdSelect from '../../vessel-map/components/VmdSelect';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import DefectLogForm from './DefectLogForm';
import { useDefectActor } from '../utils/useDefectActor';
import {
  DefectStatus,
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
  const [editing, setEditing] = useState(false);
  const [fixEditing, setFixEditing] = useState(false);
  const [fix, setFix] = useState(null);

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

  // Core-record edit reuses the shared log form, so it carries every add-modal
  // affordance (photos, priority, assign, notify, flags). Contractor + scheduling
  // is arranged *after* logging, so it lives on the view, not in here.
  const onMap = !!defect.hotspotId;
  const editInitial = {
    title: defect.title || '', priority: defect.priority || 'Medium', description: defect.description || '',
    photos: defect.photos || [], deptId: defect.departmentId || '', assign: defect.assigneeKind || 'unassigned',
    userId: defect.assignedToUserId || '', affectsGuestAreas: !!defect.affectsGuestAreas, safetyRelated: !!defect.safetyRelated,
    notify: defect.notifyUsers || [],
    ...(onMap ? {} : { locationFreeText: defect.locationFreeText || defect.locationPathLabel || '' }),
  };
  const saveEdit = async (payload) => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const updated = await updateDefect(defect.id, {
        title: payload.title, priority: payload.priority, description: payload.description,
        departmentId: payload.departmentId || null, departmentOwner: payload.departmentOwner || null,
        assigneeKind: payload.assigneeKind,
        assignedToUserId: payload.assigneeKind === 'user' ? payload.assignedToUserId : null,
        assignedToName: payload.assigneeKind === 'user' ? payload.assignedToName : null,
        assignedTeamDepartmentId: payload.assigneeKind === 'team' ? payload.assignedTeamDepartmentId : null,
        assignedTeamName: payload.assigneeKind === 'team' ? payload.assignedTeamName : null,
        affectsGuestAreas: payload.affectsGuestAreas, safetyRelated: payload.safetyRelated,
        photos: payload.photos, notifyUsers: payload.notifyUsers,
        ...(onMap ? {} : { locationFreeText: payload.locationFreeText || null, locationPathLabel: payload.locationPathLabel || null }),
      }, actor);
      if (!updated) throw new Error('Could not save your changes.');
      setEditing(false);
      await onChanged?.();
      await reload();
    } catch (e) {
      setErr(e?.message || 'Could not save your changes.');
      throw e; // keep the form open
    } finally {
      setBusy(false);
    }
  };

  const startFix = () => setFix({
    dueDate: defect.dueDate || '', scheduledFixAt: defect.scheduledFixAt || '',
    contractorName: defect.contractorName || '', contractorDetails: defect.contractorDetails || '',
  });
  const saveFix = guard(async () => {
    await updateDefect(defect.id, {
      dueDate: fix.dueDate || null, scheduledFixAt: fix.scheduledFixAt || null,
      contractorName: fix.contractorName || null, contractorDetails: fix.contractorDetails || null,
    }, actor);
    setFixEditing(false);
  });

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
        {canManage && !isClosed && !editing && (
          <button className="dd-edit-btn" onClick={() => { setErr(''); setEditing(true); }}><Icon name="Edit3" size={13} /> Edit</button>
        )}
        {onClose && <button className="dd-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>}
      </div>

      {editing && (
        <div className="dd-editwrap">
          {err && <p className="dd-err" style={{ padding: '10px 22px 0' }}>{err}</p>}
          <DefectLogForm
            initial={editInitial}
            showLocation={!onMap}
            submitLabel="Save changes"
            busyLabel="Saving…"
            onSubmit={saveEdit}
            onCancel={() => { setEditing(false); setErr(''); }}
          />
        </div>
      )}

      {!editing && (
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

          {/* Fix & contractor — arranged after the defect's logged, so it's edited
              in place on the view rather than in the core-record form. */}
          <div className="dd-fix">
            <div className="dd-fix-head">
              <p className="dd-lbl" style={{ margin: 0 }}>Fix &amp; contractor</p>
              {canManage && !isClosed && !fixEditing && (
                <button className="dd-edit-btn small" onClick={() => { startFix(); setFixEditing(true); }}>
                  <Icon name={defect.contractorName || defect.scheduledFixAt ? 'Edit3' : 'Plus'} size={12} />
                  {defect.contractorName || defect.scheduledFixAt ? 'Edit' : 'Arrange'}
                </button>
              )}
            </div>

            {fixEditing ? (
              <div className="dd-fixform">
                <div className="dd-row2">
                  <div className="dd-field">
                    <label className="dd-field-lbl">Being fixed on</label>
                    <EditorialDatePicker value={fix.scheduledFixAt || ''} onChange={(v) => setFix({ ...fix, scheduledFixAt: v })} placeholder="dd/mm/yyyy" ariaLabel="Being fixed on" />
                  </div>
                  <div className="dd-field">
                    <label className="dd-field-lbl">Due date</label>
                    <EditorialDatePicker value={fix.dueDate || ''} onChange={(v) => setFix({ ...fix, dueDate: v })} placeholder="dd/mm/yyyy" ariaLabel="Due date" />
                  </div>
                </div>
                <div className="dd-field">
                  <label className="dd-field-lbl">Contractor</label>
                  <input className="dd-input" value={fix.contractorName} onChange={(e) => setFix({ ...fix, contractorName: e.target.value })} placeholder="e.g. Riva Marine Joinery" />
                </div>
                <div className="dd-field">
                  <label className="dd-field-lbl">Contractor details</label>
                  <textarea className="dd-textarea" value={fix.contractorDetails} onChange={(e) => setFix({ ...fix, contractorDetails: e.target.value })} placeholder="Contact, quote ref, scope of works…" />
                </div>
                <div className="dd-edit-actions">
                  <button className="dd-btn ghost" disabled={busy} onClick={() => { setFixEditing(false); setErr(''); }}>Cancel</button>
                  <button className="dd-btn primary" disabled={busy} onClick={saveFix} style={{ flex: 1 }}>{busy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            ) : (defect.contractorName || defect.contractorDetails || defect.scheduledFixAt || defect.dueDate) ? (
              <div className="dd-contractor">
                {defect.dueDate && (
                  <div className="dd-due"><span className="dd-due-k">Due</span><span className="dd-due-v">{fmt(defect.dueDate)}</span></div>
                )}
                {defect.scheduledFixAt && <div className="cs">Being fixed on {fmt(defect.scheduledFixAt)}</div>}
                {defect.contractorName && <div className="cn"><Icon name="Wrench" size={14} /> {defect.contractorName}</div>}
                {defect.contractorDetails && <div className="cd">{defect.contractorDetails}</div>}
              </div>
            ) : (
              <p className="dd-fix-empty">No contractor or fix date arranged yet.</p>
            )}
          </div>

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
      )}
    </div>
  );
}
