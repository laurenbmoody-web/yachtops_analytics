import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

// Phase 2 sub-piece 2 — Simple template editor modal.
//
// Body shape produced on save:
//   { shift_type: '<type>', [sub_type?], [start_time?], [end_time?] }
// sub_type is hardcoded per Phase 1 defaults (watch=navigation,
// standby=maintenance, others omitted) and never user-facing here.
//
// Department selection is single-choice: "All departments" (scope='vessel')
// OR exactly one department (scope='department'). Multi-department fan-out
// is deliberately deferred per Phase 2 spec.

const TYPE_PILLS = [
  ['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'],
  ['training', 'Training'], ['medical', 'Medical'],
];
const TYPE_COLOR = {
  duty: '#1C1B3A', watch: '#C65A1A', standby: '#B8935E',
  training: '#6B7F6B', medical: '#7A2E1E',
};
function subTypeFor(t) {
  if (t === 'watch') return 'navigation';
  if (t === 'standby') return 'maintenance';
  return null;
}
function fmtTime(t) { return t ? String(t).slice(0, 5) : ''; }

// Selection state value: 'all' | departmentId(string).
function initialSelection(template, myDeptId) {
  if (template) {
    if (template.scope === 'vessel') return 'all';
    return template.departmentId || 'all';
  }
  return myDeptId || 'all';
}

export default function SimpleTemplateEditor({
  open, template, departments = [], myDeptId, vesselId,
  onClose, createTemplate, updateTemplate, deleteTemplate, onToast,
}) {
  const isEdit = !!template;
  const editingLocked = isEdit && template?.isDefault === true;

  const [name, setName] = useState(template?.name || '');
  const [selection, setSelection] = useState(() => initialSelection(template, myDeptId));
  const [type, setType] = useState(template?.body?.shift_type || 'duty');
  const [noFixedHours, setNoFixedHours] = useState(
    isEdit ? !(template?.body?.start_time && template?.body?.end_time) : false,
  );
  const [startTime, setStartTime] = useState(fmtTime(template?.body?.start_time) || '08:00');
  const [endTime, setEndTime] = useState(fmtTime(template?.body?.end_time) || '18:00');
  const [busy, setBusy] = useState(false);

  // Re-seed when the modal opens with a different template (the parent
  // unmount/remounts via {open && <Editor.../>} so this is mostly belt
  // and braces).
  useEffect(() => {
    if (!open) return;
    setName(template?.name || '');
    setSelection(initialSelection(template, myDeptId));
    setType(template?.body?.shift_type || 'duty');
    setNoFixedHours(template
      ? !(template?.body?.start_time && template?.body?.end_time)
      : false,
    );
    setStartTime(fmtTime(template?.body?.start_time) || '08:00');
    setEndTime(fmtTime(template?.body?.end_time) || '18:00');
  }, [open, template, myDeptId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (!noFixedHours && (!startTime || !endTime)) return false;
    if (editingLocked) return false;
    return true;
  }, [name, noFixedHours, startTime, endTime, editingLocked]);

  if (!open) return null;

  const previewColor = TYPE_COLOR[type] || '#B4B2A9';
  const scope = selection === 'all' ? 'vessel' : 'department';
  const departmentId = selection === 'all' ? null : selection;

  const buildBody = () => {
    const body = { shift_type: type };
    const sub = subTypeFor(type);
    if (sub) body.sub_type = sub;
    if (!noFixedHours) {
      body.start_time = startTime;
      body.end_time = endTime;
    }
    return body;
  };

  const handleSave = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    const body = buildBody();
    const res = isEdit
      ? await updateTemplate(template.id, {
          name: name.trim(), scope, departmentId, body,
        })
      : await createTemplate({
          name: name.trim(), kind: 'simple', scope, departmentId, body, vesselId,
        });
    setBusy(false);
    if (!res.ok) {
      onToast?.(`Couldn’t save template — ${res.error || 'try again'}`);
      return;
    }
    onClose?.();
  };

  const handleDelete = async () => {
    if (!isEdit || busy) return;
    setBusy(true);
    const res = await deleteTemplate(template.id);
    setBusy(false);
    if (!res.ok) {
      onToast?.(`Couldn’t delete — ${res.error || 'try again'}`);
      return;
    }
    onClose?.();
  };

  return (
    <>
      <div className="rest-popover-backdrop" onClick={onClose} />
      <div
        className="te-panel"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit template ${template?.name}` : 'New simple template'}
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">{isEdit ? 'Edit template' : 'New template'}</div>
            <h2 className="tp-title">A <em>simple</em> shift.</h2>
          </div>
          <button type="button" className="tp-close"
            aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="te-body">
          <label className="te-field">
            <span className="te-field-label">Name</span>
            <input
              type="text" className="te-input"
              placeholder="e.g. Early service"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className="te-field">
            <span className="te-field-label">Departments</span>
            <div className="te-dept-list">
              <label className={`te-dept-row${selection === 'all' ? ' is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selection === 'all'}
                  onChange={() => setSelection('all')}
                />
                <span>All departments</span>
              </label>
              {departments.map((d) => {
                const checked = selection === d.id;
                const lockedByAll = selection === 'all';
                return (
                  <label
                    key={d.id}
                    className={[
                      'te-dept-row',
                      checked ? 'is-selected' : '',
                      lockedByAll ? 'is-locked' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={lockedByAll}
                      onChange={() => setSelection(d.id)}
                    />
                    <span>{d.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="te-field">
            <span className="te-field-label">Shift type</span>
            <div className="te-pills" role="radiogroup" aria-label="Shift type">
              {TYPE_PILLS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={type === key}
                  className={`crew-rota-pill${type === key ? ' active' : ''}`}
                  onClick={() => setType(key)}
                >{label}</button>
              ))}
            </div>
          </div>

          <label className="te-toggle">
            <input
              type="checkbox"
              checked={noFixedHours}
              onChange={(e) => setNoFixedHours(e.target.checked)}
            />
            <span>No fixed hours</span>
          </label>

          <div className="te-field te-times" aria-disabled={noFixedHours}>
            <label className="te-field-sub">
              <span className="te-field-label">Start</span>
              <input
                type="time" step="1800"
                className="te-input"
                value={startTime}
                disabled={noFixedHours}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="te-field-sub">
              <span className="te-field-label">End</span>
              <input
                type="time" step="1800"
                className="te-input"
                value={endTime}
                disabled={noFixedHours}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>

          <div className="te-preview">
            <span className="te-preview-swatch" style={{ background: previewColor }} />
            <span className="te-preview-name">{name || 'Template preview'}</span>
            <span className="te-preview-time">
              {noFixedHours ? 'No fixed hours' : `${startTime} – ${endTime}`}
            </span>
          </div>
        </div>

        <div className="te-footer">
          {isEdit && !editingLocked ? (
            <button
              type="button"
              className="te-delete"
              disabled={busy}
              onClick={handleDelete}
            >Delete template</button>
          ) : <span />}
          <div className="te-footer-actions">
            <button type="button" className="v2-btn-ghost"
              onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="v2-btn-filled"
              onClick={handleSave}
              disabled={!canSave || busy}>
              {busy ? 'Saving…' : isEdit ? 'Save template' : 'Create template'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
