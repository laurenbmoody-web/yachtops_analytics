// Supabase Edge Function: laundry-photo-retention
//
// Opt-in photo housekeeping. For every vessel that has set a retention window
// (vessels.laundry_photo_retention_days), this removes the photo *files* from
// the laundry-photos bucket (and clears any legacy base64 held in the row) for
// laundry items whose delivery/log date is older than the window — keeping the
// record itself. Vessels with NULL retention are skipped (keep forever).
//
// Only ever touches photos, never records. Idempotent via photos_expired_at.
// Invoked daily by pg_cron; authenticates internally with the service role.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'laundry-photos';
const DAY_MS = 86400000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Turn a stored photo value into its bucket path (null = nothing to delete,
// e.g. a legacy base64 data URL — the row is still cleared to free the space).
function pathOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (v.startsWith('data:')) return null;
  const m = v.match(/\/object\/(?:sign|public)\/laundry-photos\/([^?]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (v.startsWith('http')) return null;
  return v; // already a bucket-relative path
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // Dry run: report exactly what WOULD be purged, delete nothing. Trigger with
  // ?dryRun=1 or a JSON body { "dryRun": true } — the safe way to preview a
  // policy before letting the daily cron act on it.
  const url = new URL(req.url);
  let dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
  if (!dryRun && req.method === 'POST') {
    try { const body = await req.json(); if (body && body.dryRun) dryRun = true; } catch { /* no/empty body */ }
  }

  const { data: vessels, error: vErr } = await sb
    .from('vessels')
    .select('tenant_id, laundry_photo_retention_days')
    .not('laundry_photo_retention_days', 'is', null);
  if (vErr) return new Response(JSON.stringify({ ok: false, error: vErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let filesDeleted = 0;
  let itemsCleared = 0;
  const perVessel: Array<{ tenant_id: string; days: number; items: number; files: number }> = [];

  for (const v of vessels || []) {
    const days = Number(v.laundry_photo_retention_days);
    if (!days || days <= 0) continue;
    const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();

    const { data: items } = await sb
      .from('laundry_items')
      .select('id, photos, photo, created_at, delivered_at')
      .eq('tenant_id', v.tenant_id)
      .is('photos_expired_at', null)
      .or(`delivered_at.lt.${cutoff},and(delivered_at.is.null,created_at.lt.${cutoff})`)
      .limit(2000);

    let vItems = 0;
    let vFiles = 0;
    for (const it of items || []) {
      const photos = Array.isArray(it.photos) ? it.photos : (it.photo ? [it.photo] : []);
      if (!photos.length && !it.photo) {
        // nothing stored — still stamp so it's skipped next run (skipped on dry run)
        if (!dryRun) await sb.from('laundry_items').update({ photos_expired_at: nowIso }).eq('id', it.id);
        continue;
      }
      const paths = [...new Set(photos.map(pathOf).filter((p): p is string => !!p))];
      if (paths.length) {
        if (!dryRun) {
          const { error } = await sb.storage.from(BUCKET).remove(paths);
          if (!error) filesDeleted += paths.length;
        } else {
          filesDeleted += paths.length;
        }
        vFiles += paths.length;
      }
      if (!dryRun) await sb.from('laundry_items').update({ photos: [], photo: '', photos_expired_at: nowIso }).eq('id', it.id);
      itemsCleared += 1;
      vItems += 1;
    }
    if (vItems || vFiles) perVessel.push({ tenant_id: v.tenant_id, days, items: vItems, files: vFiles });
  }

  return new Response(JSON.stringify({ ok: true, dryRun, filesDeleted, itemsCleared, perVessel, ranAt: nowIso }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
