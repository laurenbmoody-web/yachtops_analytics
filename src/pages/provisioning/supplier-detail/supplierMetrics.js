// Sprint 9c.2 — Supplier detail metrics aggregator (real data).
//
// Replaces mockSupplierMetrics.js. Same bundle contract the page already
// consumes, computed from live Supabase queries (supplierMetricsQueries).
//
//   getSupplierMetrics(supplierProfileId, {
//     tenantRole, departmentKey, reportingCurrency,
//   }) -> Promise<bundle>
//
// Bundle shape (note the KPI rename: onTimeRate -> completedOrders, since
// delivery_ledger has no FK to orders / no delivered_at — on-time is a
// backlog item; Completed Orders uses supplier_orders.status instead):
//
//   {
//     totalSpend:      { amount, currency, orderCount },
//     completedOrders: { percent, completed, total },
//     lastOrder:       { ref, total, currency, daysAgo },
//     avgOrderValue:   { amount, currency, rangeLow, rangeHigh },
//     discrepancyRate: { percent, withIssues, total, fleetAvg },
//     trend12mo:       { monthlyAvg, currency, points: [12 numbers] },
//     currencyMix:     [{ code, percent }],
//     departmentBreakdown: [...] | null,   // Command only; null for Chief
//     orders:          [...]               // role-scoped, newest-first
//   }
//
// All "amount" figures are in reportingCurrency (Frankfurter-converted).
// Original-currency values stay original: lastOrder.total / .currency are
// the order's own currency, and currencyMix is always real transaction
// currencies (the UI disclaimer says so).
//
// TODO(reporting-currency): reportingCurrency is passed in as the 'EUR'
// constant for v1 (no vessels.reporting_currency column yet). Swap to the
// real vessel setting when that column lands.
//
// TODO(fx-historical): conversion uses one current-rate Frankfurter fetch
// for all orders. Per-order historical rates (rate at created_at) would
// be more accurate but cost N fetches. Acceptable for v1.

import {
  fetchSupplierOrdersForMetrics,
  fetchSupplierOrderItemsForMetrics,
  fetchTenantDiscrepancyFleetAvg,
  fetchDepartments,
} from './supplierMetricsQueries';

// ─── Constants ───────────────────────────────────────────────

// Orders in any of these statuses count as "completed".
const COMPLETED_STATUSES = new Set(['received', 'delivered_with_discrepancies', 'paid']);
const DISCREPANCY_STATUS = 'delivered_with_discrepancies';

// Department subtitle map, keyed by lowercased department name. The
// departments table has no description column yet.
// TODO(departments): add a `description` column to departments and read
// it instead of this hard-coded map.
const DEPT_SUBTITLES = {
  interior:    'Stewarding, housekeeping, laundry',
  galley:      'Provisioning, dry stores, galley supplies',
  deck:        'Lines, fenders, deck equipment',
  engineering: 'Spare parts, consumables, technical',
  admin:       'Administrative supplies',
  aviation:    'Helicopter operations',
  bridge:      'Navigation, bridge equipment',
  medical:     'Medical supplies',
  science:     'Research equipment',
  security:    'Security systems, supplies',
  spa:         'Spa supplies, treatments',
};

// Synthetic bucket for orders whose board has no department (empty [] or
// null list). Grey swatch, not clickable (the page suppresses the
// deep-dive for this key).
const UNCATEGORISED_KEY = 'uncategorised';
const UNCATEGORISED_COLOUR = '#5F5E5A';

// Static fallback FX, value of 1 unit in EUR, used only if the live
// Frankfurter fetch fails. Mirrors the approximate rates the rest of the
// codebase falls back to.
const STATIC_EUR_PER = { EUR: 1, USD: 0.92, GBP: 1.17 };

// ─── Helpers ─────────────────────────────────────────────────

const computeOrderTotal = (order) => {
  const items = order?.supplier_order_items || [];
  return items.reduce((sum, it) => {
    const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return sum + unit * (Number(it.quantity) || 0);
  }, 0);
};

const shortRef = (id) => '#' + String(id || '').slice(0, 8).toUpperCase();

const daysAgo = (iso) => {
  if (!iso) return null;
  const target = new Date(iso); target.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - target) / 86400000);
};

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (numer, denom) => (denom > 0 ? Math.round((numer / denom) * 100) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

// Group a list of orders by their ORIGINAL currency. Each entry keeps the
// original-currency total + count, plus the reporting-converted total
// used purely for ordering (dominant currency leads). Powers the
// AS TRANSACTED render mode without a re-fetch — the bundle carries both
// representations and the page picks at render time.
function byCurrencyTotals(ordersList, convert) {
  const m = new Map();
  for (const o of ordersList) {
    const code = (o.currency || 'EUR').toUpperCase();
    const t = computeOrderTotal(o);
    const e = m.get(code) || { code, amount: 0, converted: 0, count: 0 };
    e.amount += t;
    e.converted += convert(t, o.currency);
    e.count += 1;
    m.set(code, e);
  }
  return [...m.values()].sort((a, b) => b.converted - a.converted);
}

// Build a converter: amount in `fromCur` -> reportingCurrency.
// Frankfurter v2 `?base=<reporting>` returns rates[X] = units of X per 1
// reporting, so amount_in_reporting = amount / rates[fromCur]. On fetch
// failure, fall back to the static EUR-relative cross table.
async function buildConverter(reportingCurrency) {
  const base = (reportingCurrency || 'EUR').toUpperCase();
  let rates = null;
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v2/rates?base=${base}&quotes=USD,EUR,GBP`,
    );
    const json = await res.json();
    if (json && json.rates && Object.keys(json.rates).length > 0) {
      rates = { ...json.rates, [base]: 1 };
    }
  } catch {
    rates = null;
  }
  return (amount, fromCur) => {
    const amt = Number(amount) || 0;
    if (amt === 0) return 0;
    const from = (fromCur || base).toUpperCase();
    if (from === base) return amt;
    if (rates && rates[from]) return amt / rates[from];
    // Static fallback: value in EUR then into base.
    const eurPerFrom = STATIC_EUR_PER[from] ?? 1;
    const eurPerBase = STATIC_EUR_PER[base] ?? 1;
    return amt * (eurPerFrom / eurPerBase);
  };
}

// Last 12 calendar months as { year, month, label } oldest -> newest,
// ending with the current month. label is the 3-letter month upper.
function last12MonthBuckets() {
  const out = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      key: `${d.getFullYear()}-${d.getMonth()}`,
    });
  }
  return out;
}

// Sum order totals (converted) into a 12-slot trend array aligned to the
// month buckets. Orders outside the 12-month window are ignored.
function trendPointsFor(orders, convert, reportingCurrency, buckets) {
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const points = new Array(buckets.length).fill(0);
  for (const o of orders) {
    if (!o.created_at) continue;
    const d = new Date(o.created_at);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    const slot = index.get(k);
    if (slot === undefined) continue;
    points[slot] += convert(computeOrderTotal(o), o.currency);
  }
  return points.map((n) => Math.round(n));
}

// Department names on an order's board (text[]). Empty / null -> [].
const orderDeptNames = (o) => {
  const arr = o?.provisioning_lists?.department;
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
};

// ─── Public entry ────────────────────────────────────────────

export async function getSupplierMetrics(
  supplierProfileId,
  { tenantRole, departmentKey, reportingCurrency = 'EUR' } = {},
) {
  const role = String(tenantRole || '').toUpperCase();
  const isCommand = role === 'COMMAND';

  const [ordersRes, itemsRes, fleetRes, deptsRes, convert] = await Promise.all([
    fetchSupplierOrdersForMetrics(supplierProfileId),
    fetchSupplierOrderItemsForMetrics(supplierProfileId),
    fetchTenantDiscrepancyFleetAvg(),
    fetchDepartments(),
    buildConverter(reportingCurrency),
  ]);

  const allOrders = ordersRes.data || [];
  const allItems = itemsRes.data || [];
  const departments = deptsRes.data || [];
  const fleetAvg = fleetRes.data?.percent ?? 0;
  const cur = (reportingCurrency || 'EUR').toUpperCase();

  // Resolve the Chief's department from departmentKey. Accept either a
  // departments.id (uuid — the canonical bundle key) or a name; match
  // against the fetched departments list, case-insensitive on name.
  let chiefDeptName = null;
  if (!isCommand && departmentKey) {
    const byId = departments.find((d) => d.id === departmentKey);
    const byName = departments.find(
      (d) => d.name?.toLowerCase() === String(departmentKey).toLowerCase(),
    );
    chiefDeptName = (byId || byName)?.name || null;
  }

  // Role-scope the orders. Chief: only orders whose board department[]
  // includes the chief's dept name (case-insensitive). Command: all.
  const orders = (!isCommand && chiefDeptName)
    ? allOrders.filter((o) =>
        orderDeptNames(o).some(
          (n) => n.toLowerCase() === chiefDeptName.toLowerCase(),
        ))
    : allOrders;

  const orderCount = orders.length;
  const buckets = last12MonthBuckets();

  // ── totalSpend (reporting currency) ────────────────────────
  const convertedTotals = orders.map((o) => convert(computeOrderTotal(o), o.currency));
  const totalSpendAmount = convertedTotals.reduce((s, n) => s + n, 0);

  // ── completedOrders ────────────────────────────────────────
  const completed = orders.filter((o) => COMPLETED_STATUSES.has(o.status)).length;

  // ── lastOrder (original currency) ──────────────────────────
  // orders is newest-first from the query.
  const newest = orders[0] || null;
  const lastOrder = newest
    ? {
        ref: shortRef(newest.id),
        total: computeOrderTotal(newest),
        currency: newest.currency || cur,
        daysAgo: daysAgo(newest.created_at) ?? 0,
      }
    : { ref: '—', total: 0, currency: cur, daysAgo: 0 };

  // ── avgOrderValue + range (reporting) ──────────────────────
  const avgAmount = orderCount > 0 ? totalSpendAmount / orderCount : 0;
  const rangeLow = convertedTotals.length ? Math.min(...convertedTotals) : 0;
  const rangeHigh = convertedTotals.length ? Math.max(...convertedTotals) : 0;

  // Per-currency originals for the AS TRANSACTED render mode. Sorted by
  // converted spend desc so the dominant currency leads.
  const spendGroups = byCurrencyTotals(orders, convert);
  const totalByCurrency = spendGroups.map((g) => ({
    code: g.code,
    amount: round2(g.amount),
  }));
  const avgByCurrency = spendGroups.map((g) => ({
    code: g.code,
    amount: g.count > 0 ? round2(g.amount / g.count) : 0,
  }));

  // ── discrepancyRate ────────────────────────────────────────
  const withIssues = orders.filter((o) => o.status === DISCREPANCY_STATUS).length;

  // ── trend12mo ──────────────────────────────────────────────
  const trendPoints = trendPointsFor(orders, convert, cur, buckets);
  const trendAvg = trendPoints.length
    ? Math.round(trendPoints.reduce((s, n) => s + n, 0) / trendPoints.length)
    : 0;

  // ── currencyMix (original currencies, % of order COUNT) ────
  const mixCounts = new Map();
  for (const o of orders) {
    const code = (o.currency || cur).toUpperCase();
    mixCounts.set(code, (mixCounts.get(code) || 0) + 1);
  }
  const currencyMix = [...mixCounts.entries()]
    .map(([code, n]) => ({ code, percent: pct(n, orderCount) }))
    .sort((a, b) => b.percent - a.percent);

  // ── departmentBreakdown (Command only) ─────────────────────
  let departmentBreakdown = null;
  if (isCommand) {
    departmentBreakdown = buildDepartmentBreakdown({
      orders,
      allItems,
      departments,
      convert,
      cur,
      buckets,
      totalSpendAmount,
      totalOrderCount: orderCount,
    });
  }

  return {
    totalSpend: {
      amount: Math.round(totalSpendAmount * 100) / 100,
      currency: cur,
      orderCount,
      byCurrency: totalByCurrency,
    },
    completedOrders: {
      percent: pct(completed, orderCount),
      completed,
      total: orderCount,
    },
    lastOrder,
    avgOrderValue: {
      amount: Math.round(avgAmount * 100) / 100,
      currency: cur,
      rangeLow: Math.round(rangeLow),
      rangeHigh: Math.round(rangeHigh),
      byCurrency: avgByCurrency,
    },
    discrepancyRate: {
      percent: round1(orderCount > 0 ? (withIssues / orderCount) * 100 : 0),
      withIssues,
      total: orderCount,
      fleetAvg,
    },
    trend12mo: {
      monthlyAvg: trendAvg,
      currency: cur,
      points: trendPoints,
    },
    currencyMix,
    departmentBreakdown,
    orders,
  };
}

// ─── Department breakdown ────────────────────────────────────
//
// First-department attribution: a multi-dept board's order is counted
// once, against the FIRST name in its department[]. This keeps spend% /
// order% partitioning cleanly to ~100% and the stacked bar honest.
// TODO(dept-split): proportional split across a board's multiple
// departments is a v2 refinement.
//
// Only departments with > 0 orders for this supplier are returned, plus a
// single "Uncategorised" bucket if any orders have no board department.
function buildDepartmentBreakdown({
  orders, allItems, departments, convert, cur, buckets,
  totalSpendAmount, totalOrderCount,
}) {
  const deptByName = new Map(
    departments.map((d) => [d.name?.toLowerCase(), d]),
  );

  // Group order ids by attributed dept key.
  const groups = new Map(); // key -> { dept|null, orders: [] }
  for (const o of orders) {
    const names = orderDeptNames(o);
    let key; let deptRow = null; let displayName;
    if (names.length === 0) {
      key = UNCATEGORISED_KEY;
      displayName = 'Uncategorised';
    } else {
      const first = names[0];
      deptRow = deptByName.get(first.toLowerCase()) || null;
      key = deptRow?.id || `name:${first.toLowerCase()}`;
      displayName = deptRow?.name || first;
    }
    if (!groups.has(key)) {
      groups.set(key, { key, deptRow, displayName, orders: [] });
    }
    groups.get(key).orders.push(o);
  }

  // Items indexed by order id for top-items per dept.
  const itemsByOrderId = new Map();
  for (const it of allItems) {
    const oid = it?.supplier_orders?.id;
    if (!oid) continue;
    if (!itemsByOrderId.has(oid)) itemsByOrderId.set(oid, []);
    itemsByOrderId.get(oid).push(it);
  }

  const out = [];
  for (const { key, deptRow, displayName, orders: deptOrders } of groups.values()) {
    const dOrderCount = deptOrders.length;
    if (dOrderCount === 0) continue;

    const converted = deptOrders.map((o) => convert(computeOrderTotal(o), o.currency));
    const spendAmount = converted.reduce((s, n) => s + n, 0);
    // Per-currency originals for the dept legend row in AS TRANSACTED.
    const spendByCurrency = byCurrencyTotals(deptOrders, convert).map((g) => ({
      code: g.code,
      amount: Math.round(g.amount),
    }));
    const completed = deptOrders.filter((o) => COMPLETED_STATUSES.has(o.status)).length;
    const disc = deptOrders.filter((o) => o.status === DISCREPANCY_STATUS).length;

    // Top 5 items by spend within this dept's orders (reporting currency).
    const itemSpend = new Map(); // name -> { name, orderCount, total }
    for (const o of deptOrders) {
      const items = itemsByOrderId.get(o.id) || o.supplier_order_items || [];
      for (const it of items) {
        const name = it.item_name || 'Unnamed item';
        const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
        const line = unit * (Number(it.quantity) || 0);
        const conv = convert(line, o.currency);
        const cur0 = itemSpend.get(name) || { name, orderCount: 0, total: 0 };
        cur0.orderCount += 1;
        cur0.total += conv;
        itemSpend.set(name, cur0);
      }
    }
    const topItems = [...itemSpend.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((t) => ({ name: t.name, orderCount: t.orderCount, total: Math.round(t.total) }));

    const isUncat = key === UNCATEGORISED_KEY;
    const lowName = (displayName || '').toLowerCase();

    out.push({
      key,                                  // departments.id uuid (or sentinel)
      name: displayName,
      sub: isUncat ? 'No department assigned' : (DEPT_SUBTITLES[lowName] || ''),
      colour: isUncat ? UNCATEGORISED_COLOUR : (deptRow?.color || UNCATEGORISED_COLOUR),
      uncategorised: isUncat,               // page: suppress deep-dive clickthrough
      orderCount: dOrderCount,
      orderPercent: pct(dOrderCount, totalOrderCount),
      spendAmount: Math.round(spendAmount),
      spendByCurrency,
      spendPercent: pct(spendAmount, totalSpendAmount),
      avgOrder: dOrderCount > 0 ? Math.round(spendAmount / dOrderCount) : 0,
      avgRangeLow: converted.length ? Math.round(Math.min(...converted)) : 0,
      avgRangeHigh: converted.length ? Math.round(Math.max(...converted)) : 0,
      completedPercent: pct(completed, dOrderCount),
      completedCount: completed,
      completedTotal: dOrderCount,
      discrepancyPercent: round1(dOrderCount > 0 ? (disc / dOrderCount) * 100 : 0),
      discrepancyCount: disc,
      trendPoints: trendPointsFor(deptOrders, convert, cur, buckets),
      topItems,
    });
  }

  // Real departments first (by spend desc), Uncategorised always last.
  out.sort((a, b) => {
    if (a.uncategorised) return 1;
    if (b.uncategorised) return -1;
    return b.spendAmount - a.spendAmount;
  });
  return out;
}
