// Item-photo assistant — snap the laundry item and have the AI read it into the
// fields the log needs (description, colour, care tags). Reuses the app's proven
// vision path (documentParser → gpt-4o via the chat Lambda), the same one the
// care-label reader uses, rather than a separate edge function.

import { parseDocument } from '../../../services/documentParser';
import { availableLaundryTags } from './laundryStorage';

const PROMPT = `You are cataloguing ONE laundry item for a superyacht interior from a photo.
It could be a garment, towel, bed linen, or similar. Read any visible brand or care label.

Return ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "description": "a short title a laundry list would use, e.g. 'Men's white linen shirt' or 'Navy bath towel'",
  "colour": "the main colour in one or two words, e.g. 'White', else ''",
  "material": "fibre composition if printed on a label, e.g. '100% linen', else ''",
  "tags": ["care actions required, from EXACTLY these keys: ${availableLaundryTags.join(', ')}"]
}

Rules:
- Only include a care tag the photo clearly supports (a care label, or an obviously delicate / hand-wash item). If unsure, return [].
- Use '' for any text field you cannot determine. Do not guess wildly.
- If the image clearly isn't a laundry item, return {"description":"","colour":"","material":"","tags":[]}.`;

export async function readLaundryItem(file) {
  if (!file) throw new Error('No photo provided.');
  const raw = await parseDocument(file, PROMPT);
  const cleaned = String(raw || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let data;
  try { data = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new Error('Could not read the photo — try a clearer, closer shot.'); }
  const known = new Set(availableLaundryTags);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    description: str(data.description),
    colour: str(data.colour),
    material: str(data.material),
    tags: [...new Set((Array.isArray(data.tags) ? data.tags : []).filter((t) => known.has(t)))],
  };
}
