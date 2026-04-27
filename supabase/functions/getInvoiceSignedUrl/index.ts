// Supabase Edge Function: getInvoiceSignedUrl
//
// Mints a short-lived signed URL for a supplier_invoices PDF, after
// verifying the caller has permission to see it. Used by both:
//
//   - The supplier portal (Documents → Open invoice)
//   - The vessel-side provisioning board (invoice received indicator)
//
// We don't RLS the supplier-invoices storage bucket directly. Instead this
// function uses the service-role key to bypass storage RLS, but performs
// a manual auth check first against:
//
//   - supplier_contacts (active contact for invoice.supplier_id), OR
//   - tenant_members (active member for invoice.tenant_id)
//
// Either grants access. Anyone else gets 403.
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request body:
//   { invoiceId: uuid }
//
// Response:
//   { signed_url: string, expires_at: string (ISO) }

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET                = 'supplier-invoices';
const SIGNED_URL_TTL        = 600; // 10 minutes

const restHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function restGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders });
  if (!res.ok) throw new Error(`REST GET ${path} failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function userFromJwt(authHeader: string): Promise<{ id: string } | null> {
  const token = authHeader.replace(/^Bearer\s+/, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { id: u.id } : null;
}

function jsonResponse(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Supabase env not configured' }, 500);
  }

  // Auth
  const auth = req.headers.get('Authorization') || '';
  const user = await userFromJwt(auth);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Parse body
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  const { invoiceId } = body || {};
  if (!invoiceId) return jsonResponse({ error: 'Missing invoiceId' }, 400);

  try {
    // Fetch invoice metadata (service role bypasses RLS; we'll do our own
    // auth check below).
    const invoices = await restGet<any[]>(
      `supplier_invoices?id=eq.${invoiceId}&select=id,supplier_id,tenant_id,pdf_url`
    );
    const invoice = invoices?.[0];
    if (!invoice) return jsonResponse({ error: 'Invoice not found' }, 404);
    if (!invoice.pdf_url) return jsonResponse({ error: 'Invoice has no PDF on file' }, 404);

    // Auth check: is the caller a supplier-side member of invoice.supplier_id,
    // OR a vessel-side member of invoice.tenant_id?
    const [supplierMatches, tenantMatches] = await Promise.all([
      invoice.supplier_id
        ? restGet<any[]>(
            `supplier_contacts?user_id=eq.${user.id}&supplier_id=eq.${invoice.supplier_id}&active=eq.true&select=id&limit=1`
          )
        : Promise.resolve([]),
      invoice.tenant_id
        ? restGet<any[]>(
            `tenant_members?user_id=eq.${user.id}&tenant_id=eq.${invoice.tenant_id}&active=eq.true&select=id&limit=1`
          )
        : Promise.resolve([]),
    ]);

    const isSupplierSide = Array.isArray(supplierMatches) && supplierMatches.length > 0;
    const isVesselSide   = Array.isArray(tenantMatches)   && tenantMatches.length > 0;

    if (!isSupplierSide && !isVesselSide) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // Mint a signed URL via Storage REST. Path stored in invoice.pdf_url is
    // relative to the bucket root (e.g. {supplier_id}/INV-2026-0001.pdf).
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${invoice.pdf_url}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
      }
    );

    if (!signRes.ok) {
      const errText = await signRes.text();
      return jsonResponse(
        { error: `Could not mint signed URL: ${signRes.status} ${errText.slice(0, 200)}` },
        500
      );
    }

    const sig = await signRes.json();
    if (!sig?.signedURL) {
      return jsonResponse({ error: 'No signed URL returned by storage' }, 500);
    }

    // Storage REST returns signedURL relative to /storage/v1; prefix with
    // SUPABASE_URL so the caller can open it directly.
    const signedUrl = `${SUPABASE_URL}/storage/v1${sig.signedURL}`;
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString();

    return jsonResponse({ signed_url: signedUrl, expires_at: expiresAt }, 200);

  } catch (err: any) {
    console.error('[getInvoiceSignedUrl]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});
