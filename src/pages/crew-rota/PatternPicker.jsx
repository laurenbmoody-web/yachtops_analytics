import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Star, X, Pencil, RefreshCw, ChevronRight } from 'lucide-react';

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

// Shift-pattern slot indicator — same 18px footprint as the simple-shift
// colour swatch so picker rows stay aligned. No count text; the "SHIFT
// PATTERN · …" metadata line carries the meaning.
function PatternIcon() {
  return (
    <span className="tp-pattern-icon" aria-hidden="true">
      <RefreshCw size={12} strokeWidth={2} />
    </span>
  );
}

function TemplateRow({ template, onToggleStar, onEdit, onPick, onToast }) {
  const t = template;
  const isSimple = t.kind === 'simple';
  const handleStar = async (e) => {
    e.stopPropagation();
    const res = await onToggleStar(t.id);
    if (res && res.ok === false) {
      onToast?.(`Couldn’t update star — ${res.error || 'try again'}`);
    }
  };
  return (
    <div className="tp-row">
      <button
        type="button"
        className="tp-star"
        aria-label={t.isStarred ? 'Remove from favourites' : 'Add to favourites'}
        aria-pressed={t.isStarred}
        onClick={handleStar}
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
          {isSimple ? <SimpleSwatch body={t.body} /> : <PatternIcon />}
        </span>
        <span className="tp-meta">
          <span className="tp-name">{t.name}</span>
          <span className="tp-sub">
            <span className="tp-kind">{isSimple ? 'Simple' : 'Shift pattern'}</span>
            <span className="tp-dot">·</span>
            <span>{scopeChipText(t)}</span>
            {isSimple && (
              <>
                <span className="tp-dot">·</span>
                <span>{fmtTime(t.body)}</span>
              </>
            )}
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

function PickerGroup({
  groupKey, name, count, isOpen, onToggle, children,
}) {
  if (count === 0) return null;                 // hide empty groups
  return (
    <div className="tp-group">
      <button
        type="button"
        className="tp-group-head"
        aria-expanded={isOpen}
        aria-controls={`tp-group-${groupKey}`}
        onClick={() => onToggle(groupKey)}
      >
        <ChevronRight
          size={14}
          className={`tp-group-chev${isOpen ? ' is-open' : ''}`}
        />
        <span className="tp-group-name">{name}</span>
        <span className="tp-group-count">{count}</span>
      </button>
      {isOpen && (
        <div id={`tp-group-${groupKey}`} className="tp-group-body">
          {children}
        </div>
      )}
    </div>
  );
}

export default function PatternPicker({
  open, onClose, onEdit, onNew, onPick, onToast,
  templates = [], loading = false, error = null, toggleStar,
  departments = [], myDeptId = null,
}) {
  // Bucket templates by group. `templates` is pre-sorted starred-first,
  // then alphabetical (by useRotaTemplates) — sub-buckets preserve that.
  const groups = useMemo(() => {
    const starred = [];
    const vessel = [];
    const deptMap = new Map();                  // deptId -> { id, name, items }
    for (const t of templates) {
      if (t.isStarred) starred.push(t);
      if (t.scope === 'vessel') {
        vessel.push(t);
      } else if (t.departmentId) {
        let bucket = deptMap.get(t.departmentId);
        if (!bucket) {
          bucket = { id: t.departmentId, name: t.departmentName || 'Department', items: [] };
          deptMap.set(t.departmentId, bucket);
        }
        bucket.items.push(t);
      }
    }
    // Prefer canonical names from the `departments` prop where available
    // (in case a row's join didn't return departmentName).
    for (const d of departments) {
      const b = deptMap.get(d.id);
      if (b) b.name = d.name;
    }
    const deptGroups = Array.from(deptMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    return { starred, deptGroups, vessel };
  }, [templates, departments]);

  // Expanded-group state. Re-initialises every time the picker opens
  // (Favourites auto-expands when present; all department groups —
  // including the user's own — start collapsed). A ref gates the
  // re-init so manual toggles persist while the modal is open. Closing
  // + reopening resets to the auto-expand rule.
  const [expanded, setExpanded] = useState(() => new Set());
  const initRef = useRef(false);
  useEffect(() => {
    if (open && !initRef.current) {
      const next = new Set();
      if (groups.starred.length > 0) next.add('starred');
      setExpanded(next);
      initRef.current = true;
    } else if (!open) {
      initRef.current = false;
    }
  }, [open, groups.starred.length]);

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const renderRow = (t) => (
    <TemplateRow
      key={t.id}
      template={t}
      onToggleStar={toggleStar}
      onEdit={onEdit}
      onPick={onPick}
      onToast={onToast}
    />
  );

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
              onClick={() => onNew?.('rotation')}>+ Shift pattern</button>
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
              No templates yet. Use “+ Simple” or “+ Shift pattern” to create one.
            </div>
          )}

          {!loading && !error && (
            <>
              <PickerGroup
                groupKey="starred"
                name="Favourites"
                count={groups.starred.length}
                isOpen={expanded.has('starred')}
                onToggle={toggle}
              >
                {groups.starred.map(renderRow)}
              </PickerGroup>

              {groups.deptGroups.map((g) => (
                <PickerGroup
                  key={g.id}
                  groupKey={g.id}
                  name={g.name}
                  count={g.items.length}
                  isOpen={expanded.has(g.id)}
                  onToggle={toggle}
                >
                  {g.items.map(renderRow)}
                </PickerGroup>
              ))}

              <PickerGroup
                groupKey="vessel"
                name="Vessel-wide"
                count={groups.vessel.length}
                isOpen={expanded.has('vessel')}
                onToggle={toggle}
              >
                {groups.vessel.map(renderRow)}
              </PickerGroup>
            </>
          )}
        </div>
      </div>
    </>
  );
}
