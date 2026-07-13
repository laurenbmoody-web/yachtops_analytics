// THE canonical unit taxonomy for the whole app. Based on the provisioning
// drawer / receive vocabulary (the richest, grouped list) and now shared by
// inventory, the vessel-map item drawer, the provisioning board grid, CSV
// import and the supplier portal — so a unit means the same thing everywhere.
// Size = the number ("750ml", "5"); Unit = something from this list.
//
// Group order (Weight / Volume / Count / Length / Other) is stable so the
// dropdown muscle-memory works across every surface.
export const UNIT_GROUPS = [
  { label: 'Weight',  options: ['g', 'kg', 'oz', 'lb', 'catch weight'] },
  { label: 'Volume',  options: ['ml', 'l', 'fl oz', 'cup', 'tsp', 'tbsp'] },
  { label: 'Count',   options: ['each', 'piece', 'pair', 'set', 'box', 'pack', 'case', 'carton', 'dozen'] },
  { label: 'Length',  options: ['cm', 'm', 'ft', 'inch'] },
  { label: 'Other',   options: ['portion', 'serving', 'sheet', 'roll', 'sachet', 'tube', 'bottle', 'can', 'jar', 'tin', 'bag'] },
];

export const UNIT_GROUP_VALUES = new Set(UNIT_GROUPS.flatMap((g) => g.options));

// Legacy spellings → canonical value. Historically inventory used "litre" and
// the catalogue used "L" for the same unit UNIT_GROUPS calls "l". Normalising
// on read means old records resolve to the right dropdown option instead of
// showing a value the <select> doesn't contain. Unknown values (genuine custom
// units) pass through untouched.
const UNIT_ALIASES = {
  // litre spellings
  litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  // piece
  pcs: 'piece', pc: 'piece', ea: 'each',
  // common plurals / synonyms (mostly for forgiving CSV import + free text)
  bottles: 'bottle', boxes: 'box', cases: 'case', packs: 'pack', cans: 'can',
  jars: 'jar', tins: 'tin', bags: 'bag', sets: 'set', pairs: 'pair', rolls: 'roll',
  tubes: 'tube', sachets: 'sachet', cartons: 'carton', dozens: 'dozen',
  portions: 'portion', servings: 'serving', sheets: 'sheet', cups: 'cup',
  // weight / volume word forms
  gram: 'g', grams: 'g', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  lbs: 'lb', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz',
  // length word forms
  metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  inches: 'inch', feet: 'ft', foot: 'ft',
};

export function normalizeUnit(v) {
  if (v === null || v === undefined || v === '') return v;
  const low = String(v).trim().toLowerCase();
  if (UNIT_GROUP_VALUES.has(low)) return low;
  if (UNIT_ALIASES[low]) return UNIT_ALIASES[low];
  return String(v).trim();
}

// True when the (normalised) value is one of our known units.
export const isKnownUnit = (v) => UNIT_GROUP_VALUES.has(normalizeUnit(v));
