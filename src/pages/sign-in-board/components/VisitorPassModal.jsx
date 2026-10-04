import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Icon from '../../../components/AppIcon';
import { encodeVisitorPass } from '../utils/visitorPass';
import './visitor-pass.css';

// Shows a visitor's personal gangway QR. They photograph it (or you print it);
// next visit they hold it to the door scanner to sign straight back in.
export default function VisitorPassModal({ visitor, onClose }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!visitor) return;
    QRCode.toDataURL(encodeVisitorPass(visitor), { margin: 1, width: 640, color: { dark: '#1C1B3A', light: '#FFFFFF' } })
      .then(setQr).catch(() => {});
  }, [visitor]);

  if (!visitor) return null;
  return (
    <div className="vpass-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vpass">
        <button type="button" className="vpass-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        <p className="vpass-eyebrow">● Gangway pass</p>
        <h3 className="vpass-name">{visitor.name}</h3>
        {visitor.company && <p className="vpass-co">{visitor.company}</p>}
        {qr ? <img className="vpass-qr" src={qr} alt="Visitor gangway pass QR" /> : <div className="vpass-qr ph" />}
        <p className="vpass-hint">Snap a photo of this. Next time, hold it to the door scanner to sign in or out — no re-typing.</p>
        <p className="vpass-print"><button type="button" onClick={() => window.print()}>Print this pass</button></p>
      </div>
    </div>
  );
}
