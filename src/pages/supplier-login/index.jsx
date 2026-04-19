import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';

const SupplierLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userType = session.user.user_metadata?.user_type;
          if (userType === 'supplier') {
            navigate('/supplier/overview', { replace: true });
            return;
          }
        }
      } catch (err) {
        console.error('[SUPPLIER_LOGIN] Session check error:', err);
      } finally {
        setCheckingSession(false);
      }
    };
    checkSession();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please enter both email and password.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        if (authError.message?.includes('Invalid login credentials')) {
          setError('Invalid email or password. Please try again.');
        } else {
          setError(authError.message || 'Login failed. Please try again.');
        }
        setLoading(false);
        return;
      }

      const userType = data.user?.user_metadata?.user_type;
      if (userType !== 'supplier') {
        setError('This account is not registered as a supplier. Looking for the crew login?');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      navigate('/supplier/overview', { replace: true });
    } catch (err) {
      console.error('[SUPPLIER_LOGIN] Error:', err);
      setError(err?.message || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#1E3A5F' }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Logo + header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/assets/images/cargo_merged_originalmark_syne800_true.png"
            alt="Cargo"
            style={{ height: 32, width: 'auto', marginBottom: 20 }}
          />
          <div style={{
            display: 'inline-block',
            background: '#EEF2F7',
            border: '1px solid #CBD5E1',
            borderRadius: 20,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#1E3A5F',
            marginBottom: 14,
            fontFamily: 'Outfit, sans-serif',
          }}>
            Supplier Portal
          </div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 26, color: '#0C0E14', margin: '0 0 6px' }}>
            Log in to your supplier account
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: 0 }}>
            Manage orders, deliveries, and yacht clients.
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {error && (
            <div style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 20,
              fontSize: 13.5,
              color: '#991B1B',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
              <span>
                {error}
                {error.includes('crew login') && (
                  <> <Link to="/login-authentication" style={{ color: '#1E3A5F', fontWeight: 600, textDecoration: 'underline' }}>Crew login →</Link></>
                )}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@supplier.com"
                disabled={loading}
                required
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid #D1D5DB', borderRadius: 8,
                  padding: '10px 12px', fontSize: 14, color: '#111827',
                  background: loading ? '#F9FAFB' : '#fff',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                required
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1px solid #D1D5DB', borderRadius: 8,
                  padding: '10px 12px', fontSize: 14, color: '#111827',
                  background: loading ? '#F9FAFB' : '#fff',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                background: loading ? '#94A3B8' : '#1E3A5F',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '11px 0',
                fontSize: 14,
                fontWeight: 700,
                fontFamily: 'Outfit, sans-serif',
                cursor: loading ? 'not-allowed' : 'pointer',
                letterSpacing: '0.02em',
                transition: 'background 0.15s',
                marginTop: 2,
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Link
              to="/forgot-password"
              style={{ fontSize: 13, color: '#1E3A5F', textDecoration: 'none' }}
            >
              Forgot password?
            </Link>
          </div>
        </div>

        {/* Sign up link */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 13.5, color: '#64748B', margin: 0 }}>
            Don't have a supplier account?{' '}
            <Link to="/supplier/signup" style={{ color: '#1E3A5F', fontWeight: 600, textDecoration: 'none' }}>
              Create one free →
            </Link>
          </p>
        </div>

        {/* Crew login link */}
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
            Are you yacht crew?{' '}
            <Link to="/login-authentication" style={{ color: '#94A3B8', textDecoration: 'underline' }}>
              Crew login
            </Link>
          </p>
        </div>

      </div>
    </div>
  );
};

export default SupplierLogin;
