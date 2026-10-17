// Whose inventory is the whole vessel's, and whose is just their own department.
//
// There are two gates on inventory and they have to agree, or the UI lies:
//
//   1. this module, which decides the root folders the page offers
//   2. public.has_whole_vessel_inventory() in the database, which the RLS
//      policies on inventory_items actually enforce
//
// If (1) is wider than (2) a crew member gets folders that open empty; if (2) is
// wider than (1) they simply never see stock they are entitled to. So the rule
// is written once here, mirrored once in SQL, and the mirror is called out in
// both files — see supabase/migrations/20261017140000_bridge_whole_vessel_inventory.sql.
//
// WHY BRIDGE IS IN THE LIST
// Command and Chief have always had whole-vessel scope. Bridge is a DEPARTMENT,
// not a tier, and it joins them because the bridge team carry vessel-wide
// responsibility — LSA/FFE, medical stores, charts and publications live in Deck
// and Medical folders, not in a folder called Bridge. Without this a Bridge
// officer below Chief sees exactly one folder, named after their department,
// which on most vessels holds nothing they need.
//
// This is a product rule, not a per-vessel setting. If a vessel ever needs to
// choose for itself, this is the one place that changes.

// Tiers whose scope has always been the whole vessel.
export const WHOLE_VESSEL_TIERS = ['COMMAND', 'CHIEF'];

// Departments whose scope is the whole vessel regardless of tier.
export const WHOLE_VESSEL_DEPARTMENTS = ['BRIDGE'];

const norm = (value) => String(value ?? '').trim().toUpperCase();

export const isWholeVesselTier = (tier) => WHOLE_VESSEL_TIERS.includes(norm(tier));

export const isWholeVesselDepartment = (department) =>
  WHOLE_VESSEL_DEPARTMENTS.includes(norm(department));

// The whole rule, in one call. Mirrors has_whole_vessel_inventory(tenant) in SQL.
export const hasWholeVesselInventory = ({ tier, department } = {}) =>
  isWholeVesselTier(tier) || isWholeVesselDepartment(department);

// The root folders a member may see.
//
// Note the empty-department case returns NOTHING rather than everything. That is
// deliberate and matches the behaviour this replaced: a half-loaded profile must
// not briefly hand someone the whole vessel. Failing closed shows an empty grid,
// which is recoverable; failing open is a privilege leak that nobody sees.
export const visibleRootFolders = (folders, { tier, department } = {}) => {
  const list = (Array.isArray(folders) ? folders : []).filter(Boolean);
  if (hasWholeVesselInventory({ tier, department })) return list;

  const dept = norm(department);
  if (!dept) return [];
  return list.filter((folder) => norm(folder) === dept);
};

// For the one-line explanation the page shows when the grid is scoped.
export const scopeLabel = ({ tier, department } = {}) =>
  hasWholeVesselInventory({ tier, department }) ? 'All departments' : (department || 'Your department');
