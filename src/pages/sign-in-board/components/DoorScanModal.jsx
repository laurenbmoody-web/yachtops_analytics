import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import Icon from '../../../components/AppIcon';
import './door-scan.css';

// Camera QR scanner for the gangway board. Uses the native BarcodeDetector when
// present (Android / Chrome) and falls back to jsQR over canvas frames on iOS
// Safari — the actual door iPad — where BarcodeDetector isn't available.
// getUserMedia works on iOS Safari over HTTPS. Returns the raw scanned string.
export default function DoorScanModal({ onClose, onDetect, title = 'Scan door pass' }) {
  const [err, setErr] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detRef = useRef(null);
  const doneRef = useRef(false);
  const lastRef = useRef(0);

  const stop = () => {
    doneRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stop(), []);

  const hit = (raw) => {
    const val = String(raw || '').trim();
    if (!val || doneRef.current) return;
    if (navigator.vibrate) navigator.vibrate(60);
    stop();
    onDetect?.(val);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
        if ('BarcodeDetector' in window) {
          try { detRef.current = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detRef.current = null; }
        }
        const canvas = canvasRef.current;
        const loop = async () => {
          if (doneRef.current || !streamRef.current) return;
          const now = performance.now();
          if (now - lastRef.current > 120 && video.readyState >= 2) {
            lastRef.current = now;
            try {
              if (detRef.current) {
                const codes = await detRef.current.detect(video);
                if (codes?.length) { hit(codes[0].rawValue); return; }
              } else {
                const w = video.videoWidth; const h = video.videoHeight;
                if (w && h) {
                  canvas.width = w; canvas.height = h;
                  const ctx = canvas.getContext('2d', { willReadFrequently: true });
                  ctx.drawImage(video, 0, 0, w, h);
                  const img = ctx.getImageData(0, 0, w, h);
                  const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
                  if (res?.data) { hit(res.data); return; }
                }
              }
            } catch { /* frame not ready */ }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        if (alive) setErr('Camera unavailable — allow camera access for this site, then try again.');
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dsc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dsc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dsc-head">
          <h2 className="dsc-title">{title}</h2>
          <button type="button" className="dsc-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
        </div>
        <div className="dsc-stage">
          <video ref={videoRef} className="dsc-video" playsInline muted />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="dsc-reticle" />
        </div>
        {err
          ? <div className="dsc-err">{err}</div>
          : <p className="dsc-hint">Hold the crew member’s door-pass QR up to the camera.</p>}
      </div>
    </div>
  );
}
