export const ALL_MOODS = [
  { key: 'happy',         emoji: '🙂',  label: 'Happy' },
  { key: 'quiet',         emoji: '🤫',  label: 'Quiet' },
  { key: 'tired',         emoji: '😴',  label: 'Tired' },
  { key: 'celebrating',   emoji: '🥂',  label: 'Celebrating' },
  { key: 'off',           emoji: '🌀',  label: 'Off' },
  { key: 'playful',       emoji: '✨',  label: 'Playful' },
  { key: 'reflective',    emoji: '📖',  label: 'Reflective' },
  { key: 'flirty',        emoji: '💅',  label: 'Flirty' },
  { key: 'hungover',      emoji: '🥴',  label: 'Hungover' },
  { key: 'jetlagged',     emoji: '✈️', label: 'Jetlagged' },
  { key: 'grumpy',        emoji: '😤',  label: 'Grumpy' },
  { key: 'stressed',      emoji: '😰',  label: 'Stressed' },
  { key: 'social',        emoji: '🗣️', label: 'Social' },
  { key: 'private',       emoji: '🔕',  label: 'Private' },
  { key: 'unwell',        emoji: '🤒',  label: 'Unwell' },
  { key: 'relaxed',       emoji: '🏖️', label: 'Relaxed' },
  { key: 'focused',       emoji: '🎯',  label: 'Focused' },
  { key: 'contemplative', emoji: '💭',  label: 'Contemplative' },
  { key: 'seasick',       emoji: '🌊',  label: 'Seasick' },
  { key: 'buzzy',         emoji: '🎉',  label: 'Buzzy' },
];

export const QUICK_MOODS = ALL_MOODS.slice(0, 5);

// key → { emoji, label } lookup
export const MOOD_BY_KEY = Object.fromEntries(ALL_MOODS.map(m => [m.key, m]));
