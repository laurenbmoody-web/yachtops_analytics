// Shared uniform-size field metadata — the single source of truth for how crew
// uniform sizes are grouped, labelled and shown. Used by the crew-profile Issued
// Kit tab AND the Wardrobe management → Crew member view, so both read the same
// garments in the same order (don't redefine these per surface).

// Gender-aware sizing — men's/women's bottoms size differently (waist 30/32 vs
// dress 8/10, skorts, dresses), so a `fit` profile drives which garments show.
export const FIT_OPTIONS = [
  { id: 'womens', label: "Women's" },
  { id: 'mens', label: "Men's" },
  { id: 'unisex', label: 'Unisex' },
];
// Sizing region — the country system the recorded numbers/letters follow, so a
// "10" or "9" reads unambiguously (UK 10 ≠ US 10 ≠ EU 42).
export const REGION_OPTIONS = [
  { id: 'UK', label: 'UK' },
  { id: 'US', label: 'US' },
  { id: 'EU', label: 'EU' },
  { id: 'AU', label: 'AU' },
];
export const SIZE_FIELDS = [
  { key: 'top', label: 'Shirt / Polo', ph: 'XS–XXL', fits: 'all' },
  { key: 'trousers', label: 'Trousers', ph: "e.g. 32R or 10", fits: 'all' },
  { key: 'shorts', label: 'Shorts', ph: 'waist e.g. 32', fits: ['mens', 'unisex'] },
  { key: 'skort', label: 'Skort', ph: 'e.g. 8 / M', fits: ['womens'] },
  { key: 'dress', label: 'Dress', ph: 'e.g. 10', fits: ['womens'] },
  { key: 'rashVest', label: 'Rash vest', ph: 'XS–XXL', fits: 'all' },
  { key: 'boardshorts', label: 'Boardshorts', ph: 'waist / S–XL', fits: 'all' },
  { key: 'fleece', label: 'Fleece / Mid-layer', ph: 'XS–XXL', fits: 'all' },
  { key: 'jacket', label: 'Jacket / Outer', ph: 'XS–XXL', fits: 'all' },
  { key: 'foulies', label: 'Foul-weather gear', ph: 'S–XL', fits: 'all' },
  { key: 'belt', label: 'Belt', ph: 'waist / S–L', fits: 'all' },
  { key: 'cap', label: 'Cap / Hat', ph: 'S/M/L or one-size', fits: 'all' },
  { key: 'gloves', label: 'Gloves', ph: 'S–XL', fits: 'all' },
  { key: 'shoe', label: 'Shoe / Deck shoe', ph: 'number, e.g. 9', fits: 'all' },
];
export const FIELD_BY_KEY = SIZE_FIELDS.reduce((m, f) => { m[f.key] = f; return m; }, {});
// Editorial grouping for the ledger layout — garments ordered into the rows
// the crew member reads them in (core → active/layers → protection → footwear).
export const SIZE_GROUPS = [
  { label: 'Core', keys: ['top', 'trousers', 'shorts', 'skort', 'dress'] },
  { label: 'Active & layers', keys: ['rashVest', 'boardshorts', 'fleece', 'jacket'] },
  { label: 'Protection & accessories', keys: ['foulies', 'belt', 'cap', 'gloves'] },
  { label: 'Footwear', keys: ['shoe'] },
];
export const fieldVisible = (f, fit) => f.fits === 'all' || f.fits.includes(fit || 'unisex');
export const fitLabel = (id) => FIT_OPTIONS.find((o) => o.id === id)?.label;

// Map an item's name to a recorded size, so issuing "Crew polo" pre-fills the
// crew member's top size. First keyword match wins.
export const SIZE_KEYWORDS = [
  [/rash\s*vest|rashie|rash\s*guard/i, 'rashVest'],
  [/board\s*short/i, 'boardshorts'],
  [/skort/i, 'skort'],
  [/dress/i, 'dress'],
  [/short/i, 'shorts'],
  [/trouser|pant|chino|cargo/i, 'trousers'],
  [/polo|shirt|t-?shirt|tee|top|blouse/i, 'top'],
  [/jacket|coat|softshell|outer|gilet/i, 'jacket'],
  [/fleece|jumper|sweater|sweat|mid-?layer|hoodie/i, 'fleece'],
  [/foul|wet\s*weather|oilskin|waterproof/i, 'foulies'],
  [/belt/i, 'belt'],
  [/glove/i, 'gloves'],
  [/cap|hat|beanie|visor/i, 'cap'],
  [/shoe|boot|deck\s*shoe|trainer|sandal|flip/i, 'shoe'],
];
export const sizeKeyFor = (name) => {
  if (!name) return '';
  for (const [re, key] of SIZE_KEYWORDS) if (re.test(name)) return key;
  return '';
};
export const suggestSize = (name, sizes) => {
  const k = sizeKeyFor(name);
  return k && sizes?.[k] ? sizes[k] : '';
};

// The crew member's recorded sex defaults the sizing profile.
export const sexToFit = (sex) => (sex === 'Female' ? 'womens' : sex === 'Male' ? 'mens' : '');
