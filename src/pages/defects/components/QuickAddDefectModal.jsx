// Dashboard quick-add defect modal. A light editorial form that logs a defect
// straight into the shared Supabase module (cross-device notify), with a
// "View all" deep-link into Defects and a "pin it on the map" shortcut into the
// vessel map (where the P1 pin drawer logs it against a specific pin).
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { useDefectActor } from '../utils/useDefectActor';
import { createDefect, fetchTenantDepartments, DefectPriority } from '../utils/defectsStorage';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import './QuickAddDefectModal.css';

export default function QuickAddDefectModal({ onClose, onSuccess }) {
  const actor = useDefectActor();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [departments, setDepartments] = useState([]);
  const [crew, setCrew] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    title: '', priority: DefectPriority.MEDIUM, description: '', photo: null,
    deptId: '', assign: 'unassigned', userId: '', locationFreeText: '',
  });

  useEffect(() => {
    if (!actor?.tenantId) return;
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
  const crewInDept = crew.filter((c) => !form.deptId || (c?.department || '').toLowerCase() === (deptName(form.deptId) || '').toLowerCase());

  const onPickPhoto = (e) => {
    const file = e?.target?.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setForm((f) => ({ ...f, photo: reader.result }));
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) { setErr('Give the defect a title.'); return; }
    setBusy(true); setErr('');
    try {
      const dName = deptName(form.deptId);
      const picked = crew.find((c) => c?.id === form.userId);
      await createDefect({
        title: form.title, description: form.description, priority: form.priority,
        departmentId: form.deptId || null, departmentOwner: dName,
        assigneeKind: form.assign,
        assignedToUserId: form.assign === 'user' ? form.userId : null,
        assignedToName: form.assign === 'user' ? (picked?.fullName || null) : null,
        assignedTeamDepartmentId: form.assign === 'team' ? form.deptId : null,
        assignedTeamName: form.assign === 'team' ? dName : null,
        locationFreeText: form.locationFreeText,
        locationPathLabel: form.locationFreeText || null,
        photos: form.photo ? [form.photo] : [],
      }, actor);
      showToast('Defect logged', 'success');
      onSuccess?.();
    } catch (e2) {
      setErr(e2?.message || 'Failed to log the defect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} panelClassName="qad" isBusy={busy}>
      <div className="qad-head">
        <h3>Log a defect</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="qad-viewall" onClick={() => navigate('/defects')}>View all →</button>
          <button className="qad-x" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      <form className="qad-body" onSubmit={submit}>
        <button type="button" className="qad-map" onClick={() => navigate('/vessel/map')}>
          📍 <span>Prefer to pin it on the map? <b>Open the vessel map →</b></span>
        </button>

        <div className="qad-field">
          <label className="qad-lbl">Title<span className="req">required</span></label>
          <input className="qad-input" autoFocus value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Cracked porthole seal" />
        </div>

        <div className="qad-row">
          <div className="qad-field">
            <label className="qad-lbl">Priority</label>
            <select className="qad-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {Object.values(DefectPriority).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="qad-field">
            <label className="qad-lbl">Department</label>
            <select className="qad-select" value={form.deptId} onChange={(e) => setForm({ ...form, deptId: e.target.value, userId: '' })}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div className="qad-field">
          <label className="qad-lbl">Assign to</label>
          <div className="qad-seg">
            {['unassigned', 'team', 'user'].map((k) => (
              <button type="button" key={k} className={form.assign === k ? 'on' : ''} onClick={() => setForm({ ...form, assign: k })}>
                {k === 'unassigned' ? 'No one' : k === 'team' ? 'Whole team' : 'A person'}
              </button>
            ))}
          </div>
          {form.assign === 'user' && (
            <select className="qad-select" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} style={{ marginTop: 8 }}>
              <option value="">Select crew…</option>
              {crewInDept.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          )}
          {form.assign === 'team' && (
            <p className="qad-hint">Everyone in {deptName(form.deptId) || 'the department'} is notified — first to accept owns it.</p>
          )}
        </div>

        <div className="qad-field">
          <label className="qad-lbl">Location<span className="opt">optional</span></label>
          <input className="qad-input" value={form.locationFreeText}
            onChange={(e) => setForm({ ...form, locationFreeText: e.target.value })} placeholder="e.g. Owner's cabin · aft bulkhead" />
        </div>

        <div className="qad-field">
          <label className="qad-lbl">Photo<span className="opt">optional</span></label>
          {form.photo ? (
            <div className="qad-photo-preview">
              <img src={form.photo} alt="Defect" />
              <button type="button" className="qad-photo-x" onClick={() => setForm({ ...form, photo: null })}>×</button>
            </div>
          ) : (
            <button type="button" className="qad-photo-btn" onClick={() => fileRef.current?.click()}>＋ Add a photo</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPickPhoto} />
        </div>

        <div className="qad-field">
          <label className="qad-lbl">Notes<span className="opt">optional</span></label>
          <textarea className="qad-textarea" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Any detail the engineer needs…" />
        </div>

        {err && <p className="qad-err">{err}</p>}
      </form>

      <div className="qad-foot">
        <button type="button" className="qad-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="qad-btn primary" onClick={submit} disabled={busy}>{busy ? 'Logging…' : 'Log & notify'}</button>
      </div>
    </ModalShell>
  );
}
