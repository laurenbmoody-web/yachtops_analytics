// The defect drawer for a `defect`-layer map pin. Links the pin (scan_hotspots)
// to a public.defects row (defects.hotspot_id): empty → the "log a defect" form
// here; linked → the shared two-column DefectDetail. All writes go through the
// Supabase defects data layer, so a logged/assigned defect notifies crew
// cross-device.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useDefectActor } from '../../defects/utils/useDefectActor';
import { DefectPriority, getDefectByHotspot, getDefectById, createDefect, fetchTenantDepartments } from '../../defects/utils/defectsStorage';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import VmdSelect from './VmdSelect';
import DefectDetail from '../../defects/components/DefectDetail';
import './DefectPin.css';

export default function DefectPin({ hotspot, canManage, scanName, containerTrail, onChanged, onTitled, onCancel }) {
  const actor = useDefectActor();
  const fileRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [defect, setDefect] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [departments, setDepartments] = useState([]);
  const [crew, setCrew] = useState([]);
  const [form, setForm] = useState({ title: '', priority: DefectPriority.MEDIUM, description: '', photos: [], deptId: '', assign: 'unassigned', userId: '', affectsGuestAreas: false, safetyRelated: false, notify: [] });

  const locationLabel = useMemo(() => {
    const trail = (containerTrail || []).map((c) => c?.name || c).filter(Boolean);
    return [scanName, ...trail, hotspot?.label].filter(Boolean).join(' · ');
  }, [scanName, containerTrail, hotspot?.label]);

  const loadForPin = useCallback(async () => {
    if (!hotspot?.id || !actor?.tenantId) { setLoading(false); return; }
    setLoading(true);
    const d = await getDefectByHotspot(hotspot.id, actor);
    setDefect(d);
    setLoading(false);
  }, [hotspot?.id, actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadForPin(); }, [loadForPin]);

  // Pickers for the log form (loaded while there's no defect yet).
  useEffect(() => {
    if (defect || loading || !actor?.tenantId) return;
    let live = true;
    (async () => {
      const [depts, cr] = await Promise.all([fetchTenantDepartments(actor.tenantId), fetchTenantCrew(actor.tenantId)]);
      if (!live) return;
      setDepartments(depts || []);
      setCrew(cr || []);
      setForm((f) => ({ ...f, deptId: f.deptId || actor.departmentId || (depts?.[0]?.id || '') }));
    })();
    return () => { live = false; };
  }, [defect, loading, actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetchById = async (id) => {
    const d = await getDefectById(id, actor);
    setDefect(d);
    onChanged?.();
  };

  const deptName = (id) => departments.find((d) => d?.id === id)?.name || null;
  const dName = deptName(form.deptId);
  // The assignee comes from the chosen department; use "Also notify" for anyone
  // else (e.g. CC the Chief Stew on an Engineering defect).
  const crewForAssignee = form.deptId
    ? crew.filter((c) => (c?.department || '').toLowerCase() === (dName || '').toLowerCase())
        .sort((a, b) => (a?.fullName || '').localeCompare(b?.fullName || ''))
    : [];

  // "Also notify" — anyone on the vessel (so a stew can CC the Chief Stew on an
  // Engineering defect). Excludes the assignee and anyone already added.
  const notifyCandidates = crew
    .filter((c) => c?.id !== form.userId && !form.notify.some((n) => n.id === c.id))
    .sort((a, b) => (a?.fullName || '').localeCompare(b?.fullName || ''));
  const addNotify = (id) => {
    const c = crew.find((x) => x?.id === id);
    if (c) setForm((f) => ({ ...f, notify: [...f.notify, { id: c.id, name: c.fullName }] }));
  };
  const removeNotify = (id) => setForm((f) => ({ ...f, notify: f.notify.filter((n) => n.id !== id) }));

  const onPickPhoto = (e) => {
    const files = Array.from(e?.target?.files || []);
    e.target.value = '';
    if (!files.length) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => setForm((f) => ({ ...f, photos: [...f.photos, reader.result] }));
      reader.readAsDataURL(file);
    });
  };

  const guardBusy = async (fn) => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e?.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const handleLog = () => guardBusy(async () => {
    if (!form.title.trim()) { setErr('Give the defect a title.'); return; }
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
      affectsGuestAreas: form.affectsGuestAreas,
      safetyRelated: form.safetyRelated,
      photos: form.photos,
      notifyUsers: form.notify,
    }, actor);
    if (created) { setDefect(created); setComments([]); onTitled?.(created.title); onChanged?.(); }
  });

  if (loading) return <div className="vmd-formwrap"><p className="vmd-loading">Loading defect…</p></div>;

  // Logged defect → the shared two-column detail view.
  if (defect) {
    return <DefectDetail defect={defect} onChanged={() => refetchById(defect.id)} locationLabel={locationLabel} />;
  }

  // ── Log form ───────────────────────────────────────────────────────────────
  if (!defect) {
    const ASSIGN = [
      { k: 'unassigned', icon: 'Ban', title: 'No one' },
      { k: 'team', icon: 'Users', title: 'Whole team' },
      { k: 'user', icon: 'User', title: 'A person' },
    ];
    const PRIORITIES = [
      { k: 'Low', title: 'Low' }, { k: 'Medium', title: 'Medium' },
      { k: 'High', title: 'High' }, { k: 'Critical', title: 'Critical' },
    ];
    return (
      <div className="vmd-formwrap">
        <div className="vmd-form-head">
          <p className="vmd-modal-eyebrow">New defect{scanName ? ` · ${scanName}` : ''}</p>
          <h3 className="vmd-form-title">Log a defect</h3>
        </div>
        <form className="vmd-form" onSubmit={(e) => { e.preventDefault(); handleLog(); }}>
          {/* Title + priority on one row. */}
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

          {/* Department + assign icons on one row. */}
          <div className="vmd-deptrow">
            <div className="vmd-field" style={{ flex: 1, minWidth: 0 }}>
              <label className="vmd-lbl">Department</label>
              <VmdSelect
                value={form.deptId}
                onChange={(v) => setForm({ ...form, deptId: v, userId: '' })}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
                placeholder="Choose department…"
                ariaLabel="Department"
              />
            </div>
            <div className="vmd-af-group">
              <label className="vmd-lbl">Assign</label>
              <div className="vmd-iconset">
                {ASSIGN.map((a) => (
                  <button type="button" key={a.k} title={a.title} aria-label={a.title}
                    className={`vmd-iconbtn${form.assign === a.k ? ' on' : ''}`}
                    onClick={() => setForm({ ...form, assign: a.k })}>
                    <Icon name={a.icon} size={16} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {form.assign === 'user' && (
            <VmdSelect
              value={form.userId}
              onChange={(v) => setForm({ ...form, userId: v })}
              options={crewForAssignee.map((c) => ({ value: c.id, label: c.fullName }))}
              placeholder={form.deptId ? 'Select crew…' : 'Choose a department first'}
              emptyText={form.deptId ? `No crew in ${dName || 'this department'}` : 'Choose a department first'}
              ariaLabel="Assign to crew member"
            />
          )}
          {form.assign === 'team' && (
            <p className="vmd-comment-empty">Everyone in {dName || 'the department'} is notified — first to accept owns it.</p>
          )}

          {/* Also notify — anyone on the vessel (e.g. CC the Chief Stew). */}
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
            <VmdSelect
              value=""
              onChange={(v) => { if (v) addNotify(v); }}
              options={notifyCandidates.map((c) => ({ value: c.id, label: `${c.fullName}${c.department ? ` · ${c.department}` : ''}` }))}
              placeholder="Add someone to notify…"
              emptyText="Everyone's already added"
              ariaLabel="Add someone to notify"
            />
          </div>

          {/* Flags — icon buttons that expand to their label on hover. */}
          <div className="vmd-field">
            <label className="vmd-lbl">Flags</label>
            <div className="vmd-flagset">
              <button type="button" title="Affects guest areas" aria-label="Affects guest areas"
                className={`vmd-flagbtn${form.affectsGuestAreas ? ' on' : ''}`}
                onClick={() => setForm({ ...form, affectsGuestAreas: !form.affectsGuestAreas })}>
                <Icon name="Sofa" size={16} /><span className="vmd-flag-label">Guest area</span>
              </button>
              <button type="button" title="Safety-related" aria-label="Safety-related"
                className={`vmd-flagbtn${form.safetyRelated ? ' on' : ''}`}
                onClick={() => setForm({ ...form, safetyRelated: !form.safetyRelated })}>
                <Icon name="ShieldAlert" size={16} /><span className="vmd-flag-label">Safety-related</span>
              </button>
            </div>
          </div>

          <div className="vmd-field">
            <label className="vmd-lbl">Photos<span className="req" style={{ color: '#AEB4C2' }}>optional</span></label>
            <div className="vmd-photostrip">
              <button type="button" className="vmd-photo-add" onClick={() => fileRef.current?.click()} title="Add photos">
                <Icon name="Plus" size={18} />
              </button>
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
            <button type="submit" className="vm-btn-primary" disabled={busy} style={{ flex: 1 }}>{busy ? 'Logging…' : 'Log & notify'}</button>
          </div>
        </form>
      </div>
    );
  }
}
