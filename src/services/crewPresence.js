// Crew presence — lightweight daily aboard/ashore ("who's on the boat right now").
// Backed by public.crew_presence, one row per (tenant, crew). Deliberately separate
// from the leave/rotation status system. A missing row means aboard (the default).
import { supabase } from '../lib/supabaseClient';

export const ABOARD = 'aboard';
export const ASHORE = 'ashore';
export const flip = (s) => (s === ASHORE ? ABOARD : ASHORE);

// Full board — every active crew member and their current presence.
export async function fetchPresenceBoard(tenantId) {
  if (!tenantId) return [];
  // Duty status 'active' — currently-serving crew. This includes roster-only crew
  // who haven't signed up to Cargo yet (they still have status 'active'), and
  // excludes anyone on leave/rotation and pending invites. Being on the boat is
  // about duty status, not whether they have a login.
  const { data: members, error } = await supabase
    ?.from('tenant_members')
    ?.select('user_id, display_name, department_id')
    ?.eq('tenant_id', tenantId)
    ?.eq('active', true)
    ?.eq('status', 'active');
  if (error) { console.error('[presence] members fetch failed', error); return []; }
  const roster = members || [];
  const ids = roster.map((m) => m.user_id).filter(Boolean);
  if (!ids.length) return [];

  const [profRes, presRes, deptRes] = await Promise.all([
    supabase?.from('profiles')?.select('id, full_name, avatar_url')?.in('id', ids),
    supabase?.from('crew_presence')?.select('user_id, status, changed_at')?.eq('tenant_id', tenantId),
    supabase?.from('departments')?.select('id, name'),
  ]);
  const prof = Object.fromEntries((profRes?.data || []).map((p) => [p.id, p]));
  const pres = Object.fromEntries((presRes?.data || []).map((p) => [p.user_id, p]));
  const dept = Object.fromEntries((deptRes?.data || []).map((d) => [d.id, d.name]));

  return roster
    .map((m) => ({
      userId: m.user_id,
      name: prof[m.user_id]?.full_name || m.display_name || 'Crew',
      avatarUrl: prof[m.user_id]?.avatar_url || null,
      department: dept[m.department_id] || null,
      status: pres[m.user_id]?.status || ABOARD,
      changedAt: pres[m.user_id]?.changed_at || null,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// One crew member's current presence (defaults to aboard when no row yet).
export async function fetchMyPresence(tenantId, userId) {
  if (!tenantId || !userId) return ABOARD;
  const { data, error } = await supabase
    ?.from('crew_presence')
    ?.select('status')
    ?.eq('tenant_id', tenantId)
    ?.eq('user_id', userId)
    ?.maybeSingle();
  if (error) { console.error('[presence] my presence fetch failed', error); return ABOARD; }
  return data?.status || ABOARD;
}

// Set (upsert) a crew member's presence. `changedBy` is the actor (self on a
// personal toggle, the shared-device account on the board).
export async function setPresence(tenantId, userId, status, changedBy) {
  if (!tenantId || !userId) throw new Error('Missing tenant or user');
  const now = new Date().toISOString();
  const { error } = await supabase
    ?.from('crew_presence')
    ?.upsert(
      { tenant_id: tenantId, user_id: userId, status, changed_at: now, changed_by: changedBy || userId, updated_at: now },
      { onConflict: 'tenant_id,user_id' },
    );
  if (error) throw error;
}
