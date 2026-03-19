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
