// Shared catalogue vocabulary — used by the supplier portal (product
// editor, import review), the AI import edge function (kept in sync by
// hand — Deno can't import from src/), and the vessel marketplace.
//
// Categories are OPEN: this list is suggestions, not a constraint.
// A supplier can type any category they like; custom categories flow
// through chips, filters and the marketplace automatically because
// those all derive from the data. The standard list exists so common
// categories converge on the same spelling.

export const STANDARD_CATEGORIES = [
  // Food & beverage
  'Produce', 'Meat & Fish', 'Dairy', 'Bakery', 'Dry Goods', 'Frozen',
  'Snacks & Confectionery', 'Beverages', 'Alcohol & Wine',
  // Wider yacht supply verticals
  'Cleaning', 'Interior & Guest Supplies', 'Flowers & Decor',
  'Deck & Exterior', 'Engineering & Spares', 'Safety & Medical',
  'Water Sports & Toys', 'Uniform & Crew Wear', 'IT & Electronics',
  'Other',
];

export const UNIT_SUGGESTIONS = [
  'each', 'kg', 'g', 'L', 'ml', 'case', 'box', 'bottle', 'pack', 'roll',
  'tin', 'jar', 'bag', 'tray', 'piece', 'set', 'pair', 'drum', 'tube', 'kit', 'metre',
];

const KNOWN_HUES = {
  'Produce': '#4E8A3E', 'Meat & Fish': '#A5484F', 'Dairy': '#C99A2C',
  'Bakery': '#B07A3C', 'Beverages': '#3B6CB4', 'Alcohol & Wine': '#7B3F63',
  'Dry Goods': '#8A6D4B', 'Frozen': '#4E93A6', 'Snacks & Confectionery': '#C4763C',
  'Cleaning': '#6D57A5', 'Interior & Guest Supplies': '#9A6A8F', 'Flowers & Decor': '#C25E7B',
  'Deck & Exterior': '#4A7186', 'Engineering & Spares': '#5C6670', 'Safety & Medical': '#B0372B',
  'Water Sports & Toys': '#2E8B9A', 'Uniform & Crew Wear': '#556B8A', 'IT & Electronics': '#46628F',
  'Other': '#64748B',
};

// Deterministic hue for ANY category — known ones use the curated
// palette; custom ones hash to a stable muted HSL so tiles stay
// consistent between renders and pages.
export const categoryHue = (category) => {
  const c = (category || 'Other').trim();
  if (KNOWN_HUES[c]) return KNOWN_HUES[c];
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360;
  return `hsl(${h} 32% 46%)`;
};

// Order categories for chip rows: standard order first, then custom
// categories alphabetically.
export const orderCategories = (keys) => {
  const std = STANDARD_CATEGORIES.filter(c => keys.includes(c));
  const custom = keys.filter(k => !STANDARD_CATEGORIES.includes(k)).sort();
  return [...std, ...custom];
};
