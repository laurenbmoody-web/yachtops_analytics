// Supabase Edge Function: sync-crew-documents-to-vault
//
// Command/Chief-triggered "Sync crew certificates". Pulls every ACTIVE crew
// member's personal document files into the vessel's document vault, under a
// "Crew Certificates" folder with a per-member subfolder — for audit. Copies
// the file across storage buckets (crew-documents → vessel-vault) with the
// service role, then inserts a vessel_documents row tagged with
// source_document_id so a re-run only pulls NEW documents (idempotent).
//
// Auth: caller must be an active COMMAND/CHIEF of the tenant.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SRC_BUCKET = 'crew-documents';
const VAULT_BUCKET = 'vessel-vault';
const ROOT_FOLDER = 'Crew Certificates';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Pull the storage path out of a crew-documents signed URL:
//   …/object/sign/crew-documents/<path>?token=…  →  <path>
function pathFromSignedUrl(url: string): string | null {
  const m = String(url || '').match(/\/crew-documents\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const safeName = (s: string) => String(s || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'missing token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (userErr || !uid) return json({ error: 'invalid token' }, 401);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* none */ }
    const tenantId = String(body?.tenant_id || '');
    if (!tenantId) return json({ error: 'tenant_id required' }, 400);

    // Caller must be active COMMAND/CHIEF of this tenant.
    const { data: me } = await admin
      .from('tenant_members')
      .select('permission_tier, role, active')
      .eq('tenant_id', tenantId).eq('user_id', uid).eq('active', true).maybeSingle();
    const tier = String(me?.permission_tier || me?.role || '').toUpperCase();
    if (!me || (tier !== 'COMMAND' && tier !== 'CHIEF')) {
      return json({ error: 'not authorized' }, 403);
    }

    // Find or create a vault folder (kind=folder) by name under a parent.
    const ensureFolder = async (name: string, parentId: string | null): Promise<string> => {
      let q = admin.from('vessel_documents').select('id')
        .eq('tenant_id', tenantId).eq('kind', 'folder').eq('name', name);
      q = parentId === null ? q.is('parent_id', null) : q.eq('parent_id', parentId);
      const { data: found } = await q.maybeSingle();
      if (found?.id) return found.id as string;
      const { data: created, error } = await admin.from('vessel_documents')
        .insert({ tenant_id: tenantId, parent_id: parentId, kind: 'folder', name, created_by: uid })
        .select('id').single();
      if (error) throw error;
      return created.id as string;
    };

    const rootId = await ensureFolder(ROOT_FOLDER, null);

    // Active crew of this vessel + display names.
    const { data: members } = await admin
      .from('tenant_members').select('user_id').eq('tenant_id', tenantId).eq('active', true);
    const memberIds = [...new Set((members || []).map((m: { user_id: string }) => m.user_id).filter(Boolean))];
    if (memberIds.length === 0) return json({ ok: true, synced: 0, skipped: 0 });

    const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', memberIds);
    const nameOf = new Map((profs || []).map((p: { id: string; full_name: string }) => [p.id, p.full_name || 'Crew member']));

    // Already-synced source ids for this vessel — the dedupe set.
    const { data: existing } = await admin.from('vessel_documents')
      .select('source_document_id').eq('tenant_id', tenantId).not('source_document_id', 'is', null);
    const already = new Set((existing || []).map((r: { source_document_id: string }) => r.source_document_id));

    let synced = 0, skipped = 0, failed = 0;
    const memberFolder = new Map<string, string>();

    for (const memberId of memberIds) {
      const { data: docs } = await admin.from('personal_documents')
        .select('id, doc_type, title, file_url, file_name, mime_type, size_bytes, expiry_date')
        .eq('user_id', memberId);
      for (const d of (docs || [])) {
        if (!d.file_url) continue;
        if (already.has(d.id)) { skipped++; continue; }
        try {
          const srcPath = pathFromSignedUrl(d.file_url);
          let bytes: Blob | null = null;
          if (srcPath) {
            const { data: dl } = await admin.storage.from(SRC_BUCKET).download(srcPath);
            bytes = dl || null;
          }
          if (!bytes) { // fallback: fetch the signed URL directly
            const res = await fetch(d.file_url);
            if (res.ok) bytes = await res.blob();
          }
          if (!bytes) { failed++; continue; }

          // Folder for this member (create lazily, only when they have a doc).
          if (!memberFolder.has(memberId)) {
            memberFolder.set(memberId, await ensureFolder(nameOf.get(memberId) || 'Crew member', rootId));
          }
          const parentId = memberFolder.get(memberId)!;

          const fname = safeName(d.file_name || `${d.title || d.doc_type || 'document'}`);
          const vaultPath = `${tenantId}/crew-sync/${d.id}-${fname}`;
          const up = await admin.storage.from(VAULT_BUCKET).upload(vaultPath, bytes, {
            contentType: d.mime_type || 'application/octet-stream', upsert: true,
          });
          if (up.error) { failed++; continue; }

          const { error: insErr } = await admin.from('vessel_documents').insert({
            tenant_id: tenantId, parent_id: parentId, kind: 'file',
            name: d.title || d.file_name || `${d.doc_type || 'document'}`,
            storage_path: vaultPath, mime_type: d.mime_type || null, size_bytes: d.size_bytes || null,
            expiry_date: d.expiry_date || null, created_by: uid, source_document_id: d.id,
          });
          if (insErr) { failed++; continue; }
          already.add(d.id);
          synced++;
        } catch (e) {
          console.warn('[sync-crew-documents] doc failed', d.id, e);
          failed++;
        }
      }
    }

    return json({ ok: true, synced, skipped, failed });
  } catch (e) {
    console.error('[sync-crew-documents-to-vault] error:', e);
    return json({ error: 'unexpected error' }, 500);
  }
});
