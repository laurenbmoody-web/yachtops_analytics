// horBaseline — Phase 1: derive a crew member's Hours-of-Rest BASELINE from
// their rota. The rota is the first layer of truth: an on-trip rota where one
// covers the day, otherwise the standing vessel rota. This converts the
// member's rota_shifts into the HOR 30-min work-block shape so the profile
// grid + compliance can show the PLANNED hours before any actuals are entered.
//
// Identity note: the crew-profile keys HOR by user_id (crewId), whereas
// rota_shifts.member_id references tenant_members.id — so we hop user_id →
// tenant_members.id for the active tenant first.

import { supabase } from '../../../lib/supabaseClient';
import { ON_DUTY_TYPES, shiftToOnDutySegments } from '../../crew-rota/restHours';

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Shift→segment translation (with the same midnight rule + next-day spill the
// profile log and rota Rest Log use) lives in the shared engine,
// restHours.shiftToOnDutySegments — no local copy.

// Returns { 'YYYY-MM-DD': number[] } of baseline work-block indices for the
// month, or `null` when the baseline could NOT be derived (missing args,
// member-resolution miss, or a query error). The distinction matters: an empty
// object {} is an authoritative "no rota shifts this month" and may clear the
// cached baseline, whereas `null` is "couldn't tell" — callers must preserve
// the last-known baseline rather than wipe them on a transient failure.
export async function fetchRotaBaselineForMonth({ userId, tenantId, year, month }) {
  if (!userId || !tenantId || year == null || month == null) return null;

  // user_id → tenant_members.id (the id rota_shifts.member_id points at).
  const { data: tm, error: tmErr } = await supabase
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (tmErr || !tm?.id) return null;
  const memberId = tm.id;

  // owner_type per rota (avoid a PostgREST embed in case no FK is declared).
  const { data: rotaRows } = await supabase
    .from('rotas')
    .select('id, owner_type')
    .eq('tenant_id', tenantId);
  const ownerById = new Map((rotaRows || []).map((r) => [r.id, r.owner_type]));

  const start = ymd(new Date(year, month, 1));
  const end = ymd(new Date(year, month + 1, 0));
  // Fetch from the previous day too, so an overnight shift on the last day of the
  // prior month spills its post-midnight hours onto day 1 of this month.
  const fetchStart = ymd(new Date(year, month, 0));
  const { data: rows, error } = await supabase
    .from('rota_shifts')
    .select('shift_date, start_time, end_time, shift_type, rota_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .gte('shift_date', fetchStart)
    .lte('shift_date', end)
    .order('shift_date', { ascending: true });
  if (error || !rows) return null;

  // Accumulate per date, separating trip-rota from vessel-rota contributions so
  // a trip rota can take precedence on days where both exist.
  const byDate = new Map(); // date -> { trip:Set, vessel:Set }
  for (const r of rows) {
    if (!ON_DUTY_TYPES.has(r.shift_type)) continue; // off / medical ⇒ rest
    const owner = ownerById.get(r.rota_id) === 'trip' ? 'trip' : 'vessel';
    // An overnight shift yields a piece on its start date AND a spill piece on
    // the next date — both seeded, so the baseline matches how the same hours
    // would be logged as actuals.
    for (const part of shiftToOnDutySegments(r.shift_date, r.start_time, r.end_time)) {
      if (!byDate.has(part.date)) byDate.set(part.date, { trip: new Set(), vessel: new Set() });
      const bucket = byDate.get(part.date)[owner];
      for (const seg of part.segments) bucket.add(seg);
    }
  }

  // Emit only dates within the requested month — the −1 day fetch and any
  // last-day spill onto the next month inform attribution but aren't returned
  // here (the adjacent month's own fetch covers those days).
  const out = {};
  for (const [date, { trip, vessel }] of byDate) {
    if (date < start || date > end) continue;
    const chosen = trip.size > 0 ? trip : vessel;
    out[date] = Array.from(chosen).sort((a, b) => a - b);
  }
  return out;
}
