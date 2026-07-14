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
import { fetchCabins, fetchAssignments } from '../../crew-management/utils/vesselCabins';

const dayKey = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// end_date is the first FREE day (exclusive); null = open-ended. Dates are
// stored as ISO 'YYYY-MM-DD', so lexical string comparison is date-correct.
const spansDay = (a, key) => {
  if (!a?.start_date || a.start_date > key) return false;
  if (!a?.end_date) return true;
  return key < a.end_date;
};

export async function loadOnboardCrew(tenantId, day = new Date()) {
  if (!tenantId) return [];
  const key = dayKey(day);

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

  // Berth cabin for the day (best-effort).
  const cabinByUser = {};
  try {
    const [cabins, assigns] = await Promise.all([fetchCabins(tenantId), fetchAssignments(tenantId)]);
    const cabinOfBed = {};
    (cabins || []).forEach((c) => (c.beds || []).forEach((b) => { cabinOfBed[b.id] = { name: c.name, deck: c.deck }; }));
    (assigns || []).forEach((a) => {
      if (!spansDay(a, key)) return;
      const c = cabinOfBed[a.bed_id];
      if (c) cabinByUser[a.user_id] = [c.deck, c.name].filter(Boolean).join(' · ');
    });
  } catch (e) {
    // No cabins configured — leave the cabin blank.
  }

  return crew
    .filter((c) => (statusByUser[c.id] || 'active') === 'active')
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      roleTitle: c.roleTitle,
      department: c.department,
      cabin: cabinByUser[c.id] || '',
    }))
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
}
