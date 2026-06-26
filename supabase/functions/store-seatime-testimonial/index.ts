// Supabase Edge Function: store-seatime-testimonial
//
// Stores a per-ship Testimonial of Sea Service PDF (generated client-side on
// sign) in the private sea-service-testimonials bucket, and stamps its path
// onto the signed entries so the log / Step 03 can offer "View testimonial".
// Called from the public sign page (by token) and the in-app reviews queue (by
// entryIds). Runs with the service role; verify_jwt disabled so the public,
// session-less master path works — the rows it touches are derived server-side.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Body: { pdfBase64: string, token?: string, entryIds?: string[] }

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
const BUCKET = 'sea-service-testimonials';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function supaGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { pdfBase64, token, entryIds } = await req.json();
    if (!pdfBase64) return json({ error: 'pdfBase64 required' }, 400);

    let ids: string[] = [], tenant = '', userId = '', vessel = '';
    if (token) {
      const reqs = await supaGet(`sea_service_sign_requests?token=eq.${encodeURIComponent(token)}&select=row_ids,tenant_id,seafarer_user_id,vessel_name`) as Array<Record<string, unknown>> | null;
      const r = reqs?.[0];
      if (!r) return json({ error: 'request not found' }, 404);
      ids = (r.row_ids as string[]) || [];
      tenant = String(r.tenant_id || ''); userId = String(r.seafarer_user_id || ''); vessel = String(r.vessel_name || '');
    } else if (Array.isArray(entryIds) && entryIds.length) {
      ids = entryIds.map((x: string) => String(x)).filter(Boolean);
      const rows = await supaGet(`sea_service_entries?id=in.(${ids.join(',')})&select=tenant_id,user_id,vessel_name`) as Array<Record<string, unknown>> | null;
      const r = rows?.[0];
      if (!r) return json({ error: 'entries not found' }, 404);
      tenant = String(r.tenant_id || ''); userId = String(r.user_id || ''); vessel = String(r.vessel_name || '');
    } else {
      return json({ error: 'token or entryIds required' }, 400);
    }
    if (!ids.length || !tenant || !userId) return json({ error: 'could not resolve entries' }, 404);

    // base64 → bytes
    const bin = atob(pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const safe = (vessel || 'vessel').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'vessel';
    const path = `${tenant}/${userId}/${safe}-${Date.now()}.pdf`;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
      body: bytes,
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      console.error('[store-seatime-testimonial] upload failed', up.status, t);
      return json({ error: 'upload failed' }, 500);
    }

    await fetch(`${SUPABASE_URL}/rest/v1/sea_service_entries?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ testimonial_path: path }),
    }).catch(() => {});

    return json({ ok: true, path });
  } catch (e) {
    console.error('[store-seatime-testimonial] error', e);
    return json({ error: String(e) }, 500);
  }
});
