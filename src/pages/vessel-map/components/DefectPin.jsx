// The actionable defect drawer for a `defect`-layer map pin. Links the pin
// (scan_hotspots) to a public.defects row (defects.hotspot_id). Empty → a compact
// "log defect here" form; linked → the full card: photo, priority/status, assign
// to a person OR the whole team (first to claim owns it), accept/decline, status,
// comments, close. All writes go through the shared Supabase defects data layer,
// so a logged/assigned defect notifies the crew cross-device.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDefectActor } from '../../defects/utils/useDefectActor';
import {
  DefectStatus, DefectPriority,
  getDefectByHotspot, getDefectById, getDefectComments,
  createDefect, updateDefect, addDefectComment,
  acceptDefect, declineDefect, closeDefectWithNotes, reopenDefect,
  assignDefect, claimDefect, fetchTenantDepartments,
} from '../../defects/utils/defectsStorage';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import './DefectPin.css';

const PRIORITY_CLASS = { Critical: 'p-critical', High: 'p-high', Medium: 'p-medium', Low: 'p-low' };
const PRIORITY_STRIPE = { Critical: '#A32D2D', High: '#B9761A', Medium: '#C65A1A', Low: '#AEB4C2' };
const STATUS_META = {
  pending_acceptance: { cls: 's-pending', label: 'Pending acceptance' },
  New: { cls: 's-open', label: 'New' },
  Reopened: { cls: 's-open', label: 'Reopened' },
  Assigned: { cls: 's-open', label: 'Assigned' },
  InProgress: { cls: 's-progress', label: 'In progress' },
  WaitingParts: { cls: 's-progress', label: 'Waiting parts' },
  Fixed: { cls: 's-fixed', label: 'Fixed' },
  Closed: { cls: 's-closed', label: 'Closed' },
  declined: { cls: 's-declined', label: 'Declined' },
};
const WORKFLOW = [DefectStatus.NEW, DefectStatus.ASSIGNED, DefectStatus.IN_PROGRESS, DefectStatus.WAITING_PARTS, DefectStatus.FIXED];
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function DefectPin({ hotspot, canManage, scanName, containerTrail, onChanged }) {
  const actor = useDefectActor();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [defect, setDefect] = useState(null);
  const [comments, setComments] = useState([]);
  const [mode, setMode] = useState('view'); // view | log
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [newComment, setNewComment] = useState('');
  const [departments, setDepartments] = useState([]);
  const [crew, setCrew] = useState([]);
  const [form, setForm] = useState({ title: '', priority: DefectPriority.MEDIUM, description: '', photo: null, deptId: '', assign: 'unassigned', userId: '' });

  const locationLabel = useMemo(() => {
    const trail = (containerTrail || []).map((c) => c?.name || c).filter(Boolean);
    return [scanName, ...trail, hotspot?.label].filter(Boolean).join(' · ');
  }, [scanName, containerTrail, hotspot?.label]);

  const loadForPin = useCallback(async () => {
    if (!hotspot?.id || !actor?.tenantId) { setLoading(false); return; }
    setLoading(true);
    const d = await getDefectByHotspot(hotspot.id, actor);
    setDefect(d);
    setComments(d ? (await getDefectComments(d.id)) || [] : []);
    setLoading(false);
  }, [hotspot?.id, actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadForPin(); }, [loadForPin]);

  // Pickers for the log form.
  useEffect(() => {
    if (mode !== 'log' || !actor?.tenantId) return;
    let live = true;
    (async () => {
      const [depts, cr] = await Promise.all([fetchTenantDepartments(actor.tenantId), fetchTenantCrew(actor.tenantId)]);
      if (!live) return;
      setDepartments(depts || []);
      setCrew(cr || []);
      setForm((f) => ({ ...f, deptId: f.deptId || actor.departmentId || (depts?.[0]?.id || '') }));
    })();
    return () => { live = false; };
  }, [mode, actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetchById = async (id) => {
    const d = await getDefectById(id, actor);
    setDefect(d);
    if (d) setComments((await getDefectComments(id)) || []);
    onChanged?.();
  };

  const deptName = (id) => departments.find((d) => d?.id === id)?.name || null;
  const crewInDept = crew.filter((c) => !form.deptId || (c?.department || '').toLowerCase() === (deptName(form.deptId) || '').toLowerCase());

  const onPickPhoto = (e) => {
    const file = e?.target?.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setForm((f) => ({ ...f, photo: reader.result }));
    reader.readAsDataURL(file);
  };

  const guardBusy = async (fn) => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e?.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const handleLog = () => guardBusy(async () => {
    if (!form.title.trim()) { setErr('Give the defect a title.'); return; }
    const dName = deptName(form.deptId);
    const picked = crew.find((c) => c?.id === form.userId);
    const created = await createDefect({
      title: form.title, description: form.description, priority: form.priority,
      departmentId: form.deptId || null, departmentOwner: dName,
      assigneeKind: form.assign,
      assignedToUserId: form.assign === 'user' ? form.userId : null,
      assignedToName: form.assign === 'user' ? (picked?.fullName || null) : null,
      assignedTeamDepartmentId: form.assign === 'team' ? form.deptId : null,
      assignedTeamName: form.assign === 'team' ? dName : null,
      hotspotId: hotspot.id,
      locationNodeId: hotspot.location_node_id || null,
      locationPathLabel: locationLabel,
      photos: form.photo ? [form.photo] : [],
    }, actor);
    if (created) { setDefect(created); setComments([]); setMode('view'); onChanged?.(); }
  });

  const handleStatus = (status) => guardBusy(async () => { await updateDefect(defect.id, { status }, actor); await refetchById(defect.id); });
  const handleClaim = () => guardBusy(async () => { await claimDefect(defect.id, actor); await refetchById(defect.id); });
  const handleAccept = () => guardBusy(async () => { await acceptDefect(defect.id, '', actor); await refetchById(defect.id); });
  const handleDecline = () => guardBusy(async () => {
    const reason = window.prompt('Reason for declining?'); if (reason == null) return;
    await declineDefect(defect.id, reason, actor); await refetchById(defect.id);
  });
  const handleClose = () => guardBusy(async () => {
    const notes = window.prompt('Close-out notes (what was done)?'); if (notes == null) return;
    await closeDefectWithNotes(defect.id, notes, null, actor); await refetchById(defect.id);
  });
  const handleReopen = () => guardBusy(async () => {
    const notes = window.prompt('Why re-open?'); if (notes == null) return;
    await reopenDefect(defect.id, notes, actor); await refetchById(defect.id);
  });
  const handleAssignTeam = () => guardBusy(async () => {
    await assignDefect(defect.id, { kind: 'team', teamDepartmentId: defect.departmentId, teamName: defect.departmentOwner }, actor);
    await refetchById(defect.id);
  });
  const handleAddComment = () => guardBusy(async () => {
    if (!newComment.trim()) return;
    await addDefectComment(defect.id, newComment, actor);
    setNewComment('');
    setComments((await getDefectComments(defect.id)) || []);
  });

  if (loading) return <div className="vmd"><p className="vmd-loading">Loading defect…</p></div>;

  // ── Log form / empty state ─────────────────────────────────────────────────
  if (!defect) {
    if (mode !== 'log') {
      return (
        <div className="vmd">
          <div className="vmd-empty">
            <span className="vmd-empty-t">No defect logged here</span>
            <span className="vmd-empty-s">Log one on this pin — photo, priority and who owns it. It notifies the crew and is tracked through to fixed.</span>
            {canManage ? (
              <button className="vm-btn-primary vmd-empty-btn" onClick={() => setMode('log')}>Log a defect here</button>
            ) : (
              <button className="vm-btn-primary vmd-empty-btn" onClick={() => setMode('log')}>Report a defect here</button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="vmd">
        <form className="vmd-form" onSubmit={(e) => { e.preventDefault(); handleLog(); }}>
          <div className="vmd-field">
            <label className="vmd-lbl">Title<span className="req">required</span></label>
            <input className="vmd-input" value={form.title} autoFocus
              onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Cracked porthole seal" />
          </div>

          <div className="vmd-row">
            <div className="vmd-field">
              <label className="vmd-lbl">Priority</label>
              <select className="vmd-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {Object.values(DefectPriority).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="vmd-field">
              <label className="vmd-lbl">Department</label>
              <select className="vmd-select" value={form.deptId}
                onChange={(e) => setForm({ ...form, deptId: e.target.value, userId: '' })}>
                <option value="">—</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="vmd-field">
            <label className="vmd-lbl">Assign to</label>
            <div className="vmd-seg">
              {['unassigned', 'team', 'user'].map((k) => (
                <button type="button" key={k} className={form.assign === k ? 'on' : ''}
                  onClick={() => setForm({ ...form, assign: k })}>
                  {k === 'unassigned' ? 'No one' : k === 'team' ? 'Whole team' : 'A person'}
                </button>
              ))}
            </div>
            {form.assign === 'user' && (
              <select className="vmd-select" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} style={{ marginTop: 8 }}>
                <option value="">Select crew…</option>
                {crewInDept.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
              </select>
            )}
            {form.assign === 'team' && (
              <p className="vmd-comment-empty" style={{ marginTop: 6 }}>Everyone in {deptName(form.deptId) || 'the department'} is notified — first to accept owns it.</p>
            )}
          </div>

          <div className="vmd-field">
            <label className="vmd-lbl">Photo<span className="req" style={{ color: '#AEB4C2' }}>optional</span></label>
            {form.photo ? (
              <div className="vmd-photo-preview">
                <img src={form.photo} alt="Defect" />
                <button type="button" className="vmd-photo-x" onClick={() => setForm({ ...form, photo: null })}>×</button>
              </div>
            ) : (
              <button type="button" className="vmd-photo-btn" onClick={() => fileRef.current?.click()}>＋ Add a photo</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPickPhoto} />
          </div>

          <div className="vmd-field">
            <label className="vmd-lbl">Notes</label>
            <textarea className="vmd-textarea" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What's wrong, any detail the engineer needs…" />
          </div>

          {err && <p className="vmd-err">{err}</p>}
          <div className="vmd-form-actions">
            <button type="button" className="vm-btn-ghost" onClick={() => setMode('view')} disabled={busy}>Cancel</button>
            <button type="submit" className="vm-btn-primary" disabled={busy} style={{ flex: 1 }}>{busy ? 'Logging…' : 'Log & notify'}</button>
          </div>
        </form>
      </div>
    );
  }

  // ── Actionable card ────────────────────────────────────────────────────────
  const sMeta = STATUS_META[defect.status] || { cls: 's-open', label: defect.status };
  const pCls = PRIORITY_CLASS[defect.priority] || 'p-medium';
  const isPending = defect.status === DefectStatus.PENDING_ACCEPTANCE;
  const isClosed = defect.status === DefectStatus.CLOSED;
  const isAssignee = defect.assignedToUserId && defect.assignedToUserId === actor.userId;
  const canWork = canManage || isAssignee;
  const teamUnclaimed = defect.assigneeKind === 'team' && !defect.claimedByUserId;

  let assigneeName = 'Unassigned';
  let assigneeRole = 'No one owns this yet';
  let avatarCls = 'none';
  if (defect.assigneeKind === 'team') {
    assigneeName = `${defect.assignedTeamName || defect.departmentOwner || 'Team'} team`;
    assigneeRole = defect.claimedByUserId ? `Claimed by ${defect.claimedByName}` : 'Unclaimed — first to accept owns it';
    avatarCls = 'team';
  } else if (defect.assignedToUserId) {
    assigneeName = defect.assignedToName || 'Assigned';
    assigneeRole = defect.claimedByUserId ? 'Claimed' : 'Assigned';
    avatarCls = '';
  }

  return (
    <div className="vmd vmd-card">
      {defect.photos?.[0] && (
        <div className="vmd-hero">
          <span className="vmd-hero-stripe" style={{ background: PRIORITY_STRIPE[defect.priority] || '#C65A1A' }} />
          <img src={defect.photos[0]} alt={defect.title} />
        </div>
      )}

      <div className="vmd-chips">
        <span className={`vmd-chip ${pCls}`}><span className="cd" />{defect.priority}</span>
        <span className={`vmd-chip ${sMeta.cls}`}><span className="cd" />{sMeta.label}</span>
        {defect.departmentOwner && <span className="vmd-chip dept">{defect.departmentOwner}</span>}
      </div>

      <div>
        <p className="vmd-title">{defect.title}</p>
        {defect.ref && <span className="vmd-comment-t">{defect.ref}</span>}
      </div>
      {defect.description && <p className="vmd-desc">{defect.description}</p>}

      {/* Assignee */}
      <div className="vmd-block">
        <p className="vmd-block-lbl">Owner</p>
        <div className="vmd-assignee">
          <span className={`vmd-avatar ${avatarCls}`}>{avatarCls === 'none' ? '?' : initials(defect.assigneeKind === 'team' ? assigneeName : defect.assignedToName)}</span>
          <div className="vmd-assignee-who">
            <div className="vmd-assignee-n">{assigneeName}</div>
            <div className="vmd-assignee-r">{assigneeRole}</div>
          </div>
        </div>
        <div className="vmd-actions" style={{ marginTop: 10 }}>
          {teamUnclaimed && actor.userId && !isClosed && (
            <button className="vm-btn-primary" disabled={busy} onClick={handleClaim}>Claim &amp; start</button>
          )}
          {canManage && !isClosed && defect.assigneeKind !== 'team' && (
            <button className="vm-btn-ghost" disabled={busy} onClick={handleAssignTeam}>Assign whole team</button>
          )}
        </div>
      </div>

      {/* Acceptance (chief of target dept) */}
      {isPending && canManage && (
        <div className="vmd-block">
          <p className="vmd-block-lbl">Awaiting your acceptance</p>
          <div className="vmd-actions">
            <button className="vm-btn-primary" disabled={busy} onClick={handleAccept}>Accept</button>
            <button className="vm-btn-ghost" disabled={busy} onClick={handleDecline}>Decline</button>
          </div>
        </div>
      )}

      {/* Status */}
      {canWork && !isClosed && !isPending && (
        <div className="vmd-block">
          <p className="vmd-block-lbl">Status</p>
          <select className="vmd-select" value={WORKFLOW.includes(defect.status) ? defect.status : ''} disabled={busy}
            onChange={(e) => handleStatus(e.target.value)}>
            {!WORKFLOW.includes(defect.status) && <option value="">{STATUS_META[defect.status]?.label || defect.status}</option>}
            {WORKFLOW.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
        </div>
      )}

      {/* Meta */}
      <div className="vmd-block">
        <div className="vmd-meta">
          <div><div className="k">Reported by</div><div className="v">{defect.reportedByName || '—'}</div></div>
          <div><div className="k">Logged</div><div className="v">{fmtDate(defect.createdAt)}</div></div>
          {defect.dueDate && <div><div className="k">Due</div><div className="v">{fmtDate(defect.dueDate)}</div></div>}
          <div><div className="k">Location</div><div className="v" style={{ fontVariantNumeric: 'normal' }}>{locationLabel || '—'}</div></div>
        </div>
      </div>

      {/* Comments */}
      <div className="vmd-block">
        <p className="vmd-block-lbl">Comments</p>
        {comments.length === 0 ? <p className="vmd-comment-empty">No comments yet.</p> : comments.map((c) => (
          <div className="vmd-comment" key={c.id}>
            <div className="vmd-comment-h"><span className="vmd-comment-n">{c.userName || 'Crew'}</span><span className="vmd-comment-t">{fmtDate(c.createdAt)}</span></div>
            <div className="vmd-comment-b">{c.text}</div>
          </div>
        ))}
        <div className="vmd-comment-add">
          <input className="vmd-input" value={newComment} onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment…" onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }} />
          <button className="vm-btn-ghost" disabled={busy || !newComment.trim()} onClick={handleAddComment}>Post</button>
        </div>
      </div>

      {err && <p className="vmd-err">{err}</p>}

      {/* Footer */}
      <div className="vmd-actions" style={{ borderTop: '1px solid #F0F1F5', paddingTop: 12 }}>
        <button className="vmd-link" onClick={() => navigate(`/defects/${defect.id}`)}>Open in Defects ↗</button>
        <span style={{ flex: 1 }} />
        {canManage && !isClosed && <button className="vm-btn-ghost" disabled={busy} onClick={handleClose}>Mark fixed &amp; close</button>}
        {canManage && isClosed && <button className="vm-btn-ghost" disabled={busy} onClick={handleReopen}>Re-open</button>}
      </div>
    </div>
  );
}
