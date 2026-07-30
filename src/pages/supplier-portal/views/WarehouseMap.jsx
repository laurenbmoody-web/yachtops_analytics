// Warehouse map — the supplier lays out their storage as zones of bins.
//
// Three temperature zones (Ambient / Chilled / Frozen). Each holds a grid of
// location tiles (a code + optional name + item count). Add / edit / delete a
// tile, and drag to arrange them — the arrangement is the pick-path walking
// order (ambient → chilled → frozen, in the order you set). Products link to a
// location, so picking can show and route by it.

import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, rectSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus, Sun, Thermometer, Snowflake, X, Trash2, GripVertical, Sparkles, Boxes, Route,
} from 'lucide-react';
import {
  fetchWarehouseLocations, fetchLocationItemCounts, createWarehouseLocation,
  updateWarehouseLocation, deleteWarehouseLocation, reorderWarehouseLocations, seedStarterWarehouse,
} from '../utils/supplierStorage';
import './warehouse.css';

const ZONES = [
  { key: 'ambient', label: 'Ambient', hint: 'Dry store · room temp',  Icon: Sun,        color: '#C65A1A', tint: '#FBEFE9' },
  { key: 'chilled', label: 'Chilled', hint: 'Fridge · 1–5 °C',        Icon: Thermometer, color: '#2563EB', tint: '#E8EEFE' },
  { key: 'frozen',  label: 'Frozen',  hint: 'Freezer · below 0 °C',   Icon: Snowflake,   color: '#0E7490', tint: '#E0F2F6' },
];
const zoneMeta = (k) => ZONES.find((z) => z.key === k) || ZONES[0];

// ── One draggable location tile ──────────────────────────────────────────────
function Tile({ loc, count, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: loc.id });
  const z = zoneMeta(loc.zone);
  return (
    <div
      ref={setNodeRef}
      className={`wm-tile${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, borderTopColor: z.color }}
      onClick={() => onEdit(loc)}
    >
      <button className="wm-grip" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} aria-label="Drag to reorder">
        <GripVertical size={13} />
      </button>
      <div className="wm-tile-code">{loc.code}</div>
      {loc.name && <div className="wm-tile-name">{loc.name}</div>}
      <div className="wm-tile-count">
        <Boxes size={11} />{count || 0} item{count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export default function WarehouseMap({ supplierId }) {
  const [locs, setLocs] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, code, name, zone } or null
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    (async () => {
      try {
        const [l, c] = await Promise.all([fetchWarehouseLocations(), fetchLocationItemCounts()]);
        setLocs(l); setCounts(c);
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    })();
  }, []);

  const byZone = useMemo(() => {
    const m = { ambient: [], chilled: [], frozen: [] };
    for (const l of locs) (m[l.zone] || m.ambient).push(l);
    return m;
  }, [locs]);

  const totalItemsPlaced = useMemo(() => locs.reduce((s, l) => s + (counts[l.id] || 0), 0), [locs, counts]);

  // Persist a new global order (ambient → chilled → frozen, each in its order).
  const persistOrder = async (nextByZone) => {
    const ordered = [];
    for (const z of ZONES) ordered.push(...(nextByZone[z.key] || []));
    const withOrder = ordered.map((l, i) => ({ ...l, sort_order: i }));
    setLocs(withOrder);
    try { await reorderWarehouseLocations(withOrder.map((l) => ({ id: l.id, sort_order: l.sort_order, zone: l.zone }))); }
    catch (e) { setError(e.message); }
  };

  const onDragEnd = (zoneKey) => ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const list = byZone[zoneKey];
    const oldIdx = list.findIndex((l) => l.id === active.id);
    const newIdx = list.findIndex((l) => l.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    persistOrder({ ...byZone, [zoneKey]: arrayMove(list, oldIdx, newIdx) });
  };

  const saveLoc = async () => {
    if (!editing?.code?.trim()) { setError('Give the location a code (e.g. A-12).'); return; }
    setBusy(true);
    try {
      if (editing.id) {
        const upd = await updateWarehouseLocation(editing.id, { code: editing.code, name: editing.name, zone: editing.zone });
        setLocs((prev) => prev.map((l) => (l.id === upd.id ? upd : l)));
      } else {
        const created = await createWarehouseLocation(supplierId, { code: editing.code, name: editing.name, zone: editing.zone, sort_order: locs.length });
        setLocs((prev) => [...prev, created]);
      }
      setEditing(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const removeLoc = async () => {
    if (!editing?.id) return;
    if (!window.confirm('Delete this location? Any products stored here become unlocated.')) return;
    try { await deleteWarehouseLocation(editing.id); setLocs((prev) => prev.filter((l) => l.id !== editing.id)); setEditing(null); }
    catch (e) { setError(e.message); }
  };

  const seed = async () => {
    setBusy(true);
    try { setLocs(await seedStarterWarehouse(supplierId)); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (loading) return <div className="wm-loading">Loading your warehouse…</div>;

  return (
    <div className="wm">
      <div className="wm-hero">
        <p className="wm-eyebrow">
          <span className="dot" />WAREHOUSE
          <span className="bar" />{locs.length} LOCATION{locs.length === 1 ? '' : 'S'}
          <span className="bar" />{totalItemsPlaced} ITEM{totalItemsPlaced === 1 ? '' : 'S'} PLACED
        </p>
        <h1 className="wm-headline">WAREHOUSE<span className="p">,</span> <em>mapped</em><span className="p">.</span></h1>
        <p className="wm-lead">
          Lay out where you store things. Add a location for each shelf, rack or fridge, drop it in the
          right temperature zone, and drag to match the order you'd walk them. Picking then shows the
          spot and routes the picker <strong>top&nbsp;to&nbsp;bottom</strong> — ambient first, then chilled, then frozen.
        </p>
      </div>

      {error && <div className="wm-error" onClick={() => setError(null)}>{error} <X size={12} /></div>}

      {locs.length === 0 ? (
        <div className="wm-empty">
          <div className="wm-empty-badge"><Route size={22} /></div>
          <div className="wm-empty-title">No locations yet</div>
          <p>Start with a ready-made layout — a few bins across each zone you can rename — or build your own from scratch.</p>
          <div className="wm-empty-acts">
            <button className="wm-btn primary" onClick={seed} disabled={busy}><Sparkles size={15} /> {busy ? 'Setting up…' : 'Create a starter layout'}</button>
            <button className="wm-btn ghost" onClick={() => setEditing({ code: '', name: '', zone: 'ambient' })}><Plus size={15} /> Add one myself</button>
          </div>
        </div>
      ) : (
        <div className="wm-zones">
          {ZONES.map((z) => (
            <section key={z.key} className="wm-zone" style={{ '--zc': z.color, '--zt': z.tint }}>
              <header className="wm-zone-head">
                <span className="wm-zone-icon"><z.Icon size={15} /></span>
                <div>
                  <div className="wm-zone-label">{z.label}</div>
                  <div className="wm-zone-hint">{z.hint}</div>
                </div>
                <span className="wm-zone-count">{byZone[z.key].length}</span>
              </header>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(z.key)}>
                <SortableContext items={byZone[z.key].map((l) => l.id)} strategy={rectSortingStrategy}>
                  <div className="wm-grid">
                    {byZone[z.key].map((l) => (
                      <Tile key={l.id} loc={l} count={counts[l.id]} onEdit={(loc) => setEditing({ ...loc })} />
                    ))}
                    <button className="wm-add" onClick={() => setEditing({ code: '', name: '', zone: z.key })}>
                      <Plus size={16} /><span>Add location</span>
                    </button>
                  </div>
                </SortableContext>
              </DndContext>
            </section>
          ))}
        </div>
      )}

      {/* Edit / add sheet */}
      {editing && (
        <div className="wm-sheet-back" onClick={() => setEditing(null)}>
          <div className="wm-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Location">
            <div className="wm-sheet-head">
              <div className="wm-sheet-title">{editing.id ? 'Edit location' : 'New location'}</div>
              <button className="wm-sheet-x" onClick={() => setEditing(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <label className="wm-field">
              <span>Code <em>required</em></span>
              <input autoFocus value={editing.code} placeholder="e.g. A-12, COLD-3"
                onChange={(e) => setEditing((s) => ({ ...s, code: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveLoc(); }} />
            </label>
            <label className="wm-field">
              <span>Name <em>optional</em></span>
              <input value={editing.name || ''} placeholder="e.g. Dry goods, Spirits, Dairy"
                onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} />
            </label>

            <div className="wm-field"><span>Temperature zone</span></div>
            <div className="wm-zonepick">
              {ZONES.map((z) => (
                <button key={z.key} className={`wm-zonepick-b${editing.zone === z.key ? ' on' : ''}`}
                  style={{ '--zc': z.color, '--zt': z.tint }}
                  onClick={() => setEditing((s) => ({ ...s, zone: z.key }))}>
                  <z.Icon size={14} />{z.label}
                </button>
              ))}
            </div>

            <div className="wm-sheet-acts">
              {editing.id
                ? <button className="wm-del" onClick={removeLoc}><Trash2 size={14} /> Delete</button>
                : <span />}
              <div className="wm-sheet-acts-r">
                <button className="wm-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button className="wm-btn primary" onClick={saveLoc} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
