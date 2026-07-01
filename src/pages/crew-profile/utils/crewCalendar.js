import { supabase } from '../../../lib/supabaseClient';

// Scheduled status entries shown on the Activity calendar. The entry's `kind`
// column holds a crew-status value (active / on_leave / rotational_leave /
// travelling / …) — the SAME vocabulary as the "Change status" picker — so the
// calendar and the status chip never disagree. Travel detail (route, flight,
// times) is captured on Travelling entries.

export const TRANSPORTS = ['Flight', 'Train', 'Ferry', 'Car', 'Other'];

const iso = (d) => String(d || '').slice(0, 10);

export const fetchCalendarEntries = async (userId) => {
  if (!userId) return [];
  const { data, error } = await supabase
    ?.from('crew_calendar_entries')
    ?.select('*')
    ?.eq('user_id', userId)
    ?.order('start_date', { ascending: false });
  if (error) { console.error('[calendar] fetch failed', error); return []; }
  return data || [];
};

export const saveCalendarEntry = async (entry) => {
  const payload = {
    user_id: entry.userId,
    tenant_id: entry.tenantId || null,
    kind: entry.kind || 'on_leave',
    start_date: entry.startDate || null,
    end_date: entry.endDate || entry.startDate || null,
    from_location: entry.fromLocation || null,
    to_location: entry.toLocation || null,
    location: entry.location || null,
    location_country: entry.locationCountry || null,
    transport: entry.transport || null,
    transport_no: entry.transportNo || null,
    depart_time: entry.departTime || null,
    arrive_time: entry.arriveTime || null,
    note: entry.note || null,
    actor_id: entry.actorId || null,
    actor_name: entry.actorName || null,
    updated_at: new Date().toISOString(),
  };
  let res;
  if (entry.id) {
    res = await supabase?.from('crew_calendar_entries')?.update(payload)?.eq('id', entry.id)?.select()?.single();
  } else {
    payload.created_by = entry.actorId || null;
    res = await supabase?.from('crew_calendar_entries')?.insert(payload)?.select()?.single();
  }
  if (res?.error) throw res.error;
  return res?.data;
};

export const deleteCalendarEntry = async (id) => {
  const { error } = await supabase?.from('crew_calendar_entries')?.delete()?.eq('id', id);
  if (error) throw error;
};

// ── multi-leg travel ──────────────────────────────────────────────────────────
// A journey = the crew_calendar_entries row (leg 1) + crew_travel_legs (leg 2+),
// so a flight and the taxi that follows it are one journey, not two entries.
export const fetchTravelLegs = async (tenantId) => {
  if (!tenantId) return [];
  const { data } = await supabase.from('crew_travel_legs').select('*').eq('tenant_id', tenantId).order('seq', { ascending: true });
  return data || [];
};

export const replaceTravelLegs = async (entryId, tenantId, legs) => {
  await supabase.from('crew_travel_legs').delete().eq('entry_id', entryId);
  const rows = (legs || []).filter((l) => l.transport || l.from || l.to || l.transportNo).map((l, i) => ({
    entry_id: entryId, tenant_id: tenantId, seq: i + 2, leg_date: l.date || null,
    transport: l.transport || null, transport_no: l.transportNo || null,
    from_location: l.from || null, to_location: l.to || null,
    depart_time: l.departTime || null, arrive_time: l.arriveTime || null,
  }));
  if (rows.length) {
    const { error } = await supabase.from('crew_travel_legs').insert(rows);
    if (error) throw error;
  }
};

// Save a whole journey: leg 1 → the entry, leg 2+ → crew_travel_legs.
export const saveJourney = async ({ id, userId, tenantId, kind, date, note, legs = [], actorId, actorName }) => {
  const first = legs[0] || {};
  const entry = await saveCalendarEntry({
    id, userId, tenantId, kind: kind || 'travelling', startDate: date, endDate: date,
    fromLocation: first.from, toLocation: first.to, transport: first.transport, transportNo: first.transportNo,
    departTime: first.departTime, arriveTime: first.arriveTime, note, actorId, actorName,
  });
  await replaceTravelLegs(entry.id, tenantId, legs.slice(1));
  return entry;
};

export const deleteJourney = async (entryId) => {
  const { error } = await supabase.from('crew_calendar_entries').delete().eq('id', entryId);
  if (error) throw error;
};

// The entry covering a given Date (inclusive range), or null. Latest start wins
// if two overlap.
export const entryForDay = (entries, date) => {
  const d = iso(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  return (entries || [])
    .filter((e) => iso(e.start_date) <= d && d <= iso(e.end_date))
    .sort((a, b) => iso(b.start_date).localeCompare(iso(a.start_date)))[0] || null;
};

// One-line travel summary for an entry (route + transport).
export const travelSummary = (e) => {
  const route = [e.from_location, e.to_location].filter(Boolean).join(' → ');
  const trans = [e.transport, e.transport_no].filter(Boolean).join(' ');
  return [route, trans].filter(Boolean).join(' · ');
};
