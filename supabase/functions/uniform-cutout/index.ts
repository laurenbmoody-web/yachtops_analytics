// Supabase Edge Function: uniform-cutout
//
// Background removal for uniform item photos. The client sends the public URL of
// an uploaded item image; we run it through fal.ai's BiRefNet background-removal
// model (garment isolated on transparent), download the result and store it in
// the item-images bucket, then hand back the permanent public URL. The uniform
// modal swaps the item's image for this clean cutout.
//
// Triggered manually by a "Remove background" button (not on every upload) so we
// only spend a fal call when the photo actually needs it.
//
// Request body:  { imageUrl: string }   (public item-images URL)
// Response:      { url: string }         (permanent cutout URL in item-images)
// Env vars:      FAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FAL_KEY = Deno.env.get('FAL_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!FAL_KEY) return json({ error: 'FAL_KEY not configured' }, 500);
  try {
    const { imageUrl } = await req.json();
    if (!imageUrl || typeof imageUrl !== 'string') return json({ error: 'imageUrl is required' }, 400);

    // 1. Background removal via fal BiRefNet — returns the cutout on transparent.
    const falRes = await fetch('https://fal.run/fal-ai/birefnet', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl }),
    });
    if (!falRes.ok) {
      const t = await falRes.text();
      console.error('[uniform-cutout] fal error:', falRes.status, t.slice(0, 600));
      return json({ error: `cutout failed (${falRes.status})`, detail: t.slice(0, 600) }, 502);
    }
    const data = await falRes.json();
    const pick = (m: any) => (m && typeof m === 'object' ? m : (typeof m === 'string' ? { url: m } : null));
    const out = pick(data?.image)
      || pick(Array.isArray(data?.images) ? data.images[0] : null)
      || pick(data?.output);
    const cutoutUrl = out?.url;
    if (!cutoutUrl) {
      console.error('[uniform-cutout] no cutout in response; keys:', Object.keys(data || {}).join(', '));
      return json({ error: 'no cutout returned', detail: `response keys: ${Object.keys(data || {}).join(', ')}` }, 502);
    }

    // 2. Fetch the cutout bytes (fal media is CORS-open / server fetch is fine).
    const imgRes = await fetch(cutoutUrl);
    if (!imgRes.ok) return json({ error: 'could not fetch the cutout' }, 502);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());

    // 3. Store it permanently in item-images (service role), return its public URL.
    const path = `inventory/cutouts/${Date.now()}.png`;
    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/item-images/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
      body: bytes,
    });
    if (!upRes.ok) {
      const t = await upRes.text();
      console.error('[uniform-cutout] store error:', upRes.status, t.slice(0, 300));
      return json({ error: 'could not store the cutout', detail: t.slice(0, 300) }, 502);
    }
    return json({ url: `${SUPABASE_URL}/storage/v1/object/public/item-images/${path}` });
  } catch (err: any) {
    console.error('[uniform-cutout] error:', err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
