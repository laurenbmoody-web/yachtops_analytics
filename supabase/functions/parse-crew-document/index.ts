// Supabase Edge Function: parse-crew-document
//
// Reads a crew document scan/photo/PDF and extracts structured fields for
// the crew profile Documents tab. Uses Anthropic Claude vision directly
// (claude-sonnet-4-6 — stronger classification/OCR than Haiku for the wide
// variety of certificate layouts) with the same ANTHROPIC_API_KEY the other
// parse functions use. No new secret required.
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
  // travel & identity
  'passport', 'national_id', 'seamans_book', 'tax_residency', 'visa_us_b1b2', 'visa_schengen', 'visa_other',
  // medical
  'eng1', 'seafarer_medical',
  // safety & security (STCW)
  'stcw_basic', 'stcw_pst', 'stcw_fpff', 'stcw_efa', 'stcw_pssr', 'stcw_advanced_ff', 'stcw_pscrb',
  'stcw_medical_care', 'pdsd', 'sso_dsd', 'crowd_management', 'crisis_management',
  // deck & navigation
  'coc', 'gmdss', 'src', 'lrc', 'ecdis', 'radar_arpa', 'helm_management', 'yachtmaster',
  'rya_day_skipper', 'rya_coastal_skipper', 'powerboat', 'tender_operator', 'edh',
  // engineering
  'aec', 'meol',
  // interior & service
  'food_hygiene', 'silver_service', 'wine_spirits', 'barista', 'mixology', 'yacht_purser', 'guest_interior',
  // watersports & dive
  'pwc_jetski', 'dive', 'waterski',
  // issued documents
  'employment_contract', 'contract_amendment', 'offer_letter', 'certificate_of_employment',
  'reference_letter', 'disciplinary_letter', 'general_letter',
  // fallback
  'other',
];

// Canonical nationality demonyms — must mirror src/data/nationalities.js so a
// scanned nationality matches the profile's Personal Details dropdown exactly
// (e.g. a UK passport → "British", never "United Kingdom").
const NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Argentinian',
  'Armenian', 'Australian', 'Austrian', 'Azerbaijani', 'Bahamian', 'Bahraini',
  'Bangladeshi', 'Barbadian', 'Belarusian', 'Belgian', 'Belizean', 'Beninese',
  'Bhutanese', 'Bolivian', 'Bosnian', 'Brazilian', 'British', 'Bruneian', 'Bulgarian',
  'Burkinabe', 'Burmese', 'Burundian', 'Cambodian', 'Cameroonian', 'Canadian',
  'Cape Verdean', 'Central African', 'Chadian', 'Chilean', 'Chinese', 'Colombian',
  'Comoran', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Cypriot', 'Czech',
  'Danish', 'Djiboutian', 'Dominican', 'Dutch', 'East Timorese', 'Ecuadorian',
  'Egyptian', 'Emirati', 'Equatorial Guinean', 'Eritrean', 'Estonian', 'Ethiopian',
  'Fijian', 'Filipino', 'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian',
  'German', 'Ghanaian', 'Greek', 'Grenadian', 'Guatemalan', 'Guinean', 'Guyanese',
  'Haitian', 'Honduran', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian', 'Iranian',
  'Iraqi', 'Irish', 'Israeli', 'Italian', 'Ivorian', 'Jamaican', 'Japanese',
  'Jordanian', 'Kazakh', 'Kenyan', 'Kuwaiti', 'Kyrgyz', 'Laotian', 'Latvian',
  'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner', 'Lithuanian', 'Luxembourgish',
  'Macedonian', 'Malagasy', 'Malawian', 'Malaysian', 'Maldivian', 'Malian', 'Maltese',
  'Marshallese', 'Mauritanian', 'Mauritian', 'Mexican', 'Micronesian', 'Moldovan',
  'Monacan', 'Mongolian', 'Montenegrin', 'Moroccan', 'Mozambican', 'Namibian',
  'Nauruan', 'Nepalese', 'New Zealander', 'Nicaraguan', 'Nigerian', 'Nigerien',
  'North Korean', 'Norwegian', 'Omani', 'Pakistani', 'Palauan', 'Palestinian',
  'Panamanian', 'Papua New Guinean', 'Paraguayan', 'Peruvian', 'Polish', 'Portuguese',
  'Qatari', 'Romanian', 'Russian', 'Rwandan', 'Saint Lucian', 'Salvadoran', 'Samoan',
  'San Marinese', 'Sao Tomean', 'Saudi', 'Senegalese', 'Serbian', 'Seychellois',
  'Sierra Leonean', 'Singaporean', 'Slovak', 'Slovenian', 'Solomon Islander', 'Somali',
  'South African', 'South Korean', 'South Sudanese', 'Spanish', 'Sri Lankan', 'Sudanese',
  'Surinamese', 'Swazi', 'Swedish', 'Swiss', 'Syrian', 'Taiwanese', 'Tajik', 'Tanzanian',
  'Thai', 'Togolese', 'Tongan', 'Trinidadian', 'Tunisian', 'Turkish', 'Turkmen',
  'Tuvaluan', 'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbek', 'Vanuatuan', 'Venezuelan',
  'Vietnamese', 'Yemeni', 'Zambian', 'Zimbabwean',
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
  "details": object                    // {"grade": "..."} for a CoC, {"visa_class","country"} for a visa, {"country_of_issue","nationality","date_of_birth","place_of_birth"} for a passport, {"custom_label":"..."} for other, else {}
}

Rules:
- Choose the single best doc_type id; use "other" if unsure and put a short name in details.custom_label.
- Classify by what the document fundamentally IS, not by a single keyword. Key distinctions among easily-confused maritime docs:
  • seamans_book = a Seaman's Discharge Book / Seafarer's Identity Document (SID) / record-of-sea-service book issued by a flag-state shipping registry (e.g. Cayman Islands, Marshall Islands, UK MCA, Liberia). It records voyages, ranks and discharges and identifies the seafarer. It is NOT a medical. A flag-state registry as issuer + sea-service/discharge records ⇒ seamans_book, even if it carries a validity/expiry.
  • eng1 = the UK MCA "ENG1" medical fitness certificate specifically.
  • seafarer_medical = any other flag's seafarer medical fitness certificate. These are signed by an approved medical practitioner and state fitness for sea ("fit for duty", "fit/unfit", examiner/doctor name, restrictions). Choose a medical type ONLY when the document is a doctor's fitness certificate.
  • coc = a Certificate of Competency / licence stating a capacity/grade (Master, Chief Mate, OOW, Engineer). gmdss/ecdis/yachtmaster/etc are training certificates for that specific skill.
  • STCW Basic Safety Training has four elements that are often held/revalidated SEPARATELY — classify a single-element certificate to its own id, not to stcw_basic: Personal Survival Techniques → stcw_pst; Fire Prevention & Fire Fighting (a.k.a. Basic Fire Fighting) → stcw_fpff; Elementary First Aid (STCW A-VI/1 §2.1.3) → stcw_efa; Personal Safety & Social Responsibility → stcw_pssr. Use stcw_basic ONLY when one certificate covers all four elements together. A "revalidation"/"updating"/"refresher" certificate keeps the element's id (e.g. "Basic Fire Fighting Revalidation" → stcw_fpff).
  • Elementary First Aid (A-VI/1, basic) is NOT the same as Medical First Aid / Medical Care (A-VI/4) → use stcw_efa, never stcw_medical_care, for an Elementary First Aid certificate.
  • Advanced Fire Fighting → stcw_advanced_ff (distinct from basic stcw_fpff).
  • Radio: a Short Range Certificate / SRC / VHF radio operator cert → src; Long Range Certificate → lrc; a GMDSS GOC or ROC → gmdss. A radio cert is NOT a seaman's book.
  • Deck tickets: "Powerboat Level 2" → powerboat (NOT a national ID); Day Skipper → rya_day_skipper; Coastal Skipper → rya_coastal_skipper; Yachtmaster → yachtmaster; Tender Operator → tender_operator; Efficient Deck Hand / EDH → edh; Radar/ARPA → radar_arpa.
  • Interior/service: Yacht Purser or purser/administration course → yacht_purser; WSET wine/spirits → wine_spirits; barista → barista; cocktail/mixology → mixology; silver service / food & beverage → silver_service; GUEST interior course → guest_interior; food hygiene/safety → food_hygiene.
  • Watersports: PWC/jet-ski → pwc_jetski; PADI/scuba diving → dive; water-ski/wakeboard → waterski.
  • Engineering: AEC → aec; MEOL → meol.
- For a passport (or national ID), populate the holder's identity in details: country_of_issue (issuing country as a full name, expanding any code such as "GBR" → "United Kingdom"), nationality, date_of_birth ("YYYY-MM-DD"), and place_of_birth (exactly as printed). Omit any field that is not visible.
- nationality MUST be the demonym (e.g. a UK/GBR passport → "British", a French passport → "French"), NOT a country name, and MUST be exactly one of: ${JSON.stringify(NATIONALITIES)}. If none fit, return the standard English demonym as printed.
- Where the document type has extra detail fields, fill the ones you can read using these exact keys/values (omit any you cannot read): medical (eng1/seafarer_medical) → result one of ["Fit","Fit with restrictions","Unfit"] plus restrictions text; gmdss → certificate_type one of ["GOC (General)","ROC (Restricted)"]; food_hygiene → level one of ["Level 1","Level 2","Level 3","Level 4"]; aec → level one of ["AEC 1","AEC 2","AEC 1 & 2"]; yachtmaster → grade one of ["Yachtmaster Coastal","Yachtmaster Offshore","Yachtmaster Ocean"]; helm_management → level one of ["Operational","Management"]; visas → entries one of ["Single","Multiple"] plus max_stay; tax_residency → country and tax_year. For a CoC, the 5-yearly revalidation date is the expiry_date.
- Dates MUST be YYYY-MM-DD. Convert any format (e.g. 14 MAR 2026, 03/14/2026) correctly; if a date is ambiguous prefer day/month/year. Use null if not present. Read the YEAR carefully (do not misread 2023 as 2000).
- issue_date vs expiry_date: only set expiry_date to a date the document explicitly presents as an expiry / "valid until" / "valid to" / next-revalidation date. If the document shows only an issue/completion/award date and no expiry, set expiry_date to null and put that date in issue_date — NEVER copy an issue date into expiry_date. expiry_date, when present, must be LATER than issue_date.
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
        model: 'claude-sonnet-4-6',
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
