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
import { ON_DUTY_TYPES } from '../../crew-rota/restHours';

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmmToDecimal = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
};

// One shift's start/end → 30-min block indices (0..47), split across midnight:
// { today } on its shift_date and { next } spilling onto the following day.
// Worked hours are never dropped — an overnight shift's post-midnight portion
// is credited to the next calendar day, matching logged actuals and the engine.
function shiftToSegments(startTime, endTime) {
  const s = hhmmToDecimal(startTime);
  const e = hhmmToDecimal(endTime);
  if (s == null || e == null || s === e) return { today: [], next: [] };
  const startIdx = Math.max(0, Math.floor(s * 2));
  const today = [];
  const next = [];
  if (e < s) {
    for (let i = startIdx; i < 48; i += 1) today.push(i);
    const endIdx = Math.min(48, Math.ceil(e * 2));
    for (let i = 0; i < endIdx; i += 1) next.push(i);
  } else {
    const endIdx = Math.min(48, Math.ceil(e * 2));
    for (let i = startIdx; i < endIdx; i += 1) today.push(i);
  }
  return { today, next };
}

// Returns { 'YYYY-MM-DD': number[] } of baseline work-block indices for the
// month. Empty object when the member can't be resolved or has no rota shifts.
export async function fetchRotaBaselineForMonth({ userId, tenantId, year, month }) {
  if (!userId || !tenantId || year == null || month == null) return {};

  // user_id → tenant_members.id (the id rota_shifts.member_id points at).
  const { data: tm, error: tmErr } = await supabase
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (tmErr || !tm?.id) return {};
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
  // prior month correctly spills its post-midnight hours onto day 1 of this one.
  const fetchStart = ymd(new Date(year, month, 0));
  const { data: rows, error } = await supabase
    .from('rota_shifts')
    .select('shift_date, start_time, end_time, shift_type, rota_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .gte('shift_date', fetchStart)
    .lte('shift_date', end)
    .order('shift_date', { ascending: true });
  if (error || !rows) return {};

  // Accumulate per date, separating trip-rota from vessel-rota contributions so
  // a trip rota can take precedence on days where both exist. Overnight shifts
  // credit their start day AND the next day (the post-midnight spill).
  const byDate = new Map(); // date -> { trip:Set, vessel:Set }
  const ensure = (date) => {
    if (!byDate.has(date)) byDate.set(date, { trip: new Set(), vessel: new Set() });
    return byDate.get(date);
  };
  const nextYmd = (dateStr) => {
    const [Y, Mo, D] = dateStr.split('-').map(Number);
    const d = new Date(Y, Mo - 1, D); d.setDate(d.getDate() + 1);
    return ymd(d);
  };
  for (const r of rows) {
    if (!ON_DUTY_TYPES.has(r.shift_type)) continue; // off / medical ⇒ rest
    const owner = ownerById.get(r.rota_id) === 'trip' ? 'trip' : 'vessel';
    const { today, next } = shiftToSegments(r.start_time, r.end_time);
    const todayBucket = ensure(r.shift_date)[owner];
    for (const seg of today) todayBucket.add(seg);
    if (next.length) {
      const nextBucket = ensure(nextYmd(r.shift_date))[owner];
      for (const seg of next) nextBucket.add(seg);
    }
  }

  // Emit only dates within the requested month — the −1 day fetch and any
  // last-day spill onto next month inform attribution but aren't returned here
  // (the adjacent month's own fetch covers them).
  const out = {};
  for (const [date, { trip, vessel }] of byDate) {
    if (date < start || date > end) continue;
    const chosen = trip.size > 0 ? trip : vessel;
    out[date] = Array.from(chosen).sort((a, b) => a - b);
  }
  return out;
}
