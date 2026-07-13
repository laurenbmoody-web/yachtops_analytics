import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { ensureProfileExists } from '../../utils/profileHelpers';
import './login.css';

const CREW_CONTENT = {
  headlineLine1: 'BUILT BY CREW,',
  headlineItalic: 'for crew',
  cardTitlePre: 'CREW',
  emailPlaceholder: 'you@vessel.com',
  footerLead: 'New to Cargo?',
  footerLink: 'Request access',
  footerHref: '/pricing',
  crossText: 'Supplier, not crew?',
  crossLinkText: 'Supplier login →',
};

const SUPPLIER_CONTENT = {
  headlineLine1: 'YOUR CLIENTS,',
  headlineItalic: 'a click away',
  cardTitlePre: 'SUPPLIER',
  emailPlaceholder: 'you@supplier.com',
  footerLead: 'Not set up yet?',
  footerLink: 'Create a free account',
  footerHref: '/supplier/signup',
  crossText: 'Are you yacht crew?',
  crossLinkText: 'Crew login →',
};

const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState(
    searchParams.get('mode') === 'supplier' ? 'supplier' : 'crew'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Two-factor step-up (TOTP). When the account has a verified authenticator the
  // password call returns an aal1 session; we hold routing until a code raises
  // it to aal2. Passkeys are a separate, passwordless PRIMARY path (below).
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaTotpId, setMfaTotpId] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [pendingUser, setPendingUser] = useState(null);

  const passkeysSupported = typeof window !== 'undefined' && !!window.PublicKeyCredential;

  // If already logged in, route the user to their home.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { data: { session } } = await supabase?.auth?.getSession();
        if (cancelled) return;
        if (session?.user) {
          // Don't route a session that still owes a two-factor step-up — a
          // reload mid-challenge must land back on the code prompt, not slip
          // through to the app.
          try {
            const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
              const { data: factors } = await supabase.auth.mfa.listFactors();
              const totp = (factors?.totp || []).find((f) => f.status === 'verified');
              if (totp && !cancelled) {
                setPendingUser(session.user);
                setMfaTotpId(totp.id);
                setMfaStep(true);
                setCheckingSession(false);
                return;
              }
            }
          } catch (mfaErr) {
            console.warn('[LOGIN] MFA session check failed:', mfaErr);
          }
          const userType = session?.user?.user_metadata?.user_type;
          if (userType === 'supplier') {
            navigate('/supplier/overview', { replace: true });
          } else {
            navigate('/dashboard', { replace: true });
          }
          return;
        }
      } catch (err) {
        console.error('[LOGIN] Session check error:', err);
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [navigate]);

  // Toggle mode and update the URL (replaceState so back button isn't polluted).
  const switchMode = useCallback((next) => {
    setMode((current) => {
      if (next === current) return current;
      setError('');
      try {
        const url = new URL(window.location.href);
        if (next === 'supplier') {
          url.searchParams.set('mode', 'supplier');
        } else {
          url.searchParams.delete('mode');
        }
        const query = url.searchParams.toString();
        window.history.replaceState({}, '', url.pathname + (query ? `?${query}` : ''));
      } catch (e) {
        // URL API failure shouldn't break mode switching
      }
      return next;
    });
  }, []);

  // Final routing once the session is fully authenticated (post-MFA if any).
  // Routes on the authoritative user_type, not the login toggle, so a resumed
  // session lands in the right portal too.
  const routeUser = async (user) => {
    if (user?.user_metadata?.user_type === 'supplier') {
      navigate('/supplier/overview', { replace: true });
      return;
    }
    const profileResult = await ensureProfileExists(user);
    if (!profileResult?.success) {
      if (profileResult?.error?.includes('Network error')) {
        navigate('/dashboard', { replace: true });
        return;
      }
      throw new Error(profileResult?.error || 'Failed to create user profile');
    }
    navigate('/dashboard', { replace: true });
  };

  const submitMfa = async (e) => {
    e?.preventDefault();
    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaTotpId, code });
      if (vErr) {
        setError('That code didn’t match. Try the current one from your app.');
        setLoading(false);
        return;
      }
      await routeUser(pendingUser);
    } catch (err) {
      console.error('[LOGIN] MFA verify error:', err);
      setError('Could not verify the code. Please try again.');
      setLoading(false);
    }
  };

  // Passwordless primary sign-in. Discoverable credentials — the user picks
  // their account from the authenticator, so no email/password is needed. Routes
  // on the authoritative user_type once a session is issued.
  const handlePasskeySignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const { data, error: pErr } = await supabase.auth.signInWithPasskey();
      if (pErr) {
        setError(/NotAllowed|abort|cancel/i.test(pErr.message || '')
          ? 'Passkey sign-in was cancelled.'
          : (pErr.message || 'Could not sign in with a passkey.'));
        setLoading(false);
        return;
      }
      await routeUser(data?.user);
    } catch (err) {
      console.error('[LOGIN] passkey sign-in error:', err);
      setError('Could not sign in with a passkey. Please try again.');
      setLoading(false);
    }
  };

  const cancelMfa = async () => {
    setMfaStep(false);
    setMfaCode('');
    setMfaTotpId(null);
    setPendingUser(null);
    setError('');
    try { await supabase?.auth?.signOut(); } catch { /* best effort */ }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please enter both email and password.');
      setLoading(false);
      return;
    }

    try {
      if (!supabase) {
        throw new Error('Authentication service unavailable. Please try again.');
      }

      const loginPromise = supabase?.auth?.signInWithPassword({
        email: email?.trim(),
        password,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Login request timed out. Please check your internet connection.')), 30000)
      );

      const result = await Promise.race([loginPromise, timeoutPromise]);
      const authData = result?.data;
      const authError = result?.error;

      if (authError) {
        throw new Error(authError?.message || 'Authentication failed');
      }
      if (!authData?.user) {
        throw new Error('Login failed - no user data returned');
      }

      const userType = authData?.user?.user_metadata?.user_type;

      // Portal gating — keep suppliers and crew in their own portal.
      if (mode === 'supplier' && userType !== 'supplier') {
        setError('This account is not registered as a supplier. Switch to Crew login to sign in.');
        await supabase?.auth?.signOut();
        setLoading(false);
        return;
      }
      if (mode !== 'supplier' && userType === 'supplier') {
        setError('This is a supplier account. Switch to Supplier login to sign in.');
        await supabase?.auth?.signOut();
        setLoading(false);
        return;
      }

      // Two-factor step-up — if the account has a verified authenticator the
      // session is aal1 and must be raised to aal2 before we let them through.
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const totp = (factors?.totp || []).find((f) => f.status === 'verified');
          if (totp) {
            setPendingUser(authData.user);
            setMfaTotpId(totp.id);
            setMfaStep(true);
            setLoading(false);
            return;
          }
        }
      } catch (mfaErr) {
        // Fail open to a normal login rather than lock anyone out on an MFA
        // lookup hiccup — the account simply isn't stepped up this session.
        console.warn('[LOGIN] MFA check failed:', mfaErr);
      }

      await routeUser(authData.user);
    } catch (err) {
      console.error('[LOGIN] Error:', err);
      let msg = err?.message || 'Login failed. Please try again.';
      if (msg.includes('Load failed')) {
        msg = 'Unable to connect to the server. Please check your internet connection.';
      } else if (msg.includes('Network error') || msg.includes('timed out')) {
        msg = 'Network error. Please check your internet connection and try again.';
      } else if (msg.includes('Invalid login credentials')) {
        msg = 'Invalid email or password. Please try again.';
      }
      setError(msg);
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div id="cargo-login-root" className="cl-is-loading">
        <div className="cl-spinner" aria-label="Loading" />
      </div>
    );
  }

  const content = mode === 'supplier' ? SUPPLIER_CONTENT : CREW_CONTENT;
  const otherMode = mode === 'supplier' ? 'crew' : 'supplier';

  return (
    <div id="cargo-login-root">
      <header className="cl-topbar">
        <div className="cl-topbar-inner">
          <a href="/" className="cl-brand" aria-label="Cargo home">
            <img src="/centered-logo.svg" alt="Cargo" className="cl-brand-logo" />
          </a>

          <div className="cl-toggle" role="tablist" aria-label="Login mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'crew'}
              className={`cl-toggle-btn ${mode === 'crew' ? 'is-active' : ''}`}
              onClick={() => switchMode('crew')}
            >
              Crew
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'supplier'}
              className={`cl-toggle-btn ${mode === 'supplier' ? 'is-active' : ''}`}
              onClick={() => switchMode('supplier')}
            >
              Supplier
            </button>
          </div>
        </div>
      </header>

      <main className="cl-grid">
        <section className="cl-left">
          <h1 className="cl-headline">
            {content.headlineLine1}<br />
            <em>{content.headlineItalic}</em><span className="cl-period">.</span>
          </h1>

          <div className="cl-left-foot">
            <a
              href="https://cargotechnology.co.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="cl-out-link"
            >
              cargotechnology.co.uk <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section className="cl-card" aria-label={`${content.cardTitlePre} portal login`}>
          <div className="cl-card-head">
            <h2 className="cl-card-title">
              {content.cardTitlePre} <em>portal</em><span className="cl-period">.</span>
            </h2>
          </div>

          {error && (
            <div className="cl-error" role="alert">
              <span className="cl-error-icon" aria-hidden="true">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {mfaStep ? (
            <form className="cl-form" onSubmit={submitMfa}>
              <p className="cl-mfa-lead">Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app to finish signing in.</p>
              <div className="cl-field">
                <label className="cl-label" htmlFor="cl-mfa">Authentication code</label>
                <input
                  id="cl-mfa"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode((e?.target?.value || '').replace(/\D/g, ''))}
                  disabled={loading}
                  autoFocus
                  required
                />
              </div>
              <button type="submit" className="cl-submit" disabled={loading}>
                <span>{loading ? 'Verifying…' : 'Verify'}</span>
                <span className="cl-arrow" aria-hidden="true">→</span>
              </button>
              <button type="button" className="cl-mfa-back" onClick={cancelMfa} disabled={loading}>
                ← Back to sign in
              </button>
            </form>
          ) : (
          <form className="cl-form" onSubmit={handleSubmit}>
            <div className="cl-field">
              <label className="cl-label" htmlFor="cl-email">Email</label>
              <input
                id="cl-email"
                type="email"
                autoComplete="email"
                placeholder={content.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e?.target?.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="cl-field">
              <div className="cl-label-row">
                <label className="cl-label" htmlFor="cl-password">Password</label>
                <button
                  type="button"
                  className="cl-forgot"
                  onClick={() => navigate('/forgot-password')}
                  disabled={loading}
                >
                  Forgot?
                </button>
              </div>
              <input
                id="cl-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e?.target?.value)}
                disabled={loading}
                required
              />
            </div>

            <label className="cl-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e?.target?.checked)}
                disabled={loading}
              />
              <span className="cl-check-box" aria-hidden="true" />
              <span>Keep me signed in</span>
            </label>

            <button type="submit" className="cl-submit" disabled={loading}>
              <span>{loading ? 'Signing in…' : 'Sign in'}</span>
              <span className="cl-arrow" aria-hidden="true">→</span>
            </button>

            {passkeysSupported && (
              <>
                <div className="cl-mfa-or"><span>or</span></div>
                <button type="button" className="cl-submit cl-submit-ghost" onClick={handlePasskeySignIn} disabled={loading}>
                  <span>Sign in with a passkey</span>
                  <span className="cl-arrow" aria-hidden="true">→</span>
                </button>
              </>
            )}
          </form>
          )}

          {!mfaStep && (
          <div className="cl-card-foot">
            <p className="cl-foot-primary">
              {content.footerLead}{' '}
              <a href={content.footerHref} className="cl-link-under">{content.footerLink}</a>
            </p>
            <p className="cl-foot-secondary">
              {content.crossText}{' '}
              <button
                type="button"
                className="cl-cross-link"
                onClick={() => switchMode(otherMode)}
              >
                {content.crossLinkText}
              </button>
            </p>
          </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Login;
