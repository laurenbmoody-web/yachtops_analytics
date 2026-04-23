// Mood palette — 14 entries. Quick row (5) + full palette additions (9).
// Palette pruned from the original 20 in Phase 2: Off, Flirty, Reflective,
// Buzzy, Contemplative removed outright (vague / HR risk / no service
// implication / redundant); Private renamed to DND so the label is
// operationally clear ("do not disturb"). Playful kept — wasn't in the
// explicit prune list; flag for a follow-up pass if that was an oversight.
//
// Migration 20260421140000 syncs the DB moods table + rewrites any guest
// rows still carrying old mood keys.

export const ALL_MOODS = [
  // Quick row — always visible in drawer's top mood strip.
  { key: 'happy',       emoji: '🙂',  label: 'Happy' },
  { key: 'quiet',       emoji: '🤫',  label: 'Quiet' },
  { key: 'tired',       emoji: '😴',  label: 'Tired' },
  { key: 'dnd',         emoji: '🔕',  label: 'DND' },
  { key: 'celebrating', emoji: '🥂',  label: 'Celebrating' },
  // Full palette — revealed via "Full palette →" link.
  { key: 'playful',     emoji: '✨',  label: 'Playful' },
  { key: 'hungover',    emoji: '🥴',  label: 'Hungover' },
  { key: 'jetlagged',   emoji: '✈️', label: 'Jetlagged' },
  { key: 'grumpy',      emoji: '😤',  label: 'Grumpy' },
  { key: 'stressed',    emoji: '😰',  label: 'Stressed' },
  { key: 'social',      emoji: '🗣️', label: 'Social' },
  { key: 'unwell',      emoji: '🤒',  label: 'Unwell' },
  { key: 'relaxed',     emoji: '🏖️', label: 'Relaxed' },
  { key: 'focused',     emoji: '🎯',  label: 'Focused' },
  { key: 'seasick',     emoji: '🌊',  label: 'Seasick' },
];

export const QUICK_MOODS = ALL_MOODS.slice(0, 5);

// key → { emoji, label } lookup
export const MOOD_BY_KEY = Object.fromEntries(ALL_MOODS.map(m => [m.key, m]));
