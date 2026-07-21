// Netlify Function: create-supplier-payment-session
//
// Crew "Pay by card" → a Stripe Checkout Session as a DIRECT CHARGE on the
// supplier's connected account (supplier = merchant of record). Cargo's
// platform fee rides along via application_fee_amount and lands in Cargo's
// platform balance. The buyer pays the invoice face value.
//
// Input (POST, Authorization: Bearer <supabase access token>):
//   { supplier_invoice_id: uuid }
// Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE_URL = process.env.SITE_URL || process.env.URL || 'https://cargotechnology.netlify.app';

const CHIEF_PLUS = ['CHIEF', 'COMMAND'];

function encodeForm(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) parts.push(encodeForm(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.filter(Boolean).join('&');
}

// stripeAccount → adds the Stripe-Account header so the call acts ON the
// connected account (direct charge).
async function stripePost(path, params, stripeAccount) {
  const headers = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-11-20.acacia',
  };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers, body: encodeForm(params) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

async function getUserFromToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}
const svc = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' };
async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc });
  if (!res.ok) throw new Error(`REST GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function restPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST', headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!STRIPE_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Payments not configured.' }) };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Backend not configured.' }) };

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  const invoiceId = body.supplier_invoice_id;
  if (!invoiceId) return { statusCode: 400, body: JSON.stringify({ error: 'supplier_invoice_id is required' }) };

  try {
    const user = await getUserFromToken(token);
    const uid = user?.id;
    if (!uid) return { statusCode: 401, body: JSON.stringify({ error: 'Session expired — please sign in again.' }) };

    const invoices = await restGet(
      `supplier_invoices?id=eq.${invoiceId}&select=id,order_id,supplier_id,tenant_id,amount,currency,status,invoice_number,yacht_name`
    );
    const invoice = invoices?.[0];
    if (!invoice) return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) };
    if (invoice.status === 'paid') return { statusCode: 409, body: JSON.stringify({ error: 'This invoice is already paid.' }) };

    // Caller must be an active CHIEF+ member of the buying tenant.
    const members = await restGet(
      `tenant_members?user_id=eq.${uid}&tenant_id=eq.${invoice.tenant_id}&active=eq.true&select=permission_tier&limit=1`
    );
    const tier = members?.[0]?.permission_tier;
    if (!CHIEF_PLUS.includes(tier)) return { statusCode: 403, body: JSON.stringify({ error: 'Only Chief and Command crew can pay by card.' }) };

    const suppliers = await restGet(
      `supplier_profiles?id=eq.${invoice.supplier_id}&select=id,name,stripe_account_id,stripe_charges_enabled`
    );
    const supplier = suppliers?.[0];
    if (!supplier?.stripe_account_id || !supplier.stripe_charges_enabled) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This supplier isn’t set up to accept cards yet.' }) };
    }

    const cfg = (await restGet(`platform_payment_config?id=eq.1&select=fee_percent,card_min_amount`))?.[0]
      || { fee_percent: 0.75, card_min_amount: 50 };
    const amount = Number(invoice.amount) || 0;
    if (amount < Number(cfg.card_min_amount)) {
      return { statusCode: 409, body: JSON.stringify({ error: `Card payment is available for amounts of ${cfg.card_min_amount} and above.` }) };
    }

    const currency = String(invoice.currency || 'EUR').toLowerCase();
    const unitAmountMinor = Math.round(amount * 100);
    // fee in minor units = amount * fee_percent%  ×100  = round(amount * fee_percent).
    const feeMinor = Math.round(amount * (Number(cfg.fee_percent) || 0));

    const meta = {
      supplier_invoice_id: invoice.id,
      supplier_order_id: invoice.order_id || '',
      tenant_id: invoice.tenant_id,
    };
    const payerEmail = user?.email || '';
    const session = await stripePost('checkout/sessions', {
      mode: 'payment',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': unitAmountMinor,
      'line_items[0][price_data][product_data][name]': `Invoice ${invoice.invoice_number}`,
      'line_items[0][quantity]': 1,
      'payment_intent_data[application_fee_amount]': feeMinor,
      'payment_intent_data[metadata][supplier_invoice_id]': meta.supplier_invoice_id,
      'payment_intent_data[metadata][supplier_order_id]': meta.supplier_order_id,
      'payment_intent_data[metadata][tenant_id]': meta.tenant_id,
      // Stripe emails the payer a branded receipt for the charge — the payment
      // is processed by Stripe, so the confirmation comes from Stripe.
      'payment_intent_data[receipt_email]': payerEmail || undefined,
      customer_email: payerEmail || undefined,
      'metadata[supplier_invoice_id]': meta.supplier_invoice_id,
      'metadata[supplier_order_id]': meta.supplier_order_id,
      'metadata[tenant_id]': meta.tenant_id,
      success_url: `${SITE_URL}/accounts/payables?paid=1`,
      cancel_url: `${SITE_URL}/accounts/payables?cancelled=1`,
    }, supplier.stripe_account_id);

    // Audit row (idempotency + reconciliation). PI id lands via the webhook.
    await restPost('supplier_payments', {
      tenant_id: invoice.tenant_id,
      supplier_order_id: invoice.order_id || null,
      supplier_invoice_id: invoice.id,
      stripe_account_id: supplier.stripe_account_id,
      stripe_session_id: session.id,
      amount,
      currency: invoice.currency || 'EUR',
      application_fee: Number((feeMinor / 100).toFixed(2)),
      status: 'created',
      created_by: uid,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('create-supplier-payment-session error:', err?.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start the card payment. Please try again.' }) };
  }
};
