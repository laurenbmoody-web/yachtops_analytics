import React, { useMemo } from 'react';
import Icon from '../../../components/AppIcon';

// ─── Tag → Section fallback mapping ──────────────────────────────────────────
const TAG_SECTION_MAP = {
  coffee: 'morning',
  breakfast: 'morning',
  'wake-up': 'morning',
  'wake up': 'morning',
  wake: 'morning',
  morning: 'morning',
  snack: 'afternoon',
  activity: 'afternoon',
  excursion: 'afternoon',
  swim: 'afternoon',
  gym: 'morning',
  sport: 'afternoon',
  lunch: 'midday',
  midday: 'midday',
  cocktail: 'evening',
  wine: 'evening',
  spirit: 'evening',
  aperitif: 'evening',
  sundowner: 'evening',
  dinner: 'evening',
  evening: 'evening',
  'evening drink': 'evening',
  tea: 'night',
  'turn-down': 'night',
  turndown: 'night',
  sleep: 'night',
  'late night': 'night',
  'late-night': 'night',
  'bed time': 'night',
  bed: 'night',
  night: 'night',
};

// ─── Key → time field mapping (for wizard-stored times) ──────────────────────
// These are keys that the wizard stores with a time value in the `value` field
const TIME_KEY_PATTERNS = [
  { pattern: /breakfast/i, section: 'morning' },
  { pattern: /wake/i, section: 'morning' },
  { pattern: /coffee/i, section: 'morning' },
  { pattern: /gym/i, section: 'morning' },
  { pattern: /lunch/i, section: 'midday' },
  { pattern: /swim/i, section: 'midday' },
  { pattern: /snack/i, section: 'afternoon' },
  { pattern: /activity|excursion|sport/i, section: 'afternoon' },
  { pattern: /cocktail|aperitif|sundowner/i, section: 'evening' },
  { pattern: /dinner/i, section: 'evening' },
  { pattern: /wine|spirit/i, section: 'evening' },
  { pattern: /tea/i, section: 'night' },
  { pattern: /turn.?down/i, section: 'night' },
  { pattern: /sleep|bed/i, section: 'night' },
];

const SECTIONS = [
  { key: 'morning', label: 'Morning', icon: 'Sunrise' },
  { key: 'midday', label: 'Midday', icon: 'Sun' },
  { key: 'afternoon', label: 'Afternoon', icon: 'CloudSun' },
  { key: 'evening', label: 'Evening', icon: 'Sunset' },
  { key: 'night', label: 'Night', icon: 'Moon' },
];

// ─── Parse a time string like "08:00", "8:00 AM", "8am" → "HH:MM" or null ───
const parseTime = (str) => {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str?.trim();

  // Match HH:MM or H:MM (24h)
  const match24 = trimmed?.match(/^(\d{1,2}):(\d{2})/);
  if (match24) {
    let h = parseInt(match24?.[1], 10);
    const m = parseInt(match24?.[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h)?.padStart(2, '0')}:${String(m)?.padStart(2, '0')}`;
    }
  }

  // Match "8am", "8 AM", "8:30am"
  const matchAmPm = trimmed?.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (matchAmPm) {
    let h = parseInt(matchAmPm?.[1], 10);
    const m = matchAmPm?.[2] ? parseInt(matchAmPm?.[2], 10) : 0;
    const period = matchAmPm?.[3]?.toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h)?.padStart(2, '0')}:${String(m)?.padStart(2, '0')}`;
    }
  }

  return null;
};

// ─── Determine which section a preference belongs to ─────────────────────────
const getSectionForPref = (pref) => {
  // 1. Use time_of_day if set
  if (pref?.timeOfDay) {
    const tod = pref?.timeOfDay?.toLowerCase();
    if (['morning', 'midday', 'afternoon', 'evening', 'night']?.includes(tod)) return tod;
  }

  // 2. Check tags against TAG_SECTION_MAP
  const tags = pref?.tags || [];
  for (const tag of tags) {
    const mapped = TAG_SECTION_MAP?.[tag?.toLowerCase()];
    if (mapped) return mapped;
  }

  // 3. Check key against TIME_KEY_PATTERNS
  const key = pref?.key || '';
  for (const { pattern, section } of TIME_KEY_PATTERNS) {
    if (pattern?.test(key)) return section;
  }

  return null; // can't place it
};

// ─── Extract a real time from a preference ───────────────────────────────────
// Only returns a time if the value field contains a parseable time string
const getTimeFromPref = (pref) => {
  // Check value field for a time
  const valueTime = parseTime(pref?.value);
  if (valueTime) return valueTime;

  // Check key for embedded time (e.g. "Breakfast at 08:00")
  const keyTime = parseTime(pref?.key);
  if (keyTime) return keyTime;

  return null;
};

// ─── Build the snapshot from preferences ─────────────────────────────────────
const buildSnapshot = (preferences) => {
  const sections = {
    morning: { timed: [], untimed: [] },
    midday: { timed: [], untimed: [] },
    afternoon: { timed: [], untimed: [] },
    evening: { timed: [], untimed: [] },
    night: { timed: [], untimed: [] },
  };

  // Exclude avoid items and allergies/medical
  const eligible = (preferences || [])?.filter(
    (p) =>
      p?.prefType !== 'avoid' &&
      p?.category !== 'Allergies' &&
      p?.category !== 'Dietary'
  );

  for (const pref of eligible) {
    const section = getSectionForPref(pref);
    if (!section) continue;

    const time = getTimeFromPref(pref);
    const item = {
      id: pref?.id,
      label: pref?.key,
      subtitle: pref?.value && !parseTime(pref?.value) ? pref?.value : null,
      time,
    };

    if (time) {
      sections?.[section]?.timed?.push(item);
    } else {
      sections?.[section]?.untimed?.push(item);
    }
  }

  // Sort timed items chronologically within each section
  for (const sec of Object.values(sections)) {
    sec?.timed?.sort((a, b) => (a?.time > b?.time ? 1 : -1));
  }

  return sections;
};

// ─── Component ────────────────────────────────────────────────────────────────
const AverageDayModal = ({ isOpen, onClose, preferences, guestName }) => {
  const snapshot = useMemo(() => buildSnapshot(preferences), [preferences]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="CalendarDays" size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Average Day</h2>
              {guestName && (
                <p className="text-xs text-muted-foreground">{guestName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Read-only badge */}
        <div className="px-6 pt-3 pb-0 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            <Icon name="Eye" size={11} />
            Read-only snapshot from saved preferences
          </span>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {SECTIONS?.map((sec) => {
            const data = snapshot?.[sec?.key];
            const hasItems = data?.timed?.length > 0 || data?.untimed?.length > 0;

            return (
              <div key={sec?.key}>
                {/* Section heading */}
                <div className="flex items-center gap-2 mb-2">
                  <Icon name={sec?.icon} size={14} className="text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {sec?.label}
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {!hasItems ? (
                  <p className="text-xs text-muted-foreground italic pl-1">Nothing recorded</p>
                ) : (
                  <div className="space-y-1.5">
                    {/* Timed items first */}
                    {data?.timed?.map((item) => (
                      <div key={item?.id} className="flex items-start gap-3">
                        <span className="text-xs font-mono font-semibold text-foreground w-11 flex-shrink-0 pt-0.5">
                          {item?.time}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground leading-snug">{item?.label}</p>
                          {item?.subtitle && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item?.subtitle}</p>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Untimed items */}
                    {data?.untimed?.map((item) => (
                      <div key={item?.id} className="flex items-start gap-3">
                        <span className="w-11 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground leading-snug">{item?.label}</p>
                          {item?.subtitle && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item?.subtitle}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium text-foreground transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AverageDayModal;
