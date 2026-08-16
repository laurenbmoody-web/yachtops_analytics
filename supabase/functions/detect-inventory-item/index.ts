// Supabase Edge Function: detect-inventory-item
//
// Given ONE photo of a single inventory item somewhere inside a department's
// store (e.g. a jar in the Galley, a fender in the Deck lazarette), identify
// what it is and suggest which sub-folder of the current department it belongs
// in. Uses Claude vision. Fails soft: on any error it returns 200 with a null
// detection so the bulk-upload flow degrades to manual entry rather than
// breaking.
//
// Request body:
//   {
//     image:          string,     // data URL (data:image/...;base64,...)
//     departmentName: string,     // e.g. "Galley"
//     currentPath?:   string,     // sub_location the user is filing from, e.g. "Guest > Alcohol" ("" = department root)
//     folders?:       string[],   // existing sub_location paths at/under currentPath (the AI should prefer these)
//   }
//
// Response:
//   { detection: {
//       name: string,          // short item title, e.g. "Tinned San Marzano tomatoes"
//       quantity: number,      // count visible, >= 1
//       folder: string,        // full sub_location path to file into (from folders[] or a new one)
//       isNew: boolean,        // true if `folder` is a proposed NEW sub-folder
//       confidence: 'high' | 'medium' | 'low',
//       description: string,   // one short distinguishing sentence
//     } | null }

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
// Recognition quality matters more than cost here (varied provisions, gear,
// medical, partially-visible/unlabelled items). Switch to a haiku model to
// optimise cost.
const MODEL = 'claude-sonnet-5';

interface RequestBody {
  image?: string;
  departmentName?: string;
  currentPath?: string;
  folders?: string[];
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

// Split a data URL into an Anthropic image block. Returns null if not a data URL.
function imageBlock(dataUrl: string) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ detection: null });

  let body: RequestBody | null = null;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const block = imageBlock(body?.image || '');
  if (!block) return json({ detection: null });

  const department = (typeof body?.departmentName === 'string' ? body.departmentName : '').trim() || 'this department';
  const currentPath = (typeof body?.currentPath === 'string' ? body.currentPath : '').trim();
  const folders = (Array.isArray(body?.folders) ? body!.folders : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 200);

  const folderList = folders.length
    ? folders.map((f) => `  - ${f}`).join('\n')
    : '  (none yet)';
  const newFolderHint = currentPath
    ? `If none fit, propose a concise NEW sub-folder as a path nested under "${currentPath}", e.g. "${currentPath} > Sauces".`
    : 'If none fit, propose a concise NEW top-level sub-folder name for this department, e.g. "Sauces".';

  const instruction =
    `This is a photo of ONE inventory item stored in the "${department}" area of a luxury yacht. ` +
    'Identify the item as a stores/inventory line, reading any visible label or packaging. ' +
    'Then decide which sub-folder it should be filed in.\n\n' +
    'Existing sub-folders you should prefer (use the exact path text):\n' +
    folderList + '\n\n' +
    newFolderHint + '\n\n' +
    'Return ONLY a JSON object (no prose, no code fences) with these keys:\n' +
    '- name: a short descriptive item title, e.g. "Tinned San Marzano tomatoes"\n' +
    '- quantity: the number of identical units visible as an integer (at least 1)\n' +
    '- folder: the full sub-folder path to file it in — either one EXACTLY from the list above, or your proposed new path\n' +
    '- isNew: true only if `folder` is a new sub-folder not in the list, otherwise false\n' +
    "- confidence: your confidence in the identification — one of \"high\", \"medium\", \"low\"\n" +
    '- description: one short sentence of distinguishing detail, else ""\n' +
    'Do not guess wildly; if you truly cannot tell what it is, use a generic name and confidence "low".';

  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: 'user', content: [block, { type: 'text', text: instruction }] }],
      }),
    });

    if (!r.ok) {
      console.error('[detect-inventory-item] Anthropic error', r.status, await r.text().catch(() => ''));
      return json({ detection: null });
    }

    const data = await r.json();
    let raw = (data?.content?.[0]?.text || '').trim();
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return json({ detection: null });

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return json({ detection: null }); }

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const knownSet = new Set(folders);
    let folder = str(parsed.folder);
    // Trust the model's isNew, but reconcile against the known list so a match
    // that's actually in the list is never mis-flagged as new.
    let isNew = parsed.isNew === true;
    if (folder && knownSet.has(folder)) isNew = false;
    else if (folder) isNew = true;

    const qtyNum = Number(parsed.quantity);
    const quantity = Number.isFinite(qtyNum) && qtyNum >= 1 ? Math.round(qtyNum) : 1;
    const confidence = ['high', 'medium', 'low'].includes(str(parsed.confidence)) ? str(parsed.confidence) : 'medium';

    const detection = {
      name: str(parsed.name),
      quantity,
      folder,
      isNew,
      confidence,
      description: str(parsed.description),
    };
    if (!detection.name) return json({ detection: null });
    return json({ detection });
  } catch (err) {
    console.error('[detect-inventory-item] fetch error', err);
    return json({ detection: null });
  }
});
