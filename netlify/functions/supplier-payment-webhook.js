// Netlify Function: supplier-payment-webhook
//
// Connect webhook (scope: Connected accounts). Two jobs:
//   1. account.updated  → persist the supplier's charges/payouts capability
//      flags so Cargo knows when they can accept cards.
//   2. payment events   → reconcile supplier_payments and mark the invoice
//      paid; the existing paid→ledger trigger posts it to the yacht's ledger.
//
// Separate from the subscriptions webhook (stripe-webhook.js) by design.
// Verify signatures with STRIPE_CONNECT_WEBHOOK_SECRET.
//
// Env: STRIPE_CONNECT_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const crypto = require('crypto');

const STRIPE_CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return { ok: false, reason: 'missing signature or secret' };
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') acc.v1.push(v);
    return acc;
  }, { timestamp: null, v1: [] });
  if (!parts.timestamp || parts.v1.length === 0) return { ok: false, reason: 'malformed signature header' };
  const expected = crypto.createHmac('sha256', secret).update(`${parts.timestamp}.${rawBody}`, 'utf8').digest('hex');
  const matches = parts.v1.some((sig) => {
    try { return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch { return false; }
  });
  return matches ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

const restHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders });
  if (!res.ok) throw new Error(`REST GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function restPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: { ...restHeaders, Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST PATCH ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Idempotent: only transitions an invoice that isn't already paid. The
// paid→ledger DB trigger (one-post-per-invoice) makes the ledger post safe on
// webhook retries.
async function markInvoicePaid(invoiceId) {
  if (!invoiceId) return;
  // Flip the invoice iff not already paid; capture order_id from the row so we
  // can advance the parent order in the same idempotent step.
  const rows = await restPatch(
    `supplier_invoices?id=eq.${invoiceId}&status=neq.paid&select=id,order_id`,
    { status: 'paid', payment_method: 'card', paid_at: new Date().toISOString() },
  );
  const orderId = Array.isArray(rows) ? rows[0]?.order_id : null;
  // Advance the parent order to 'paid' so the lifecycle bar reaches PAID on
  // both crew and supplier views. Guarded on status so retries are no-ops, and
  // only runs when the invoice actually transitioned this call.
  if (orderId) {
    await restPatch(`supplier_orders?id=eq.${orderId}&status=neq.paid`, { status: 'paid' });
  }
}

async function setPaymentStatus(match, patch) {
  // match: a PostgREST filter string identifying the supplier_payments row(s).
  await restPatch(`supplier_payments?${match}`, patch);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!STRIPE_CONNECT_WEBHOOK_SECRET) return { statusCode: 500, body: 'Connect webhook not configured' };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 500, body: 'Supabase not configured' };

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');

  const verification = verifyStripeSignature(rawBody, signature, STRIPE_CONNECT_WEBHOOK_SECRET);
  if (!verification.ok) return { statusCode: 400, body: `Webhook signature verification failed: ${verification.reason}` };

  let evt;
  try { evt = JSON.parse(rawBody); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  try {
    switch (evt.type) {
      case 'account.updated': {
        const acct = evt.data.object;
        const chargesEnabled = !!acct.charges_enabled;
        const patch = {
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: !!acct.payouts_enabled,
        };
        // Stamp the first time they become fully able to charge.
        if (chargesEnabled && acct.details_submitted) patch.stripe_onboarded_at = new Date().toISOString();
        await restPatch(
          `supplier_profiles?stripe_account_id=eq.${acct.id}${patch.stripe_onboarded_at ? '&stripe_onboarded_at=is.null' : ''}`,
          patch,
        );
        // If we skipped the onboarded_at stamp via the is.null guard, still sync the flags.
        if (patch.stripe_onboarded_at) {
          await restPatch(`supplier_profiles?stripe_account_id=eq.${acct.id}`, {
            stripe_charges_enabled: chargesEnabled, stripe_payouts_enabled: !!acct.payouts_enabled,
          });
        }
        break;
      }
      case 'checkout.session.completed': {
        const s = evt.data.object;
        const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
        if (s.id) await setPaymentStatus(`stripe_session_id=eq.${s.id}`, {
          stripe_payment_intent_id: pi || null,
          status: s.payment_status === 'paid' ? 'succeeded' : 'processing',
        });
        if (s.payment_status === 'paid') await markInvoicePaid(s.metadata?.supplier_invoice_id);
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = evt.data.object;
        await setPaymentStatus(`stripe_payment_intent_id=eq.${pi.id}`, { status: 'succeeded' });
        await markInvoicePaid(pi.metadata?.supplier_invoice_id);
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = evt.data.object;
        await setPaymentStatus(`stripe_payment_intent_id=eq.${pi.id}`, { status: 'failed' });
        break;
      }
      case 'charge.refunded': {
        const ch = evt.data.object;
        const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id;
        if (pi) await setPaymentStatus(`stripe_payment_intent_id=eq.${pi}`, { status: 'refunded' });
        break;
      }
      default:
        break; // ignore everything else
    }
  } catch (err) {
    console.error('supplier-payment-webhook error:', evt?.type, err?.message || err);
    // 500 tells Stripe to retry — safe because every handler is idempotent.
    return { statusCode: 500, body: 'handler error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
