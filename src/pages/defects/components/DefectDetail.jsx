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
import ContractorPicker from './ContractorPicker';
import DefectLogForm from './DefectLogForm';
import OrderPartsModal from './OrderPartsModal';
import DefectDocModal from './DefectDocModal';
import PlanMaintenanceModal from './PlanMaintenanceModal';
import { RECURRENCE_LABEL } from '../utils/defectMaintenance';
import { fetchDefectRequisitions } from '../utils/defectRequisition';
import { fetchDefectDocuments, deleteDefectDocument, costSummary } from '../utils/defectDocuments';
import { useDefectActor } from '../utils/useDefectActor';
import {
  DefectStatus, REPAIR_STAGE_ORDER, REPAIR_STAGE_LABELS,
  getDefectComments, getDefectEvents,
  updateDefect, addDefectComment, acceptDefect, declineDefect,
  closeDefectWithNotes, reopenDefect, assignDefect, claimDefect, canEditDefect,
  fetchWarrantyContext, requestQuoteApproval, decideQuoteApproval, canApproveQuote, fetchDefectQuoteSettings,
} from '../utils/defectsStorage';
import './DefectDetail.css';

const PRIORITY_CLASS = { Critical: 'dd-p-Critical', High: 'dd-p-High', Medium: 'dd-p-Medium', Low: 'dd-p-Low' };
const STATUS_META = {
  pending_acceptance: { cls: 'dd-s-pending', label: 'Pending acceptance' },
  New: { cls: 'dd-s-open', label: 'New' }, Reopened: { cls: 'dd-s-open', label: 'Reopened' }, Assigned: { cls: 'dd-s-open', label: 'Assigned' },
  InProgress: { cls: 'dd-s-progress', label: 'In progress' }, WaitingParts: { cls: 'dd-s-progress', label: 'Waiting parts' },
  Fixed: { cls: 'dd-s-fixed', label: 'Fixed' }, Closed: { cls: 'dd-s-closed', label: 'Closed' }, declined: { cls: 'dd-s-declined', label: 'Declined' },
};
const REPAIR_STAGE_SHORT = { contacted: 'Contacted', quoting: 'Quoting', quoted: 'Quoted', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Done' };
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
const SYM = { EUR: '€', USD: '$', GBP: '£' };
const money = (amount, currency) => {
  if (amount == null) return '—';
  const n = Number(amount);
  const s = (SYM[currency] || `${currency || ''} `);
  return `${n < 0 ? '-' : ''}${s}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function DefectDetail({ defect, onChanged, onClose, mapHref, locationLabel, onEditingChange }) {
  const actor = useDefectActor();
  const navigate = useNavigate();
  const [comments, setComments] = useState([]);
  const [events, setEvents] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  // Let a host (the map modal) narrow itself to form-width while editing, so the
  // edit form isn't marooned in the wide detail layout.
  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);
  const [fixEditing, setFixEditing] = useState(false);
  const [fix, setFix] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [orderingParts, setOrderingParts] = useState(false);
  const [docs, setDocs] = useState([]);
  const [docModalKind, setDocModalKind] = useState(null);
  const [planningMaint, setPlanningMaint] = useState(false);
  const [workTab, setWorkTab] = useState('repair'); // left-pane tab: repair | parts | activity
  const [railOpen, setRailOpen] = useState(true);    // right control rail collapse
  const [moreFacts, setMoreFacts] = useState(false); // reveal secondary facts in the rail
  const [warrantyCtx, setWarrantyCtx] = useState([]);
  const [quoteSettings, setQuoteSettings] = useState({ approverTier: 'HOD', threshold: 1000 });

  useEffect(() => {
    let live = true;
    if (actor?.tenantId) fetchDefectQuoteSettings(actor.tenantId).then((s) => { if (live) setQuoteSettings(s); });
    return () => { live = false; };
  }, [actor?.tenantId]);

  const reload = useCallback(async () => {
    if (!defect?.id) return;
    const [c, e, r, d, w] = await Promise.all([
      getDefectComments(defect.id), getDefectEvents(defect.id), fetchDefectRequisitions(defect.id), fetchDefectDocuments(defect.id),
      fetchWarrantyContext(defect, actor),
    ]);
    setComments(c || []);
    setEvents(e || []);
    setReqs(r || []);
    setDocs(d || []);
    setWarrantyCtx(w || []);
  }, [defect?.id, defect?.locationNodeId, actor]);

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
    scheduledFixAt: defect.scheduledFixAt || '', scheduledEndAt: defect.scheduledEndAt || '',
    contractorName: defect.contractorName || '', contractorDetails: defect.contractorDetails || '',
    contractorSupplierId: defect.contractorSupplierId || null,
    contractorContactName: defect.contractorContactName || '',
    contractorEmail: defect.contractorEmail || '', contractorPhone: defect.contractorPhone || '',
    warrantyUntil: defect.warrantyUntil || '',
  });
  const saveFix = guard(async () => {
    await updateDefect(defect.id, {
      scheduledFixAt: fix.scheduledFixAt || null, scheduledEndAt: fix.scheduledEndAt || null,
      contractorName: fix.contractorName || null, contractorDetails: fix.contractorDetails || null,
      contractorSupplierId: fix.contractorSupplierId || null,
      contractorContactName: fix.contractorContactName || null,
      contractorEmail: fix.contractorEmail || null, contractorPhone: fix.contractorPhone || null,
      warrantyUntil: fix.warrantyUntil || null,
    }, actor);
    setFixEditing(false);
  });
  const warrantyActive = defect.warrantyUntil && defect.warrantyUntil >= new Date().toISOString().slice(0, 10);
  const hasRepairInfo = defect.contractorName || defect.contractorDetails || defect.scheduledFixAt
    || defect.contractorEmail || defect.contractorPhone || defect.warrantyUntil;
  const SCHEDULED_IDX = REPAIR_STAGE_ORDER.indexOf('scheduled');
  const approvalPending = defect.quoteApprovalStatus === 'pending';
  const canApprove = canApproveQuote(actor, quoteSettings.approverTier);
  const setStage = (v) => {
    if (REPAIR_STAGE_ORDER.indexOf(v) >= SCHEDULED_IDX && approvalPending) {
      setErr("Quote is awaiting sign-off — can't schedule the repair yet.");
      return;
    }
    guard(() => updateDefect(defect.id, { repairStage: v }, actor))();
  };
  const stageIdx = REPAIR_STAGE_ORDER.indexOf(defect.repairStage);
  const reqApproval = guard(() => requestQuoteApproval(defect.id, actor));
  const approveQuote = guard(() => decideQuoteApproval(defect.id, true, null, actor));
  const declineQuote = guard(async () => { const n = window.prompt('Reason for declining (optional)?'); if (n === null) return; await decideQuoteApproval(defect.id, false, n, actor); });

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
          {warrantyActive && <span className="dd-chip dd-chip-warranty"><Icon name="ShieldCheck" size={11} /> Under warranty</span>}
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
      <div className={`dd-cols${railOpen ? '' : ' dd-rail-shut'}`}>
        {/* left — the record */}
        <div className="dd-main">
          {warrantyCtx.length > 0 && (
            <div className="dd-warn-banner">
              <Icon name="ShieldAlert" size={16} />
              <div>
                <div className="t">Possible warranty claim</div>
                <div className="s">
                  A prior repair here is still under warranty —{' '}
                  {warrantyCtx.slice(0, 3).map((w, i) => (
                    <React.Fragment key={w.id}>
                      {i > 0 && ', '}
                      <button type="button" className="dd-warn-link" onClick={() => navigate(`/defects/${w.id}`)}>
                        {w.ref || 'defect'}{w.contractorName ? ` (${w.contractorName})` : ''} to {fmt(w.warrantyUntil)}
                      </button>
                    </React.Fragment>
                  ))}. Check before paying for re-work.
                  {canManage && !isClosed && !defect.promotedJobId && (
                    <> <button type="button" className="dd-warn-link" onClick={() => setPlanningMaint(true)}>Plan maintenance to prevent this</button></>
                  )}
                </div>
              </div>
            </div>
          )}
          {photos.length > 0 && (
            <div className="dd-gallery">
              {photos.slice(0, 3).map((p, i) => (
                <div className="dd-ph" key={i} onClick={() => window.open(p, '_blank')}>
                  <img src={p} alt={`Defect photo ${i + 1}`} />
                  {i === 2 && photos.length > 3 && <span className="more">+{photos.length - 3}</span>}
                </div>
              ))}
            </div>
          )}

          {defect.description
            ? <p className="dd-desc">{defect.description}</p>
            : (photos.length === 0 && <p className="dd-empty-note">No photos or notes on this defect.</p>)}

          {/* work tabs — one job on screen at a time */}
          <div className="dd-wtabs" role="tablist">
            <button type="button" className={`dd-wtab${workTab === 'repair' ? ' on' : ''}`} onClick={() => setWorkTab('repair')}>Repair</button>
            <button type="button" className={`dd-wtab${workTab === 'parts' ? ' on' : ''}`} onClick={() => setWorkTab('parts')}>Parts &amp; maintenance</button>
            <button type="button" className={`dd-wtab${workTab === 'activity' ? ' on' : ''}`} onClick={() => setWorkTab('activity')}>Activity{events.length ? ` · ${events.length}` : ''}</button>
          </div>

          {workTab === 'repair' && (
          <div className="dd-wpane">
          {/* Repair & contractor — arranged after the defect's logged, so it's
              edited in place on the view. Contact fields mirror the directory. */}
          <div className="dd-fix">
            {canManage && !isClosed && !fixEditing && (
              <div className="dd-fix-head" style={{ justifyContent: 'flex-end' }}>
                <button className="dd-edit-btn small" onClick={() => { startFix(); setFixEditing(true); }}>
                  <Icon name={hasRepairInfo ? 'Edit3' : 'Plus'} size={12} /> {hasRepairInfo ? 'Edit repair' : 'Arrange repair'}
                </button>
              </div>
            )}

            {/* stage stepper — click a step to move the repair along */}
            <div className="dd-stage">
              <div className="dd-stage-head">
                <span className="dd-stage-lbl">Repair progress</span>
                {canManage && !isClosed
                  ? <span className="dd-stage-hint"><Icon name="MousePointerClick" size={11} /> tap a step to update</span>
                  : <span className="dd-stage-now-txt">{REPAIR_STAGE_LABELS[defect.repairStage] || 'Not started'}</span>}
              </div>
              <div className="dd-stage-steps" role="group" aria-label="Repair stage">
                {REPAIR_STAGE_ORDER.map((s, i) => {
                  const done = stageIdx >= 0 && i <= stageIdx;
                  const cur = defect.repairStage === s;
                  return (
                    <button key={s} type="button" disabled={!canManage || isClosed || busy}
                      className={`dd-stage-step${done ? ' done' : ''}${cur ? ' cur' : ''}`}
                      title={`Set stage: ${REPAIR_STAGE_LABELS[s]}`} aria-label={`Set stage: ${REPAIR_STAGE_LABELS[s]}`}
                      aria-current={cur ? 'step' : undefined} onClick={() => setStage(s)}>
                      <span className="dd-stage-dot">{done ? <Icon name="Check" size={10} /> : i + 1}</span>
                      <span className="dd-stage-name">{REPAIR_STAGE_SHORT[s]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {fixEditing ? (
              <div className="dd-fixform">
                <div className="dd-field">
                  <label className="dd-field-lbl">Scheduled for</label>
                  <div className="dd-daterange">
                    <EditorialDatePicker value={fix.scheduledFixAt || ''} onChange={(v) => setFix({ ...fix, scheduledFixAt: v })} placeholder="from" ariaLabel="Scheduled from" rangeStart={fix.scheduledEndAt || ''} />
                    <span className="dd-daterange-sep">→</span>
                    <EditorialDatePicker value={fix.scheduledEndAt || ''} onChange={(v) => setFix({ ...fix, scheduledEndAt: v })} placeholder="to (optional)" ariaLabel="Scheduled to" rangeStart={fix.scheduledFixAt || ''} />
                  </div>
                </div>
                <div className="dd-field">
                  <label className="dd-field-lbl">Contractor</label>
                  <ContractorPicker
                    value={fix.contractorName}
                    supplierId={fix.contractorSupplierId}
                    tenantId={actor?.tenantId}
                    draftEmail={fix.contractorEmail}
                    draftPhone={fix.contractorPhone}
                    draftContact={fix.contractorContactName}
                    onChange={({ supplierId, name, email, phone }) => setFix((f) => ({
                      ...f, contractorSupplierId: supplierId, contractorName: name,
                      // pull directory contact through, but never clobber a value the crew already typed
                      contractorEmail: email !== undefined && (email || !f.contractorEmail) ? (email || '') : f.contractorEmail,
                      contractorPhone: phone !== undefined && (phone || !f.contractorPhone) ? (phone || '') : f.contractorPhone,
                    }))}
                  />
                </div>
                <div className="dd-row2">
                  <div className="dd-field">
                    <label className="dd-field-lbl">Contact name</label>
                    <input className="dd-input" value={fix.contractorContactName} onChange={(e) => setFix({ ...fix, contractorContactName: e.target.value })} placeholder="Who to ask for" />
                  </div>
                  <div className="dd-field">
                    <label className="dd-field-lbl">Phone</label>
                    <input className="dd-input" value={fix.contractorPhone} onChange={(e) => setFix({ ...fix, contractorPhone: e.target.value })} placeholder="+…" />
                  </div>
                </div>
                <div className="dd-field">
                  <label className="dd-field-lbl">Email</label>
                  <input className="dd-input" type="email" value={fix.contractorEmail} onChange={(e) => setFix({ ...fix, contractorEmail: e.target.value })} placeholder="name@firm.com" />
                </div>
                <div className="dd-field">
                  <label className="dd-field-lbl">Scope / notes</label>
                  <textarea className="dd-textarea" value={fix.contractorDetails} onChange={(e) => setFix({ ...fix, contractorDetails: e.target.value })} placeholder="Quote ref, scope of works, access notes…" />
                </div>
                <div className="dd-field">
                  <label className="dd-field-lbl">Warranty until<span style={{ color: '#AEB4C2', fontWeight: 400, marginLeft: 5 }}>if guaranteed</span></label>
                  <EditorialDatePicker value={fix.warrantyUntil || ''} onChange={(v) => setFix({ ...fix, warrantyUntil: v })} placeholder="dd/mm/yyyy" ariaLabel="Warranty until" />
                </div>
                <div className="dd-edit-actions">
                  <button className="dd-btn ghost" disabled={busy} onClick={() => { setFixEditing(false); setErr(''); }}>Cancel</button>
                  <button className="dd-btn primary" disabled={busy} onClick={saveFix} style={{ flex: 1 }}>{busy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            ) : hasRepairInfo ? (
              <div className="dd-contractor">
                {defect.scheduledFixAt && (
                  <div className="dd-sched"><Icon name="CalendarClock" size={14} /> Scheduled for {fmt(defect.scheduledFixAt)}{defect.scheduledEndAt ? ` – ${fmt(defect.scheduledEndAt)}` : ''}</div>
                )}
                {defect.contractorName && (
                  <div className="cn">
                    <Icon name="Wrench" size={14} /> {defect.contractorName}
                    {defect.contractorSupplierId && (
                      <button type="button" className="dd-cn-link" onClick={() => { onClose?.(); navigate(`/provisioning/suppliers/${defect.contractorSupplierId}`); }}>
                        In directory <Icon name="ArrowUpRight" size={12} />
                      </button>
                    )}
                  </div>
                )}
                {(defect.contractorContactName || defect.contractorEmail || defect.contractorPhone) && (
                  <div className="dd-contact">
                    {defect.contractorContactName && <span className="cc"><Icon name="User" size={12} /> {defect.contractorContactName}</span>}
                    {defect.contractorPhone && <a className="cc" href={`tel:${defect.contractorPhone}`}><Icon name="Phone" size={12} /> {defect.contractorPhone}</a>}
                    {defect.contractorEmail && <a className="cc" href={`mailto:${defect.contractorEmail}`}><Icon name="Mail" size={12} /> {defect.contractorEmail}</a>}
                  </div>
                )}
                {defect.contractorDetails && <div className="cd">{defect.contractorDetails}</div>}
                {defect.warrantyUntil && (
                  <div className={`dd-warranty${warrantyActive ? ' active' : ''}`}>
                    <Icon name="ShieldCheck" size={13} /> {warrantyActive ? 'Under warranty until' : 'Warranty expired'} {fmt(defect.warrantyUntil)}
                  </div>
                )}
              </div>
            ) : (
              <p className="dd-fix-empty">No repair scheduled or contractor arranged yet.</p>
            )}

            {!fixEditing && (() => {
              const cost = costSummary(docs);
              return (
                <div className="dd-docs">
                  {(cost.quote || cost.invoice) && (
                    <div className="dd-cost">
                      <div className="dd-cost-cell"><span className="k">Quoted</span><span className="v">{cost.quote ? money(cost.quote.amount, cost.quote.currency) : '—'}</span></div>
                      <div className="dd-cost-cell"><span className="k">Invoiced</span><span className="v">{cost.invoice ? money(cost.invoice.amount, cost.invoice.currency) : '—'}</span></div>
                      {cost.variance != null && (
                        <div className="dd-cost-cell"><span className="k">Variance</span>
                          <span className={`v ${cost.variance > 0 ? 'over' : 'under'}`}>{cost.variance > 0 ? '+' : ''}{money(cost.variance, (cost.invoice || cost.quote)?.currency)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {docs.length > 0 && (
                    <div className="dd-doclist">
                      {docs.map((d) => (
                        <div className="dd-doc" key={d.id}>
                          <span className={`dd-doc-badge k-${d.kind}`}>{d.kind}</span>
                          <a className="dd-doc-name" href={d.url || undefined} target="_blank" rel="noreferrer" title={d.file_name}>
                            <Icon name="Paperclip" size={12} /> {d.file_name || 'document'}
                          </a>
                          {d.amount != null && <span className="dd-doc-amt">{money(d.amount, d.currency)}</span>}
                          {canManage && !isClosed && (
                            <button type="button" className="dd-doc-x" aria-label="Remove"
                              onClick={async () => { await deleteDefectDocument(d); await reload(); }}><Icon name="X" size={13} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canManage && !isClosed && (
                    <div className="dd-doc-actions">
                      <button type="button" className="dd-edit-btn small" onClick={() => setDocModalKind('quote')}><Icon name="Plus" size={12} /> Quote</button>
                      <button type="button" className="dd-edit-btn small" onClick={() => setDocModalKind('invoice')}><Icon name="Plus" size={12} /> Invoice</button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Quote sign-off — a Captain/HOD authorises the spend before scheduling */}
            {!fixEditing && (
              <div className="dd-approval">
                {approvalPending ? (
                  <div className="dd-appr-box pending">
                    <div className="dd-appr-h"><Icon name="Clock" size={13} /> Quote awaiting sign-off</div>
                    {canApprove ? (
                      <div className="dd-appr-actions">
                        <button type="button" className="dd-btn primary" disabled={busy} onClick={approveQuote}>Approve</button>
                        <button type="button" className="dd-btn ghost" disabled={busy} onClick={declineQuote}>Decline</button>
                      </div>
                    ) : <span className="dd-appr-sub">A Captain / HOD needs to authorise this spend before it can be scheduled.</span>}
                  </div>
                ) : defect.quoteApprovalStatus === 'approved' ? (
                  <div className="dd-appr-box approved">
                    <Icon name="BadgeCheck" size={13} /> Quote signed off{defect.quoteApprovedByName ? ` by ${defect.quoteApprovedByName}` : ''}{defect.quoteApprovedAt ? ` · ${fmt(defect.quoteApprovedAt)}` : ''}
                  </div>
                ) : defect.quoteApprovalStatus === 'declined' ? (
                  <div className="dd-appr-box declined">
                    <div className="dd-appr-h"><Icon name="XCircle" size={13} /> Quote declined{defect.quoteApprovedByName ? ` by ${defect.quoteApprovedByName}` : ''}</div>
                    {defect.quoteApprovalNote && <span className="dd-appr-sub">{defect.quoteApprovalNote}</span>}
                    {canManage && !isClosed && <button type="button" className="dd-edit-btn small" onClick={reqApproval}><Icon name="RotateCcw" size={12} /> Request again</button>}
                  </div>
                ) : (canManage && !isClosed && costSummary(docs).quote) ? (
                  <button type="button" className="dd-edit-btn small" onClick={reqApproval}><Icon name="ShieldQuestion" size={12} /> Request sign-off</button>
                ) : null}
              </div>
            )}
          </div>
          </div>
          )}

          {workTab === 'parts' && (
          <div className="dd-wpane">
            {((canManage && !isClosed) || reqs.length > 0 || defect.promotedJobId) ? (
              <div className="dd-followups">
                {canManage && !isClosed && (
                  <div className="dd-followups-actions">
                    <button className="dd-chip-action" onClick={() => setOrderingParts(true)}><Icon name="ShoppingCart" size={13} /> Order parts</button>
                    {!defect.promotedJobId && (
                      <button className="dd-chip-action" onClick={() => setPlanningMaint(true)}><Icon name="CalendarPlus" size={13} /> Plan maintenance</button>
                    )}
                  </div>
                )}
                {reqs.map((r) => (
                  <button key={r.id} type="button" className="dd-req" onClick={() => { onClose?.(); navigate(`/provisioning/${r.id}`); }}>
                    <Icon name="ClipboardList" size={14} />
                    <span className="t">{r.title}</span>
                    <span className="s">{String(r.status || 'draft').replace(/_/g, ' ')}</span>
                    <Icon name="ArrowUpRight" size={13} />
                  </button>
                ))}
                {defect.promotedJobId && (
                  <button type="button" className="dd-req" onClick={() => { onClose?.(); navigate('/team-jobs-management'); }}>
                    <Icon name="Wrench" size={14} />
                    <span className="t">Scheduled maintenance on the job board</span>
                    <Icon name="ArrowUpRight" size={13} />
                  </button>
                )}
              </div>
            ) : <p className="dd-fix-empty">Nothing ordered or scheduled for this defect.</p>}
          </div>
          )}

          {workTab === 'activity' && (
          <div className="dd-wpane">
            <div>
              <p className="dd-lbl">Activity{events.length ? ` · ${events.length}` : ''}</p>
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
            <div>
              <p className="dd-lbl">Comments{comments.length ? ` · ${comments.length}` : ''}</p>
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
          )}
        </div>

        {/* right — control rail, collapsible to a slim status + owner strip.
            The divider edge is the hover/click target (turns terracotta). */}
        <div className="dd-rail">
          <button type="button" className="dd-rail-edge" onClick={() => setRailOpen((v) => !v)}
            title={railOpen ? 'Collapse details' : 'Show details'} aria-label={railOpen ? 'Collapse details' : 'Show details'} />
          {railOpen ? (
          <>
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

            {/* facts — essentials always; the rest behind a toggle */}
            <div className="dd-panel">
              <div className="dd-row"><span className="k">Priority</span><span className={`v${defect.priority === 'Critical' ? ' crit' : ''}`}>{defect.priority}</span></div>
              <div className="dd-row"><span className="k">Department</span><span className="v">{defect.departmentOwner || '—'}</span></div>
              <div className="dd-row"><span className="k">Location</span><span className="v" title={loc}>{loc}</span></div>
              {moreFacts && (
                <>
                  {defect.scheduledFixAt && <div className="dd-row"><span className="k">Scheduled</span><span className="v">{fmt(defect.scheduledFixAt)}{defect.scheduledEndAt ? `–${fmt(defect.scheduledEndAt)}` : ''}</span></div>}
                  <div className="dd-row"><span className="k">Reported by</span><span className="v">{defect.reportedByName || '—'}</span></div>
                  <div className="dd-row"><span className="k">Logged</span><span className="v">{fmt(defect.createdAt)}</span></div>
                  {defect.notifyUsers?.length > 0 && <div className="dd-row"><span className="k">Also notified</span><span className="v">{defect.notifyUsers.map((n) => n.name).filter(Boolean).join(', ')}</span></div>}
                </>
              )}
              <button type="button" className="dd-more-toggle" onClick={() => setMoreFacts((v) => !v)}>
                {moreFacts ? 'Less' : 'More details'} <Icon name={moreFacts ? 'ChevronUp' : 'ChevronDown'} size={13} />
              </button>
            </div>

            {err && <p className="dd-err">{err}</p>}

            <div className="dd-actions">
              {canManage && !isClosed && <button className="dd-btn ghost block" disabled={busy} onClick={doClose}>Mark fixed &amp; close</button>}
              {canManage && isClosed && <button className="dd-btn ghost block" disabled={busy} onClick={doReopen}>Re-open</button>}
              <button className="dd-btn ghost block" onClick={() => navigate(`/defects/${defect.id}`)}>Open in Defects ↗</button>
            </div>
          </>
          ) : (
            <div className="dd-rail-mini">
              <span className={`dd-chip ${sMeta.cls} dd-mini-status`} title={`Status: ${sMeta.label}`}><span className="cd" /></span>
              <span className={`dd-avatar ${avCls} dd-mini-av`} title={ownerName}>{avCls === 'none' ? '?' : initials(defect.assigneeKind === 'team' ? ownerName : defect.assignedToName)}</span>
            </div>
          )}
        </div>
      </div>
      )}

      {orderingParts && (
        <OrderPartsModal
          defect={defect}
          onClose={() => setOrderingParts(false)}
          onCreated={async () => { setOrderingParts(false); await reload(); }}
        />
      )}

      {planningMaint && (
        <PlanMaintenanceModal
          defect={defect}
          onClose={() => setPlanningMaint(false)}
          onDone={async () => { setPlanningMaint(false); await onChanged?.(); await reload(); }}
        />
      )}

      {docModalKind && (
        <DefectDocModal
          defect={defect}
          kind={docModalKind}
          onClose={() => setDocModalKind(null)}
          onDone={async (row) => {
            setDocModalKind(null);
            // A high-value quote auto-triggers a Captain/HOD sign-off request.
            if (row?.kind === 'quote' && row?.amount != null && Number(row.amount) >= quoteSettings.threshold
                && !defect.quoteApprovalStatus) {
              await requestQuoteApproval(defect.id, actor, money(row.amount, row.currency));
              await onChanged?.();
            }
            await reload();
          }}
        />
      )}
    </div>
  );
}
