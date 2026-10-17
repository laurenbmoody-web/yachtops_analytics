import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { amIPlatformAdmin } from './utils';
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
};

const SecurityAlertsConsole = () => {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vessel, setVessel] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: err } = await supabase.rpc('list_security_alerts', { p_limit: 300 });
    if (err) setError(err.message || 'Couldn’t load alerts.');
    setRows(data || []);
    setLoading(false);
    supabase.rpc('mark_security_alerts_seen').then(() => {}, () => {});
  }, []);

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
