// Save-hotspot modal — label + layer for a freshly placed pin. Pin colour is
// derived from the layer (see layers.js), not chosen freely; the swatch just
// previews it. Insert errors surface inline — never a silent catch.
import React, { useState } from 'react';
import { LAYERS, layerColor } from '../layers';

export default function HotspotModal({ onSave, onCancel }) {
  const [label, setLabel] = useState('');
  const [layer, setLayer] = useState('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!label.trim() || saving) return;
    setSaving(true);
    setError(null);
    const failure = await onSave({ label: label.trim(), layer });
    if (failure) {
      setError(failure);
      setSaving(false);
    }
  };

  return (
    <div className="vm-modal-overlay" onClick={onCancel}>
      <form className="vm-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <p className="vm-modal-title">New hotspot</p>

        <p className="vm-label">
          Name <span className="vm-label-required">required</span>
        </p>
        <input
          className="vm-input"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Dry store — tinned goods"
          autoFocus
        />

        <p className="vm-label" style={{ marginTop: 18 }}>Layer</p>
        <div className="vm-layer-choices">
          {LAYERS.map((l) => {
            const on = layer === l.key;
            return (
              <button
                key={l.key}
                type="button"
                className={`vm-pill${on ? ' vm-pill-selected' : ''}`}
                style={on ? { background: l.color, borderColor: l.color } : undefined}
                onClick={() => setLayer(l.key)}
              >
                <span className="vm-pill-dot" style={{ background: on ? '#fff' : l.color }} />
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="vm-pin-preview">
          <span className="vm-label" style={{ margin: 0 }}>Preview</span>
          <span className="vm-pin-preview-chip">
            <span className="vm-pin-preview-dot" style={{ background: layerColor(layer) }} />
            <span className="vm-pin-preview-text">{label.trim() || 'Your pin'}</span>
          </span>
        </div>

        {error && <p className="vm-modal-error">{error}</p>}

        <div className="vm-modal-actions">
          <button type="button" className="vm-btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="vm-btn-primary" disabled={!label.trim() || saving}>
            {saving ? 'Saving…' : 'Save hotspot'}
          </button>
        </div>
      </form>
    </div>
  );
}
