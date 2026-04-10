// Netlify Function: resend-welcome-email
//
// Called from the /welcome page when the customer didn't receive the
// Supabase magic-link invite after a successful Stripe checkout. This
// function re-triggers the invite email for an already-provisioned
// tenant. It also doubles as a diagnostic — if the registration row has
// not been converted yet, we can tell the frontend that the webhook
// never fired (or crashed).
//
// Input: { session_id: string }  // the Stripe Checkout Session id from /welcome?session_id=...
//
// Environment variables required:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY
//   SITE_URL

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://cargotechnology.netlify.app';

/* ─── Stripe helper ───────────────────────────────────────────────────── */

async function stripeRetrieveSession(sessionId) {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Stripe-Version': '2024-11-20.acacia',
      },
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${data?.error?.message || 'session retrieve failed'}`);
  }
  return data;
}

/* ─── Supabase helpers ────────────────────────────────────────────────── */

async function supaRest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

async function supaAuth(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

async function fetchRegistration(id) {
  const res = await supaRest(
    `vessel_registrations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { method: 'GET' }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Re-send the invite email for an existing auth user. We use the admin
// `generate_link` endpoint with type=invite which triggers Supabase to
// re-send the email (same behaviour as the original webhook path).
async function resendInvite(email) {
  const res = await supaAuth('admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({
      type: 'invite',
      email,
      options: { redirectTo: `${SITE_URL}/welcome` },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`generate_link failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Fallback: if generate_link/invite fails because the user has already
// confirmed (rare in the self-serve flow, but possible if they clicked
// the first invite once then came back), send a magic-link instead. This
// is the same thing Supabase's signInWithOtp emits.
async function sendMagicLink(email) {
  const res = await supaAuth('admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({
      type: 'magiclink',
      email,
      options: { redirectTo: `${SITE_URL}/` },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`magiclink failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

/* ─── Handler ─────────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { session_id } = body;
  if (!session_id || typeof session_id !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'session_id is required' }) };
  }

  try {
    // 1. Retrieve the Stripe session to get the registration id + email
    const session = await stripeRetrieveSession(session_id);
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'That checkout isn\u2019t complete yet. Wait a moment and try again.',
        }),
      };
    }

    const registrationId =
      session.client_reference_id || session.metadata?.vessel_registration_id;
    const email = session.customer_email || session.customer_details?.email;

    if (!registrationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Checkout session has no registration reference' }),
      };
    }
    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Checkout session has no contact email' }),
      };
    }

    // 2. Look up the registration to confirm the webhook actually fired.
    const registration = await fetchRegistration(registrationId);
    if (!registration) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Vessel registration not found' }),
      };
    }

    // 3. If the registration hasn't been converted, the webhook never
    //    reached the provisioning code. Surface that clearly so support can
    //    diagnose — resending an invite would fail anyway because there's
    //    no auth user yet.
    if (!registration.tenant_id || !registration.converted_at) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error:
            'Your payment went through but your account is still being set up. If this message persists for more than a minute, please contact support and mention your checkout reference.',
          webhook_pending: true,
        }),
      };
    }

    // 4. Re-send the invite email. If the user has already confirmed,
    //    fall back to a magic link so they still receive something.
    try {
      await resendInvite(email);
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, kind: 'invite', email }),
      };
    } catch (inviteErr) {
      console.warn('Invite resend failed, falling back to magic link:', inviteErr?.message);
      await sendMagicLink(email);
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, kind: 'magiclink', email }),
      };
    }
  } catch (err) {
    console.error('resend-welcome-email error:', err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Could not resend the email. Please contact support.',
        debug: err?.message || String(err),
      }),
    };
  }
};
