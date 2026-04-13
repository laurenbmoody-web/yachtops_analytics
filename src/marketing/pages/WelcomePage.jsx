import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

// How long to wait before enabling the "Resend email" button. Gives the
// Stripe webhook + Supabase invite pipeline a chance to deliver the
// first email before the user starts clicking resend.
const RESEND_ENABLE_AFTER_SECONDS = 30;
// Cooldown between resend clicks once the button is enabled. Same reason
// — prevents hammering Supabase's invite rate limits.
const RESEND_COOLDOWN_SECONDS = 30;

/* ─── What happens next ─────────────────────────────────────────────────── */

const STEPS = [
  {
    n: '01',
    title: 'Payment confirmed',
    body: 'Your Stripe subscription is active. Your founding-vessel rate is locked in.',
  },
  {
    n: '02',
    title: 'Check your inbox',
    body:
      "We've sent a magic-link email to set up your account. It usually arrives within a minute — check spam if you don't see it.",
  },
  {
    n: '03',
    title: 'Set up your vessel',
    body:
      "Once you're in, you'll add your crew, import your inventory, and start running your operation through Cargo.",
  },
];

const WelcomePage = () => {
  useScrollAnimations();
  const location = useLocation();

  // Stripe bounces back to /welcome?session_id={CHECKOUT_SESSION_ID}. The
  // id is what the resend endpoint uses to look up the registration and
  // re-trigger the invite email, so we thread it through state.
  const sessionId = useMemo(
    () => new URLSearchParams(location.search).get('session_id'),
    [location.search]
  );

  // Resend email state machine. The button starts disabled and shows a
  // countdown; once it enables, clicking fires POST /api/resend-welcome-email.
  // Responses land in `resendStatus` for inline feedback.
  const [secondsLeft, setSecondsLeft] = useState(RESEND_ENABLE_AFTER_SECONDS);
  const [resendSubmitting, setResendSubmitting] = useState(false);
  // { kind: 'success' | 'error' | 'pending', message: string } | null
  const [resendStatus, setResendStatus] = useState(null);

  // Tick the countdown down to 0. Using a single interval so an unmount
  // cleans it up cleanly without leaving phantom setState calls.
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const t = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  const canResend = secondsLeft <= 0 && !resendSubmitting && !!sessionId;

  const handleResend = async () => {
    if (!canResend) return;
    setResendSubmitting(true);
    setResendStatus(null);
    try {
      const res = await fetch('/api/resend-welcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResendStatus({
          kind: data?.webhook_pending ? 'pending' : 'error',
          message:
            data?.error ||
            'Something went wrong resending the email. Please contact support.',
        });
        setResendSubmitting(false);
        // Give the user a short cooldown even on error, to avoid them
        // hammering the endpoint while the webhook catches up.
        setSecondsLeft(RESEND_COOLDOWN_SECONDS);
        return;
      }
      setResendStatus({
        kind: 'success',
        message:
          data?.kind === 'magiclink'
            ? "We've sent a fresh magic-link email. Check your inbox."
            : "We've resent your invite email. Check your inbox.",
      });
      setResendSubmitting(false);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      console.error('resend-welcome-email exception:', err);
      setResendStatus({
        kind: 'error',
        message: 'Network error — please check your connection and try again.',
      });
      setResendSubmitting(false);
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    }
  };

  return (
    <MarketingLayout>
      <section style={{ paddingTop: 96, paddingBottom: 56, textAlign: 'center' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px' }}>
          <div
            style={{
              width: 72,
              height: 72,
              backgroundColor: '#ECFDF5',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}
          >
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <path
                d="M7 14l5 5 9-9"
                stroke="#059669"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <p
            className="mkt-archivo"
            style={{
              fontWeight: 600,
              fontSize: 9,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: '#4A90E2',
              marginBottom: 10,
            }}
          >
            Welcome aboard
          </p>
          <h1
            className="mkt-archivo"
            style={{
              fontWeight: 900,
              fontSize: 36,
              textTransform: 'uppercase',
              color: '#1E3A5F',
              lineHeight: 1.05,
              marginBottom: 14,
            }}
          >
            You're on Cargo
          </h1>
          <p
            className="mkt-dmsans"
            style={{
              fontWeight: 400,
              fontSize: 15,
              color: '#64748B',
              maxWidth: 480,
              margin: '0 auto',
              lineHeight: 1.7,
            }}
          >
            Payment confirmed. We've sent a magic-link email to finish setting up your
            account — click the link and you'll be dropped straight into your vessel.
          </p>
        </div>
      </section>

      <section style={{ padding: '24px 32px 80px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div
            className="bg-white rounded-xl"
            style={{ border: '2px solid #1E3A5F', padding: 32 }}
          >
            <h2
              className="mkt-archivo"
              style={{
                fontWeight: 900,
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#1E3A5F',
                marginBottom: 24,
              }}
            >
              What happens next
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {STEPS.map(({ n, title, body }) => (
                <div key={n} className="flex gap-4">
                  <div
                    className="flex-shrink-0 flex items-center justify-center mkt-archivo"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: '2px solid #1E3A5F',
                      fontWeight: 900,
                      fontSize: 11,
                      color: '#1E3A5F',
                    }}
                  >
                    {n}
                  </div>
                  <div>
                    <p
                      className="mkt-archivo"
                      style={{
                        fontWeight: 900,
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: '#1E3A5F',
                        marginBottom: 4,
                      }}
                    >
                      {title}
                    </p>
                    <p
                      className="mkt-dmsans"
                      style={{
                        fontWeight: 400,
                        fontSize: 13,
                        color: '#64748B',
                        lineHeight: 1.6,
                      }}
                    >
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 28,
                paddingTop: 24,
                borderTop: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <p
                className="mkt-dmsans"
                style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6, marginBottom: 14 }}
              >
                Didn't get the email? Check your spam folder first, then resend below.
              </p>

              {/* Inline status message (success / error / pending). Rendered
                  before the button so it's the first thing the user sees after
                  an action. */}
              {resendStatus && (
                <div
                  role="status"
                  style={{
                    background:
                      resendStatus.kind === 'success'
                        ? '#ECFDF5'
                        : resendStatus.kind === 'pending'
                        ? '#FFFBEB'
                        : '#FEF2F2',
                    border: `1px solid ${
                      resendStatus.kind === 'success'
                        ? '#A7F3D0'
                        : resendStatus.kind === 'pending'
                        ? '#FDE68A'
                        : '#FECACA'
                    }`,
                    borderRadius: 10,
                    padding: '12px 16px',
                    marginBottom: 14,
                    textAlign: 'left',
                  }}
                >
                  <p
                    className="mkt-dmsans"
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color:
                        resendStatus.kind === 'success'
                          ? '#065F46'
                          : resendStatus.kind === 'pending'
                          ? '#92400E'
                          : '#991B1B',
                    }}
                  >
                    {resendStatus.message}
                  </p>
                </div>
              )}

              <button
                onClick={handleResend}
                disabled={!canResend}
                className="mkt-archivo transition-colors duration-150"
                style={{
                  fontWeight: 900,
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: canResend ? '#1E3A5F' : '#94A3B8',
                  background: 'none',
                  border: `2px solid ${canResend ? '#1E3A5F' : '#E2E8F0'}`,
                  borderRadius: 50,
                  padding: '12px 28px',
                  cursor: canResend ? 'pointer' : 'not-allowed',
                  marginBottom: 12,
                }}
                onMouseEnter={(e) => {
                  if (canResend) {
                    e.currentTarget.style.backgroundColor = '#1E3A5F';
                    e.currentTarget.style.color = 'white';
                  }
                }}
                onMouseLeave={(e) => {
                  if (canResend) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#1E3A5F';
                  }
                }}
              >
                {resendSubmitting
                  ? 'Sending…'
                  : secondsLeft > 0
                  ? `Resend email in ${secondsLeft}s`
                  : 'Resend email'}
              </button>

              <p
                className="mkt-dmsans"
                style={{
                  fontSize: 12,
                  color: '#94A3B8',
                  lineHeight: 1.6,
                  marginBottom: 14,
                }}
              >
                Still nothing after resending?{' '}
                <Link
                  to="/contact?intent=support"
                  style={{ color: '#4A90E2', textDecoration: 'underline' }}
                >
                  Contact support
                </Link>
                .
              </p>

              <Link
                to="/login-authentication"
                className="mkt-archivo"
                style={{
                  display: 'inline-block',
                  marginTop: 4,
                  fontWeight: 900,
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'white',
                  backgroundColor: '#1E3A5F',
                  borderRadius: 50,
                  padding: '12px 28px',
                  textDecoration: 'none',
                }}
              >
                Log in instead
              </Link>
            </div>
          </div>

          {/* Debugging crumb for ops — if a user ever reports they never got
              a welcome email, the session id on /welcome is the fastest way
              to correlate their checkout with a Stripe event. */}
          {sessionId && (
            <p
              className="mkt-dmsans"
              style={{
                textAlign: 'center',
                fontSize: 10,
                color: '#CBD5E1',
                marginTop: 20,
                fontFamily: 'monospace',
              }}
            >
              ref: {sessionId}
            </p>
          )}
        </div>
      </section>
    </MarketingLayout>
  );
};

export default WelcomePage;
