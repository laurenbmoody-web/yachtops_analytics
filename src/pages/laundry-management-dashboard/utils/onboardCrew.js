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

  // Interior laundry marking (number / colour) — stored on crew_employment.
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

  // Berth cabin for the day — the authoritative source is the Movements board
  // (cabin_assignments → cabin_beds → vessel_cabins), exactly what the crew
  // profile shows as "Cabin · from Movements". Falls back to any cabin stored
  // on crew_employment, then blank.
  const cabinByUser = {};
  try {
    const dayStr = (day instanceof Date ? day : new Date(day)).toISOString().slice(0, 10);
    const { data: assigns } = await supabase
      .from('cabin_assignments')
      .select('user_id, bed_id, start_date, end_date')
      .eq('tenant_id', tenantId)
      .in('user_id', ids);
    const activeByUser = {};
    (assigns || []).forEach((a) => {
      if ((a.start_date || '') <= dayStr && (!a.end_date || a.end_date > dayStr)) {
        const prev = activeByUser[a.user_id];
        if (!prev || (a.start_date || '') > (prev.start_date || '')) activeByUser[a.user_id] = a;
      }
    });
    const bedIds = [...new Set(Object.values(activeByUser).map((a) => a.bed_id).filter(Boolean))];
    if (bedIds.length) {
      const { data: beds } = await supabase.from('cabin_beds').select('id, cabin_id').in('id', bedIds);
      const cabinIdByBed = Object.fromEntries((beds || []).map((b) => [b.id, b.cabin_id]));
      const cabinIds = [...new Set((beds || []).map((b) => b.cabin_id).filter(Boolean))];
      const { data: cabins } = cabinIds.length
        ? await supabase.from('vessel_cabins').select('id, name').in('id', cabinIds)
        : { data: [] };
      const nameByCabin = Object.fromEntries((cabins || []).map((c) => [c.id, c.name]));
      Object.entries(activeByUser).forEach(([uid, a]) => {
        const name = nameByCabin[cabinIdByBed[a.bed_id]];
        if (name) cabinByUser[uid] = name;
      });
    }
  } catch (e) {
    // No berth data — leave the cabin blank (the laundry master can type one).
  }

  return crew
    .filter((c) => (statusByUser[c.id] || 'active') === 'active')
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      roleTitle: c.roleTitle,
      department: c.department,
      cabin: cabinByUser[c.id] || kitByUser[c.id]?.cabin || '',
      laundryNumber: kitByUser[c.id]?.laundry_number || '',
      laundryColour: kitByUser[c.id]?.laundry_colour || '',
    }))
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
}
