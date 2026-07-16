// Attach owner avatar images to laundry items — guests carry a `photo`,
// crew a `profiles.avatar_url`. Both are tenant-scoped by RLS.

import { supabase } from '../../../lib/supabaseClient';

export async function enrichWithAvatars(items) {
  const list = items || [];
  const guestIds = [...new Set(list.filter((i) => i.ownerGuestId).map((i) => i.ownerGuestId))];
  const crewIds = [...new Set(list.filter((i) => i.ownerCrewUserId).map((i) => i.ownerCrewUserId))];
  const gMap = {}; const cMap = {};
  // guest.photo is sometimes a plain URL, sometimes an object like { dataUrl }
  const photoUrl = (p) => (typeof p === 'string' ? p : (p?.dataUrl || p?.url || null));
  try {
    if (guestIds.length) {
      const { data } = await supabase.from('guests').select('id, photo').in('id', guestIds);
      (data || []).forEach((r) => { const u = photoUrl(r.photo); if (u) gMap[r.id] = u; });
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

// Attach the crew member who took each piece to "delivered": handledById /
// handledByName (from the delivery-credits map) + handlerAvatarUrl (profiles).
export async function attachHandlers(items, credits) {
  const list = items || [];
  const withCredit = list.map((i) => {
    const c = credits?.[i.id];
    return c ? { ...i, handledById: c.actorId, handledByName: c.actorName } : i;
  });
  const ids = [...new Set(withCredit.filter((i) => i.handledById).map((i) => i.handledById))];
  if (!ids.length) return withCredit;
  const map = {};
  try {
    const { data } = await supabase.from('profiles').select('id, avatar_url, full_name').in('id', ids);
    (data || []).forEach((r) => { map[r.id] = { avatar: r.avatar_url || null, name: r.full_name || null }; });
  } catch (e) {
    return withCredit;
  }
  return withCredit.map((i) => (i.handledById ? {
    ...i,
    handlerAvatarUrl: map[i.handledById]?.avatar || null,
    handledByName: i.handledByName || map[i.handledById]?.name || null,
  } : i));
}
