import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, GripVertical, Trash2, Plus } from 'lucide-react';
import TimeSelect from './TimeSelect';

// Phase 2 sub-piece 4 — Rotation template editor modal.
//
// Body shape produced on save:
//   {
//     "duties": [
//       { "label": "Early", "shift_type": "duty",
//         "sub_type": null,  "start_time": "06:00", "end_time": "14:00" }
//     ],
//     "roles": ["Chief Stew", "2nd Stew", "3rd Stew"]
//   }
//
// Cycle length = duties.length. Matrix relation:
//   role j on day k performs duty[(j - k + N) mod N], where N=duties.length.
// Derived from the spec's pass-the-baton example (3 duties, 3 roles).
//
// Role/duty count mismatch handling (Phase 2 choice):
//   * M roles == N duties — every duty covered every day (canonical case).
//   * M < N — some duty slots uncovered each day (matrix shows duties
//     for indices that resolve via the formula; uncovered duties just
//     aren't on a role row).
//   * M > N — extra roles (index >= N) get NULL each day in the matrix
//     and the UI flags them as "no duty this cycle." Flagged as a Phase
//     2 limitation; a longer-cycle interpretation can come later.

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
function tid() { return `tmp-${Math.random().toString(36).slice(2, 9)}`; }

// Fresh-rotation defaults: 2 empty-labeled duties (user types their own
// labels in via the placeholder) and 2 empty role rows.
function defaultDuties() {
  return [
    { _k: tid(), label: '', shift_type: 'duty', start_time: '06:00', end_time: '14:00' },
    { _k: tid(), label: '', shift_type: 'duty', start_time: '14:00', end_time: '22:00' },
  ];
}
function defaultRoles() { return ['', '']; }

function normaliseDuty(d) {
  return {
    _k: tid(),
    label: d?.label || '',
    shift_type: d?.shift_type || 'duty',
    start_time: fmtTime(d?.start_time) || '06:00',
    end_time: fmtTime(d?.end_time) || '14:00',
  };
}

// Selection state: 'all' | departmentId | null (null = "no scope picked
// yet" — happens when the user unticks "All departments" and hasn't
// picked an individual department yet; canSave gates this).
function initialSelection(template, myDeptId) {
  if (template) {
    if (template.scope === 'vessel') return 'all';
    return template.departmentId || myDeptId || 'all';
  }
  // Spec: rotations default to department + user's dept; fall back to all.
  return myDeptId || 'all';
}

function DutyRow({
  duty, index, total, distinctTypes,
  onChange, onRemove, onDragStart, onDragOver, onDrop,
  onMoveUp, onMoveDown,
}) {
  return (
    <div
      className="rt-duty-row"
      draggable
      style={{ '--rt-duty-color': TYPE_COLOR[duty.shift_type] || '#B4B2A9' }}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e, index); }}
      onDrop={(e) => { e.preventDefault(); onDrop(e, index); }}
    >
      <button type="button" className="rt-grip" aria-label="Drag to reorder" tabIndex={-1}>
        <GripVertical size={14} />
      </button>
      <input
        type="text" className="te-input rt-duty-label"
        placeholder="e.g. Early"
        value={duty.label}
        onChange={(e) => onChange({ ...duty, label: e.target.value })}
      />
      <select
        className="te-input rt-duty-type"
        value={duty.shift_type}
        onChange={(e) => onChange({ ...duty, shift_type: e.target.value })}
        aria-label="Shift type"
      >
        {distinctTypes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <TimeSelect
        className="rt-duty-time"
        ariaLabel="Start"
        value={duty.start_time}
        onChange={(v) => onChange({ ...duty, start_time: v })}
      />
      <TimeSelect
        className="rt-duty-time"
        ariaLabel="End"
        value={duty.end_time}
        onChange={(v) => onChange({ ...duty, end_time: v })}
      />
      <div className="rt-duty-move">
        <button type="button"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => onMoveUp(index)}>↑</button>
        <button type="button"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={() => onMoveDown(index)}>↓</button>
      </div>
      <button type="button" className="rt-remove"
        aria-label="Remove duty"
        disabled={total <= 2}
        onClick={() => onRemove(index)}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function RotationTemplateEditor({
  open, template, departments = [], myDeptId, vesselId, crew = [],
  onClose, createTemplate, updateTemplate, deleteTemplate, onToast,
}) {
  const isEdit = !!template;
  const editingLocked = isEdit && template?.isDefault === true;

  const [name, setName] = useState('');
  const [selection, setSelection] = useState('all');
  const [duties, setDuties] = useState(defaultDuties);
  const [roles, setRoles] = useState(defaultRoles);
  const [busy, setBusy] = useState(false);
  const dragFromRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name || '');
    setSelection(initialSelection(template, myDeptId));
    if (template?.body?.duties && Array.isArray(template.body.duties) && template.body.duties.length >= 2) {
      setDuties(template.body.duties.map(normaliseDuty));
    } else {
      setDuties(defaultDuties());
    }
    if (template?.body?.roles && Array.isArray(template.body.roles) && template.body.roles.length > 0) {
      setRoles([...template.body.roles]);
    } else {
      setRoles(defaultRoles());
    }
  }, [open, template, myDeptId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const N = duties.length;
  const M = roles.length;

  // cell(j, k) = duty index for role j on day k, or null when over-rolled.
  const cell = (j, k) => (j < N ? ((j - k + N) % N) : null);

  // Role-label datalist suggestions — SCOPED to the current department
  // selection. 'all' → every distinct role onboard; a specific dept →
  // distinct roles of crew in that department. null → no suggestions
  // (user hasn't picked a scope yet). Recomputes reactively when the
  // user changes the Departments selection.
  const datalistId = 'rt-role-suggestions';
  const distinctRoles = useMemo(() => {
    if (selection == null) return [];
    const set = new Set();
    for (const c of crew) {
      if (!c.role) continue;
      if (selection === 'all' || c.departmentId === selection) {
        set.add(String(c.role));
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [crew, selection]);

  const updateDuty = (i, d) => setDuties((prev) => prev.map((x, k) => (k === i ? d : x)));
  const addDuty = () => setDuties((prev) => [
    ...prev,
    // Empty label — user types via placeholder. canSave gates on non-empty.
    { _k: tid(), label: '', shift_type: 'duty', start_time: '06:00', end_time: '14:00' },
  ]);
  const removeDuty = (i) => setDuties((prev) => prev.length > 2 ? prev.filter((_, k) => k !== i) : prev);
  const moveDuty = (from, to) => setDuties((prev) => {
    if (from === to || to < 0 || to >= prev.length) return prev;
    const next = [...prev];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  const updateRole = (i, label) => setRoles((prev) => prev.map((x, k) => (k === i ? label : x)));
  const addRole = () => setRoles((prev) => [...prev, `Role ${prev.length + 1}`]);
  const removeRole = (i) => setRoles((prev) => prev.length > 1 ? prev.filter((_, k) => k !== i) : prev);

  const canSave = useMemo(() => {
    if (editingLocked) return false;
    if (!name.trim()) return false;
    if (selection == null) return false;  // user must pick All or a dept
    if (duties.length < 2) return false;
    for (const d of duties) {
      if (!d.label.trim() || !d.shift_type || !d.start_time || !d.end_time) return false;
    }
    if (roles.length < 1) return false;
    for (const r of roles) { if (!String(r || '').trim()) return false; }
    return true;
  }, [name, duties, roles, selection, editingLocked]);

  if (!open) return null;

  const scope = selection === 'all' ? 'vessel' : 'department';
  const departmentId = selection === 'all' ? null : selection;

  const buildBody = () => ({
    duties: duties.map((d) => {
      const sub = subTypeFor(d.shift_type);
      return {
        label: d.label.trim(),
        shift_type: d.shift_type,
        sub_type: sub,
        start_time: d.start_time,
        end_time: d.end_time,
      };
    }),
    roles: roles.map((r) => String(r).trim()),
  });

  const handleSave = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    const body = buildBody();
    const res = isEdit
      ? await updateTemplate(template.id, { name: name.trim(), scope, departmentId, body })
      : await createTemplate({
          name: name.trim(), kind: 'rotation', scope, departmentId, body, vesselId,
        });
    setBusy(false);
    if (!res.ok) {
      onToast?.(`Couldn’t save rotation — ${res.error || 'try again'}`);
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

  // ── Drag-reorder handlers (HTML5) ────────────────────────────────────────
  const onDragStart = (e, i) => {
    dragFromRef.current = i;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* Safari */ }
  };
  const onDragOver = (_e, _i) => { /* preventDefault handled by row to allow drop */ };
  const onDrop = (_e, i) => {
    const from = dragFromRef.current;
    dragFromRef.current = null;
    if (from == null || from === i) return;
    moveDuty(from, i);
  };

  return (
    <>
      <div className="rest-popover-backdrop" onClick={onClose} />
      <div
        className="te-panel rt-panel"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit rotation ${template?.name}` : 'New rotation template'}
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">{isEdit ? 'Edit rotation' : 'New rotation'}</div>
            <h2 className="tp-title">A <em>rotation</em>.</h2>
          </div>
          <button type="button" className="tp-close"
            aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="te-body">
          <label className="te-field">
            <span className="te-field-label">Name</span>
            <input
              type="text" className="te-input"
              placeholder="e.g. Interior 3-stew rotation"
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
                  onChange={() => setSelection((cur) => (cur === 'all' ? null : 'all'))}
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
                      onChange={() => setSelection((cur) => (cur === d.id ? null : d.id))}
                    />
                    <span>{d.name}</span>
                  </label>
                );
              })}
            </div>
            {selection == null && (
              <div className="te-dept-hint">Pick a department or “All departments”.</div>
            )}
          </div>

          {/* ── Section 1: Duties ─────────────────────────────────────── */}
          <div className="te-field">
            <div className="rt-section-head">
              <span className="te-field-label">Duties</span>
              <button type="button" className="v2-btn-ghost rt-add" onClick={addDuty}>
                <Plus size={12} /> Add duty
              </button>
            </div>
            <div className="rt-duty-list">
              {duties.map((d, i) => (
                <DutyRow
                  key={d._k}
                  duty={d}
                  index={i}
                  total={duties.length}
                  distinctTypes={TYPE_PILLS}
                  onChange={(next) => updateDuty(i, next)}
                  onRemove={removeDuty}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onMoveUp={(idx) => moveDuty(idx, idx - 1)}
                  onMoveDown={(idx) => moveDuty(idx, idx + 1)}
                />
              ))}
            </div>
          </div>

          {/* ── Section 2: Cycle info + preview matrix ────────────────── */}
          <div className="rt-info">
            <strong>{N} day{N === 1 ? '' : 's'}</strong>
            <span className="rt-info-dot">·</span>
            <strong>{N} dut{N === 1 ? 'y' : 'ies'}</strong>
            <span className="rt-info-dot">·</span>
            <strong>{M} role slot{M === 1 ? '' : 's'}</strong>
            {M > N && (
              <span className="rt-warn">
                · More roles than duties — extra roles have no duty in this cycle.
              </span>
            )}
            {M < N && (
              <span className="rt-warn">
                · Fewer roles than duties — some duties go uncovered each day.
              </span>
            )}
          </div>

          {/*
            CSS grid (not a <table>): one big grid with (N+1) columns and
            (M+1) rows including header. Avoids the table+display:flex
            interaction that previously collapsed the role column on some
            browsers and made the whole matrix appear missing.
          */}
          <div
            className="rt-matrix"
            style={{ gridTemplateColumns: `minmax(200px, 1.4fr) repeat(${N}, minmax(96px, 1fr))` }}
            role="grid"
            aria-label="Rotation preview matrix"
          >
            <div className="rt-matrix-corner" role="columnheader" />
            {duties.map((_, k) => (
              <div key={`h-${k}`} className="rt-day-h" role="columnheader">
                Day {k + 1}
              </div>
            ))}

            {roles.map((role, j) => (
              <React.Fragment key={`row-${j}`}>
                <div className="rt-role-cell" role="rowheader">
                  <input
                    type="text"
                    className="te-input rt-role-input"
                    list={datalistId}
                    value={role}
                    placeholder={`Role ${j + 1}`}
                    onChange={(e) => updateRole(j, e.target.value)}
                    aria-label={`Role ${j + 1} label`}
                  />
                  <button
                    type="button"
                    className="rt-remove rt-role-remove"
                    aria-label="Remove role"
                    disabled={roles.length <= 1}
                    onClick={() => removeRole(j)}
                  ><Trash2 size={12} /></button>
                </div>
                {duties.map((_, k) => {
                  const di = cell(j, k);
                  if (di == null) {
                    return (
                      <div
                        key={`c-${j}-${k}`}
                        className="rt-cell rt-cell-empty"
                        role="gridcell"
                      >—</div>
                    );
                  }
                  const d = duties[di];
                  const c = TYPE_COLOR[d.shift_type] || '#B4B2A9';
                  return (
                    <div
                      key={`c-${j}-${k}`}
                      className="rt-cell"
                      role="gridcell"
                      style={{ background: c, color: '#F5F1EA' }}
                    >
                      <div className="rt-cell-label">{d.label || 'Duty'}</div>
                      <div className="rt-cell-time">{d.start_time}–{d.end_time}</div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <datalist id={datalistId}>
            {distinctRoles.map((r) => <option key={r} value={r} />)}
          </datalist>

          <button type="button" className="v2-btn-ghost rt-add-role" onClick={addRole}>
            <Plus size={12} /> Add role row
          </button>
        </div>

        <div className="te-footer">
          {isEdit && !editingLocked ? (
            <button
              type="button"
              className="te-delete"
              disabled={busy}
              onClick={handleDelete}
            >Delete rotation</button>
          ) : <span />}
          <div className="te-footer-actions">
            <button type="button" className="v2-btn-ghost"
              onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="v2-btn-filled"
              onClick={handleSave}
              disabled={!canSave || busy}>
              {busy ? 'Saving…' : isEdit ? 'Save rotation' : 'Create rotation'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
