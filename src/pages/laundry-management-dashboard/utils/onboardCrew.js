// loadOnboardCrew — the crew the laundry picker should offer: active members
// who are actually ON BOARD for the given day (not on leave / rotational /
// medical / training leave / travelling), each with their berth cabin so the
// laundry master knows where to deliver back to.
//
// Sources (all Supabase, RLS-scoped to the vessel):
//   • fetchTenantCrew            — active tenant members (name, role, dept)
//   • crew_status_history        — status for the day (aboard = 'active')
//   • vessel_cabins / cabin_beds / cabin_assignments — the berth for the day
//
// Best-effort on the cabin/status joins: a crew member with no status history
// is treated as aboard, and a missing berth just leaves the cabin blank (the
// laundry master can still type one in).

import { supabase } from '../../../lib/supabaseClient';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import { buildStatusPeriods, getStatusForDay } from '../../../utils/crewStatus';

export async function loadOnboardCrew(tenantId, day = new Date()) {
  if (!tenantId) return [];

  const crew = await fetchTenantCrew(tenantId);
  if (!crew?.length) return [];
  const ids = crew.map((c) => c.id).filter(Boolean);

  // Status for the day — keep only those aboard ('active').
  const statusByUser = {};
  try {
    const { data } = await supabase
      .from('crew_status_history')
      .select('user_id, new_status, changed_at')
      .eq('tenant_id', tenantId)
      .in('user_id', ids)
      .order('changed_at', { ascending: true });
    const grouped = {};
    (data || []).forEach((r) => { (grouped[r.user_id] = grouped[r.user_id] || []).push(r); });
    Object.entries(grouped).forEach(([uid, hist]) => {
      statusByUser[uid] = getStatusForDay(buildStatusPeriods(hist), day) || 'active';
    });
  } catch (e) {
    // No history table / no rows — treat everyone as aboard.
  }

  // Cabin + interior laundry marking (number / colour) — set on the Issued Kit
  // tab, stored on crew_employment. This is what the laundry needs.
  const kitByUser = {};
  try {
    const { data } = await supabase
      .from('crew_employment')
      .select('user_id, cabin, laundry_number, laundry_colour')
      .in('user_id', ids);
    (data || []).forEach((r) => { kitByUser[r.user_id] = r; });
  } catch (e) {
    // No employment rows — leave the marking blank.
  }

  return crew
    .filter((c) => (statusByUser[c.id] || 'active') === 'active')
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      roleTitle: c.roleTitle,
      department: c.department,
      cabin: kitByUser[c.id]?.cabin || '',
      laundryNumber: kitByUser[c.id]?.laundry_number || '',
      laundryColour: kitByUser[c.id]?.laundry_colour || '',
    }))
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
}
