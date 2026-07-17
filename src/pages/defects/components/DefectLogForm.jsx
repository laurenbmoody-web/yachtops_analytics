// Shared "log a defect" form — used by the map pin drawer and the dashboard
// quick-add so both stay identical. Owns the form state, department/crew lookup,
// notifiers, priority dots, icon assign, hover-expand flags and multi-photo strip.
// It builds the defect payload and hands it to the host's onSubmit; the host adds
// any location context (a map pin, or nothing) and calls createDefect.
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import VmdSelect from '../../vessel-map/components/VmdSelect';
import { useDefectActor } from '../utils/useDefectActor';
import { DefectPriority, fetchTenantDepartments } from '../utils/defectsStorage';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import '../../vessel-map/components/DefectPin.css';

const ASSIGN = [
  { k: 'unassigned', icon: 'Ban', title: 'No one' },
  { k: 'team', icon: 'Users', title: 'Whole team' },
  { k: 'user', icon: 'User', title: 'A person' },
];
const PRIORITIES = [
  { k: 'Low', title: 'Low' }, { k: 'Medium', title: 'Medium' },
  { k: 'High', title: 'High' }, { k: 'Critical', title: 'Critical' },
];

export default function DefectLogForm({ onSubmit, onSubmitAndPin = null, onCancel, submitLabel = 'Log & notify', busyLabel = 'Logging…', showLocation = false, initial = null }) {
  const actor = useDefectActor();
  const fileRef = useRef(null);
  const [departments, setDepartments] = useState([]);
  const [crew, setCrew] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(() => ({
    title: '', priority: DefectPriority.MEDIUM, description: '', photos: [],
    deptId: '', assign: 'unassigned', userId: '', affectsGuestAreas: false, safetyRelated: false,
    notify: [], locationFreeText: '',
    ...(initial || {}),
  }));

  useEffect(() => {
    if (!actor?.tenantId) return undefined;
    let live = true;
    (async () => {
      const [depts, cr] = await Promise.all([fetchTenantDepartments(actor.tenantId), fetchTenantCrew(actor.tenantId)]);
      if (!live) return;
      setDepartments(depts || []);
      setCrew(cr || []);
      setForm((f) => ({ ...f, deptId: f.deptId || actor.departmentId || (depts?.[0]?.id || '') }));
    })();
    return () => { live = false; };
  }, [actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deptName = (id) => departments.find((d) => d?.id === id)?.name || null;
  const dName = deptName(form.deptId);
  const crewForAssignee = form.deptId
    ? crew.filter((c) => (c?.department || '').toLowerCase() === (dName || '').toLowerCase()).sort((a, b) => (a?.fullName || '').localeCompare(b?.fullName || ''))
    : [];
  const notifyCandidates = crew
    .filter((c) => c?.id !== form.userId && !form.notify.some((n) => n.id === c.id))
    .sort((a, b) => (a?.fullName || '').localeCompare(b?.fullName || ''));
  const addNotify = (id) => { const c = crew.find((x) => x?.id === id); if (c) setForm((f) => ({ ...f, notify: [...f.notify, { id: c.id, name: c.fullName }] })); };
  const removeNotify = (id) => setForm((f) => ({ ...f, notify: f.notify.filter((n) => n.id !== id) }));

  const onPickPhoto = (e) => {
    const files = Array.from(e?.target?.files || []);
    e.target.value = '';
    files.forEach((file) => { const r = new FileReader(); r.onloadend = () => setForm((f) => ({ ...f, photos: [...f.photos, r.result] })); r.readAsDataURL(file); });
  };

  const buildPayload = () => {
    const picked = crew.find((c) => c?.id === form.userId);
    return {
      title: form.title, description: form.description, priority: form.priority,
      departmentId: form.deptId || null, departmentOwner: dName,
      assigneeKind: form.assign,
      assignedToUserId: form.assign === 'user' ? form.userId : null,
      assignedToName: form.assign === 'user' ? (picked?.fullName || null) : null,
      assignedTeamDepartmentId: form.assign === 'team' ? form.deptId : null,
      assignedTeamName: form.assign === 'team' ? dName : null,
      affectsGuestAreas: form.affectsGuestAreas, safetyRelated: form.safetyRelated,
      photos: form.photos, notifyUsers: form.notify,
      ...(showLocation ? { locationFreeText: form.locationFreeText, locationPathLabel: form.locationFreeText || null } : {}),
    };
  };

  const runSubmit = async (handler) => {
    if (!form.title.trim()) { setErr('Give the defect a title.'); return; }
    setBusy(true); setErr('');
    try {
      await handler(buildPayload());
    } catch (e2) {
      setErr(e2?.message || 'Failed to log the defect.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => { e?.preventDefault(); runSubmit(onSubmit); };

  return (
    <form className="vmd-form" onSubmit={submit}>
      {/* Title + priority */}
      <div className="vmd-field">
        <div className="vmd-lbl-row">
          <label className="vmd-lbl">Title<span className="req">required</span></label>
          <span className="vmd-lbl">Priority · <span className={`vmd-prio-name p-${form.priority}`}>{form.priority}</span></span>
        </div>
        <div className="vmd-title-row">
          <input className="vmd-input" value={form.title} autoFocus
            onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Cracked porthole seal" />
          <div className="vmd-prio" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button type="button" key={p.k} role="radio" aria-checked={form.priority === p.k}
                title={`${p.title} priority`} aria-label={`${p.title} priority`}
                className={`vmd-prio-dot p-${p.k}${form.priority === p.k ? ' on' : ''}`}
                onClick={() => setForm({ ...form, priority: p.k })} />
            ))}
          </div>
        </div>
      </div>

      {/* Department + assign */}
      <div className="vmd-deptrow">
        <div className="vmd-field" style={{ flex: 1, minWidth: 0 }}>
          <label className="vmd-lbl">Department</label>
          <VmdSelect value={form.deptId} onChange={(v) => setForm({ ...form, deptId: v, userId: '' })}
            options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="Choose department…" ariaLabel="Department" />
        </div>
        <div className="vmd-af-group">
          <label className="vmd-lbl">Assign</label>
          <div className="vmd-iconset">
            {ASSIGN.map((a) => (
              <button type="button" key={a.k} title={a.title} aria-label={a.title}
                className={`vmd-iconbtn${form.assign === a.k ? ' on' : ''}`} onClick={() => setForm({ ...form, assign: a.k })}>
                <Icon name={a.icon} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {form.assign === 'user' && (
        <VmdSelect value={form.userId} onChange={(v) => setForm({ ...form, userId: v })}
          options={crewForAssignee.map((c) => ({ value: c.id, label: c.fullName }))}
          placeholder={form.deptId ? 'Select crew…' : 'Choose a department first'}
          emptyText={form.deptId ? `No crew in ${dName || 'this department'}` : 'Choose a department first'} ariaLabel="Assign to crew member" />
      )}
      {form.assign === 'team' && (
        <p className="vmd-comment-empty">Everyone in {dName || 'the department'} is notified — first to accept owns it.</p>
      )}

      {/* Also notify */}
      <div className="vmd-field">
        <label className="vmd-lbl">Also notify<span className="req" style={{ color: '#AEB4C2' }}>optional</span></label>
        {form.notify.length > 0 && (
          <div className="vmd-chips">
            {form.notify.map((n) => (
              <span className="vmd-notify-chip" key={n.id}>{n.name}
                <button type="button" onClick={() => removeNotify(n.id)} aria-label={`Remove ${n.name}`}><Icon name="X" size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <VmdSelect value="" onChange={(v) => { if (v) addNotify(v); }}
          options={notifyCandidates.map((c) => ({ value: c.id, label: `${c.fullName}${c.department ? ` · ${c.department}` : ''}` }))}
          placeholder="Add someone to notify…" emptyText="Everyone's already added" ariaLabel="Add someone to notify" />
      </div>

      {showLocation && (
        <div className="vmd-field">
          <div className="vmd-lbl-row">
            <label className="vmd-lbl">Location<span className="req" style={{ color: '#AEB4C2' }}>optional</span></label>
            {onSubmitAndPin && (
              <button type="button" className="vmd-pinlink" disabled={busy} onClick={() => runSubmit(onSubmitAndPin)} title="Log the defect, then drop a pin on the map">
                <Icon name="MapPin" size={13} /> Set on map
              </button>
            )}
          </div>
          <input className="vmd-input" value={form.locationFreeText}
            onChange={(e) => setForm({ ...form, locationFreeText: e.target.value })} placeholder="Type it here, or set it on the map →" />
        </div>
      )}

      {/* Flags */}
      <div className="vmd-field">
        <label className="vmd-lbl">Flags</label>
        <div className="vmd-flagset">
          <button type="button" title="Affects guest areas" aria-label="Affects guest areas"
            className={`vmd-flagbtn${form.affectsGuestAreas ? ' on' : ''}`} onClick={() => setForm({ ...form, affectsGuestAreas: !form.affectsGuestAreas })}>
            <Icon name="Sofa" size={16} /><span className="vmd-flag-label">Guest area</span>
          </button>
          <button type="button" title="Safety-related" aria-label="Safety-related"
            className={`vmd-flagbtn${form.safetyRelated ? ' on' : ''}`} onClick={() => setForm({ ...form, safetyRelated: !form.safetyRelated })}>
            <Icon name="ShieldAlert" size={16} /><span className="vmd-flag-label">Safety-related</span>
          </button>
        </div>
      </div>

      {/* Photos */}
      <div className="vmd-field">
        <label className="vmd-lbl">Photos<span className="req" style={{ color: '#AEB4C2' }}>optional</span></label>
        <div className="vmd-photostrip">
          <button type="button" className="vmd-photo-add" onClick={() => fileRef.current?.click()} title="Add photos"><Icon name="Plus" size={18} /></button>
          {form.photos.map((p, i) => (
            <div className="vmd-photo-thumb" key={i}>
              <img src={p} alt={`Defect ${i + 1}`} />
              <button type="button" className="vmd-photo-x" onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={onPickPhoto} />
      </div>

      <div className="vmd-field">
        <label className="vmd-lbl">Notes</label>
        <textarea className="vmd-textarea" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What's wrong, any detail the engineer needs…" />
      </div>

      {err && <p className="vmd-err">{err}</p>}
      <div className="vmd-form-actions">
        {onCancel && <button type="button" className="vm-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="submit" className="vm-btn-primary" disabled={busy} style={{ flex: 1 }}>{busy ? busyLabel : submitLabel}</button>
      </div>
    </form>
  );
}
