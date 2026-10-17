import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { amIPlatformAdmin } from './utils';
import { alertPushSupported, enableAlertsOnThisDevice } from '../../lib/security/alertPush';
import '../../styles/editorial.css';
import './security-console.css';

// Cargo console → Security. Platform admins only (Cargo the company, not a
// vessel's crew): every security alert across all vessels — screen
// recordings, screenshot bursts, accounts on too many devices. New alerts
// are also pushed to the admins' devices (edge function security-alert-push).

const pad = (n) => String(n).padStart(2, '0');
const fmt = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const REASON = {
  screen_recording: { label: 'Screen recording', icon: 'Video' },
  screenshots: { label: 'Screenshots', icon: 'Camera' },
  too_many_devices: { label: 'Device limit hit', icon: 'Smartphone' },
  many_devices: { label: 'Possible shared account', icon: 'Users' },
  test: { label: 'Test alert', icon: 'Send' },
};

const DEVICE_MSG = {
  denied: 'Notifications are blocked for this site/app — allow them in your browser or iPhone settings, then try again.',
  dismissed: 'Notifications weren’t allowed. Tap the button again and choose Allow.',
  unsupported: 'This browser can’t receive notifications. On iPhone, use the Cargo app.',
  no_session: 'Sign in again, then try.',
  save_failed: 'Couldn’t save this device — try again.',
  register_failed: 'This phone couldn’t register for notifications — try again.',
};

const SecurityAlertsConsole = () => {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vessel, setVessel] = useState('all');
  const [recips, setRecips] = useState([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState(null); // { t: 'ok'|'err', m }
  const [busy, setBusy] = useState('');

  const loadRecips = useCallback(async () => {
    const { data } = await supabase.rpc('list_security_alert_recipients');
    setRecips(data || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: err } = await supabase.rpc('list_security_alerts', { p_limit: 300 });
    if (err) setError(err.message || 'Couldn’t load alerts.');
    setRows(data || []);
    setLoading(false);
    loadRecips();
    supabase.rpc('mark_security_alerts_seen').then(() => {}, () => {});
  }, [loadRecips]);

  const run = async (key, fn) => {
    setBusy(key); setNote(null);
    try { await fn(); } catch (e) { setNote({ t: 'err', m: e?.message || 'Something failed — try again.' }); }
    setBusy('');
  };
  const thisDevice = () => run('device', async () => {
    const r = await enableAlertsOnThisDevice();
    setNote(r?.ok ? { t: 'ok', m: 'This device will get security alerts. Send a test to check.' } : { t: 'err', m: DEVICE_MSG[r?.reason] || 'Couldn’t set up this device.' });
    loadRecips();
  });
  const sendTest = () => run('test', async () => {
    const { error: err } = await supabase.rpc('send_test_security_alert');
    if (err) throw err;
    setNote({ t: 'ok', m: 'Test alert sent — it should arrive on every device below within a few seconds.' });
    setTimeout(load, 1500);
  });
  const addRecip = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    run('add', async () => {
      const { error: err } = await supabase.rpc('add_security_alert_recipient', { p_email: email.trim() });
      if (err) throw err;
      setEmail('');
      setNote({ t: 'ok', m: 'Added. Devices signed in to that account now get alerts (no console access).' });
      loadRecips();
    });
  };
  const removeRecip = (uid) => run(`rm-${uid}`, async () => {
    const { error: err } = await supabase.rpc('remove_security_alert_recipient', { p_user: uid });
    if (err) throw err;
    loadRecips();
  });

  useEffect(() => {
    amIPlatformAdmin().then((ok) => { setAllowed(ok); if (ok) load(); else setLoading(false); });
  }, [load]);

  const vessels = useMemo(() => [...new Set(rows.map((r) => r.vessel).filter(Boolean))].sort(), [rows]);
  const shown = vessel === 'all' ? rows : rows.filter((r) => r.vessel === vessel);
  const unseen = rows.filter((r) => !r.seen_at).length;
  const week = rows.filter((r) => Date.now() - new Date(r.created_at).getTime() < 7 * 864e5).length;

  return (
    <>
      <Header />
      <div className="sc-page">
        <div className="sc-wrap">
          <button type="button" className="sc-back" onClick={() => navigate('/dashboard')}>
            <Icon name="ChevronLeft" size={16} /> Back
          </button>
          <p className="editorial-meta">
            <span className="dot">●</span><span>Cargo console</span>
            <span className="bar" /><span className="muted">{week} this week</span>
            {unseen > 0 && (<><span className="bar" /><span className="muted">{unseen} new</span></>)}
          </p>
          <h1 className="editorial-greeting">Security<span className="period">,</span> <em>watched</em><span className="period">.</span></h1>
          <p className="sc-lead">
            Alerts from every vessel, for Cargo only — never shown to a vessel’s crew. Each vessel’s Command can
            see its own crew’s activity under Vessel settings → Access &amp; Security.
          </p>

          {allowed === false ? (
            <p className="sc-empty">This page is for the Cargo team only.</p>
          ) : (
            <>
              <section className="sc-devices">
                <p className="sc-caps">Where alerts are pushed</p>
                <div className="sc-actions">
                  {alertPushSupported() && (
                    <button type="button" className="sc-btn primary" onClick={thisDevice} disabled={!!busy}>
                      <Icon name="BellRing" size={15} color="#FFFFFF" /> {busy === 'device' ? 'Setting up…' : 'Get alerts on this device'}
                    </button>
                  )}
                  <button type="button" className="sc-btn" onClick={sendTest} disabled={!!busy}>
                    <Icon name="Send" size={15} /> {busy === 'test' ? 'Sending…' : 'Send test alert'}
                  </button>
                </div>
                {note && <p className={`sc-note ${note.t}`}>{note.m}</p>}
                <ul className="sc-recips">
                  {recips.map((r) => (
                    <li key={r.user_id}>
                      <div className="sc-main">
                        <p className="sc-t">{r.email}<span className="sc-vessel">{r.kind === 'admin' ? 'Console admin' : 'Alerts only'}</span></p>
                        <p className="sc-m">{r.devices ? `${r.devices} device${r.devices === 1 ? '' : 's'} enrolled` : 'No device enrolled yet — sign in on the device and allow notifications'}</p>
                      </div>
                      {r.kind !== 'admin' && (
                        <button type="button" className="sc-link" onClick={() => removeRecip(r.user_id)} disabled={!!busy}>Remove</button>
                      )}
                    </li>
                  ))}
                </ul>
                <form className="sc-add" onSubmit={addRecip}>
                  <input className="sc-input" type="email" placeholder="Add an account's email (alerts only, no console)" value={email}
                    onChange={(e) => setEmail(e.target.value)} />
                  <button type="submit" className="sc-btn" disabled={!!busy || !email.trim()}>Add</button>
                </form>
              </section>

              <p className="sc-caps sc-h">Alerts</p>
              {vessels.length > 1 && (
                <div className="sc-tabs">
                  <button type="button" className={vessel === 'all' ? 'on' : ''} onClick={() => setVessel('all')}>All vessels</button>
                  {vessels.map((v) => (
                    <button key={v} type="button" className={vessel === v ? 'on' : ''} onClick={() => setVessel(v)}>{v}</button>
                  ))}
                </div>
              )}
              {error && <p className="sc-err">{error}</p>}
              {loading ? <p className="sc-empty">Loading…</p> : shown.length === 0 ? (
                <p className="sc-empty">No alerts. Screen recordings, bursts of screenshots and shared logins will show here.</p>
              ) : (
                <ul className="sc-list">
                  {shown.map((r) => (
                    <li key={r.id} className={r.seen_at ? '' : 'new'}>
                      <span className="sc-ic"><Icon name={REASON[r.reason]?.icon || 'ShieldAlert'} size={16} color="#C65A1A" /></span>
                      <div className="sc-main">
                        <p className="sc-t">{REASON[r.reason]?.label || r.reason}<span className="sc-vessel">{r.vessel || '—'}</span></p>
                        <p className="sc-d">{r.detail}</p>
                        <p className="sc-m">{r.email || ''} · {fmt(r.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default SecurityAlertsConsole;
