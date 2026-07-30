// Cargo Accounts — receipt scanner. Camera → flatten → read.
//
// Photographing a receipt on a table gives a skewed image with a lot of background,
// and that is exactly what makes an AI misread digits (an 8 becomes a 6). So this
// does what a document scanner does before any reading happens:
//
//   1. CAPTURE at the camera's full resolution (not a downscaled preview).
//   2. FLATTEN — drag the four corners onto the receipt; we apply a projective
//      warp so the paper fills the frame square-on, with the background cut away.
//   3. SHARPEN — greyscale + contrast stretch, output at a fixed generous width,
//      so the total is as legible as we can make it before the model sees it.
//
// Only then is it sent for reading. Corners are placed by hand rather than detected
// automatically (that needs a CV library) — one drag is cheap and never wrong.
import React, { useRef, useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { detectQuad, scaleQuad, expandQuad } from '../../../services/docDetect';
import './receipt-scanner.css';

const OUT_W = 1500;              // output width fed to the model
const MAX_OUT_H = 2600;

// Project a point from the destination rectangle back into the source quad
// (bilinear on the quad's edges — exact for a plane photographed off-axis enough
// for text, and far cheaper than solving a full homography per pixel).
const lerp = (a, b, t) => a + (b - a) * t;

function warpQuadToCanvas(srcCanvas, quad, outW, outH) {
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const src = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  const dst = octx.createImageData(outW, outH);
  const [tl, tr, br, bl] = quad;

  for (let y = 0; y < outH; y += 1) {
    const v = y / (outH - 1);
    // Left and right edges at this height, then interpolate across.
    const lx = lerp(tl.x, bl.x, v); const ly = lerp(tl.y, bl.y, v);
    const rx = lerp(tr.x, br.x, v); const ry = lerp(tr.y, br.y, v);
    for (let x = 0; x < outW; x += 1) {
      const u = x / (outW - 1);
      const sx = Math.round(lerp(lx, rx, u));
      const sy = Math.round(lerp(ly, ry, u));
      const di = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
        dst.data[di] = 255; dst.data[di + 1] = 255; dst.data[di + 2] = 255; dst.data[di + 3] = 255;
        continue;
      }
      const si = (sy * src.width + sx) * 4;
      // Greyscale + contrast stretch: paper to white, ink to black, so digits crisp up.
      const g = 0.299 * src.data[si] + 0.587 * src.data[si + 1] + 0.114 * src.data[si + 2];
      const c = Math.max(0, Math.min(255, (g - 128) * 1.45 + 138));
      dst.data[di] = c; dst.data[di + 1] = c; dst.data[di + 2] = c; dst.data[di + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// `cta` lets the same scanner serve both jobs: reading a receipt into a new line,
// and photographing one to attach to a line that already exists.
export default function ReceiptScanner({ open, onClose, onScan, busy, heading, cta, busyCta }) {
  const videoRef = useRef(null);
  const shotRef = useRef(null);          // full-resolution capture
  const frameRef = useRef(null);         // the element corners are dragged over
  const [stage, setStage] = useState('camera');   // camera | adjust | preview
  const [flatUrl, setFlatUrl] = useState('');     // the flattened result, shown for approval
  const flatFileRef = useRef(null);
  const [detected, setDetected] = useState(false);
  const [preview, setPreview] = useState('');     // data URL of the capture
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [quad, setQuad] = useState(null);
  const [drag, setDrag] = useState(-1);
  const [camErr, setCamErr] = useState('');

  const stop = useCallback(() => {
    const v = videoRef.current;
    if (v?.srcObject) { v.srcObject.getTracks().forEach((t) => t.stop()); v.srcObject = null; }
  }, []);

  useEffect(() => {
    if (!open || stage !== 'camera') return undefined;
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 }, height: { ideal: 2160 },
          },
          audio: false,
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      } catch {
        setCamErr('No camera available — choose a photo instead.');
      }
    })();
    return () => { alive = false; stop(); };
  }, [open, stage, stop]);

  useEffect(() => { if (!open) { stop(); setStage('camera'); setPreview(''); setQuad(null); setCamErr(''); setFlatUrl(''); flatFileRef.current = null; } }, [open, stop]);

  // Find the paper automatically; fall back to an inset rectangle if we can't.
  // Detection runs on a small copy — it doesn't need megapixels and stays instant.
  const seedQuad = (canvas) => {
    const w = canvas.width; const h = canvas.height;
    const dw = 320; const dh = Math.max(1, Math.round((h / w) * dw));
    const small = document.createElement('canvas');
    small.width = dw; small.height = dh;
    small.getContext('2d').drawImage(canvas, 0, 0, dw, dh);
    let found = null;
    try {
      const img = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, dw, dh);
      const q = detectQuad({ data: img.data, width: dw, height: dh });
      if (q) found = expandQuad(scaleQuad(q, dw, dh, w, h), w, h, Math.round(w * 0.006));
    } catch { /* detection is a convenience — never block the scan */ }
    setDetected(Boolean(found));
    setQuad(found || [
      { x: w * 0.08, y: h * 0.06 }, { x: w * 0.92, y: h * 0.06 },
      { x: w * 0.92, y: h * 0.94 }, { x: w * 0.08, y: h * 0.94 },
    ]);
    return found;
  };

  // Build the flattened image and show it for approval before anything is read.
  const flatten = (canvas, q) => {
    const wTop = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const hLeft = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const outH = Math.max(400, Math.min(MAX_OUT_H, Math.round(OUT_W * (hLeft / Math.max(1, wTop)))));
    const flat = warpQuadToCanvas(canvas, q, OUT_W, outH);
    setFlatUrl(flat.toDataURL('image/jpeg', 0.92));
    flat.toBlob((blob) => {
      if (blob) flatFileRef.current = new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
    }, 'image/jpeg', 0.95);
    setStage('preview');
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    shotRef.current = c;
    setDims({ w: c.width, h: c.height });
    setPreview(c.toDataURL('image/jpeg', 0.95));
    const found = seedQuad(c);
    stop();
    // Corners found → show the flattened receipt straight away, as a scanner app
    // would. Otherwise ask for the corners first.
    if (found) flatten(c, found); else setStage('adjust');
  };

  // Fall back to (or deliberately choose) an existing photo / PDF.
  const pickFile = async (file) => {
    if (!file) return;
    if (file.type === 'application/pdf') { onScan(file); return; }   // PDFs go straight through
    const img = new Image();
    const url = window.URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      shotRef.current = c;
      setDims({ w: c.width, h: c.height });
      setPreview(c.toDataURL('image/jpeg', 0.95));
      const found = seedQuad(c);
      if (found) flatten(c, found); else setStage('adjust');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const onPointer = (e) => {
    if (drag < 0 || !frameRef.current || !quad) return;
    const r = frameRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * dims.w;
    const y = ((e.clientY - r.top) / r.height) * dims.h;
    setQuad((q) => q.map((p, i) => (i === drag
      ? { x: Math.max(0, Math.min(dims.w, x)), y: Math.max(0, Math.min(dims.h, y)) }
      : p)));
  };

  const useIt = () => { if (shotRef.current && quad) flatten(shotRef.current, quad); };
  const readIt = () => { if (flatFileRef.current) onScan(flatFileRef.current); };

  if (!open) return null;

  const pct = (v, total) => `${(v / total) * 100}%`;

  return (
    <div className="rs-back" role="dialog" aria-label="Scan a receipt">
      <div className="rs-panel">
        <div className="rs-head">
          <h2>{stage === 'camera' ? (heading || 'Scan a receipt') : (stage === 'preview' ? 'Check it reads clearly' : 'Line up the receipt')}</h2>
          <button type="button" className="rs-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {stage === 'camera' && (
          <>
            <div className="rs-stage">
              <video ref={videoRef} playsInline muted className="rs-video" />
              <div className="rs-guide" aria-hidden="true"><span /><span /><span /><span /></div>
              {camErr && <p className="rs-err">{camErr}</p>}
            </div>
            <p className="rs-tip">Fill the frame with the receipt, straight on, in good light. The clearer the total, the better it reads.</p>
            <div className="rs-act">
              <label className="rs-btn ghost">
                Choose a photo
                <input type="file" accept="image/*,application/pdf" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pickFile(f); }} />
              </label>
              <button type="button" className="rs-btn primary" onClick={capture} disabled={Boolean(camErr)}>
                <Icon name="Camera" size={16} /> Capture
              </button>
            </div>
          </>
        )}

        {stage === 'preview' && (
          <>
            <div className="rs-stage is-flat">
              {flatUrl && <img src={flatUrl} alt="Flattened receipt" className="rs-flat" />}
            </div>
            <p className="rs-tip">
              {detected
                ? 'Corners found automatically. Check the total is sharp and readable — that&rsquo;s the figure that matters.'
                : 'Check the total is sharp and readable before it&rsquo;s read.'}
            </p>
            <div className="rs-act">
              <button type="button" className="rs-btn ghost" onClick={() => setStage('adjust')} disabled={busy}>
                Adjust corners
              </button>
              <button type="button" className="rs-btn ghost" onClick={() => { setStage('camera'); setPreview(''); setFlatUrl(''); }} disabled={busy}>
                Retake
              </button>
              <button type="button" className="rs-btn primary" onClick={readIt} disabled={busy}>
                {busy ? (busyCta || 'Reading…') : (cta || 'Read it')}
              </button>
            </div>
          </>
        )}

        {stage === 'adjust' && (
          <>
            <div className="rs-stage">
              <div className="rs-frame" ref={frameRef}
                onPointerMove={onPointer} onPointerUp={() => setDrag(-1)} onPointerLeave={() => setDrag(-1)}>
                <img src={preview} alt="Captured receipt" className="rs-shot" />
                {quad && (
                  <>
                    <svg className="rs-quad" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none">
                      <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} />
                    </svg>
                    {quad.map((p, i) => (
                      <button key={i} type="button" className="rs-corner"
                        style={{ left: pct(p.x, dims.w), top: pct(p.y, dims.h) }}
                        onPointerDown={(e) => { e.preventDefault(); setDrag(i); }}
                        aria-label={`Corner ${i + 1}`} />
                    ))}
                  </>
                )}
              </div>
            </div>
            <p className="rs-tip">Drag the four dots onto the corners of the paper. Everything outside is cut away and the receipt is flattened before it&rsquo;s read.</p>
            <div className="rs-act">
              <button type="button" className="rs-btn ghost" onClick={() => { setStage('camera'); setPreview(''); }} disabled={busy}>
                Retake
              </button>
              <button type="button" className="rs-btn primary" onClick={useIt} disabled={busy}>
                Flatten
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
