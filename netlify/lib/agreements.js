// Shared by the checkout functions and stripe-webhook: the customer's
// acceptance of the Cargo Terms of Service (incl. the Article 28 data
// processing terms), ticked before payment.
//
// TERMS_VERSION is the "Last updated" date of the Terms page
// (src/marketing/pages/TermsPage.jsx). Bump it whenever the Terms change, so
// each acceptance records exactly which version was agreed to.

const TERMS_VERSION = '2026-10-18';

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// Validate what the browser sent. Returns { ok, error?, customer? }.
function readAcceptance(body) {
  if (body?.accept_terms !== true) {
    return { ok: false, error: 'Please accept the Terms of Service to continue.' };
  }
  const legalName = clean(body?.customer?.legal_name, 200);
  const country = clean(body?.customer?.country, 100);
  if (legalName.length < 2) return { ok: false, error: 'Please enter the company the vessel is billed to.' };
  if (country.length < 2) return { ok: false, error: 'Please enter the country the company is registered in.' };
  return { ok: true, customer: { legalName, country } };
}

function requestMeta(event) {
  const h = event?.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || null;
  return { ip: ip || null, userAgent: clean(h['user-agent'] || '', 400) || null };
}

// Insert the acceptance row (service role). Throws on failure — the caller
// must not send the customer to payment without a record of acceptance.
async function recordAgreement({ supabaseUrl, serviceKey, row }) {
  const res = await fetch(`${supabaseUrl}/rest/v1/customer_agreements`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ terms_version: TERMS_VERSION, ...row }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`customer_agreements insert ${res.status}: ${text.slice(0, 300)}`);
  }
}

// Called by stripe-webhook once payment completes: tie the acceptance to the
// tenant and copy the headline fields onto it. Best-effort — logs, never throws.
async function linkAgreementToTenant({ supabaseUrl, serviceKey, sessionId, tenantId, userId }) {
  if (!sessionId || !tenantId) return;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  try {
    const q = `${supabaseUrl}/rest/v1/customer_agreements?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`;
    const res = await fetch(q, { headers });
    if (!res.ok) throw new Error(`lookup ${res.status}`);
    const [agreement] = await res.json();
    if (!agreement) {
      console.warn(`[agreements] no acceptance recorded for session ${sessionId}`);
      return;
    }
    const patch = { tenant_id: tenantId, linked_at: new Date().toISOString() };
    if (!agreement.accepted_by_user_id && userId) patch.accepted_by_user_id = userId;
    await fetch(`${supabaseUrl}/rest/v1/customer_agreements?id=eq.${agreement.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    await fetch(`${supabaseUrl}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        customer_legal_name: agreement.customer_legal_name,
        customer_country: agreement.customer_country,
        terms_version: agreement.terms_version,
        terms_accepted_at: agreement.accepted_at,
        terms_accepted_by_name: agreement.accepted_by_name || agreement.accepted_by_email || null,
      }),
    });
  } catch (err) {
    console.error(`[agreements] linking session ${sessionId} to tenant ${tenantId} failed: ${err?.message || err}`);
  }
}

module.exports = { TERMS_VERSION, readAcceptance, requestMeta, recordAgreement, linkAgreementToTenant };
