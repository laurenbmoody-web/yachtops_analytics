// Deck-plan layout view — the "full vessel layout". Upload the vessel's General
// Arrangement drawing once, frame each deck's band on it, then place rooms onto
// the plan. Reads/writes via locationsLayoutStorage.
//   Phase 1: GA upload + per-deck framing + rendering each framed deck's plan.
//   Phase 2: drag rooms from the tray onto the plan (writes plan_x/plan_y),
//            markers coloured scanned/not-scanned so the plan doubles as a
//            coverage map, click a scanned room to open it on the vessel map.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getVesselLayout, uploadGaImage, setDeckCrop, setSpacePosition } from '../utils/locationsLayoutStorage';
import { pdfToPngBlob } from '../utils/pdfRaster';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const clamp01 = (n) => Math.max(0, Math.min(1, n));

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

export default function DeckPlanView({ decks = [], onAddScan }) {
  const navigate = useNavigate();
  const onAddScanRef = useRef(onAddScan);
  onAddScanRef.current = onAddScan;
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
  const fileRef = useRef(null);
  const planRefs = useRef({}); // deckId -> plan element (for drop hit-testing)
  const movedRef = useRef(false);
  const dragRef = useRef(null); // active drag info during the gesture (no re-render lag)

  const load = useCallback(async () => {
    const l = await getVesselLayout();
    setLayout(l);
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
        <span className="dp-toolbar-note">Frame each deck, then drag its rooms onto the plan.</span>
        <div className="dp-legend" aria-hidden="true">
          <span className="dp-legend-item"><span className="dp-swatch is-scanned" /> Scanned</span>
          <span className="dp-legend-item"><span className="dp-swatch is-empty" /> Not scanned</span>
        </div>
        <button className="lg-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>{rendering ? 'Rendering PDF…' : uploading ? 'Uploading…' : 'Replace drawing'}</button>
      </div>
      {uploadError && <p className="dp-error">{uploadError}</p>}

      {decks.map((deck) => {
        const crop = cropOf(deck);
        const spaces = spacesOf(deck);
        const placed = spaces.filter((s) => posOf(s));
        const unplaced = spaces.filter((s) => !posOf(s));
        return (
          <div className="dp-deck" key={deck.id}>
            <div className="dp-deckhdr">
              <span className="dp-dn">{deck.name}</span>
              <span className="dp-dc">{deck.spaceCount} {deck.spaceCount === 1 ? 'space' : 'spaces'}</span>
              <span className="dp-spring" />
              <button className="lg-btn sm" onClick={() => setFramingDeck(deck)}>{crop ? 'Reframe' : 'Frame deck'}</button>
            </div>

            {crop && gaDims ? (
              <>
                <div
                  className="dp-plan"
                  ref={(el) => { planRefs.current[deck.id] = el; }}
                  style={{ width: '100%', aspectRatio: String(boxAspectOf(crop, gaDims)) }}
                >
                  <div className="dp-plan-bg" style={cropBg(crop, layout.gaImageUrl)} />
                  {placed.map((s) => {
                    const p = posOf(s);
                    const scanned = isScanned(s);
                    return (
                      <div
                        key={s.id}
                        className={`dp-pin ${scanned ? 'is-scanned' : 'is-empty'} ${drag?.spaceId === s.id ? 'is-dragging' : ''}`}
                        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                        onPointerDown={(e) => startDrag(e, s, deck, true)}
                        title={scanned ? `${s.name} — open on map` : `${s.name} — add a scan`}
                      >
                        <span className="dp-pin-label">{s.name}</span>
                      </div>
                    );
                  })}
                </div>

                {unplaced.length > 0 && (
                  <div className="dp-tray">
                    <span className="dp-tray-label">Drag onto the plan</span>
                    {unplaced.map((s) => (
                      <div
                        key={s.id}
                        className={`dp-chip ${isScanned(s) ? 'is-scanned' : 'is-empty'}`}
                        onPointerDown={(e) => startDrag(e, s, deck, false)}
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
