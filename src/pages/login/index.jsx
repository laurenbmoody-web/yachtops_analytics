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
  footerHref: '/public-landing-page',
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

  // If already logged in, route the user to their home.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { data: { session } } = await supabase?.auth?.getSession();
        if (cancelled) return;
        if (session?.user) {
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

      if (mode === 'supplier') {
        if (userType !== 'supplier') {
          setError('This account is not registered as a supplier. Switch to Crew login to sign in.');
          await supabase?.auth?.signOut();
          setLoading(false);
          return;
        }
        navigate('/supplier/overview', { replace: true });
        return;
      }

      // Crew mode
      if (userType === 'supplier') {
        setError('This is a supplier account. Switch to Supplier login to sign in.');
        await supabase?.auth?.signOut();
        setLoading(false);
        return;
      }

      const profileResult = await ensureProfileExists(authData?.user);
      if (!profileResult?.success) {
        if (profileResult?.error?.includes('Network error')) {
          navigate('/dashboard', { replace: true });
          return;
        }
        throw new Error(profileResult?.error || 'Failed to create user profile');
      }

      navigate('/dashboard', { replace: true });
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
          </form>

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
        </section>
      </main>
    </div>
  );
};

export default Login;
