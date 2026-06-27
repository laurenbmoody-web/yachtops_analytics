import { supabase } from '../../../lib/supabaseClient';

// Vessel sign-on / sign-off stamps — the immigration events that pause a crew
// member's Schengen/visa clock while they're signed onto the crew list.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fetchStamps = async (userId) => {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('crew_vessel_stamps').select('*').eq('user_id', userId)
    .order('stamp_date', { ascending: true });
  if (error) { console.error('[stamps] fetch failed', error); return []; }
  return data || [];
};

export const saveStamp = async (s) => {
  const payload = {
    user_id: s.userId, tenant_id: s.tenantId || null, kind: s.kind,
    stamp_date: s.stampDate, place: s.place || null, country: s.country || null,
    note: s.note || null, actor_id: s.actorId || null, actor_name: s.actorName || null,
    updated_at: new Date().toISOString(),
  };
  const res = s.id
    ? await supabase.from('crew_vessel_stamps').update(payload).eq('id', s.id).select().single()
    : await supabase.from('crew_vessel_stamps').insert(payload).select().single();
  if (res?.error) throw res.error;
  return res?.data;
};

export const deleteStamp = async (id) => {
  const { error } = await supabase.from('crew_vessel_stamps').delete().eq('id', id);
  if (error) throw error;
};

// Signed ON the vessel on `date`? True when the latest stamp on or before that
// day is an 'on'. (stamps must be sorted ascending by stamp_date.)
export const isStampedOn = (stamps, date) => {
  const d = iso(date);
  let on = false;
  for (const s of (stamps || [])) {
    if (String(s.stamp_date).slice(0, 10) <= d) on = (s.kind === 'on');
    else break;
  }
  return on;
};

// The stamp recorded exactly on a given day (for the calendar marker / panel).
export const stampOnDay = (stamps, date) => {
  const d = iso(date);
  return (stamps || []).find((s) => String(s.stamp_date).slice(0, 10) === d) || null;
};
