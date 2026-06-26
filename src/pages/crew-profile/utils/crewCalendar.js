import { supabase } from '../../../lib/supabaseClient';

// Scheduled leave / travel entries shown on the Activity calendar.
// Each kind maps to a crew-status colour so the days tint on the month grid.
export const CALENDAR_KINDS = [
  { id: 'leave', label: 'Leave', status: 'on_leave' },
  { id: 'travel', label: 'Travel day', status: 'travelling' },
  { id: 'joining', label: 'Joining vessel', status: 'travelling' },
  { id: 'disembarking', label: 'Disembarking', status: 'travelling' },
  { id: 'other', label: 'Other', status: 'invited' },
];
export const calKind = (id) => CALENDAR_KINDS.find((k) => k.id === id) || CALENDAR_KINDS[4];

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
    kind: entry.kind || 'leave',
    start_date: entry.startDate || null,
    end_date: entry.endDate || entry.startDate || null,
    from_location: entry.fromLocation || null,
    to_location: entry.toLocation || null,
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
