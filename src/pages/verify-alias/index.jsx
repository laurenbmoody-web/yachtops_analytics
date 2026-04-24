import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import LogoSpinner from '../../components/LogoSpinner';
import { verifyAliasByToken } from '../supplier-portal/utils/supplierStorage';

const FAILURE_MESSAGES = {
  token_not_found:
    'This verification link has expired or was already used. Request a new one from your portal settings.',
  email_already_claimed:
    'This email is registered to another supplier. Contact support if you believe this is an error.',
};

const VerifyAlias = () => {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (!token) {
      setState({ status: 'failure', data: null, error: 'token_not_found' });
      return;
    }

    let cancelled = false;
    verifyAliasByToken(token)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok) {
          setState({ status: 'success', data: res, error: null });
        } else {
          setState({ status: 'failure', data: res, error: res?.error ?? 'unknown' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'failure', data: null, error: err.message ?? 'unknown' });
      });

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#F8FAFC',
      padding: 16,
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
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid #E2E8F0',
          padding: '36px 32px',
          textAlign: 'center',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
        }}>
          {state.status === 'loading' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <LogoSpinner size={40} />
              </div>
              <h1 style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontWeight: 500,
                fontSize: 22,
                color: '#0F172A',
                margin: '0 0 6px',
              }}>
                Verifying your email…
              </h1>
              <p style={{ fontSize: 14, color: '#64748B', margin: 0 }}>
                One moment while we confirm your supplier address.
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
                fontWeight: 500,
                fontSize: 24,
                color: '#0F172A',
                margin: '0 0 10px',
              }}>
                Email verified
              </h1>
              <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55 }}>
                {state.data?.already_verified
                  ? 'This email was already verified. You can close this tab.'
                  : 'All orders sent to this address will now appear in your portal.'}
              </p>
              <Link
                to="/supplier"
                style={{
                  display: 'inline-block',
                  padding: '11px 28px',
                  background: '#1E3A5F',
                  color: '#FFFFFF',
                  fontFamily: 'Outfit, sans-serif',
                  fontWeight: 600,
                  fontSize: 14,
                  textDecoration: 'none',
                  borderRadius: 8,
                  letterSpacing: 0.2,
                }}
              >
                Go to portal
              </Link>
            </>
          )}

          {state.status === 'failure' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <XCircle size={48} color="#DC2626" strokeWidth={1.75} />
              </div>
              <h1 style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontWeight: 500,
                fontSize: 24,
                color: '#0F172A',
                margin: '0 0 10px',
              }}>
                Verification failed
              </h1>
              <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px', lineHeight: 1.55 }}>
                {FAILURE_MESSAGES[state.error] ??
                  'We couldn’t verify this email. Please try again or contact support.'}
              </p>
              <Link
                to="/supplier/workspace/company"
                style={{
                  display: 'inline-block',
                  padding: '11px 28px',
                  background: '#1E3A5F',
                  color: '#FFFFFF',
                  fontFamily: 'Outfit, sans-serif',
                  fontWeight: 600,
                  fontSize: 14,
                  textDecoration: 'none',
                  borderRadius: 8,
                  letterSpacing: 0.2,
                }}
              >
                Go to portal settings
              </Link>
            </>
          )}
        </div>

        <div style={{
          textAlign: 'center',
          marginTop: 20,
          fontSize: 12,
          color: '#94A3B8',
        }}>
          Cargo · Supplier verification
        </div>
      </div>
    </div>
  );
};

export default VerifyAlias;
