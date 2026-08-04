// Supabase Edge Function: parse-garment-photos
//
// Given a few photos of ONE garment (typically front/back on a hanger, a
// brand/size label, and a care label), extract the catalogue fields so the
// crew barely have to type. Uses Claude vision. Fails soft: on any error it
// returns 200 with an empty `fields` object so the Add flow is never blocked.
//
// Request body:
//   {
//     images:     string[],   // data URLs (data:image/...;base64,...)
//     types?:     string[],   // allowed garment types (constrains output)
//     genders?:   string[],   // allowed cut/gender values
//     conditions?:string[],   // allowed condition values
//     careTags?:  string[],   // allowed care tag keys
//   }
//
// Response:
//   { fields: { name, brand, type, gender, size, colour, material, sku,
//               condition, care: string[], description } }

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
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface RequestBody {
  images?: string[];
  types?: string[];
  genders?: string[];
  conditions?: string[];
  careTags?: string[];
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

const EMPTY = { name: '', brand: '', type: '', gender: '', size: '', colour: '', material: '', sku: '', condition: '', care: [] as string[], description: '' };

// Split a data URL into an Anthropic image block. Returns null if not a data URL.
function imageBlock(dataUrl: string) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ fields: EMPTY });

  let body: RequestBody | null = null;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const images = (Array.isArray(body?.images) ? body!.images : []).slice(0, 5);
  const blocks = images.map(imageBlock).filter((b): b is NonNullable<typeof b> => !!b);
  if (blocks.length === 0) return json({ fields: EMPTY });

  const types = (body?.types || []).filter((s) => typeof s === 'string');
  const genders = (body?.genders || []).filter((s) => typeof s === 'string');
  const conditions = (body?.conditions || []).filter((s) => typeof s === 'string');
  const careTags = (body?.careTags || []).filter((s) => typeof s === 'string');

  const instruction =
    'These are photos of ONE garment for a luxury yacht wardrobe — typically the front and/or back on a hanger, a brand/size label, and a care label. ' +
    'Read every label carefully. Return ONLY a JSON object (no prose, no code fences) with these keys:\n' +
    '- name: a short descriptive title, e.g. "Navy linen shirt"\n' +
    '- brand: the maker from the label, else ""\n' +
    `- type: the single best match from [${types.join(', ')}], else ""\n` +
    `- gender: one of [${genders.join(', ')}], else ""\n` +
    '- size: exactly as printed on the label, e.g. "40R", "M", "UK 8", else ""\n' +
    '- colour: the main colour, else ""\n' +
    '- material: the fibre composition from the care/brand label, e.g. "100% linen", else ""\n' +
    '- sku: any style/reference code printed on the label, else ""\n' +
    `- condition: one of [${conditions.join(', ')}] judging from the photos, else ""\n` +
    `- care: an array, subset of [${careTags.join(', ')}], inferred from the care label symbols/text; [] if unsure\n` +
    '- description: one short sentence of distinguishing detail, else ""\n' +
    'Use "" or [] for anything you cannot determine. Do not guess wildly.';

  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        temperature: 0,
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: instruction }] }],
      }),
    });

    if (!r.ok) {
      console.error('[parse-garment-photos] Anthropic error', r.status, await r.text().catch(() => ''));
      return json({ fields: EMPTY });
    }

    const data = await r.json();
    let raw = (data?.content?.[0]?.text || '').trim();
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return json({ fields: EMPTY });

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return json({ fields: EMPTY }); }

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const inList = (v: unknown, list: string[]) => { const s = str(v); return list.includes(s) ? s : ''; };
    const fields = {
      name: str(parsed.name),
      brand: str(parsed.brand),
      type: types.length ? inList(parsed.type, types) : str(parsed.type),
      gender: genders.length ? inList(parsed.gender, genders) : str(parsed.gender),
      size: str(parsed.size),
      colour: str(parsed.colour),
      material: str(parsed.material),
      sku: str(parsed.sku),
      condition: conditions.length ? inList(parsed.condition, conditions) : str(parsed.condition),
      care: Array.isArray(parsed.care) ? parsed.care.map(str).filter((c) => (careTags.length ? careTags.includes(c) : !!c)) : [],
      description: str(parsed.description),
    };
    return json({ fields });
  } catch (err) {
    console.error('[parse-garment-photos] fetch error', err);
    return json({ fields: EMPTY });
  }
});
