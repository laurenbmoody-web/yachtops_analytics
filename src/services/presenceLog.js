// Gangway history — append-only log of sign in/out events and saved musters.
// crew_presence keeps the *current* status; this keeps the trail (from both
// personal devices and the entry-door iPad).
import { supabase } from '../lib/supabaseClient';

// Fire-and-forget: logging must never block or break a sign in/out.
export function logPresenceEvent({ tenantId, subjectType = 'crew', subjectId, subjectName, direction, actorUserId, actorName, source = 'app' }) {
  if (!tenantId || !direction) return;
  (async () => {
    try {
      await supabase?.from('presence_events')?.insert({
        tenant_id: tenantId,
        subject_type: subjectType,
        subject_id: subjectId ? String(subjectId) : null,
        subject_name: subjectName || null,
        direction,
        actor_user_id: actorUserId || null,
        actor_name: actorName || null,
        source,
      });
    } catch (err) {
      console.warn('[presenceLog] event insert failed (non-blocking):', err?.message);
    }
  })();
}

export async function fetchPresenceEvents(tenantId, { limit = 200 } = {}) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('presence_events')
    ?.select('id, subject_type, subject_name, direction, actor_name, source, created_at')
    ?.eq('tenant_id', tenantId)
    ?.order('created_at', { ascending: false })
    ?.limit(limit);
  if (error) { console.error('[presenceLog] fetch events failed:', error?.message); return []; }
  return data || [];
}

export async function saveMusterRecord({ tenantId, createdBy, createdByName, expected, rollCalls, roster }) {
  if (!tenantId) throw new Error('No vessel');
  const { data, error } = await supabase
    ?.from('muster_records')
    ?.insert({
      tenant_id: tenantId,
      created_by: createdBy || null,
      created_by_name: createdByName || null,
      expected: Number.isFinite(expected) ? expected : null,
      roll_calls: rollCalls || [],
      roster: roster || [],
    })
    ?.select('id, created_at')
    ?.single();
  if (error) throw error;
  return data;
}

// ── Gangway device role ─────────────────────────────────────────────────────
// Which member accounts are marked as a door device for this vessel.
export async function fetchKioskDeviceIds(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('tenant_members')?.select('user_id')?.eq('tenant_id', tenantId)?.eq('is_kiosk_device', true);
  if (error) { console.error('[presenceLog] fetch devices failed:', error?.message); return []; }
  return (data || []).map((r) => r.user_id);
}

// Command-only: mark/unmark an account as the gangway device (enforced in the RPC).
export async function setKioskDevice(userId, on) {
  const { error } = await supabase?.rpc('set_kiosk_device', { p_user_id: userId, p_on: on });
  if (error) throw error;
}

export async function fetchMusterRecords(tenantId, { limit = 100 } = {}) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('muster_records')
    ?.select('id, created_at, created_by_name, expected, roll_calls, roster')
    ?.eq('tenant_id', tenantId)
    ?.order('created_at', { ascending: false })
    ?.limit(limit);
  if (error) { console.error('[presenceLog] fetch musters failed:', error?.message); return []; }
  return data || [];
}
