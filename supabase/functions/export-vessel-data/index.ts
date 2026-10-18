// Supabase Edge Function: export-vessel-data
//
// Command on a vessel downloads everything the vessel has stored in Cargo, as
// one JSON file: every vessel table's rows, plus a list of the vessel's files
// with download links valid for 7 days. Used from the Membership page and the
// "membership ended" screen, so a vessel can take its records before the
// 90-day deletion.
//
// Left out: crew's own personal records (documents, credentials, signatures,
// face sign-in data), device/push and security logs, bank connections, and any
// column holding a token, secret or hash.
//
// Request: POST { tenant_id }  (Authorization: Bearer <user access token>)
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const EXCLUDED_TABLES = new Set([
  'personal_documents', 'captain_credentials', 'master_signatures', 'crew_face_enrolments',
  'push_subscriptions', 'security_events', 'security_alerts', 'terms_acceptances',
  'bank_connections', 'bank_connection_accounts', 'crew_invites',
]);
const SECRET_COLUMN = /(token|secret|hash|descriptor|password)/i;
const PAGE = 1000;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let tenantId = '';
  try { tenantId = String((await req.json())?.tenant_id || ''); } catch { /* empty body */ }
  if (!tenantId) return json({ error: 'tenant_id is required' }, 400);

  // Caller must be Command on this vessel.
  const authHeader = req.headers.get('Authorization') || '';
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: who } = await asUser.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!who?.user) return json({ error: 'sign in required' }, 401);
  const { data: isCommand } = await asUser.rpc('is_command_for_tenant', { p_tenant_id: tenantId });
  if (!isCommand) return json({ error: 'Only Command on this vessel can export its data.' }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: tenant } = await admin.from('tenants').select('id, name, data_deleted_at').eq('id', tenantId).maybeSingle();
  if (!tenant) return json({ error: 'vessel not found' }, 404);
  if (tenant.data_deleted_at) return json({ error: "This vessel's data has already been deleted." }, 410);

  const { data: tableList, error: tErr } = await admin.rpc('vessel_data_tables');
  if (tErr) return json({ error: 'export failed' }, 500);

  const tables: Record<string, unknown[]> = {};
  for (const table of (tableList as string[]) || []) {
    if (EXCLUDED_TABLES.has(table)) continue;
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from(table).select('*').eq('tenant_id', tenantId).range(from, from + PAGE - 1);
      if (error) { console.warn(`[export] ${table}`, error.message); break; }
      for (const r of data || []) {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (!SECRET_COLUMN.test(k)) clean[k] = v;
        rows.push(clean);
      }
      if (!data || data.length < PAGE) break;
    }
    if (rows.length) tables[table] = rows;
  }

  // Files, with 7-day download links.
  const files: { bucket: string; path: string; url: string | null }[] = [];
  const { data: paths } = await admin.rpc('vessel_storage_paths', { p_tenant: tenantId });
  const byBucket = new Map<string, string[]>();
  for (const f of (paths as { bucket_id: string; name: string }[]) || []) {
    if (!byBucket.has(f.bucket_id)) byBucket.set(f.bucket_id, []);
    byBucket.get(f.bucket_id)!.push(f.name);
  }
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const { data: signed } = await admin.storage.from(bucket).createSignedUrls(chunk, 7 * 24 * 60 * 60);
      chunk.forEach((name, j) => files.push({ bucket, path: name, url: signed?.[j]?.signedUrl || null }));
    }
  }

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({
    vessel: { id: tenant.id, name: tenant.name },
    exported_at: exportedAt,
    exported_by: who.user.email,
    note: 'Cargo vessel data export. File links expire 7 days after export.',
    tables,
    files,
  }, null, 2);
  const safeName = String(tenant.name || 'vessel').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'vessel';
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="cargo-${safeName}-export-${exportedAt.slice(0, 10)}.json"`,
    },
  });
});
