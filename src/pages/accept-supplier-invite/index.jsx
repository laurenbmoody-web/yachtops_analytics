import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import LogoSpinner from '../../components/LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
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

const ACCEPT_ERROR_MESSAGES = {
  email_mismatch:
    'This invitation was sent to a different email address. Please sign out and sign in with the invited email.',
  expired: 'This invitation expired while you were signing in. Ask for a new one.',
  not_found: "This invitation is no longer valid.",
  not_authenticated: 'You need to be signed in to accept this invitation.',
};

const Card = ({ children }) => (
  <div style={{
    background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0',
    padding: '36px 32px', textAlign: 'center',
    boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
  }}>{children}</div>
);

const Heading = ({ children }) => (
  <h1 style={{
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 500, fontSize: 24, color: '#0F172A',
    margin: '0 0 10px', lineHeight: 1.3,
  }}>{children}</h1>
);

const primaryButton = {
  display: 'inline-block', padding: '11px 28px',
  background: '#1E3A5F', color: '#FFFFFF',
  fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 14,
  textDecoration: 'none', borderRadius: 8, letterSpacing: 0.2,
  border: 'none', cursor: 'pointer',
};

const AcceptSupplierInvite = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { session, user, loading: authLoading } = useAuth();

  const [state, setState] = useState({ status: 'loading', invite: null, error: null });
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', invite: null, error: 'not_found' });
      return;
    }
    let cancelled = false;
    fetchInvitePublic(token)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setState({ status: 'ready', invite: res, error: null });
        } else {
          setState({ status: 'error', invite: null, error: res?.error ?? 'not_found' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', invite: null, error: err.message ?? 'not_found' });
      });
    return () => { cancelled = true; };
  }, [token]);

  const handleAccept = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await acceptInvite(token, fullName.trim() || null);
      if (res?.ok) {
        navigate('/supplier', { replace: true });
      } else {
        setSubmitError(ACCEPT_ERROR_MESSAGES[res?.error] ?? (res?.error ?? 'Accept failed'));
      }
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const wrap = (inner) => (
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
        {inner}
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#94A3B8' }}>
          Cargo · Supplier invitation
        </div>
      </div>
    </div>
  );

  // Initial fetch in flight
  if (state.status === 'loading' || authLoading) {
    return wrap(
      <Card>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <LogoSpinner size={40} />
        </div>
        <Heading>Loading invitation…</Heading>
      </Card>
    );
  }

  // Invite lookup failed
  if (state.status === 'error') {
    return wrap(
      <Card>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <XCircle size={48} color="#DC2626" strokeWidth={1.75} />
        </div>
        <Heading>Invitation unavailable</Heading>
        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55 }}>
          {FAILURE_MESSAGES[state.error] ?? 'We couldn’t load this invitation. Please try again or contact the supplier admin.'}
        </p>
        <Link to="/supplier/login" style={{ ...primaryButton, textDecoration: 'none' }}>
          Go to sign-in
        </Link>
      </Card>
    );
  }

  const { invite } = state;
  const supplierName = invite.supplier?.name ?? 'Supplier';
  const userEmail = user?.email ?? '';
  const isAuthed = !!session && !!user;
  const emailMatches = isAuthed && userEmail && userEmail.toLowerCase() === String(invite.email).toLowerCase();

  // Not signed in — prompt sign-in with return URL
  if (!isAuthed) {
    const returnTo = encodeURIComponent(`/accept-supplier-invite/${token}`);
    return wrap(
      <Card>
        <Heading>
          {supplierName} invited you to join Cargo
        </Heading>
        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 8px', lineHeight: 1.55 }}>
          You've been invited as <strong>{invite.role ? invite.role.charAt(0).toUpperCase() + invite.role.slice(1) : 'team member'}</strong> with permission level <strong>{invite.permission_tier}</strong>.
        </p>
        <p style={{ fontSize: 13, color: '#6B6F7B', margin: '0 0 24px', lineHeight: 1.55 }}>
          Sign in with <strong>{invite.email}</strong> to accept.
        </p>
        <Link
          to={`/supplier/login?next=${returnTo}`}
          style={{ ...primaryButton, textDecoration: 'none' }}
        >
          Sign in to accept
        </Link>
        <p style={{ fontSize: 12, color: '#94A3B8', margin: '16px 0 0' }}>
          No account yet?{' '}
          <Link to={`/accept-supplier-invite/${token}/signup`} style={{ color: '#1E3A5F' }}>
            Create an account
          </Link>
        </p>
      </Card>
    );
  }

  // Signed in but wrong email
  if (!emailMatches) {
    return wrap(
      <Card>
        <Heading>Wrong account</Heading>
        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 12px', lineHeight: 1.55 }}>
          This invite was sent to <strong>{invite.email}</strong>.
        </p>
        <p style={{ fontSize: 14, color: '#475569', margin: '0 0 16px', lineHeight: 1.55 }}>
          You're signed in as <strong>{userEmail}</strong>. Sign out and sign in as <strong>{invite.email}</strong> — or, if you don't have an account yet,{' '}
          <Link to={`/accept-supplier-invite/${token}/signup`} style={{ color: '#1E3A5F', fontWeight: 600 }}>
            create one
          </Link>.
        </p>
        <Link to="/supplier/login" style={{ ...primaryButton, textDecoration: 'none' }}>
          Go to sign-in
        </Link>
      </Card>
    );
  }

  // Signed in with matching email — accept flow
  return wrap(
    <Card>
      <Heading>Join {supplierName}</Heading>
      <p style={{ fontSize: 14, color: '#475569', margin: '0 0 6px', lineHeight: 1.55 }}>
        You've been invited as <strong>{invite.role ? invite.role.charAt(0).toUpperCase() + invite.role.slice(1) : 'team member'}</strong>.
      </p>
      <p style={{ fontSize: 13, color: '#6B6F7B', margin: '0 0 22px', lineHeight: 1.55 }}>
        Permission level: <strong>{invite.permission_tier}</strong>
      </p>

      <div style={{ textAlign: 'left', margin: '0 auto 18px', maxWidth: 360 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#6B6F7B', marginBottom: 4 }}>
          Full name (optional)
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your name"
          style={{
            width: '100%', border: '1px solid #E2E8F0', borderRadius: 7,
            padding: '9px 12px', fontSize: 13, background: '#FFFFFF',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {submitError && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
          padding: '8px 12px', marginBottom: 14, fontSize: 13, color: '#DC2626',
          textAlign: 'left',
        }}>{submitError}</div>
      )}

      <button
        type="button"
        onClick={handleAccept}
        disabled={submitting}
        style={{ ...primaryButton, opacity: submitting ? 0.7 : 1 }}
      >
        {submitting ? 'Joining…' : 'Accept invitation'}
      </button>
    </Card>
  );
};

export default AcceptSupplierInvite;
