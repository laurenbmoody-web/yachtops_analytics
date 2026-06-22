// Supabase Edge Function: templatize-contract
//
// Turns a completed crew contract into a reusable Cargo template by replacing
// the individual's particulars with {{tokens}}. Uses Anthropic Claude
// (claude-opus-4-8) directly — the same ANTHROPIC_API_KEY the other parse
// functions use. No new secret required.
//
// Two modes:
//   { mode: 'map', text }              → for .docx: returns { mappings: [{ value, token }] }
//                                         so the client can find/replace values in-place,
//                                         preserving the original Word formatting.
//   { mode: 'rebuild', base64, mediaType } → for .pdf: Claude reads the PDF and returns
//                                         { template_text } — the full contract re-emitted
//                                         with {{tokens}} (formatting is rebuilt, not kept).
//
// Every result is a suggestion: the user reviews and edits the tokens before
// the template is saved.

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
const MODEL = 'claude-opus-4-8';

// Keep this list in sync with CONTRACT_TOKEN_GROUPS in the client util.
const TOKENS = `
crew_name (full name), crew_first_name, crew_last_name, crew_email, crew_role (rank/role), crew_department,
date_of_birth, place_of_birth, nationality, passport_number (passport/ID number), home_address, phone_number,
contract_type, start_date, end_date, probation_end_date, rotation_pattern, leave_days, notice_period, sea_reference, contract_standard, port_of_embarkation, repatriation_destination,
salary, salary_amount, salary_currency, salary_period, day_rate,
vessel_name, flag_state, port_of_registry, imo_number, official_number, captain_name, company_name, company_address,
today (date generated)`.trim();

// Applied in both modes: the whole point of a template is that NO individual's
// data survives into it.
const CRITICAL = `CRITICAL: This becomes a reusable template, so NO specific party's details may remain as literal text — even details that look like fixed letterhead or that would be identical on every contract you've seen. Tokenise ALL of the following:
- The seafarer's identifiers — name, date of birth, place of birth, passport/ID number, nationality, home address, phone — even when only one occurrence appears.
- The yacht owner / employing company: its name → {{company_name}} and its FULL postal address block → {{company_address}} (replace the entire multi-line address with the single token, even where it appears under headings like "Of:" or "And the Company").
- The captain's name → {{captain_name}}, INCLUDING in signature / execution blocks (e.g. "Name: John Smith – Captain" becomes "Name: {{captain_name}} – Captain"; the seafarer's own signature name becomes {{crew_name}}).
- vessel_name, flag_state, official number, salary, all dates, port of embarkation, repatriation destination.
Keep literal ONLY: names of laws / conventions / regulations, generic clause wording, and standard legal figures that are part of the contract's boilerplate rather than this particular hire (rest-hour minimums, insurance/liability caps, fixed notice weeks written into the clause text).`;

const MAP_PROMPT = `You are given the full text of a COMPLETED maritime crew employment contract for one individual.

Identify the specific PERSONAL / PARTICULAR VALUES that were filled in for this person (their name, role, salary, dates, vessel name, flag, etc.) and map each to the most appropriate placeholder token from this list:
${TOKENS}

Return ONLY a JSON object (no markdown, no backticks):
{"mappings":[{"value":"<exact text as it appears in the contract>","token":"crew_name"}, ...]}

Rules:
- Copy each "value" EXACTLY as it appears in the contract (same spelling, casing, spacing, punctuation) so it can be found and replaced verbatim.
- For a multi-line value (such as the company address block), return it with the line breaks as \n so it can be matched.
- Only map values that clearly correspond to one of the tokens. Do NOT map generic contract boilerplate, clause headings, or the names of laws/conventions.
- Map the vessel's name to vessel_name, the seafarer's name to crew_name, salary figures to salary_amount, etc.
- If a value is genuinely ambiguous, leave it out.
- Return the JSON object only.

${CRITICAL}`;

const REBUILD_PROMPT = `You are given a COMPLETED maritime crew employment contract (PDF) for one individual.

Reproduce the FULL text of the contract, but replace every PERSONAL / PARTICULAR value (the person's name, role, salary, dates, vessel name, flag, etc.) with the matching placeholder token written as {{token}}, drawn from this list:
${TOKENS}

Return ONLY a JSON object (no markdown, no backticks):
{"template_text":"<the contract body with {{tokens}}>","header_text":"<running page header, once>","footer_text":"<running page footer, once>"}

Rules:
- template_text: the contract body. Keep ALL wording, clause headings, and structure intact — only the individual's particulars become tokens. Preserve paragraph breaks as newline characters.
- header_text / footer_text: a scanned/exported PDF repeats the same header at the top and footer at the bottom of EVERY page (e.g. the document title line, "Page No. X of N", "Joining Document N of M", a footer address line, "Initials of Signees"). Extract that repeating furniture ONCE into header_text and footer_text, and DO NOT include it in template_text (don't repeat it between sections).
  - Put the line(s) repeated at the TOP of each page into header_text, the line(s) at the BOTTOM into footer_text. Omit auto page numbers ("Page No. X of N", "Joining Document N of M") — Word renumbers those.
  - Tokenise particulars inside the header/footer too (the footer address becomes {{company_address}}).
  - If there is no running header or footer, return an empty string for it.
- Use {{token}} exactly (double curly braces, the token name from the list).
- Do NOT invent clauses or tokens. Return the JSON object only.

${CRITICAL}`;

function extractJson(text: string): any {
  const cleaned = (text || '').replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return JSON.parse(cleaned.slice(first, last + 1));
  }
  throw new Error('Model did not return valid JSON');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { mode, text, base64, mediaType } = await req.json();

    let userContent: unknown;
    let prompt: string;
    if (mode === 'rebuild') {
      if (!base64 || !mediaType) {
        return new Response(JSON.stringify({ error: 'base64 and mediaType are required for rebuild' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      prompt = REBUILD_PROMPT;
      const mediaBlock = mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
      userContent = [mediaBlock, { type: 'text', text: prompt }];
    } else {
      if (!text || typeof text !== 'string') {
        return new Response(JSON.stringify({ error: 'text is required for map' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      prompt = MAP_PROMPT;
      userContent = [{ type: 'text', text: `${prompt}\n\n--- CONTRACT TEXT ---\n${text}` }];
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${errText}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiJson = await aiRes.json();
    const raw = (aiJson?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const parsed = extractJson(raw);

    const out = mode === 'rebuild'
      ? {
          template_text: String(parsed?.template_text || ''),
          header_text: String(parsed?.header_text || ''),
          footer_text: String(parsed?.footer_text || ''),
        }
      : { mappings: Array.isArray(parsed?.mappings) ? parsed.mappings : [] };

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || 'Unexpected error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
