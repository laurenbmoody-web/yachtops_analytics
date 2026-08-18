// Supabase Edge Function: detect-inventory-item
//
// Given ONE photo taken inside a department's store (e.g. the Galley, a Deck
// lazarette, an Interior spa cupboard), identify the inventory item(s) in it and
// suggest which sub-folder of the current department each belongs in. A photo may
// show a single item OR several distinct products together — each visually
// distinct product is returned as its own detection, while multiple identical
// units of the same product collapse into one detection with a quantity. Uses
// Claude vision. Fails soft: on any error it returns 200 with an empty list so the
// bulk-upload flow degrades to manual entry rather than breaking.
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
//   { detections: Detection[],    // one per distinct product; [] if nothing usable
//     detection: Detection|null } // detections[0] — kept for backward compatibility
// where Detection = {
//       name: string,          // short item title, e.g. "Tinned San Marzano tomatoes"
//       quantity: number,      // count of identical units of THIS item, >= 1
//       folder: string,        // full sub_location path to file into (from folders[] or a new one)
//       isNew: boolean,        // true if `folder` is a proposed NEW sub-folder
//       confidence: 'high' | 'medium' | 'low',
//       description: string,   // one short distinguishing sentence
//     }

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
// medical, partially-visible/unlabelled items), so use the app's Sonnet.
// Switch to 'claude-haiku-4-5-20251001' to optimise cost.
const MODEL = 'claude-sonnet-4-6';

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
    ? `Only if NONE of the existing folders is a reasonable home, propose ONE concise new sub-folder nested under "${currentPath}", e.g. "${currentPath} > Sauces".`
    : 'Only if NONE of the existing folders is a reasonable home, propose ONE concise new top-level sub-folder for this department, e.g. "Sauces".';

  const instruction =
    `This is a photo taken in the "${department}" area of a luxury yacht. It may show a SINGLE inventory item or SEVERAL distinct items together. ` +
    'Identify EACH visually distinct product as its own stores/inventory line, reading any visible label or packaging. ' +
    'Rules for splitting vs. grouping:\n' +
    '- Different products (different name, brand, type, or packaging) are SEPARATE entries — even if they are piled, boxed, or bagged together.\n' +
    '- Multiple identical units of the SAME product are ONE entry, with `quantity` set to the count.\n' +
    '- Only list items you can actually see; do not invent or pad the list.\n\n' +
    'For each item, decide which sub-folder it should be filed in.\n' +
    'STRONGLY prefer an existing sub-folder from the list below — reuse the exact path text. ' +
    'Creating new folders fragments the store, so only do it when no existing folder fits.\n' +
    'Existing sub-folders (use the exact path text):\n' +
    folderList + '\n\n' +
    newFolderHint + ' When you do name a new folder: use Title Case, no slashes ("/"), ' +
    'keep it a broad category many items can share (e.g. "Body Care", not "EarthLite Eye Pillows"), ' +
    'match the naming style of the existing folders, and never create a near-duplicate of one that already ' +
    'exists (if "Spa Linens" exists, file linens there rather than inventing "Spa Linens & Towels").\n\n' +
    'Return ONLY a JSON array (no prose, no code fences). Each element is an object with these keys:\n' +
    '- name: a short descriptive item title, e.g. "Tinned San Marzano tomatoes"\n' +
    '- quantity: the number of identical units of THIS item visible, as an integer (at least 1)\n' +
    '- folder: the full sub-folder path to file it in — either one EXACTLY from the list above, or your proposed new path\n' +
    '- isNew: true only if `folder` is a new sub-folder not in the list, otherwise false\n' +
    "- confidence: your confidence in the identification — one of \"high\", \"medium\", \"low\"\n" +
    '- description: one short sentence of distinguishing detail, else ""\n' +
    'Do not guess wildly; if you cannot tell what an item is, use a generic name and confidence "low". ' +
    'If the photo shows nothing usable, return [].';

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
        // Room for many line-items when a single photo shows a whole shelf/box.
        max_tokens: 4000,
        temperature: 0,
        messages: [{ role: 'user', content: [block, { type: 'text', text: instruction }] }],
      }),
    });

    if (!r.ok) {
      console.error('[detect-inventory-item] Anthropic error', r.status, await r.text().catch(() => ''));
      return json({ detections: [], detection: null });
    }

    const data = await r.json();
    let raw = (data?.content?.[0]?.text || '').trim();
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

    // The model is asked for a JSON array, but tolerate a single bare object too.
    const items = parseItems(raw);

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const knownSet = new Set(folders);
    // Map a normalised key (case/punctuation-insensitive) back to the exact
    // existing path, so a proposal that differs only cosmetically snaps onto the
    // real folder instead of spawning a near-duplicate ("Spa / Body Care" ->
    // "Spa Body Care", "spa toiletries" -> "Spa Toiletries").
    const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const knownByNorm = new Map<string, string>();
    for (const f of folders) { const k = normKey(f); if (k && !knownByNorm.has(k)) knownByNorm.set(k, f); }

    const detections = items.map((it) => {
      let folder = str(it.folder);
      // Reconcile against the known list so a folder that already exists (exactly
      // or up to case/punctuation) is reused rather than mis-flagged as new.
      let isNew: boolean;
      if (folder && knownSet.has(folder)) {
        isNew = false;
      } else if (folder && knownByNorm.has(normKey(folder))) {
        folder = knownByNorm.get(normKey(folder))!;
        isNew = false;
      } else {
        isNew = !!folder;
      }

      const qtyNum = Number(it.quantity);
      const quantity = Number.isFinite(qtyNum) && qtyNum >= 1 ? Math.round(qtyNum) : 1;
      const confidence = ['high', 'medium', 'low'].includes(str(it.confidence)) ? str(it.confidence) : 'medium';

      return {
        name: str(it.name),
        quantity,
        folder,
        isNew,
        confidence,
        description: str(it.description),
      };
    }).filter((d) => d.name);

    return json({ detections, detection: detections[0] || null });
  } catch (err) {
    console.error('[detect-inventory-item] fetch error', err);
    return json({ detections: [], detection: null });
  }
});

// Pull an array of item objects out of the model's text. Accepts a JSON array,
// a single bare object (wrapped into a one-element array), and tolerates leading/
// trailing prose by slicing to the outermost brackets. Returns [] on any failure.
function parseItems(raw: string): Array<Record<string, unknown>> {
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };

  const arrStart = raw.indexOf('[');
  const arrEnd = raw.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    const v = tryParse(raw.slice(arrStart, arrEnd + 1));
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>;
  }

  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    const v = tryParse(raw.slice(objStart, objEnd + 1));
    if (v && typeof v === 'object') return [v as Record<string, unknown>];
  }

  return [];
}
