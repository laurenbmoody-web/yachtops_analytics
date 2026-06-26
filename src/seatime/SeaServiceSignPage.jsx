import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import CaptainSignoff from './CaptainSignoff';
import { buildSpellTestimonialPdf, bytesToBase64 } from './packExport';
import './captain-signoff.css';

// /sea-service/sign/:token — public, no-login captain sign-off for a master who
// has no Cargo account (the "email for signature" route). Mirrors the supplier
// /delivery-sign/:token pattern: read via fetch_sea_service_sign_request (a
// SECURITY DEFINER RPC) and write via sign_/decline_sea_service_sign_request.
// Possession of the token IS the authorisation — no session required.

const Shell = ({ children }) => (
  <div style={{ minHeight: '100vh', background: '#FAFAF8', padding: '28px 16px 64px',
    fontFamily: "'Inter', system-ui, sans-serif", color: '#1C1B3A' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 22 }}>
      <img src="/centered-logo.svg" alt="Cargo" style={{ height: 30, width: 'auto', objectFit: 'contain' }} />
      <span style={{ color: '#D8D4CB', fontWeight: 300, fontSize: 22, lineHeight: 1 }}>|</span>
      <span style={{ fontSize: 11, color: '#8B8478', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sea-service sign-off</span>
    </div>
    <div style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #ECEAE3',
      borderRadius: 16, boxShadow: '0 24px 60px -16px rgba(28,27,58,0.18)', overflow: 'hidden' }}>
      <div style={{ height: 4, background: '#1C1B3A' }} aria-hidden="true" />
      {children}
    </div>
    <p style={{ textAlign: 'center', marginTop: 26, fontSize: 11, color: '#AEB4C2' }}>
      Powered by Cargo · cargotechnology.co.uk
    </p>
  </div>
);

const Notice = ({ title, body, tone = 'neutral' }) => {
  const c = tone === 'good' ? '#3F7A52' : tone === 'bad' ? '#A32D2D' : '#1C1B3A';
  return (
    <div style={{ padding: '56px 28px', textAlign: 'center' }}>
      <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, fontSize: 24, margin: '0 0 10px', color: c }}>{title}</h2>
      <p style={{ margin: '0 auto', maxWidth: 420, fontSize: 14, lineHeight: 1.6, color: '#6B7280' }}>{body}</p>
    </div>
  );
};

export default function SeaServiceSignPage() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading'); // loading | ready | not_found | already | expired | done | declined
  const [info, setInfo] = useState(null);          // fetch payload
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!token) { setStatus('not_found'); return; }
    (async () => {
      try {
        const { data, error } = await supabase.rpc('fetch_sea_service_sign_request', { p_token: token });
        if (error) throw error;
        if (!data) { setStatus('not_found'); return; }
        setInfo(data);
        if (data.status === 'pending') setStatus('ready');
        else if (data.status === 'signed') setStatus('already');
        else if (data.status === 'declined') setStatus('declined');
        else setStatus('expired');
      } catch (e) { console.error('[SeaServiceSign] fetch', e); setStatus('not_found'); }
    })();
  }, [token]);

  const onSign = async (record) => {
    setErr('');
    const sig = record?.signature?.kind === 'drawn' ? record.signature.image : (record?.signature?.text ? `typed:${record.signature.text}` : null);
    try {
      const { data, error } = await supabase.rpc('sign_sea_service_sign_request', {
        p_token: token, p_signer_name: record.name, p_coc_no: record.cocNo, p_coc_grade: record.cocGrade,
        p_email: record.email, p_phone: record.phone, p_place: record.place,
        p_cmd_from: record.cmdFrom || null, p_cmd_to: record.cmdTo || null, p_signature: sig,
      });
      if (error) throw error;
      if (!data?.ok) { setErr(data?.error === 'expired' ? 'This link has expired.' : 'This link has already been used.'); return; }
      // Generate + store the per-ship testimonial PDF (best-effort, never blocks).
      try {
        const unit = info?.snapshot?.unit || {};
        const bytes = await buildSpellTestimonialPdf({
          seafarer: info?.snapshot?.seafarer || { fullName: info?.seafarer_name },
          vessel: { name: unit.name, flag: unit.flag, imo: unit.imo, gt: unit.gt, lengthM: unit.lengthM },
          periods: unit.periods || [],
          signatory: { name: record.name, rank: 'Master', cocNumber: record.cocNo, signedAt: new Date().toISOString().slice(0, 10) },
        });
        await supabase.functions.invoke('store-seatime-testimonial', { body: { token, pdfBase64: bytesToBase64(bytes) } });
      } catch (e2) { console.error('[SeaServiceSign] testimonial', e2); }
      // Notify the seafarer (bell + email) — best-effort, never blocks the sign.
      supabase.functions.invoke('notify-seatime-signoff', { body: { action: 'signed', token } }).catch(() => {});
      setStatus('done');
    } catch (e) { console.error('[SeaServiceSign] sign', e); setErr('Something went wrong — please try again.'); }
  };

  const onDecline = async (reason) => {
    setErr('');
    try {
      const { error } = await supabase.rpc('decline_sea_service_sign_request', { p_token: token, p_reason: reason || null });
      if (error) throw error;
      supabase.functions.invoke('notify-seatime-signoff', { body: { action: 'declined', token } }).catch(() => {});
      setStatus('declined');
    } catch (e) { console.error('[SeaServiceSign] decline', e); setErr('Something went wrong — please try again.'); }
  };

  if (status === 'loading') return <Shell><Notice title="Loading…" body="Fetching the sea-service record." /></Shell>;
  if (status === 'not_found') return <Shell><Notice tone="bad" title="Link not found" body="This signing link is invalid or has expired. Ask the seafarer to send a fresh one." /></Shell>;
  if (status === 'expired') return <Shell><Notice tone="bad" title="Link expired" body="This signing link is no longer valid. Ask the seafarer to send a fresh one." /></Shell>;
  if (status === 'already') return <Shell><Notice tone="good" title="Already signed" body={`This sea-service testimonial was signed${info?.signed_name ? ` by ${info.signed_name}` : ''}. Nothing more to do.`} /></Shell>;
  if (status === 'declined') return <Shell><Notice title="Declined" body="This request was declined and handed back to the seafarer to correct." /></Shell>;
  if (status === 'done') return <Shell><Notice tone="good" title="Service confirmed" body={`Thank you — your testimonial for ${info?.seafarer_name || 'the seafarer'} has been recorded. You can close this page.`} /></Shell>;

  const unit = info?.snapshot?.unit || {};
  const seafarer = info?.snapshot?.seafarer || { fullName: info?.seafarer_name || 'Seafarer' };
  return (
    <Shell>
      <CaptainSignoff
        variant="pane"
        unit={unit}
        seafarer={seafarer}
        signerName={info?.captain_name ? String(info.captain_name).replace('Capt. ', '') : ''}
        onSign={onSign}
        onDecline={onDecline}
      />
      {err && <div style={{ padding: '0 28px 24px', color: '#A32D2D', fontSize: 13, fontWeight: 600 }}>{err}</div>}
    </Shell>
  );
}
