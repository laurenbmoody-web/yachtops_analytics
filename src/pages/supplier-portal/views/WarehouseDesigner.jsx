// Warehouse layout designer — the supplier draws their unit and lays out racks.
//
// Two modes. In VIEW mode the floor is read-only and clicking a rack opens its
// head-on section view (for linking products). Press "Edit" → it becomes
// "Save", "Add rack" appears, walls + racks become editable, and clicking a
// rack opens its editor popover. Racks are a base rectangle (len × thick) placed
// at any free angle via an on-rack rotate handle. A rack can be single- or
// double-sided; each side (Front / Back) has its own code, name, zone and bays,
// sharing the same height (levels). Autosaves. Space x:0..100, y:0..60 (square).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Minus, Trash2, X, PenLine, Check, Boxes, Layers, Maximize2, Columns2, RotateCw,
} from 'lucide-react';
import { fetchWarehouseLayout, saveWarehouseLayout } from '../utils/supplierStorage';
import './warehouse-designer.css';

const ZONES = [
  { key: 'ambient', label: 'Ambient', color: '#C65A1A' },
  { key: 'chilled', label: 'Chilled', color: '#2563EB' },
  { key: 'frozen',  label: 'Frozen',  color: '#0E7490' },
];
const ZC = Object.fromEntries(ZONES.map((z) => [z.key, z.color]));
const DEFAULT_LEVELS = { ambient: 4, chilled: 3, frozen: 2 };

const clamp = (min, max, v) => Math.max(min, Math.min(max, v));
const topPct = (y) => (y / 60) * 100;
const rad = (deg) => (deg * Math.PI) / 180;
const centerOf = (r) => ({ cx: r.x + r.len / 2, cy: r.y + r.thick / 2 });

const levelDefs = (n) => {
  const out = [];
  for (let i = n - 1; i >= 1; i -= 1) out.push({ k: String(i), t: `Level ${i}` });
  out.push({ k: 'G', t: 'Ground' });
  return out;
};

const mkFace = (f, fb) => ({
  code: (f?.code ?? fb.code ?? '').toString().toUpperCase(),
  name: f?.name ?? fb.name ?? '',
  zone: f?.zone ?? fb.zone ?? 'ambient',
  bays: clamp(1, 16, f?.bays ?? fb.bays ?? 4),
});
const normalizeRack = (r) => {
  const sides = r.sides === 2 ? 2 : 1;
  const base = { code: r.code ?? r.id, name: r.name ?? '', zone: r.zone ?? 'ambient', bays: r.bays ?? 4 };
  const f0 = mkFace(r.faces?.[0], base);
  const f1 = mkFace(r.faces?.[1], { ...base, code: base.code ? `${base.code}-B` : '', name: '' });
  return {
    id: r.id,
    x: r.x ?? 40, y: r.y ?? 24, len: r.len ?? 28, thick: r.thick ?? 6,
    angle: typeof r.angle === 'number' ? r.angle : (r.orient === 'v' ? 90 : 0),
    levels: clamp(1, 8, r.levels ?? DEFAULT_LEVELS[f0.zone] ?? 3),
    sides,
    faces: sides === 2 ? [f0, f1] : [f0],
  };
};

export default function WarehouseDesigner({ supplierId }) {
  const [shape, setShape] = useState({ points: [[6, 6], [94, 6], [94, 54], [6, 54]] });
  const [racks, setRacks] = useState([]);
  const [sel, setSel] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [modalRack, setModalRack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const roomRef = useRef(null);
  const dragRef = useRef(null);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const l = await fetchWarehouseLayout();
        setShape(l.shape); setRacks((l.racks || []).map(normalizeRack));
      } catch (e) { setError(e.message); }
      finally { setLoading(false); loaded.current = true; }
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return undefined;
    const t = setTimeout(() => {
      saveWarehouseLayout(supplierId, { shape, racks }).catch((e) => setError(e.message));
    }, 500);
    return () => clearTimeout(t);
  }, [shape, racks, supplierId]);

  const selRack = useMemo(() => racks.find((r) => r.id === sel) || null, [racks, sel]);

  const pct = (e) => {
    const rect = roomRef.current.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 60 };
  };
  const clampRack = (r) => ({ ...r, x: clamp(-r.len / 2, 100 - r.len / 2, r.x), y: clamp(-r.thick / 2, 60 - r.thick / 2, r.y) });
  const patchRack = (id, patch) => setRacks((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const patchFace = (id, fi, patch) => setRacks((rs) => rs.map((r) => (r.id === id
    ? { ...r, faces: r.faces.map((f, i) => (i === fi ? { ...f, ...patch } : f)) } : r)));
  const setSides = (id, n) => setRacks((rs) => rs.map((r) => {
    if (r.id !== id) return r;
    if (n === 2) {
      const back = r.faces[1] || { ...r.faces[0], code: r.faces[0].code ? `${r.faces[0].code}-B` : '', name: '' };
      return { ...r, sides: 2, faces: [r.faces[0], back] };
    }
    return { ...r, sides: 1, faces: [r.faces[0]] };
  }));

  useEffect(() => {
    const onMove = (e) => {
      const ds = dragRef.current; if (!ds) return;
      const p = pct(e);
      if (Math.abs(e.clientX - ds.cx0) + Math.abs(e.clientY - ds.cy0) > 4) ds.moved = true;
      if (ds.type === 'rack') {
        setRacks((rs) => rs.map((r) => (r.id === ds.id
          ? clampRack({ ...r, x: Math.round(ds.ox + (p.x - ds.sx)), y: Math.round(ds.oy + (p.y - ds.sy)) }) : r)));
      } else if (ds.type === 'rotate') {
        let a = (Math.atan2(p.y - ds.ccy, p.x - ds.ccx) * 180) / Math.PI + 90;
        a = ((a % 360) + 360) % 360;
        const snapped = Math.round(a / 15) * 15;
        if (Math.abs(a - snapped) < 4) a = snapped % 360;
        setRacks((rs) => rs.map((r) => (r.id === ds.id ? { ...r, angle: Math.round(a) } : r)));
      } else if (ds.type === 'resize') {
        const A = rad(ds.ang), cosA = Math.cos(A), sinA = Math.sin(A);
        setRacks((rs) => rs.map((r) => {
          if (r.id !== ds.id) return r;
          if (ds.which === 'len') {
            const d = (p.x - ds.sx) * cosA + (p.y - ds.sy) * sinA;
            const len = clamp(8, 96, ds.olen + 2 * d);
            return { ...r, len, x: ds.ccx - len / 2, y: ds.ccy - ds.othick / 2 };
          }
          const d = (p.x - ds.sx) * -sinA + (p.y - ds.sy) * cosA;
          const thick = clamp(3, 22, ds.othick + 2 * d);
          return { ...r, thick, x: ds.ccx - ds.olen / 2, y: ds.ccy - thick / 2 };
        }));
      } else if (ds.type === 'vertex') {
        setShape((s) => ({ points: s.points.map((pt, i) => (i === ds.i
          ? [Math.round(clamp(0, 100, p.x)), Math.round(clamp(0, 60, p.y))] : pt)) }));
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  const onRackDown = (e, r) => {
    if (!editMode) return;
    e.stopPropagation();
    const p = pct(e); setSel(r.id);
    dragRef.current = { type: 'rack', id: r.id, sx: p.x, sy: p.y, ox: r.x, oy: r.y, cx0: e.clientX, cy0: e.clientY, moved: false };
  };
  const onRackClick = (r) => { if (!editMode) setModalRack(r); };
  const startRotate = (e, r) => {
    e.stopPropagation();
    const { cx, cy } = centerOf(r);
    dragRef.current = { type: 'rotate', id: r.id, ccx: cx, ccy: cy, cx0: e.clientX, cy0: e.clientY, moved: true };
  };
  const startResize = (e, r, which) => {
    e.stopPropagation();
    const p = pct(e); const { cx, cy } = centerOf(r);
    dragRef.current = { type: 'resize', id: r.id, which, sx: p.x, sy: p.y, olen: r.len, othick: r.thick, ang: r.angle || 0, ccx: cx, ccy: cy, cx0: e.clientX, cy0: e.clientY, moved: true };
  };
  const startVertex = (e, i) => { e.stopPropagation(); dragRef.current = { type: 'vertex', i, cx0: e.clientX, cy0: e.clientY, moved: false }; };

  const nextId = () => { let n = 1; while (racks.some((r) => r.id === `R${n}`)) n += 1; return `R${n}`; };
  const addRack = () => {
    const id = nextId();
    const r = { id, x: 40, y: 24, len: 28, thick: 6, angle: 0, levels: DEFAULT_LEVELS.ambient, sides: 1,
      faces: [{ code: id, name: '', zone: 'ambient', bays: 4 }] };
    setRacks((rs) => [...rs, r]); setSel(id);
  };
  const deleteRack = () => { setRacks((rs) => rs.filter((r) => r.id !== sel)); setSel(null); };

  const addPoint = (i) => setShape((s) => {
    const a = s.points[i], b = s.points[(i + 1) % s.points.length];
    const mid = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
    const pts = [...s.points]; pts.splice(i + 1, 0, mid); return { points: pts };
  });
  const removePoint = (i) => setShape((s) => (s.points.length <= 3 ? s : { points: s.points.filter((_, k) => k !== i) }));

  const clipPath = `polygon(${shape.points.map((p) => `${p[0]}% ${topPct(p[1])}%`).join(', ')})`;
  const polyPts = shape.points.map((p) => `${p[0]},${p[1]}`).join(' ');

  const onRoomDown = (e) => {
    if (!editMode) return;
    const t = e.target;
    if (t === roomRef.current || t.classList?.contains('wd-floor') || t.tagName === 'svg' || t.tagName === 'polygon') setSel(null);
  };

  if (loading) return <div className="wd-loading">Loading your warehouse…</div>;

  return (
    <div className="wd">
      <div className="wd-topline">
        <div className="wd-hero">
          <p className="wd-eyebrow"><span className="dot" />WAREHOUSE<span className="bar" />LAYOUT DESIGNER
            <span className="bar" />{racks.length} RACK{racks.length === 1 ? '' : 'S'}</p>
          <h1 className="wd-headline">WAREHOUSE<span className="p">,</span> <em>designed</em><span className="p">.</span></h1>
        </div>
        <div className="wd-toolbar">
          {editMode && <button className="wd-btn ghost" onClick={addRack}><Plus size={16} /> Add rack</button>}
          <button className="wd-btn primary" onClick={() => { setEditMode((v) => !v); setSel(null); }}>
            {editMode ? <><Check size={16} /> Save</> : <><PenLine size={16} /> Edit</>}
          </button>
        </div>
      </div>

      {error && <div className="wd-error" onClick={() => setError(null)}>{error} <X size={12} /></div>}

      <div className={`wd-roomcard${editMode ? ' editing' : ''}`}>
        <div className="wd-room" ref={roomRef} onPointerDown={onRoomDown}>
          <div className="wd-floor" style={{ clipPath }} />
          <svg className="wd-walls" viewBox="0 0 100 60" preserveAspectRatio="none">
            <polygon points={polyPts} fill="none" stroke="var(--wd-wall)" strokeWidth="2.5"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>

          {racks.map((r) => {
            const front = r.faces[0]; const back = r.faces[1];
            return (
              <div key={r.id}
                className={`wd-rk${sel === r.id ? ' sel' : ''}${!editMode ? ' view' : ''}`}
                style={{ left: `${r.x}%`, top: `${topPct(r.y)}%`, width: `${r.len}%`, height: `${topPct(r.thick)}%`,
                  transform: `rotate(${r.angle || 0}deg)`, '--zc': ZC[front.zone] }}
                title={front.name || front.code}
                onPointerDown={(e) => onRackDown(e, r)} onClick={() => onRackClick(r)}>
                {r.sides === 2 ? (
                  <>
                    <span className="cap dual" style={{ background: `linear-gradient(180deg, ${ZC[front.zone]} 0 50%, ${ZC[back.zone]} 50% 100%)` }} />
                    <span className="wd-dface">
                      <span className="wd-dhalf"><span className="wd-dcode" style={{ transform: `rotate(${-(r.angle || 0)}deg)` }}>{front.code}</span></span>
                      <span className="wd-mid" />
                      <span className="wd-dhalf"><span className="wd-dcode" style={{ transform: `rotate(${-(r.angle || 0)}deg)` }}>{back.code}</span></span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="cap" />
                    <span className="bays">{Array.from({ length: front.bays }, (_, i) => <span key={i} className="b" />)}</span>
                    <span className="lab" style={{ transform: `translate(-50%, -50%) rotate(${-(r.angle || 0)}deg)` }}>{front.code}</span>
                  </>
                )}
              </div>
            );
          })}

          {editMode && selRack && (() => {
            const A = rad(selRack.angle || 0), cosA = Math.cos(A), sinA = Math.sin(A);
            const { cx, cy } = centerOf(selRack);
            const lh = { x: cx + (selRack.len / 2) * cosA, y: cy + (selRack.len / 2) * sinA };
            const th = { x: cx - (selRack.thick / 2) * sinA, y: cy + (selRack.thick / 2) * cosA };
            // rotate knob sits on the top edge, directly opposite the thick resize dot
            const rk = { x: cx + (selRack.thick / 2) * sinA, y: cy - (selRack.thick / 2) * cosA };
            return (
              <>
                <div className="wd-rh" style={{ left: `${lh.x}%`, top: `${topPct(lh.y)}%` }} onPointerDown={(e) => startResize(e, selRack, 'len')} />
                <div className="wd-rh" style={{ left: `${th.x}%`, top: `${topPct(th.y)}%` }} onPointerDown={(e) => startResize(e, selRack, 'thick')} />
                <button className="wd-rotate" style={{ left: `${rk.x}%`, top: `${topPct(rk.y)}%` }} title="Drag to rotate"
                  onPointerDown={(e) => startRotate(e, selRack)}><RotateCw size={13} /></button>
                <RackPopover rack={selRack} onPatchFace={patchFace} onPatch={patchRack} onSides={setSides}
                  onDelete={deleteRack} onHeadOn={() => setModalRack(selRack)} onClose={() => setSel(null)} />
              </>
            );
          })()}

          {editMode && shape.points.map((p, i) => {
            const b = shape.points[(i + 1) % shape.points.length];
            const mid = [(p[0] + b[0]) / 2, (p[1] + b[1]) / 2];
            return (
              <React.Fragment key={i}>
                <div className="wd-vx" style={{ left: `${p[0]}%`, top: `${topPct(p[1])}%` }}
                  onPointerDown={(e) => startVertex(e, i)} onDoubleClick={() => removePoint(i)} title="Drag to move · double-tap to remove" />
                <button className="wd-edge" style={{ left: `${mid[0]}%`, top: `${topPct(mid[1])}%` }} onClick={() => addPoint(i)} title="Add a wall point"><Plus size={11} /></button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {racks.length === 0 && (
        <div className="wd-empty">{editMode
          ? <>Press <strong>Add rack</strong> to place your first one, then click it to set it up.</>
          : <>Press <strong>Edit</strong> to draw your unit and add racks.</>}</div>
      )}

      {modalRack && <HeadOn rack={racks.find((r) => r.id === modalRack.id) || modalRack} onClose={() => setModalRack(null)} />}
    </div>
  );
}

// ── Compact editor popover, anchored next to the selected rack ─────────────────
function RackPopover({ rack, onPatchFace, onPatch, onSides, onDelete, onHeadOn, onClose }) {
  const [fi, setFi] = useState(0);
  const faceIdx = Math.min(fi, rack.faces.length - 1);
  const face = rack.faces[faceIdx];
  const anchorRight = rack.x > 50;
  const below = rack.y < 30;
  const style = { position: 'absolute', zIndex: 40 };
  if (anchorRight) style.right = `${100 - (rack.x + rack.len)}%`; else style.left = `${rack.x}%`;
  if (below) style.top = `calc(${topPct(rack.y + rack.thick)}% + 14px)`; else style.bottom = `calc(${100 - topPct(rack.y)}% + 14px)`;
  return (
    <div className="wd-pop" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="wd-pop-head">
        <span className="wd-pop-title">Rack {rack.faces[0].code}</span>
        <div className="wd-pop-hactions">
          <button onClick={onDelete} title="Delete rack"><Trash2 size={14} /></button>
          <button onClick={onClose} title="Close"><X size={15} /></button>
        </div>
      </div>

      <div className="wd-pop-row">
        <div className="wd-pop-f"><span>Sides</span>
          <div className="wd-seg">
            <button className={`wd-facetab${rack.sides !== 2 ? ' on' : ''}`} onClick={() => { onSides(rack.id, 1); setFi(0); }}>Single</button>
            <button className={`wd-facetab${rack.sides === 2 ? ' on' : ''}`} onClick={() => onSides(rack.id, 2)}>Double</button>
          </div>
        </div>
        <div className="wd-pop-f"><span><Layers size={11} /> Levels <em>(shared)</em></span>
          <div className="wd-step">
            <button onClick={() => onPatch(rack.id, { levels: clamp(1, 8, rack.levels - 1) })} disabled={rack.levels <= 1}><Minus size={13} /></button>
            <span>{rack.levels}</span>
            <button onClick={() => onPatch(rack.id, { levels: clamp(1, 8, rack.levels + 1) })} disabled={rack.levels >= 8}><Plus size={13} /></button>
          </div>
        </div>
      </div>

      {rack.sides === 2 && (
        <div className="wd-facetabs">
          <button className={`wd-facetab${faceIdx === 0 ? ' on' : ''}`} onClick={() => setFi(0)}>Front</button>
          <button className={`wd-facetab${faceIdx === 1 ? ' on' : ''}`} onClick={() => setFi(1)}>Back</button>
        </div>
      )}

      <div className="wd-pop-row">
        <label className="wd-pop-f code"><span>Code</span>
          <input value={face.code} maxLength={8} onChange={(e) => onPatchFace(rack.id, faceIdx, { code: e.target.value.toUpperCase() })} /></label>
        <label className="wd-pop-f name"><span>Name</span>
          <input value={face.name} placeholder="e.g. Dry goods" onChange={(e) => onPatchFace(rack.id, faceIdx, { name: e.target.value })} /></label>
      </div>
      <div className="wd-pop-row">
        <div className="wd-pop-f"><span>Zone</span>
          <div className="wd-pzones">
            {ZONES.map((z) => (
              <button key={z.key} className={`wd-pz${face.zone === z.key ? ' on' : ''}`} style={{ '--zc': z.color }}
                onClick={() => onPatchFace(rack.id, faceIdx, { zone: z.key })} data-label={z.label} aria-label={z.label}><i /></button>
            ))}
          </div>
        </div>
        <div className="wd-pop-f"><span><Boxes size={11} /> Bays</span>
          <div className="wd-step">
            <button onClick={() => onPatchFace(rack.id, faceIdx, { bays: clamp(1, 16, face.bays - 1) })} disabled={face.bays <= 1}><Minus size={13} /></button>
            <span>{face.bays}</span>
            <button onClick={() => onPatchFace(rack.id, faceIdx, { bays: clamp(1, 16, face.bays + 1) })} disabled={face.bays >= 16}><Plus size={13} /></button>
          </div>
        </div>
      </div>
      <button className="wd-pop-headon" onClick={onHeadOn}><Maximize2 size={14} /> Open head-on</button>
    </div>
  );
}

// ── Head-on view of a single rack — for linking products to sections ──────────
function HeadOn({ rack, onClose }) {
  const sidesN = rack.sides === 2 ? 2 : 1;
  const SIDES = sidesN === 2 ? [{ i: 0, t: 'Front' }, { i: 1, t: 'Back' }] : [{ i: 0, t: '' }];
  const [si, setSi] = useState(0);
  const sideIdx = Math.min(si, rack.faces.length - 1);
  const face = rack.faces[sideIdx];
  const [selSlot, setSelSlot] = useState(null);
  const levels = levelDefs(rack.levels);
  const code = face.code || rack.id;
  const totalSections = rack.faces.reduce((s, f) => s + f.bays, 0) * levels.length;
  return (
    <div className="wd-back" onPointerDown={(e) => { if (e.target.classList.contains('wd-back')) onClose(); }}>
      <div className="wd-modal" role="dialog" aria-label={`Rack ${code}`}>
        <div className="wd-mhead">
          <div>
            <div className="wd-mlabel">Rack — head on</div>
            <div className="wd-mcode">{code}{face.name ? <span className="wd-mname"> · {face.name}</span> : null}</div>
            <div className="wd-msub">
              <span className="wd-mchip" style={{ background: `${ZC[face.zone]}1F`, color: ZC[face.zone] }}>
                <i style={{ background: ZC[face.zone] }} />{face.zone}
              </span>
              <span><Boxes size={12} /> {face.bays} bays</span>
              <span><Layers size={12} /> {levels.length} levels</span>
              {sidesN === 2 && <span><Columns2 size={12} /> 2 sides</span>}
              <span>{totalSections} sections</span>
            </div>
          </div>
          <button className="wd-mx" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {sidesN === 2 && (
          <div className="wd-sidetabs">
            {SIDES.map((s) => (
              <button key={s.i} className={sideIdx === s.i ? 'on' : ''} onClick={() => setSi(s.i)}>{s.t} side</button>
            ))}
          </div>
        )}

        <div className="wd-front">
          <div className="wd-fnums" style={{ gridTemplateColumns: `repeat(${face.bays}, 1fr)` }}>
            {Array.from({ length: face.bays }, (_, i) => <span key={i}>Bay {String(i + 1).padStart(2, '0')}</span>)}
          </div>
          {levels.map((l) => (
            <div key={l.k} className="wd-flvl">
              <span className="wd-ftag">{l.t}</span>
              <div className="wd-frow" style={{ gridTemplateColumns: `repeat(${face.bays}, 1fr)` }}>
                {Array.from({ length: face.bays }, (_, bi) => {
                  const sc = `${code}·${String(bi + 1).padStart(2, '0')}·${l.k}`;
                  return (
                    <button key={bi} className={`wd-fs${selSlot === sc ? ' sel' : ''}`} onClick={() => setSelSlot(sc)} title="Link a product">
                      <span className="wd-fc">{sc}</span>
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
            {selSlot ? <>Section <b>{selSlot}</b> — no product linked yet</> : 'Tap a section (＋) to link a product from your catalogue.'}
          </div>
          <button className="wd-mbtn" disabled>Link from catalogue · soon</button>
        </div>
      </div>
    </div>
  );
}
