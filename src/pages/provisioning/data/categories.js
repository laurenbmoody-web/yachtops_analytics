// Per-department category lists for the provisioning module.
//
// Department COLOURS now live in the database (public.departments.color).
// Read them via fetchVesselDepartments → { id, name, color }[] and pass the
// dept object to getDepartmentColor(dept) for rendering.
//
// Category lists below remain in code for now — flagged for migration to a
// per-department categories table in a future sprint. See PROVISION_CATEGORIES
// in utils/provisioningStorage.js for a parallel (older, diverging) list that
// also needs unifying.

export const CATEGORY_GROUPS = [
  {
    group: 'Galley',
    department: 'Galley',
    categories: [
      'Fresh Produce',
      'Dairy & Eggs',
      'Meat & Poultry',
      'Fish & Seafood',
      'Pantry & Dry Goods',
      'Frozen',
      'Bakery',
      'Beverages — Non-Alcoholic',
      'Beverages — Alcoholic',
      'BBQ & Snacks',
      'Cleaning',
      'Galley Consumables',
      'Herbs & Spices',
      'Oils, Vinegars & Condiments',
    ],
  },
  {
    group: 'Interior',
    department: 'Interior',
    categories: [
      'Cleaning Products — Interior',
      'Linen & Laundry',
      'Bathroom & Amenities',
      'Stationery & Office',
      'Floral & Decor',
      'Glassware, China & Cutlery',
      'Guest Supplies',
      'Gifts & Special Occasions',
      'Entertainment & Games',
    ],
  },
  {
    group: 'Deck',
    department: 'Deck',
    categories: [
      'Cleaning Products — Exterior',
      'Deck Consumables & Hardware',
      'Water Sports & Toys',
      'Fishing Supplies',
      'Safety & Life-Saving Equipment',
      'Navigation & Communications',
      'Tender & RIB Supplies',
      'Paints, Varnish & Coatings',
      'Ropes, Lines & Fenders',
    ],
  },
  {
    group: 'Engineering',
    department: 'Engineering',
    categories: [
      'Filters & Purifiers',
      'Oils, Lubricants & Coolants',
      'Electrical & Electronics',
      'Plumbing & Sanitation',
      'HVAC & Refrigeration',
      'Tools & Workshop',
      'Spare Parts — Engine',
      'Spare Parts — Generator',
      'Spare Parts — Other',
      'Chemicals & Treatment',
    ],
  },
  {
    group: 'Bridge',
    department: 'Bridge',
    categories: [
      'Navigation & Charts',
      'Bridge Electronics',
      'Communications Equipment',
      'Watchkeeping Supplies',
      'Logbooks & Stationery',
      'Binoculars & Optics',
      'Weather Instruments',
      'Bridge Consumables',
    ],
  },
  {
    group: 'General',
    department: null,
    categories: [
      'Medical & First Aid',
      'Uniforms & Crew Clothing',
      'Crew Provisions',
      'IT, AV & Communications',
      'Subscriptions & Licences',
      'PPE & Workwear',
      'Miscellaneous',
    ],
  },
];

export const ALL_CATEGORIES = CATEGORY_GROUPS.flatMap(g => g.categories);

export const getCategoryGroup = (category) => {
  return CATEGORY_GROUPS.find(g => g.categories.includes(category))?.group || 'General';
};

// Returns the category list for a given department name. Match is on
// CATEGORY_GROUPS.group (case-insensitive). Falls back to ['Uncategorised']
// when no group matches — callers can render a single-option dropdown so the
// AI inference path can still run.
export const categoriesForDept = (deptName) => {
  if (!deptName) return ['Uncategorised'];
  const target = String(deptName).trim().toLowerCase();
  const group = CATEGORY_GROUPS.find(g => g.group?.toLowerCase() === target);
  return group?.categories?.length ? group.categories : ['Uncategorised'];
};

// Single source of truth for department colour: read directly off the dept
// object returned by fetchVesselDepartments. Falls back to neutral grey if
// the object is missing a colour (legacy fallback path).
export const getDepartmentColor = (dept) => dept?.color || '#5F5E5A';

// Convert hex to rgba for tinted backgrounds
export const hexToRgba = (hex, alpha = 0.08) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
