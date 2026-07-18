// Cargo Accounts — parse an uploaded past budget / template spreadsheet into budget
// lines mapped onto the MYBA chart (pure, no imports; the caller turns the file into an
// array-of-arrays with SheetJS first). Column detection is heuristic — real exports
// vary wildly — so it looks for header hints, then falls back to shape inference, then
// fuzzy-matches each row's description to a chart line by code, exact name, containment,
// or token overlap. Anything it can't place is returned as `unmatched` for the user.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const numOf = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const c = String(v ?? '').replace(/[^0-9.-]/g, '');
  if (!c || c === '-' || c === '.') return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const jaccard = (a, b) => { let i = 0; a.forEach((x) => { if (b.has(x)) i += 1; }); const u = a.size + b.size - i; return u ? i / u : 0; };

const DESC_HINTS = ['description', 'desc', 'category', 'account', 'line', 'item', 'name', 'detail', 'nominal'];
const AMT_HINTS = ['amount', 'budget', 'total', 'value', 'cost', 'eur', 'usd', 'gbp', 'sum', 'annual', 'ytd', 'forecast'];

// Find the header row + the description and amount columns. Returns null if nothing
// usable is found.
export const detectColumns = (aoa) => {
  const scan = Math.min((aoa || []).length, 12);
  for (let r = 0; r < scan; r += 1) {
    const row = aoa[r] || [];
    let descCol = -1; let amtCol = -1;
    row.forEach((cell, i) => {
      const h = norm(cell);
      if (!h) return;
      if (descCol < 0 && DESC_HINTS.some((x) => h.includes(x))) descCol = i;
      if (AMT_HINTS.some((x) => h.includes(x))) amtCol = i;   // last amount-ish header wins
    });
    if (descCol >= 0 && amtCol >= 0 && descCol !== amtCol) return { headerRow: r, descCol, amtCol };
  }
  // Fallback: infer from data shape — the column with the most text is the description,
  // the column with the most numbers is the amount.
  const cols = Math.max(0, ...(aoa || []).map((row) => (row ? row.length : 0)));
  if (!cols) return null;
  const textN = new Array(cols).fill(0); const numN = new Array(cols).fill(0);
  (aoa || []).forEach((row) => {
    for (let i = 0; i < cols; i += 1) {
      const v = row ? row[i] : null;
      if (v == null || v === '') continue;
      if (numOf(v) != null && !/[a-z]{3,}/i.test(String(v))) numN[i] += 1;
      else if (/[a-z]{3,}/i.test(String(v))) textN[i] += 1;
    }
  });
  const descCol = textN.indexOf(Math.max(...textN));
  let amtCol = -1; let best = 0;
  for (let i = 0; i < cols; i += 1) { if (i !== descCol && numN[i] > best) { best = numN[i]; amtCol = i; } }
  if (descCol < 0 || amtCol < 0 || !best) return null;
  return { headerRow: -1, descCol, amtCol };
};

// aoa -> [{ name, amount }] (positive magnitudes), plus the detection used.
export const parseSheetRows = (aoa) => {
  const det = detectColumns(aoa);
  if (!det) return { rows: [], detected: null };
  const rows = [];
  for (let r = det.headerRow + 1; r < (aoa || []).length; r += 1) {
    const row = aoa[r] || [];
    const name = String(row[det.descCol] ?? '').trim();
    const amt = numOf(row[det.amtCol]);
    if (!name || amt == null || amt === 0) continue;
    if (/^(total|subtotal|grand total|sum)\b/i.test(name)) continue;   // skip roll-up rows
    rows.push({ name, amount: Math.abs(amt) });
  }
  return { rows, detected: det };
};

// Map parsed rows onto the chart. Returns chart-shaped lines with summed amounts, plus
// what matched and what didn't.
export const matchToChart = (rows, chart, { threshold = 0.34 } = {}) => {
  const byName = new Map(); const byCode = new Map();
  (chart || []).forEach((c) => { byName.set(norm(c.category), c); if (c.code) byCode.set(norm(c.code), c); });
  const chartTok = (chart || []).map((c) => ({ c, t: tokens(c.category) }));

  const sums = new Map(); const unmatched = []; let matchedTotal = 0;
  (rows || []).forEach((row) => {
    const nn = norm(row.name);
    let hit = byCode.get(nn) || byName.get(nn) || null;
    if (!hit && nn.length > 3) {
      hit = (chart || []).find((c) => { const cn = norm(c.category); return cn && (cn.includes(nn) || nn.includes(cn)); }) || null;
    }
    if (!hit) {
      const rt = tokens(row.name); let best = threshold; let pick = null;
      chartTok.forEach(({ c, t }) => { const s = jaccard(rt, t); if (s > best) { best = s; pick = c; } });
      hit = pick;
    }
    if (hit && hit.kind !== 'revenue') { sums.set(hit.category, (sums.get(hit.category) || 0) + row.amount); matchedTotal += row.amount; }
    else unmatched.push(row);
  });

  const lines = (chart || []).map((c) => ({
    bucket: c.bucket, category: c.category, code: c.code || null, kind: c.kind || 'expense',
    amount: Math.round((sums.get(c.category) || 0) * 100) / 100, monthly: {},
  }));
  return {
    lines,
    matched: (rows || []).length - unmatched.length,
    unmatched,
    matchedTotal: Math.round(matchedTotal * 100) / 100,
  };
};
