// Sprint 9c.2 — supplier detail page mock metrics.
//
// Returns the role-scoped KPI bundle the redesigned SupplierDetailPage
// consumes. Real Supabase queries land in a follow-up sprint; this
// module is the only swap point.
//
// Canonical numbers mirror the static HTML mockup at
//   docs/supplier_detail_page.html
// so the rendered page matches the design exactly until live data
// replaces this module.
//
// Scoping rules (per brief):
//   tenantRole === 'COMMAND'  → vessel-wide totals + full departmentBreakdown
//   tenantRole === 'CHIEF'    → slice for `departmentKey` only, departmentBreakdown: null
//   anything else             → treated like CHIEF, defaults to interior
//
// Function signature is forward-compatible: supplierProfileId is
// accepted but unused — the live implementation will key off it.
// Callers should pass it through unchanged.

// ─── Vessel-wide top-line numbers (Command view) ─────────────

const VESSEL_TOTAL_SPEND     = 48920.50;
const VESSEL_ORDER_COUNT     = 47;
const VESSEL_ON_TIME         = 42;
const VESSEL_AVG_ORDER       = 1040.86;
const VESSEL_AVG_RANGE_LOW   = 82;
const VESSEL_AVG_RANGE_HIGH  = 4210;
const VESSEL_DISCREPANCIES   = 3;
const FLEET_AVG_DISCREPANCY  = 11;

// 12-month spend trend, Jun→May. Sum / 12 ≈ €1,540 / month, matching
// the "€1,540 avg / month" context line in the mockup.
const VESSEL_TREND_POINTS = [820, 950, 1100, 1050, 1280, 1380, 1520, 1500, 1820, 2080, 2240, 2740];

const VESSEL_LAST_ORDER = {
  ref: '#893871FB',
  total: 190.50,
  currency: 'EUR',
  daysAgo: 3,
};

const VESSEL_CURRENCY_MIX = [
  { code: 'EUR', percent: 78 },
  { code: 'USD', percent: 15 },
  { code: 'GBP', percent: 7 },
];

// ─── Department breakdown (Command view only) ────────────────
//
// Each dept carries its own pill colour set (bg + text), 12-month
// trend, top-items list, and KPI block. The page reads these
// directly to render both the stacked legend and the deep-dive
// panel. `colour` is the swatch / sparkline stroke; `pillBg` and
// `pillText` are the deep-dive panel's role pill.

const DEPARTMENTS = [
  {
    key: 'interior',
    name: 'Interior',
    sub: 'Stewarding, housekeeping, laundry',
    colour: '#C65A1A',
    pillBg: '#FAEEDA',
    pillText: '#C65A1A',
    orderCount: 22,
    orderPercent: 47,                 // share of vessel-wide order count
    spendAmount: 18440.20,
    spendPercent: 38,                 // share of vessel-wide spend
    avgOrder: 838,
    avgRangeLow: 82,
    avgRangeHigh: 2140,
    onTimePercent: 91,
    onTimeOnTime: 20,
    onTimeTotal: 22,
    discrepancyPercent: 4.5,
    discrepancyCount: 1,
    // Per-dept monthly trend (12 points, Jun→May). Sum / 12 ≈ €620.
    trendPoints: [400, 460, 500, 480, 560, 600, 660, 640, 720, 780, 820, 820],
    // Per-dept currency mix — Interior is local linens / supplies, mostly EUR.
    currencyMix: [
      { code: 'EUR', percent: 88 },
      { code: 'USD', percent: 8 },
      { code: 'GBP', percent: 4 },
    ],
    topItems: [
      { name: 'Bath linen sets',    orderCount: 12, total: 4820.00 },
      { name: 'Cleaning supplies',  orderCount: 18, total: 3640.50 },
      { name: 'Stew uniforms',      orderCount: 4,  total: 2280.00 },
      { name: 'Guest amenities',    orderCount: 8,  total: 1940.20 },
      { name: 'Laundry chemicals',  orderCount: 14, total: 1420.00 },
    ],
  },
  {
    key: 'galley',
    name: 'Galley',
    sub: 'Provisioning, dry stores, galley supplies',
    colour: '#1D9E75',
    pillBg: '#E1F5EE',
    pillText: '#0F6E56',
    orderCount: 18,
    orderPercent: 38,
    spendAmount: 14720.80,
    spendPercent: 30,
    avgOrder: 818,
    avgRangeLow: 120,
    avgRangeHigh: 3800,
    onTimePercent: 83,
    onTimeOnTime: 15,
    onTimeTotal: 18,
    discrepancyPercent: 11.1,
    discrepancyCount: 2,
    trendPoints: [880, 980, 1080, 1200, 1280, 1140, 1320, 1380, 1480, 1430, 1600, 1730],
    currencyMix: [
      { code: 'EUR', percent: 72 },
      { code: 'USD', percent: 22 },
      { code: 'GBP', percent: 6 },
    ],
    topItems: [
      { name: 'Fresh produce',       orderCount: 16, total: 5620.00 },
      { name: 'Dry pantry staples',  orderCount: 10, total: 3840.50 },
      { name: 'Specialty oils',      orderCount: 5,  total: 1840.00 },
      { name: 'Spices & herbs',      orderCount: 8,  total: 1420.20 },
      { name: 'Galley cleaning',     orderCount: 6,  total: 980.00 },
    ],
  },
  {
    key: 'deck',
    name: 'Deck',
    sub: 'Lines, fenders, deck equipment',
    colour: '#378ADD',
    pillBg: '#E6F1FB',
    pillText: '#0C447C',
    orderCount: 5,
    orderPercent: 11,
    spendAmount: 4265.30,
    spendPercent: 9,
    avgOrder: 853,
    avgRangeLow: 240,
    avgRangeHigh: 1820,
    onTimePercent: 80,
    onTimeOnTime: 4,
    onTimeTotal: 5,
    discrepancyPercent: 0,
    discrepancyCount: 0,
    trendPoints: [240, 280, 320, 300, 340, 360, 380, 360, 420, 440, 480, 520],
    currencyMix: [
      { code: 'EUR', percent: 60 },
      { code: 'USD', percent: 28 },
      { code: 'GBP', percent: 12 },
    ],
    topItems: [
      { name: 'Mooring lines',     orderCount: 2, total: 1640.00 },
      { name: 'Fender covers',     orderCount: 1, total: 1140.30 },
      { name: 'Deck brushes',      orderCount: 3, total: 840.00 },
      { name: 'Stainless polish',  orderCount: 2, total: 420.00 },
      { name: 'Anchor markers',    orderCount: 1, total: 220.00 },
    ],
  },
  {
    key: 'engineering',
    name: 'Engineering',
    sub: 'Spare parts, consumables, technical',
    colour: '#888780',
    pillBg: '#F1EFE8',
    pillText: '#444441',
    orderCount: 2,
    orderPercent: 4,
    spendAmount: 11494.20,
    spendPercent: 23,
    avgOrder: 5747,
    avgRangeLow: 4210,
    avgRangeHigh: 7284,
    onTimePercent: 100,
    onTimeOnTime: 2,
    onTimeTotal: 2,
    discrepancyPercent: 0,
    discrepancyCount: 0,
    // Big-ticket, infrequent — flatter shape that ramps up late.
    trendPoints: [600, 600, 700, 700, 800, 800, 900, 900, 1000, 1000, 1100, 1284],
    currencyMix: [
      { code: 'EUR', percent: 48 },
      { code: 'USD', percent: 40 },
      { code: 'GBP', percent: 12 },
    ],
    topItems: [
      { name: 'Filter cartridges',  orderCount: 1, total: 7284.20 },
      { name: 'Lubricants',         orderCount: 1, total: 4210.00 },
    ],
  },
];

const DEPARTMENT_BY_KEY = DEPARTMENTS.reduce((acc, d) => {
  acc[d.key] = d;
  return acc;
}, {});

// ─── Helpers ─────────────────────────────────────────────────

// Build a per-dept monthly average from its trend points.
const monthlyAvg = (points) =>
  Math.round(points.reduce((s, n) => s + n, 0) / points.length);

// Compose the full COMMAND-shaped bundle (used for Command view).
function buildCommandBundle() {
  return {
    totalSpend: {
      amount: VESSEL_TOTAL_SPEND,
      currency: 'EUR',
      orderCount: VESSEL_ORDER_COUNT,
    },
    onTimeRate: {
      percent: Math.round((VESSEL_ON_TIME / VESSEL_ORDER_COUNT) * 100), // 89
      onTime: VESSEL_ON_TIME,
      total: VESSEL_ORDER_COUNT,
    },
    lastOrder: { ...VESSEL_LAST_ORDER },
    avgOrderValue: {
      amount: VESSEL_AVG_ORDER,
      currency: 'EUR',
      rangeLow: VESSEL_AVG_RANGE_LOW,
      rangeHigh: VESSEL_AVG_RANGE_HIGH,
    },
    discrepancyRate: {
      percent: Math.round((VESSEL_DISCREPANCIES / VESSEL_ORDER_COUNT) * 1000) / 10, // 6.4
      withIssues: VESSEL_DISCREPANCIES,
      total: VESSEL_ORDER_COUNT,
      fleetAvg: FLEET_AVG_DISCREPANCY,
    },
    trend12mo: {
      monthlyAvg: monthlyAvg(VESSEL_TREND_POINTS),
      currency: 'EUR',
      points: [...VESSEL_TREND_POINTS],
    },
    currencyMix: VESSEL_CURRENCY_MIX.map((c) => ({ ...c })),
    departmentBreakdown: DEPARTMENTS.map((d) => ({
      key: d.key,
      name: d.name,
      sub: d.sub,
      colour: d.colour,
      pillBg: d.pillBg,
      pillText: d.pillText,
      orderCount: d.orderCount,
      orderPercent: d.orderPercent,
      spendAmount: d.spendAmount,
      spendPercent: d.spendPercent,
      avgOrder: d.avgOrder,
      avgRangeLow: d.avgRangeLow,
      avgRangeHigh: d.avgRangeHigh,
      onTimePercent: d.onTimePercent,
      onTimeOnTime: d.onTimeOnTime,
      onTimeTotal: d.onTimeTotal,
      discrepancyPercent: d.discrepancyPercent,
      discrepancyCount: d.discrepancyCount,
      trendPoints: [...d.trendPoints],
      topItems: d.topItems.map((it) => ({ ...it })),
    })),
  };
}

// Compose the CHIEF-shaped bundle — same shape as Command, but every
// KPI is scoped to the chief's department. `departmentBreakdown` is
// null (no cross-dept comparison surface for chief role).
function buildChiefBundle(dept) {
  return {
    totalSpend: {
      amount: dept.spendAmount,
      currency: 'EUR',
      orderCount: dept.orderCount,
    },
    onTimeRate: {
      percent: dept.onTimePercent,
      onTime: dept.onTimeOnTime,
      total: dept.onTimeTotal,
    },
    // Last order surfaces the supplier's overall most-recent order even
    // for chief view — that order's department may not be the chief's,
    // but the "last touch with this supplier" framing reads better than
    // hiding it entirely. Real query will filter to chief's dept.
    lastOrder: { ...VESSEL_LAST_ORDER },
    avgOrderValue: {
      amount: dept.avgOrder,
      currency: 'EUR',
      rangeLow: dept.avgRangeLow,
      rangeHigh: dept.avgRangeHigh,
    },
    discrepancyRate: {
      percent: dept.discrepancyPercent,
      withIssues: dept.discrepancyCount,
      total: dept.orderCount,
      fleetAvg: FLEET_AVG_DISCREPANCY,
    },
    trend12mo: {
      monthlyAvg: monthlyAvg(dept.trendPoints),
      currency: 'EUR',
      points: [...dept.trendPoints],
    },
    currencyMix: dept.currencyMix.map((c) => ({ ...c })),
    departmentBreakdown: null,
  };
}

// ─── Public entry ────────────────────────────────────────────

export function getMockSupplierMetrics(supplierProfileId, { tenantRole, departmentKey } = {}) {
  const role = String(tenantRole || '').toUpperCase();

  if (role === 'COMMAND') {
    return buildCommandBundle();
  }

  // CHIEF (and any other non-COMMAND role for now) — scope to a single
  // department. Defaults to interior if no key supplied. Unknown keys
  // fall back to interior rather than throwing.
  const key = String(departmentKey || 'interior').toLowerCase();
  const dept = DEPARTMENT_BY_KEY[key] || DEPARTMENT_BY_KEY.interior;
  return buildChiefBundle(dept);
}

// Optional named exports for tests / introspection.
export const DEPT_KEYS = DEPARTMENTS.map((d) => d.key);
export const DEPT_LOOKUP = DEPARTMENT_BY_KEY;
