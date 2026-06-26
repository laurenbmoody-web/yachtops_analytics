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

// Raw DB row → the camelCase shape adaptLiveEntries expects (incl. route facts).
const mapRow = (r) => ({
  id: r.id, date: r.entry_date, source: r.source,
  serviceType: r.service_type || 'seagoing',
  capacityServed: r.capacity_served || '',
  watchHours: r.watch_hours || 0,
  vesselName: r.vessel_name, vesselFlag: r.vessel_flag, vesselImo: r.vessel_imo,
  vesselOfficialNo: r.vessel_official_number,
  grossTonnage: r.vessel_gt, lengthM: r.vessel_length_m, vesselType: r.vessel_type,
  cargoRegistered: r.vessel_cargo_registered, masterName: r.master_name,
  masterAboard: r.master_aboard, masterOnCargo: r.master_on_cargo,
  rawVerificationStatus: 'pending'
});

const inCmd = (e, cmd) => (!cmd.from || e.from >= cmd.from) && (!cmd.to || e.from <= cmd.to);
const routeFor = (v, cmd) => !v.cargoRegistered ? 'external' : cmd.member ? 'stamp' : 'virtual';
const fmtDate = (iso) => { if (!iso) return null; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : iso; };

export function useSeaTimeSignoffs(tenantId, signerName) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(!!tenantId);

  const load = useCallback(async () => {
    if (!tenantId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('sea_service_entries')
        .select('id, user_id, entry_date, source, service_type, capacity_served, watch_hours, vessel_name, vessel_flag, vessel_imo, vessel_official_number, vessel_gt, vessel_length_m, vessel_type, vessel_cargo_registered, master_name, master_aboard, master_on_cargo, submitted_at')
        .eq('tenant_id', tenantId)
        .eq('verification_status', 'pending')
        .order('entry_date', { ascending: true });
      if (error) throw error;

      const byUser = new Map();
      for (const r of rows || []) {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id).push(r);
      }

      // Seafarer names + testimonial particulars (DOB / nationality / discharge
      // book) for the cards and the generated PDF — mirrors the email-link path
      // so an in-app sign-off produces a fully-populated testimonial.
      const userIds = [...byUser.keys()];
      const nameMap = {}, detailMap = {};
      if (userIds.length) {
        const [{ data: profs }, { data: details }] = await Promise.all([
          supabase.from('profiles').select('id, full_name').in('id', userIds),
          supabase.from('crew_personal_details').select('user_id, date_of_birth, nationality, discharge_book_number').in('user_id', userIds),
        ]);
        for (const p of profs || []) nameMap[p.id] = p.full_name;
        for (const d of details || []) detailMap[d.user_id] = d;
      }

      // One sign-off unit per (seafarer, vessel, command spell). The captain
      // signs only the periods inside a given master's command window, so a
      // vessel whose command changed mid-service yields one item per master.
      const next = [];
      for (const [userId, userRows] of byUser) {
        const { vessels, entries } = adaptLiveEntries(userRows.map(mapRow));
        const submittedAt = userRows.map(r => r.submitted_at).filter(Boolean).sort()[0] || null;
        const requestedAt = submittedAt ? String(submittedAt).slice(0, 10) : null;
        for (const [vesselId, v] of Object.entries(vessels)) {
          const cmds = (v.commands && v.commands.length) ? v.commands : [{ id: 'c0', name: v.captainName || '', member: v.captainMember, onCargo: v.captainOnCargo, from: null, to: null }];
          const multi = cmds.length > 1;
          for (const cmd of cmds) {
            const periods = entries.filter(e => e.vesselId === vesselId && inCmd(e, cmd));
            if (!periods.length) continue;
            const mode = routeFor(v, cmd);
            if (mode === 'external') continue; // off-Cargo paper testimonials are crew uploads, not captain sign-offs
            next.push({
              id: `${userId}:${cmd.key || `${vesselId}:${cmd.id}`}`,
              requestedAt,
              seafarer: {
                fullName: nameMap[userId] || 'Seafarer',
                dob: detailMap[userId]?.date_of_birth || null,
                nationality: detailMap[userId]?.nationality || null,
                dischargeBookNo: detailMap[userId]?.discharge_book_number || '',
                cocHeld: '',
              },
              unit: {
                ...v, mode, multi,
                cmdLabel: multi ? `In command ${fmtDate(cmd.from) || '—'} – ${fmtDate(cmd.to) || 'present'}` : null,
                captainName: cmd.name || signerName || '', captainCoc: '', captainCocGrade: '', captainEmail: '',
                cmdFrom: cmd.from || '', cmdTo: cmd.to || '',
                periods
              }
            });
          }
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
