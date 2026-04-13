// Netlify Function: stripe-webhook
//
// Receives Stripe webhook events and provisions tenants + COMMAND users on
// successful checkout. Also marks tenants as cancelled on subscription
// deletion.
//
// The expensive/irreversible work (creating a tenant, creating an auth user,
// sending an invite email) only runs on checkout.session.completed and only
// if the vessel_registrations row has not yet been converted. The handler is
// idempotent — if Stripe redelivers the event we detect the prior conversion
// and return success without double-creating anything.
//
// Environment variables required:
//   STRIPE_SECRET_KEY            — for API calls (e.g. refund on error)
//   STRIPE_WEBHOOK_SECRET        — whsec_... from Stripe Dashboard → Webhooks
//   SUPABASE_URL (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY    — service role key (admin access)
//   SITE_URL                     — e.g. https://cargotechnology.netlify.app
//
// Netlify note: this function must receive the raw request body for signature
// verification. Netlify forwards the body as a string in event.body which
// works for HMAC-SHA256 verification as long as we use it verbatim.

const crypto = require('crypto');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://cargotechnology.netlify.app';

/* ─── Stripe signature verification (no SDK) ──────────────────────────── */

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return { ok: false, reason: 'missing signature or secret' };

  // Stripe signature header format: t=timestamp,v1=signature,v1=signature...
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (!k || !v) return acc;
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') acc.v1.push(v);
    return acc;
  }, { timestamp: null, v1: [] });

  if (!parts.timestamp || parts.v1.length === 0) {
    return { ok: false, reason: 'malformed signature header' };
  }

  const payload = `${parts.timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  const matches = parts.v1.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  });

  if (!matches) return { ok: false, reason: 'signature mismatch' };

  // Reject events older than 5 minutes to defeat replay attacks
  const age = Math.floor(Date.now() / 1000) - parseInt(parts.timestamp, 10);
  if (age > 300) return { ok: false, reason: 'event too old' };

  return { ok: true };
}

/* ─── Supabase admin helpers ──────────────────────────────────────────── */

async function supaRest(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
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
  const url = `${SUPABASE_URL}/auth/v1/${path}`;
  const res = await fetch(url, {
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

async function tenantExistsByImo(imo) {
  if (!imo) return false;
  const res = await supaRest(
    `tenants?imo_number=eq.${encodeURIComponent(imo)}&select=id&limit=1`,
    { method: 'GET' }
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

async function createTenantRow(registration, session) {
  const payload = {
    name: registration.vessel_name,
    type: 'VESSEL',
    status: 'ACTIVE',
    imo_number: registration.imo_number || null,
    loa_m: registration.loa_metres || null,
    year_built: registration.year_built || null,
    flag: registration.flag_state || null,
    stripe_customer_id: session.customer,
    stripe_subscription_id: session.subscription,
    subscription_status: 'active',
    plan_tier: registration.pricing_tier,
    billing_period: session.metadata?.billing_period || 'monthly',
  };
  const res = await supaRest('tenants', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tenants insert failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const rows = await res.json();
  return rows[0];
}

async function upsertProfile(userId, registration) {
  const res = await supaRest('profiles', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: userId,
      full_name: registration.contact_name || '',
      email: registration.contact_email,
      account_type: 'VESSEL_ADMIN',
      current_tenant_id: null, // set below after we have tenant_id
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`profiles upsert failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function setProfileTenant(userId, tenantId) {
  const res = await supaRest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ current_tenant_id: tenantId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`profiles patch failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function createTenantMember(userId, tenantId) {
  // Mirror the existing vessel-signup-flow-step-1 pattern: use the `role`
  // string column for COMMAND. The role_id column exists on tenant_members
  // (added 2026-02-17) but the active signup path still writes the string
  // role, so we do the same for consistency. If Lauren migrates the signup
  // flow to role_id, this function should be updated in lockstep.
  const res = await supaRest('tenant_members', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      tenant_id: tenantId,
      user_id: userId,
      role: 'COMMAND',
      active: true,
      status: 'ACTIVE',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tenant_members insert failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function markRegistrationConverted(registrationId, tenantId) {
  const res = await supaRest(
    `vessel_registrations?id=eq.${encodeURIComponent(registrationId)}`,
    {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tenant_id: tenantId,
        converted_at: new Date().toISOString(),
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to mark registration converted: ${res.status} ${body.slice(0, 200)}`);
    // Non-fatal — the tenant exists, this is just analytics.
  }
}

async function inviteUser(email, fullName) {
  // Uses the canonical Supabase invite endpoint which BOTH creates the
  // auth.users row AND sends the invite email via the configured SMTP in
  // a single call. This is `supabase.auth.admin.inviteUserByEmail()` in
  // the JS SDK — note the endpoint path is `/auth/v1/invite` (NOT
  // `/auth/v1/admin/invite`) even though it requires the service role
  // key. The previous implementation called `admin/users` with
  // `email_confirm: true` followed by `admin/generate_link` — neither of
  // those reliably send an email (admin/users with email_confirm bypasses
  // email entirely, and generate_link's email-send behaviour depends on
  // Supabase version + SMTP config), which is why invites silently
  // disappeared during testing.
  console.log(`[invite] POST /auth/v1/invite for ${email}`);
  const res = await supaAuth('invite', {
    method: 'POST',
    body: JSON.stringify({
      email,
      data: { full_name: fullName, invited_by: 'stripe-webhook' },
      redirect_to: `${SITE_URL}/welcome`,
    }),
  });

  // If the user already exists, admin/invite returns 422 "user already
  // registered". Fall back to generate_link which re-sends a magic link
  // to the existing user so re-tests (same plus-addressed email) still
  // receive an email instead of silently succeeding.
  if (res.status === 422) {
    console.log(`[invite] user ${email} already exists — falling back to magic link`);
    const lookup = await supaAuth(`admin/users?email=${encodeURIComponent(email)}`, { method: 'GET' });
    if (!lookup.ok) {
      const body = await lookup.text();
      throw new Error(`user lookup failed: ${lookup.status} ${body.slice(0, 200)}`);
    }
    const lookupData = await lookup.json();
    const user = Array.isArray(lookupData?.users) ? lookupData.users[0] : lookupData?.users;
    if (!user?.id) throw new Error('Existing user has no id');

    // Send a magic link so they can still reach /welcome. generate_link
    // with type=magiclink actually sends via SMTP in current Supabase.
    const linkRes = await supaAuth('admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({
        type: 'magiclink',
        email,
        options: { redirectTo: `${SITE_URL}/welcome` },
      }),
    });
    if (!linkRes.ok) {
      const body = await linkRes.text();
      console.error(`[invite] generate_link fallback failed: ${linkRes.status} ${body.slice(0, 300)}`);
      // Non-fatal — the user can use /welcome's resend button.
    } else {
      console.log(`[invite] magic link re-sent to existing user ${email}`);
    }
    return { id: user.id, created: false };
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`invite failed: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  // /invite returns the user object directly (not wrapped in .user)
  const userId = data?.id || data?.user?.id;
  if (!userId) throw new Error(`invite returned no user id: ${JSON.stringify(data).slice(0, 200)}`);
  console.log(`[invite] created and invited ${email} as user ${userId}`);
  return { id: userId, created: true };
}

/* ─── Stripe API helper (for cancellation on duplicate) ───────────────── */

async function cancelSubscription(subscriptionId) {
  if (!subscriptionId) return;
  try {
    await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Stripe-Version': '2024-11-20.acacia',
      },
    });
  } catch (err) {
    console.error('Failed to cancel duplicate subscription:', err?.message || err);
  }
}

/* ─── Event handlers ──────────────────────────────────────────────────── */

async function handleCheckoutCompleted(session) {
  const registrationId =
    session.client_reference_id || session.metadata?.vessel_registration_id;
  if (!registrationId) {
    console.error('[checkout] missing vessel_registration_id', {
      client_reference_id: session.client_reference_id,
      metadata: session.metadata,
    });
    return;
  }

  console.log(`[checkout] processing session ${session.id} for registration ${registrationId}`);

  const registration = await fetchRegistration(registrationId);
  if (!registration) {
    console.error(`[checkout] registration ${registrationId} not found`);
    return;
  }

  console.log(`[checkout] registration loaded`, {
    id: registration.id,
    vessel_name: registration.vessel_name,
    imo_number: registration.imo_number,
    contact_email: registration.contact_email,
    converted_at: registration.converted_at,
    tenant_id: registration.tenant_id,
  });

  // Idempotency — if this registration already converted, no-op.
  if (registration.converted_at || registration.tenant_id) {
    console.log(`[checkout] registration ${registrationId} already converted, skipping`);
    return;
  }

  // Defence in depth — if a tenant with this IMO already exists, something
  // raced past the /pricing guard. Don't double-create. Cancel the dup sub.
  // Note: manual-entry registrations have imo_number=null and tenantExistsByImo
  // correctly returns false on null, so manual entries never trigger this.
  if (registration.imo_number && await tenantExistsByImo(registration.imo_number)) {
    console.error(
      `[checkout] tenant with IMO ${registration.imo_number} already exists. Cancelling duplicate subscription ${session.subscription}.`
    );
    await cancelSubscription(session.subscription);
    return;
  }

  // 1. Create the tenant
  console.log(`[checkout] creating tenant for ${registration.vessel_name}`);
  const tenant = await createTenantRow(registration, session);
  console.log(`[checkout] tenant ${tenant.id} created`);

  // 2. Invite the user (creates auth user + sends email)
  const { id: userId, created } = await inviteUser(
    registration.contact_email,
    registration.contact_name || ''
  );
  console.log(`[checkout] invite result`, { userId, created, email: registration.contact_email });

  // 3. Upsert profile and link to tenant
  await upsertProfile(userId, registration);
  await setProfileTenant(userId, tenant.id);

  // 4. Create tenant_members row with COMMAND role
  await createTenantMember(userId, tenant.id);

  // 5. Mark the registration row converted
  await markRegistrationConverted(registration.id, tenant.id);

  console.log(`[checkout] provisioned tenant ${tenant.id} for registration ${registration.id} — invite sent to ${registration.contact_email}`);
}

async function handleSubscriptionDeleted(subscription) {
  // Mark the tenant as cancelled. We don't delete the tenant row — Lauren
  // may want to reactivate the customer later.
  const res = await supaRest(
    `tenants?stripe_subscription_id=eq.${encodeURIComponent(subscription.id)}`,
    {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ subscription_status: 'canceled' }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to mark tenant cancelled: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function handleSubscriptionUpdated(subscription) {
  // Mirror Stripe's subscription status onto the tenant row. This catches
  // transitions to past_due, unpaid, etc. without us having to wire separate
  // handlers for each.
  const res = await supaRest(
    `tenants?stripe_subscription_id=eq.${encodeURIComponent(subscription.id)}`,
    {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ subscription_status: subscription.status }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed to update tenant status: ${res.status} ${body.slice(0, 300)}`);
  }
}

/* ─── Main handler ────────────────────────────────────────────────────── */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!STRIPE_WEBHOOK_SECRET || !STRIPE_SECRET_KEY) {
    console.error('Stripe env vars not set');
    return { statusCode: 500, body: 'Stripe not configured' };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env vars not set');
    return { statusCode: 500, body: 'Supabase not configured' };
  }

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.body || '';

  const verification = verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!verification.ok) {
    console.error(`Stripe signature verification failed: ${verification.reason}`);
    return { statusCode: 400, body: `Webhook signature verification failed: ${verification.reason}` };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripeEvent.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripeEvent.data.object);
        break;
      default:
        // Acknowledge events we don't handle so Stripe stops retrying.
        console.log(`Ignoring Stripe event: ${stripeEvent.type}`);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error(`Handler failed for ${stripeEvent.type}:`, err?.message || err);
    // Return 500 so Stripe retries. But if the error is a known-idempotent
    // issue (e.g. constraint violation because we already processed this
    // event), returning 200 would prevent infinite retries. For now we rely
    // on the explicit idempotency check at the top of handleCheckoutCompleted.
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message || 'Handler error' }),
    };
  }
};
