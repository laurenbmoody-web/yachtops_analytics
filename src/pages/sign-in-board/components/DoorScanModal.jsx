import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import Icon from '../../../components/AppIcon';
import './door-scan.css';

// Camera QR scanner for the gangway board. Uses the native BarcodeDetector when
// present (Android / Chrome) and falls back to jsQR over canvas frames on iOS
// Safari — the actual door iPad — where BarcodeDetector isn't available.
//
// Defaults to the FRONT ('user') camera: a wall-mounted iPad's rear camera faces
// into the wall, so the front camera (facing the person) is the one that can see
// a presented pass. A flip button switches if needed. Decoding reads the raw
// (un-mirrored) frame, so a mirrored front-camera preview still scans correctly.
export default function DoorScanModal({ onClose, onDetect, title = 'Scan door pass' }) {
  const [err, setErr] = useState('');
  const [facing, setFacing] = useState('user');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detRef = useRef(null);
  const doneRef = useRef(false);
  const lastRef = useRef(0);

  const stopStream = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  const close = () => { doneRef.current = true; stopStream(); };
  useEffect(() => () => close(), []);

  const hit = (raw) => {
    const val = String(raw || '').trim();
    if (!val || doneRef.current) return;
    if (navigator.vibrate) navigator.vibrate(60);
    close();
    onDetect?.(val);
  };

  useEffect(() => {
    let alive = true;
    setErr('');
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        if (!alive || doneRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
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
    return () => { alive = false; stopStream(); };
  }, [facing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dsc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dsc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dsc-head">
          <h2 className="dsc-title">{title}</h2>
          <div className="dsc-head-r">
            <button type="button" className="dsc-flip" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} title="Switch camera">
              <Icon name="SwitchCamera" size={18} />
            </button>
            <button type="button" className="dsc-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
          </div>
        </div>
        <div className="dsc-stage">
          <video ref={videoRef} className="dsc-video" playsInline muted style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="dsc-reticle" />
        </div>
        {err
          ? <div className="dsc-err">{err}</div>
          : <p className="dsc-hint">Hold the crew member’s door-pass QR up to the camera. Use the flip button if the view is facing the wall.</p>}
      </div>
    </div>
  );
}
