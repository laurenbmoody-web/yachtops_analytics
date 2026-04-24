import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Mail } from 'lucide-react';
import LogoSpinner from '../../components/LogoSpinner';
import { supabase } from '../../lib/supabaseClient';
import { fetchInvitePublic, acceptInvite } from '../supplier-portal/utils/supplierStorage';

const FAILURE_MESSAGES = {
  not_found:
    "This invitation link isn't valid. Ask the person who invited you to send a fresh one.",
  expired:
    'This invitation has expired. Ask the supplier admin to send a new one.',
  revoked:
    'This invitation was revoked. Contact the supplier admin if you believe this is an error.',
  accepted:
    'This invitation has already been accepted. Sign in to access the portal.',
};

const Card = ({ children }) => (
  <div style={{
    background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0',
    padding: '36px 32px',
    boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
  }}>{children}</div>
);

const Heading = ({ children, align = 'left' }) => (
  <h1 style={{
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 500, fontSize: 24, color: '#0F172A',
    margin: '0 0 10px', lineHeight: 1.3, textAlign: align,
  }}>{children}</h1>
);

const primaryButton = {
  display: 'inline-block', padding: '11px 28px',
  background: '#1E3A5F', color: '#FFFFFF',
  fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 14,
  textDecoration: 'none', borderRadius: 8, letterSpacing: 0.2,
  border: 'none', cursor: 'pointer',
};

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: '#374151', marginBottom: 6,
};

const inputStyle = (loading, disabled) => ({
  width: '100%', boxSizing: 'border-box',
  border: '1px solid #D1D5DB', borderRadius: 8,
  padding: '10px 12px', fontSize: 14, color: '#111827',
  outline: 'none', fontFamily: 'inherit',
  background: disabled ? '#F3F4F6' : (loading ? '#F9FAFB' : '#fff'),
});

const roleLabel = (r) => r ? r.charAt(0).toUpperCase() + r.slice(1) : 'team member';

const Shell = ({ children }) => (
  <div style={{
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#F8FAFC', padding: 16,
  }}>
    <div style={{ width: '100%', maxWidth: 480 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <img
          src="/assets/images/cargo_merged_originalmark_syne800_true.png"
          alt="Cargo"
          style={{ height: 32, width: 'auto' }}
        />
      </div>
      {children}
      <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#94A3B8' }}>
        Cargo · Supplier invitation
      </div>
    </div>
  </div>
);

const AcceptSupplierInviteSignup = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  // Invite lookup state
  const [inviteState, setInviteState] = useState({ status: 'loading', invite: null, error: null });

  // Form state
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Post-submit state
  const [successState, setSuccessState] = useState(null); // null | 'check_email'

  useEffect(() => {
    if (!token) {
      setInviteState({ status: 'error', invite: null, error: 'not_found' });
      return;
    }
    let cancelled = false;
    fetchInvitePublic(token)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setInviteState({ status: 'ready', invite: res, error: null });
        } else {
          setInviteState({ status: 'error', invite: null, error: res?.error ?? 'not_found' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setInviteState({ status: 'error', invite: null, error: err.message ?? 'not_found' });
      });
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: inviteState.invite.email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            user_type: 'supplier',
          },
        },
      });

      if (authError) {
        if (authError.message?.toLowerCase().includes('already registered')) {
          setError(`An account already exists for ${inviteState.invite.email}. Sign in instead.`);
        } else {
          setError(authError.message || 'Failed to create account. Please try again.');
        }
        setLoading(false);
        return;
      }

      if (!authData?.user) {
        setError('Account creation failed. Please try again.');
        setLoading(false);
        return;
      }

      // If email confirmation is enabled, signUp returns no session. The
      // accept_supplier_invite RPC needs auth.uid(), so we can't run it yet —
      // the user has to confirm their email, sign in, and revisit the invite
      // link. Show a "check your email" state with that guidance.
      if (!authData.session) {
        setSuccessState('check_email');
        setLoading(false);
        return;
      }

      // Email confirmation off: we're logged in immediately, so accept the
      // invite now.
      const result = await acceptInvite(token, fullName.trim());
      if (!result?.ok) {
        setError(
          `Account created but invite acceptance failed: ${result?.error || 'unknown'}. ` +
          `Try signing in from /supplier/login.`
        );
        setLoading(false);
        return;
      }

      navigate('/supplier', { replace: true });
    } catch (err) {
      console.error('[ACCEPT_INVITE_SIGNUP] Error:', err);
      setError(err?.message || 'Signup failed. Please try again.');
      setLoading(false);
    }
  };

  // Loading the invite
  if (inviteState.status === 'loading') {
    return (
      <Shell>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <LogoSpinner size={40} />
          </div>
          <Heading align="center">Loading invitation…</Heading>
        </Card>
      </Shell>
    );
  }

  // Invite lookup failed
  if (inviteState.status === 'error') {
    return (
      <Shell>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <XCircle size={48} color="#DC2626" strokeWidth={1.75} />
          </div>
          <Heading align="center">Invitation unavailable</Heading>
          <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55, textAlign: 'center' }}>
            {FAILURE_MESSAGES[inviteState.error] ?? "We couldn't load this invitation. Please try again or contact the supplier admin."}
          </p>
          <div style={{ textAlign: 'center' }}>
            <Link to="/supplier/login" style={primaryButton}>Go to sign-in</Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // Check-email success state (email confirmation on)
  if (successState === 'check_email') {
    return (
      <Shell>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <Mail size={48} color="#1E3A5F" strokeWidth={1.75} />
          </div>
          <Heading align="center">Check your email</Heading>
          <p style={{ fontSize: 14, color: '#475569', margin: '0 0 10px', lineHeight: 1.55, textAlign: 'center' }}>
            We've sent a confirmation link to <strong>{inviteState.invite.email}</strong>.
          </p>
          <p style={{ fontSize: 13.5, color: '#6B6F7B', margin: '0 0 24px', lineHeight: 1.55, textAlign: 'center' }}>
            Click it to verify, then sign in to finish accepting your invite to <strong>{inviteState.invite.supplier?.name}</strong>.
          </p>
          <div style={{ textAlign: 'center' }}>
            <Link
              to={`/supplier/login?next=${encodeURIComponent(`/accept-supplier-invite/${token}`)}`}
              style={primaryButton}
            >
              Go to sign in
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // Ready — render the signup form
  const { invite } = inviteState;
  const supplierName = invite.supplier?.name ?? 'Cargo';

  return (
    <Shell>
      <Card>
        <Heading>Join {supplierName}</Heading>
        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55 }}>
          You've been invited as <strong>{roleLabel(invite.role)}</strong> with permission level <strong>{invite.permission_tier}</strong>.
        </p>

        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            padding: '10px 14px', marginBottom: 18, fontSize: 13.5, color: '#991B1B',
          }}>⚠ {error}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Full name *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full name"
              autoFocus
              disabled={loading}
              required
              minLength={2}
              style={inputStyle(loading, false)}
            />
          </div>

          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={invite.email}
              disabled
              readOnly
              style={inputStyle(false, true)}
            />
            <p style={{ fontSize: 11.5, color: '#94A3B8', margin: '4px 0 0' }}>
              This is the address the invite was sent to. You can't change it here.
            </p>
          </div>

          <div>
            <label style={labelStyle}>Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              disabled={loading}
              required
              minLength={6}
              style={inputStyle(loading, false)}
            />
          </div>

          <div>
            <label style={labelStyle}>Confirm password *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              disabled={loading}
              required
              minLength={6}
              style={inputStyle(loading, false)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? '#94A3B8' : '#1E3A5F',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '11px 0', fontSize: 14, fontWeight: 700,
              fontFamily: 'Outfit, sans-serif',
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.02em',
              transition: 'background 0.15s',
              marginTop: 4,
            }}
          >
            {loading ? 'Creating account…' : `Create account & join ${supplierName}`}
          </button>
        </form>

        <p style={{ fontSize: 12.5, color: '#6B6F7B', textAlign: 'center', margin: '18px 0 0' }}>
          Already have an account?{' '}
          <Link
            to={`/supplier/login?next=${encodeURIComponent(`/accept-supplier-invite/${token}`)}`}
            style={{ color: '#1E3A5F', fontWeight: 600, textDecoration: 'none' }}
          >
            Sign in to accept
          </Link>
        </p>
      </Card>
    </Shell>
  );
};

export default AcceptSupplierInviteSignup;
