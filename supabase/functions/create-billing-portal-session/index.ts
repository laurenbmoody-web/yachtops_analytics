// Supabase Edge Function: create-billing-portal-session
//
// The vessel admin (tenants.current_admin_user_id) opens Stripe's hosted
// Customer Portal to manage payment method, view invoices, and cancel the
// subscription (cancel-at-period-end, per our terms configured in Stripe).
//
// Auth: caller must be the active vessel admin of the tenant.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    if (!STRIPE_SECRET_KEY) return json({ error: 'billing_not_configured' }, 503);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'missing token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (userErr || !uid) return json({ error: 'invalid token' }, 401);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* none */ }
    const tenantId = String(body?.tenant_id || '');
    const flow = String(body?.flow || '');
    const returnUrl = String(body?.return_url || '') || `${SUPABASE_URL}`;
    if (!tenantId) return json({ error: 'tenant_id required' }, 400);

    // Caller must be the active vessel admin of this tenant.
    const { data: tenant } = await admin
      .from('tenants')
      .select('current_admin_user_id, stripe_customer_id, stripe_subscription_id')
      .eq('id', tenantId)
      .maybeSingle();
    if (!tenant || tenant.current_admin_user_id !== uid) {
      return json({ error: 'not authorized' }, 403);
    }
    if (!tenant.stripe_customer_id) {
      // No Stripe customer yet (billing not set up / not onboarded through checkout).
      return json({ error: 'no_customer' }, 409);
    }

    // Build the portal session request (optionally deep-linked to the cancel flow).
    const form = new URLSearchParams();
    form.set('customer', String(tenant.stripe_customer_id));
    form.set('return_url', returnUrl);
    if (flow === 'cancel' && tenant.stripe_subscription_id) {
      form.set('flow_data[type]', 'subscription_cancel');
      form.set('flow_data[subscription_cancel][subscription]', String(tenant.stripe_subscription_id));
    }

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) {
      console.error('[billing-portal] stripe error', data);
      return json({ error: 'stripe_error', detail: data?.error?.message || null }, 502);
    }
    return json({ url: data.url });
  } catch (e) {
    console.error('[create-billing-portal-session] error:', e);
    return json({ error: 'unexpected error' }, 500);
  }
});
