import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabaseClient';
import { useTheme } from '../../contexts/ThemeContext';
import { showToast } from '../../utils/toast';

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

const SetPassword = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();

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

      // Work out where the user should land. If they already have a
      // tenant membership (stripe-webhook writes this right after
      // checkout succeeds), send them to the dashboard. Otherwise,
      // send them to /welcome which is the onboarding landing page.
      let destination = '/welcome';
      try {
        const { data: memberships, error: memberErr } = await supabase
          ?.from('tenant_members')
          ?.select('tenant_id, active, status')
          ?.eq('user_id', user?.id)
          ?.limit(1);

        if (memberErr) {
          console.warn(
            'SET_PASSWORD: tenant_members lookup failed, defaulting to /welcome',
            memberErr
          );
        } else if (Array.isArray(memberships) && memberships.length > 0) {
          destination = '/dashboard';
        }
      } catch (err) {
        console.warn('SET_PASSWORD: membership check threw, defaulting to /welcome', err);
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

  const logoSrc =
    theme === 'dark'
      ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'
      : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg';

  // ─── Loading state ────────────────────────────────────────────────
  if (sessionState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Verifying invite link...</p>
        </div>
      </div>
    );
  }

  // ─── Invalid / expired link ───────────────────────────────────────
  if (sessionState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image src={logoSrc} alt="Cargo Logo" className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Set Password</h1>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="AlertCircle" size={32} className="text-error" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Invite link invalid or expired
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                This invite link is invalid, has already been used, or has expired.
                If you still need to set up your account, ask your vessel administrator
                to re-send the invite, or contact support.
              </p>

              <Button
                onClick={() => navigate('/login-authentication')}
                className="w-full mb-3 bg-gray-900 hover:bg-gray-800 text-white"
              >
                Go to login
              </Button>
              <button
                onClick={() => navigate('/contact')}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors duration-200"
              >
                Contact support
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Already signed in — not allowed to reset here ────────────────
  if (sessionState === 'already-signed-in') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image src={logoSrc} alt="Cargo Logo" className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">You're already signed in</h1>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="Info" size={32} className="text-primary" />
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                This page is only for new users accepting an invite. If you want to
                change your password, use the password-reset flow instead.
              </p>

              <Button
                onClick={() => navigate('/dashboard')}
                className="w-full mb-3 bg-gray-900 hover:bg-gray-800 text-white"
              >
                Go to dashboard
              </Button>
              <button
                onClick={() => navigate('/forgot-password')}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors duration-200"
              >
                Reset my password
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Success ──────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image src={logoSrc} alt="Cargo Logo" className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Welcome aboard</h1>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="CheckCircle" size={32} className="text-success" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Password set</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Redirecting you to your vessel...
              </p>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Image src={logoSrc} alt="Cargo Logo" className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Set your password</h1>
          <p className="text-sm text-muted-foreground">
            Welcome to Cargo. Choose a password to finish setting up your account.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-2">
                First name
              </label>
              <Input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e?.target?.value)}
                placeholder="Enter your first name"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="surname" className="block text-sm font-medium text-foreground mb-2">
                Surname
              </label>
              <Input
                id="surname"
                type="text"
                value={surname}
                onChange={(e) => setSurname(e?.target?.value)}
                placeholder="Enter your surname"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-2">
                New password
              </label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e?.target?.value)}
                placeholder="At least 8 characters"
                className="w-full"
                disabled={loading}
                required
                autoComplete="new-password"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
                Confirm password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e?.target?.value)}
                placeholder="Re-enter your password"
                className="w-full"
                disabled={loading}
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
                <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Icon name="Loader2" size={18} className="animate-spin" />
                  Setting password...
                </span>
              ) : (
                'Set password & continue'
              )}
            </Button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Secure yacht operations management • Role-based access control
          </p>
        </div>
      </div>
    </div>
  );
};

export default SetPassword;
