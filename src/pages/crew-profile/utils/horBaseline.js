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

// One shift's start/end → 30-min block indices (0..47) on its shift_date.
// Overnight shifts (end <= start) are clipped to the day end for the baseline;
// the spill is reflected on the next day only once actuals are recorded.
function shiftToSegments(startTime, endTime) {
  const s = hhmmToDecimal(startTime);
  let e = hhmmToDecimal(endTime);
  if (s == null || e == null || s === e) return [];
  if (e <= s) e = 24;
  const startIdx = Math.max(0, Math.floor(s * 2));
  const endIdx = Math.min(48, Math.ceil(e * 2));
  const segs = [];
  for (let i = startIdx; i < endIdx; i += 1) segs.push(i);
  return segs;
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
  const { data: rows, error } = await supabase
    .from('rota_shifts')
    .select('shift_date, start_time, end_time, shift_type, rota_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .gte('shift_date', start)
    .lte('shift_date', end)
    .order('shift_date', { ascending: true });
  if (error || !rows) return {};

  // Accumulate per date, separating trip-rota from vessel-rota contributions so
  // a trip rota can take precedence on days where both exist.
  const byDate = new Map(); // date -> { trip:Set, vessel:Set }
  for (const r of rows) {
    if (!ON_DUTY_TYPES.has(r.shift_type)) continue; // off / medical ⇒ rest
    const owner = ownerById.get(r.rota_id) === 'trip' ? 'trip' : 'vessel';
    if (!byDate.has(r.shift_date)) byDate.set(r.shift_date, { trip: new Set(), vessel: new Set() });
    const bucket = byDate.get(r.shift_date)[owner];
    for (const seg of shiftToSegments(r.start_time, r.end_time)) bucket.add(seg);
  }

  const out = {};
  for (const [date, { trip, vessel }] of byDate) {
    const chosen = trip.size > 0 ? trip : vessel;
    out[date] = Array.from(chosen).sort((a, b) => a - b);
  }
  return out;
}
