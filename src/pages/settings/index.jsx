import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, getTierDisplayName } from '../../utils/authStorage';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import JSZip from 'jszip';
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
// A data-visibility row: a category and a pill saying who can see it.
// who ∈ 'you' (private) · 'command' · 'crew' (everyone on board).
const VisRow = ({ label, who, whoLabel }) => (
  <div className="set-r">
    <RMain label={label} />
    <span className={`set-vis ${who}`}>{whoLabel}</span>
  </div>
);
// "Added 13/07/2026" for a passkey/factor timestamp; empty on a bad date.
const fmtFactorDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return ''; }
};
// "Chrome on macOS" from a user-agent string; best-effort, never throws.
const deviceLabel = (ua) => {
  if (!ua) return 'Unknown device';
  const os = /Windows/i.test(ua) ? 'Windows'
    : /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
    : /Macintosh|Mac OS X/i.test(ua) ? 'macOS'
    : /Android/i.test(ua) ? 'Android'
    : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari' : '';
  if (br && os) return `${br} on ${os}`;
  return br || os || 'Unknown device';
};
// Relative "3h ago" / "2d ago" for a last-active timestamp.
const relTime = (iso) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

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

const SettingsPage = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading, isVesselAdmin } = useAuth();
  const { activeTenantId } = useTenant();
  const currentUser = getCurrentUser();

  const [activeSection, setActiveSection] = useState('account');
  const [prefs, setPrefs] = useState(() => Object.fromEntries(Object.keys(PREF_DEFAULTS).map(n => [n, readPref(n)])));
  const [timezone, setTimezone] = useState(localStorage.getItem('userTimezone') || 'UTC');
  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [acct, setAcct] = useState({ name: '', email: '', avatarUrl: '', tenant: '' });
  const [planInfo, setPlanInfo] = useState({ tier: null, status: null });
  const [notifEmail, setNotifEmail] = useState('');
  const [savedNotifEmail, setSavedNotifEmail] = useState('');
  const [pendingReq, setPendingReq] = useState(null);
  const [editingNotif, setEditingNotif] = useState(false);
  const [notifStatus, setNotifStatus] = useState('');
  const [, setTick] = useState(0);

  // Contact support — an in-app modal that carries the signed-in user's identity
  // (captured server-side by submit-feedback) so support can reply directly.
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMsg, setSupportMsg] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportSent, setSupportSent] = useState(false);
  const [supportErr, setSupportErr] = useState('');
  const closeSupport = () => { setSupportOpen(false); setSupportMsg(''); setSupportErr(''); setSupportSent(false); };
  const submitSupport = async () => {
    const text = supportMsg.trim();
    if (!text || supportBusy) return;
    setSupportBusy(true); setSupportErr('');
    try {
      const { data, error } = await supabase.functions.invoke('submit-feedback', {
        body: {
          tenantId: activeTenantId || null,
          message: `[Support request] ${text}`,
          pagePath: '/settings',
          pageTitle: 'Settings — Contact support',
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userName: acct.name || '',
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'failed');
      setSupportSent(true);
    } catch (e) {
      console.warn('[settings] support submit failed', e);
      setSupportErr('Couldn’t send just now — please try again.');
    } finally {
      setSupportBusy(false);
    }
  };

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

  // Re-auth "current password" fields start read-only so the browser/password
  // manager can't silently pre-fill them — the whole point is that the user
  // re-types their password. Focus flips them editable (a manual fill dropdown
  // is still fine; a silent pre-fill isn't).
  const [loginCurRO, setLoginCurRO] = useState(true);
  const [pwCurRO, setPwCurRO] = useState(true);
  const cancelLogin = () => { setEditingLogin(false); setCurPassword(''); setNewLoginEmail(''); setLoginMsg(null); setLoginCurRO(true); };
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

  // ── Change password ────────────────────────────────────────────────────────
  const [editingPw, setEditingPw] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);
  const [pwDone, setPwDone] = useState(false);
  const cancelPw = () => { setEditingPw(false); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwMsg(null); setPwCurRO(true); };
  const submitPwChange = async () => {
    const currentEmail = (acct.email || session?.user?.email || '').toLowerCase();
    if (!pwCurrent) { setPwMsg({ t: 'err', m: 'Enter your current password' }); return; }
    if (pwNew.length < 8) { setPwMsg({ t: 'err', m: 'New password must be at least 8 characters' }); return; }
    if (pwNew !== pwConfirm) { setPwMsg({ t: 'err', m: 'Passwords don’t match' }); return; }
    if (pwNew === pwCurrent) { setPwMsg({ t: 'err', m: 'Choose a different password' }); return; }
    if (!currentEmail) { setPwMsg({ t: 'err', m: 'Couldn’t read your account' }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: currentEmail, password: pwCurrent });
      if (authErr) { setPwMsg({ t: 'err', m: 'Incorrect current password' }); setPwBusy(false); return; }
      const { error: updErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updErr) { setPwMsg({ t: 'err', m: updErr.message || 'Could not update password' }); setPwBusy(false); return; }
      cancelPw();
      setPwDone(true);
      setTimeout(() => setPwDone(false), 3000);
    } catch (e) {
      console.warn('[settings] password change failed', e);
      setPwMsg({ t: 'err', m: 'Something went wrong' });
    } finally { setPwBusy(false); }
  };

  // ── Two-factor authentication (TOTP) ────────────────────────────────────────
  // Supabase MFA is entirely client-side: enroll returns a QR + secret, the
  // user's authenticator app produces a rolling 6-digit code, challengeAndVerify
  // confirms it. A verified 'totp' factor = 2FA is on. Turning it off unenrolls.
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaFactor, setMfaFactor] = useState(null);   // the verified TOTP factor, or null
  const [mfaEnroll, setMfaEnroll] = useState(null);   // { factorId, qr, secret } mid-setup
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMsg, setMfaMsg] = useState(null);         // { t:'err'|'ok', m }
  const [mfaConfirmOff, setMfaConfirmOff] = useState(false);

  // ── Passkeys (WebAuthn, passwordless) ───────────────────────────────────────
  // These use Supabase's dedicated passkey API (auth.registerPasskey /
  // auth.passkey.*), gated by the client's experimental.passkey flag. A passkey
  // is a PRIMARY, passwordless sign-in credential — the "Sign in with a passkey"
  // button on the login page — not a second factor. The friendly name is derived
  // by the authenticator (e.g. "iCloud Keychain", "1Password").
  // Needs both a WebAuthn-capable browser AND an SDK new enough to expose the
  // passkey API (older bundles don't have auth.registerPasskey / auth.passkey).
  const passkeysSupported = typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && typeof supabase?.auth?.registerPasskey === 'function'
    && typeof supabase?.auth?.passkey?.list === 'function';
  const [passkeys, setPasskeys] = useState([]);
  const [pkLoading, setPkLoading] = useState(true);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkMsg, setPkMsg] = useState(null);
  const [pkRemoveId, setPkRemoveId] = useState(null);

  const loadFactors = useCallback(async () => {
    setMfaLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setMfaFactor((data?.totp || []).find(f => f.status === 'verified') || null);
    } catch (e) {
      console.warn('[settings] listFactors failed', e);
      setMfaFactor(null);
    } finally { setMfaLoading(false); }
  }, []);

  const loadPasskeys = useCallback(async () => {
    if (!passkeysSupported) { setPkLoading(false); return; }
    setPkLoading(true);
    try {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw error;
      setPasskeys(data || []);
    } catch (e) {
      // Throws if passkeys aren't enabled on the project — read as "none".
      console.warn('[settings] passkey list failed', e);
      setPasskeys([]);
    } finally { setPkLoading(false); }
  }, [passkeysSupported]);

  useEffect(() => { loadFactors(); loadPasskeys(); }, [loadFactors, loadPasskeys]);

  const cancelledPrompt = (msg) => /NotAllowed|abort|cancel/i.test(msg || '');

  const addPasskey = async () => {
    setPkBusy(true); setPkMsg(null);
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) {
        setPkMsg({ t: 'err', m: cancelledPrompt(error.message) ? 'Passkey setup was cancelled.' : (error.message || 'Could not add that passkey') });
        setPkBusy(false); return;
      }
      await loadPasskeys();
      setPkMsg({ t: 'ok', m: 'Passkey added' });
    } catch (e) {
      console.warn('[settings] registerPasskey failed', e);
      setPkMsg({ t: 'err', m: cancelledPrompt(e.message) ? 'Passkey setup was cancelled.' : 'Could not add that passkey' });
    } finally { setPkBusy(false); }
  };

  const removePasskey = async (id) => {
    setPkBusy(true); setPkMsg(null);
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
      if (error) throw error;
      setPkRemoveId(null);
      await loadPasskeys();
    } catch (e) {
      console.warn('[settings] passkey delete failed', e);
      setPkMsg({ t: 'err', m: e.message || 'Could not remove that passkey' });
    } finally { setPkBusy(false); }
  };

  // ── Active sessions ─────────────────────────────────────────────────────────
  // The user's own auth sessions, via SECURITY DEFINER RPCs (auth.sessions isn't
  // reachable from the client). Each is one signed-in device; revoking deletes
  // the session row, which cascades its refresh tokens so the device drops out.
  const [sessions, setSessions] = useState([]);
  const [sessLoading, setSessLoading] = useState(true);
  const [sessBusyId, setSessBusyId] = useState(null); // session id being revoked, or 'all'
  const [sessMsg, setSessMsg] = useState(null);
  const [sessConfirmAll, setSessConfirmAll] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_my_sessions');
      if (error) throw error;
      setSessions(data || []);
    } catch (e) {
      // RPC absent until the migration lands → read as empty.
      console.warn('[settings] list sessions failed', e);
      setSessions([]);
    } finally { setSessLoading(false); }
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const revokeSession = async (id) => {
    setSessBusyId(id); setSessMsg(null);
    try {
      const { error } = await supabase.rpc('revoke_my_session', { p_session_id: id });
      if (error) throw error;
      await loadSessions();
    } catch (e) {
      console.warn('[settings] revoke session failed', e);
      setSessMsg({ t: 'err', m: 'Could not sign out that device' });
    } finally { setSessBusyId(null); }
  };

  const revokeOtherSessions = async () => {
    setSessBusyId('all'); setSessMsg(null);
    try {
      const { error } = await supabase.rpc('revoke_my_other_sessions');
      if (error) throw error;
      setSessConfirmAll(false);
      await loadSessions();
      setSessMsg({ t: 'ok', m: 'Signed out other devices' });
    } catch (e) {
      console.warn('[settings] revoke other sessions failed', e);
      setSessMsg({ t: 'err', m: 'Could not sign out other devices' });
    } finally { setSessBusyId(null); }
  };

  // ── Download my data ────────────────────────────────────────────────────────
  // Gathers the personal records Cargo holds for THIS user (via RLS — own rows
  // only) into a single JSON bundle they can keep. Vessel-controlled compliance
  // records are a separate controllership and are deliberately not included.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  // ── Leave this vessel ───────────────────────────────────────────────────────
  // Deactivates the caller's own membership (via leave_tenant RPC). Personal
  // record is untouched. If it was the last vessel, flag unberthed so the app
  // lands in personal mode after reload.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveMsg, setLeaveMsg] = useState(null);
  const leaveVessel = async () => {
    const uid = session?.user?.id;
    if (!activeTenantId) { setLeaveMsg({ t: 'err', m: 'No active vessel to leave' }); return; }
    setLeaveBusy(true); setLeaveMsg(null);
    try {
      const { error } = await supabase.rpc('leave_tenant', { p_tenant: activeTenantId });
      if (error) {
        const m = /last_command/.test(error.message) ? 'You’re the last Command on this vessel — transfer command before leaving.'
          : /not_member/.test(error.message) ? 'You’re not an active member of this vessel.'
          : 'Could not leave the vessel.';
        setLeaveMsg({ t: 'err', m }); setLeaveBusy(false); return;
      }
      const { data: rem } = await supabase.from('tenant_members').select('tenant_id').eq('user_id', uid).eq('active', true);
      if (!rem || rem.length === 0) localStorage.setItem('cargo_unberthed', '1');
      ['activeTenantId', 'currentTenantId', 'last_active_tenant_id', 'tenantId', 'cargo_active_tenant_id'].forEach((k) => localStorage.removeItem(k));
      window.location.href = '/dashboard';
    } catch (e) {
      console.warn('[settings] leave vessel failed', e);
      setLeaveMsg({ t: 'err', m: 'Could not leave the vessel.' });
      setLeaveBusy(false);
    }
  };

  // ── Delete account (irreversible) ───────────────────────────────────────────
  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState(null);
  const deleteAccount = async () => {
    if (delConfirm.trim().toUpperCase() !== 'DELETE') { setDelMsg({ t: 'err', m: 'Type DELETE to confirm' }); return; }
    setDelBusy(true); setDelMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('delete-my-account', { body: { confirm: true } });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'failed');
      try { await supabase.auth.signOut(); } catch { /* already gone */ }
      try { localStorage.clear(); } catch { /* ignore */ }
      window.location.href = '/login-authentication';
    } catch (e) {
      console.warn('[settings] delete account failed', e);
      setDelMsg({ t: 'err', m: 'Could not delete your account. Please try again.' });
      setDelBusy(false);
    }
  };
  const downloadMyData = async () => {
    const uid = session?.user?.id;
    if (!uid) { setExportMsg({ t: 'err', m: 'You need to be signed in' }); return; }
    setExportBusy(true); setExportMsg(null);
    try {
      const [prof, details, docs, sea, notif] = await Promise.all([
        supabase.from('profiles').select('id, full_name, first_name, last_name, surname, avatar_url, department, created_at, updated_at').eq('id', uid).maybeSingle(),
        supabase.from('crew_personal_details').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('personal_documents').select('*').eq('user_id', uid),
        supabase.from('sea_service_entries').select('*').eq('user_id', uid),
        supabase.from('crew_notification_emails').select('*').eq('user_id', uid),
      ]);
      const documents = docs.data || [];
      const bundle = {
        export: {
          generated_at: new Date().toISOString(),
          account_email: acct.email || session?.user?.email || null,
          note: 'This is the personal data Cargo holds for your account (GDPR access + portability). Records a vessel is legally required to keep (e.g. compliance and safety logs) are controlled by that vessel and are not included here. Your uploaded document files are in the /documents folder.',
        },
        profile: prof.data ? { ...prof.data, email: acct.email || session?.user?.email || null } : null,
        personal_details: details.data || null,
        documents,
        sea_service: sea.data || [],
        notification_routing: notif.data || [],
        preferences: prefs,
      };

      // ZIP: machine-readable data + the actual files the user uploaded (Art. 20
      // portability covers data they provided, i.e. their documents — not just
      // the metadata). file_url is a long-lived signed URL, fetchable directly.
      const zip = new JSZip();
      zip.file('cargo-data.json', JSON.stringify(bundle, null, 2));
      const folder = zip.folder('documents');
      const used = new Set();
      let ok = 0, missed = 0;
      await Promise.all(documents.filter(d => d.file_url).map(async (d) => {
        try {
          const res = await fetch(d.file_url);
          if (!res.ok) throw new Error(`http ${res.status}`);
          const blob = await res.blob();
          let name = (d.file_name || `${d.doc_type || 'document'}-${d.id}`).replace(/[^\w.\-]+/g, '_');
          while (used.has(name)) name = `${d.id}-${name}`;
          used.add(name);
          folder.file(name, blob);
          ok++;
        } catch (e) { missed++; }
      }));

      const out = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cargo-my-data-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setExportMsg({ t: 'ok', m: missed ? `Downloaded — ${ok} file${ok === 1 ? '' : 's'}, ${missed} couldn’t be fetched` : 'Download started' });
    } catch (e) {
      console.warn('[settings] data export failed', e);
      setExportMsg({ t: 'err', m: 'Could not prepare your download' });
    } finally { setExportBusy(false); }
  };

  const startMfaEnroll = async () => {
    setMfaBusy(true); setMfaMsg(null);
    try {
      // Clear any half-finished (unverified) factors so a fresh enroll doesn't
      // collide on a previous abandoned attempt.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of (list?.all || []).filter(f => f.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (error) throw error;
      setMfaEnroll({ factorId: data.id, qr: data.totp?.qr_code, secret: data.totp?.secret });
      setMfaCode('');
    } catch (e) {
      console.warn('[settings] mfa enroll failed', e);
      setMfaMsg({ t: 'err', m: e.message || 'Could not start setup' });
    } finally { setMfaBusy(false); }
  };

  const verifyMfa = async () => {
    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) { setMfaMsg({ t: 'err', m: 'Enter the 6-digit code' }); return; }
    setMfaBusy(true); setMfaMsg(null);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaEnroll.factorId, code });
      if (error) { setMfaMsg({ t: 'err', m: 'That code didn’t match — use the current one from your app' }); setMfaBusy(false); return; }
      setMfaEnroll(null); setMfaCode('');
      await loadFactors();
    } catch (e) {
      console.warn('[settings] mfa verify failed', e);
      setMfaMsg({ t: 'err', m: 'Something went wrong' });
    } finally { setMfaBusy(false); }
  };

  const cancelMfaEnroll = async () => {
    const fid = mfaEnroll?.factorId;
    setMfaEnroll(null); setMfaCode(''); setMfaMsg(null);
    if (fid) { try { await supabase.auth.mfa.unenroll({ factorId: fid }); } catch { /* best effort */ } }
  };

  const disableMfa = async () => {
    if (!mfaFactor) return;
    setMfaBusy(true); setMfaMsg(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactor.id });
      if (error) throw error;
      setMfaConfirmOff(false);
      await loadFactors();
    } catch (e) {
      console.warn('[settings] mfa unenroll failed', e);
      setMfaMsg({ t: 'err', m: e.message || 'Could not turn it off' });
    } finally { setMfaBusy(false); }
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
          const { data: p } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', uid).single();
          // email is the auth session email (login address) — profiles.email is
          // no longer client-readable for self; session already has it.
          if (p) { name = p.full_name || name; avatarUrl = p.avatar_url || avatarUrl; }
        }
        const tid = localStorage.getItem('cargo_active_tenant_id');
        if (tid) {
          const { data: tn } = await supabase.from('tenants').select('name, plan_tier, subscription_status').eq('id', tid).single();
          if (tn?.name) tenant = tn.name;
          if (!cancelled) setPlanInfo({ tier: tn?.plan_tier || null, status: tn?.subscription_status || null });
        }
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

  // The membership label reflects the user's actual permission tier on this
  // vessel (Command / Chief / Head of Dept / Crew …), not a hardcoded seat.
  const currentTierRaw = (
    currentUser?.permission_tier ||
    currentUser?.permissionTier ||
    currentUser?.effectiveTier ||
    currentUser?.tier ||
    ''
  ).toUpperCase().trim();
  const currentTierLabel = currentTierRaw ? getTierDisplayName(currentTierRaw) : '';

  // The "Current plan" row shows the vessel's actual billing plan (by length),
  // not the viewer's permission tier. Source of truth: tenants.plan_tier /
  // subscription_status (mirrored from Stripe by the webhook).
  const PLAN_TIER_LABELS = { under_40m: 'Under 40m', '40_80m': '40 – 80m', over_80m: 'Over 80m' };
  const planTierLabel = planInfo.tier ? (PLAN_TIER_LABELS[planInfo.tier] || planInfo.tier) : '';
  const planChip = (() => {
    switch (planInfo.status) {
      case 'active': return { cls: 'ok', label: 'Active' };
      case 'trialing': return { cls: 'ok', label: 'Trial' };
      case 'past_due':
      case 'incomplete':
      case 'incomplete_expired': return { cls: 'warn', label: 'Payment due' };
      case 'canceled': return { cls: 'off', label: 'Cancelled' };
      default: return { cls: 'ok', label: 'Active' };
    }
  })();

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
                      readOnly={loginCurRO} onFocus={() => setLoginCurRO(false)}
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
                  <button className="set-btn" onClick={() => { setEditingLogin(true); setLoginSent(null); setLoginCurRO(true); }}>Change</button>
                </div>
              )}
              {activeTenantId && (editingNotif ? (
                <div className="set-r set-stack">
                  <RMain label="Notification email" desc={`Request to send ${acct.tenant || 'this vessel'}’s alerts to a different address.`} />
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
              ))}
            </Group>
            <Caps>Security</Caps>
            <Group>
              {editingPw ? (
                <div className="set-r set-stack">
                  <RMain label="Change password" desc="Enter your current password, then a new one." />
                  <form className="set-loginform" autoComplete="on" onSubmit={(e) => { e.preventDefault(); submitPwChange(); }}>
                    <input type="text" name="username" autoComplete="username" defaultValue={acct.email || ''} readOnly tabIndex={-1} aria-hidden="true"
                      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
                    <input className="set-field" type="password" autoComplete="current-password" placeholder="Current password"
                      readOnly={pwCurRO} onFocus={() => setPwCurRO(false)}
                      value={pwCurrent} onChange={(e) => { setPwCurrent(e.target.value); if (pwMsg) setPwMsg(null); }} />
                    <input className="set-field" type="password" autoComplete="new-password" placeholder="New password"
                      value={pwNew} onChange={(e) => { setPwNew(e.target.value); if (pwMsg) setPwMsg(null); }} />
                    <input className="set-field" type="password" autoComplete="new-password" placeholder="Confirm new password"
                      value={pwConfirm} onChange={(e) => { setPwConfirm(e.target.value); if (pwMsg) setPwMsg(null); }}
                      onKeyDown={(e) => { if (e.key === 'Escape') cancelPw(); }} />
                    <div className="set-emailrow">
                      <button type="submit" className="set-btn set-btn-primary" disabled={pwBusy}>{pwBusy ? 'Updating…' : 'Update password'}</button>
                      <button type="button" className="set-btn" onClick={cancelPw} disabled={pwBusy}>Cancel</button>
                    </div>
                    {pwMsg && <span className="set-savenote" style={{ color: pwMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{pwMsg.m}</span>}
                  </form>
                </div>
              ) : (
                <div className="set-r">
                  <RMain label="Password" desc="Change your sign-in password." />
                  {pwDone && <span className="set-savenote" style={{ color: '#3F7A52' }}>Updated</span>}
                  <button className="set-btn" onClick={() => { setEditingPw(true); setPwDone(false); setPwCurRO(true); }}>Change</button>
                </div>
              )}
              {mfaEnroll ? (
                <div className="set-r set-stack">
                  <RMain label="Set up two-factor authentication" desc="Scan the QR code with an authenticator app (1Password, Authy, Google Authenticator), then enter the 6-digit code it shows." />
                  <div className="set-mfa-setup">
                    <div className="set-mfa-qr">
                      {mfaEnroll.qr
                        ? <img src={mfaEnroll.qr} alt="Two-factor QR code" width={156} height={156} />
                        : <span className="set-mfa-qr-fallback">QR unavailable — use the key</span>}
                    </div>
                    <div className="set-mfa-manual">
                      <div className="set-mfa-manual-label">Can’t scan? Enter this key</div>
                      <code className="set-mfa-secret">{mfaEnroll.secret}</code>
                    </div>
                  </div>
                  <div className="set-emailrow">
                    <input className="set-field set-mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code"
                      value={mfaCode} autoFocus
                      onChange={(e) => { setMfaCode(e.target.value.replace(/\D/g, '')); if (mfaMsg) setMfaMsg(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); verifyMfa(); } if (e.key === 'Escape') cancelMfaEnroll(); }} />
                    <button className="set-btn set-btn-primary" onClick={verifyMfa} disabled={mfaBusy}>{mfaBusy ? 'Verifying…' : 'Verify & turn on'}</button>
                    <button className="set-btn" onClick={cancelMfaEnroll} disabled={mfaBusy}>Cancel</button>
                  </div>
                  {mfaMsg && <span className="set-savenote" style={{ color: mfaMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{mfaMsg.m}</span>}
                </div>
              ) : mfaFactor ? (
                mfaConfirmOff ? (
                  <div className="set-r set-stack">
                    <RMain label="Turn off two-factor authentication" desc="You’ll sign in with just your password again. You can set it up again any time." />
                    <div className="set-emailrow">
                      <button className="set-btn set-btn-danger" onClick={disableMfa} disabled={mfaBusy}>{mfaBusy ? 'Turning off…' : 'Turn off'}</button>
                      <button className="set-btn" onClick={() => { setMfaConfirmOff(false); setMfaMsg(null); }} disabled={mfaBusy}>Keep it on</button>
                    </div>
                    {mfaMsg && <span className="set-savenote" style={{ color: '#B23B2E' }}>{mfaMsg.m}</span>}
                  </div>
                ) : (
                  <div className="set-r">
                    <RMain label="Two-factor authentication" desc="On — you’ll enter a code from your authenticator app at sign-in." />
                    <span className="set-badge set-badge-on">On</span>
                    <button className="set-btn" onClick={() => { setMfaConfirmOff(true); setMfaMsg(null); }}>Turn off</button>
                  </div>
                )
              ) : (
                <div className="set-r">
                  <RMain label="Two-factor authentication" desc="Add an extra step at sign-in with an authenticator app." />
                  {mfaMsg && <span className="set-savenote" style={{ color: mfaMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{mfaMsg.m}</span>}
                  <button className="set-btn" onClick={startMfaEnroll} disabled={mfaBusy || mfaLoading}>{mfaBusy ? 'Starting…' : 'Set up'}</button>
                </div>
              )}
              {!passkeysSupported ? (
                <div className="set-r"><RMain label="Passkeys" desc="Sign in with Face ID, Touch ID or a security key." /><span className="set-soon">Unavailable</span></div>
              ) : (
                <>
                  {passkeys.map((pk) => (
                    pkRemoveId === pk.id ? (
                      <div key={pk.id} className="set-r set-stack">
                        <RMain label={`Remove “${pk.friendly_name || 'Passkey'}”?`} desc="You won’t be able to sign in with this passkey anymore." />
                        <div className="set-emailrow">
                          <button className="set-btn set-btn-danger" onClick={() => removePasskey(pk.id)} disabled={pkBusy}>{pkBusy ? 'Removing…' : 'Remove'}</button>
                          <button className="set-btn" onClick={() => { setPkRemoveId(null); setPkMsg(null); }} disabled={pkBusy}>Keep</button>
                        </div>
                        {pkMsg && pkMsg.t === 'err' && <span className="set-savenote" style={{ color: '#B23B2E' }}>{pkMsg.m}</span>}
                      </div>
                    ) : (
                      <div key={pk.id} className="set-r">
                        <RMain label={pk.friendly_name || 'Passkey'} desc={pk.created_at ? `Added ${fmtFactorDate(pk.created_at)}` : 'Passkey'} />
                        <span className="set-badge set-badge-on">Active</span>
                        <button className="set-btn" onClick={() => { setPkRemoveId(pk.id); setPkMsg(null); }}>Remove</button>
                      </div>
                    )
                  ))}
                  <div className="set-r">
                    <RMain
                      label={passkeys.length ? 'Add another passkey' : 'Passkeys'}
                      desc={passkeys.length ? 'Register another device or security key.' : 'Sign in without a password using Face ID, Touch ID or a security key.'}
                    />
                    {pkMsg && !pkRemoveId && <span className="set-savenote" style={{ color: pkMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{pkMsg.m}</span>}
                    <button className="set-btn" onClick={addPasskey} disabled={pkBusy || pkLoading}>
                      {pkBusy ? 'Waiting…' : (passkeys.length ? 'Add' : 'Set up')}
                    </button>
                  </div>
                </>
              )}
            </Group>
            <Caps>Active sessions</Caps>
            <Group>
              {sessLoading ? (
                <div className="set-r"><RMain label="Devices" desc="Where you’re currently signed in." /><span className="set-r-val muted">Loading…</span></div>
              ) : sessions.length === 0 ? (
                <div className="set-r"><RMain label="Devices" desc="Where you’re currently signed in." /><span className="set-r-val muted">—</span></div>
              ) : (
                <>
                  {sessions.map((s) => (
                    <div key={s.id} className="set-r">
                      <RMain
                        label={deviceLabel(s.user_agent)}
                        desc={`${s.is_current ? 'This device' : `Last active ${relTime(s.refreshed_at)}`}${s.ip ? ` · ${s.ip}` : ''}`}
                      />
                      {s.is_current ? (
                        <span className="set-badge set-badge-on">Current</span>
                      ) : (
                        <button className="set-btn" onClick={() => revokeSession(s.id)} disabled={sessBusyId === s.id}>
                          {sessBusyId === s.id ? 'Signing out…' : 'Sign out'}
                        </button>
                      )}
                    </div>
                  ))}
                  {sessions.some((s) => !s.is_current) && (
                    sessConfirmAll ? (
                      <div className="set-r set-stack">
                        <RMain label="Sign out all other devices?" desc="Every session except this one will end immediately." />
                        <div className="set-emailrow">
                          <button className="set-btn set-btn-danger" onClick={revokeOtherSessions} disabled={sessBusyId === 'all'}>{sessBusyId === 'all' ? 'Signing out…' : 'Sign out others'}</button>
                          <button className="set-btn" onClick={() => { setSessConfirmAll(false); setSessMsg(null); }} disabled={sessBusyId === 'all'}>Cancel</button>
                        </div>
                        {sessMsg && sessMsg.t === 'err' && <span className="set-savenote" style={{ color: '#B23B2E' }}>{sessMsg.m}</span>}
                      </div>
                    ) : (
                      <div className="set-r">
                        <RMain label="Sign out everywhere else" desc="End every session except this device." />
                        {sessMsg && <span className="set-savenote" style={{ color: sessMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{sessMsg.m}</span>}
                        <button className="set-btn" onClick={() => { setSessConfirmAll(true); setSessMsg(null); }}>Sign out others</button>
                      </div>
                    )
                  )}
                </>
              )}
            </Group>

            {activeTenantId && (<>
            <Caps>Vessel membership</Caps>
            <Group>
              {leaveOpen ? (
                <div className="set-r set-stack">
                  <RMain danger label={`Leave ${acct.tenant || 'this vessel'}?`} desc="You’ll come off this vessel’s crew list. Your profile, documents and sea service stay with you and travel to your next vessel. The vessel keeps only records it’s legally required to hold." />
                  <div className="set-emailrow">
                    <button className="set-btn set-btn-danger" onClick={leaveVessel} disabled={leaveBusy}>{leaveBusy ? 'Leaving…' : 'Leave vessel'}</button>
                    <button className="set-btn" onClick={() => { setLeaveOpen(false); setLeaveMsg(null); }} disabled={leaveBusy}>Cancel</button>
                  </div>
                  {leaveMsg && <span className="set-savenote" style={{ color: '#B23B2E' }}>{leaveMsg.m}</span>}
                </div>
              ) : (
                <div className="set-r">
                  <RMain label="Leave this vessel" desc={acct.tenant ? `Come off ${acct.tenant}. Your personal record stays yours.` : 'Come off this vessel. Your personal record stays yours.'} />
                  <button className="set-btn" onClick={() => { setLeaveOpen(true); setLeaveMsg(null); }}>Leave</button>
                </div>
              )}
            </Group>
            </>)}
          </>
        );

      case 'privacy':
        return (
          <>
            <h2 className="set-h">Privacy &amp; data</h2>
            <p className="set-hsub">See exactly who can access your information, and take a copy with you.</p>

            {activeTenantId ? (
              <>
                <Caps>What your vessel can see</Caps>
                <Group>
                  <VisRow label="Name &amp; photo" who="crew" whoLabel="Everyone on board" />
                  <VisRow label="Role &amp; department" who="crew" whoLabel="Everyone on board" />
                  <VisRow label="Email address" who="command" whoLabel="Command only" />
                  <VisRow label="Contact details &amp; next of kin" who="command" whoLabel="Command only" />
                  <VisRow label="Documents — passport, CoC, visas, medical" who="command" whoLabel="Command only" />
                  <VisRow label="Sea-service record" who="command" whoLabel="Command only" />
                  <VisRow label="Password, 2FA, passkeys &amp; sessions" who="you" whoLabel="You only" />
                </Group>
              </>
            ) : (
              <>
                <Caps>Who can see your record</Caps>
                <Group>
                  <div className="set-r">
                    <RMain label="Only you" desc="You’re not on a vessel, so no one else can see your profile, documents or sea service. When you join a vessel, a visibility breakdown appears here." />
                    <span className="set-vis you">You only</span>
                  </div>
                </Group>
              </>
            )}

            <Caps>Your data</Caps>
            <Group>
              <div className="set-r">
                <RMain label="Download my data" desc="A ZIP of your profile, personal details, sea service and your uploaded document files — yours to keep and take to your next boat." />
                {exportMsg && <span className="set-savenote" style={{ color: exportMsg.t === 'err' ? '#B23B2E' : '#3F7A52' }}>{exportMsg.m}</span>}
                <button className="set-btn" onClick={downloadMyData} disabled={exportBusy}>{exportBusy ? 'Preparing…' : 'Download'}</button>
              </div>
              <RowNav label="Correct my details" desc="Update your name, contact details and documents." ext onClick={() => navigate('/my-profile')} />
            </Group>

            <Caps>Consent &amp; tracking</Caps>
            <Group>
              <RowToggle label="Product analytics" desc="Cargo uses no third-party or advertising trackers. Leave this on to allow anonymous product analytics if we ever add it." on={prefs.analytics} onChange={() => toggle('analytics')} />
              <div className="set-r">
                <RMain label="Cookies &amp; storage" desc="Only essential storage, used to keep you signed in. No advertising cookies." />
                <span className="set-vis you">Essential only</span>
              </div>
            </Group>

            <Caps>Account</Caps>
            <Group>
              {delOpen ? (
                <div className="set-r set-stack">
                  <RMain danger label="Delete account" desc="This permanently erases your Cargo account and personal data — profile, documents, personal details and sea service. It can’t be undone. A vessel may still hold compliance records it’s legally required to keep." />
                  <form className="set-loginform" onSubmit={(e) => { e.preventDefault(); deleteAccount(); }}>
                    <input className="set-field" placeholder="Type DELETE to confirm" autoFocus value={delConfirm}
                      onChange={(e) => { setDelConfirm(e.target.value); if (delMsg) setDelMsg(null); }} />
                    <div className="set-emailrow">
                      <button type="submit" className="set-btn set-btn-danger" disabled={delBusy}>{delBusy ? 'Deleting…' : 'Delete my account'}</button>
                      <button type="button" className="set-btn" onClick={() => { setDelOpen(false); setDelConfirm(''); setDelMsg(null); }} disabled={delBusy}>Cancel</button>
                    </div>
                    {delMsg && <span className="set-savenote" style={{ color: '#B23B2E' }}>{delMsg.m}</span>}
                  </form>
                </div>
              ) : (
                <div className="set-r">
                  <RMain danger label="Delete account" desc="Permanently erase your Cargo account and personal data." />
                  <button className="set-btn set-btn-danger" onClick={() => { setDelOpen(true); setDelConfirm(''); setDelMsg(null); }}>Delete</button>
                </div>
              )}
            </Group>
          </>
        );

      case 'membership':
        return (
          <>
            <h2 className="set-h">Membership</h2>
            <p className="set-hsub">Your plan and billing.</p>
            <Group>
              {activeTenantId ? (
                <RowNav label="Current plan" desc={planTierLabel ? `Cargo — ${planTierLabel}` : 'Cargo — active membership'} chip={<span className={`set-chip ${planChip.cls}`}>{planChip.label}</span>} onClick={() => navigate('/membership')} />
              ) : (
                <div className="set-r">
                  <RMain label="Current plan" desc="You’re not on a vessel — your account and personal record travel with you until you join one." />
                  <span className="set-chip off">Inactive · no vessel</span>
                </div>
              )}
              {/* Billing is the subscription owner’s concern — only the vessel
                  admin (tenants.current_admin_user_id): the person who signed the
                  vessel up as admin, or whoever it was transferred to. */}
              {activeTenantId && isVesselAdmin && (
                <RowNav label="Billing" desc="Manage payment and invoices." onClick={() => navigate('/membership')} />
              )}
              {/* The setup guide lives on the vessel dashboard — nothing to restore without one. */}
              {activeTenantId && (
                <div className="set-r">
                  <RMain label="Onboarding tour" desc="Restore the setup guide on your dashboard." />
                  <button className="set-btn" onClick={handleRestoreTour}>Show again</button>
                </div>
              )}
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
            {/* Category toggles are all vessel-operational — only meaningful aboard. */}
            {activeTenantId ? (
              <>
                <Caps>By category</Caps>
                <Group>
                  <RowToggle label="Jobs & tasks" on={prefs.catJobs} onChange={() => toggle('catJobs')} />
                  <RowToggle label="Hours of Rest" on={prefs.catHor} onChange={() => toggle('catHor')} />
                  <RowToggle label="Provisioning approvals" on={prefs.catProvisioning} onChange={() => toggle('catProvisioning')} />
                  <RowToggle label="Trips & guests" on={prefs.catTrips} onChange={() => toggle('catTrips')} />
                  <RowToggle label="Defects" on={prefs.catDefects} onChange={() => toggle('catDefects')} />
                </Group>
              </>
            ) : (
              <>
                <Caps>By category</Caps>
                <Group>
                  <div className="set-r">
                    <RMain label="Vessel notifications" desc="Rota, Hours of Rest, provisioning, trips and defects resume when you join a vessel." />
                    <span className="set-chip off">Paused</span>
                  </div>
                </Group>
              </>
            )}
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
              <RowNav ext label="Terms of Service" desc="The agreement for using Cargo." onClick={() => window.open('/terms', '_blank', 'noopener')} />
              <RowNav ext label="Privacy Policy" desc="How we handle your data." onClick={() => window.open('/privacy', '_blank', 'noopener')} />
              <RowNav ext label="Cookie Policy" desc="Cookies & storage — essential only." onClick={() => window.open('/privacy#cookies', '_blank', 'noopener')} />
            </Group>
          </>
        );

      case 'help':
        return (
          <>
            <h2 className="set-h">Help &amp; support</h2>
            <p className="set-hsub">Guides, contact and version.</p>
            <Group>
              <RowNav ext label="FAQ" desc="Answers to common questions." onClick={() => window.open('/faq', '_blank', 'noopener')} />
              <RowNav label="Contact support" desc="Message the Cargo team — we’ll reply to you directly." onClick={() => { setSupportSent(false); setSupportMsg(''); setSupportErr(''); setSupportOpen(true); }} />
              <RowNav label="Report a bug" desc="Send feedback or flag an issue." onClick={() => window.dispatchEvent(new Event('cargo:open-feedback'))} />
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
          {/* Back — off a vessel, full navigation so the personal-mode landing
              (rendered outside the router) shows instead of the guarded dash. */}
          <button
            type="button"
            onClick={() => { if (activeTenantId) navigate('/dashboard'); else window.location.href = '/dashboard'; }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#8B8478', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 16 }}
          >
            <Icon name="ChevronLeft" size={16} /> {activeTenantId ? 'Back to Dashboard' : 'Back'}
          </button>
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
                    {/* One entry that jumps straight to the vessel settings page,
                        which hosts its own sections (profile, locations, roles…). */}
                    <button className="set-nav-it" onClick={() => navigate('/settings/vessel')}>
                      <Icon name="Ship" size={17} color="#8B8478" />
                      <span>Vessel settings</span>
                      <Icon name="ArrowUpRight" size={14} className="set-ext" />
                    </button>
                  </>
                )}
              </nav>
            </aside>

            {/* Content */}
            <div className="set-content">{renderContent()}</div>
          </div>
        </div>
      </div>

      {/* Contact support modal — pre-attaches the signed-in user so support can reply. */}
      {supportOpen && (
        <div
          onClick={() => !supportBusy && closeSupport()}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(28,27,58,0.32)', display: 'grid', placeItems: 'center', padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', border: '1px solid #ECEAE3', borderRadius: 16, boxShadow: '0 24px 60px -16px rgba(28,27,58,0.32)', width: '100%', maxWidth: 440, padding: '24px 24px 20px' }}>
            <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 22, color: '#1C1B3A', margin: '0 0 6px' }}>Contact support</h2>
            {supportSent ? (
              <>
                <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: '0 0 18px' }}>
                  Thanks — your message is with the Cargo team. We’ll reply to <strong>{acct.email || 'your account email'}</strong>.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="set-btn set-btn-primary" onClick={closeSupport}>Done</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.6, margin: '0 0 14px' }}>
                  Send us a message and we’ll get back to you at <strong>{acct.email || 'your account email'}</strong>.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: '#FAFAF8', border: '1px solid #ECEAE3', marginBottom: 12 }}>
                  <Icon name="User" size={15} color="#8B8478" />
                  <span style={{ fontSize: 12.5, color: '#6B7280' }}>
                    {acct.name || 'You'}{acct.tenant ? ` · ${acct.tenant}` : ''}
                  </span>
                </div>
                <textarea
                  className="set-field"
                  autoFocus
                  rows={5}
                  placeholder="How can we help?"
                  value={supportMsg}
                  onChange={(e) => { setSupportMsg(e.target.value); if (supportErr) setSupportErr(''); }}
                  style={{ width: '100%', resize: 'vertical', minHeight: 100, fontFamily: 'inherit' }}
                />
                {supportErr && <div style={{ marginTop: 8, fontSize: 13, color: '#B23B2E' }}>{supportErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button type="button" className="set-btn" onClick={closeSupport} disabled={supportBusy}>Cancel</button>
                  <button type="button" className="set-btn set-btn-primary" onClick={submitSupport} disabled={supportBusy || !supportMsg.trim()}>
                    {supportBusy ? 'Sending…' : 'Send message'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SettingsPage;
