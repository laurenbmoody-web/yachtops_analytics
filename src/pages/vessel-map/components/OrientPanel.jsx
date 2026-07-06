// Orient panel — rotate-90° controls per axis. Controlled and persistence-
// free: the parent owns the draft value and the row write. Used by the map
// page (Straighten scan affordance) and the manage surface's post-upload
// "Stand it upright" step.
import React from 'react';

const HALF_PI = Math.PI / 2;
const norm = (rad) => {
  const twoPi = Math.PI * 2;
  let r = rad % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r < -Math.PI + 1e-9) r += twoPi;
  return +r.toFixed(6);
};

export default function OrientPanel({
  value,                    // {x,y,z} radians
  onChange,                 // (next) => void
  onSave,
  onCancel,
  saving,
  error,
  eyebrow = 'Straighten scan',
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
}) {
  const rotate = (axis, dir) => onChange({
    ...value,
    [axis]: norm((Number(value?.[axis]) || 0) + dir * HALF_PI),
  });

  return (
    <div className="vm-orient-panel">
      <p className="vm-orient-eyebrow">{eyebrow}</p>
      {['x', 'y', 'z'].map((axis) => (
        <div key={axis} className="vm-orient-row">
          <span className="vm-orient-axis">{axis.toUpperCase()}</span>
          <button className="vm-orient-step" onClick={() => rotate(axis, -1)} aria-label={`Rotate ${axis} -90°`}>−90°</button>
          <span className="vm-orient-val">{Math.round((Number(value?.[axis]) || 0) * 180 / Math.PI)}°</span>
          <button className="vm-orient-step" onClick={() => rotate(axis, 1)} aria-label={`Rotate ${axis} +90°`}>+90°</button>
        </div>
      ))}
      {error && <p className="vm-orient-error">{error}</p>}
      <div className="vm-orient-actions">
        <button className="vm-btn-primary vm-orient-save" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : saveLabel}
        </button>
        <button className="vm-btn-ghost vm-orient-cancel" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
