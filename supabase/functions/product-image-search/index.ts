// Supabase Edge Function: product-image-search
//
// Given a product query (e.g. "Victorinox Swiss Classic Kitchen Set 5 pieces"),
// find candidate product photos via an image-search provider, and — on request —
// re-host a chosen image into the app's `item-images` bucket (so it's stable and
// not subject to third-party hotlink blocking) and return its public URL.
//
// Two callers:
//   • the photo-scan flow (legacy): { query } → { image, images }  (auto-rehosts
//     the first working candidate, same as before).
//   • the "Find images" review flow: { query } → { candidates, configured } to
//     show thumbnails, then { url } → { image } to re-host the one picked.
//
// Fails soft: on any error, or if no provider is configured, it returns 200 with
// empty results and `configured: false`, so callers can show a clear setup note
// instead of breaking.
//
// Image-search provider — set ONE of these in
// Supabase → Project Settings → Edge Functions → Secrets:
//   SERPAPI_KEY                       — a SerpApi key (single value, simplest)
//   GOOGLE_CSE_KEY + GOOGLE_CSE_CX    — a Google API key + Programmable Search
//                                       Engine id (image search enabled)
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SERPAPI_KEY = Deno.env.get('SERPAPI_KEY') || '';
const GOOGLE_CSE_KEY = Deno.env.get('GOOGLE_CSE_KEY') || '';
const GOOGLE_CSE_CX = Deno.env.get('GOOGLE_CSE_CX') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'item-images';

const PROVIDER = SERPAPI_KEY ? 'serpapi' : (GOOGLE_CSE_KEY && GOOGLE_CSE_CX ? 'google' : '');

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

type Candidate = { full: string; thumb: string; title: string };

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

// Provider: SerpApi Google Images.
async function searchSerpApi(query: string, count: number): Promise<Candidate[]> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_images');
  url.searchParams.set('q', query);
  url.searchParams.set('safe', 'active');
  url.searchParams.set('api_key', SERPAPI_KEY);
  const r = await fetch(url.toString());
  if (!r.ok) { console.error('[product-image-search] serpapi error', r.status); return []; }
  const data = await r.json();
  const rows = Array.isArray(data?.images_results) ? data.images_results : [];
  return rows
    .map((it: Record<string, unknown>) => ({
      full: typeof it?.original === 'string' ? it.original as string : '',
      thumb: typeof it?.thumbnail === 'string' ? it.thumbnail as string : '',
      title: typeof it?.title === 'string' ? it.title as string : '',
    }))
    .filter((c: Candidate) => /^https:\/\//i.test(c.full))
    .slice(0, count);
}

// Provider: Google Custom Search JSON API (image search).
async function searchGoogle(query: string, count: number): Promise<Candidate[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_CSE_KEY);
  url.searchParams.set('cx', GOOGLE_CSE_CX);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', String(Math.min(count, 10)));
  url.searchParams.set('safe', 'active');
  url.searchParams.set('imgType', 'photo');
  url.searchParams.set('q', query);
  const r = await fetch(url.toString());
  if (!r.ok) { console.error('[product-image-search] google error', r.status); return []; }
  const data = await r.json();
  const rows = Array.isArray(data?.items) ? data.items : [];
  return rows
    .map((it: Record<string, unknown>) => {
      const image = (it?.image || {}) as Record<string, unknown>;
      return {
        full: typeof it?.link === 'string' ? it.link as string : '',
        thumb: typeof image?.thumbnailLink === 'string' ? image.thumbnailLink as string : '',
        title: typeof it?.title === 'string' ? it.title as string : '',
      };
    })
    .filter((c: Candidate) => /^https:\/\//i.test(c.full))
    .slice(0, count);
}

async function search(query: string, count: number): Promise<Candidate[]> {
  try {
    if (PROVIDER === 'serpapi') return await searchSerpApi(query, count);
    if (PROVIDER === 'google') return await searchGoogle(query, count);
  } catch (err) {
    console.error('[product-image-search] search error', err);
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { query?: string; count?: number; url?: string } | null = null;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  // Mode 2: re-host a specific chosen image URL into the bucket.
  const rehostUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  if (rehostUrl) {
    const image = await rehost(rehostUrl);
    // Fall back to the raw URL so the caller can still save something.
    return json({ image: image || rehostUrl, rehosted: !!image });
  }

  // No provider configured → tell the caller so it can show a setup note.
  if (!PROVIDER) return json({ image: '', images: [], candidates: [], configured: false });

  // Mode 1: search for candidates.
  const query = (typeof body?.query === 'string' ? body.query : '').trim();
  if (!query) return json({ image: '', images: [], candidates: [], configured: true });
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 10);

  const candidates = await search(query, count);
  const images = candidates.map((c) => c.full);

  // Legacy behaviour for the photo-scan caller: auto-rehost the first candidate
  // that downloads, so { image } is a stable URL. Only done when a small count
  // is requested (the review flow passes count>=5 and rehosts on approval).
  let image = '';
  if (count <= 3) {
    for (const c of images) { image = await rehost(c); if (image) break; }
    if (!image) image = images[0] || '';
  }

  return json({ image, images, candidates, configured: true });
});
