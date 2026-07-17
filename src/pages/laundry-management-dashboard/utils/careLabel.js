// Care-label assistant — snap a garment care label and have the AI explain
// it in plain English and suggest care tags. Reuses the app's proven vision
// path (documentParser → gpt-4o via the chat Lambda).

import { parseDocument } from '../../../services/documentParser';
import { availableLaundryTags } from './laundryStorage';

const PROMPT = `You are a laundry care expert working in a superyacht interior.
This image is a garment CARE LABEL (it may show the international care symbols:
wash tub, triangle for bleach, square for drying, iron, circle for dry-clean).
Interpret it for the crew.

Return ONLY valid JSON (no markdown, no commentary) in this exact shape:
{
  "summary": "one short plain-English line, e.g. 'Hand wash cold, hang dry, cool iron'",
  "instructions": ["short positive do-this lines only (put don'ts under warnings)"],
  "warnings": ["critical don'ts only, e.g. 'Do not tumble dry', 'Do not bleach'"],
  "tags": ["care actions the crew must take, from EXACTLY these keys: HandWash, DryClean, Iron, Delicate"]
}

Tag rules — be conservative, only tag what the label REQUIRES:
- HandWash: only if hand washing is the required method.
- DryClean: only if the label says dry clean ONLY / must be dry cleaned. NEVER tag this just because it is 'dry clean safe' or machine-washable.
- Delicate: only if a delicate/gentle cycle or delicate handling is required.
- Iron: only if ironing is called for (include the heat if noted). Omit if 'do not iron'.
If none clearly apply, return an empty tags array.

If the image is not a care label, return {"summary":"That doesn't look like a care label — try a closer photo.","instructions":[],"warnings":[],"tags":[]}.`;

export async function readCareLabel(file) {
  if (!file) throw new Error('No photo provided.');
  const raw = await parseDocument(file, PROMPT);
  const cleaned = String(raw || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  let data;
  try { data = JSON.parse(cleaned); } catch { throw new Error('Could not read the label — try a clearer, closer photo.'); }
  const known = new Set(availableLaundryTags);
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    summary: String(data.summary || '').trim(),
    instructions: arr(data.instructions).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    warnings: arr(data.warnings).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6),
    tags: [...new Set(arr(data.tags).filter((t) => known.has(t)))],
  };
}
