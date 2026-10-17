import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import Icon from '../../../components/AppIcon';
import './AccessSecuritySettings.css';

// Vessel settings → Access & security (Command). Who is signed in where, and
// what the app has recorded: sign-ins, screenshots, screen recordings,
// devices signed out by the cap, and who has accepted the beta terms.
// Data: get_tenant_access_activity (auth.sessions + security_events +
// terms_acceptances) and security_events (RLS: Command of this vessel).

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// A readable device from a session's user agent.
const deviceOf = (ua = '') => {
  const s = String(ua);
  const app = /Cargo|capacitor/i.test(s) ? ' app' : '';
  if (/iPad/.test(s)) return `iPad${app}`;
  if (/iPhone/.test(s)) return `iPhone${app}`;
  if (/Android/.test(s)) return `Android${app}`;
  if (/Macintosh/.test(s)) return 'Mac · browser';
  if (/Windows/.test(s)) return 'Windows · browser';
  if (/Linux/.test(s)) return 'Linux · browser';
  return s ? 'Other device' : 'Unknown device';
};

const KIND = {
  login: { label: 'Signed in', icon: 'LogIn' },
  screenshot: { label: 'Screenshot', icon: 'Camera' },
  screen_recording: { label: 'Screen recording', icon: 'Video' },
  device_signed_out: { label: 'Device signed out (limit)', icon: 'Smartphone' },
};

const CAP_OPTIONS = [
  { v: '', l: 'No limit' }, { v: '1', l: '1 device' }, { v: '2', l: '2 devices' },
  { v: '3', l: '3 devices' }, { v: '4', l: '4 devices' }, { v: '5', l: '5 devices' },
];

export default function AccessSecuritySettings({ tenantId, canEdit }) {
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [cap, setCap] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('flags');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError('');
    const [act, ev, t] = await Promise.all([
      supabase.rpc('get_tenant_access_activity', { p_tenant: tenantId }),
      supabase.from('security_events').select('id, user_id, kind, screen, platform, device, created_at')
        .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200),
      supabase.from('tenants').select('max_devices_per_user').eq('id', tenantId).maybeSingle(),
    ]);
    if (act.error) setError(act.error.message || 'Couldn’t load activity.');
    setRows(act.data || []);
    setEvents(ev.data || []);
    setCap(t.data?.max_devices_per_user ? String(t.data.max_devices_per_user) : '');
    setLoading(false);
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  const names = useMemo(() => Object.fromEntries(rows.map((r) => [r.user_id, r.name])), [rows]);
  const shownEvents = useMemo(
    () => (filter === 'flags' ? events.filter((e) => e.kind !== 'login') : events),
    [events, filter],
  );
  const totals = useMemo(() => ({
    devices: rows.reduce((n, r) => n + (r.devices || 0), 0),
    shots: rows.reduce((n, r) => n + (r.screenshots_30d || 0), 0),
    recs: rows.reduce((n, r) => n + (r.recordings_30d || 0), 0),
    accepted: rows.filter((r) => r.terms_accepted_at).length,
  }), [rows]);

  const saveCap = async (v) => {
    setCap(v); setSaving(true);
    const { error: err } = await supabase.rpc('set_tenant_device_cap', { p_tenant: tenantId, p_max_devices: v ? Number(v) : null });
    setSaving(false);
    if (err) setError(err.message || 'Couldn’t save the device limit.');
  };

  return (
    <div className="as-wrap">
      <p className="as-lead">
        Who is signed in, on which devices, and anything that looks like copying. Screenshots and screen
        recordings are recorded on iPhone and iPad (iOS can report them but not block them). Beta testers
        must accept the beta terms and are limited to 2 devices.
      </p>

      <div className="as-stats">
        <div><span className="n">{rows.length}</span><span className="l">Crew</span></div>
        <div><span className="n">{totals.devices}</span><span className="l">Signed-in devices</span></div>
        <div className={totals.shots ? 'warn' : ''}><span className="n">{totals.shots}</span><span className="l">Screenshots · 30 days</span></div>
        <div className={totals.recs ? 'warn' : ''}><span className="n">{totals.recs}</span><span className="l">Recordings · 30 days</span></div>
        <div><span className="n">{totals.accepted}</span><span className="l">Accepted beta terms</span></div>
      </div>

      <div className="as-row as-setting">
        <div>
          <p className="as-caps">Device limit</p>
          <p className="as-sub">How many devices one person can be signed in on. Signing in on one more signs out their oldest device.</p>
        </div>
        <select className="as-select" value={cap} disabled={!canEdit || saving} onChange={(e) => saveCap(e.target.value)}>
          {CAP_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </div>

      {error && <p className="as-err"><Icon name="AlertTriangle" size={14} /> {error}</p>}

      <p className="as-caps as-h">Crew access</p>
      {loading ? <p className="as-sub">Loading…</p> : (
        <div className="as-list">
          {rows.map((r) => {
            const flagged = (r.recordings_30d || 0) > 0 || (r.screenshots_30d || 0) >= 3 || (r.devices || 0) >= 4;
            const isOpen = open === r.user_id;
            return (
              <div key={r.user_id} className={`as-person${flagged ? ' flagged' : ''}`}>
                <button type="button" className="as-person-h" onClick={() => setOpen(isOpen ? null : r.user_id)} aria-expanded={isOpen}>
                  <span className="as-name">
                    {r.name}
                    <span className="as-email">{r.email}</span>
                  </span>
                  <span className="as-pills">
                    <span className="as-pill">{r.devices || 0} device{r.devices === 1 ? '' : 's'}</span>
                    {(r.screenshots_30d || 0) > 0 && <span className="as-pill warn">{r.screenshots_30d} screenshot{r.screenshots_30d === 1 ? '' : 's'}</span>}
                    {(r.recordings_30d || 0) > 0 && <span className="as-pill warn">{r.recordings_30d} recording{r.recordings_30d === 1 ? '' : 's'}</span>}
                    <span className={`as-pill${r.terms_accepted_at ? ' ok' : ''}`}>{r.terms_accepted_at ? `Terms ${fmtDate(r.terms_accepted_at)}` : 'Terms —'}</span>
                  </span>
                  <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={16} color="#8B8478" />
                </button>
                {isOpen && (
                  <div className="as-person-b">
                    <p className="as-sub">Last active {fmtDateTime(r.last_seen_at)} · {r.logins_30d || 0} sign-ins in 30 days</p>
                    {(r.sessions || []).length === 0 ? <p className="as-sub">Not signed in anywhere.</p> : (
                      <ul className="as-sessions">
                        {r.sessions.map((s, i) => (
                          <li key={i}>
                            <span className="as-dev">{deviceOf(s.user_agent)}</span>
                            <span className="as-meta">{s.ip || 'IP unknown'} · signed in {fmtDate(s.created_at)} · active {fmtDateTime(s.last_active_at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="as-evhead">
        <p className="as-caps as-h">Activity</p>
        <div className="as-tabs">
          <button type="button" className={filter === 'flags' ? 'on' : ''} onClick={() => setFilter('flags')}>Flags only</button>
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Everything</button>
        </div>
      </div>
      {shownEvents.length === 0 ? <p className="as-sub">{loading ? '' : 'Nothing recorded yet.'}</p> : (
        <ul className="as-events">
          {shownEvents.map((e) => (
            <li key={e.id} className={e.kind === 'login' ? '' : 'flag'}>
              <Icon name={KIND[e.kind]?.icon || 'Activity'} size={15} color={e.kind === 'login' ? '#8B8478' : '#C65A1A'} />
              <span className="as-ev-t"><strong>{names[e.user_id] || 'Former crew'}</strong> · {KIND[e.kind]?.label || e.kind}{e.screen ? ` · ${e.screen}` : ''}</span>
              <span className="as-meta">{e.device || ''} · {fmtDateTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
