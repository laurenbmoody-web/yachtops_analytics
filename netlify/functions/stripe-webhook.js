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
      last_active_tenant_id: null, // set below after we have tenant_id
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
    body: JSON.stringify({ last_active_tenant_id: tenantId }),
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
  // Uses Supabase's built-in invite flow. This creates an auth.users row if
  // one doesn't exist and sends an invite email via the SMTP configured in
  // Supabase (or Supabase's default sender in dev). The recipient clicks the
  // link to set their password and land in the app.
  const res = await supaAuth('admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, invited_by: 'stripe-webhook' },
    }),
  });

  // If the user already exists Supabase returns 422; in that case we look up
  // their ID and proceed without sending a second invite.
  if (res.status === 422) {
    const lookup = await supaAuth(`admin/users?email=${encodeURIComponent(email)}`, { method: 'GET' });
    if (!lookup.ok) throw new Error(`user lookup failed: ${lookup.status}`);
    const data = await lookup.json();
    const user = Array.isArray(data?.users) ? data.users[0] : data?.users;
    if (!user?.id) throw new Error('Existing user has no id');
    return { id: user.id, created: false };
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`admin/users create failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const userId = data?.id || data?.user?.id;
  if (!userId) throw new Error('Created user has no id');

  // Send the invite email (separate call so we can differentiate "user
  // already exists" from "new user needs email").
  const inviteRes = await supaAuth('admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({
      type: 'invite',
      email,
      options: { redirectTo: `${SITE_URL}/welcome` },
    }),
  });
  if (!inviteRes.ok) {
    const body = await inviteRes.text();
    console.error(`generate_link failed: ${inviteRes.status} ${body.slice(0, 300)}`);
    // Non-fatal — the user was created, Lauren can resend the invite manually.
  }

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
    console.error('checkout.session.completed missing vessel_registration_id');
    return;
  }

  const registration = await fetchRegistration(registrationId);
  if (!registration) {
    console.error(`Registration ${registrationId} not found`);
    return;
  }

  // Idempotency — if this registration already converted, no-op.
  if (registration.converted_at || registration.tenant_id) {
    console.log(`Registration ${registrationId} already converted, skipping`);
    return;
  }

  // Defence in depth — if a tenant with this IMO already exists, something
  // raced past the /pricing guard. Don't double-create. Cancel the dup sub.
  if (await tenantExistsByImo(registration.imo_number)) {
    console.error(
      `Tenant with IMO ${registration.imo_number} already exists. Cancelling duplicate subscription ${session.subscription}.`
    );
    await cancelSubscription(session.subscription);
    return;
  }

  // 1. Create the tenant
  const tenant = await createTenantRow(registration, session);

  // 2. Invite the user (creates auth user + sends email)
  const { id: userId } = await inviteUser(
    registration.contact_email,
    registration.contact_name || ''
  );

  // 3. Upsert profile and link to tenant
  await upsertProfile(userId, registration);
  await setProfileTenant(userId, tenant.id);

  // 4. Create tenant_members row with COMMAND role
  await createTenantMember(userId, tenant.id);

  // 5. Mark the registration row converted
  await markRegistrationConverted(registration.id, tenant.id);

  console.log(`Provisioned tenant ${tenant.id} for registration ${registration.id}`);
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
