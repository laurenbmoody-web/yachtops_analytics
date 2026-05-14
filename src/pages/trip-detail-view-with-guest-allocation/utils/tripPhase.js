// Shared utilities for the trip detail page — Phase 2 sections.
//
// Phase computation collapses the existing TripStatus + dates onto the
// four editorial phases used by the redesign (Planning / Aboard /
// Settling / Archived). There is no explicit "Archived" status in the
// trip data model yet — completed trips fall into Settling for 14 days
// after end-date, then move to Archived.

const SETTLING_WINDOW_DAYS = 14;

export const TRIP_PHASE = {
  PLANNING: 'planning',
  ABOARD:   'aboard',
  SETTLING: 'settling',
  ARCHIVED: 'archived',
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export function computeTripPhase(trip, now = new Date()) {
  if (!trip) return TRIP_PHASE.PLANNING;
  const today = startOfDay(now);
  const start = trip.startDate ? startOfDay(trip.startDate) : null;
  const end   = trip.endDate   ? startOfDay(trip.endDate)   : null;

  if (start && today < start) return TRIP_PHASE.PLANNING;
  if (start && end && today >= start && today <= end) return TRIP_PHASE.ABOARD;
  if (end) {
    const daysSinceEnd = Math.floor((today - end) / (1000 * 60 * 60 * 24));
    if (daysSinceEnd <= SETTLING_WINDOW_DAYS) return TRIP_PHASE.SETTLING;
    return TRIP_PHASE.ARCHIVED;
  }
  return TRIP_PHASE.PLANNING;
}

export function tripTypeQualifier(tripType) {
  const t = (tripType || '').toLowerCase();
  if (t === 'charter')               return 'a charter';
  if (t === 'owner')                 return 'an owner trip';
  if (t === 'friends/family')        return 'a visit';
  return 'a visit';
}

// Pull the principal/family name to lead the headline. Trip.name is the
// human-given title (e.g. "Marchetti charter"); we strip the trailing
// type word if it's there so the headline reads "MARCHETTI, a charter."
// rather than "MARCHETTI CHARTER, a charter."
export function principalName(trip) {
  const raw = (trip?.name || '').trim();
  if (!raw) return 'Trip';
  const stripped = raw
    .replace(/\b(charter|owner|trip|visit|family|friends)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Fall back to the original name when stripping leaves nothing
  // recognisable as a principal — empty, or starts with lowercase
  // (e.g. "Family viewing" → "viewing"). Better an unstripped headline
  // than one that reads ", a visit."
  if (!stripped) return raw;
  if (/^[a-z]/.test(stripped)) return raw;
  return stripped;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RELATIVE_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function shortDayDate(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${DAY_LABELS[x.getDay()]} ${x.getDate()} ${MONTH_LABELS[x.getMonth()]}`;
}

export function shortDayOnly(d) {
  const x = new Date(d);
  return `${DAY_LABELS[x.getDay()]} ${x.getDate()}`;
}

export function capsDate(d) {
  const x = new Date(d);
  return `${DAY_LABELS[x.getDay()]} ${x.getDate()} ${MONTH_LABELS[x.getMonth()]}`;
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / (1000 * 60 * 60 * 24));
}

export function relativeDayLabel(d, today = new Date()) {
  const diff = daysBetween(today, d);
  if (diff === 0)  return 'Today';
  if (diff === 1)  return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return RELATIVE_DAY[new Date(d).getDay()];
  return shortDayOnly(d);
}

// Build the meta strip segments for the SectionHeader. Composition
// depends on phase — meta entries differ for Planning vs Aboard vs
// Settling vs Archived.
export function buildHeaderMeta({ trip, phase, location, dayOfTrip, totalDays }) {
  const segments = [];
  if (location) {
    segments.push({ icon: 'MapPin', label: location });
  }
  const typeLabel = (trip?.tripType || 'Trip');
  if (phase === TRIP_PHASE.ABOARD && dayOfTrip && totalDays) {
    segments.push({ label: `${typeLabel} · Day ${dayOfTrip} of ${totalDays}` });
  } else {
    segments.push({ label: typeLabel });
  }
  if (trip?.startDate && trip?.endDate) {
    segments.push({ label: dateRangeLabel(trip.startDate, trip.endDate), muted: true });
  }
  segments.push({ label: phaseLabel(phase), muted: true });
  return segments;
}

export function phaseLabel(phase) {
  if (phase === TRIP_PHASE.PLANNING) return 'Planning';
  if (phase === TRIP_PHASE.ABOARD)   return 'Aboard';
  if (phase === TRIP_PHASE.SETTLING) return 'Settling';
  if (phase === TRIP_PHASE.ARCHIVED) return 'Archived';
  return '';
}

function dateRangeLabel(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const sm = MONTH_LABELS[s.getMonth()];
  const em = MONTH_LABELS[e.getMonth()];
  if (sm === em) return `${s.getDate()} — ${e.getDate()} ${em}`;
  return `${s.getDate()} ${sm} — ${e.getDate()} ${em}`;
}

export function dayOfTrip(trip, now = new Date()) {
  if (!trip?.startDate) return null;
  const diff = daysBetween(trip.startDate, now) + 1;
  if (diff < 1) return null;
  return diff;
}

export function totalTripDays(trip) {
  if (!trip?.startDate || !trip?.endDate) return null;
  return daysBetween(trip.startDate, trip.endDate) + 1;
}

export function sameDay(a, b) {
  if (!a || !b) return false;
  const x = startOfDay(a);
  const y = startOfDay(b);
  return x.getTime() === y.getTime();
}
