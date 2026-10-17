import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import {
  guardInfo, onCaptureEvents, logSecurityEvent, sessionIdOf, platformLabel,
} from '../../lib/security/guard';
import {
  BETA_TERMS_VERSION, BETA_TERMS_TITLE, BETA_TERMS_INTRO, BETA_TERMS_SECTIONS,
} from '../../lib/security/betaTerms';
import './access-guard.css';

// Mounted once inside the router. For every signed-in user:
//   • records each new sign-in (once per device session) and, on a beta
//     (TestFlight) build, keeps at most 2 devices signed in;
//   • records screenshots / screen recordings taken in the app (iOS);
//   • on a beta build, asks for the beta terms before the app can be used.
// The App Store review demo vessel (tenants.security_exempt) skips the terms
// and the device cap.
const AccessGuard = () => {
  const location = useLocation();
  const { session, activeTenantId } = useAuth();
  const userId = session?.user?.id;
  const sessionId = sessionIdOf(session);
  const [beta, setBeta] = useState(false);
  const [exempt, setExempt] = useState(true);
  const [needsTerms, setNeedsTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => { guardInfo().then((i) => setBeta(!!i.testFlight)); }, []);

  useEffect(() => {
    if (!activeTenantId) { setExempt(true); return undefined; }
    let live = true;
    supabase.from('tenants').select('security_exempt').eq('id', activeTenantId).maybeSingle()
      .then(({ data }) => { if (live) setExempt(!!data?.security_exempt); });
    return () => { live = false; };
  }, [activeTenantId]);

  // A new sign-in on this device: record it, then apply the device cap.
  useEffect(() => {
    if (!userId || !activeTenantId || !sessionId) return;
    const key = `cargo_sec_session_${userId}`;
    let seen = null;
    try { seen = localStorage.getItem(key); } catch { /* ignore */ }
    if (seen === sessionId) return;
    try { localStorage.setItem(key, sessionId); } catch { /* ignore */ }
    logSecurityEvent({ tenantId: activeTenantId, userId, kind: 'login', screen: pathRef.current });
    guardInfo().then((i) => supabase.rpc('enforce_device_limit', { p_beta: !!i.testFlight }))
      .catch(() => {});
  }, [userId, activeTenantId, sessionId]);

  // Screenshots and screen recordings.
  useEffect(() => {
    if (!userId || !activeTenantId) return undefined;
    return onCaptureEvents((e) => {
      if (e.kind === 'screen_recording' && !e.captured) return;
      logSecurityEvent({ tenantId: activeTenantId, userId, kind: e.kind, screen: pathRef.current });
    });
  }, [userId, activeTenantId]);

  // Beta terms: has this person accepted the current version?
  const checkTerms = useCallback(async () => {
    if (!beta || exempt || !userId) { setNeedsTerms(false); return; }
    const { data, error } = await supabase.from('terms_acceptances').select('id')
      .eq('user_id', userId).eq('terms_key', 'beta').eq('version', BETA_TERMS_VERSION).limit(1);
    if (error) return; // offline / transient: don't lock anyone out
    setNeedsTerms(!(data && data.length));
  }, [beta, exempt, userId]);
  useEffect(() => { checkTerms(); }, [checkTerms]);

  const accept = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('terms_acceptances').insert({
      user_id: userId, tenant_id: activeTenantId || null, terms_key: 'beta',
      version: BETA_TERMS_VERSION, platform: platformLabel(), user_agent: navigator.userAgent,
    });
    setBusy(false);
    if (error && error.code !== '23505') { setErr('Couldn’t save — check your connection and try again.'); return; }
    setNeedsTerms(false);
  };

  const decline = async () => {
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    window.location.assign('/login-authentication');
  };

  if (!needsTerms) return null;
  return (
    <div className="ag-overlay" role="dialog" aria-modal="true" aria-labelledby="ag-title">
      <div className="ag-panel">
        <p className="ag-caps">Beta · version {BETA_TERMS_VERSION.split('-').reverse().join('/')}</p>
        <h1 id="ag-title" className="ag-title">{BETA_TERMS_TITLE}</h1>
        <div className="ag-body">
          <p className="ag-intro">{BETA_TERMS_INTRO}</p>
          {BETA_TERMS_SECTIONS.map((s) => (
            <section key={s.h} className="ag-sec">
              <h2>{s.h}</h2>
              {s.p.map((t) => <p key={t}>{t}</p>)}
            </section>
          ))}
        </div>
        {err && <p className="ag-err">{err}</p>}
        <div className="ag-actions">
          <button type="button" className="ag-btn ghost" onClick={decline} disabled={busy}>Decline and sign out</button>
          <button type="button" className="ag-btn primary" onClick={accept} disabled={busy}>{busy ? 'Saving…' : 'I agree'}</button>
        </div>
      </div>
    </div>
  );
};

export default AccessGuard;
