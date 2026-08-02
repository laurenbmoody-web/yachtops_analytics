import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { parseIssueScan } from '../utils/kitLabels';
import './laundryScan.css';

// Camera scanner for uniform kit QR tags. Resolves a scanned tag to an inventory
// item (via `resolve`) and hands it back so the Issue flow can open it with its
// sizes ready. Uses the native BarcodeDetector where available (Chrome/Android);
// where it isn't (iOS Safari), the tag is a deep link the phone camera opens, so
// this degrades to a clear message plus manual code entry.
const KitScanModal = ({ resolve, onPick, onClose }) => {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const [added, setAdded] = useState([]); // names added this session, newest first
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
    const id = parseIssueScan(raw);
    const item = id ? resolve?.(id) : null;
    if (!item) { setErr('That tag isn’t a stocked item — check inventory or add it manually.'); return; }
    if (navigator.vibrate) navigator.vibrate(60);
    // Keep scanning — accumulate several tags in one session.
    setErr('');
    setManual('');
    setAdded((a) => [item.name || 'Item', ...a]);
    onPick?.(item);
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
    } catch {
      setErr('Camera unavailable — check permissions, or enter the code below.');
      setScanning(false);
    }
  };

  const submitManual = (e) => {
    e?.preventDefault?.();
    hit(manual);
  };

  return (
    <div className="lsc-overlay" role="dialog" aria-modal="true" aria-label="Scan a kit tag" onClick={onClose}>
      <div className="lsc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lsc-head">
          <div>
            <span className="lsc-eyebrow">Issue</span>
            <h2 className="lsc-title">Scan kit tags</h2>
          </div>
          <button type="button" className="lsc-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {added.length > 0 && (
          <div className="lsc-added">
            <Icon name="Check" size={14} />
            <span><b>{added.length}</b> added{added[0] ? ` · ${added[0]}` : ''}</span>
          </div>
        )}

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
                <p className="lsc-hint">Point the camera at the QR tag on the garment to issue it.</p>
              ) : (
                <p className="lsc-hint">In-app scanning isn’t supported in this browser. Enter the tag code below, or open wardrobe in Chrome to use the camera.</p>
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
          {added.length > 0 && (
            <button type="button" className="lsc-btn primary" onClick={onClose}>
              <Icon name="Check" size={16} /> Done ({added.length})
            </button>
          )}
        </div>

        <form className="lsc-manual" onSubmit={submitManual}>
          <label className="lsc-manual-l">Or enter a tag code</label>
          <div className="lsc-manual-row">
            <input className="lsc-input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Paste or type the code" />
            <button type="submit" className="lsc-btn outline" disabled={!manual.trim()}>Find</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default KitScanModal;
