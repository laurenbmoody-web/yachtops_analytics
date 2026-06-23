import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { adaptLiveEntries } from '../crew-profile/utils/seaTimeLiveAdapter';

// useSeaTimeSignoffs — the captain's live queue of sea-service sign-offs.
//
// RLS lets a COMMAND user read the whole tenant, so we pull every entry with
// verification_status = 'pending' (submitted, awaiting signature), group it by
// seafarer + vessel, and adapt the per-day rows into the unit shape that
// <CaptainSignoff/> renders. Each unit's periods carry their rowIds so signing
// / rejecting touches exactly those rows.
//
// Pass tenantId = null to disable (e.g. when the inbox isn't on this category).

// Raw DB row → the camelCase shape adaptLiveEntries expects.
const mapRow = (r) => ({
  id: r.id, date: r.entry_date, source: r.source,
  serviceType: r.service_type || 'seagoing',
  capacityServed: r.capacity_served || '',
  watchHours: r.watch_hours || 0,
  vesselName: r.vessel_name, vesselFlag: r.vessel_flag, vesselImo: r.vessel_imo,
  grossTonnage: r.vessel_gt, lengthM: r.vessel_length_m, vesselType: r.vessel_type
});

export function useSeaTimeSignoffs(tenantId, signerName) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(!!tenantId);

  const load = useCallback(async () => {
    if (!tenantId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('sea_service_entries')
        .select('id, user_id, entry_date, source, service_type, capacity_served, watch_hours, vessel_name, vessel_flag, vessel_imo, vessel_official_number, vessel_gt, vessel_length_m, vessel_type, submitted_at')
        .eq('tenant_id', tenantId)
        .eq('verification_status', 'pending')
        .order('entry_date', { ascending: true });
      if (error) throw error;

      const byUser = new Map();
      for (const r of rows || []) {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id).push(r);
      }

      // Seafarer names for the cards.
      const userIds = [...byUser.keys()];
      const nameMap = {};
      if (userIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        for (const p of profs || []) nameMap[p.id] = p.full_name;
      }

      // One sign-off unit per (seafarer, vessel).
      const next = [];
      for (const [userId, userRows] of byUser) {
        const { vessels, entries } = adaptLiveEntries(userRows.map(mapRow));
        const submittedAt = userRows.map(r => r.submitted_at).filter(Boolean).sort()[0] || null;
        const officialByVessel = {};
        for (const r of userRows) { const k = r.vessel_imo || r.vessel_name; if (k && r.vessel_official_number) officialByVessel[k] = r.vessel_official_number; }
        const byVessel = {};
        for (const e of entries) { (byVessel[e.vesselId] ||= []).push(e); }
        for (const [vesselId, periods] of Object.entries(byVessel)) {
          const v = vessels[vesselId] || {};
          const froms = periods.map(p => p.from).filter(Boolean).sort();
          const tos = periods.map(p => p.to).filter(Boolean).sort();
          next.push({
            id: `${userId}:${vesselId}`,
            requestedAt: submittedAt ? String(submittedAt).slice(0, 10) : null,
            seafarer: { fullName: nameMap[userId] || 'Seafarer' },
            unit: {
              ...v, officialNo: officialByVessel[vesselId] || v.imo || '',
              mode: 'virtual', multi: false, cmdLabel: null,
              captainName: signerName || '', captainCoc: '', captainCocGrade: '', captainEmail: '',
              cmdFrom: froms[0] || '', cmdTo: tos[tos.length - 1] || '',
              periods
            }
          });
        }
      }
      // Newest request first.
      next.sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
      setItems(next);
    } catch (e) {
      console.error('[useSeaTimeSignoffs] load failed:', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, signerName]);

  useEffect(() => { load(); }, [load]);

  return { items, loading, refetch: load };
}
