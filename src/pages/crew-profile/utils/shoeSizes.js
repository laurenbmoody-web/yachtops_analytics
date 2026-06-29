// Shoe-size conversion — turn one recorded shoe size into the UK / US / EU
// trio so kit can be ordered against any chart. Conversions are gender-aware
// (women's US runs ~+2 on UK, men's ~+1) and approximate — shoe sizing varies
// by brand — so callers should present them as a guide.

// Rows are aligned UK / US / EU equivalents from standard conversion charts.
const WOMENS = [
  { uk: 2, us: 4, eu: 35 },
  { uk: 2.5, us: 4.5, eu: 35.5 },
  { uk: 3, us: 5, eu: 36 },
  { uk: 3.5, us: 5.5, eu: 36.5 },
  { uk: 4, us: 6, eu: 37 },
  { uk: 4.5, us: 6.5, eu: 37.5 },
  { uk: 5, us: 7, eu: 38 },
  { uk: 5.5, us: 7.5, eu: 38.5 },
  { uk: 6, us: 8, eu: 39 },
  { uk: 6.5, us: 8.5, eu: 40 },
  { uk: 7, us: 9, eu: 41 },
  { uk: 7.5, us: 9.5, eu: 41.5 },
  { uk: 8, us: 10, eu: 42 },
  { uk: 8.5, us: 10.5, eu: 42.5 },
  { uk: 9, us: 11, eu: 43 },
];

const MENS = [
  { uk: 5, us: 6, eu: 38 },
  { uk: 5.5, us: 6.5, eu: 38.5 },
  { uk: 6, us: 7, eu: 39 },
  { uk: 6.5, us: 7.5, eu: 40 },
  { uk: 7, us: 8, eu: 41 },
  { uk: 7.5, us: 8.5, eu: 41.5 },
  { uk: 8, us: 9, eu: 42 },
  { uk: 8.5, us: 9.5, eu: 42.5 },
  { uk: 9, us: 10, eu: 43 },
  { uk: 9.5, us: 10.5, eu: 44 },
  { uk: 10, us: 11, eu: 44.5 },
  { uk: 10.5, us: 11.5, eu: 45 },
  { uk: 11, us: 12, eu: 46 },
  { uk: 11.5, us: 12.5, eu: 46.5 },
  { uk: 12, us: 13, eu: 47 },
];

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(n));

// Convert a shoe size to { uk, us, eu } (formatted strings), or null when it
// can't be read or sits too far from the chart to map confidently.
//   value  — the recorded size, e.g. "5", "UK 5", "EU 38"
//   region — 'UK' | 'US' | 'EU' (the system `value` is in; defaults to UK)
//   fit    — 'womens' uses the women's chart; anything else uses men's
export function convertShoe(value, region, fit) {
  if (value == null) return null;
  const num = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (!isFinite(num)) return null;

  const table = fit === 'womens' ? WOMENS : MENS;
  const col = region === 'US' ? 'us' : region === 'EU' ? 'eu' : 'uk';

  let best = null;
  let bestD = Infinity;
  for (const row of table) {
    const d = Math.abs(row[col] - num);
    if (d < bestD) { bestD = d; best = row; }
  }
  // EU steps are ~0.5–1 apart; UK/US ~0.5. Anything >1.5 off the nearest row
  // is outside the chart (or a typo) — don't guess.
  if (!best || bestD > 1.5) return null;
  return { uk: fmt(best.uk), us: fmt(best.us), eu: fmt(best.eu) };
}

// "UK 5 · US 7 · EU 38" — the recorded region's value is highlighted by order
// (UK/US/EU always in that order for consistency).
export function formatShoeTrio(value, region, fit) {
  const c = convertShoe(value, region, fit);
  if (!c) return null;
  return `UK ${c.uk} · US ${c.us} · EU ${c.eu}`;
}
