import React, { useEffect } from 'react';
import { Star, X, Pencil } from 'lucide-react';
import { useRotaTemplates } from './useRotaTemplates';

// Cell colours from Phase 1 — the swatch on each simple-template row
// mirrors what the shift would render as on the grid.
const TYPE_COLOR = {
  duty: '#1C1B3A',
  watch: '#C65A1A',
  standby: '#B8935E',
  training: '#6B7F6B',
  medical: '#7A2E1E',
};

function fmtTime(b) {
  const s = b?.start_time ? String(b.start_time).slice(0, 5) : null;
  const e = b?.end_time ? String(b.end_time).slice(0, 5) : null;
  if (s && e) return `${s} – ${e}`;
  return 'No fixed hours';
}

function scopeChipText(t) {
  if (t.scope === 'vessel') return 'All departments';
  return t.departmentName || 'Department';
}

function StarIcon({ filled }) {
  return (
    <Star
      size={16}
      strokeWidth={1.75}
      style={{
        color: filled ? '#C65A1A' : '#8B8478',
        fill: filled ? '#C65A1A' : 'transparent',
      }}
    />
  );
}

function SimpleSwatch({ body }) {
  const c = TYPE_COLOR[body?.shift_type] || '#B4B2A9';
  return <span className="tp-swatch" style={{ background: c }} aria-hidden />;
}

function RotationBadge({ body }) {
  const n = Array.isArray(body?.duties) ? body.duties.length : 0;
  return <span className="tp-rot-badge">{n || '?'}↻</span>;
}

function TemplateRow({ template, onToggleStar, onEdit, onPick }) {
  const t = template;
  const isSimple = t.kind === 'simple';
  return (
    <div className="tp-row">
      <button
        type="button"
        className="tp-star"
        aria-label={t.isStarred ? 'Unstar template' : 'Star template'}
        aria-pressed={t.isStarred}
        onClick={(e) => { e.stopPropagation(); onToggleStar(t.id); }}
      >
        <StarIcon filled={t.isStarred} />
      </button>
      <button
        type="button"
        className="tp-body"
        onClick={() => onPick(t)}
        title="Applying templates ships in Phase 3"
      >
        <span className="tp-emblem">
          {isSimple ? <SimpleSwatch body={t.body} /> : <RotationBadge body={t.body} />}
        </span>
        <span className="tp-meta">
          <span className="tp-name">{t.name}</span>
          <span className="tp-sub">
            <span className="tp-kind">{isSimple ? 'Simple' : 'Rotation'}</span>
            <span className="tp-dot">·</span>
            <span>{scopeChipText(t)}</span>
            {isSimple && (
              <>
                <span className="tp-dot">·</span>
                <span>{fmtTime(t.body)}</span>
              </>
            )}
            {t.isDefault && <span className="tp-default">Default</span>}
          </span>
        </span>
      </button>
      {t.isEditable && (
        <button
          type="button"
          className="tp-edit"
          aria-label={`Edit ${t.name}`}
          onClick={() => onEdit(t)}
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

export default function PatternPicker({ open, onClose, onEdit, onNew, onPick }) {
  const { templates, loading, error, toggleStar } = useRotaTemplates();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="rest-popover-backdrop" onClick={onClose} />
      <div
        className="tp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Templates"
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">Templates</div>
            <h2 className="tp-title">Pick a <em>pattern</em>.</h2>
          </div>
          <div className="tp-header-actions">
            <button type="button" className="v2-btn-ghost"
              onClick={() => onNew?.('simple')}>+ Simple</button>
            <button type="button" className="v2-btn-ghost"
              onClick={() => onNew?.('rotation')}>+ Rotation</button>
            <button type="button" className="tp-close"
              aria-label="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="tp-body-scroll">
          {loading && (
            <div className="tp-state">Loading templates…</div>
          )}
          {!loading && error && (
            <div className="tp-state tp-state-err">Couldn’t load templates: {error}</div>
          )}
          {!loading && !error && templates.length === 0 && (
            <div className="tp-state">
              No templates yet. Use “+ Simple” or “+ Rotation” to create one.
            </div>
          )}
          {!loading && !error && templates.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              onToggleStar={toggleStar}
              onEdit={onEdit}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
    </>
  );
}
