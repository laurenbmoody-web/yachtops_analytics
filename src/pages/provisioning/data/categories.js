export const CATEGORY_GROUPS = [
  {
    group: 'Galley',
    department: 'Galley',
    color: '#D4537E',
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
    color: '#D85A30',
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
    color: '#639922',
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
    color: '#534AB7',
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
    group: 'General',
    department: null,
    color: '#5F5E5A',
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

export const CATEGORY_COLORS = {};
CATEGORY_GROUPS.forEach(g => {
  g.categories.forEach(c => {
    CATEGORY_COLORS[c] = g.color;
  });
});

export const getCategoryGroup = (category) => {
  return CATEGORY_GROUPS.find(g => g.categories.includes(category))?.group || 'General';
};

export const getCategoryColor = (category) => {
  return CATEGORY_COLORS[category] || '#5F5E5A';
};

// Convert hex to rgba for tinted backgrounds
export const hexToRgba = (hex, alpha = 0.08) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
