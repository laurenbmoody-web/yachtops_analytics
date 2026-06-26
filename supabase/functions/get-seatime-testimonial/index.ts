// Supabase Edge Function: get-seatime-testimonial
//
// Mints a short-lived signed URL for a stored testimonial PDF in the private
// sea-service-testimonials bucket, so the log / Step 03 "View testimonial" link
// can open it. verify_jwt is ON — only an authenticated app user (the seafarer
// or their Command) reaches this; the path itself is stored on the entry, which
// they can already read under RLS.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Body: { path: string }

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { path } = await req.json();
    if (!path || typeof path !== 'string') return json({ error: 'path required' }, 400);

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.signedURL) {
      console.error('[get-seatime-testimonial] sign failed', res.status, JSON.stringify(j));
      return json({ error: 'could not sign' }, 404);
    }
    return json({ url: `${SUPABASE_URL}/storage/v1${j.signedURL}` });
  } catch (e) {
    console.error('[get-seatime-testimonial] error', e);
    return json({ error: String(e) }, 500);
  }
});
