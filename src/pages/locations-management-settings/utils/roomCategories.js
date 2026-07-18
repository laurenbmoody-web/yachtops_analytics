// Deck-plan room categories — a small zoning taxonomy so rooms colour-code on
// the plan by what they are. Each room gets a category (crew override wins, else
// inferred from its name), and the plan draws its outline + a translucent fill in
// that category's colour. Muted tones to sit with the Cargo editorial palette.

export const CATEGORIES = [
  { id: 'guest',     label: 'Guest',     color: '#3C7A5A' },
  { id: 'owner',     label: 'Owner',     color: '#7E5AA0' },
  { id: 'crew',      label: 'Crew',      color: '#3B6EA5' },
  { id: 'service',   label: 'Service',   color: '#C08A2E' },
  { id: 'technical', label: 'Technical', color: '#B04A3A' },
  { id: 'bridge',    label: 'Bridge',    color: '#4A4A80' },
  { id: 'exterior',  label: 'Exterior',  color: '#2E9098' },
  { id: 'other',     label: 'Other',     color: '#6B7280' },
];

export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const categoryColor = (id) => (CATEGORY[id] || CATEGORY.other).color;

// Translucent fill for the zone shading.
export const categoryFill = (id, alpha = 0.16) => {
  const hex = categoryColor(id).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Name → category. First matching group wins, ordered most- to least-specific
// (so "crew cabin" → crew and "owner's cabin" → owner before generic "cabin").
const MATCHERS = [
  ['bridge',    ['wheelhouse', 'bridge', 'helm', 'nav ', 'navigation']],
  ['technical', ['engine', 'technical', 'machinery', 'ecr', 'lazarette', 'generator', 'pump', 'switchboard', 'workshop', 'garage', 'tender', 'mooring', 'tech space', 'plant', 'aircon', 'a/c']],
  ['owner',     ['owner', 'master', 'vip']],
  ['crew',      ['crew', 'bosun', 'officer', 'captain', 'chief', 'mess', 'office']],
  ['service',   ['galley', 'pantry', 'laundry', 'provision', 'cold room', 'fridge', 'freezer', 'scullery', 'store', 'storage', 'dry store', 'wine']],
  ['exterior',  ['deck', 'balcony', 'terrace', 'beach', 'sun', 'cockpit', 'ext area', 'ext.area', 'exterior', 'swim', 'jacuzzi', 'pool', 'jetski', 'aft ext', 'flybridge']],
  ['guest',     ['guest', 'saloon', 'salon', 'lounge', 'dining', 'lobby', 'day head', 'head', 'bath', 'spa', 'gym', 'cinema', 'cabin', 'stateroom', 'hamman', 'hammam']],
];

export const inferCategory = (name) => {
  const n = (name || '').toLowerCase();
  for (const [id, keys] of MATCHERS) {
    if (keys.some((k) => n.includes(k))) return id;
  }
  return 'other';
};
