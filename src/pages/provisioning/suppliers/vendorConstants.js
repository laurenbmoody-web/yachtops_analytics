// Sprint 9c.3 — vendor directory constants.
//
// Seed taxonomy + the vendor-type enum. The enum values here MUST stay
// in sync with the supplier_profiles_vendor_type_check constraint added
// in migration 20260515120000 — adding/removing a vendor type requires a
// schema change, which is why this list is hardcoded rather than fetched.
//
// Categories/subcategories are seeds only: crew can type new ones in the
// Add/Edit form. Tenant-added entries persist via the union returned by
// provisioningStorage.fetchKnownCategoryTaxonomy(), and mergeTaxonomy()
// folds them into this seed list for the directory filters + form picker.

// Vendor types — enum values, hardcoded (see note above re: check
// constraint). `description` renders as italic helper text under the
// selected type in the Add/Edit form.
export const VENDOR_TYPES = [
  { value: 'Supplier',         label: 'Supplier',         description: 'Sells goods, fulfils orders' },
  { value: 'Service Provider', label: 'Service Provider', description: 'Performs jobs, invoices for work' },
  { value: 'Contractor',       label: 'Contractor',       description: 'Long-term contracted services' },
  { value: 'Agent',            label: 'Agent',            description: 'Acts on the vessel’s behalf (flag, customs)' },
  { value: 'Broker',           label: 'Broker',           description: 'Connects vessel to providers' },
];

// Seed primary categories, each with an optional subcategory seed list.
// Crew can add more (category or subcategory) by typing in the form.
export const CATEGORY_TAXONOMY = {
  'Provisions':   ['Dry stores', 'Fresh produce', 'Frozen', 'Dairy', 'Bakery'],
  'Spirits':      ['Wine', 'Spirits', 'Champagne', 'Beer', 'Non-alcoholic'],
  'Galley':       ['Cookware', 'Linens', 'Cleaning supplies', 'Small appliances'],
  'Deck':         ['Lines', 'Fenders', 'Deck equipment', 'Toys'],
  'Uniforms':     ['Crew uniforms', 'Guest robes', 'Laundry supplies'],
  'Spa':          ['Spa products', 'Treatments', 'Amenities'],
  'Medical':      ['Medication', 'First aid', 'Equipment'],
  'Tech':         ['AV equipment', 'IT supplies', 'Connectivity'],
  'Aviation':     ['Helicopter ops', 'Fuel', 'Maintenance'],
  'Bridge':       ['Navigation', 'Charts', 'Comms equipment'],
  'Engineering':  ['Spare parts', 'Consumables', 'Technical services'],
  'Interior':     ['Florals', 'Stationery', 'Guest amenities'],
};

export const SEED_CATEGORIES = Object.keys(CATEGORY_TAXONOMY);

// Merge the seed taxonomy with the tenant's used taxonomy (from
// provisioningStorage.fetchKnownCategoryTaxonomy()). Deduplicates
// case-insensitively, preserves seed order, appends tenant-only
// categories after the seeds (insertion order from the union query,
// which is already alphabetical). Returns the same shape:
//   { categories: string[], subcategories: { [parent]: string[] } }
export const mergeTaxonomy = (tenantTaxonomy = { categories: [], subcategories: {} }) => {
  const seedLower = new Set(SEED_CATEGORIES.map((c) => c.toLowerCase()));
  const merged = { categories: [...SEED_CATEGORIES], subcategories: {} };

  // Seed subcategories (cloned so callers can't mutate the module state).
  for (const [parent, subs] of Object.entries(CATEGORY_TAXONOMY)) {
    merged.subcategories[parent] = [...subs];
  }

  // Append tenant-added categories not already in the seed list.
  for (const cat of tenantTaxonomy.categories || []) {
    if (!seedLower.has(cat.toLowerCase())) {
      merged.categories.push(cat);
      if (!merged.subcategories[cat]) merged.subcategories[cat] = [];
    }
  }

  // Merge tenant-added subcategories into their parent buckets,
  // case-insensitively deduped against the seed subcategories.
  for (const [parent, subs] of Object.entries(tenantTaxonomy.subcategories || {})) {
    if (!merged.subcategories[parent]) merged.subcategories[parent] = [];
    const existingLower = new Set(merged.subcategories[parent].map((s) => s.toLowerCase()));
    for (const sub of subs) {
      if (!existingLower.has(sub.toLowerCase())) {
        merged.subcategories[parent].push(sub);
        existingLower.add(sub.toLowerCase());
      }
    }
  }

  return merged;
};
