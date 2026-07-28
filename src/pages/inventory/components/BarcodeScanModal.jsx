import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import './barcodeScan.css';

// Generic barcode / QR scanner for the inventory item form. Uses the native
// BarcodeDetector where available (Chrome / Android). Where it isn't (notably
// iOS Safari) it degrades to a clear message plus manual entry. Returns the
// raw scanned string to the caller — it makes no assumption about the code's
// meaning (product barcode, printed Cargo QR, shelf label…).
const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'data_matrix'];

const BarcodeScanModal = ({ onClose, onDetect }) => {
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
    const val = String(raw || '').trim();
    if (!val) return;
    const now = Date.now();
    if (lastRef.current.code === val && now - lastRef.current.at < 1600) return;
    lastRef.current = { code: val, at: now };
    if (navigator.vibrate) navigator.vibrate(60);
    stop();
    onDetect?.(val);
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
        let detector;
        try {
          const avail = (await window.BarcodeDetector.getSupportedFormats?.()) || FORMATS;
          detector = new window.BarcodeDetector({ formats: FORMATS.filter((f) => avail.includes(f)) });
        } catch { detector = new window.BarcodeDetector(); }
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
      setErr('Camera unavailable — check permissions, or type the code below.');
      setScanning(false);
    }
  };

  const submitManual = (e) => {
    e?.preventDefault?.();
    const val = manual.trim();
    if (val) { stop(); onDetect?.(val); }
  };

  return (
    <div className="bsc-overlay" role="dialog" aria-modal="true" aria-label="Scan a barcode or QR" onClick={onClose}>
      <div className="bsc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bsc-head">
          <div>
            <span className="bsc-eyebrow">Inventory</span>
            <h2 className="bsc-title">Scan a code</h2>
          </div>
          <button type="button" className="bsc-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="bsc-stage">
          {scanning ? (
            <div className="bsc-camwrap">
              <video ref={videoRef} className="bsc-video" playsInline muted />
              <div className="bsc-reticle" />
            </div>
          ) : (
            <div className="bsc-idle">
              <Icon name="ScanLine" size={40} />
              {supported ? (
                <p className="bsc-hint">Point the camera at the item's barcode or a printed Cargo QR.</p>
              ) : (
                <p className="bsc-hint">In-app scanning isn't supported in this browser. Scan the code with your phone's camera, or type it below.</p>
              )}
            </div>
          )}
        </div>

        {err && <div className="bsc-err">{err}</div>}

        <div className="bsc-actions">
          {supported && !scanning && (
            <button type="button" className="bsc-btn primary" onClick={start}>
              <Icon name="Camera" size={16} /> Start camera
            </button>
          )}
          {scanning && (
            <button type="button" className="bsc-btn ghost" onClick={stop}>
              <Icon name="Square" size={16} /> Stop
            </button>
          )}
        </div>

        <form className="bsc-manual" onSubmit={submitManual}>
          <label className="bsc-manual-l">Or enter a code</label>
          <div className="bsc-manual-row">
            <input className="bsc-input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Paste or type the code" />
            <button type="submit" className="bsc-btn outline" disabled={!manual.trim()}>Use</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BarcodeScanModal;
