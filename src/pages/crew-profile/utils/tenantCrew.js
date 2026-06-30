// tenantCrew — DB-backed roster for the active tenant. Mirrors the crew-management
// query (tenant_members joined to profiles + departments) but trimmed to what the
// HOR command dashboard needs. `id` is the auth uid / profiles.id, which equals
// hor_month_status.subject_user_id, so statuses join cleanly.

import { supabase } from '../../../lib/supabaseClient';

export async function fetchTenantCrew(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('tenant_members')
    .select(`
      user_id,
      permission_tier,
      departments(name),
      role:roles!role_id(name),
      profiles!tenant_members_user_id_fkey(full_name, avatar_url)
    `)
    .eq('tenant_id', tenantId)
    .eq('active', true);
  if (error) {
    console.error('[hor] tenant crew fetch failed', error);
    return [];
  }
  return (data || []).map((tm) => ({
    id: tm.user_id,
    fullName: tm.profiles?.full_name || 'Unknown',
    photo: tm.profiles?.avatar_url || '',
    department: tm.departments?.name || '—',
    roleTitle: tm.role?.name || '',
    tier: tm.permission_tier || null,
  }));
}
