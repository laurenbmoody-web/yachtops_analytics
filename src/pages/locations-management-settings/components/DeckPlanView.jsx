// Deck-plan layout view — the "full vessel layout". Upload the vessel's General
// Arrangement drawing once, frame each deck's band on it, and (next phase) place
// rooms onto the plan. Reads/writes via locationsLayoutStorage. Phase 1: upload
// + per-deck framing + rendering each framed deck's plan.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getVesselLayout, uploadGaImage, setDeckCrop } from '../utils/locationsLayoutStorage';
import { pdfToPngBlob } from '../utils/pdfRaster';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

// The plan frame is a fixed long rectangle; the deck's crop is scaled to FIT
// inside it (contain), centred, undistorted — never stretched, never clipped.
const FRAME_ASPECT = 3.2;

// Inner element that paints just the deck's crop of the shared GA image, sized
// to contain the crop (aspect A) within the fixed frame (aspect FRAME_ASPECT).
// We give it explicit width/height %, so its box aspect always equals A and the
// percentage-sized background can never distort.
function cropStyle(crop, dims, url) {
  const A = (crop.w * dims.w) / (crop.h * dims.h) || 3;
  const F = FRAME_ASPECT;
  // Contain: wider-than-frame crops span the width; taller ones span the height.
  const wPct = A >= F ? 100 : (A / F) * 100;
  const hPct = A >= F ? (F / A) * 100 : 100;
  return {
    width: `${wPct}%`,
    height: `${hPct}%`,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${100 / crop.w}% ${100 / crop.h}%`,
    backgroundPosition: `${crop.w < 1 ? (crop.x / (1 - crop.w)) * 100 : 0}% ${crop.h < 1 ? (crop.y / (1 - crop.h)) * 100 : 0}%`,
    backgroundRepeat: 'no-repeat',
  };
}

// Draw-a-box framing modal over the full GA image.
function FrameEditor({ gaUrl, deckName, initial, onSave, onCancel }) {
  const wrapRef = useRef(null);
  const [rect, setRect] = useState(initial || null);
  const drag = useRef(null);

  const pos = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
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

export default function DeckPlanView({ decks = [] }) {
  const [layout, setLayout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [gaDims, setGaDims] = useState(null);
  const [framingDeck, setFramingDeck] = useState(null);
  const [localCrops, setLocalCrops] = useState({});
  const fileRef = useRef(null);

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
        <span className="dp-toolbar-note">Frame each deck on the drawing, then place rooms.</span>
        <button className="lg-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>{rendering ? 'Rendering PDF…' : uploading ? 'Uploading…' : 'Replace drawing'}</button>
      </div>
      {uploadError && <p className="dp-error">{uploadError}</p>}

      {decks.map((deck) => {
        const crop = cropOf(deck);
        return (
          <div className="dp-deck" key={deck.id}>
            <div className="dp-deckhdr">
              <span className="dp-dn">{deck.name}</span>
              <span className="dp-dc">{deck.spaceCount} {deck.spaceCount === 1 ? 'space' : 'spaces'}</span>
              <span className="dp-spring" />
              <button className="lg-btn sm" onClick={() => setFramingDeck(deck)}>{crop ? 'Reframe' : 'Frame deck'}</button>
            </div>
            {crop && gaDims ? (
              <div className="dp-plan">
                <div className="dp-plan-fit" style={cropStyle(crop, gaDims, layout.gaImageUrl)} />
              </div>
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
    </div>
  );
}
