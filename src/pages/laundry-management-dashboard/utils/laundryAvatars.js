// Attach owner avatar images to laundry items — guests carry a `photo`,
// crew a `profiles.avatar_url`. Both are tenant-scoped by RLS.

import { supabase } from '../../../lib/supabaseClient';

export async function enrichWithAvatars(items) {
  const list = items || [];
  const guestIds = [...new Set(list.filter((i) => i.ownerGuestId).map((i) => i.ownerGuestId))];
  const crewIds = [...new Set(list.filter((i) => i.ownerCrewUserId).map((i) => i.ownerCrewUserId))];
  const gMap = {}; const cMap = {};
  try {
    if (guestIds.length) {
      const { data } = await supabase.from('guests').select('id, photo').in('id', guestIds);
      (data || []).forEach((r) => { if (r.photo) gMap[r.id] = r.photo; });
    }
    if (crewIds.length) {
      const { data } = await supabase.from('profiles').select('id, avatar_url').in('id', crewIds);
      (data || []).forEach((r) => { if (r.avatar_url) cMap[r.id] = r.avatar_url; });
    }
  } catch (e) {
    // Best-effort — fall back to initials on any error.
    return list;
  }
  return list.map((i) => ({
    ...i,
    avatarUrl: i.ownerGuestId ? (gMap[i.ownerGuestId] || null) : (i.ownerCrewUserId ? (cMap[i.ownerCrewUserId] || null) : null),
  }));
}
