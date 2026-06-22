// Shared unit dropdown taxonomy. Used by both the captain-side
// provisioning board (DetailTableCells, ItemDrawer) and the
// supplier-portal order detail so the two surfaces speak the same
// vocabulary. Size = the number; Unit = something from this list.
//
// Groups are ordered for the dropdown rendering itself — Weight /
// Volume / Count / Length / Other — keep that order stable so the
// muscle memory works across both UIs.
export const UNIT_GROUPS = [
  { label: 'Weight',  options: ['g', 'kg', 'oz', 'lb'] },
  { label: 'Volume',  options: ['ml', 'l', 'fl oz', 'cup', 'tsp', 'tbsp'] },
  { label: 'Count',   options: ['each', 'pair', 'set', 'box', 'pack', 'case', 'carton', 'dozen'] },
  { label: 'Length',  options: ['cm', 'm', 'ft', 'inch'] },
  { label: 'Other',   options: ['portion', 'serving', 'sheet', 'roll', 'sachet', 'tube', 'bottle', 'can', 'jar', 'bag'] },
];

export const UNIT_GROUP_VALUES = new Set(UNIT_GROUPS.flatMap((g) => g.options));
