// Supabase Edge Function: vessel-lifecycle
//
// Fired daily by pg_cron (vessel-lifecycle-daily). Carries out what the Terms
// promise once a vessel's subscription has ended:
//   • day 60 → email the vessel admin (copy to Cargo): the data will be deleted
//     on <date>; resubscribe or export before then.
//   • day 90 (and at least 7 days after that email) → re-check the subscription
//     with Stripe, then permanently delete the vessel's data
//     (purge_vessel_data) and its files (vessel_storage_paths). Crew's own
//     records, supplier-side records and Cargo's billing records are kept.
//     Cargo gets a confirmation email.
// Complimentary vessels are never selected (get_vessels_lifecycle_due).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, STRIPE_SECRET_KEY,
//      LIFECYCLE_CARGO_COPY (default l.moody@cargotechnology.co.uk), SITE_URL.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { renderCargoEmail, renderCargoEmailText } from '../_shared/emailTemplate.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const CARGO_COPY = Deno.env.get('LIFECYCLE_CARGO_COPY') || 'l.moody@cargotechnology.co.uk';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://cargotechnology.netlify.app';
const FROM = 'Cargo <billing@cargotechnology.co.uk>';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

const DAY = 24 * 60 * 60 * 1000;
const fmtDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

async function sendEmail(to: string[], subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, reply_to: CARGO_COPY, subject, html, text }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Stripe is the source of truth: never delete a vessel whose subscription is
// actually live (e.g. a missed webhook). Returns the live status or null.
async function stripeStatus(subscriptionId: string | null): Promise<string | null> {
  if (!subscriptionId || !STRIPE_SECRET_KEY) return null;
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  const sub = await res.json();
  return sub?.status || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: due, error } = await admin.rpc('get_vessels_lifecycle_due');
  if (error) {
    console.error('[vessel-lifecycle] lookup failed', error);
    return json({ error: 'lookup failed' }, 500);
  }

  const results: unknown[] = [];
  for (const v of due || []) {
    const endedAt = new Date(v.access_ended_at);
    const deleteOn = new Date(Math.max(endedAt.getTime() + 90 * DAY, Date.now() + 7 * DAY));
    try {
      if (v.stage === 'warn') {
        // ── Day 60: reminder ────────────────────────────────────────────────
        const deleteLabel = fmtDate(deleteOn);
        const params = {
          preheader: `${v.vessel_name}'s Cargo data will be deleted on ${deleteLabel}.`,
          headline: `${v.vessel_name}'s data will be {emphasis}`,
          headlineEmphasis: `deleted on ${deleteLabel}`,
          intro:
            `The Cargo plan for ${v.vessel_name} ended on ${fmtDate(endedAt)}. As set out in our Terms, ` +
            `the vessel's records and files will be permanently deleted on ${deleteLabel}. ` +
            `To keep them, resubscribe or export the vessel's data before then.`,
          ctaLabel: 'Resubscribe or export',
          ctaUrl: `${SITE_URL}/membership`,
          secondaryText:
            "Crew keep their own Cargo accounts, sea-service records and personal documents — those aren't affected.",
          footerNote: 'Cargo Technology Ltd · Questions? Reply to this email.',
        };
        const to = [v.admin_email, CARGO_COPY].filter(Boolean) as string[];
        await sendEmail(to, `${v.vessel_name}: Cargo data will be deleted on ${deleteLabel}`,
          renderCargoEmail(params), renderCargoEmailText(params));
        await admin.from('tenants').update({ deletion_warning_sent_at: new Date().toISOString() }).eq('id', v.tenant_id);
        results.push({ vessel: v.tenant_id, stage: 'warned', delete_on: deleteLabel });
        continue;
      }

      // ── Day 90: delete ──────────────────────────────────────────────────────
      const live = await stripeStatus(v.stripe_subscription_id);
      if (live && !['canceled', 'unpaid', 'incomplete_expired'].includes(live)) {
        // Our record is stale — fix it and keep the vessel.
        await admin.from('tenants').update({ subscription_status: live }).eq('id', v.tenant_id);
        results.push({ vessel: v.tenant_id, stage: 'skipped', reason: `stripe status ${live}` });
        continue;
      }

      const { data: files } = await admin.rpc('vessel_storage_paths', { p_tenant: v.tenant_id });
      const { data: purge, error: purgeErr } = await admin.rpc('purge_vessel_data', { p_tenant: v.tenant_id });
      if (purgeErr) throw new Error(`purge: ${purgeErr.message}`);

      // Files go after the records (a failed purge leaves everything intact).
      const byBucket = new Map<string, string[]>();
      for (const f of files || []) {
        if (!byBucket.has(f.bucket_id)) byBucket.set(f.bucket_id, []);
        byBucket.get(f.bucket_id)!.push(f.name);
      }
      let removed = 0;
      for (const [bucket, paths] of byBucket) {
        for (let i = 0; i < paths.length; i += 100) {
          const { error: rmErr } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (rmErr) console.warn(`[vessel-lifecycle] ${bucket} partial`, rmErr);
          else removed += Math.min(100, paths.length - i);
        }
      }

      const rows = Object.values((purge as any)?.deleted_rows || {}).reduce((a: number, n: any) => a + Number(n || 0), 0);
      const params = {
        preheader: `${v.vessel_name}'s data has been deleted.`,
        headline: `${v.vessel_name}'s data has been {emphasis}`,
        headlineEmphasis: 'deleted',
        intro:
          `90 days after its plan ended on ${fmtDate(endedAt)}, ${v.vessel_name}'s records (${rows} rows) ` +
          `and files (${removed}) were permanently deleted from Cargo on ${fmtDate(new Date())}.`,
        ctaLabel: 'Open Cargo',
        ctaUrl: SITE_URL,
        secondaryText: "Crew accounts, sea-service records and personal documents were kept, as were supplier and billing records.",
        footerNote: 'Cargo Technology Ltd · deletion record',
      };
      await sendEmail([CARGO_COPY], `Deleted: ${v.vessel_name} (90 days after plan ended)`,
        renderCargoEmail(params), renderCargoEmailText(params));
      results.push({ vessel: v.tenant_id, stage: 'deleted', rows, files: removed });
    } catch (e) {
      console.error(`[vessel-lifecycle] ${v.tenant_id} failed`, e);
      results.push({ vessel: v.tenant_id, stage: 'error', error: String((e as Error)?.message || e) });
      try {
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await sendEmail([CARGO_COPY], `Vessel lifecycle needs attention: ${v.vessel_name}`,
          `<p>The ${v.stage === 'warn' ? 'day-60 reminder' : 'day-90 deletion'} for <b>${esc(String(v.vessel_name))}</b> (${v.tenant_id}) failed and will retry tomorrow.</p><p>${esc(String((e as Error)?.message || e))}</p>`,
          `The ${v.stage} step for ${v.vessel_name} (${v.tenant_id}) failed: ${String((e as Error)?.message || e)}`);
      } catch { /* email itself failed — logged above */ }
    }
  }

  return json({ processed: results.length, results });
});
