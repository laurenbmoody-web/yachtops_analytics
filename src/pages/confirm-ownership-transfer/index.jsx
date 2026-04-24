import React, { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import LogoSpinner from '../../components/LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { confirmOwnershipTransfer } from '../supplier-portal/utils/supplierStorage';

const FAILURE_MESSAGES = {
  not_found: "This transfer link isn't valid. Ask the current owner to start a new transfer.",
  expired: 'This transfer request has expired. Ask the current owner to send a new one.',
  cancelled: 'This transfer request was cancelled.',
  confirmed: 'This transfer has already been completed. You should already have ownership.',
  not_authorized:
    "You're signed in, but this transfer was addressed to someone else. Sign out and sign in as the intended recipient.",
  not_authenticated: 'You need to be signed in to confirm this transfer.',
};

const ConfirmOwnershipTransfer = () => {
  const { token } = useParams();
  const { session, loading: authLoading } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (authLoading) return;
    if (!session) return;            // guard below will redirect to sign-in
    if (!token) {
      setState({ status: 'error', data: null, error: 'not_found' });
      return;
    }

    let cancelled = false;
    confirmOwnershipTransfer(token)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setState({ status: 'success', data: res, error: null });
        } else {
          setState({ status: 'error', data: null, error: res?.error ?? 'not_found' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', data: null, error: err.message ?? 'not_found' });
      });
    return () => { cancelled = true; };
  }, [token, session, authLoading]);

  // Auth guard
  if (!authLoading && !session) {
    const returnTo = encodeURIComponent(`/confirm-ownership-transfer/${token}`);
    return <Navigate to={`/supplier/login?next=${returnTo}`} replace />;
  }

  const primaryButton = {
    display: 'inline-block', padding: '11px 28px',
    background: '#1E3A5F', color: '#FFFFFF',
    fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: 14,
    textDecoration: 'none', borderRadius: 8, letterSpacing: 0.2,
  };

  return (
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

        <div style={{
          background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0',
          padding: '36px 32px', textAlign: 'center',
          boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
        }}>
          {(state.status === 'loading' || authLoading) && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <LogoSpinner size={40} />
              </div>
              <h1 style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontWeight: 500, fontSize: 22, color: '#0F172A', margin: '0 0 6px',
              }}>
                Confirming ownership transfer…
              </h1>
              <p style={{ fontSize: 14, color: '#64748B', margin: 0 }}>
                One moment while we finalise the transfer.
              </p>
            </>
          )}

          {state.status === 'success' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <CheckCircle2 size={48} color="#16A34A" strokeWidth={1.75} />
              </div>
              <h1 style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontWeight: 500, fontSize: 24, color: '#0F172A', margin: '0 0 10px',
              }}>
                You're now the owner
              </h1>
              <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55 }}>
                You can manage the team, billing, and all settings for this supplier account.
                The previous owner has been moved to Admin.
              </p>
              <Link to="/supplier/workspace/team" style={primaryButton}>
                Go to team settings
              </Link>
            </>
          )}

          {state.status === 'error' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <XCircle size={48} color="#DC2626" strokeWidth={1.75} />
              </div>
              <h1 style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontWeight: 500, fontSize: 24, color: '#0F172A', margin: '0 0 10px',
              }}>
                Transfer not completed
              </h1>
              <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55 }}>
                {FAILURE_MESSAGES[state.error] ??
                  "We couldn't complete this ownership transfer. Please try again or contact the current owner."}
              </p>
              <Link to="/supplier" style={primaryButton}>
                Go to portal
              </Link>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#94A3B8' }}>
          Cargo · Ownership transfer
        </div>
      </div>
    </div>
  );
};

export default ConfirmOwnershipTransfer;
