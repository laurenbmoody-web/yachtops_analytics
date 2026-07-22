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
import { getVesselLayout, uploadGaImage, setDeckCrop, setSpacePosition, setSpaceShape, setSpaceCategory, getSpaceLinks, addSpaceLink, removeSpaceLink, autotraceDeck, recordDeckShapeSample } from '../utils/locationsLayoutStorage';
import { CATEGORIES, categoryColor, categoryFill, inferCategory, normCategory } from '../utils/roomCategories';
import { createZone, createSpace, archiveSpace, updateSpace } from '../utils/locationsHierarchyStorage';
import { simplifyClosed } from '../utils/deckTrace';
import { segmentDeck, regionAtPoint, regionContour, splitRegionBySeeds } from '../utils/deckSegment';
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

// Loose room-name key for matching AI-read labels to the crew's existing rooms.
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();



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
  const [links, setLinks] = useState([]); // room links [{id,a,b,kind:'door'|'stairs'}]
  const [linkMode, setLinkMode] = useState(false);
  const [pendingLink, setPendingLink] = useState(null); // {spaceId, deckId} first-picked dot
  const [selLink, setSelLink] = useState(null); // linkId tapped to inspect/remove (touch-friendly)
  const [flashSpace, setFlashSpace] = useState(null); // spaceId briefly highlighted after a stairs jump
  const flashTimerRef = useRef(null);
  const [localShapes, setLocalShapes] = useState({}); // spaceId -> shape | null (override)
  const [localCats, setLocalCats] = useState({}); // spaceId -> category (override for instant recolour)
  const [localNames, setLocalNames] = useState({}); // spaceId -> name (override for instant rename)
  const [traceMode, setTraceMode] = useState(false);
  const [tracing, setTracing] = useState(null); // { spaceId, deckId, name, nodes:[{x,y}] } in progress
  const [editing, setEditing] = useState(null); // { spaceId, deckId, name, nodes:[{x,y}] } adjusting an existing outline
  const [editSel, setEditSel] = useState(null); // index of the selected corner while editing
  const [adjMenu, setAdjMenu] = useState(false); // "More" overflow menu open in the Adjust bar
  const editDragRef = useRef(null); // node being dragged while editing
  const lastTapRef = useRef({ i: -1, t: 0 }); // for double-tap-to-delete a corner
  const snapTargetsRef = useRef([]); // other rooms' corners on this deck, to snap to
  const [tapMode, setTapMode] = useState(false); // false = draw points by hand (default); true = tap to auto-outline
  const [tapBusy, setTapBusy] = useState(false); // segmenting on a tap
  const segCacheRef = useRef({}); // deckId -> { cropKey, seg }
  const [detecting, setDetecting] = useState(null); // deckId with an AI detect in flight
  const [proposals, setProposals] = useState(null); // { deckId, items:[{name,matchedSpaceId,create,nodes,traced}] }
  const [detectError, setDetectError] = useState(null); // { deckId, message } | null
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
  // Bank a finalised outline as room-shape training data (shapes only, no names).
  // Best-effort; never blocks tracing. Skips deletions (null nodes).
  const captureSample = (deck, spaceId, nodes, source) => {
    if (!Array.isArray(nodes) || nodes.length < 3) return;
    recordDeckShapeSample({ deckId: deck?.id, spaceId, crop: cropOf(deck), gaImageUrl: layout?.gaImageUrl, nodes, source });
  };
  // Room name: local override wins (instant rename), else the saved name.
  const nameOf = (space) => (space.id in localNames ? localNames[space.id] : space.name);
  // Rename a room from the plan (e.g. after a trace is applied). Persists and
  // reflects instantly via the local override; the pin/label update at once.
  const renameRoom = async (space) => {
    // eslint-disable-next-line no-alert
    const name = window.prompt('Rename room:', nameOf(space))?.trim();
    if (!name || name === nameOf(space)) return;
    setLocalNames((p) => ({ ...p, [space.id]: name }));
    if (editing?.spaceId === space.id) setEditing((ed) => (ed ? { ...ed, name } : ed));
    try { await updateSpace(space.id, name); }
    catch (err) { console.error('[deck-plan] rename error:', err); }
  };
  // Room zoning category: local override wins, else the saved one, else inferred
  // from the room name. Drives the outline/fill colour on the plan.
  const categoryOf = (space) => normCategory((space.id in localCats ? localCats[space.id] : space.planCategory) || inferCategory(space.name));
  const setCategory = (spaceId, cat) => {
    setLocalCats((p) => ({ ...p, [spaceId]: cat }));
    setSpaceCategory(spaceId, cat).catch((err) => console.error('[deck-plan] save category error:', err));
  };
  const startTrace = (space, deck, fromPin) => { if (fromPin) traceStartRef.current = true; setTracing({ spaceId: space.id, deckId: deck.id, name: nameOf(space), nodes: [] }); };
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
    saveShape(tracing.spaceId, { closed: true, nodes: tracing.nodes });
    captureSample(decks.find((d) => d.id === tracing.deckId), tracing.spaceId, tracing.nodes, 'manual');
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
  const startEdit = (space, deck, fromPin) => {
    const sh = shapeOf(space);
    if (fromPin) traceStartRef.current = true;
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
    setEditing({ spaceId: space.id, deckId: deck.id, name: nameOf(space), nodes: (sh?.nodes || []).map((n) => ({ x: n.x, y: n.y })) });
  };
  // Adjust a PROPOSED outline's corners in the review stage, before anything is
  // committed. Reuses the same drag/snap/insert/delete machinery as startEdit;
  // the only difference is where "Done" writes the nodes back to (the proposal
  // item, not the database). propIdx marks it as a proposal edit.
  const startEditProposal = (i, deck) => {
    const it = proposals?.items?.[i];
    if (!it) return;
    setEditSel(null);
    // Snap to every OTHER proposed outline's corners + any placed rooms' corners
    // on this deck, so shared walls meet cleanly.
    const targets = [];
    proposals.items.forEach((p, k) => { if (k !== i) p.nodes?.forEach((n) => targets.push({ x: n.x, y: n.y })); });
    spacesOf(deck).forEach((s) => { (shapeOf(s)?.nodes || []).forEach((n) => targets.push({ x: n.x, y: n.y })); });
    snapTargetsRef.current = targets;
    setEditing({ propIdx: i, spaceId: null, deckId: deck.id, name: it.name, nodes: it.nodes.map((n) => ({ x: n.x, y: n.y })) });
  };
  // Drag a corner, snapping for clean lines: to a nearby other-room corner
  // (shared walls join), else axis-align to a neighbour/other corner's x or y
  // Corner drag: exact by default (goes where you drop it); hold Shift to align.
  const onEditNodeMove = useCallback((e) => {
    const d = editDragRef.current;
    if (!d) return;
    const rect = planRefs.current[d.deckId]?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Default: the corner goes EXACTLY where the cursor is — pixel-precise, no
    // snapping fighting you. Hold Shift to keep the wall straight (align this
    // corner to one of its own neighbours' x/y).
    const align = e.shiftKey;
    setEditing((ed) => {
      if (!ed) return ed;
      const n = ed.nodes.length;
      const i = d.index;
      let x = clamp01(mx / rect.width);
      let y = clamp01(my / rect.height);
      if (align) {
        const prev = ed.nodes[(i - 1 + n) % n];
        const next = ed.nodes[(i + 1) % n];
        const AX = 9;
        if (Math.abs(prev.x * rect.width - mx) < AX) x = prev.x;
        else if (Math.abs(next.x * rect.width - mx) < AX) x = next.x;
        if (Math.abs(prev.y * rect.height - my) < AX) y = prev.y;
        else if (Math.abs(next.y * rect.height - my) < AX) y = next.y;
      }
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
    // Double-tap a corner to delete it. We detect it here rather than via
    // onDoubleClick because preventDefault() above suppresses the browser's
    // synthetic dblclick — and this way it also works on touch.
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (lastTapRef.current.i === i && now - lastTapRef.current.t < 320) {
      lastTapRef.current = { i: -1, t: 0 };
      deleteNodeAt(i);
      return;
    }
    lastTapRef.current = { i, t: now };
    setEditSel(i); // clicking a corner selects it (so ⌫ / the menu can remove it)
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
  const simplifyEdit = () => setEditing((ed) => (ed && ed.nodes.length > 4 ? { ...ed, nodes: simplifyClosed(ed.nodes, 0.012) } : ed));
  const saveEdit = () => {
    if (!editing || editing.nodes.length < 3) { setEditing(null); setEditSel(null); return; }
    // Proposal edit: write the reshaped corners back into the proposal only —
    // nothing hits the database until Apply.
    if (editing.propIdx != null) {
      const { propIdx, nodes } = editing;
      setProposals((p) => (p ? { ...p, items: p.items.map((x, k) => (k === propIdx ? { ...x, nodes } : x)) } : p));
      setEditing(null); setEditSel(null);
      return;
    }
    saveShape(editing.spaceId, { closed: true, nodes: editing.nodes });
    captureSample(decks.find((d) => d.id === editing.deckId), editing.spaceId, editing.nodes, 'reshape');
    const c = centroidOf(editing.nodes);
    if (c) applyPos(editing.spaceId, c.x, c.y);
    setEditing(null); setEditSel(null);
  };
  const cancelEdit = () => { setEditing(null); setEditSel(null); };
  // Bin the whole outline (e.g. the AI traced something that isn't a room). Keeps
  // the room's point/pin; use the room list to remove the room itself.
  const deleteOutline = () => {
    if (!editing) return;
    if (editing.propIdx != null) { const i = editing.propIdx; setEditing(null); setEditSel(null); removeProposal(i); return; }
    saveShape(editing.spaceId, null);
    setEditing(null); setEditSel(null);
  };
  const retraceFromEdit = () => {
    if (!editing) return;
    const e = editing;
    setEditing(null); setEditSel(null);
    // No swallow flag here — Re-trace is a button press, not a room-select click,
    // so the very next tap on the plan must count (was being eaten before).
    setTracing({ spaceId: e.spaceId, deckId: e.deckId, name: e.name, nodes: [] });
  };
  useEffect(() => () => { window.removeEventListener('pointermove', onEditNodeMove); window.removeEventListener('pointerup', onEditNodeUp); }, [onEditNodeMove, onEditNodeUp]);
  // While adjusting an outline: Enter saves, Esc cancels, Delete/⌫ removes the
  // selected corner. Ignored while typing in a field.
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
      else if (e.key === 'Escape') cancelEdit();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && editSel != null) { e.preventDefault(); deleteNodeAt(editSel); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editSel]);
  // While drawing a fresh outline: Enter finishes it (closes the shape), Esc cancels.
  useEffect(() => {
    if (!tracing) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter' && tracing.nodes.length >= 3) { e.preventDefault(); finishTrace(); }
      else if (e.key === 'Escape') cancelTrace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracing]);
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
      // fromPlaced = a pin on the plan (its click bubbles to onPlanClick and must
      // be swallowed); a tray chip does not, so the first plan click must count.
      if (shapeOf(space)) startEdit(space, deck, fromPlaced); else startTrace(space, deck, fromPlaced);
      return;
    }
    if (!linkMode) { startDrag(e, space, deck, fromPlaced); return; }
    e.preventDefault();
    setSelLink(null); // picking rooms clears any inspected doorway
    if (!pendingLink) { setPendingLink({ spaceId: space.id, deckId: deck.id }); return; }
    if (pendingLink.spaceId === space.id) { setPendingLink(null); return; } // toggle off
    const a = pendingLink.spaceId; const b = space.id;
    // Same deck → a doorway (walk straight through). Different deck → stairs
    // (the only way to reach a space like the foredeck from another level).
    const kind = pendingLink.deckId === deck.id ? 'door' : 'stairs';
    setPendingLink(null);
    if (linkExists(a, b)) return;
    addSpaceLink(a, b, kind)
      .then((row) => setLinks((p) => (p.some((l) => l.id === row.id) ? p : [...p, row])))
      .catch((err) => console.error('[deck-plan] add link error:', err));
  };

  const deleteLink = (linkId) => {
    setLinks((p) => p.filter((l) => l.id !== linkId));
    removeSpaceLink(linkId).catch((err) => console.error('[deck-plan] remove link error:', err));
  };

  // Follow a stairs link: scroll the connected deck into view and flash the
  // room it lands on, so a cross-deck connection reads like walking up stairs.
  const jumpToSpace = (deckId, spaceId) => {
    const el = typeof document !== 'undefined' && document.getElementById(`dp-deck-${deckId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashSpace(spaceId);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashSpace(null), 1800);
  };

  const toggleLinkMode = () => { setPendingLink(null); setSelLink(null); setTraceMode(false); setTracing(null); setLinkMode((v) => !v); };
  // Tap a doorway: first tap selects it (highlights it, names both rooms, fades
  // the rest — works on touch where hover can't); tapping the selected one again
  // removes it.
  const tapLink = (linkId) => {
    if (selLink === linkId) { deleteLink(linkId); setSelLink(null); }
    else setSelLink(linkId);
  };

  // Cached deck segmentation (for tap-to-outline). Recomputed if the crop changes.
  const getSeg = async (deck) => {
    const crop = cropOf(deck);
    const key = JSON.stringify(crop);
    const cached = segCacheRef.current[deck.id];
    if (cached && cached.key === key) return cached.seg;
    const { imageData } = await prepareDeck(crop);
    const seg = segmentDeck(imageData);
    segCacheRef.current[deck.id] = { key, seg };
    return seg;
  };

  // Click on the plan while tracing. In tap mode, one tap inside a room outlines
  // its enclosed wall-region (fix-up: a whole room in one click). In draw mode,
  // each click drops an outline node; a click near the first node closes it.
  const onPlanClick = async (e, deck) => {
    if (!traceMode || !tracing || tracing.deckId !== deck.id) return;
    if (traceStartRef.current) { traceStartRef.current = false; return; } // the room-select click
    if (e.target.closest?.('.dp-pin')) return; // a pin click starts/switches tracing, not a node
    const rect = planRefs.current[deck.id]?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    if (tapMode && tracing.nodes.length === 0) {
      if (tapBusy) return;
      setTapBusy(true);
      try {
        const seg = await getSeg(deck);
        const region = regionAtPoint(seg, x, y);
        const nodes = region ? regionContour(seg, region) : null;
        if (nodes) {
          saveShape(tracing.spaceId, { closed: true, nodes });
          captureSample(deck, tracing.spaceId, nodes, 'tap');
          const c = centroidOf(nodes);
          if (c) applyPos(tracing.spaceId, c.x, c.y);
          setTracing(null);
          return;
        }
        // Nothing enclosed here — fall through to a manual point so the tap isn't lost.
        addTraceNode(x, y);
      } catch (err) {
        console.error('[deck-plan] tap-outline error:', err);
        addTraceNode(x, y);
      } finally {
        setTapBusy(false);
      }
      return;
    }
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
      // Full-deck JPEG + its pixel dims, for point-prompted SAM (needs the point
      // in image pixels, and the mask normalizes back against these dims).
      const deckJpeg = (cap = 1280) => {
        const scale = Math.min(1, cap / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        return { base64: c.toDataURL('image/jpeg', 0.9).split(',')[1], w, h };
      };
      resolve({ imageData, cropSub, deckJpeg });
    };
    img.onerror = () => reject(new Error('Could not load the drawing.'));
    img.src = layout.gaImageUrl;
  });


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
        // Remap each strip's seed/bbox back to full-deck 0..1, then dedupe. Only
        // merge same-name readings that are in the SAME place (one room caught in
        // two overlapping strips) — two cabins that genuinely share a label (e.g.
        // port + starboard "2×Officer") sit far apart and are BOTH kept, so each
        // gets its own seed and the split can separate them.
        const all = [];
        perSeg.flat().forEach(({ r, a, b }) => {
          if (!r.seed) return;
          const wdt = b - a;
          all.push({
            name: r.name,
            confidence: r.confidence,
            central: Math.min(r.seed.x, 1 - r.seed.x), // within-strip centrality
            seed: { x: a + r.seed.x * wdt, y: r.seed.y },
            bbox: r.bbox ? { x: a + r.bbox.x * wdt, y: r.bbox.y, w: r.bbox.w * wdt, h: r.bbox.h } : null,
          });
        });
        all.sort((x, y) => y.central - x.central); // prefer the most-central reading of a dup
        const kept = [];
        all.forEach((d) => {
          const dup = kept.find((k) => normName(k.name) === normName(d.name)
            && Math.hypot(k.seed.x - d.seed.x, k.seed.y - d.seed.y) < 0.1);
          if (!dup) kept.push(d);
        });
        rooms = kept;
      }
      if (!rooms.length) { setDetectError({ deckId: deck.id, message: 'No rooms could be read from this deck. Try reframing it tighter around the plan.' }); return; }
      // Segment the whole deck into enclosed wall-regions once — the accurate
      // path: hang each read name on the region its seed falls in, so the outline
      // is the true wall boundary (tolerant of a loose seed). Flood-fill/box only
      // as a fallback when a seed doesn't land in a usable region.
      const seg = segmentDeck(imageData);
      const items = [];
      const used = new Set();       // spaces already claimed by an outline
      const claimed = new Map();    // regionId → true (a pin already owns this region)

      // ── Pin pass ──────────────────────────────────────────────────────────
      // A pin the crew already dropped is ground truth. Trace the wall-region
      // that pin sits inside and hang the room on it — so Detect outlines the
      // exact room the crew marked (e.g. the Wheelhouse), not wherever the model
      // guessed. The model's own reading of that room is then ignored.
      // Group placed pins by the region they fall in first, because two pins can
      // land in ONE region when the AI missed a thin/undrawn wall between them.
      const pinsByRegion = new Map(); // regionId → [{ space, pin }]
      spacesOf(deck).forEach((s) => {
        const pin = posOf(s);
        if (!pin) return;
        const region = regionAtPoint(seg, pin.x, pin.y);
        if (!region) return;
        if (!pinsByRegion.has(region.id)) pinsByRegion.set(region.id, []);
        pinsByRegion.get(region.id).push({ space: s, pin });
      });
      pinsByRegion.forEach((entries, regionId) => {
        const region = seg.regionById.get(regionId);
        claimed.set(regionId, true); // this region is the crew's, off-limits to the model pass
        if (entries.length === 1) {
          const { space } = entries[0];
          const nodes = regionContour(seg, region);
          if (!nodes) return;
          used.add(space.id);
          items.push({ name: space.name, matchedSpaceId: space.id, create: false, nodes, traced: true, anchored: true });
        } else {
          // Two+ pins in one region → the crew marked rooms the AI merged. Split
          // by watershed (nearest-pin) so each pin gets its own share of the area.
          const parts = splitRegionBySeeds(seg, region, entries.map((e) => e.pin));
          entries.forEach((e, k) => {
            const nodes = parts[k];
            if (!nodes) return;
            used.add(e.space.id);
            items.push({ name: e.space.name, matchedSpaceId: e.space.id, create: false, nodes, traced: true, anchored: true });
          });
        }
      });

      // ── Model pass ────────────────────────────────────────────────────────
      // Which enclosed region each read seed lands in — skipping regions a pin
      // already owns (that room is done).
      // Higher decks are mostly open deck: skip regions whose floor reads as warm
      // teak planking — that's exterior space, not a room. (A crew pin overrides
      // this: a pinned region is claimed above and always traced, so an exterior
      // area the crew genuinely wants still comes through.)
      let extSkipped = 0;
      const byRegion = new Map();
      rooms.forEach((r, idx) => {
        const region = regionAtPoint(seg, r.seed.x, r.seed.y);
        if (!region || claimed.has(region.id)) return;
        if (region.exterior) { extSkipped += 1; return; }
        if (!byRegion.has(region.id)) byRegion.set(region.id, []);
        byRegion.get(region.id).push(idx);
      });
      // A region with ONE seed → its outline. SEVERAL seeds → rooms that flooded
      // together (thin/undrawn wall); split by watershed so each gets its part.
      const nodesByIdx = new Array(rooms.length).fill(null);
      byRegion.forEach((idxs, regionId) => {
        const region = seg.regionById.get(regionId);
        if (idxs.length === 1) {
          nodesByIdx[idxs[0]] = regionContour(seg, region);
        } else {
          const parts = splitRegionBySeeds(seg, region, idxs.map((i) => rooms[i].seed));
          idxs.forEach((i, k) => { nodesByIdx[i] = parts[k] || null; });
        }
      });
      // The model is used ONLY to find regions to trace — never to name or match
      // rooms. Its name guesses were landing on the wrong rooms, so assignment to
      // an existing room happens purely by pin geometry (the pass above). Every
      // remaining region is an unnamed draft outline: the crew keeps the shapes
      // that are real rooms and drops the rest. Nothing carries an AI label.
      rooms.forEach((r, idx) => {
        const nodes = nodesByIdx[idx];
        if (!nodes) return;
        items.push({ name: null, matchedSpaceId: null, create: true, nodes, traced: true });
      });
      if (!items.length) { setDetectError({ deckId: deck.id, message: extSkipped ? 'This deck read as mostly open exterior deck — no interior rooms to outline. Drop a pin in any space you want traced, then Detect again.' : 'Rooms were read but none sat on the plan. Try reframing the deck tighter around the drawing.' }); return; }
      setProposals({ deckId: deck.id, items, extSkipped });
    } catch (err) {
      console.error('[deck-plan] detect error:', err);
      setDetectError({ deckId: deck.id, message: err?.message || 'Could not detect rooms on this deck.' });
    } finally {
      setDetecting(null);
    }
  };

  // Add a room to a deck straight from Plan view (no jumping to Grid/Carousel).
  // Creates a space under the deck's first zone (making one if the deck has none).
  const addRoom = async (deck) => {
    // eslint-disable-next-line no-alert
    const name = window.prompt(`Add a room to ${deck.name}:`)?.trim();
    if (!name) return;
    try {
      let zoneId = deck.zones?.[0]?.id || null;
      if (!zoneId) { const z = await createZone(deck.id, 'General'); zoneId = z.id; }
      await createSpace(zoneId, name);
      await onReloadRef.current?.();
    } catch (err) {
      console.error('[deck-plan] add room error:', err);
      setDetectError({ deckId: deck.id, message: err?.message || 'Could not add the room.' });
    }
  };

  // Delete a room from the vessel (archive) straight from Plan view — for the
  // leftover / wrong rooms sitting in the tray.
  const deleteRoom = async (space, deck) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${nameOf(space)}"? This removes the room from the vessel.`)) return;
    try {
      await archiveSpace(space.id);
      await onReloadRef.current?.();
    } catch (err) {
      console.error('[deck-plan] delete room error:', err);
      setDetectError({ deckId: deck.id, message: err?.message || 'Could not delete the room.' });
    }
  };

  // Review-stage edit (before anything is committed): drop a proposed outline
  // from the batch. Nothing hits the database until Apply.
  const removeProposal = (i) => {
    setProposals((p) => {
      const items = p.items.filter((_, k) => k !== i);
      return items.length ? { ...p, items } : null;
    });
  };

  // Land every traced outline: a pin-anchored outline updates that room's shape;
  // each unnamed draft becomes a new "Untitled area" the crew renames afterwards.
  const applyProposals = async (deck) => {
    if (!proposals || applying) return;
    setApplying(true);
    try {
      const needsCreate = proposals.items.some((it) => it.create);
      let zoneId = deck.zones?.[0]?.id || null;
      if (needsCreate && !zoneId) { const z = await createZone(deck.id, 'General'); zoneId = z.id; }
      let draftN = 0;
      for (const it of proposals.items) {
        let spaceId = it.matchedSpaceId || null;
        if (!spaceId && it.create) {
          const name = it.name || `Untitled area ${(draftN += 1)}`;
          try { const sp = await createSpace(zoneId, name); spaceId = sp.id; }
          catch (err) { console.error('[deck-plan] create room failed:', name, err); continue; }
        }
        if (!spaceId) continue;
        await setSpaceShape(spaceId, { closed: true, nodes: it.nodes }).catch((e) => console.error('[deck-plan] shape save', e));
        captureSample(deck, spaceId, it.nodes, 'detect_apply');
        const c = centroidOf(it.nodes);
        if (c) await setSpacePosition(spaceId, c.x, c.y).catch((e) => console.error('[deck-plan] pos save', e));
      }
      setProposals(null);
      if (needsCreate) await onReloadRef.current?.(); // pull in the created rooms
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

  // Every space across every deck, keyed by id — lets a stairs link name and
  // reach the room it lands on even though that room lives on another deck.
  const spaceMeta = {};
  decks.forEach((d) => spacesOf(d).forEach((s) => { spaceMeta[s.id] = { name: s.name, deckId: d.id, deckName: d.name }; }));

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
        // Doorway links: both endpoints placed on THIS deck (drawable as lines).
        const posById = Object.fromEntries(placed.map((s) => [s.id, posOf(s)]));
        const spaceById = Object.fromEntries(placed.map((s) => [s.id, s]));
        const deckLinks = links.filter((l) => l.kind !== 'stairs' && posById[l.a] && posById[l.b] && spaceById[l.a] && spaceById[l.b]);
        // Stairs links touching THIS deck: one endpoint is here, the other on
        // another deck — rendered as a ↕ badge that jumps to the other deck.
        const deckStairs = links.filter((l) => l.kind === 'stairs').map((l) => {
          const localId = posById[l.a] ? l.a : posById[l.b] ? l.b : null;
          if (!localId) return null;
          const remoteId = localId === l.a ? l.b : l.a;
          const remote = spaceMeta[remoteId];
          return { link: l, localId, remoteId, pos: posById[localId], remote };
        }).filter(Boolean);
        const deckProps = proposals?.deckId === deck.id ? proposals : null;
        // Focus mode: while tracing/adjusting a room on this deck, hide the other
        // outlines + doorway lines and dim the other pins so the work stands out.
        const focusMode = (tracing?.deckId === deck.id) || (editing?.deckId === deck.id);
        return (
          <div className="dp-deck" key={deck.id} id={`dp-deck-${deck.id}`}>
            <div className="dp-deckhdr">
              <span className="dp-dn">{deck.name}</span>
              <span className="dp-dc">{deck.spaceCount} {deck.spaceCount === 1 ? 'space' : 'spaces'}</span>
              <span className="dp-spring" />
              {crop && gaDims && !traceMode && (
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
              {crop && gaDims && !traceMode && (
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
              {!traceMode && <button className="lg-btn sm" onClick={() => addRoom(deck)} title="Add a room to this deck">+ Add room</button>}
              {/* When unframed, the big "Frame this deck" box below is the single
                  call-to-action; only offer Reframe once it's framed. */}
              {crop && !traceMode && <button className="lg-btn sm" onClick={() => setFramingDeck(deck)}>Reframe</button>}
            </div>

            {linkMode && crop && gaDims && (
              <p className="dp-linkhint">{pendingLink ? 'Now click the room it connects to — on this deck for a doorway, or on another deck for a stair connection (or the same dot again to cancel).' : 'Click two rooms to link them: same deck makes a doorway, two different decks makes a ↕ stair connection. Tap a line to see the two rooms it joins; tap it again to remove it.'}</p>
            )}

            {traceMode && crop && gaDims && !(editing?.propIdx != null && editing.deckId === deck.id) && (
              <div className="dp-tracehint">
                {editing && editing.deckId === deck.id ? (
                  <>
                    <span className="dp-adjhdr">
                      Adjusting <em>{editing.name}</em>
                      <span className="dp-adj-info" title={`${editing.nodes.length} points · drag a corner to move (goes exactly where you drop it) · hold Shift to keep a wall straight · click a + midpoint to add · double-click a corner (or select it then ⌫) to delete`} aria-label="How to adjust">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" /><path d="M12 11v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="8" r="1.1" fill="currentColor" /></svg>
                      </span>
                    </span>
                    {(() => {
                      const eSpace = spaces.find((s) => s.id === editing.spaceId) || { id: editing.spaceId, name: editing.name };
                      const cur = categoryOf(eSpace);
                      return (
                        <span className="dp-cat-sel" title="Room category (zone colour)">
                          <span className="dp-cat-dot" style={{ background: categoryColor(cur) }} />
                          <select className="dp-cat-native" value={cur} onChange={(e) => setCategory(editing.spaceId, e.target.value)} aria-label="Room category">
                            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                        </span>
                      );
                    })()}
                    <span className="dp-spring" />
                    <button className="lg-btn-primary sm" onClick={() => { setAdjMenu(false); saveEdit(); }}>Save</button>
                    <button className="lg-btn sm" onClick={() => { setAdjMenu(false); cancelEdit(); }}>Cancel</button>
                    <span className="dp-adj-more">
                      <button className="lg-btn sm" onClick={() => setAdjMenu((v) => !v)} title="More actions" aria-haspopup="true" aria-expanded={adjMenu}>More ▾</button>
                      {adjMenu && (
                        <>
                          <div className="dp-adj-backdrop" onClick={() => setAdjMenu(false)} />
                          <div className="dp-adj-menu" role="menu">
                            <button role="menuitem" onClick={() => { setAdjMenu(false); renameRoom(spaces.find((s) => s.id === editing.spaceId) || { id: editing.spaceId, name: editing.name }); }}>Rename room</button>
                            <button role="menuitem" disabled={editing.nodes.length <= 4} onClick={() => { setAdjMenu(false); simplifyEdit(); }}>Simplify — fewer corners</button>
                            <button role="menuitem" disabled={editSel == null || editing.nodes.length <= 3} onClick={() => { setAdjMenu(false); deleteNodeAt(editSel); }}>Delete selected point</button>
                            <button role="menuitem" onClick={() => { setAdjMenu(false); retraceFromEdit(); }}>Re-trace from scratch</button>
                            <button role="menuitem" className="is-danger" onClick={() => { setAdjMenu(false); deleteOutline(); }}>Delete outline</button>
                          </div>
                        </>
                      )}
                    </span>
                  </>
                ) : tracing && tracing.deckId === deck.id ? (
                  <>
                    {tapMode && tracing.nodes.length === 0 ? (
                      <span>{tapBusy ? 'Reading the plan…' : <>Tap inside <em>{tracing.name}</em> on the plan to outline the whole room.</>}</span>
                    ) : (
                      <span>Tracing <em>{tracing.name}</em> — click to add points, click the first to close. <b>{tracing.nodes.length}</b> pts.</span>
                    )}
                    <span className="dp-spring" />
                    <button
                      className={`dp-smooth-toggle ${tapMode ? 'is-on' : ''}`}
                      onClick={() => setTapMode((v) => !v)}
                      title="Tap inside a room to auto-outline it, or switch to drawing corners by hand"
                    >{tapMode ? 'Tap room' : 'Draw points'}</button>
                    {!tapMode && <button className="lg-btn sm" disabled={!tracing.nodes.length} onClick={finishTrace}>Finish</button>}
                    {!tapMode && <button className="lg-btn sm" disabled={!tracing.nodes.length} onClick={undoTraceNode}>Undo point</button>}
                    <button className="lg-btn sm" onClick={cancelTrace}>Cancel</button>
                  </>
                ) : (
                  <span>Click a room to trace its outline, or an already-outlined room pin to edit its points.</span>
                )}
              </div>
            )}

            {detectError?.deckId === deck.id && !deckProps && (
              <p className="dp-error">{detectError.message}</p>
            )}

            {deckProps && editing?.propIdx != null && editing.deckId === deck.id ? (
              // Reshaping one proposed outline (before apply). Same handles/keys as
              // the post-apply Adjust tool; Done writes the corners back to the
              // proposal only.
              <div className="dp-tracehint dp-ai-review">
                <span className="dp-adjhdr">Reshaping <em>{editing.name || 'outline'}</em> · <b>{editing.nodes.length}</b> pts <span className="dp-hint-faint" title="Drag a corner to move (goes exactly where you drop it) · hold Shift to keep a wall straight · click a + midpoint to add · double-click a corner to delete">drag · + add · double-click to delete</span></span>
                <span className="dp-spring" />
                <button className="lg-btn sm" disabled={editing.nodes.length <= 4} onClick={simplifyEdit} title="Reduce the number of corners">Simplify</button>
                <button className="lg-btn sm" disabled={editSel == null || editing.nodes.length <= 3} onClick={() => deleteNodeAt(editSel)}>Delete point</button>
                <button className="lg-btn-primary sm" onClick={saveEdit}>Done</button>
                <button className="lg-btn sm dp-btn-danger" onClick={deleteOutline} title="Remove this outline from the batch">Delete outline</button>
                <button className="lg-btn sm" onClick={cancelEdit}>Cancel</button>
              </div>
            ) : deckProps && (() => {
              const total = deckProps.items.length;
              const newCount = deckProps.items.filter((i) => i.create).length;
              const matchCount = total - newCount;
              return (
                <div className="dp-tracehint dp-ai-review">
                  <span>
                    <b className="dp-ai-spark">✦ AI</b> traced <b>{total}</b> outline{total === 1 ? '' : 's'}
                    {matchCount > 0 && <> — <b>{matchCount}</b> on your pins</>}
                    {newCount > 0 && <>{matchCount > 0 ? ', ' : ' — '}<b>{newCount}</b> unnamed</>}.{' '}
                    {deckProps.extSkipped > 0 && <span className="dp-ai-unmatched">Skipped <b>{deckProps.extSkipped}</b> exterior deck area{deckProps.extSkipped === 1 ? '' : 's'}. </span>}
                    <span className="dp-ai-unmatched">✎ reshape, × to remove — nothing saves until you Apply.</span>
                  </span>
                  <span className="dp-spring" />
                  <button className="lg-btn-primary sm" disabled={!total || applying} onClick={() => applyProposals(deck)}>
                    {applying ? 'Applying…' : newCount > 0 ? `Create ${newCount} & apply ${total}` : `Apply ${total}`}
                  </button>
                  <button className="lg-btn sm" disabled={applying} onClick={() => setProposals(null)}>Discard</button>
                </div>
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
                    {/* AI proposal outlines — dashed, coloured by category (zone map).
                        While reshaping one, hide ALL of them (the active one draws
                        live below) so the corner work stands alone on the plan. */}
                    {deckProps && !(editing?.propIdx != null && editing.deckId === deck.id) && deckProps.items.map((it, i) => {
                      const d = shapeToPath({ closed: true, nodes: it.nodes });
                      const cat = it.matchedSpaceId
                        ? categoryOf(spaces.find((s) => s.id === it.matchedSpaceId) || { id: it.matchedSpaceId, name: it.name })
                        : normCategory(inferCategory(it.name));
                      return (
                        <g key={i}>
                          <path className="dp-shape-halo" d={d} />
                          <path className="dp-proposal" d={d} style={{ stroke: categoryColor(cat), fill: categoryFill(cat) }} />
                        </g>
                      );
                    })}
                  </svg>
                  {!focusMode && deckLinks.length > 0 && (
                    <svg className="dp-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      {deckLinks.map((l) => {
                        const a = posById[l.a]; const b = posById[l.b];
                        const label = `${nameOf(spaceById[l.a])} ↔ ${nameOf(spaceById[l.b])}`;
                        const selHere = selLink && deckLinks.some((x) => x.id === selLink);
                        const cls = selLink === l.id ? 'is-sel' : (selHere ? 'is-dim' : '');
                        return (
                          <g key={l.id} className={`dp-link-g ${cls}`} onClick={() => linkMode && tapLink(l.id)}>
                            <line className="dp-link" x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} />
                            <line className="dp-link-hit" x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100}>
                              <title>{linkMode ? `Remove doorway · ${label}` : label}</title>
                            </line>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                  {/* Selected doorway label (touch has no hover tooltip): names both
                      rooms at the link's midpoint, with a tap-again-to-remove hint. */}
                  {!focusMode && linkMode && selLink && (() => {
                    const l = deckLinks.find((x) => x.id === selLink);
                    if (!l) return null;
                    const a = posById[l.a]; const b = posById[l.b];
                    return (
                      <button
                        type="button"
                        className="dp-link-label"
                        style={{ left: `${((a.x + b.x) / 2) * 100}%`, top: `${((a.y + b.y) / 2) * 100}%` }}
                        onClick={(e) => { e.stopPropagation(); tapLink(l.id); }}
                      >
                        {nameOf(spaceById[l.a])} ↔ {nameOf(spaceById[l.b])} <span className="dp-link-label-x">· tap to remove</span>
                      </button>
                    );
                  })()}
                  {/* Stairs: a ↕ badge sitting on the local pin. Tap to jump to
                      the connected deck (or, while linking, to remove it). */}
                  {!focusMode && deckStairs.map(({ link, remoteId, pos, remote }) => (
                    <button
                      key={link.id}
                      type="button"
                      className={`dp-stair-badge ${linkMode ? 'is-removable' : ''}`}
                      style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                      title={linkMode
                        ? `Remove stairs to ${remote?.name || 'the other deck'}`
                        : `Stairs to ${remote?.name || 'room'}${remote?.deckName ? ` · ${remote.deckName}` : ''}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (linkMode) { deleteLink(link.id); return; }
                        if (remote) jumpToSpace(remote.deckId, remoteId);
                      }}
                    >
                      <span className="dp-stair-ic" aria-hidden="true">↕</span>
                      <span className="dp-stair-txt">{remote?.deckName || 'Stairs'}</span>
                    </button>
                  ))}
                  {placed.map((s) => {
                    if (tracing?.spaceId === s.id || editing?.spaceId === s.id) return null; // hide the pin while tracing/adjusting
                    const p = posOf(s);
                    const scanned = isScanned(s);
                    const pending = pendingLink?.spaceId === s.id;
                    return (
                      <div
                        key={s.id}
                        className={`dp-pin ${scanned ? 'is-scanned' : 'is-empty'} ${drag?.spaceId === s.id ? 'is-dragging' : ''} ${pending ? 'is-pending' : ''} ${flashSpace === s.id ? 'is-flash' : ''}`}
                        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                        onPointerDown={(e) => onDotDown(e, s, deck, true)}
                        title={linkMode ? nameOf(s) : scanned ? `${nameOf(s)} — open on map` : `${nameOf(s)} — add a scan`}
                      >
                        <span className="dp-pin-label">{nameOf(s)}</span>
                      </div>
                    );
                  })}
                  {/* Proposal labels at each outline's centre — editable before
                      apply: click the name to rename, × to drop it from the batch.
                      Matched (or pin-anchored) rooms show the crew's own name; new
                      draft outlines are marked so the suggested name reads as a
                      starting point, not something imposed. */}
                  {/* Detect draws outlines only — no names. Each carries just a
                      reshape (✎) and remove (×) control at its centre. Pinned rooms
                      keep their own pin/name; the rest are unnamed drafts. */}
                  {deckProps && !(editing?.propIdx != null && editing.deckId === deck.id) && deckProps.items.map((it, i) => {
                    const c = centroidOf(it.nodes);
                    if (!c) return null;
                    const cat = it.matchedSpaceId
                      ? categoryOf(spaces.find((s) => s.id === it.matchedSpaceId) || { id: it.matchedSpaceId, name: it.name })
                      : normCategory(inferCategory(it.name));
                    return (
                      <span key={i} className={`dp-proposal-label ${it.create ? 'is-new' : ''}`} style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, background: categoryColor(cat) }}>
                        <button type="button" className="dp-proposal-edit" onClick={(e) => { e.stopPropagation(); startEditProposal(i, deck); }} title="Reshape this outline">✎</button>
                        <button type="button" className="dp-proposal-x" onClick={(e) => { e.stopPropagation(); removeProposal(i); }} title="Remove this outline">×</button>
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
                      title="Drag to move · double-click to delete"
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
                        <span className="dp-pin-dot" />{nameOf(s)}
                        <button
                          className="dp-chip-x"
                          title="Delete this room"
                          onPointerDown={(e) => { e.stopPropagation(); }}
                          onClick={(e) => { e.stopPropagation(); deleteRoom(s, deck); }}
                        >×</button>
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
