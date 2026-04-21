// Service-moment wheel for the pantry drawer's RIGHT NOW strip.
//
// 5 moments covering a 24h day. Any time of day maps to exactly one moment.
// Moment windows are deliberately different from ServicePresetPicker.jsx's
// preset-card cutoffs — don't unify them. The preset picker tracks the next
// service preset (breakfast/lunch/dinner/drinks/turndown), which has a
// 'drinks' slot; the drawer tracks crew-readiness moments, which has an
// 'afternoon' slot instead.
//
// TODO(phase-2): swap `new Date()` for a vessel-local time helper. Today the
// moment is computed in browser local time, which is close enough for Med
// operation but will drift if the crew's browser is set to a different tz
// than the vessel.

export const SERVICE_MOMENTS = {
  BREAKFAST: 'breakfast',
  LUNCH:     'lunch',
  AFTERNOON: 'afternoon',
  DINNER:    'dinner',
  TURNDOWN:  'turndown',
};

export const MOMENT_LABELS = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  afternoon: 'Afternoon',
  dinner:    'Dinner',
  turndown:  'Turndown',
};

// Which DAILY ROUTINE anchor key to surface as "NEXT KEY TIME" in the strip
// header. Afternoon has no natural anchor — the strip omits the time there.
export const MOMENT_NEXT_ANCHOR_KEY = {
  breakfast: 'Breakfast Time',
  lunch:     'Lunch Time',
  afternoon: null,
  dinner:    'Dinner Time',
  turndown:  'Bed Time',
};

// Maps a 24h hour (0-23) to a moment. 11:00 is lunch, 15:00 is afternoon,
// 18:00 is dinner, 22:00 is turndown, 06:00 is breakfast. Hours before 06:00
// wrap into turndown.
export function momentForHour(hour) {
  if (hour >= 6  && hour < 11) return SERVICE_MOMENTS.BREAKFAST;
  if (hour >= 11 && hour < 15) return SERVICE_MOMENTS.LUNCH;
  if (hour >= 15 && hour < 18) return SERVICE_MOMENTS.AFTERNOON;
  if (hour >= 18 && hour < 22) return SERVICE_MOMENTS.DINNER;
  return SERVICE_MOMENTS.TURNDOWN;
}

export function getCurrentServiceMoment(now = new Date()) {
  return momentForHour(now.getHours());
}

// Apply drawer overrides per spec §edge cases:
// - Guest ashore → no RIGHT NOW (caller suppresses strip entirely; we still
//   return the nominal moment so the rest of the drawer can render).
// - Guest asleep AND current moment is Turndown or Breakfast → force Turndown.
//   ("Current time is Breakfast or earlier" — earlier than Breakfast in the
//   day cycle is Turndown; asleep past Lunch isn't the intended case.)
export function resolveEffectiveMoment({ moment, guestState }) {
  if (guestState === 'asleep' && (moment === SERVICE_MOMENTS.TURNDOWN || moment === SERVICE_MOMENTS.BREAKFAST)) {
    return SERVICE_MOMENTS.TURNDOWN;
  }
  return moment;
}

// Given the effective moment and the guest's DAILY ROUTINE anchors, return
// the next-key-time string (e.g. "20:00") for the strip header. Null when
// the moment has no anchor or the guest hasn't set one.
export function nextKeyTimeForMoment(moment, routineAnchors) {
  const key = MOMENT_NEXT_ANCHOR_KEY[moment];
  if (!key || !Array.isArray(routineAnchors)) return null;
  const hit = routineAnchors.find(a => a.label === key);
  return hit?.time ?? null;
}
