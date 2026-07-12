// Supabase Edge Function: cert-expiry-reminders
//
// Fired daily by pg_cron. Finds verified certifications approaching expiry
// (30 days / 7 days / on expiry) that haven't been reminded at that stage yet,
// and emails the supplier's team — with a copy to Cargo — to renew. Each stage
// is sent once (tracked in supplier_certifications.expiry_reminded_stages).
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      CERT_REVIEW_RECIPIENTS (Cargo copy; default certs@cargotechnology.co.uk),
//      SITE_URL (optional).

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CARGO_COPY            = Deno.env.get('CERT_REVIEW_RECIPIENTS') || 'certs@cargotechnology.co.uk';
const SITE_URL             = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const FROM                 = 'Cargo Certifications <certs@cargotechnology.co.uk>';

const restHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const SCHEME_LABEL: Record<string, string> = {
  brcgs: 'BRCGS', brc: 'BRCGS', ifs: 'IFS', msc: 'MSC', asc: 'ASC',
  globalgap: 'GLOBALG.A.P.', eu_organic: 'EU Organic', soil_association: 'Soil Association',
  fssc: 'FSSC 22000', haccp: 'HACCP', organic: 'Organic', iso22000: 'ISO 22000', other: 'certification',
};

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(s: string | null): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const due = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_certs_due_for_reminder`, {
      method: 'POST', headers: restHeaders, body: '{}',
    }).then(r => r.json());

    if (!Array.isArray(due)) {
      return new Response(JSON.stringify({ error: 'unexpected response', due }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let sent = 0;
    for (const row of due) {
      const scheme = SCHEME_LABEL[String(row.scheme || '').toLowerCase()] || 'certification';
      const days = row.days_left;
      const expiredNow = row.stage === 'expired';
      const when = expiredNow ? 'has expired' : days === 0 ? 'expires today' : `expires in ${days} day${days === 1 ? '' : 's'}`;
      const headline = expiredNow
        ? `${scheme} certificate has expired`
        : `${scheme} certificate ${when}`;
      const renewUrl = `${SITE_URL}/supplier/workspace/storefront`;

      const html = `<!doctype html><html><body style="margin:0;background:#F5F1EB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <div style="max-width:540px;margin:0 auto;padding:28px 16px">
          <div style="background:#fff;border:1px solid #E5DFD4;border-radius:14px;overflow:hidden">
            <div style="padding:22px 24px">
              <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${expiredNow ? '#C0392B' : '#C65A1A'};margin-bottom:6px">${expiredNow ? 'Certificate expired' : 'Renewal due'}</div>
              <div style="font-family:Georgia,serif;font-size:21px;color:#1C2340;margin-bottom:6px">${escapeHtml(headline)}</div>
              <div style="font-size:14px;color:#4B4F5B;line-height:1.55">${escapeHtml(row.supplier_name)}'s <strong>${escapeHtml(row.cert_name)}</strong> ${when}${row.expiry_date ? ` (expiry ${fmtDate(row.expiry_date)})` : ''}.${expiredNow ? ' It has stopped showing as verified to yachts.' : ''}</div>
              <table style="width:100%;border-collapse:collapse;margin-top:14px">
                ${row.cert_number ? `<tr><td style="padding:4px 0;color:#6B6F7B;font-size:12.5px;width:130px">Certificate no.</td><td style="padding:4px 0;color:#1C2340;font-size:12.5px;font-weight:600">${escapeHtml(row.cert_number)}</td></tr>` : ''}
                ${row.issuing_body ? `<tr><td style="padding:4px 0;color:#6B6F7B;font-size:12.5px">Issuing body</td><td style="padding:4px 0;color:#1C2340;font-size:12.5px;font-weight:600">${escapeHtml(row.issuing_body)}</td></tr>` : ''}
              </table>
              <div style="margin-top:18px"><a href="${renewUrl}" style="display:inline-block;background:#C65A1A;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 18px;border-radius:8px">Upload the renewal →</a></div>
            </div>
          </div>
          <div style="text-align:center;color:#9AA0AC;font-size:11px;margin-top:14px;line-height:1.5">Attach the renewed certificate on your Cargo storefront — Cargo re-checks it and restores the Verified tick.</div>
        </div></body></html>`;

      const to = Array.from(new Set([...(row.recipients || []), ...CARGO_COPY.split(',').map((s: string) => s.trim())].filter(Boolean)));
      if (to.length === 0) continue;

      if (RESEND_API_KEY) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to,
            subject: expiredNow
              ? `${row.supplier_name}: ${row.cert_name} has expired`
              : `${row.supplier_name}: ${row.cert_name} ${when}`,
            html,
          }),
        });
        if (!res.ok) { console.error('[cert-expiry-reminders] email failed:', await res.text()); continue; }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_cert_reminded`, {
        method: 'POST', headers: restHeaders,
        body: JSON.stringify({ p_cert_id: row.cert_id, p_stage: row.stage }),
      });
      sent += 1;
    }

    return new Response(JSON.stringify({ ok: true, considered: due.length, sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[cert-expiry-reminders] error:', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
