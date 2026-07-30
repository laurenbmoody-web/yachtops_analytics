/**
 * Document Parser Service
 * Uses OpenAI (via AWS Lambda) to extract structured data from uploaded documents.
 * Supports PDFs, images, and text-based files.
 *
 * Usage:
 *   import { parseDocument, parseInventoryDocument } from './documentParser';
 */

import { getChatCompletion } from './aiIntegrations/chatCompletion';

const PROVIDER = 'OPEN_AI';
const MODEL = 'gpt-4o'; // gpt-4o supports multimodal (text + vision + PDF)

/**
 * Convert a File object to a base64 data URI.
 * @param {File} file
 * @returns {Promise<string>} Full data URI e.g. "data:application/pdf;base64,..."
 */
export async function fileToBase64DataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
  });
}

/**
 * Generic document parser.
 * Sends a file + instruction prompt to OpenAI and returns the raw text response.
 *
 * @param {File} file - The document file to parse
 * @param {string} prompt - Instruction for what to extract
 * @param {object} [options] - Optional OpenAI parameters
 * @returns {Promise<string>} Raw text response from OpenAI
 */
export async function parseDocument(file, prompt, options = {}) {
  if (!file) throw new Error('No file provided for parsing');

  const dataUri = await fileToBase64DataUri(file);
  const isImage = file?.type?.startsWith('image/');
  const isPdf = file?.type === 'application/pdf';

  if (!isImage && !isPdf) {
    throw new Error(`Unsupported file type: ${file.type}. Supported: PDF, JPEG, PNG, WebP, GIF`);
  }

  const contentBlock = isImage
    ? {
        type: 'image_url',
        image_url: { url: dataUri, detail: 'high' },
      }
    : {
        type: 'file',
        file: { file_data: dataUri, filename: file?.name },
      };

  const messages = [
    {
      role: 'system',
      content:
        'You are a precise document parsing assistant. Extract information exactly as instructed. Return only the requested data without additional commentary unless asked.',
    },
    {
      role: 'user',
      content: [{ type: 'text', text: prompt }, contentBlock],
    },
  ];

  const response = await getChatCompletion(PROVIDER, MODEL, messages, {
    max_completion_tokens: options?.max_completion_tokens || 4096,
    ...options,
  });

  // getChatCompletion returns the full SDK response object
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content returned from OpenAI');
  return content;
}

/**
 * Parse an inventory document and extract items as structured JSON.
 * Returns an array of inventory item objects.
 *
 * @param {File} file - PDF or image of an inventory list / delivery note / packing list
 * @returns {Promise<Array<object>>} Array of parsed inventory items
 */
export async function parseInventoryDocument(file) {
  const prompt = `Extract all inventory items from this document and return them as a JSON array.
Each item should have these fields (use null if not found):
- name: string (item name / description)
- brand: string (brand or manufacturer)
- quantity: number (quantity / amount)
- unit: string (unit of measure e.g. "bottles", "kg", "pcs")
- category: string (product category if visible)
- supplier: string (supplier or vendor name if visible)
- notes: string (any additional notes, codes, or references)

Return ONLY valid JSON array, no markdown, no explanation. Example:
[{"name":"Champagne","brand":"Moët","quantity":12,"unit":"bottles","category":"Beverages","supplier":null,"notes":"Vintage 2019"}]`;

  const rawText = await parseDocument(file, prompt);

  // Strip markdown code fences if present
  const cleaned = rawText?.replace(/```json\n?/gi, '')?.replace(/```\n?/g, '')?.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
    return parsed;
  } catch {
    throw new Error(`Failed to parse OpenAI response as JSON. Raw response: ${rawText.slice(0, 200)}`);
  }
}

/**
 * Parse a delivery note / provisioning document and extract line items.
 * Returns structured delivery data.
 *
 * @param {File} file - PDF or image of a delivery note
 * @returns {Promise<object>} Parsed delivery data with supplier info and items
 */
export async function parseDeliveryNote(file) {
  const prompt = `Extract all information from this delivery note or invoice and return as JSON.
Return an object with:
- supplier: string (supplier/vendor name)
- deliveryDate: string (delivery date in ISO format if found, else null)
- referenceNumber: string (order/delivery reference number if found)
- items: array of objects, each with:
  - name: string
  - quantity: number
  - unit: string
  - unitPrice: number or null
  - totalPrice: number or null
  - notes: string or null

Return ONLY valid JSON, no markdown, no explanation.`;

  const rawText = await parseDocument(file, prompt);
  const cleaned = rawText?.replace(/```json\n?/gi, '')?.replace(/```\n?/g, '')?.trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse delivery note response. Raw: ${rawText.slice(0, 200)}`);
  }
}

/**
 * Parse a guest preference document (dietary requirements, preferences sheet, etc.)
 *
 * @param {File} file - PDF or image of a guest preference form
 * @returns {Promise<object>} Structured guest preference data
 */
export async function parseGuestPreferenceDocument(file) {
  const prompt = `Extract all guest preference information from this document and return as JSON.
Return an object with:
- guestName: string or null
- dietaryRestrictions: array of strings (allergies, intolerances, dietary requirements)
- foodPreferences: array of strings (liked foods, cuisines, favourite items)
- foodDislikes: array of strings (disliked foods)
- drinkPreferences: array of strings (preferred drinks, brands)
- drinkDislikes: array of strings
- activityPreferences: array of strings
- specialRequests: array of strings (any other notes or requests)
- notes: string (any additional context)

Return ONLY valid JSON, no markdown, no explanation.`;

  const rawText = await parseDocument(file, prompt);
  const cleaned = rawText?.replace(/```json\n?/gi, '')?.replace(/```\n?/g, '')?.trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse guest preference response. Raw: ${rawText.slice(0, 200)}`);
  }
}

/**
 * Parse a till receipt or supplier invoice into the fields a ledger line needs.
 * Powers the "Scan receipt" quick-add: photograph a receipt, get a transaction.
 *
 * Returns amounts as POSITIVE magnitudes — the caller applies the direction (a
 * receipt is money out) so the ledger's sign convention stays in one place.
 *
 * @param {File} file - photo or PDF of a receipt / invoice
 * @returns {Promise<object>} { merchant, date, total, vatAmount, vatRate, currency, items, summary }
 */
export async function parseReceipt(file) {
  const prompt = `You are reading a till receipt or supplier invoice. Accuracy matters more
than completeness: a wrong figure corrupts an accounting ledger, so a null is always
better than a guess.

Return JSON with:
- merchant: string — the trading name as printed
- totalText: string — the total EXACTLY as printed, including the currency symbol
  (e.g. "£85.10"). Copy the characters you can see; do not reformat or round.
- total: number — that same total as a positive number, transcribed from totalText
- dateText: string — the date exactly as printed (e.g. "29/07/26")
- date: string — that date as YYYY-MM-DD
- currency: string — ISO code (GBP, EUR, USD…) inferred from the symbol or country
- vatPrinted: boolean — see the VAT rule below
- vatAmount: number or null — only per the VAT rule
- vatRate: number or null — only per the VAT rule
- items: array of up to 8 short strings naming what was bought (no prices)
- summary: string — max 12 words on what this purchase was for
- dateHasTime: boolean — was the date you returned printed with a time beside it?
- confidence: "high" | "low" — "low" if the paper is creased, blurred, cut off, or any
  digit of the total is uncertain

RULES — follow exactly:
1. TOTAL. Use the figure printed against TOTAL / AMOUNT DUE / BALANCE / TO PAY. Never add
   items up yourself. Read each digit deliberately: 8 and 6, 5 and 6, 3 and 8, 1 and 7 are
   easily confused on thermal paper. If any digit is unclear, still transcribe your best
   reading into totalText but set confidence to "low".
2. VAT. Set vatPrinted true ONLY if the receipt prints a separate tax amount as its own
   figure (a "VAT £x.xx" line, or a VAT summary table with an amount). If the receipt
   merely says prices include VAT, shows only a VAT registration number, shows a zero-rated
   or "VAT 0.00" line, or shows no tax figure at all, then vatPrinted is false and BOTH
   vatAmount and vatRate MUST be null. UK grocery and retail receipts very often have no
   separate VAT figure — do not infer or calculate one.
3. DATE. A receipt usually prints SEVERAL dates. You must return the date the purchase
   was made, and nothing else. The purchase date is the one printed with a TIME beside it
   (e.g. "20/07/26 09:56"), or alongside the card-transaction details, usually at the very
   bottom or the very top. IGNORE every other date, in particular:
     - a refund / exchange deadline ("the last date for a refund or exchange is …")
     - "valid until", "expires", "use by", "best before"
     - promotional, loyalty or voucher dates
   If the only date you can find is one of those, return null rather than using it.
   UK and European receipts are DAY-FIRST: 07/08/26 is 7 August 2026, not 8 July. Only
   treat a date as month-first if the receipt is clearly from the United States. A
   two-digit year in the 20s means 20xx. Also return dateHasTime: true when the date you
   chose was printed with a time next to it.
4. CURRENCY. Report only what the receipt shows. Never convert between currencies and never
   invent an exchange rate.

Return ONLY valid JSON, no markdown, no explanation.`;

  const rawText = await parseDocument(file, prompt);
  const cleaned = rawText?.replace(/```json\n?/gi, '')?.replace(/```\n?/g, '')?.trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Couldn't read that receipt. Raw: ${String(rawText).slice(0, 200)}`);
  }

  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Math.abs(Number(v)));

  // Trust the literal transcription over the model's own numeric field: if totalText
  // and total disagree, the printed characters win and we flag it for a human look.
  const fromText = (() => {
    const m = String(parsed.totalText || '').match(/(\d{1,3}(?:[ ,]\d{3})*|\d+)([.,]\d{2})?/);
    if (!m) return null;
    const whole = m[1].replace(/[ ,]/g, '');
    const frac = m[2] ? m[2].replace(',', '.') : '';
    const n = Number(`${whole}${frac}`);
    return Number.isNaN(n) ? null : Math.abs(n);
  })();
  const total = fromText ?? num(parsed.total);
  const totalMismatch = fromText != null && num(parsed.total) != null
    && Math.abs(fromText - num(parsed.total)) > 0.004;

  // VAT is only accepted when the receipt actually printed a separate tax figure.
  const vatPrinted = parsed.vatPrinted === true;

  return {
    merchant: parsed.merchant || null,
    total,
    totalText: parsed.totalText || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : null,
    dateText: parsed.dateText || null,
    // A purchase date is normally timestamped; one without a time is more likely to be
    // a refund-by or validity date the model latched onto, so it's worth checking.
    dateHasTime: parsed.dateHasTime === true,
    currency: (parsed.currency || '').toUpperCase().slice(0, 3) || null,
    vatPrinted,
    vatAmount: vatPrinted ? num(parsed.vatAmount) : null,
    vatRate: vatPrinted ? num(parsed.vatRate) : null,
    items: Array.isArray(parsed.items) ? parsed.items.filter(Boolean).slice(0, 8) : [],
    summary: parsed.summary || null,
    // Anything the crew should eyeball before saving.
    confidence: totalMismatch ? 'low' : (parsed.confidence === 'low' ? 'low' : 'high'),
    totalMismatch,
  };
}
