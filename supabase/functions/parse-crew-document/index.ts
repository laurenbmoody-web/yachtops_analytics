// Supabase Edge Function: parse-crew-document
//
// Reads a crew document scan/photo/PDF and extracts structured fields for
// the crew profile Documents tab. Uses Anthropic Claude vision directly
// (claude-haiku-4-5) — the same ANTHROPIC_API_KEY the other parse
// functions use. No new secret required.
//
// Request body:  { base64: string, mediaType: string }
// Response:      { suggestion: { doc_type, document_number, issue_date,
//                  expiry_date, issuing_authority, flag_state, details } }
//
// All date fields are returned as YYYY-MM-DD (or null). doc_type is one of
// the known taxonomy ids (or 'other'). The client treats every field as a
// suggestion — the crew member confirms before anything is saved.

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

const DOC_TYPE_IDS = [
  'passport', 'national_id', 'seamans_book', 'tax_residency', 'visa_us_b1b2', 'visa_schengen', 'visa_other',
  'eng1', 'seafarer_medical', 'stcw_basic', 'stcw_advanced_ff', 'stcw_pscrb', 'stcw_medical_care', 'pdsd', 'sso_dsd',
  'coc', 'gmdss', 'ecdis', 'helm_management', 'yachtmaster', 'powerboat', 'food_hygiene', 'aec', 'other',
];

const PROMPT = `You are reading a single maritime crew document (passport, visa, seafarer medical, STCW certificate, Certificate of Competency, etc.).

Extract these fields and return ONLY a JSON object (no markdown, no backticks):
{
  "doc_type": one of ${JSON.stringify(DOC_TYPE_IDS)},
  "document_number": string | null,
  "issue_date": "YYYY-MM-DD" | null,
  "expiry_date": "YYYY-MM-DD" | null,
  "issuing_authority": string | null,
  "flag_state": string | null,        // issuing flag state for a CoC, else null
  "details": object                    // {"grade": "..."} for a CoC, {"visa_class","country"} for a visa, {"country_of_issue","place_of_birth"} for a passport, {"custom_label":"..."} for other, else {}
}

Rules:
- Choose the single best doc_type id; use "other" if unsure and put a short name in details.custom_label.
- For a passport, set details.country_of_issue (the issuing country as a full country name, expanding any code/nationality such as "GBR" → "United Kingdom") and details.place_of_birth (the holder's place of birth exactly as printed). Leave either out if not visible.
- Dates MUST be YYYY-MM-DD. Convert any format (e.g. 14 MAR 2026, 03/14/2026) correctly; if a date is ambiguous prefer day/month/year. Use null if not present.
- For a CoC, set details.grade to the licence grade/capacity exactly as printed on the document (e.g. "OOW <3000GT", "Master <500GT", "Y4 / OOW (Yachts)", "Chief Mate unlimited"). Match one of these standard grades where the document clearly corresponds to it: ${JSON.stringify(['Master <500GT', 'Master <3000GT', 'Master unlimited', 'Chief Mate <3000GT', 'Chief Mate unlimited', 'OOW <3000GT', 'OOW unlimited', 'Y4 / OOW (Yachts)', 'Y3 / Master <500GT', 'Y2 / Master <3000GT', 'Y1 / Master <3000GT (>500GT)', 'Engineering — MEOL (Yachts)', 'Engineering — SV / Y4', 'Engineering — Y3', 'Engineering — Y2', 'Engineering — Y1'])}. If none fit, return the grade as printed.
- Do not invent values. Use null when a field is not visible.
- Return the JSON object only.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { base64, mediaType } = await req.json();
    if (!base64 || !mediaType) {
      return new Response(JSON.stringify({ error: 'base64 and mediaType are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isPdf = mediaType === 'application/pdf';
    const mediaBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: PROMPT }] }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('[parse-crew-document] Anthropic error', aiRes.status, errText.slice(0, 300));
      return new Response(JSON.stringify({ error: `AI parse failed (${aiRes.status})` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiRes.json();
    const text = (data?.content || []).map((b: any) => b?.text || '').join('').trim();
    let suggestion: any = {};
    try {
      const jsonStr = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      suggestion = JSON.parse(jsonStr);
    } catch {
      console.error('[parse-crew-document] could not parse model JSON:', text.slice(0, 300));
      suggestion = {};
    }

    // Normalise.
    if (!DOC_TYPE_IDS.includes(suggestion.doc_type)) suggestion.doc_type = 'other';
    if (typeof suggestion.details !== 'object' || suggestion.details === null) suggestion.details = {};

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[parse-crew-document] exception', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
