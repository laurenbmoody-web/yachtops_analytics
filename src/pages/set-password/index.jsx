import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';
import './set-password.css';

// Capture the URL hash at module-load time, BEFORE the Supabase client's
// `detectSessionInUrl` handler strips it. Invite redirects from Supabase
// come back as `#access_token=…&refresh_token=…&type=invite&…`, and the
// `type=invite` marker is our strongest signal that this page load is a
// legitimate invite acceptance and not a signed-in user poking at the URL.
//
// Note: this module is imported eagerly from Routes.jsx at app boot, so
// this line runs before any auth side-effects. It's a one-shot capture
// held in a module-level constant so re-renders don't lose it.
const INITIAL_HASH =
  typeof window !== 'undefined' && window.location ? window.location.hash || '' : '';
const INVITE_HASH_DETECTED = /(^|[#&])type=invite(&|$)/.test(INITIAL_HASH);

// How recently the session must have been minted to count as a "fresh"
// invite. Supabase invite sessions are usable for longer than this, but
// the spec wants us to refuse anyone who's been logged in for a while
// and happens to navigate to /set-password. 10 minutes gives slow
// users (email clients that add delay, link-prefetch lag) a buffer.
const FRESH_INVITE_WINDOW_MS = 10 * 60 * 1000;

const LOGO_SRC = '/assets/images/cargo_merged_originalmark_syne800_true.png';

const SetPassword = () => {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // 'checking' | 'valid' | 'invalid' | 'already-signed-in'
  const [sessionState, setSessionState] = useState('checking');

  // Strip the auth hash from the URL after Supabase has processed it so
  // we don't accidentally log it to Sentry/analytics later. We only do
  // this once, after the session check completes successfully.
  const hashCleanedRef = useRef(false);

  useEffect(() => {
    checkInviteSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkInviteSession = async () => {
    try {
      console.log('SET_PASSWORD: Checking for fresh invite session', {
        inviteHashDetected: INVITE_HASH_DETECTED,
      });

      // The Supabase client's detectSessionInUrl processes hash-fragment
      // tokens asynchronously during client init. If the user was
      // redirected here by InviteHashRedirectGuard (e.g. they landed on
      // /welcome first), the session might already be in localStorage.
      // But if they arrived directly at /set-password with the hash, the
      // client might still be processing. We poll getSession() with a
      // short back-off to handle both cases robustly.
      let session = null;
      let sessionError = null;
      const MAX_ATTEMPTS = 6; // Up to ~3 seconds total
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { data, error } = await supabase?.auth?.getSession();
        session = data?.session;
        sessionError = error;

        if (session || sessionError) break; // Got something, stop polling

        // No session yet — wait and retry. detectSessionInUrl is async
        // and may still be exchanging the hash tokens for a session.
        const delayMs = attempt <= 2 ? 200 : 500;
        console.log(`SET_PASSWORD: No session yet (attempt ${attempt}/${MAX_ATTEMPTS}), waiting ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
      }

      if (sessionError) {
        console.error('SET_PASSWORD: getSession error', sessionError);
        setSessionState('invalid');
        return;
      }

      if (!session || !session?.user) {
        console.log('SET_PASSWORD: No session found');
        setSessionState('invalid');
        return;
      }

      const user = session.user;

      // Freshness check — a legitimate invite flow will have a session
      // minted seconds ago. Use last_sign_in_at (falls back to
      // confirmed_at/created_at) since that's when Supabase wrote the
      // token that's currently in localStorage.
      const mintedAtStr =
        user?.last_sign_in_at || user?.confirmed_at || user?.created_at;
      const mintedAt = mintedAtStr ? new Date(mintedAtStr).getTime() : NaN;
      const ageMs = Number.isFinite(mintedAt) ? Date.now() - mintedAt : Infinity;
      const isFresh = ageMs >= 0 && ageMs < FRESH_INVITE_WINDOW_MS;

      // Invite signal — either the hash we captured at load time said
      // `type=invite`, or Supabase stamped the user with `invited_at`
      // when the admin invite endpoint was called. Either on its own is
      // enough; together they're bulletproof.
      const hasInviteMarker = INVITE_HASH_DETECTED || !!user?.invited_at;

      console.log('SET_PASSWORD: session diagnostics', {
        userId: user?.id,
        email: user?.email,
        invited_at: user?.invited_at,
        last_sign_in_at: user?.last_sign_in_at,
        ageSeconds: Math.round(ageMs / 1000),
        isFresh,
        hasInviteMarker,
      });

      if (!hasInviteMarker || !isFresh) {
        // Session exists but this isn't an invite flow — it's a
        // returning signed-in user who wandered to this URL. Don't let
        // them reset their password here; forgot-password is for that.
        console.warn(
          'SET_PASSWORD: Session is not a fresh invite, refusing access'
        );
        setSessionState('already-signed-in');
        return;
      }

      // Pre-fill any name Supabase captured in user_metadata so the
      // user doesn't have to re-type what they gave Stripe at checkout.
      const metaFullName =
        user?.user_metadata?.full_name || user?.user_metadata?.name || '';
      if (metaFullName && typeof metaFullName === 'string') {
        const parts = metaFullName.trim().split(/\s+/);
        if (parts.length >= 1) setFirstName(parts[0]);
        if (parts.length >= 2) setSurname(parts.slice(1).join(' '));
      }

      setSessionState('valid');

      // Scrub the hash from the URL now that we've captured what we
      // need. Supabase usually does this already, but being explicit
      // means we don't leak tokens into any URL that gets logged.
      if (!hashCleanedRef.current && window?.history?.replaceState) {
        try {
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search
          );
          hashCleanedRef.current = true;
        } catch (e) {
          // Non-fatal — browser might block replaceState in some
          // embed contexts. The session is still valid.
          console.warn('SET_PASSWORD: Could not clean URL hash', e);
        }
      }
    } catch (err) {
      console.error('SET_PASSWORD: checkInviteSession exception', err);
      setSessionState('invalid');
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');

    // Field-presence validation
    if (!firstName?.trim() || !surname?.trim() || !newPassword || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    // Password rules — keep in lock-step with /reset-password, which
    // enforces an 8-character minimum. If the rest of the app ever
    // tightens this, update both places together.
    if (newPassword?.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      console.log('SET_PASSWORD: Updating password via updateUser');
      const { error: updateError } = await supabase?.auth?.updateUser({
        password: newPassword,
      });

      if (updateError) {
        console.error('SET_PASSWORD: updateUser error', updateError);
        throw updateError;
      }

      // Pull the current user so we can write full_name into profiles
      // and figure out where to route them next.
      const {
        data: { user },
        error: userError,
      } = await supabase?.auth?.getUser();

      if (userError || !user) {
        console.error('SET_PASSWORD: getUser error', userError);
        throw new Error('Failed to load user after password update');
      }

      // Profiles table write — mirror /reset-password: best-effort,
      // password success is the hard requirement, profile is a nice-to-have.
      const fullName = `${firstName?.trim()} ${surname?.trim()}`;
      const { error: profileError } = await supabase
        ?.from('profiles')
        ?.update({ full_name: fullName })
        ?.eq('id', user?.id);

      if (profileError) {
        console.warn('SET_PASSWORD: profile update failed (non-fatal)', profileError);
      }

      // Detect whether this is an invited crew member or a vessel admin.
      // Invite emails are sent via Supabase admin inviteUserByEmail, which
      // routes to /set-password. But accept_crew_invite_v3 (which creates
      // the tenant_members row) was never called — so we must do it here.
      // If there is a PENDING crew_invites row for this email, auto-accept
      // it and send the user to /dashboard. If there is none, they are a
      // vessel admin and should go through /onboarding.
      let destination = '/onboarding';

      try {
        const { data: pendingInvite } = await supabase
          ?.from('crew_invites')
          ?.select('token, tenant_id')
          ?.eq('email', user?.email?.toLowerCase()?.trim())
          ?.eq('status', 'PENDING')
          ?.limit(1)
          ?.maybeSingle();

        if (pendingInvite?.token) {
          console.log('SET_PASSWORD: found pending crew invite, auto-accepting');
          const { data: acceptData, error: acceptError } = await supabase?.rpc(
            'accept_crew_invite_v3',
            { p_token: pendingInvite.token, p_full_name: fullName }
          );

          if (acceptError) {
            console.warn('SET_PASSWORD: accept_crew_invite_v3 failed (non-fatal)', acceptError);
          }

          const tenantId = acceptData?.[0]?.tenant_id || pendingInvite?.tenant_id;
          if (tenantId) {
            await supabase
              ?.from('profiles')
              ?.update({ last_active_tenant_id: tenantId })
              ?.eq('id', user?.id);
          }

          destination = '/dashboard';
          console.log('SET_PASSWORD: crew invite accepted, routing to /dashboard');
        }
      } catch (inviteErr) {
        // Non-fatal — worst case they land on /onboarding and see the normal error
        console.warn('SET_PASSWORD: crew invite check failed (non-fatal)', inviteErr);
      }

      console.log('SET_PASSWORD: routing to', destination);
      setSuccess(true);
      showToast('Password set successfully', 'success');

      // Brief pause so the success state is readable, then hand off.
      setTimeout(() => {
        navigate(destination, { replace: true });
      }, 1500);
    } catch (err) {
      console.error('SET_PASSWORD: submit error', err);
      setError(err?.message || 'Failed to set password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Loading state ────────────────────────────────────────────────
  if (sessionState === 'checking') {
    return (
      <div className="spw-loading">
        <Icon name="Loader2" size={26} className="animate-spin" />
        <span>Verifying invite link…</span>
      </div>
    );
  }

  // ─── Invalid / expired link ───────────────────────────────────────
  if (sessionState === 'invalid') {
    return (
      <div className="spw-page">
        <div className="spw-wrap">
          <div className="spw-icon-circle error">
            <Icon name="AlertCircle" size={28} color="#A32D2D" />
          </div>
          <h1 className="spw-heading">Invite link invalid or expired</h1>
          <p className="spw-sub">
            This invite link is invalid, has already been used, or has expired.
            If you still need to set up your account, ask your vessel administrator
            to re-send the invite, or contact support.
          </p>

          <div className="spw-panel" style={{ textAlign: 'center' }}>
            <button className="spw-btn-primary" onClick={() => navigate('/login-authentication')}>
              Go to login
            </button>
            <button className="spw-link" onClick={() => navigate('/contact')}>
              Contact support
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Already signed in — not allowed to reset here ────────────────
  if (sessionState === 'already-signed-in') {
    return (
      <div className="spw-page">
        <div className="spw-wrap">
          <div className="spw-icon-circle info">
            <Icon name="Info" size={28} color="#C65A1A" />
          </div>
          <h1 className="spw-heading">You're already signed in</h1>
          <p className="spw-sub">
            This page is only for new users accepting an invite. If you want to
            change your password, use the password-reset flow instead.
          </p>

          <div className="spw-panel" style={{ textAlign: 'center' }}>
            <button className="spw-btn-primary" onClick={() => navigate('/dashboard')}>
              Go to dashboard
            </button>
            <button className="spw-link" onClick={() => navigate('/forgot-password')}>
              Reset my password
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Success ──────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="spw-page">
        <div className="spw-wrap">
          <div className="spw-icon-circle success">
            <Icon name="CheckCircle" size={28} color="#047857" />
          </div>
          <h1 className="spw-heading">Password set</h1>
          <p className="spw-sub">Redirecting you to your vessel…</p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Icon name="Loader2" size={22} className="animate-spin" color="#C65A1A" />
          </div>
        </div>
      </div>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────
  return (
    <div className="spw-page">
      <div className="spw-wrap">
        <div className="spw-logo-badge">
          <img src={LOGO_SRC} alt="Cargo" />
        </div>
        <h1 className="spw-heading">Set your password</h1>
        <p className="spw-sub">Welcome to Cargo. Choose a password to finish setting up your account.</p>

        <div className="spw-panel">
          <form onSubmit={handleSubmit}>
            <div className="spw-field">
              <label htmlFor="firstName">First name</label>
              <input
                id="firstName"
                className="spw-input"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e?.target?.value)}
                placeholder="Enter your first name"
                disabled={loading}
                required
              />
            </div>

            <div className="spw-field">
              <label htmlFor="surname">Surname</label>
              <input
                id="surname"
                className="spw-input"
                type="text"
                value={surname}
                onChange={(e) => setSurname(e?.target?.value)}
                placeholder="Enter your surname"
                disabled={loading}
                required
              />
            </div>

            <div className="spw-field">
              <label htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                className="spw-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e?.target?.value)}
                placeholder="At least 8 characters"
                disabled={loading}
                required
                autoComplete="new-password"
              />
            </div>

            <div className="spw-field">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                className="spw-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e?.target?.value)}
                placeholder="Re-enter your password"
                disabled={loading}
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="spw-error">
                <Icon name="AlertCircle" size={16} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="spw-btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <Icon name="Loader2" size={16} className="animate-spin" />
                  Setting password…
                </>
              ) : (
                'Set password & continue'
              )}
            </button>
          </form>
        </div>

        <p className="spw-footer">Secure yacht operations management · Role-based access control</p>
      </div>
    </div>
  );
};

export default SetPassword;
