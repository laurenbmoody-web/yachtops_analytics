import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { parseScanTarget } from '../utils/laundryLabels';
import './laundryScan.css';

// Camera scanner for laundry QR labels. Uses the native BarcodeDetector where
// available (Chrome/Android). Where it isn't (notably iOS Safari), the crew
// scan the label with the phone's own camera app — the QR is a deep link — so
// this modal degrades to a clear message plus a manual code entry.
const LaundryScanModal = ({ onClose, onDetect }) => {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const lastRef = useRef({ code: null, at: 0 });

  useEffect(() => { setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window); }, []);

  const stop = () => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => () => stop(), []);

  const hit = (raw) => {
    const now = Date.now();
    if (lastRef.current.code === raw && now - lastRef.current.at < 1600) return;
    lastRef.current = { code: raw, at: now };
    const target = parseScanTarget(raw);
    if (!target?.id) return;
    if (navigator.vibrate) navigator.vibrate(60);
    stop();
    onDetect?.(target);
  };

  const start = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const loop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) hit(codes[0].rawValue);
          } catch { /* frame not ready */ }
          loopRef.current = requestAnimationFrame(loop);
        };
        loop();
      });
    } catch (e) {
      setErr('Camera unavailable — check permissions, or enter the code below.');
      setScanning(false);
    }
  };

  const submitManual = (e) => {
    e?.preventDefault?.();
    const target = parseScanTarget(manual);
    if (target?.id) { stop(); onDetect?.(target); }
  };

  return (
    <div className="lsc-overlay" role="dialog" aria-modal="true" aria-label="Scan a laundry label" onClick={onClose}>
      <div className="lsc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lsc-head">
          <div>
            <span className="lsc-eyebrow">Laundry</span>
            <h2 className="lsc-title">Scan a label</h2>
          </div>
          <button type="button" className="lsc-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="lsc-stage">
          {scanning ? (
            <div className="lsc-camwrap">
              <video ref={videoRef} className="lsc-video" playsInline muted />
              <div className="lsc-reticle" />
            </div>
          ) : (
            <div className="lsc-idle">
              <Icon name="QrCode" size={40} />
              {supported ? (
                <p className="lsc-hint">Point the camera at the QR on the garment label.</p>
              ) : (
                <p className="lsc-hint">In-app scanning isn’t supported in this browser. Scan the label with your phone’s camera to open the item, or enter its code below.</p>
              )}
            </div>
          )}
        </div>

        {err && <div className="lsc-err">{err}</div>}

        <div className="lsc-actions">
          {supported && !scanning && (
            <button type="button" className="lsc-btn primary" onClick={start}>
              <Icon name="Camera" size={16} /> Start camera
            </button>
          )}
          {scanning && (
            <button type="button" className="lsc-btn ghost" onClick={stop}>
              <Icon name="Square" size={16} /> Stop
            </button>
          )}
        </div>

        <form className="lsc-manual" onSubmit={submitManual}>
          <label className="lsc-manual-l">Or enter a label code</label>
          <div className="lsc-manual-row">
            <input className="lsc-input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Paste or type the code" />
            <button type="submit" className="lsc-btn outline" disabled={!manual.trim()}>Open</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LaundryScanModal;
