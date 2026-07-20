// Cargo Accounts — pure chart-of-accounts helpers (no Supabase import), so they
// are unit-testable with `node --test`. Used by chartService (re-exported) and
// anywhere that needs to fold a flat chart list into its grouped shape.

// Fold a flat, sorted list of chart lines into buckets, preserving first-seen
// order (which reflects the query's sort_order). Returns
// [{ bucket, kind, lines: [...] }].
export function groupChartLines(rows) {
  const order = [];
  const byBucket = new Map();
  (rows || []).forEach((row) => {
    if (!byBucket.has(row.bucket)) {
      byBucket.set(row.bucket, { bucket: row.bucket, kind: row.kind, lines: [] });
      order.push(row.bucket);
    }
    byBucket.get(row.bucket).lines.push(row);
  });
  return order.map((b) => byBucket.get(b));
}
