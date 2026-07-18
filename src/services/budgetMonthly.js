// Cargo Accounts — Phase 1.3. Month-by-month actuals matrix (pure, no imports).
//
// Turns dated ledger spend/income into the owner's-office layout: each budget line's
// actual per calendar month across the period + a cumulative, with bucket subtotals,
// a revenue section, grand totals and a Net Revenue (Expenditure) row. Spend that
// resolves to no budget line is grouped under "Other" so nothing is hidden.
//
// Inputs:
//   lines   : [{ id, bucket, category, code, kind }]
//   actuals : [{ category (resolved), amount (positive spend), ym }]  ym = 'YYYY-MM'
//   income  : [{ category (resolved), amount (positive), ym }]
//   months  : [{ ym, label }]  the period's calendar months, in order

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const normCat = (s) => String(s ?? '').trim().toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;

// rows -> Map(normCat -> Map(ym -> amount))
const byCatMonth = (rows) => {
  const m = new Map();
  (rows || []).forEach((r) => {
    const k = normCat(r.category);
    if (!m.has(k)) m.set(k, new Map());
    const mm = m.get(k);
    mm.set(r.ym, r2((mm.get(r.ym) || 0) + num(r.amount)));
  });
  return m;
};

const emptyRow = (months) => Object.fromEntries(months.map((mo) => [mo.ym, 0]));
const sumRow = (byMonth) => r2(Object.values(byMonth).reduce((s, v) => s + num(v), 0));
const addInto = (target, src) => { Object.keys(src).forEach((ym) => { target[ym] = r2(num(target[ym]) + num(src[ym])); }); };

// Pull a line's per-month budget targets (jsonb map ym -> amount) onto the period.
const budgetRow = (line, months) => {
  const row = emptyRow(months);
  const m = line.monthly || {};
  months.forEach((mo) => { if (m[mo.ym] != null) row[mo.ym] = num(m[mo.ym]); });
  return row;
};

export const computeMonthly = (lines, actuals, income, months) => {
  const actMap = byCatMonth(actuals);
  const incMap = byCatMonth(income);
  const claimed = new Set();

  // First line to claim a category owns its actuals (mirrors the summary view).
  const ownerByKey = new Map();
  (lines || []).forEach((l) => { const k = normCat(l.category); if (!ownerByKey.has(k)) ownerByKey.set(k, l.id); });

  const bucketOrder = [];
  const bucketMap = new Map();
  (lines || []).forEach((l) => {
    if (!bucketMap.has(l.bucket)) { bucketMap.set(l.bucket, { kind: l.kind === 'revenue' ? 'revenue' : 'expense', lines: [] }); bucketOrder.push(l.bucket); }
    const k = normCat(l.category);
    const owns = ownerByKey.get(k) === l.id;
    const src = (l.kind === 'revenue' ? incMap : actMap).get(k);
    const byMonth = emptyRow(months);
    if (owns && src) { src.forEach((v, ym) => { if (ym in byMonth) byMonth[ym] = v; }); claimed.add(k); }
    const budgetByMonth = budgetRow(l, months);
    bucketMap.get(l.bucket).lines.push({
      id: l.id, code: l.code || null, category: l.category, annual: num(l.amount),
      byMonth, total: sumRow(byMonth),
      budgetByMonth, budgetTotal: sumRow(budgetByMonth),
    });
  });

  const buckets = bucketOrder.map((bucket) => {
    const b = bucketMap.get(bucket);
    const subtotalByMonth = emptyRow(months);
    const budgetSubtotalByMonth = emptyRow(months);
    b.lines.forEach((ln) => { addInto(subtotalByMonth, ln.byMonth); addInto(budgetSubtotalByMonth, ln.budgetByMonth); });
    return {
      bucket, kind: b.kind, lines: b.lines,
      subtotalByMonth, subtotalTotal: sumRow(subtotalByMonth),
      budgetSubtotalByMonth, budgetSubtotalTotal: sumRow(budgetSubtotalByMonth),
    };
  });

  // Actuals with no owning expense line -> "Other" (the review/unbudgeted spend).
  const otherRows = [];
  actMap.forEach((mm, key) => {
    if (claimed.has(key)) return;
    const byMonth = emptyRow(months);
    mm.forEach((v, ym) => { if (ym in byMonth) byMonth[ym] = v; });
    otherRows.push({ category: key, byMonth, total: sumRow(byMonth) });
  });
  const other = otherRows.length ? (() => {
    const subtotalByMonth = emptyRow(months);
    otherRows.forEach((r) => addInto(subtotalByMonth, r.byMonth));
    return { lines: otherRows, subtotalByMonth, subtotalTotal: sumRow(subtotalByMonth) };
  })() : null;

  const expenseByMonth = emptyRow(months);
  const budgetExpenseByMonth = emptyRow(months);
  buckets.filter((b) => b.kind !== 'revenue').forEach((b) => { addInto(expenseByMonth, b.subtotalByMonth); addInto(budgetExpenseByMonth, b.budgetSubtotalByMonth); });
  if (other) addInto(expenseByMonth, other.subtotalByMonth);
  const revenueByMonth = emptyRow(months);
  const budgetRevenueByMonth = emptyRow(months);
  buckets.filter((b) => b.kind === 'revenue').forEach((b) => { addInto(revenueByMonth, b.subtotalByMonth); addInto(budgetRevenueByMonth, b.budgetSubtotalByMonth); });
  const netByMonth = emptyRow(months);
  const budgetNetByMonth = emptyRow(months);
  months.forEach((mo) => {
    netByMonth[mo.ym] = r2(num(revenueByMonth[mo.ym]) - num(expenseByMonth[mo.ym]));
    budgetNetByMonth[mo.ym] = r2(num(budgetRevenueByMonth[mo.ym]) - num(budgetExpenseByMonth[mo.ym]));
  });

  return {
    months, buckets, other,
    expenseByMonth, expenseTotal: sumRow(expenseByMonth),
    revenueByMonth, revenueTotal: sumRow(revenueByMonth),
    netByMonth, netTotal: sumRow(netByMonth),
    budgetExpenseByMonth, budgetExpenseTotal: sumRow(budgetExpenseByMonth),
    budgetRevenueByMonth, budgetRevenueTotal: sumRow(budgetRevenueByMonth),
    budgetNetByMonth, budgetNetTotal: sumRow(budgetNetByMonth),
  };
};

// Calendar months spanning a period (inclusive), as [{ ym, label }].
export const monthsInPeriod = (startISO, endISO) => {
  const out = [];
  if (!startISO || !endISO) return out;
  const [sy, sm] = startISO.split('-').map(Number);
  const [ey, em] = endISO.split('-').map(Number);
  const LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let y = sy; let m = sm;
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 240) {
    out.push({ ym: `${y}-${String(m).padStart(2, '0')}`, label: LABEL[m - 1] + (sy !== ey ? ` ${String(y).slice(2)}` : '') });
    m += 1; if (m > 12) { m = 1; y += 1; }
    guard += 1;
  }
  return out;
};
