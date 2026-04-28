// Trip-days-remaining helper for /inventory/weekly.
//
// Trips live in localStorage (see trips-management-dashboard/utils/
// tripStorage.js) — no server-side trips table. This helper reads
// cargo.trips.v1, finds the trip(s) that include the given guest, and
// returns days remaining against the earliest-ending active trip.
//
// Returns null when:
//   - no localStorage entry (fresh install / tests)
//   - guest isn't included in any trip
//   - matching trip has no endDate (open-ended trip)
//   - endDate can't be parsed
//
// Null is the "unknown" signal the Edge Function and assessLink treat
// as "par-only logic" — no projected-need math.

const TRIPS_KEY = 'cargo.trips.v1';

function readTripsFromStorage() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TRIPS_KEY);
    return raw ? (JSON.parse(raw) ?? []) : [];
  } catch {
    return [];
  }
}

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

export function tripDaysRemainingForGuest(guestId) {
  const trips = readTripsFromStorage();
  if (!Array.isArray(trips) || trips.length === 0) return null;

  const today = startOfDayLocal();

  // Candidate trips: include the guest, have an end date >= today.
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
