// Warehouse layout designer — the supplier draws their unit and lays out racks.
//
// The room is a free-form polygon: drag wall points, add or remove them, make
// any shape. Racks drop onto the floor and can be dragged, rotated (horizontal
// / vertical), resized (longer/shorter, thinner/thicker — longer grows bays)
// and coloured by temperature zone. Click a rack to look at it head-on and see
// its shelves and sections. The whole arrangement saves as you go.
//
// Coordinate space is x:0..100, y:0..60 (the room card keeps that aspect, so a
// unit is square in both axes). Persisted via supplier_warehouse_layout.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, RotateCw, Trash2, X, PenLine, Check, Move, Boxes, Layers,
} from 'lucide-react';
import { fetchWarehouseLayout, saveWarehouseLayout } from '../utils/supplierStorage';
import './warehouse-designer.css';

const ZONES = [
  { key: 'ambient', label: 'Ambient', color: '#C65A1A' },
  { key: 'chilled', label: 'Chilled', color: '#2563EB' },
  { key: 'frozen',  label: 'Frozen',  color: '#0E7490' },
];
const ZC = Object.fromEntries(ZONES.map((z) => [z.key, z.color]));
const LEVELS = { ambient: ['3', '2', '1', 'G'], chilled: ['2', '1', 'G'], frozen: ['1', 'G'] };
const LTXT = { 3: 'Level 3', 2: 'Level 2', 1: 'Level 1', G: 'Ground' };

const clamp = (min, max, v) => Math.max(min, Math.min(max, v));
const dims = (r) => (r.orient === 'h' ? { w: r.len, h: r.thick } : { w: r.thick, h: r.len });
const topPct = (y) => (y / 60) * 100;

export default function WarehouseDesigner({ supplierId }) {
  const [shape, setShape] = useState({ points: [[6, 6], [94, 6], [94, 54], [6, 54]] });
  const [racks, setRacks] = useState([]);
  const [sel, setSel] = useState(null);
  const [editWalls, setEditWalls] = useState(false);
  const [newZone, setNewZone] = useState('ambient');
  const [modalRack, setModalRack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [error, setError] = useState(null);

  const roomRef = useRef(null);
  const dragRef = useRef(null);
  const loaded = useRef(false);

  // ── load ──
  useEffect(() => {
    (async () => {
      try {
        const l = await fetchWarehouseLayout();
        setShape(l.shape); setRacks(l.racks);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); loaded.current = true; }
    })();
  }, []);

  // ── autosave (debounced) ──
  useEffect(() => {
    if (!loaded.current) return;
    setSaveState('saving');
    const t = setTimeout(async () => {
      try { await saveWarehouseLayout(supplierId, { shape, racks }); setSaveState('saved'); }
      catch (e) { setError(e.message); setSaveState('idle'); }
    }, 600);
    return () => clearTimeout(t);
  }, [shape, racks, supplierId]);

  const selRack = useMemo(() => racks.find((r) => r.id === sel) || null, [racks, sel]);

  // pointer → coordinate space
  const pct = (e) => {
    const rect = roomRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 60,
    };
  };

  const clampRack = (r) => {
    const { w, h } = dims(r);
    return { ...r, x: clamp(0, 100 - w, r.x), y: clamp(0, 60 - h, r.y) };
  };

  // ── window drag loop ──
  useEffect(() => {
    const onMove = (e) => {
      const ds = dragRef.current; if (!ds) return;
      const p = pct(e);
      if (Math.abs(e.clientX - ds.cx) + Math.abs(e.clientY - ds.cy) > 4) ds.moved = true;

      if (ds.type === 'rack') {
        setRacks((rs) => rs.map((r) => (r.id === ds.id
          ? clampRack({ ...r, x: Math.round(ds.ox + (p.x - ds.sx)), y: Math.round(ds.oy + (p.y - ds.sy)) })
          : r)));
      } else if (ds.type === 'resize') {
        setRacks((rs) => rs.map((r) => {
          if (r.id !== ds.id) return r;
          const n = { ...r };
          if (ds.which === 'len') {
            const d = r.orient === 'h' ? (p.x - ds.sx) : (p.y - ds.sy);
            const cap = r.orient === 'h' ? 100 - r.x : 60 - r.y;
            n.len = clamp(8, cap, ds.olen + d);
            n.bays = clamp(1, 12, Math.round(n.len / 6));
          } else {
            const d = r.orient === 'h' ? (p.y - ds.sy) : (p.x - ds.sx);
            n.thick = clamp(3, 16, ds.othick + d);
          }
          return clampRack(n);
        }));
      } else if (ds.type === 'vertex') {
        setShape((s) => {
          const pts = s.points.map((pt, i) => (i === ds.i
            ? [Math.round(clamp(0, 100, p.x)), Math.round(clamp(0, 60, p.y))] : pt));
          return { points: pts };
        });
      }
    };
    const onUp = () => {
      const ds = dragRef.current; dragRef.current = null;
      if (!ds) return;
      if (ds.type === 'rack' && !ds.moved) {
        if (sel === ds.id) setModalRack(racks.find((r) => r.id === ds.id));
        else setSel(ds.id);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [sel, racks]);

  const startRackDrag = (e, r) => {
    if (editWalls) return;
    e.stopPropagation();
    const p = pct(e);
    setSel(r.id);
    dragRef.current = { type: 'rack', id: r.id, sx: p.x, sy: p.y, ox: r.x, oy: r.y, cx: e.clientX, cy: e.clientY, moved: false };
  };
  const startResize = (e, r, which) => {
    e.stopPropagation();
    const p = pct(e);
    dragRef.current = { type: 'resize', id: r.id, which, sx: p.x, sy: p.y, olen: r.len, othick: r.thick, cx: e.clientX, cy: e.clientY, moved: true };
  };
  const startVertex = (e, i) => {
    e.stopPropagation();
    dragRef.current = { type: 'vertex', i, cx: e.clientX, cy: e.clientY, moved: false };
  };

  // ── rack ops ──
  const nextId = (zone) => {
    const p = zone[0].toUpperCase(); let n = 1;
    while (racks.some((r) => r.id === p + n)) n += 1;
    return p + n;
  };
  const addRack = () => {
    const id = nextId(newZone);
    const r = clampRack({ id, zone: newZone, orient: 'h', x: 40, y: 24, len: 28, thick: 6, bays: 5 });
    setRacks((rs) => [...rs, r]); setSel(id);
  };
  const rotateRack = () => setRacks((rs) => rs.map((r) => (r.id === sel ? clampRack({ ...r, orient: r.orient === 'h' ? 'v' : 'h' }) : r)));
  const cycleZone = () => setRacks((rs) => rs.map((r) => {
    if (r.id !== sel) return r;
    const order = ZONES.map((z) => z.key);
    return { ...r, zone: order[(order.indexOf(r.zone) + 1) % order.length] };
  }));
  const deleteRack = () => { setRacks((rs) => rs.filter((r) => r.id !== sel)); setSel(null); };

  // ── wall ops ──
  const addPoint = (i) => setShape((s) => {
    const a = s.points[i], b = s.points[(i + 1) % s.points.length];
    const mid = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
    const pts = [...s.points]; pts.splice(i + 1, 0, mid);
    return { points: pts };
  });
  const removePoint = (i) => setShape((s) => (s.points.length <= 3 ? s : { points: s.points.filter((_, k) => k !== i) }));

  const clipPath = `polygon(${shape.points.map((p) => `${p[0]}% ${topPct(p[1])}%`).join(', ')})`;
  const polyPts = shape.points.map((p) => `${p[0]},${p[1]}`).join(' ');

  const onRoomDown = (e) => {
    if (editWalls) return;
    const t = e.target;
    if (t === roomRef.current || t.classList?.contains('wd-floor') || t.tagName === 'svg' || t.tagName === 'polygon') {
      setSel(null);
    }
  };

  if (loading) return <div className="wd-loading">Loading your warehouse…</div>;

  return (
    <div className="wd">
      <div className="wd-hero">
        <p className="wd-eyebrow"><span className="dot" />WAREHOUSE<span className="bar" />LAYOUT DESIGNER
          <span className="bar" />{racks.length} RACK{racks.length === 1 ? '' : 'S'}</p>
        <h1 className="wd-headline">WAREHOUSE<span className="p">,</span> <em>designed</em><span className="p">.</span></h1>
        <p className="wd-lead">
          Draw your unit and lay out the racking. Drag wall points to shape the room, drop racks where they
          really are, and <strong>rotate or resize</strong> each to fit. Click a rack to look at it head-on,
          shelf by shelf.
        </p>
      </div>

      {error && <div className="wd-error" onClick={() => setError(null)}>{error} <X size={12} /></div>}

      {/* toolbar */}
      <div className="wd-toolbar">
        <button className="wd-btn primary" onClick={addRack} disabled={editWalls}><Plus size={15} /> Add rack</button>
        <div className="wd-grp">
          <span className="wd-gl">Zone</span>
          {ZONES.map((z) => (
            <button key={z.key} className={`wd-zc${newZone === z.key ? ' on' : ''}`} title={z.label}
              onClick={() => setNewZone(z.key)} style={{ '--zc': z.color }}><i /></button>
          ))}
        </div>
        <button className={`wd-btn ghost${editWalls ? ' active' : ''}`} onClick={() => { setEditWalls((v) => !v); setSel(null); }}>
          {editWalls ? <><Check size={15} /> Done shaping room</> : <><PenLine size={15} /> Edit room shape</>}
        </button>
        <span className={`wd-save ${saveState}`}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? <>Saved <Check size={12} /></> : ''}
        </span>
      </div>

      {/* legend */}
      <div className="wd-legend">
        {ZONES.map((z) => <span key={z.key} className="lg"><i style={{ background: z.color }} />{z.label}</span>)}
        <span className="wd-hint"><Move size={12} /> {editWalls ? 'Drag wall points · tap ＋ to add · double-tap a point to remove' : 'Drag to move · round handles resize · ⟳ rotates · click a rack to open it'}</span>
      </div>

      {/* the room */}
      <div className={`wd-roomcard${editWalls ? ' editing' : ''}`}>
        <div className="wd-room" ref={roomRef} onPointerDown={onRoomDown}>
          <div className="wd-floor" style={{ clipPath }} />
          <svg className="wd-walls" viewBox="0 0 100 60" preserveAspectRatio="none">
            <polygon points={polyPts} fill="none" stroke="var(--wd-wall)" strokeWidth="2.5"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>

          {/* racks */}
          {racks.map((r) => {
            const { w, h } = dims(r);
            const bays = Array.from({ length: r.bays }, (_, i) => <span key={i} className="b" />);
            return (
              <div key={r.id}
                className={`wd-rk ${r.orient}${sel === r.id ? ' sel' : ''}${editWalls ? ' locked' : ''}`}
                style={{ left: `${r.x}%`, top: `${topPct(r.y)}%`, width: `${w}%`, height: `${topPct(h)}%`, '--zc': ZC[r.zone] }}
                onPointerDown={(e) => startRackDrag(e, r)}>
                <span className="cap" />
                <span className="bays">{bays}</span>
                <span className="lab">{r.id}</span>
              </div>
            );
          })}

          {/* selected rack chrome: toolbar + resize handles */}
          {selRack && !editWalls && (() => {
            const { w, h } = dims(selRack);
            const lenH = selRack.orient === 'h'
              ? { left: selRack.x + w, top: selRack.y + h / 2 }
              : { left: selRack.x + w / 2, top: selRack.y + h };
            const thH = selRack.orient === 'h'
              ? { left: selRack.x + w / 2, top: selRack.y + h }
              : { left: selRack.x + w, top: selRack.y + h / 2 };
            return (
              <>
                <div className="wd-rtb" style={{ left: `${selRack.x}%`, top: `${topPct(selRack.y)}%` }}>
                  <button title="Rotate" onClick={rotateRack}><RotateCw size={14} /></button>
                  <button title="Change zone" onClick={cycleZone}><i className="wd-zdot" style={{ background: ZC[selRack.zone] }} /></button>
                  <span className="sep" />
                  <button title="Delete" onClick={deleteRack}><Trash2 size={14} /></button>
                </div>
                <div className="wd-rh len" style={{ left: `${lenH.left}%`, top: `${topPct(lenH.top)}%`, cursor: selRack.orient === 'h' ? 'ew-resize' : 'ns-resize' }}
                  onPointerDown={(e) => startResize(e, selRack, 'len')} />
                <div className="wd-rh thick" style={{ left: `${thH.left}%`, top: `${topPct(thH.top)}%`, cursor: selRack.orient === 'h' ? 'ns-resize' : 'ew-resize' }}
                  onPointerDown={(e) => startResize(e, selRack, 'thick')} />
              </>
            );
          })()}

          {/* wall editing: vertex + edge handles */}
          {editWalls && shape.points.map((p, i) => {
            const b = shape.points[(i + 1) % shape.points.length];
            const mid = [(p[0] + b[0]) / 2, (p[1] + b[1]) / 2];
            return (
              <React.Fragment key={i}>
                <div className="wd-vx" style={{ left: `${p[0]}%`, top: `${topPct(p[1])}%` }}
                  onPointerDown={(e) => startVertex(e, i)}
                  onDoubleClick={() => removePoint(i)} title="Drag to move · double-tap to remove" />
                <button className="wd-edge" style={{ left: `${mid[0]}%`, top: `${topPct(mid[1])}%` }}
                  onClick={() => addPoint(i)} title="Add a point"><Plus size={11} /></button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {racks.length === 0 && (
        <div className="wd-empty">Your floor is empty — hit <strong>Add rack</strong> to place your first one, then drag it where it lives.</div>
      )}

      {modalRack && <HeadOn rack={modalRack} onClose={() => setModalRack(null)} />}
    </div>
  );
}

// ── Head-on view of a single rack (bays × levels) ──────────────────────────────
function HeadOn({ rack, onClose }) {
  const [selSlot, setSelSlot] = useState(null);
  const levels = (LEVELS[rack.zone] || ['1', 'G']).map((k) => ({ k, t: LTXT[k] }));
  const total = rack.bays * levels.length;
  return (
    <div className="wd-back" onPointerDown={(e) => { if (e.target.classList.contains('wd-back')) onClose(); }}>
      <div className="wd-modal" role="dialog" aria-label={`Rack ${rack.id}`}>
        <div className="wd-mhead">
          <div>
            <div className="wd-mlabel">Rack — head on</div>
            <div className="wd-mcode">{rack.id}</div>
            <div className="wd-msub">
              <span className="wd-mchip" style={{ background: `${ZC[rack.zone]}1F`, color: ZC[rack.zone] }}>
                <i style={{ background: ZC[rack.zone] }} />{rack.zone}
              </span>
              <span><Boxes size={12} /> {rack.bays} bays</span>
              <span><Layers size={12} /> {levels.length} levels</span>
              <span>{total} sections</span>
            </div>
          </div>
          <button className="wd-mx" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="wd-front">
          <div className="wd-fnums" style={{ gridTemplateColumns: `repeat(${rack.bays}, 1fr)` }}>
            {Array.from({ length: rack.bays }, (_, i) => <span key={i}>Bay {String(i + 1).padStart(2, '0')}</span>)}
          </div>
          {levels.map((l) => (
            <div key={l.k} className="wd-flvl">
              <span className="wd-ftag">{l.t}</span>
              <div className="wd-frow" style={{ gridTemplateColumns: `repeat(${rack.bays}, 1fr)` }}>
                {Array.from({ length: rack.bays }, (_, bi) => {
                  const code = `${rack.id}·${String(bi + 1).padStart(2, '0')}·${l.k}`;
                  return (
                    <button key={bi} className={`wd-fs${selSlot === code ? ' sel' : ''}`} onClick={() => setSelSlot(code)}>
                      <span className="wd-fc">{code}</span>
                      <span className="wd-fp">＋</span>
                    </button>
                  );
                })}
              </div>
              <div className="wd-fbeam" />
            </div>
          ))}
        </div>

        <div className="wd-mfoot">
          <div className="wd-minfo">
            {selSlot ? <>Section <b>{selSlot}</b> — empty</> : 'Every section is a bin location. Linking your products to sections comes next.'}
          </div>
          <button className="wd-mbtn" disabled>Assign product · soon</button>
        </div>
      </div>
    </div>
  );
}
