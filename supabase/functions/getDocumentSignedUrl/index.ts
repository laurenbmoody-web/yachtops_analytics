// Supabase Edge Function: getDocumentSignedUrl
//
// Generalised signed-URL minting for supplier-side documents. Replaces and
// extends getInvoiceSignedUrl. Supports four document kinds, two storage
// buckets, two parent tables — all behind one auth-checking entry point.
//
//   ┌─────────────────────────┬──────────────────────┬──────────────────────────┐
//   │ documentKind            │ Bucket               │ Parent table / column    │
//   ├─────────────────────────┼──────────────────────┼──────────────────────────┤
//   │ 'invoice'               │ supplier-invoices    │ supplier_invoices.pdf_url│
//   │ 'order_pdf'             │ supplier-documents   │ supplier_orders.order_pdf_url             │
//   │ 'delivery_note'         │ supplier-documents   │ supplier_orders.delivery_note_pdf_url     │
//   │ 'delivery_note_signed'  │ supplier-documents   │ supplier_orders.delivery_note_signed_pdf_url │
//   └─────────────────────────┴──────────────────────┴──────────────────────────┘
//
// Auth: caller must be either an active supplier_contacts row for the
// owning supplier, OR an active tenant_members row for the owning tenant.
// Storage RLS is bypassed via the service-role key — this function is the
// single gate, same pattern as getInvoiceSignedUrl.
//
// Env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request body:
//   { documentKind: string, documentId: uuid }
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
const SIGNED_URL_TTL        = 600; // 10 minutes

type DocumentKind = 'invoice' | 'order_pdf' | 'delivery_note' | 'delivery_note_signed';

interface DocumentSpec {
  bucket: string;
  parentTable: 'supplier_invoices' | 'supplier_orders';
  pathColumn: string;
  supplierIdColumn: 'supplier_id' | 'supplier_profile_id';
  tenantIdColumn: 'tenant_id';
}

const DOCUMENT_SPECS: Record<DocumentKind, DocumentSpec> = {
  invoice: {
    bucket: 'supplier-invoices',
    parentTable: 'supplier_invoices',
    pathColumn: 'pdf_url',
    supplierIdColumn: 'supplier_id',
    tenantIdColumn: 'tenant_id',
  },
  order_pdf: {
    bucket: 'supplier-documents',
    parentTable: 'supplier_orders',
    pathColumn: 'order_pdf_url',
    supplierIdColumn: 'supplier_profile_id',
    tenantIdColumn: 'tenant_id',
  },
  delivery_note: {
    bucket: 'supplier-documents',
    parentTable: 'supplier_orders',
    pathColumn: 'delivery_note_pdf_url',
    supplierIdColumn: 'supplier_profile_id',
    tenantIdColumn: 'tenant_id',
  },
  delivery_note_signed: {
    bucket: 'supplier-documents',
    parentTable: 'supplier_orders',
    pathColumn: 'delivery_note_signed_pdf_url',
    supplierIdColumn: 'supplier_profile_id',
    tenantIdColumn: 'tenant_id',
  },
};

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
  const { documentKind, documentId } = body || {};
  if (!documentKind || !documentId) {
    return jsonResponse({ error: 'Missing documentKind or documentId' }, 400);
  }

  const spec = DOCUMENT_SPECS[documentKind as DocumentKind];
  if (!spec) {
    return jsonResponse({ error: `Unknown documentKind: ${documentKind}` }, 400);
  }

  try {
    // Fetch parent row metadata (service role bypasses RLS).
    const selectCols = ['id', spec.supplierIdColumn, spec.tenantIdColumn, spec.pathColumn].join(',');
    const rows = await restGet<any[]>(
      `${spec.parentTable}?id=eq.${documentId}&select=${selectCols}`
    );
    const row = rows?.[0];
    if (!row) return jsonResponse({ error: 'Document not found' }, 404);

    const path = row[spec.pathColumn];
    if (!path) return jsonResponse({ error: 'Document has no file on record' }, 404);

    const supplierId = row[spec.supplierIdColumn];
    const tenantId   = row[spec.tenantIdColumn];

    // Auth check: supplier-side member OR vessel-side member.
    const [supplierMatches, tenantMatches] = await Promise.all([
      supplierId
        ? restGet<any[]>(
            `supplier_contacts?user_id=eq.${user.id}&supplier_id=eq.${supplierId}&active=eq.true&select=id&limit=1`
          )
        : Promise.resolve([]),
      tenantId
        ? restGet<any[]>(
            `tenant_members?user_id=eq.${user.id}&tenant_id=eq.${tenantId}&active=eq.true&select=id&limit=1`
          )
        : Promise.resolve([]),
    ]);

    const isSupplierSide = Array.isArray(supplierMatches) && supplierMatches.length > 0;
    const isVesselSide   = Array.isArray(tenantMatches)   && tenantMatches.length > 0;

    if (!isSupplierSide && !isVesselSide) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // Mint signed URL via Storage REST.
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${spec.bucket}/${path}`,
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

    const signedUrl = `${SUPABASE_URL}/storage/v1${sig.signedURL}`;
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString();

    return jsonResponse({ signed_url: signedUrl, expires_at: expiresAt }, 200);

  } catch (err: any) {
    console.error('[getDocumentSignedUrl]', err);
    return jsonResponse({ error: err.message || String(err) }, 500);
  }
});
