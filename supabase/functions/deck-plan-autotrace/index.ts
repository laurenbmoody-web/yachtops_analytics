// Supabase Edge Function: deck-plan-autotrace
//
// Reads a single framed deck image (the crop of the vessel's General
// Arrangement drawing) with Claude vision and returns the rooms it can identify
// on it — each with the printed room name and a rough polygon tracing its walls,
// normalized 0..1 to the image. The client matches those names to the deck's
// existing rooms and lands the outlines as editable traced shapes for the crew
// to refine (the model proposes, the human perfects).
//
// This never writes to the database and never creates rooms; it only reads the
// picture and proposes. Same ANTHROPIC_API_KEY as the other parse functions.
//
// Request body:  { imageBase64: string, mediaType?: string, deckName?: string,
//                  roomNames?: string[] }
// Response:      { rooms: [{ name, points:[{x,y}], confidence }] }
// Env vars:      ANTHROPIC_API_KEY

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const basePrompt = `You are reading one deck of a yacht's General Arrangement (GA) drawing — a top-down architectural deck plan. Identify the individual rooms/spaces on this deck.

For each room give the printed name, ONE interior point that sits clearly inside the room (not on a wall or a label), and a bounding box that snugly contains the whole room. Precise wall-tracing is done separately from the pixels — you only need to locate each room, not trace its walls.

Return ONLY a JSON object (no prose, no code fence):

{
  "rooms": [
    {
      "name": "Master Cabin",       // the room's printed label, transcribed exactly as it appears
      "seed": {"x":0.24,"y":0.44},  // a point plainly INSIDE the room — its open floor centre
      "bbox": {"x":0.12,"y":0.30,"w":0.22,"h":0.28}, // snug box: x,y = top-left; w,h = size
      "confidence": 0.0             // 0..1 — your confidence this is a real, correctly-located room
    }
  ]
}

Coordinate rules:
- All values are fractions 0..1 of THIS image. x=0 is the left edge, x=1 the right edge; y=0 is the TOP edge, y=1 the bottom edge.
- seed must be well inside the room's own walls (pick an empty bit of floor, away from furniture and text). bbox must wrap the whole room tightly — not the whole deck, not a loose margin.

What to include:
- Only spaces that carry a printed name/label (cabins, saloon, galley, heads/bathrooms, crew mess, bridge, engine room, lazarette, tender garage, sun deck, etc.). Transcribe the label verbatim.
- Skip corridors/passageways unless clearly labelled, and skip dimension notes, title blocks, scale bars, and the vessel outline itself.
- If you cannot read any room labels or this is not a deck plan, return {"rooms": []}.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  try {
    const { imageBase64, mediaType, deckName, roomNames } = await req.json();
    if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400);

    const media = (mediaType || 'image/jpeg').split(';')[0].trim();
    const hint =
      (deckName ? `\n\nThis deck is labelled "${deckName}".` : '') +
      (Array.isArray(roomNames) && roomNames.length
        ? `\n\nThe crew have already listed these rooms for this deck — prefer matching your transcribed names to these where they clearly correspond: ${roomNames.slice(0, 60).join(', ')}.`
        : '');

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
            { type: 'text', text: basePrompt + hint },
          ],
        }],
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error('[deck-plan-autotrace] AI error:', aiRes.status, t);
      return json({ error: `vision request failed (${aiRes.status})` }, 502);
    }
    const data = await aiRes.json();
    const text = (data?.content || []).map((b: any) => b?.text || '').join('').trim();

    let parsed: any = {};
    try {
      const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[deck-plan-autotrace] JSON parse failed:', e, text.slice(0, 400));
      return json({ rooms: [], error: 'could not parse model output' });
    }

    // Sanitise: clamp coords, keep named rooms with a usable seed only.
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const num = (n: any) => (typeof n === 'number' && isFinite(n) ? n : null);
    const rooms = (Array.isArray(parsed.rooms) ? parsed.rooms : [])
      .map((r: any) => {
        const name = typeof r?.name === 'string' ? r.name.trim() : '';
        const sx = num(r?.seed?.x); const sy = num(r?.seed?.y);
        const seed = sx != null && sy != null ? { x: clamp01(sx), y: clamp01(sy) } : null;
        let bbox = null;
        const bx = num(r?.bbox?.x); const by = num(r?.bbox?.y);
        const bw = num(r?.bbox?.w); const bh = num(r?.bbox?.h);
        if (bx != null && by != null && bw != null && bh != null && bw > 0 && bh > 0) {
          const x = clamp01(bx); const y = clamp01(by);
          bbox = { x, y, w: Math.min(1 - x, bw), h: Math.min(1 - y, bh) };
        }
        const confidence = typeof r?.confidence === 'number' ? r.confidence : null;
        return { name, seed, bbox, confidence };
      })
      .filter((r: any) => r.name && r.seed);

    return json({ rooms });
  } catch (err: any) {
    console.error('[deck-plan-autotrace] error:', err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
