// Supabase Edge Function: delete-my-account
//
// Irreversibly erases the caller's Cargo account:
//   1. Verifies the caller's JWT (they can only delete themselves).
//   2. Refuses if they're the last Command on an active vessel (the vessel
//      would be left with nobody able to run it) — transfer command first.
//   3. Removes every personal file they own (admin_user_storage_paths: avatar,
//      crew documents, captain credentials, sea-service testimonials, feedback
//      voice notes). Best-effort, so a storage hiccup never blocks erasure.
//   4. Wipes their personal data across every user-owned table + profile row
//      (admin_wipe_user, service role — drift-proof sweep).
//   5. Deletes the auth user, which revokes every session.
//
// A vessel may still lawfully retain compliance records it controls; those are
// the vessel's, not part of this personal account, and are unaffected.
//
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'missing token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Identify the caller from their JWT — this is who gets deleted.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (userErr || !uid) return json({ error: 'invalid token' }, 401);

    // Explicit confirmation guards against accidental calls.
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    if (body?.confirm !== true) return json({ error: 'confirmation required' }, 400);

    // 1. Refuse if this would leave a vessel with no Command.
    const { data: blocker, error: blockErr } = await admin.rpc('admin_account_deletion_blocker', { p_uid: uid });
    if (blockErr) {
      console.error('[delete-my-account] blocker check failed:', blockErr);
      return json({ error: 'data erasure failed' }, 500);
    }
    if (blocker) return json({ error: blocker }, 409);

    // 2. Remove every personal file (best-effort). Paths come from the DB so
    //    files outside `${uid}/…` (testimonials, feedback audio) are caught too.
    try {
      const { data: files, error: filesErr } = await admin.rpc('admin_user_storage_paths', { p_uid: uid });
      if (filesErr) throw filesErr;
      const byBucket = new Map<string, string[]>();
      for (const f of (files || []) as { bucket: string; path: string }[]) {
        if (!f?.bucket || !f?.path) continue;
        if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
        byBucket.get(f.bucket)!.push(f.path);
      }
      for (const [bucket, paths] of byBucket) {
        for (let i = 0; i < paths.length; i += 100) {
          const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
          if (error) console.warn(`[delete-my-account] ${bucket} cleanup partial:`, error);
        }
      }
    } catch (e) {
      console.warn('[delete-my-account] storage cleanup skipped:', e);
    }

    // 3. Wipe personal data across every user-owned table + the profile row.
    const { error: wipeErr } = await admin.rpc('admin_wipe_user', { p_uid: uid });
    if (wipeErr) {
      console.error('[delete-my-account] wipe failed:', wipeErr);
      return json({ error: 'data erasure failed' }, 500);
    }

    // 4. Delete the auth user (revokes all sessions).
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) {
      console.error('[delete-my-account] auth delete failed:', delErr);
      return json({ error: 'account deletion failed' }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('[delete-my-account] error:', e);
    return json({ error: 'unexpected error' }, 500);
  }
});
