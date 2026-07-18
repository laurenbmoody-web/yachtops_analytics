// Supplier-portal invoicing helpers.
//
// The country tax preset registry lives at src/data/countryTaxPresets.ts and
// is consumed only on the client. The edge function takes pre-resolved
// rates per line; this module is what does the resolution.

import { getCountryTaxPreset } from '../../../data/countryTaxPresets';

/**
 * Compute the supplier's effective tax categories: country preset filtered
 * by what they've enabled, with their per-category rate overrides applied,
 * plus any custom categories they've added.
 *
 * Returns: Array<{ key, label, rate, source: 'preset' | 'custom' }>
 */
export function getEffectiveCategoriesForSupplier(supplier) {
  if (!supplier) return [];

  const overrides = supplier.vat_categories_overrides || {};
  const custom = Array.isArray(supplier.vat_categories_custom) ? supplier.vat_categories_custom : [];

  const preset = getCountryTaxPreset(supplier.business_country);
  const presetCategories = preset?.categories || [];

  // Default: a supplier who has NOT configured categories (null/undefined) gets
  // the full country preset switched on, so items auto-categorise (Food 5.5%,
  // Alcohol, etc.) out of the box instead of everything falling to Standard.
  // An explicit [] means "deliberately none" and is respected.
  const rawEnabled = supplier.vat_categories_enabled;
  const enabledKeys = Array.isArray(rawEnabled)
    ? new Set(rawEnabled)
    : new Set(presetCategories.map((c) => c.key));

  // Preset categories the supplier has switched on.
  const fromPreset = presetCategories
    .filter((c) => enabledKeys.has(c.key))
    .map((c) => ({
      key: c.key,
      label: c.labelEn || c.label,
      rate: overrides[c.key] != null && overrides[c.key] !== ''
        ? Number(overrides[c.key])
        : Number(c.rate),
      source: 'preset',
    }));

  // Supplier-defined custom categories.
  const fromCustom = custom
    .filter((c) => c && c.key && c.label)
    .map((c) => ({
      key: c.key,
      label: c.label,
      rate: Number(c.rate) || 0,
      source: 'custom',
    }));

  return [...fromPreset, ...fromCustom];
}

/**
 * Look up a single category's effective rate. Returns null if not found.
 */
export function getEffectiveRate(supplier, categoryKey) {
  const cats = getEffectiveCategoriesForSupplier(supplier);
  const found = cats.find((c) => c.key === categoryKey);
  return found ? found.rate : null;
}

/**
 * Country tax-system label (TVA / IVA / GST etc.) for the invoice header.
 * Falls back to "VAT" if no preset.
 */
export function getTaxNameForSupplier(supplier) {
  const preset = getCountryTaxPreset(supplier?.business_country);
  return preset?.taxName || 'VAT';
}

/**
 * Heuristic: pick the best-fit category for an item given its name. Keeps
 * the modal usable on first open without forcing the supplier to set a
 * category for every line. Easy to swap for a smarter version (or schema
 * field) later.
 */
// A catalogue product's own category (free-text, Title-Case suggestions from
// catalogueConstants) → VAT category key. This is a far more reliable signal
// than guessing from the item name (brand names like "Veuve Clicquot" carry no
// keyword). Keyed lower-case; anything not listed falls through to the name
// heuristic / standard.
const CATALOGUE_CATEGORY_TO_VAT = {
  'alcohol & wine': 'alcohol',
  'beverages': 'non_alcoholic',
  'produce': 'food',
  'meat & fish': 'food',
  'dairy': 'food',
  'bakery': 'food',
  'dry goods': 'food',
  'frozen': 'food',
  'snacks & confectionery': 'food',
};

export function suggestCategoryForItem(item, categories) {
  if (!categories || categories.length === 0) return null;
  const has = (k) => categories.some((c) => c.key === k);

  // Most reliable: the catalogue product's category (set once on the product),
  // when the order line came from a catalogue item and the supplier has that
  // VAT category enabled.
  const catCat = String(item?.catalogue_item?.category || '').trim().toLowerCase();
  if (catCat) {
    const mapped = CATALOGUE_CATEGORY_TO_VAT[catCat];
    if (mapped && has(mapped)) return mapped;
  }

  const name = String(item?.item_name || '').toLowerCase();
  // NB: no generic 'bottle' keyword here — it misfires on water/soft-drink
  // bottles (and alcohol is checked before non_alcoholic).
  if (has('alcohol')      && /(wine|champagne|prosecco|magnum|spirit|gin|vodka|whisky|whiskey|rum|tequila|brandy|cognac|liqueur|beer|lager|ale|aperol|vermouth|sake)/i.test(name)) return 'alcohol';
  if (has('non_alcoholic') && /(juice|water|soda|lemonade|coke|tonic|mixer|soft drink)/i.test(name)) return 'non_alcoholic';
  if (has('food_prepared') && /(prepared|cooked|catered|hot|takeaway|ready|meal)/i.test(name)) return 'food_prepared';
  if (has('food')         && /(beef|wagyu|lamb|pork|fish|tuna|salmon|prawn|lobster|cheese|fruit|veg|salad|bread|pastry|grocery|produce|meat|seafood)/i.test(name)) return 'food';
  if (has('tobacco')      && /(cigar|cigarette|tobacco)/i.test(name)) return 'tobacco';
  if (has('services')     && /(delivery|service|fee|labour|labor|handling)/i.test(name)) return 'services';

  // Default to standard if the supplier has it enabled, otherwise first available.
  return has('standard') ? 'standard' : categories[0].key;
}

/**
 * Quick check: is the supplier set up enough to issue invoices?
 * Returns { ready: bool, missing: string[] }
 */
export function isInvoicingReady(supplier) {
  const missing = [];
  if (!supplier?.business_country)          missing.push('country');
  if (!supplier?.business_address_line1)    missing.push('address');
  if (!supplier?.business_city)             missing.push('city');
  // Categories are ready if explicitly enabled, or (unset) the country preset
  // supplies defaults, or they've added custom ones — matching the default in
  // getEffectiveCategoriesForSupplier.
  const enabledRaw = supplier?.vat_categories_enabled;
  const custom = Array.isArray(supplier?.vat_categories_custom) ? supplier.vat_categories_custom : [];
  const preset = getCountryTaxPreset(supplier?.business_country);
  const hasEnabled = Array.isArray(enabledRaw)
    ? enabledRaw.length > 0
    : (preset?.categories?.length || 0) > 0;
  if (!hasEnabled && custom.length === 0) missing.push('tax categories');
  return { ready: missing.length === 0, missing };
}
