// Supabase Edge Function: review-supplier-cert
//
// Fired after a supplier attaches a certificate document. It:
//   1. reads the document with Claude (same ANTHROPIC_API_KEY as the other
//      parse functions) and extracts the scheme, certificate number, who it's
//      issued to, and the issue/expiry dates;
//   2. screens it (in date? holder name matches the supplier? does it match
//      the cert they claimed?) into a verdict + flags;
//   3. stamps the parse onto the supplier_certifications row (service role);
//   4. emails the Cargo team with the parsed details, the verdict, a link to
//      view the document, and a deep link to the scheme's official public
//      register to check the certificate on.
//
// The AI never grants the buyer-facing "Verified" tick — that stays a human /
// registry sign-off. This is triage: it tells the team what landed and where
// to confirm it.
//
// Request body:  { supplierId: uuid, name: string }
// Env vars:      ANTHROPIC_API_KEY, RESEND_API_KEY, SUPABASE_URL,
//                SUPABASE_SERVICE_ROLE_KEY,
//                CERT_REVIEW_RECIPIENTS (comma-separated; falls back to
//                  certs@cargotechnology.co.uk),
//                SITE_URL (optional)

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY        = Deno.env.get('ANTHROPIC_API_KEY') || '';
const RESEND_API_KEY           = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CERT_REVIEW_RECIPIENTS   = Deno.env.get('CERT_REVIEW_RECIPIENTS') || 'certs@cargotechnology.co.uk';
const SITE_URL                 = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const FROM                     = 'Cargo Certifications <certs@cargotechnology.co.uk>';

const restHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// ── Official public registers to check a certificate on ─────────────────────
// Where a scheme has a public per-certificate lookup we deep-link its search;
// where it doesn't (HACCP is a method, not a register) we say so. A web-search
// fallback on the certificate number is always added so the team has a click.
const REGISTRY: Record<string, { label: string; url: string; hint: string }> = {
  brcgs:          { label: 'BRCGS approved bodies',      url: 'https://directory.brcgs.com/certification-body-search',
                    hint: 'Search the ISSUING BODY name below. BRCGS says any body not listed is not authorised to issue a certificate — so if it isn\'t there, the cert isn\'t valid.' },
  brc:            { label: 'BRCGS approved bodies',      url: 'https://directory.brcgs.com/certification-body-search',
                    hint: 'Search the ISSUING BODY name below. If it isn\'t a listed BRCGS-approved body, the cert isn\'t valid.' },
  ifs:            { label: 'IFS certified companies',    url: 'https://www.ifs-certification.com/index.php/en/certified-companies-int',
                    hint: 'Search the certified company (issued-to) and confirm the certificate is current.' },
  fssc:           { label: 'FSSC 22000 register',        url: 'https://www.fssc.com/certified-organizations/',
                    hint: 'Search the organisation name below and confirm the certificate is active.' },
  msc:            { label: 'MSC certificate search',     url: 'https://cert.msc.org/',
                    hint: 'Search the certificate number or company and confirm it is a valid MSC chain-of-custody certificate.' },
  asc:            { label: 'ASC finder',                 url: 'https://www.asc-aqua.org/what-you-can-do/take-action/find-a-farm/',
                    hint: 'Search the farm / company and confirm the certificate is current.' },
  globalgap:      { label: 'GLOBALG.A.P. database',      url: 'https://database.globalgap.org/globalgap/search/SearchMain.faces',
                    hint: 'Search the GGN or certificate number below and confirm it is valid.' },
  eu_organic:     { label: 'EU organic operators (OFIS)',url: 'https://ec.europa.eu/agriculture/ofis_public/actor/index.cfm',
                    hint: 'Confirm the operator with its control body / the organic register.' },
  soil_association:{ label: 'Soil Association licensees',url: 'https://www.soilassociation.org/certification/find-a-licensee/',
                    hint: 'Search the licensee name and confirm certification is current.' },
  organic:        { label: 'Organic control body',       url: 'https://www.google.com/search?q=organic+certification+register',
                    hint: 'Organic schemes vary — confirm the operator with the control body named on the certificate.' },
};

const SCHEME_LABEL: Record<string, string> = {
  brcgs: 'BRCGS', brc: 'BRCGS', ifs: 'IFS', msc: 'MSC (seafood)', asc: 'ASC (aquaculture)',
  globalgap: 'GLOBALG.A.P.', eu_organic: 'EU Organic', soil_association: 'Soil Association',
  fssc: 'FSSC 22000', haccp: 'HACCP', organic: 'Organic', iso22000: 'ISO 22000', other: 'Other',
};

const PROMPT = `You are screening a supplier's food-safety / provenance certificate for a yacht-provisioning marketplace. Read the document and return ONLY a JSON object (no prose, no code fence) with these keys:

{
  "is_certificate": boolean,          // is this actually a certificate (not an invoice, photo of nothing, etc.)
  "scheme": string,                   // one of: brcgs, ifs, fssc, msc, asc, globalgap, eu_organic, soil_association, haccp, iso22000, organic, other
  "cert_number": string|null,         // the certificate / licence number exactly as printed
  "issued_to": string|null,           // the company/person the certificate is issued to
  "issuing_body": string|null,        // the certification body that issued it
  "issue_date": string|null,          // YYYY-MM-DD
  "expiry_date": string|null,         // YYYY-MM-DD
  "confidence": number                // 0..1, your confidence in the extraction
}

Rules: dates as YYYY-MM-DD or null. If a field is not present, use null. Do not invent a certificate number. Return the JSON object only.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Dates render dd/mm/yyyy (Cargo convention), not the raw ISO the model returns.
function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { supplierId, name } = await req.json();
    if (!supplierId || !name) return json({ error: 'supplierId and name are required' }, 400);

    // ── Load the cert row + the supplier's display name ──────────────────
    const certRows = await fetch(
      `${SUPABASE_URL}/rest/v1/supplier_certifications?supplier_id=eq.${supplierId}&name=eq.${encodeURIComponent(name)}&select=*`,
      { headers: restHeaders },
    ).then(r => r.json());
    const cert = Array.isArray(certRows) ? certRows[0] : null;
    if (!cert) return json({ skipped: 'no such certification' });
    if (!cert.doc_url) return json({ skipped: 'no document attached' });
    if (cert.parsed_doc_url === cert.doc_url) return json({ skipped: 'already reviewed' });

    const supRows = await fetch(
      `${SUPABASE_URL}/rest/v1/supplier_profiles?id=eq.${supplierId}&select=name`,
      { headers: restHeaders },
    ).then(r => r.json()).catch(() => []);
    const sup = Array.isArray(supRows) ? supRows[0] : null;
    const supplierName = sup?.name || 'Unknown supplier';

    // ── Fetch the document and read it with Claude ───────────────────────
    const docRes = await fetch(cert.doc_url);
    if (!docRes.ok) return json({ error: `could not fetch document (${docRes.status})` }, 502);
    const mediaType = (docRes.headers.get('content-type') || 'application/pdf').split(';')[0].trim();
    const bytes = new Uint8Array(await docRes.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);

    const isPdf = mediaType === 'application/pdf';
    const mediaBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    let parsed: any = {};
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: PROMPT }] }],
        }),
      });
      const data = await aiRes.json();
      const text = (data?.content || []).map((b: any) => b?.text || '').join('').trim();
      const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[review-supplier-cert] AI parse failed:', e);
      parsed = { is_certificate: null, scheme: 'other', confidence: 0 };
    }

    // ── Screen the parse into a verdict + flags ──────────────────────────
    const flags: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.is_certificate === false) flags.push('Document does not look like a certificate');
    if (parsed.expiry_date && parsed.expiry_date < today) flags.push(`Expired on ${fmtDate(parsed.expiry_date)}`);
    if (!parsed.cert_number) flags.push('No certificate number found — cannot be looked up');
    // Loose holder-name match: does the supplier name share a word with the cert holder?
    const norm = (s: string) => (s || '').toLowerCase().replace(/\b(ltd|limited|llc|inc|sarl|bv|gmbh|srl|co|the|and)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    if (parsed.issued_to) {
      const a = new Set(norm(supplierName)); const shared = norm(parsed.issued_to).some(w => a.has(w));
      if (!shared) flags.push(`Holder "${parsed.issued_to}" doesn't obviously match "${supplierName}"`);
    }
    // Did they claim a scheme that doesn't match the document?
    const claimed = (name || '').toLowerCase();
    const schemeId = String(parsed.scheme || 'other').toLowerCase();
    if (schemeId !== 'other' && SCHEME_LABEL[schemeId] && !claimed.includes(schemeId) && !claimed.includes((SCHEME_LABEL[schemeId] || '').toLowerCase().split(' ')[0])) {
      flags.push(`Labelled "${name}" but document reads as ${SCHEME_LABEL[schemeId]}`);
    }

    const verdict = parsed.is_certificate === false ? 'problem'
      : flags.length === 0 ? 'good'
      : (flags.some(f => f.startsWith('Expired') || f.startsWith('Document does not')) ? 'problem' : 'review');
    const status = verdict === 'good' ? 'ai_checked' : 'flagged';

    const reg = REGISTRY[schemeId];
    const searchUrl = parsed.cert_number
      ? `https://www.google.com/search?q=${encodeURIComponent(`${parsed.cert_number} ${SCHEME_LABEL[schemeId] || ''} certificate`)}`
      : null;
    const registryUrl = reg?.url || searchUrl || null;

    // ── Stamp the parse onto the row ─────────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/supplier_certifications?id=eq.${cert.id}`, {
      method: 'PATCH',
      headers: { ...restHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        scheme: schemeId,
        cert_number: parsed.cert_number || null,
        issued_to: parsed.issued_to || null,
        issuing_body: parsed.issuing_body || null,
        issue_date: parsed.issue_date || null,
        expiry_date: parsed.expiry_date || null,
        ai_verdict: verdict,
        ai_flags: flags,
        ai_confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        registry_url: registryUrl,
        parsed_doc_url: cert.doc_url,
        parsed_at: new Date().toISOString(),
        expiry_reminded_stages: [], // fresh document → reminders restart for the new expiry
      }),
    });

    // ── Email the team ───────────────────────────────────────────────────
    const VERDICT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
      good:    { bg: '#EAF6EF', fg: '#1D7A4D', label: 'Looks good' },
      review:  { bg: '#FEF6E7', fg: '#9A6700', label: 'Needs a look' },
      problem: { bg: '#FDECEC', fg: '#C0392B', label: 'Problem' },
    };
    const v = VERDICT_STYLE[verdict];
    const row = (k: string, val: string) =>
      `<tr><td style="padding:6px 0;color:#6B6F7B;font-size:13px;width:150px;vertical-align:top">${k}</td><td style="padding:6px 0;color:#1C2340;font-size:13px;font-weight:600">${escapeHtml(val || '—')}</td></tr>`;

    const flagsHtml = flags.length
      ? `<div style="margin:14px 0 0"><div style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#9A6700;margin-bottom:6px">Flags</div><ul style="margin:0;padding-left:18px;color:#1C2340;font-size:13px;line-height:1.6">${flags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`
      : `<div style="margin:14px 0 0;color:#1D7A4D;font-size:13px">No automated flags.</div>`;

    const registryBtn = reg
      ? `<a href="${reg.url}" style="display:inline-block;background:#1C2340;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 18px;border-radius:8px;margin-right:10px">Check on ${escapeHtml(reg.label)} →</a>`
      : `<span style="display:inline-block;color:#6B6F7B;font-size:12px;margin-right:10px">${schemeId === 'haccp' ? 'HACCP has no central register — verify the scheme certificate behind it and the issuing body directly.' : 'No public register for this scheme.'}</span>`;
    const hintHtml = reg
      ? `<div style="font-size:11.5px;color:#6B6F7B;margin:0 0 10px;line-height:1.5">${escapeHtml(reg.hint)}</div>`
      : '';
    const searchBtn = searchUrl
      ? `<a href="${searchUrl}" style="display:inline-block;color:#C65A1A;text-decoration:none;font-size:13px;font-weight:600;padding:11px 4px">Search the number on the web →</a>`
      : '';

    const html = `<!doctype html><html><body style="margin:0;background:#F5F1EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:560px;margin:0 auto;padding:28px 16px">
        <div style="background:#fff;border:1px solid #E5DFD4;border-radius:14px;overflow:hidden">
          <div style="padding:22px 24px 0">
            <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#C65A1A;margin-bottom:6px">Certificate to review</div>
            <div style="font-family:Georgia,serif;font-size:22px;color:#1C2340;margin-bottom:4px">${escapeHtml(supplierName)}</div>
            <div style="font-size:14px;color:#6B6F7B">uploaded <strong style="color:#1C2340">${escapeHtml(cert.name)}</strong></div>
            <div style="display:inline-block;margin-top:12px;background:${v.bg};color:${v.fg};font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px">${v.label}${typeof parsed.confidence === 'number' ? ` · ${Math.round(parsed.confidence * 100)}% read confidence` : ''}</div>
          </div>
          <div style="padding:16px 24px 4px">
            <table style="width:100%;border-collapse:collapse">
              ${row('Scheme detected', SCHEME_LABEL[schemeId] || schemeId)}
              ${row('Certificate no.', parsed.cert_number)}
              ${row('Issued to', parsed.issued_to)}
              ${row('Issuing body', parsed.issuing_body)}
              ${row('Issued', fmtDate(parsed.issue_date))}
              ${row('Expires', fmtDate(parsed.expiry_date))}
            </table>
            ${flagsHtml}
          </div>
          <div style="padding:18px 24px 24px;border-top:1px solid #EFEAE0;margin-top:16px">
            <div style="margin-bottom:14px"><a href="${escapeHtml(cert.doc_url)}" style="display:inline-block;background:#C65A1A;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 18px;border-radius:8px">View the document →</a></div>
            <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6B6F7B;margin-bottom:8px">Check it on the official register</div>
            ${hintHtml}${registryBtn}${searchBtn}
          </div>
        </div>
        <div style="text-align:center;color:#9AA0AC;font-size:11px;margin-top:16px;line-height:1.5">
          Cargo read this document automatically to save you time. It has <strong>not</strong> granted the Verified tick —<br>confirm it against the register above, then mark it Verified in the console.
        </div>
      </div>
    </body></html>`;

    if (RESEND_API_KEY) {
      const to = CERT_REVIEW_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to,
          subject: `[${v.label}] ${supplierName} — ${cert.name} to review`,
          html,
        }),
      });
      if (!emailRes.ok) console.error('[review-supplier-cert] email failed:', await emailRes.text());
    } else {
      console.warn('[review-supplier-cert] RESEND_API_KEY not set — skipping email');
    }

    return json({ ok: true, verdict, status, flags });
  } catch (err: any) {
    console.error('[review-supplier-cert] error:', err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
