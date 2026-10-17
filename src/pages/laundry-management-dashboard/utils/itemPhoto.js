// Item-photo assistant — snap the laundry item and have the AI read it into the
// fields the log needs (description, colour, care tags). Reuses the app's shared
// vision path (chatCompletion → the ai-chat edge function), the same one the
// care-label reader uses, rather than a separate edge function.

import { fileToBase64DataUri, extractJsonText } from '../../../services/documentParser';
import { getChatCompletion } from '../../../services/aiIntegrations/chatCompletion';
import { availableLaundryTags } from './laundryStorage';

const PROMPT = `You are cataloguing ONE laundry item for a superyacht interior from a photo.
It could be a garment, towel, bed linen, or similar. LOOK CLOSELY at EVERY visible
label — the neck/brand label AND the care label — and read the printed text, don't
just describe the shape and colour.

Return ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "type": "the item in a word or two, e.g. 'T-shirt', 'Polo shirt', 'Bath towel'",
  "brand": "the maker printed on the label, e.g. 'Decathlon', 'Musto'; '' if none visible",
  "colour": "the main colour in one or two words, e.g. 'Black'",
  "size": "the size EXACTLY as printed on the label, e.g. 'L', 'M', 'UK 10', '32/34', 'XL'; '' if not visible",
  "material": "fibre composition from the label, e.g. '100% cotton'; '' if not visible",
  "sku": "a style/reference/barcode code if printed (long alphanumeric), NOT the size; '' if none",
  "description": "one natural line a laundry list would use, INCLUDING the brand and colour if known, e.g. 'Decathlon black cotton T-shirt'",
  "tags": ["care actions required, from EXACTLY these keys: ${availableLaundryTags.join(', ')}"]
}

Rules:
- Read the label text for brand, size and fibre — these are the details the crew most need. If a label is visible but blurry, give your best reading rather than leaving it blank.
- Only include a care tag the photo clearly supports (a care label, or an obviously delicate / hand-wash item). If unsure, return [].
- Use '' / [] for anything you genuinely cannot see. Do not invent a brand or size that isn't shown.
- If the image clearly isn't a laundry item, return all fields empty.`;

// Accepts one File or several (e.g. the item + a close-up of the label) and reads
// them together, at high detail and temperature 0 for reliable label extraction.
export async function readLaundryItem(filesOrFile) {
  const files = (Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile]).filter(Boolean).slice(0, 4);
  if (!files.length) throw new Error('No photo provided.');
  const uris = await Promise.all(files.map((f) => fileToBase64DataUri(f).catch(() => '')));
  const imageBlocks = uris
    .filter((u) => typeof u === 'string' && u.startsWith('data:image/'))
    .map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }));
  if (!imageBlocks.length) throw new Error('No readable image.');

  const messages = [
    { role: 'system', content: 'You are a precise visual cataloguer. Read printed label text exactly as shown; return only the requested JSON.' },
    { role: 'user', content: [{ type: 'text', text: PROMPT }, ...imageBlocks] },
  ];
  const resp = await getChatCompletion('ANTHROPIC', 'claude', messages, { temperature: 0, max_completion_tokens: 700 });
  const raw = resp?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('No content returned.');
  const cleaned = extractJsonText(raw);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let data;
  try { data = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new Error('Could not read the photo — try a clearer, closer shot.'); }
  const known = new Set(availableLaundryTags);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    type: str(data.type),
    brand: str(data.brand),
    colour: str(data.colour),
    size: str(data.size),
    material: str(data.material),
    sku: str(data.sku),
    description: str(data.description),
    tags: [...new Set((Array.isArray(data.tags) ? data.tags : []).filter((t) => known.has(t)))],
  };
}
