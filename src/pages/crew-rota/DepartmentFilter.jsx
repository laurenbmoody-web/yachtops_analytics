import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// DepartmentFilter — a multi-select "which departments are shown" control for
// the rota, surfaced to viewers who can see more than one department (COMMAND
// and CHIEF). It EXPANDS departments onto the view additively rather than
// switching between them, so a chief can pull other departments alongside
// their own for context while building the rota.
//
// Props:
//   departments  [{ id, name }]  — the departments present on this rota
//   value        Set<id>         — currently-visible department ids
//   onChange     (Set<id>) => void
//   ownId        id | null       — the viewer's own department. Pinned to the
//                                  top of the list and tagged "you", but still
//                                  toggleable so the viewer can hide it and
//                                  focus solely on another department.
export default function DepartmentFilter({ departments, value, onChange, ownId = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  // Own department first, the rest in their given order.
  const ordered = [...departments].sort((a, b) => {
    if (a.id === ownId) return -1;
    if (b.id === ownId) return 1;
    return 0;
  });

  const total = departments.length;
  const shown = departments.filter((d) => value.has(d.id)).length;
  const allShown = shown === total;
  const label = allShown ? 'All departments' : `${shown} of ${total} departments`;

  const toggle = (id) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id); else next.add(id);
    // Never allow an empty view — keep at least one department selected.
    if (next.size === 0) return;
    onChange(next);
  };

  const setAll = (on) => {
    if (on) { onChange(new Set(departments.map((d) => d.id))); return; }
    // "Just mine" focuses on the viewer's own department (or the first one
    // when there's no own dept), so the grid is never empty.
    const keep = ownId || departments[0]?.id;
    onChange(new Set(keep ? [keep] : []));
  };

  return (
    <div className="crew-rota-deptfilter" ref={ref}>
      <button
        type="button"
        className={`crew-rota-pill${allShown ? '' : ' active'}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose which departments are shown"
      >
        {label}
        <ChevronDown size={12} style={{ marginLeft: 4 }} />
      </button>
      {open && (
        <div className="crew-rota-deptfilter-panel" role="listbox" aria-label="Departments shown">
          <div className="crew-rota-deptfilter-actions">
            <button type="button" onClick={() => setAll(true)}>All</button>
            <span>·</span>
            <button type="button" onClick={() => setAll(false)}>Just mine</button>
          </div>
          {ordered.map((d) => {
            const checked = value.has(d.id);
            const isOwn = d.id === ownId;
            return (
              <button
                key={d.id}
                type="button"
                role="option"
                aria-selected={checked}
                className={`crew-rota-deptfilter-item${checked ? ' is-on' : ''}`}
                onClick={() => toggle(d.id)}
              >
                <span className="crew-rota-deptfilter-check">{checked ? <Check size={12} /> : null}</span>
                <span>{d.name}</span>
                {isOwn && <span className="crew-rota-deptfilter-you">you</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
