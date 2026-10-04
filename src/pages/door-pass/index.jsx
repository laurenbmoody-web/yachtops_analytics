import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import '../../styles/editorial.css';
import './door-pass.css';

// A crew member's personal gangway pass: a QR encoding `cargo-pass:<userId>`.
// Show it to the entry-door iPad's scanner to flip your own aboard/ashore
// status. (A signed Apple Wallet / NFC version is on the roadmap — this is the
// no-hardware interim.)
export default function DoorPass() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [name, setName] = useState('');
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!uid) return;
    supabase?.from('profiles')?.select('full_name')?.eq('id', uid)?.maybeSingle()
      .then(({ data }) => { if (data?.full_name) setName(data.full_name); });
    QRCode.toDataURL(`cargo-pass:${uid}`, { margin: 1, width: 720, color: { dark: '#1C1B3A', light: '#FFFFFF' } })
      .then(setQr).catch(() => {});
  }, [uid]);

  return (
    <div className="dpass">
      <button type="button" className="dpass-back" onClick={() => navigate(-1)}>
        <Icon name="ArrowLeft" size={16} /> Back
      </button>
      <div className="dpass-card">
        <p className="editorial-meta dpass-meta"><span className="dot">●</span><span>Gangway pass</span></p>
        <h1 className="dpass-name">{name || 'Your pass'}<span className="period">.</span></h1>
        {qr ? <img className="dpass-qr" src={qr} alt="Your gangway door pass QR code" /> : <div className="dpass-qr ph" />}
        <p className="dpass-hint">Hold this up to the entry-door iPad to sign yourself in or out.</p>
        <p className="dpass-tip">Tip: add this page to your phone’s Home Screen for one-tap access.</p>
      </div>
    </div>
  );
}
