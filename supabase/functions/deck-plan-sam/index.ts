// Supabase Edge Function: deck-plan-sam
//
// Point-prompted room segmentation for the deck plan, via Segment Anything 2
// (SAM2) on fal.ai. The client sends one deck image plus a single point (a crew
// pin or a tap) in that image's pixel coords; SAM returns a clean mask of the
// room at that point. We fetch the mask and hand it back as base64 so the client
// can trace its boundary with the existing contour tools — no CORS taint.
//
// This is the "better AI" pilot: SAM does the pixel geometry (where my
// threshold/flood-fill struggles on open decks and soft edges), while Claude
// still reads the room names in deck-plan-autotrace.
//
// Request body:  { imageBase64: string, x: number, y: number, mediaType?: string }
//                x,y are PIXEL coordinates in the sent image (label = foreground).
// Response:      { maskUrl: string, width: number, height: number }
//                The client loads the mask URL directly (fal media serves it with
//                open CORS) and traces its boundary — we do NOT base64 the mask
//                here, because a multi-MB mask can OOM the isolate / blow the
//                response limit → a platform 502.
// Env vars:      FAL_KEY  (get one at https://fal.ai/dashboard/keys)

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!FAL_KEY) return json({ error: 'FAL_KEY not configured' }, 500);
  try {
    const { imageBase64, x, y, mediaType } = await req.json();
    if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400);
    if (typeof x !== 'number' || typeof y !== 'number') return json({ error: 'x and y (pixels) are required' }, 400);

    const media = (mediaType || 'image/jpeg').split(';')[0].trim();
    const dataUri = `data:${media};base64,${imageBase64}`;

    const falRes = await fetch('https://fal.run/fal-ai/sam2/image', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: dataUri,
        prompts: [{ label: 1, x: Math.round(x), y: Math.round(y) }],
        output_format: 'png',
      }),
    });
    if (!falRes.ok) {
      const t = await falRes.text();
      console.error('[deck-plan-sam] fal error:', falRes.status, t.slice(0, 600));
      return json({ error: `segmentation failed (${falRes.status})`, detail: t.slice(0, 600) }, 502);
    }
    const data = await falRes.json();
    const mask = data?.combined_mask || (Array.isArray(data?.individual_masks) ? data.individual_masks[0] : null);
    const url = mask?.url;
    if (!url) {
      console.error('[deck-plan-sam] no mask in response:', JSON.stringify(data).slice(0, 400));
      return json({ error: 'no mask returned' }, 502);
    }
    // Hand the mask URL straight back — the browser loads it (fal media is CORS-
    // open) and traces it. No server-side download/base64, so nothing large to
    // build or return.
    return json({ maskUrl: url, width: mask.width || null, height: mask.height || null });
  } catch (err: any) {
    console.error('[deck-plan-sam] error:', err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
