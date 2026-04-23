// Vessel-local time helper.
//
// Every crew member using the pantry is physically on the vessel, so their
// browser's resolved timezone is our proxy for "vessel time". That's good
// enough for v1 — writes that need a per-day scope (guest_day_notes.note_date)
// stop bugging out when a stew adds a note at 23:30 Palma time (UTC+2) and
// the old UTC-derived day string had already rolled over.
//
// TODO: support an explicit vessel timezone override per tenant. A vessel
// that travels across timezones might want to pin day scope to the last
// anchored timezone until the crew confirms a switch. For now, browser
// resolution is the single source.

function vesselTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// "YYYY-MM-DD" for the given instant in the vessel-local timezone.
// Uses en-CA (ISO-style date output) to sidestep locale-dependent
// formatting differences.
export function vesselLocalDate(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: vesselTimeZone(),
  });
  return fmt.format(date);
}

// Minutes-since-midnight in vessel-local time (0-1439). Used by
// serviceMoment.js to pick the current service window, and by
// DailyRoutineTimeline to pick the five anchors closest to now when the
// guest has more than six.
export function currentMinuteOfDay(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: vesselTimeZone(),
  });
  let h = 0, m = 0;
  for (const part of fmt.formatToParts(date)) {
    if (part.type === 'hour')   h = parseInt(part.value, 10);
    if (part.type === 'minute') m = parseInt(part.value, 10);
  }
  // In some locales 24 can appear as the midnight hour; clamp defensively.
  if (Number.isFinite(h) && h === 24) h = 0;
  return (h * 60) + (Number.isFinite(m) ? m : 0);
}

// Full ISO timestamp. A plain `new Date().toISOString()` preserves the
// actual UTC instant (which is what timestamptz stores anyway). Exposed
// here so callers have one place to import from and future timezone
// pinning can swap the instant source without hunting call sites.
export function vesselLocalDateTime(date = new Date()) {
  return date.toISOString();
}
