// Trip-days-remaining helper for /inventory/weekly.
//
// Async post-A3.1 — reads from the merged Supabase + localStorage trip
// list via tripStorage.loadTrips. Each call queries Supabase, which is
// cheap but not free; if you're batching across many guests, consider
// loadTrips once at the call site and pass the array down rather than
// calling this in a Promise.all loop.
//
// Returns null when:
//   - no trips for the tenant (fresh install / tests)
//   - guest isn't included in any trip
//   - matching trip has no endDate (open-ended trip)
//   - endDate can't be parsed
//
// Null is the "unknown" signal the Edge Function and assessLink treat
// as "par-only logic" — no projected-need math.

import { loadTrips } from '../../trips-management-dashboard/utils/tripStorage';

function tripIncludesGuest(trip, guestId) {
  if (!guestId) return false;
  // Newer shape: trip.guests: [{guestId, isActive, ...}]
  if (Array.isArray(trip?.guests)) {
    return trip.guests.some(g => g?.guestId === guestId);
  }
  // Legacy shape: trip.guestIds: [uuid, ...]
  if (Array.isArray(trip?.guestIds)) {
    return trip.guestIds.includes(guestId);
  }
  return false;
}

function startOfDayLocal(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Pure compute over a pre-loaded trips array. Exposed so callers
// batching across many guests can loadTrips once and pass it in.
export function tripDaysRemainingForGuestFromTrips(trips, guestId) {
  if (!Array.isArray(trips) || trips.length === 0) return null;

  const today = startOfDayLocal();

  const candidates = [];
  for (const t of trips) {
    if (!tripIncludesGuest(t, guestId)) continue;
    const end = t?.endDate ? new Date(t.endDate) : null;
    if (!end || Number.isNaN(end.getTime())) continue;
    const endDay = startOfDayLocal(end);
    if (endDay < today) continue; // trip is in the past
    candidates.push({ endDay, trip: t });
  }
  if (candidates.length === 0) return null;

  // Earliest-ending active trip is what the stew needs to plan around.
  candidates.sort((a, b) => a.endDay - b.endDay);
  const endDay = candidates[0].endDay;
  const days = Math.ceil((endDay - today) / 86_400_000);
  return Math.max(0, days);
}

// Single-guest convenience wrapper. Loads trips internally; safe for
// one-shot calls. For per-guest batches inside a hook/loop, prefer
// loadTrips() once + tripDaysRemainingForGuestFromTrips per guest.
export async function tripDaysRemainingForGuest(guestId) {
  try {
    const trips = await loadTrips();
    return tripDaysRemainingForGuestFromTrips(trips, guestId);
  } catch (err) {
    console.warn('[tripDaysRemainingForGuest] loadTrips failed:', err);
    return null;
  }
}
