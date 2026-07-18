// Deck-plan layout view — the "full vessel layout". Upload the vessel's General
// Arrangement drawing once, frame each deck's band on it, then place rooms onto
// the plan. Reads/writes via locationsLayoutStorage.
//   Phase 1: GA upload + per-deck framing + rendering each framed deck's plan.
//   Phase 2: drag rooms from the tray onto the plan (writes plan_x/plan_y),
//            markers coloured scanned/not-scanned so the plan doubles as a
//            coverage map, click a scanned room to open it on the vessel map.
//   Phase 4: "Connect rooms" mode — click two dots to link them through a
//            doorway; links render as lines on the plan (vessel_space_links).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getVesselLayout, uploadGaImage, setDeckCrop, setSpacePosition, setSpaceShape, setSpaceCategory, getSpaceLinks, addSpaceLink, removeSpaceLink, autotraceDeck } from '../utils/locationsLayoutStorage';
import { CATEGORIES, categoryColor, categoryFill, inferCategory, normCategory } from '../utils/roomCategories';
import { createZone, createSpace } from '../utils/locationsHierarchyStorage';
import { traceRoom, bboxRect, simplifyClosed, regionInk } from '../utils/deckTrace';
import { segmentDeck, regionAtPoint, regionContour } from '../utils/deckSegment';
import { pdfToPngBlob } from '../utils/pdfRaster';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const clamp01 = (n) => Math.max(0, Math.min(1, n));

// A traced room outline → an SVG path in the 0..100 viewBox of the plan overlay.
// Cubic-Bézier segment where the leaving/arriving handles exist, else a line.
const shapeToPath = (shape) => {
  const nodes = shape?.nodes || [];
  if (nodes.length < 2) return '';
  const P = (n) => `${(n.x * 100).toFixed(2)} ${(n.y * 100).toFixed(2)}`;
  let d = `M ${P(nodes[0])}`;
  const seg = (a, b) => {
    if (a.h2 && b.h1) return ` C ${P(a.h2)} ${P(b.h1)} ${P(b)}`;
    return ` L ${P(b)}`;
  };
  for (let i = 1; i < nodes.length; i += 1) d += seg(nodes[i - 1], nodes[i]);
  if (shape?.closed) { d += seg(nodes[nodes.length - 1], nodes[0]); d += ' Z'; }
  return d;
};

// Centroid of a node ring (for the label + the fallback point).
const centroidOf = (nodes = []) => {
  if (!nodes.length) return null;
  const s = nodes.reduce((acc, n) => ({ x: acc.x + n.x, y: acc.y + n.y }), { x: 0, y: 0 });
  return { x: s.x / nodes.length, y: s.y / nodes.length };
};

// Catmull-Rom → cubic-Bézier handles for a CLOSED ring, so a traced outline
// curves smoothly through the clicked points (hull walls read as curves, not
// straight chords). Tension 1/6 is the standard uniform Catmull-Rom.
const smoothClosed = (pts) => {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    return { x: p.x, y: p.y, h1: { x: p.x - tx, y: p.y - ty }, h2: { x: p.x + tx, y: p.y + ty } };
  });
};

// Loose room-name key for matching AI-read labels to the crew's existing rooms.
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Fold common yacht synonyms so a crew name and the plan label match up
// (Master Cabin ↔ Owner's Cabin, WC/Bathroom/Ensuite ↔ Head, Salon ↔ Saloon).
const NAME_SYNONYMS = { master: 'owner', owners: 'owner', wc: 'head', toilet: 'head', bathroom: 'head', ensuite: 'head', salon: 'saloon', lounge: 'saloon', accomodation: 'accommodation', accom: 'accommodation' };
const matchKey = (s) => normName(s).split(' ').map((w) => NAME_SYNONYMS[w] || w).join(' ').trim();

// Words too generic to signal "same room" (every cabin shares "cabin"). Used to
// decide when to even offer a reconcile row — only when two names share a real,
// specific word, so the panel stays empty unless there's a genuine maybe-dup.
const GENERIC_TOKENS = new Set(['room', 'cabin', 'space', 'area', 'deck', 'guest', 'crew', 'lower', 'upper', 'main', 'the', 'port', 'stbd', 'starboard']);
const sigTokens = (s) => matchKey(s).split(' ').filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
const namesSimilar = (a, b) => { const ta = new Set(sigTokens(a)); return sigTokens(b).some((t) => ta.has(t)); };

// Box aspect of a deck's crop, in true pixels (undistorted).
const boxAspectOf = (crop, dims) => (crop.w * dims.w) / (crop.h * dims.h) || 3;

// Background that paints just the deck's crop of the shared GA image, filling
// its box edge-to-edge (the box carries the crop's aspect, so no stretch/zoom).
function cropBg(crop, url) {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${100 / crop.w}% ${100 / crop.h}%`,
    backgroundPosition: `${crop.w < 1 ? (crop.x / (1 - crop.w)) * 100 : 0}% ${crop.h < 1 ? (crop.y / (1 - crop.h)) * 100 : 0}%`,
    backgroundRepeat: 'no-repeat',
  };
}

const spacesOf = (deck) => (deck.zones || []).flatMap((z) => z.spaces || []);
const isScanned = (space) => space?.scan?.status === 'ready';

// Draw-a-box framing modal over the full GA image.
function FrameEditor({ gaUrl, deckName, initial, onSave, onCancel }) {
  const wrapRef = useRef(null);
  const [rect, setRect] = useState(initial || null);
  const drag = useRef(null);

  const pos = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    };
  };
  const onDown = (e) => { const p = pos(e); drag.current = p; setRect({ x: p.x, y: p.y, w: 0, h: 0 }); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    if (!drag.current) return;
    const p = pos(e); const s = drag.current;
    setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => { drag.current = null; };

  const valid = rect && rect.w > 0.02 && rect.h > 0.02;
  return (
    <div className="dp-modal-overlay" onClick={onCancel}>
      <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
        <p className="dp-modal-title">Frame <em>{deckName}</em> — drag a box around this deck</p>
        <div className="dp-frame-wrap">
          <div ref={wrapRef} className="dp-frame-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            <img src={gaUrl} alt="" draggable="false" />
            {rect && <div className="dp-frame-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
          </div>
        </div>
        <div className="dp-modal-actions">
          <button className="lg-btn-primary" disabled={!valid} onClick={() => onSave(rect)}>Save frame</button>
          <button className="lg-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function DeckPlanView({ decks = [], onAddScan, onReload }) {
  const navigate = useNavigate();
  const onAddScanRef = useRef(onAddScan);
  onAddScanRef.current = onAddScan;
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const [layout, setLayout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [gaDims, setGaDims] = useState(null);
  const [framingDeck, setFramingDeck] = useState(null);
  const [localCrops, setLocalCrops] = useState({});
  const [localPos, setLocalPos] = useState({}); // spaceId -> {x,y} | null (override)
  const [drag, setDrag] = useState(null); // active room drag
  const [ghost, setGhost] = useState(null); // cursor coords while dragging
  const [links, setLinks] = useState([]); // doorway links [{id,a,b}]
  const [linkMode, setLinkMode] = useState(false);
  const [pendingLink, setPendingLink] = useState(null); // {spaceId, deckId} first-picked dot
  const [localShapes, setLocalShapes] = useState({}); // spaceId -> shape | null (override)
  const [localCats, setLocalCats] = useState({}); // spaceId -> category (override for instant recolour)
  const [traceMode, setTraceMode] = useState(false);
  const [tracing, setTracing] = useState(null); // { spaceId, deckId, name, nodes:[{x,y}] } in progress
  const [editing, setEditing] = useState(null); // { spaceId, deckId, name, nodes:[{x,y}] } adjusting an existing outline
  const [editSel, setEditSel] = useState(null); // index of the selected corner while editing
  const editDragRef = useRef(null); // node being dragged while editing
  const snapTargetsRef = useRef([]); // other rooms' corners on this deck, to snap to
  const [smooth, setSmooth] = useState(true); // curve the outline through the points on finish
  const [detecting, setDetecting] = useState(null); // deckId with an AI detect in flight
  const [proposals, setProposals] = useState(null); // { deckId, items:[{name,matchedSpaceId,create,nodes,traced}] }
  const [detectError, setDetectError] = useState(null); // { deckId, message } | null
  const [aiSmooth, setAiSmooth] = useState(false); // AI outlines: straight by default (walls are straight)
  const [applying, setApplying] = useState(false);
  const traceStartRef = useRef(false); // swallow the click that selected the room (no stray node)
  const fileRef = useRef(null);
  const planRefs = useRef({}); // deckId -> plan element (for drop hit-testing)
  const movedRef = useRef(false);
  const dragRef = useRef(null); // active drag info during the gesture (no re-render lag)

  const load = useCallback(async () => {
    const [l, lk] = await Promise.all([getVesselLayout(), getSpaceLinks()]);
    setLayout(l);
    setLinks(lk);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!layout?.gaImageUrl) { setGaDims(null); return; }
    const img = new Image();
    img.onload = () => setGaDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = layout.gaImageUrl;
  }, [layout?.gaImageUrl]);

  // Room drag: window-level tracking, attached synchronously on pointerdown (via
  // dragRef) so the first fast moves aren't lost to a state/render round-trip.
  const onDragMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    setGhost({ x: e.clientX, y: e.clientY });
    if (!movedRef.current && (Math.abs(e.clientX - d.startX) > 4 || Math.abs(e.clientY - d.startY) > 4)) movedRef.current = true;
  }, []);
  const onDragUp = useCallback((e) => {
    const d = dragRef.current;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    dragRef.current = null;
    setDrag(null);
    setGhost(null);
    if (!d) return;
    const moved = movedRef.current;
    movedRef.current = false;
    const rect = planRefs.current[d.deckId]?.getBoundingClientRect();
    const inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!moved) {
      // A click (no real drag) on a placed room: open a scanned room on the
      // map, or start the add-scan flow for one that isn't scanned yet.
      if (d.fromPlaced) {
        if (d.scanId) navigate(`/vessel/map?scan=${d.scanId}`);
        else onAddScanRef.current?.({ id: d.spaceId, name: d.name });
      }
    } else if (inside) {
      applyPos(d.spaceId, clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height));
    } else if (d.fromPlaced) {
      applyPos(d.spaceId, null, null); // dropped off the plan → back to the tray
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, onDragMove]);
  useEffect(() => () => { window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragUp); }, [onDragMove, onDragUp]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    try {
      let toUpload = f;
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      if (isPdf) {
        setRendering(true);
        const blob = await pdfToPngBlob(f);
        setRendering(false);
        if (!blob) throw new Error('Could not render that PDF.');
        toUpload = new File([blob], `${(f.name || 'ga').replace(/\.pdf$/i, '')}.png`, { type: 'image/png' });
      }
      const r = await uploadGaImage(toUpload);
      setLayout((p) => ({ ...(p || {}), ...r }));
    } catch (err) {
      console.error('[deck-plan] GA upload error:', err);
      setUploadError(err?.message || 'Could not upload the drawing.');
    } finally {
      setUploading(false);
      setRendering(false);
    }
  };

  const cropOf = (deck) => (deck.id in localCrops ? localCrops[deck.id] : deck.planCrop) || null;
  const saveCrop = async (deckId, crop) => {
    setLocalCrops((p) => ({ ...p, [deckId]: crop }));
    setFramingDeck(null);
    try { await setDeckCrop(deckId, crop); } catch (err) { console.error('[deck-plan] save crop error:', err); }
  };

  // Room position: local override wins, else the persisted plan_x/plan_y, else null.
  const posOf = (space) => {
    if (space.id in localPos) return localPos[space.id];
    if (space.planX != null && space.planY != null) return { x: space.planX, y: space.planY };
    return null;
  };
  const applyPos = (spaceId, x, y) => {
    setLocalPos((p) => ({ ...p, [spaceId]: x == null ? null : { x, y } }));
    setSpacePosition(spaceId, x, y).catch((err) => console.error('[deck-plan] save position error:', err));
  };

  // ── Room outline tracing ──────────────────────────────────────────────────
  // A room's traced outline: local override wins, else the persisted shape.
  const shapeOf = (space) => (space.id in localShapes ? localShapes[space.id] : space.planShape) || null;
  const saveShape = (spaceId, shape) => {
    setLocalShapes((p) => ({ ...p, [spaceId]: shape }));
    setSpaceShape(spaceId, shape).catch((err) => console.error('[deck-plan] save shape error:', err));
  };
  // Room zoning category: local override wins, else the saved one, else inferred
  // from the room name. Drives the outline/fill colour on the plan.
  const categoryOf = (space) => normCategory((space.id in localCats ? localCats[space.id] : space.planCategory) || inferCategory(space.name));
  const setCategory = (spaceId, cat) => {
    setLocalCats((p) => ({ ...p, [spaceId]: cat }));
    setSpaceCategory(spaceId, cat).catch((err) => console.error('[deck-plan] save category error:', err));
  };
  const startTrace = (space, deck) => { traceStartRef.current = true; setTracing({ spaceId: space.id, deckId: deck.id, name: space.name, nodes: [] }); };
  const addTraceNode = (x, y) => setTracing((t) => (t ? { ...t, nodes: [...t.nodes, { x, y }] } : t));
  const undoTraceNode = () => setTracing((t) => (t && t.nodes.length ? { ...t, nodes: t.nodes.slice(0, -1) } : t));
  const cancelTrace = () => setTracing(null);
  const finishTrace = () => {
    if (!tracing || !tracing.nodes.length) return;
    if (tracing.nodes.length < 3) {
      // Points-only: place the room's point, no outline.
      const p = tracing.nodes[0];
      saveShape(tracing.spaceId, null);
      applyPos(tracing.spaceId, p.x, p.y);
      setTracing(null);
      return;
    }
    const nodes = smooth ? smoothClosed(tracing.nodes) : tracing.nodes;
    saveShape(tracing.spaceId, { closed: true, nodes });
    const c = centroidOf(tracing.nodes); // anchor the point/label at the outline centre
    if (c) applyPos(tracing.spaceId, c.x, c.y);
    setTracing(null);
  };
  const clearShape = (space) => {
    saveShape(space.id, null);
    if (tracing?.spaceId === space.id) setTracing(null);
    if (editing?.spaceId === space.id) setEditing(null);
  };
  const toggleTraceMode = () => { setTracing(null); setEditing(null); setPendingLink(null); setLinkMode(false); setTraceMode((v) => !v); };

  // ── Adjust an existing outline (the AI base, or a hand trace) ──────────────
  // Clicking an already-outlined room in trace mode opens it for point editing:
  // drag corners, click a midpoint to add one, double-click to remove. Beats
  // re-drawing the whole room when the auto-trace just needs a nudge.
  const startEdit = (space, deck) => {
    const sh = shapeOf(space);
    traceStartRef.current = true;
    setTracing(null);
    setEditSel(null);
    // Snap targets: every OTHER outlined room's corners on this deck, so shared
    // walls meet cleanly. (Own neighbours handle straightening, added at drag.)
    const targets = [];
    spacesOf(deck).forEach((s) => {
      if (s.id === space.id) return;
      (shapeOf(s)?.nodes || []).forEach((n) => targets.push({ x: n.x, y: n.y }));
    });
    snapTargetsRef.current = targets;
    setEditing({ spaceId: space.id, deckId: deck.id, name: space.name, nodes: (sh?.nodes || []).map((n) => ({ x: n.x, y: n.y })) });
  };
  // Drag a corner, snapping for clean lines: to a nearby other-room corner
  // (shared walls join), else axis-align to a neighbour/other corner's x or y
  // (walls go straight/flush). Hold Alt to move freely without snapping.
  const onEditNodeMove = useCallback((e) => {
    const d = editDragRef.current;
    if (!d) return;
    const rect = planRefs.current[d.deckId]?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const free = e.altKey;
    setEditing((ed) => {
      if (!ed) return ed;
      const n = ed.nodes.length;
      const i = d.index;
      const pxv = (nx) => nx * rect.width;
      const pyv = (ny) => ny * rect.height;
      let snapX = null;
      let snapY = null;
      if (!free) {
        const targets = snapTargetsRef.current || [];
        // 1) vertex snap — nearest other-room corner within ~11px
        let best = null;
        let bestD = 11;
        for (const t of targets) {
          const dd = Math.hypot(pxv(t.x) - mx, pyv(t.y) - my);
          if (dd < bestD) { bestD = dd; best = t; }
        }
        if (best) { snapX = best.x; snapY = best.y; }
        else {
          // 2) axis-align x or y to a neighbour or another corner within ~7px
          const prev = ed.nodes[(i - 1 + n) % n];
          const next = ed.nodes[(i + 1) % n];
          const AX = 7;
          const xC = [prev.x, next.x, ...targets.map((t) => t.x)];
          const yC = [prev.y, next.y, ...targets.map((t) => t.y)];
          for (const c of xC) { if (Math.abs(pxv(c) - mx) < AX) { snapX = c; break; } }
          for (const c of yC) { if (Math.abs(pyv(c) - my) < AX) { snapY = c; break; } }
        }
      }
      const x = clamp01(snapX != null ? snapX : mx / rect.width);
      const y = clamp01(snapY != null ? snapY : my / rect.height);
      return { ...ed, nodes: ed.nodes.map((nd, idx) => (idx === i ? { x, y } : nd)) };
    });
  }, []);
  const onEditNodeUp = useCallback(() => {
    editDragRef.current = null;
    window.removeEventListener('pointermove', onEditNodeMove);
    window.removeEventListener('pointerup', onEditNodeUp);
  }, [onEditNodeMove]);
  const onEditNodeDown = (e, i, deck) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    setEditSel(i); // clicking a corner selects it (so Delete point / ⌫ can remove it)
    editDragRef.current = { index: i, deckId: deck.id };
    window.addEventListener('pointermove', onEditNodeMove);
    window.addEventListener('pointerup', onEditNodeUp);
  };
  const insertEditNode = (e, afterIdx, x, y) => {
    e.preventDefault(); e.stopPropagation();
    setEditing((ed) => {
      if (!ed) return ed;
      const nodes = ed.nodes.slice();
      nodes.splice(afterIdx + 1, 0, { x, y });
      return { ...ed, nodes };
    });
    setEditSel(afterIdx + 1);
  };
  const deleteNodeAt = (i) => {
    setEditing((ed) => (ed && i != null && ed.nodes.length > 3 ? { ...ed, nodes: ed.nodes.filter((_, idx) => idx !== i) } : ed));
    setEditSel(null);
  };
  const deleteEditNode = (e, i) => { e.preventDefault(); e.stopPropagation(); deleteNodeAt(i); };
  const simplifyEdit = () => setEditing((ed) => (ed && ed.nodes.length > 4 ? { ...ed, nodes: simplifyClosed(ed.nodes, 0.012) } : ed));
  const saveEdit = () => {
    if (!editing || editing.nodes.length < 3) { setEditing(null); setEditSel(null); return; }
    saveShape(editing.spaceId, { closed: true, nodes: editing.nodes });
    const c = centroidOf(editing.nodes);
    if (c) applyPos(editing.spaceId, c.x, c.y);
    setEditing(null); setEditSel(null);
  };
  const cancelEdit = () => { setEditing(null); setEditSel(null); };
  // Bin the whole outline (e.g. the AI traced something that isn't a room). Keeps
  // the room's point/pin; use the room list to remove the room itself.
  const deleteOutline = () => {
    if (!editing) return;
    saveShape(editing.spaceId, null);
    setEditing(null); setEditSel(null);
  };
  const retraceFromEdit = () => {
    if (!editing) return;
    const e = editing;
    setEditing(null); setEditSel(null);
    traceStartRef.current = true;
    setTracing({ spaceId: e.spaceId, deckId: e.deckId, name: e.name, nodes: [] });
  };
  useEffect(() => () => { window.removeEventListener('pointermove', onEditNodeMove); window.removeEventListener('pointerup', onEditNodeUp); }, [onEditNodeMove, onEditNodeUp]);
  // Delete/Backspace removes the selected corner while adjusting an outline.
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && editSel != null) { e.preventDefault(); deleteNodeAt(editSel); }
      if (e.key === 'Escape') cancelEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editSel]);
  const startDrag = (e, space, deck, fromPlaced) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    movedRef.current = false;
    const info = { spaceId: space.id, deckId: deck.id, name: space.name, scanId: isScanned(space) ? space.scan.id : null, fromPlaced, startX: e.clientX, startY: e.clientY };
    dragRef.current = info;
    setDrag(info);
    setGhost({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  };

  const linkExists = (a, b) => links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

  // In "Connect rooms" mode a dot press picks endpoints instead of dragging;
  // in "Trace" mode it starts tracing that room's outline.
  const onDotDown = (e, space, deck, fromPlaced) => {
    if (traceMode) {
      e.preventDefault();
      // Already outlined → adjust its points; otherwise trace a fresh outline.
      if (shapeOf(space)) startEdit(space, deck); else startTrace(space, deck);
      return;
    }
    if (!linkMode) { startDrag(e, space, deck, fromPlaced); return; }
    e.preventDefault();
    if (!pendingLink) { setPendingLink({ spaceId: space.id, deckId: deck.id }); return; }
    if (pendingLink.spaceId === space.id) { setPendingLink(null); return; } // toggle off
    const a = pendingLink.spaceId; const b = space.id;
    setPendingLink(null);
    if (linkExists(a, b)) return;
    addSpaceLink(a, b)
      .then((row) => setLinks((p) => (p.some((l) => l.id === row.id) ? p : [...p, row])))
      .catch((err) => console.error('[deck-plan] add link error:', err));
  };

  const deleteLink = (linkId) => {
    setLinks((p) => p.filter((l) => l.id !== linkId));
    removeSpaceLink(linkId).catch((err) => console.error('[deck-plan] remove link error:', err));
  };

  const toggleLinkMode = () => { setPendingLink(null); setTraceMode(false); setTracing(null); setLinkMode((v) => !v); };

  // Click on the plan while tracing → drop the next outline node (in deck-crop
  // 0..1 space). Clicking near the first node closes + saves the shape.
  const onPlanClick = (e, deck) => {
    if (!traceMode || !tracing || tracing.deckId !== deck.id) return;
    if (traceStartRef.current) { traceStartRef.current = false; return; } // the room-select click
    if (e.target.closest?.('.dp-pin')) return; // a pin click starts/switches tracing, not a node
    const rect = planRefs.current[deck.id]?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    if (tracing.nodes.length >= 3) {
      const first = tracing.nodes[0];
      const dx = (x - first.x) * rect.width; const dy = (y - first.y) * rect.height;
      if (Math.hypot(dx, dy) < 12) { finishTrace(); return; } // clicked the start dot → close
    }
    addTraceNode(x, y);
  };

  // ── AI room detection ─────────────────────────────────────────────────────
  // Load the GA once, render the deck's band to a high-res canvas for the pixel
  // tracing, and hand back a cropSub() that cuts any sub-strip [x0,x1] of the
  // deck to a model JPEG — so a long deck can be read in strips for precision.
  const prepareDeck = (crop) => new Promise((resolve, reject) => {
    if (!crop || !layout?.gaImageUrl) { reject(new Error('No deck image to read.')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sx = crop.x * img.naturalWidth;
      const sy = crop.y * img.naturalHeight;
      const sw = Math.max(1, crop.w * img.naturalWidth);
      const sh = Math.max(1, crop.h * img.naturalHeight);
      // High-res trace canvas → imageData for the flood-fill (walls hold better).
      const tScale = Math.min(1, 2800 / Math.max(sw, sh));
      const cw = Math.max(1, Math.round(sw * tScale));
      const ch = Math.max(1, Math.round(sh * tScale));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      let imageData;
      try { imageData = ctx.getImageData(0, 0, cw, ch); } catch (e) { reject(e); return; }
      // Crop deck sub-strip [x0,x1] (0..1 within the deck), full height, to a
      // model JPEG. A narrow strip fills the model's frame → more pixels per room.
      const cropSub = (x0, x1, cap = 1568) => {
        const ssx = (crop.x + x0 * crop.w) * img.naturalWidth;
        const ssw = Math.max(1, (x1 - x0) * crop.w * img.naturalWidth);
        const scale = Math.min(1, cap / Math.max(ssw, sh));
        const w = Math.max(1, Math.round(ssw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, ssx, sy, ssw, sh, 0, 0, w, h);
        return c.toDataURL('image/jpeg', 0.85).split(',')[1];
      };
      resolve({ imageData, cropSub });
    };
    img.onerror = () => reject(new Error('Could not load the drawing.'));
    img.src = layout.gaImageUrl;
  });

  // Match an AI-read label to one of this deck's existing rooms: exact key first,
  // then a contained-name fallback ("Master" ↔ "Master Cabin"). Synonyms fold the
  // classic yacht mismatches (Master↔Owner, WC/Bathroom↔Head) so a crew name and
  // the plan label meet. One room each.
  const matchSpaceId = (name, spaces, used) => {
    const k = matchKey(name);
    if (!k) return null;
    let s = spaces.find((sp) => matchKey(sp.name) === k && !used.has(sp.id));
    if (!s && k.length >= 4) {
      s = spaces.find((sp) => {
        if (used.has(sp.id)) return false;
        const n = matchKey(sp.name);
        return n.length >= 4 && (n.includes(k) || k.includes(n));
      });
    }
    return s?.id || null;
  };

  const detectRooms = async (deck) => {
    const crop = cropOf(deck);
    if (!crop || !gaDims || detecting) return;
    setDetectError(null);
    setProposals(null);
    setTracing(null);
    setDetecting(deck.id);
    try {
      const { imageData, cropSub } = await prepareDeck(crop);
      const spaces = spacesOf(deck);
      const names = spaces.map((s) => s.name);
      // Long/dense decks: read in overlapping strips so the model can pinpoint
      // each packed cabin, instead of squinting at the whole thin deck at once.
      const aspect = (crop.w * gaDims.w) / (crop.h * gaDims.h) || 3;
      const segN = Math.max(1, Math.min(4, Math.round(aspect / 2.6)));
      let rooms;
      if (segN <= 1) {
        rooms = await autotraceDeck({ imageBase64: cropSub(0, 1), deckName: deck.name, roomNames: names });
      } else {
        const ov = 0.06;
        const segs = [];
        for (let k = 0; k < segN; k += 1) segs.push([Math.max(0, k / segN - ov), Math.min(1, (k + 1) / segN + ov)]);
        const perSeg = await Promise.all(segs.map(([a, b]) =>
          autotraceDeck({ imageBase64: cropSub(a, b), deckName: deck.name, roomNames: names })
            .then((rs) => rs.map((r) => ({ r, a, b })))
            .catch(() => [])));
        // Remap each strip's seed/bbox back to full-deck 0..1; dedupe by name,
        // keeping the reading whose seed sits most centrally in its strip.
        const byName = new Map();
        perSeg.flat().forEach(({ r, a, b }) => {
          if (!r.seed) return;
          const wdt = b - a;
          const central = Math.min(r.seed.x, 1 - r.seed.x); // within-strip centrality
          const key = normName(r.name);
          const cur = byName.get(key);
          if (cur && cur.central >= central) return;
          byName.set(key, {
            name: r.name,
            confidence: r.confidence,
            central,
            seed: { x: a + r.seed.x * wdt, y: r.seed.y },
            bbox: r.bbox ? { x: a + r.bbox.x * wdt, y: r.bbox.y, w: r.bbox.w * wdt, h: r.bbox.h } : null,
          });
        });
        rooms = [...byName.values()];
      }
      if (!rooms.length) { setDetectError({ deckId: deck.id, message: 'No rooms could be read from this deck. Try reframing it tighter around the plan.' }); return; }
      // Segment the whole deck into enclosed wall-regions once — the accurate
      // path: hang each read name on the region its seed falls in, so the outline
      // is the true wall boundary (tolerant of a loose seed). Flood-fill/box only
      // as a fallback when a seed doesn't land in a usable region.
      const seg = segmentDeck(imageData);
      const usedRegions = new Set();
      const used = new Set();
      let offPlan = 0;
      const items = rooms.map((r) => {
        let nodes = null;
        const region = regionAtPoint(seg, r.seed.x, r.seed.y);
        if (region && !usedRegions.has(region.id)) {
          nodes = regionContour(seg, region);
          if (nodes) usedRegions.add(region.id);
        }
        if (!nodes) {
          // Fallback: flood-fill the seed, else the model's box.
          const traced = traceRoom(imageData, r.seed, r.bbox);
          nodes = traced || bboxRect(r.bbox) || null;
          if (!nodes) return null;
          // Only the fallback path can land off the drawing — guard it (a real
          // region is by definition on the plan).
          const xs = nodes.map((n) => n.x);
          const ys = nodes.map((n) => n.y);
          const nb = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          const seedBox = { x: r.seed.x - 0.028, y: r.seed.y - 0.06, w: 0.056, h: 0.12 };
          if (regionInk(imageData, nb) < 0.02 || regionInk(imageData, seedBox) < 0.03) { offPlan += 1; return null; }
        }
        const matchedSpaceId = matchSpaceId(r.name, spaces, used);
        if (matchedSpaceId) used.add(matchedSpaceId);
        return { name: r.name, matchedSpaceId, create: !matchedSpaceId, nodes, traced: true };
      }).filter(Boolean);
      if (!items.length) { setDetectError({ deckId: deck.id, message: 'Rooms were read but none sat on the plan. Try reframing the deck tighter around the drawing.' }); return; }
      if (offPlan) console.info(`[deck-plan] dropped ${offPlan} off-plan detection(s)`);
      setProposals({ deckId: deck.id, items });
    } catch (err) {
      console.error('[deck-plan] detect error:', err);
      setDetectError({ deckId: deck.id, message: err?.message || 'Could not detect rooms on this deck.' });
    } finally {
      setDetecting(null);
    }
  };

  // Reconcile a read name to an existing room (or back to "create new"), so a
  // plan label the crew named differently doesn't spawn a duplicate.
  const setItemAssign = (idx, spaceId) => {
    setProposals((p) => (p ? { ...p, items: p.items.map((it, i) => (i === idx ? { ...it, assignTo: spaceId || null } : it)) } : p));
  };

  // Land every proposal: create the new rooms (unmatched labels) under the deck,
  // then write each outline + centre point onto its room. Reloads the gallery so
  // freshly-created rooms appear.
  const applyProposals = async (deck) => {
    if (!proposals || applying) return;
    setApplying(true);
    try {
      // A space needs a parent zone — use the deck's first zone, or make one.
      let zoneId = deck.zones?.[0]?.id || null;
      // "assignTo" (crew mapped a read name to an existing room) counts as matched,
      // not a create — that's how we avoid duplicate rooms.
      const needsCreate = proposals.items.some((it) => it.create && !it.assignTo);
      if (needsCreate && !zoneId) {
        const z = await createZone(deck.id, 'General');
        zoneId = z.id;
      }
      for (const it of proposals.items) {
        let spaceId = it.matchedSpaceId || it.assignTo || null;
        if (!spaceId && it.create) {
          try {
            const sp = await createSpace(zoneId, it.name);
            spaceId = sp.id;
          } catch (err) {
            console.error('[deck-plan] create room failed:', it.name, err);
            continue; // e.g. RLS (crew) — skip, leave the rest
          }
        }
        if (!spaceId) continue;
        const nodes = aiSmooth ? smoothClosed(it.nodes) : it.nodes;
        await setSpaceShape(spaceId, { closed: true, nodes }).catch((e) => console.error('[deck-plan] shape save', e));
        const c = centroidOf(it.nodes);
        if (c) await setSpacePosition(spaceId, c.x, c.y).catch((e) => console.error('[deck-plan] pos save', e));
      }
      setProposals(null);
      if (needsCreate) await onReloadRef.current?.(); // pull in the new rooms
    } catch (err) {
      console.error('[deck-plan] apply proposals error:', err);
      setDetectError({ deckId: deck.id, message: err?.message || 'Could not apply the outlines.' });
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <div className="dp-loading">Loading the layout…</div>;

  const hidden = (
    <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={onFile} />
  );

  if (!layout?.gaImagePath) {
    return (
      <div className="dp">
        {hidden}
        <div className="dp-upload">
          <div className="dp-upload-art" aria-hidden="true">
            <svg viewBox="0 0 120 74" fill="none"><rect x="1" y="1" width="118" height="72" rx="8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" opacity=".5" /><path d="M40 47l14-16 11 13 8-9 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="44" cy="26" r="4" stroke="currentColor" strokeWidth="1.6" /></svg>
          </div>
          <p className="dp-upload-title">Upload your General Arrangement</p>
          <p className="dp-upload-sub">A deck-plan drawing — a PDF (best) or an image. You’ll frame each deck on it, then place rooms.</p>
          <button className="lg-btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>{rendering ? 'Rendering PDF…' : uploading ? 'Uploading…' : 'Upload drawing'}</button>
          {uploadError && <p className="dp-error">{uploadError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="dp">
      {hidden}
      <div className="dp-toolbar">
        <div className="dp-legend">
          {CATEGORIES.map((c) => (
            <span className="dp-legend-item" key={c.id}><span className="dp-swatch" style={{ background: c.color }} /> {c.label}</span>
          ))}
        </div>
        <button className="lg-btn sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{rendering ? 'Rendering PDF…' : uploading ? 'Uploading…' : 'Replace drawing'}</button>
      </div>
      {uploadError && <p className="dp-error">{uploadError}</p>}

      {decks.map((deck) => {
        const crop = cropOf(deck);
        const spaces = spacesOf(deck);
        const placed = spaces.filter((s) => posOf(s));
        const unplaced = spaces.filter((s) => !posOf(s));
        // Links whose both endpoints are placed on THIS deck (drawable as lines).
        const posById = Object.fromEntries(placed.map((s) => [s.id, posOf(s)]));
        const deckLinks = links.filter((l) => posById[l.a] && posById[l.b]);
        const deckProps = proposals?.deckId === deck.id ? proposals : null;
        // Focus mode: while tracing/adjusting a room on this deck, hide the other
        // outlines + doorway lines and dim the other pins so the work stands out.
        const focusMode = (tracing?.deckId === deck.id) || (editing?.deckId === deck.id);
        return (
          <div className="dp-deck" key={deck.id}>
            <div className="dp-deckhdr">
              <span className="dp-dn">{deck.name}</span>
              <span className="dp-dc">{deck.spaceCount} {deck.spaceCount === 1 ? 'space' : 'spaces'}</span>
              <span className="dp-spring" />
              {crop && gaDims && (
                <button
                  className={`dp-linkbtn ${linkMode ? 'is-on' : ''}`}
                  onClick={toggleLinkMode}
                  title="Connect rooms through doorways"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="dp-linkbtn-label">{linkMode ? 'Done linking' : 'Connect rooms'}</span>
                </button>
              )}
              {crop && gaDims && (
                <button
                  className={`dp-linkbtn ${traceMode ? 'is-on' : ''}`}
                  onClick={toggleTraceMode}
                  title="Trace room outlines on the plan"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l8 5v8l-8 5-8-5V8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="3" r="1.4" fill="currentColor" /><circle cx="20" cy="8" r="1.4" fill="currentColor" /><circle cx="4" cy="8" r="1.4" fill="currentColor" /></svg>
                  <span className="dp-linkbtn-label">{traceMode ? 'Done tracing' : 'Trace rooms'}</span>
                </button>
              )}
              {crop && gaDims && (
                <button
                  className="dp-linkbtn dp-aibtn"
                  onClick={() => detectRooms(deck)}
                  disabled={detecting === deck.id}
                  title="Let Claude read this deck and propose room outlines"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                  <span className="dp-linkbtn-label">{detecting === deck.id ? 'Reading plan…' : 'Detect rooms'}</span>
                </button>
              )}
              {/* When unframed, the big "Frame this deck" box below is the single
                  call-to-action; only offer Reframe once it's framed. */}
              {crop && <button className="lg-btn sm" onClick={() => setFramingDeck(deck)}>Reframe</button>}
            </div>

            {linkMode && crop && gaDims && (
              <p className="dp-linkhint">{pendingLink ? 'Now click the room it connects to (or the same dot again to cancel).' : 'Click two rooms to link them through a doorway. Click a line to remove it.'}</p>
            )}

            {traceMode && crop && gaDims && (
              <div className="dp-tracehint">
                {editing && editing.deckId === deck.id ? (
                  <>
                    <span className="dp-adjhdr">Adjusting <em>{editing.name}</em> · <b>{editing.nodes.length}</b> pts <span className="dp-hint-faint" title="Drag a corner to move · click a + midpoint to add · click a corner then Delete/⌫ to remove · hold Alt to move without snapping">drag · + add · ⌫ remove</span></span>
                    <span className="dp-cat-pick" role="group" aria-label="Room category">
                      {(() => {
                        const eSpace = spaces.find((s) => s.id === editing.spaceId) || { id: editing.spaceId, name: editing.name };
                        const cur = categoryOf(eSpace);
                        return CATEGORIES.map((c) => (
                          <button
                            key={c.id}
                            className={`dp-cat-chip ${cur === c.id ? 'is-on' : ''}`}
                            onClick={() => setCategory(editing.spaceId, c.id)}
                            title={`Colour this room as ${c.label}`}
                          >
                            <span className="dp-cat-dot" style={{ background: c.color }} />{c.label}
                          </button>
                        ));
                      })()}
                    </span>
                    <span className="dp-spring" />
                    <button className="lg-btn sm" disabled={editing.nodes.length <= 4} onClick={simplifyEdit} title="Reduce the number of corners">Simplify</button>
                    <button className="lg-btn sm" disabled={editSel == null || editing.nodes.length <= 3} onClick={() => deleteNodeAt(editSel)}>Delete point</button>
                    <button className="lg-btn-primary sm" onClick={saveEdit}>Save</button>
                    <button className="lg-btn sm" onClick={retraceFromEdit}>Re-trace</button>
                    <button className="lg-btn sm dp-btn-danger" onClick={deleteOutline} title="Remove this outline entirely (keeps the room)">Delete outline</button>
                    <button className="lg-btn sm" onClick={cancelEdit}>Cancel</button>
                  </>
                ) : tracing && tracing.deckId === deck.id ? (
                  <>
                    <span>Tracing <em>{tracing.name}</em> — click to add points, click the first point to close. <b>{tracing.nodes.length}</b> pts.</span>
                    <span className="dp-spring" />
                    <button
                      className={`dp-smooth-toggle ${smooth ? 'is-on' : ''}`}
                      onClick={() => setSmooth((v) => !v)}
                      title="Curve the outline through the points (off = straight edges)"
                    >{smooth ? 'Curved' : 'Straight'}</button>
                    <button className="lg-btn sm" disabled={!tracing.nodes.length} onClick={finishTrace}>Finish</button>
                    <button className="lg-btn sm" disabled={!tracing.nodes.length} onClick={undoTraceNode}>Undo point</button>
                    <button className="lg-btn sm" onClick={cancelTrace}>Cancel</button>
                  </>
                ) : (
                  <span>Click a room to trace its outline, or click an outlined room to adjust its corners. Points-only? Click one node and Finish.</span>
                )}
              </div>
            )}

            {detectError?.deckId === deck.id && !deckProps && (
              <p className="dp-error">{detectError.message}</p>
            )}

            {deckProps && (() => {
              const total = deckProps.items.length;
              const newCount = deckProps.items.filter((i) => i.create && !i.assignTo).length;
              const matchCount = total - newCount; // auto-matched + reconciled-to-existing
              const matchedIds = new Set(deckProps.items.filter((i) => i.matchedSpaceId).map((i) => i.matchedSpaceId));
              const baseCandidates = spaces.filter((s) => !shapeOf(s) && !matchedIds.has(s.id));
              // Only offer a reconcile row where a read name plausibly IS an existing
              // room (shares a specific word) — otherwise it's genuinely new, no row.
              const candidatesFor = (it, idx) => baseCandidates.filter((s) =>
                namesSimilar(it.name, s.name) && !deckProps.items.some((o, oi) => oi !== idx && o.assignTo === s.id));
              const reconcileItems = deckProps.items
                .map((it, i) => ({ it, i, opts: candidatesFor(it, i) }))
                .filter(({ it, opts }) => it.create && (opts.length > 0 || it.assignTo));
              const showReconcile = reconcileItems.length > 0;
              return (
                <>
                  <div className="dp-tracehint dp-ai-review">
                    <span>
                      <b className="dp-ai-spark">✦ AI</b> traced <b>{total}</b> — <b>{matchCount}</b> matched
                      {newCount > 0 && <>, <b>{newCount}</b> new (<span className="dp-ai-unmatched">will be created</span>)</>}.
                    </span>
                    <span className="dp-spring" />
                    <button
                      className={`dp-smooth-toggle ${aiSmooth ? 'is-on' : ''}`}
                      onClick={() => setAiSmooth((v) => !v)}
                      title="Curve the outlines (off = straight walls, recommended)"
                    >{aiSmooth ? 'Curved' : 'Straight'}</button>
                    <button className="lg-btn-primary sm" disabled={!total || applying} onClick={() => applyProposals(deck)}>
                      {applying ? 'Applying…' : newCount > 0 ? `Create ${newCount} & apply ${total}` : `Apply ${total}`}
                    </button>
                    <button className="lg-btn sm" disabled={applying} onClick={() => setProposals(null)}>Discard</button>
                  </div>
                  {showReconcile && (
                    <div className="dp-reconcile">
                      <div className="dp-reconcile-hd">These read names look like rooms you may already have — map any that match, or leave as new.</div>
                      <div className="dp-reconcile-rows">
                        {reconcileItems.map(({ it, i, opts }) => (
                          <label className="dp-reconcile-row" key={i}>
                            <span className="dp-recon-name">✦ {it.name}</span>
                            <select className="dp-recon-sel" value={it.assignTo || ''} onChange={(e) => setItemAssign(i, e.target.value || null)}>
                              <option value="">Create new room</option>
                              {opts.map((s) => <option key={s.id} value={s.id}>= {s.name}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {crop && gaDims ? (
              <>
                <div
                  className={`dp-plan ${linkMode ? 'is-linking' : ''} ${traceMode ? 'is-tracing' : ''} ${focusMode ? 'is-focus' : ''}`}
                  ref={(el) => { planRefs.current[deck.id] = el; }}
                  style={{ width: '100%', aspectRatio: String(boxAspectOf(crop, gaDims)) }}
                  onClick={(e) => onPlanClick(e, deck)}
                >
                  <div className="dp-plan-bg" style={cropBg(crop, layout.gaImageUrl)} />
                  {/* Traced room outlines + the in-progress trace preview. */}
                  <svg className="dp-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {!focusMode && placed.map((s) => {
                      if (editing?.spaceId === s.id) return null; // shown live below
                      const sh = shapeOf(s);
                      if (!sh) return null;
                      const d = shapeToPath(sh);
                      const cat = categoryOf(s);
                      // A white halo behind the coloured outline so it reads on the busy GA;
                      // outline + translucent fill in the room's category colour (zone map).
                      return (
                        <g key={s.id}>
                          <path className="dp-shape-halo" d={d} />
                          <path className="dp-shape" d={d} style={{ stroke: categoryColor(cat), fill: categoryFill(cat) }} />
                        </g>
                      );
                    })}
                    {tracing && tracing.deckId === deck.id && tracing.nodes.length > 0 && (
                      <polyline className="dp-trace-line" points={tracing.nodes.map((n) => `${(n.x * 100).toFixed(2)},${(n.y * 100).toFixed(2)}`).join(' ')} />
                    )}
                    {/* Live outline while adjusting an existing room. */}
                    {editing && editing.deckId === deck.id && editing.nodes.length >= 2 && (() => {
                      const d = shapeToPath({ closed: true, nodes: editing.nodes });
                      return (<g><path className="dp-shape-halo" d={d} /><path className="dp-shape is-editing" d={d} /></g>);
                    })()}
                    {/* AI proposal outlines — dashed, awaiting Apply. */}
                    {deckProps && deckProps.items.map((it, i) => {
                      const d = shapeToPath({ closed: true, nodes: aiSmooth ? smoothClosed(it.nodes) : it.nodes });
                      return (
                        <g key={i}>
                          <path className="dp-shape-halo" d={d} />
                          <path className={`dp-proposal ${it.create && !it.assignTo ? 'is-new' : ''}`} d={d} />
                        </g>
                      );
                    })}
                  </svg>
                  {!focusMode && deckLinks.length > 0 && (
                    <svg className="dp-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      {deckLinks.map((l) => {
                        const a = posById[l.a]; const b = posById[l.b];
                        return (
                          <g key={l.id} className="dp-link-g" onClick={() => linkMode && deleteLink(l.id)}>
                            <line className="dp-link" x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} />
                            <line className="dp-link-hit" x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100}>
                              {linkMode && <title>Remove doorway</title>}
                            </line>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                  {placed.map((s) => {
                    if (tracing?.spaceId === s.id || editing?.spaceId === s.id) return null; // hide the pin while tracing/adjusting
                    const p = posOf(s);
                    const scanned = isScanned(s);
                    const pending = pendingLink?.spaceId === s.id;
                    return (
                      <div
                        key={s.id}
                        className={`dp-pin ${scanned ? 'is-scanned' : 'is-empty'} ${drag?.spaceId === s.id ? 'is-dragging' : ''} ${pending ? 'is-pending' : ''}`}
                        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                        onPointerDown={(e) => onDotDown(e, s, deck, true)}
                        title={linkMode ? s.name : scanned ? `${s.name} — open on map` : `${s.name} — add a scan`}
                      >
                        <span className="dp-pin-label">{s.name}</span>
                      </div>
                    );
                  })}
                  {/* AI proposal labels at each outline's centre. */}
                  {deckProps && deckProps.items.map((it, i) => {
                    const c = centroidOf(it.nodes);
                    if (!c) return null;
                    return (
                      <span key={i} className={`dp-proposal-label ${it.create && !it.assignTo ? 'is-new' : ''}`} style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>
                        ✦ {it.name}{it.create && !it.assignTo ? ' +' : ''}
                      </span>
                    );
                  })}
                  {/* In-progress trace node dots (round; on top of the outline). */}
                  {tracing && tracing.deckId === deck.id && tracing.nodes.map((n, i) => (
                    <span
                      key={i}
                      className={`dp-trace-dot ${i === 0 ? 'is-first' : ''}`}
                      style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
                    />
                  ))}
                  {/* Adjust handles: midpoint "+" to add, draggable corners, double-click to remove. */}
                  {editing && editing.deckId === deck.id && editing.nodes.map((n, i) => {
                    const m = editing.nodes[(i + 1) % editing.nodes.length];
                    return (
                      <span
                        key={`mid-${i}`}
                        className="dp-edit-mid"
                        style={{ left: `${((n.x + m.x) / 2) * 100}%`, top: `${((n.y + m.y) / 2) * 100}%` }}
                        onPointerDown={(e) => insertEditNode(e, i, (n.x + m.x) / 2, (n.y + m.y) / 2)}
                        title="Add a point here"
                      >+</span>
                    );
                  })}
                  {editing && editing.deckId === deck.id && editing.nodes.map((n, i) => (
                    <span
                      key={`h-${i}`}
                      className={`dp-edit-handle ${editSel === i ? 'is-sel' : ''}`}
                      style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
                      onPointerDown={(e) => onEditNodeDown(e, i, deck)}
                      onDoubleClick={(e) => deleteEditNode(e, i)}
                      title="Drag to move · click to select, then Delete"
                    />
                  ))}
                </div>

                {unplaced.length > 0 && (
                  <div className="dp-tray">
                    <span className="dp-tray-label">{traceMode ? 'Click a room to trace it' : 'Drag onto the plan'}</span>
                    {unplaced.map((s) => (
                      <div
                        key={s.id}
                        className={`dp-chip ${isScanned(s) ? 'is-scanned' : 'is-empty'} ${tracing?.spaceId === s.id ? 'is-tracing' : ''}`}
                        onPointerDown={(e) => onDotDown(e, s, deck, false)}
                      >
                        <span className="dp-pin-dot" />{s.name}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <button className="dp-plan-empty" onClick={() => setFramingDeck(deck)}>
                Frame this deck on the drawing →
              </button>
            )}
          </div>
        );
      })}

      {framingDeck && (
        <FrameEditor
          gaUrl={layout.gaImageUrl}
          deckName={framingDeck.name}
          initial={cropOf(framingDeck)}
          onSave={(crop) => saveCrop(framingDeck.id, crop)}
          onCancel={() => setFramingDeck(null)}
        />
      )}

      {drag && ghost && (
        <div className={`dp-ghost ${drag.scanId ? 'is-scanned' : 'is-empty'}`} style={{ left: ghost.x, top: ghost.y }}>
          <span className="dp-pin-dot" />{drag.name}
        </div>
      )}
    </div>
  );
}
