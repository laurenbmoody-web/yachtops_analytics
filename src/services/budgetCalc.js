// Cargo Accounts — Phase 1. Pure budget-vs-actual maths.
//
// No Supabase/browser imports so it can be unit-tested in isolation and reused by
// the service + pages. Assembles the two-level (bucket -> breakdown line) vs-actual
// view from budget lines + actual-by-category + committed-by-category.
//
//   remaining = budgeted - actual - committed
//   pct       = (actual + committed) / budgeted
//   state     = under (<0.85) | near (0.85..1.0) | over (>1.0)

const NEAR = 0.85;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Category match is case/whitespace-insensitive so a manually-typed ledger category
// still lines up with a budget line typed slightly differently.
export const normCat = (s) => String(s ?? '').trim().toLowerCase();

export const stateOf = (budgeted, spent) => {
  if (num(budgeted) <= 0) return num(spent) > 0 ? 'over' : 'under';
  const pct = num(spent) / num(budgeted);
  if (pct > 1) return 'over';
  if (pct >= NEAR) return 'near';
  return 'under';
};

// rows: [{ category, amount }] -> Map(normKey -> { label, amount })
const aggregate = (rows) => {
  const m = new Map();
  (rows || []).forEach((r) => {
    const key = normCat(r.category);
    const prev = m.get(key);
    if (prev) prev.amount += num(r.amount);
    else m.set(key, { label: (r.category ?? '').trim() || 'Uncategorised', amount: num(r.amount) });
  });
  return m;
};

const metrics = (budgeted, actual, committed) => {
  const b = num(budgeted); const a = num(actual); const c = num(committed);
  const spent = a + c;
  return {
    budgeted: b, actual: a, committed: c,
    remaining: b - spent,
    pct: b > 0 ? spent / b : null,
    state: stateOf(b, spent),
  };
};

// lines: [{ id, bucket, category, amount }]
// actuals / committed: [{ category, amount }]  (amount already positive spend)
export const computeVsActual = (lines, actuals, committed) => {
  const actualMap = aggregate(actuals);
  const committedMap = aggregate(committed);

  // First line to claim a category key owns its actual/committed (prevents double
  // counting if the same category is reused under two buckets).
  const ownerByKey = new Map();
  (lines || []).forEach((l) => {
    const key = normCat(l.category);
    if (!ownerByKey.has(key)) ownerByKey.set(key, l.id);
  });

  // Group lines by bucket, preserving first-seen order.
  const bucketOrder = [];
  const bucketMap = new Map();
  (lines || []).forEach((l) => {
    if (!bucketMap.has(l.bucket)) { bucketMap.set(l.bucket, []); bucketOrder.push(l.bucket); }
    const key = normCat(l.category);
    const owns = ownerByKey.get(key) === l.id;
    const a = owns ? (actualMap.get(key)?.amount || 0) : 0;
    const c = owns ? (committedMap.get(key)?.amount || 0) : 0;
    bucketMap.get(l.bucket).push({
      id: l.id, bucket: l.bucket, category: l.category, ...metrics(l.amount, a, c),
    });
  });

  const sumRows = (rows) => rows.reduce((s, r) => ({
    budgeted: s.budgeted + r.budgeted, actual: s.actual + r.actual, committed: s.committed + r.committed,
  }), { budgeted: 0, actual: 0, committed: 0 });

  const buckets = bucketOrder.map((bucket) => {
    const rows = bucketMap.get(bucket);
    const s = sumRows(rows);
    return { bucket, lines: rows, subtotal: metrics(s.budgeted, s.actual, s.committed) };
  });

  // Anything spent/committed against a category that no budget line claims -> Unbudgeted,
  // so the grand total always reconciles to real spend.
  const claimed = new Set(ownerByKey.keys());
  const unbudgetedRows = [];
  const addUnbudgeted = (map, field) => {
    map.forEach((v, key) => {
      if (claimed.has(key)) return;
      let row = unbudgetedRows.find((r) => normCat(r.category) === key);
      if (!row) { row = { category: v.label, _actual: 0, _committed: 0 }; unbudgetedRows.push(row); }
      row[field] += v.amount;
    });
  };
  addUnbudgeted(actualMap, '_actual');
  addUnbudgeted(committedMap, '_committed');
  const unbudgeted = unbudgetedRows.length
    ? {
        lines: unbudgetedRows.map((r) => ({ bucket: 'Unbudgeted', category: r.category, ...metrics(0, r._actual, r._committed) })),
        subtotal: (() => { const s = unbudgetedRows.reduce((acc, r) => ({ a: acc.a + r._actual, c: acc.c + r._committed }), { a: 0, c: 0 }); return metrics(0, s.a, s.c); })(),
      }
    : null;

  const allRows = [...buckets.flatMap((b) => b.lines), ...(unbudgeted?.lines || [])];
  const g = sumRows(allRows);
  return { buckets, unbudgeted, totals: metrics(g.budgeted, g.actual, g.committed) };
};
