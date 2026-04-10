import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

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

  // Stripe bounces back to /welcome?session_id={CHECKOUT_SESSION_ID}. We
  // don't need the id for anything client-side (provisioning happens in the
  // webhook), but reading it lets us show a mildly more specific message if
  // we ever wire in a polling "setup in progress" state.
  const sessionId = useMemo(
    () => new URLSearchParams(location.search).get('session_id'),
    [location.search]
  );

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
                style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6, marginBottom: 12 }}
              >
                Didn't get the email? Check your spam folder, or{' '}
                <Link
                  to="/contact?intent=support"
                  style={{ color: '#4A90E2', textDecoration: 'underline' }}
                >
                  contact support
                </Link>
                .
              </p>
              <Link
                to="/login-authentication"
                className="mkt-archivo"
                style={{
                  display: 'inline-block',
                  marginTop: 8,
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
