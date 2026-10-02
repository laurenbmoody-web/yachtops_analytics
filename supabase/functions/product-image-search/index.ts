// Supabase Edge Function: product-image-search
//
// Given a product query (e.g. "Oral-B iO 10 Black Electric Toothbrush"), find a
// product photo via the Google Custom Search JSON API (image search), re-host
// the chosen image into the app's `item-images` bucket (so it's stable and not
// subject to third-party hotlink blocking), and return its public URL. Used by
// the inventory photo-scan flow to suggest a real product photo for each item
// it extracts from an order screenshot or packing list.
//
// Fails soft: on any error, or if the Google keys aren't configured, it returns
// 200 with an empty result so the scan flow keeps working (just without a photo).
//
// Secrets (set in Supabase → Project Settings → Edge Functions → Secrets):
//   GOOGLE_CSE_KEY  — a Google API key with "Custom Search API" enabled
//   GOOGLE_CSE_CX   — the Programmable Search Engine ID (cx), image search on
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Request body:  { query: string, count?: number }
// Response:      { image: string, images: string[] }
//   image  — a stable public URL in item-images (or a raw result URL on
//            re-host failure), '' if nothing found
//   images — the raw candidate URLs from Google ([] if none)

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GOOGLE_CSE_KEY = Deno.env.get('GOOGLE_CSE_KEY') || '';
const GOOGLE_CSE_CX = Deno.env.get('GOOGLE_CSE_CX') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'item-images';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif',
};

// Download a remote image and store it in the public item-images bucket.
// Returns the stable public URL, or '' on any failure (caller falls back).
async function rehost(remoteUrl: string): Promise<string> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return '';
  try {
    const img = await fetch(remoteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
      redirect: 'follow',
    });
    if (!img.ok) return '';
    const type = (img.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!type.startsWith('image/')) return '';
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return '';
    const ext = EXT[type] || 'jpg';
    const path = `inventory/scan/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'apikey': SERVICE_ROLE,
        'content-type': type,
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!up.ok) { console.error('[product-image-search] upload failed', up.status); return ''; }
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch (err) {
    console.error('[product-image-search] rehost error', err);
    return '';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  // No keys configured → degrade quietly to "no photo found".
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) return json({ image: '', images: [] });

  let body: { query?: string; count?: number } | null = null;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const query = (typeof body?.query === 'string' ? body.query : '').trim();
  if (!query) return json({ image: '', images: [] });
  const count = Math.min(Math.max(Number(body?.count) || 3, 1), 5);

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_CSE_KEY);
  url.searchParams.set('cx', GOOGLE_CSE_CX);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', String(count));
  url.searchParams.set('safe', 'active');
  url.searchParams.set('imgType', 'photo');
  url.searchParams.set('q', query);

  try {
    const r = await fetch(url.toString());
    if (!r.ok) {
      console.error('[product-image-search] Google error', r.status, await r.text().catch(() => ''));
      return json({ image: '', images: [] });
    }
    const data = await r.json();
    const images: string[] = (Array.isArray(data?.items) ? data.items : [])
      .map((it: Record<string, unknown>) => (typeof it?.link === 'string' ? it.link : ''))
      .filter((u: string) => /^https:\/\//i.test(u))
      .slice(0, count);

    // Re-host the first candidate that downloads successfully; fall back to the
    // raw top URL if none can be re-hosted.
    let image = '';
    for (const candidate of images) {
      image = await rehost(candidate);
      if (image) break;
    }
    if (!image) image = images[0] || '';

    return json({ image, images });
  } catch (err) {
    console.error('[product-image-search] fetch error', err);
    return json({ image: '', images: [] });
  }
});
