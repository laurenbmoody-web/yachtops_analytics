import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import './settings.css';

// ── Preference persistence (instant, silent save to localStorage) ────────────
const PREF_DEFAULTS = {
  emailNotifications: true, pushNotifications: true,
  catJobs: true, catTrips: true, catHor: true, catProvisioning: true, catDefects: true,
  quietHours: false, digest: 'off',
  dateFormat: 'dmy', hour24: false, units: 'metric', firstDay: 'mon',
  analytics: true,
};
// name → [localStorage key, type]. Channel/task/trip keys reuse the existing
// ones so nothing already saved is lost.
const PREF_KEY = {
  emailNotifications: ['emailNotifications', 'bool'],
  pushNotifications: ['pushNotifications', 'bool'],
  catJobs: ['taskReminders', 'bool'],
  catTrips: ['tripUpdates', 'bool'],
  catHor: ['notif_cat_hor', 'bool'],
  catProvisioning: ['notif_cat_provisioning', 'bool'],
  catDefects: ['notif_cat_defects', 'bool'],
  quietHours: ['notif_quiet_enabled', 'bool'],
  digest: ['notif_digest', 'str'],
  dateFormat: ['date_format', 'str'],
  hour24: ['time_24h', 'bool'],
  units: ['units', 'str'],
  firstDay: ['first_day', 'str'],
  analytics: ['analytics_opt_in', 'bool'],
};
const readPref = (name) => {
  const [k, t] = PREF_KEY[name];
  const v = localStorage.getItem(k);
  if (v == null) return PREF_DEFAULTS[name];
  return t === 'bool' ? v !== 'false' : v;
};

const getInitials = (name) => (name || '')
  .split(' ').filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'U';

// ── Small building blocks ────────────────────────────────────────────────────
const Group = ({ children }) => <div className="set-group">{children}</div>;
const Caps = ({ children }) => <div className="set-caps">{children}</div>;
const RMain = ({ label, desc, danger }) => (
  <div className="set-r-main">
    <div className={`set-r-label${danger ? ' danger' : ''}`}>{label}</div>
    {desc && <div className="set-r-desc">{desc}</div>}
  </div>
);
const Switch = ({ on, onChange, disabled, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
    className={`set-switch${on ? ' is-on' : ''}`} onClick={onChange}><span className="set-knob" /></button>
);
const Seg = ({ options, value, onChange, label }) => (
  <div className="set-seg" role="group" aria-label={label}>
    {options.map(o => (
      <button key={o.v} className={value === o.v ? 'on' : ''} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.l}</button>
    ))}
  </div>
);
const RowNav = ({ label, desc, value, chip, onClick, ext }) => (
  <button type="button" className="set-r" onClick={onClick}>
    <RMain label={label} desc={desc} />
    {value && <span className="set-r-val">{value}</span>}
    {chip}
    <span className="set-go"><Icon name={ext ? 'ArrowUpRight' : 'ChevronRight'} size={ext ? 16 : 17} /></span>
  </button>
);
const RowToggle = ({ label, desc, on, onChange }) => (
  <div className="set-r"><RMain label={label} desc={desc} /><Switch on={on} onChange={onChange} label={label} /></div>
);
const RowSeg = ({ label, desc, options, value, onChange }) => (
  <div className="set-r"><RMain label={label} desc={desc} /><Seg options={options} value={value} onChange={onChange} label={label} /></div>
);
const RowSoon = ({ label, desc }) => (
  <div className="set-r"><RMain label={label} desc={desc} /><span className="set-soon">Soon</span></div>
);

const NAV = [
  { grp: 'Account', items: [
    { id: 'account', label: 'Account', icon: 'User' },
    { id: 'privacy', label: 'Privacy & data', icon: 'Lock' },
    { id: 'membership', label: 'Membership', icon: 'CreditCard' },
  ] },
  { grp: 'Preferences', items: [
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'regional', label: 'Regional', icon: 'Globe' },
  ] },
  { grp: 'Support', items: [
    { id: 'legal', label: 'Legal', icon: 'FileText' },
    { id: 'help', label: 'Help', icon: 'HelpCircle' },
  ] },
];
const VESSEL_ITEMS = [
  { id: 'vessel-profile', label: 'Vessel Profile', icon: 'Ship' },
  { id: 'location-management', label: 'Locations', icon: 'MapPin' },
  { id: 'role-management', label: 'Roles', icon: 'Users' },
  { id: 'provisioning-approval', label: 'Provisioning Approval', icon: 'CheckCircle' },
];

const SettingsPage = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const currentUser = getCurrentUser();

  const [activeSection, setActiveSection] = useState('account');
  const [prefs, setPrefs] = useState(() => Object.fromEntries(Object.keys(PREF_DEFAULTS).map(n => [n, readPref(n)])));
  const [timezone, setTimezone] = useState(localStorage.getItem('userTimezone') || 'UTC');
  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [acct, setAcct] = useState({ name: '', email: '', avatarUrl: '', tenant: '' });
  const [notifEmail, setNotifEmail] = useState('');
  const [savedNotifEmail, setSavedNotifEmail] = useState('');
  const [pendingReq, setPendingReq] = useState(null);
  const [editingNotif, setEditingNotif] = useState(false);
  const [notifStatus, setNotifStatus] = useState('');
  const [, setTick] = useState(0);

  // Notification email is vessel-governed: crew REQUEST an address, Command
  // approves it (Vessel Settings › Notification Requests). Approval writes
  // crew_notification_emails; here we only raise / cancel the request.
  const submitNotifRequest = async () => {
    const uid = session?.user?.id;
    const tid = localStorage.getItem('cargo_active_tenant_id');
    const val = notifEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) { setNotifStatus('Enter a valid email'); return; }
    if (!uid || !tid) return;
    try {
      const { data, error } = await supabase.from('notification_email_requests')
        .insert({ tenant_id: tid, user_id: uid, requested_email: val, status: 'pending' })
        .select('id, requested_email, requested_at').single();
      if (error) throw error;
      setPendingReq(data);
      setEditingNotif(false);
      setNotifStatus('');
    } catch (e) {
      console.warn('[settings] notification email request failed', e);
      setNotifStatus('Couldn’t send request');
    }
  };
  const cancelNotifRequest = async () => {
    if (!pendingReq) return;
    try { await supabase.from('notification_email_requests').delete().eq('id', pendingReq.id); } catch { /* ignore */ }
    setPendingReq(null);
  };

  // ── Change login (auth) email — secure flow ────────────────────────────────
  // Re-auth with the current password, then supabase.auth.updateUser({ email })
  // which fires Supabase's confirmation email(s). The change only lands once
  // confirmed; with "Secure email change" on, the CURRENT address must confirm
  // too. This is deliberately NOT a plain profile field.
  const [editingLogin, setEditingLogin] = useState(false);
  const [curPassword, setCurPassword] = useState('');
  const [newLoginEmail, setNewLoginEmail] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMsg, setLoginMsg] = useState(null); // { t: 'err'|'ok', m }
  const [loginSent, setLoginSent] = useState(null); // the pending new address

  const cancelLogin = () => { setEditingLogin(false); setCurPassword(''); setNewLoginEmail(''); setLoginMsg(null); };
  const submitLoginEmailChange = async () => {
    const newE = newLoginEmail.trim().toLowerCase();
    const currentEmail = (acct.email || session?.user?.email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newE)) { setLoginMsg({ t: 'err', m: 'Enter a valid email' }); return; }
    if (newE === currentEmail) { setLoginMsg({ t: 'err', m: 'That’s already your login email' }); return; }
    if (!curPassword) { setLoginMsg({ t: 'err', m: 'Enter your current password' }); return; }
    if (!currentEmail) { setLoginMsg({ t: 'err', m: 'Couldn’t read your current email' }); return; }
    setLoginBusy(true); setLoginMsg(null);
    try {
      // 1. Re-authenticate — verifies the password before anything changes.
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: currentEmail, password: curPassword });
      if (authErr) { setLoginMsg({ t: 'err', m: 'Incorrect password' }); setLoginBusy(false); return; }
      // 2. Request the change — Supabase emails the confirmation link(s).
      const { error: updErr } = await supabase.auth.updateUser({ email: newE }, { emailRedirectTo: `${window.location.origin}/settings` });
      if (updErr) { setLoginMsg({ t: 'err', m: updErr.message || 'Could not start the change' }); setLoginBusy(false); return; }
      setLoginSent(newE);
      setEditingLogin(false);
      setCurPassword(''); setNewLoginEmail('');
    } catch (e) {
      console.warn('[settings] login email change failed', e);
      setLoginMsg({ t: 'err', m: 'Something went wrong' });
    } finally { setLoginBusy(false); }
  };

  const setPref = (name, val) => {
    const [k, t] = PREF_KEY[name];
    localStorage.setItem(k, t === 'bool' ? String(val) : val);
    setPrefs(p => ({ ...p, [name]: val }));
  };
  const toggle = (name) => setPref(name, !prefs[name]);
  const setTz = (v) => { localStorage.setItem('userTimezone', v); setTimezone(v); setTzOpen(false); };

  // Editorial token re-skin while mounted.
  useEffect(() => {
    document.body.classList.add('settings-editorial');
    return () => document.body.classList.remove('settings-editorial');
  }, []);

  // Live clock for the timezone preview.
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30_000); return () => clearInterval(id); }, []);

  // Account-card data (best effort; falls back to session/local).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = session?.user?.id;
      let name = currentUser?.full_name || session?.user?.user_metadata?.full_name || '';
      let email = session?.user?.email || currentUser?.email || '';
      let avatarUrl = session?.user?.user_metadata?.avatar_url || '';
      let tenant = '';
      try {
        if (uid) {
          const { data: p } = await supabase.from('profiles').select('full_name, email, avatar_url').eq('id', uid).single();
          if (p) { name = p.full_name || name; email = p.email || email; avatarUrl = p.avatar_url || avatarUrl; }
        }
        const tid = localStorage.getItem('cargo_active_tenant_id');
        if (tid) { const { data: tn } = await supabase.from('tenants').select('name').eq('id', tid).single(); if (tn?.name) tenant = tn.name; }
        if (uid && tid) {
          const { data: ne } = await supabase.from('crew_notification_emails').select('email').eq('user_id', uid).eq('tenant_id', tid).maybeSingle();
          if (!cancelled && ne?.email) { setNotifEmail(ne.email); setSavedNotifEmail(ne.email); }
          const { data: pr } = await supabase.from('notification_email_requests')
            .select('id, requested_email, requested_at').eq('user_id', uid).eq('tenant_id', tid).eq('status', 'pending')
            .order('requested_at', { ascending: false }).limit(1).maybeSingle();
          if (!cancelled && pr) setPendingReq(pr);
        }
      } catch { /* ignore (table may not exist until migration lands) */ }
      if (!cancelled) setAcct({ name, email, avatarUrl, tenant });
    })();
    return () => { cancelled = true; };
  }, [session]);

  const canAccessVessel = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);

  const timezones = [
    { value: 'UTC', label: 'UTC — Coordinated Universal Time', offset: '+00:00' },
    { value: 'America/New_York', label: 'New York (Eastern)', offset: '-05:00' },
    { value: 'America/Chicago', label: 'Chicago (Central)', offset: '-06:00' },
    { value: 'America/Denver', label: 'Denver (Mountain)', offset: '-07:00' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific)', offset: '-08:00' },
    { value: 'America/Sao_Paulo', label: 'São Paulo', offset: '-03:00' },
    { value: 'Europe/London', label: 'London (GMT/BST)', offset: '+00:00' },
    { value: 'Europe/Paris', label: 'Paris (CET)', offset: '+01:00' },
    { value: 'Europe/Madrid', label: 'Madrid (CET)', offset: '+01:00' },
    { value: 'Europe/Rome', label: 'Rome (CET)', offset: '+01:00' },
    { value: 'Europe/Athens', label: 'Athens (EET)', offset: '+02:00' },
    { value: 'Europe/Istanbul', label: 'Istanbul (TRT)', offset: '+03:00' },
    { value: 'Africa/Cairo', label: 'Cairo (EET)', offset: '+02:00' },
    { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: '+04:00' },
    { value: 'Asia/Karachi', label: 'Karachi (PKT)', offset: '+05:00' },
    { value: 'Asia/Kolkata', label: 'Mumbai/Kolkata (IST)', offset: '+05:30' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: '+08:00' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', offset: '+08:00' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: '+09:00' },
    { value: 'Australia/Sydney', label: 'Sydney (AEDT)', offset: '+11:00' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZDT)', offset: '+13:00' },
  ];
  const filteredTz = timezones.filter(tz =>
    tz.label.toLowerCase().includes(tzSearch.toLowerCase()) ||
    tz.value.toLowerCase().includes(tzSearch.toLowerCase()) ||
    tz.offset.includes(tzSearch));
  const tzLabel = timezones.find(t => t.value === timezone)?.label || timezone;
  const zoneTime = (() => {
    if (!timezone || timezone.startsWith('Manual GMT')) return null;
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: !prefs.hour24 }).format(new Date()); }
    catch { return null; }
  })();

  const renderContent = () => {
    switch (activeSection) {
      case 'account':
        return (
          <>
            <h2 className="set-h">Account</h2>
            <p className="set-hsub">Your identity, sign-in and security.</p>
            <Group>
              <RowNav label="Profile" desc="Name, photo, personal details, documents." ext onClick={() => navigate('/my-profile')} />
            </Group>
            <Caps>Email</Caps>
            <Group>
              {editingLogin ? (
                <div className="set-r set-stack">
                  <RMain label="Change login email" desc="We’ll email a link to your new address to confirm the change." />
                  <form className="set-loginform" autoComplete="on" onSubmit={(e) => { e.preventDefault(); submitLoginEmailChange(); }}>
                    {/* Hidden username scopes the password autofill to this form,
                        so Chrome fills here rather than the nav search bar. */}
                    <input type="text" name="username" autoComplete="username" defaultValue={acct.email || ''} readOnly tabIndex={-1} aria-hidden="true"
                      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
                    <input className="set-field" type="password" autoComplete="current-password" placeholder="Current password"
                      value={curPassword} onChange={(e) => { setCurPassword(e.target.value); if (loginMsg) setLoginMsg(null); }} />
                    <input className="set-field" type="email" autoComplete="off" placeholder="New login email"
                      value={newLoginEmail}
                      onChange={(e) => { setNewLoginEmail(e.target.value); if (loginMsg) setLoginMsg(null); }}
                      onKeyDown={(e) => { if (e.key === 'Escape') cancelLogin(); }} />
                    <div className="set-emailrow">
                      <button type="submit" className="set-btn set-btn-primary" disabled={loginBusy}>{loginBusy ? 'Sending…' : 'Send confirmation'}</button>
                      <button type="button" className="set-btn" onClick={cancelLogin} disabled={loginBusy}>Cancel</button>
                    </div>
                    {loginMsg && <span className="set-savenote" style={{ color: loginMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{loginMsg.m}</span>}
                  </form>
                </div>
              ) : (
                <div className="set-r">
                  <RMain label="Login email" desc={loginSent ? `Confirmation sent to ${loginSent}. Check that inbox and your current email to finish.` : 'Where you sign in — your account address.'} />
                  <span className="set-r-val">{acct.email || '—'}</span>
                  <button className="set-btn" onClick={() => { setEditingLogin(true); setLoginSent(null); }}>Change</button>
                </div>
              )}
              {editingNotif ? (
                <div className="set-r set-stack">
                  <RMain label="Notification email" desc={`Request to send ${acct.tenant || 'this vessel'}’s alerts to a different address. Command approves the change.`} />
                  <div className="set-emailrow">
                    <input
                      className="set-field"
                      type="email"
                      placeholder="e.g. interior@vessel.com"
                      autoFocus
                      value={notifEmail}
                      onChange={(e) => { setNotifEmail(e.target.value); if (notifStatus) setNotifStatus(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNotifRequest(); } if (e.key === 'Escape') { setEditingNotif(false); setNotifEmail(savedNotifEmail); } }}
                    />
                    <button className="set-btn set-btn-primary" onClick={submitNotifRequest}>Request change</button>
                    <button className="set-btn" onClick={() => { setEditingNotif(false); setNotifEmail(savedNotifEmail); setNotifStatus(''); }}>Cancel</button>
                  </div>
                  {notifStatus && <span className="set-savenote" style={{ color: '#B23B2E' }}>{notifStatus}</span>}
                </div>
              ) : pendingReq ? (
                <div className="set-r">
                  <RMain label="Notification email" desc={`Requested ${pendingReq.requested_email} — awaiting Command approval.`} />
                  <span className="set-badge">Pending</span>
                  <button className="set-btn" onClick={cancelNotifRequest}>Cancel</button>
                </div>
              ) : (
                <div className="set-r">
                  <RMain label="Notification email" desc={savedNotifEmail ? `Where ${acct.tenant || 'this vessel'}’s alerts are sent.` : 'Using your login email.'} />
                  <span className={`set-r-val${savedNotifEmail ? '' : ' muted'}`}>{savedNotifEmail || 'Login email'}</span>
                  <button className="set-btn" onClick={() => { setEditingNotif(true); setNotifEmail(savedNotifEmail); }}>{savedNotifEmail ? 'Change' : 'Add'}</button>
                </div>
              )}
            </Group>
            <Caps>Security</Caps>
            <Group>
              <RowSoon label="Password" desc="Change your sign-in password." />
              <RowSoon label="Two-factor authentication" desc="Add an extra step at sign-in." />
              <RowSoon label="Passkeys" desc="Sign in with Face ID / Touch ID." />
              <RowSoon label="Active sessions" desc="See and sign out other devices." />
            </Group>
          </>
        );

      case 'privacy':
        return (
          <>
            <h2 className="set-h">Privacy &amp; data</h2>
            <p className="set-hsub">Control your data.</p>
            <Group>
              <RowSoon label="Export my data" desc="Download a copy of your records." />
              <RowToggle label="Usage analytics" desc="Help improve Cargo with anonymous usage data." on={prefs.analytics} onChange={() => toggle('analytics')} />
              <RowSoon label="Delete account" desc="Permanently remove your account." />
            </Group>
          </>
        );

      case 'membership':
        return (
          <>
            <h2 className="set-h">Membership</h2>
            <p className="set-hsub">Your plan and billing.</p>
            <Group>
              <RowNav label="Current plan" desc="Cargo — Command seat" chip={<span className="set-chip ok">Active</span>} onClick={() => navigate('/membership')} />
              <RowNav label="Billing" desc="Manage payment and invoices." onClick={() => navigate('/membership')} />
              <div className="set-r">
                <RMain label="Onboarding tour" desc="Restore the setup guide on your dashboard." />
                <button className="set-btn" onClick={handleRestoreTour}>Show again</button>
              </div>
            </Group>
          </>
        );

      case 'notifications':
        return (
          <>
            <h2 className="set-h">Notifications</h2>
            <p className="set-hsub">Choose what reaches you, how, and when.</p>
            <Caps>Channels</Caps>
            <Group>
              <RowToggle label="Email" desc="Receive notifications by email." on={prefs.emailNotifications} onChange={() => toggle('emailNotifications')} />
              <RowToggle label="Push" desc="In-browser push notifications." on={prefs.pushNotifications} onChange={() => toggle('pushNotifications')} />
            </Group>
            <Caps>By category</Caps>
            <Group>
              <RowToggle label="Jobs & tasks" on={prefs.catJobs} onChange={() => toggle('catJobs')} />
              <RowToggle label="Hours of Rest" on={prefs.catHor} onChange={() => toggle('catHor')} />
              <RowToggle label="Provisioning approvals" on={prefs.catProvisioning} onChange={() => toggle('catProvisioning')} />
              <RowToggle label="Trips & guests" on={prefs.catTrips} onChange={() => toggle('catTrips')} />
              <RowToggle label="Defects" on={prefs.catDefects} onChange={() => toggle('catDefects')} />
            </Group>
            <Caps>Timing</Caps>
            <Group>
              <div className="set-r">
                <RMain label="Quiet hours" desc="Hold non-urgent alerts overnight." />
                <span className="set-r-val">22:00 – 07:00</span>
                <Switch on={prefs.quietHours} onChange={() => toggle('quietHours')} label="Quiet hours" />
              </div>
              <RowSeg label="Digest" desc="A summary instead of live pings." value={prefs.digest} onChange={(v) => setPref('digest', v)}
                options={[{ v: 'off', l: 'Off' }, { v: 'daily', l: 'Daily' }, { v: 'weekly', l: 'Weekly' }]} />
            </Group>
          </>
        );

      case 'regional':
        return (
          <>
            <h2 className="set-h">Regional</h2>
            <p className="set-hsub">Time, dates and units across Cargo.</p>
            <Group>
              <button type="button" className="set-r" onClick={() => setTzOpen(o => !o)}>
                <RMain label="Time zone" />
                <span className="set-r-val">{tzLabel}{zoneTime ? <> · <b>{zoneTime}</b></> : null}</span>
                <span className="set-go"><Icon name={tzOpen ? 'ChevronDown' : 'ChevronRight'} size={17} /></span>
              </button>
              {tzOpen && (
                <div className="set-tzpanel">
                  <div className="set-search">
                    <span className="set-searchic"><Icon name="Search" size={16} color="#AEB4C2" /></span>
                    <input className="set-field" placeholder="Search time zones…" value={tzSearch} onChange={(e) => setTzSearch(e.target.value)} />
                  </div>
                  <div className="set-tzlist">
                    {filteredTz.map(tz => (
                      <button key={tz.value} className={`set-tzitem${timezone === tz.value ? ' is-sel' : ''}`} onClick={() => setTz(tz.value)}>
                        <span className="set-tzname">{tz.label}</span>
                        <span className="set-tzoff">{tz.offset}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <RowSeg label="Date format" value={prefs.dateFormat} onChange={(v) => setPref('dateFormat', v)}
                options={[{ v: 'dmy', l: 'DD/MM/YYYY' }, { v: 'mdy', l: 'MM/DD/YYYY' }]} />
              <RowToggle label="24-hour time" desc="Show 15:42 rather than 3:42 PM." on={prefs.hour24} onChange={() => toggle('hour24')} />
              <RowSeg label="Units" value={prefs.units} onChange={(v) => setPref('units', v)}
                options={[{ v: 'metric', l: 'Metric' }, { v: 'imperial', l: 'Imperial' }]} />
              <RowSeg label="First day of week" value={prefs.firstDay} onChange={(v) => setPref('firstDay', v)}
                options={[{ v: 'mon', l: 'Mon' }, { v: 'sun', l: 'Sun' }]} />
            </Group>
          </>
        );

      case 'legal':
        return (
          <>
            <h2 className="set-h">Legal</h2>
            <p className="set-hsub">Terms, privacy and cookies.</p>
            <Group>
              <RowNav label="Terms of Service" onClick={() => {}} />
              <RowNav label="Privacy Policy" onClick={() => {}} />
              <RowNav label="Cookie Policy" onClick={() => {}} />
            </Group>
          </>
        );

      case 'help':
        return (
          <>
            <h2 className="set-h">Help &amp; support</h2>
            <p className="set-hsub">Guides, contact and version.</p>
            <Group>
              <RowNav label="Documentation" onClick={() => {}} />
              <RowNav label="Contact support" onClick={() => {}} />
              <RowNav label="Report a bug" onClick={() => {}} />
              <div className="set-r"><div className="set-r-main"><div className="set-r-label" style={{ color: '#8B8478', fontWeight: 400 }}>Version 1.0.0</div></div></div>
            </Group>
          </>
        );

      default:
        return null;
    }
  };

  const handleRestoreTour = async () => {
    try {
      await supabase.from('profiles').update({ dashboard_tutorial_dismissed_at: null }).eq('id', session?.user?.id);
      localStorage.removeItem('cg_tutorial_pill_hidden');
      navigate('/dashboard');
    } catch (err) { console.warn('[settings] restore tutorial failed', err); }
  };

  if (authLoading) {
    return (
      <>
        <Header />
        <div className="settings-page"><div className="set-loading"><div className="set-spinner" /></div></div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="settings-page">
        <div className="set-wrap">
          <div className="set-layout">
            {/* Rail */}
            <aside className="set-rail">
              <nav>
                {NAV.map((group, gi) => (
                  <React.Fragment key={group.grp}>
                    <div className={`set-nav-grp${gi === 0 ? ' first' : ''}`}>{group.grp}</div>
                    {group.items.map(item => (
                      <button key={item.id} className={`set-nav-it${activeSection === item.id ? ' active' : ''}`} onClick={() => setActiveSection(item.id)}>
                        <Icon name={item.icon} size={17} color={activeSection === item.id ? '#C65A1A' : '#8B8478'} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </React.Fragment>
                ))}
                {canAccessVessel && (
                  <>
                    <div className="set-nav-grp">Vessel</div>
                    {VESSEL_ITEMS.map(item => (
                      <button key={item.id} className="set-nav-it" onClick={() => navigate(`/settings/vessel?section=${item.id}`)}>
                        <Icon name={item.icon} size={17} color="#8B8478" />
                        <span>{item.label}</span>
                        <Icon name="ArrowUpRight" size={14} className="set-ext" />
                      </button>
                    ))}
                  </>
                )}
              </nav>
            </aside>

            {/* Content */}
            <div className="set-content">{renderContent()}</div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SettingsPage;
