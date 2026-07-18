// Cargo Accounts — guided budget creation. Turn last season's actual spend into a
// proposed set of budget lines (pure, no imports) so a new budget opens populated and
// season-shaped instead of as an empty grid.
//
// A single baseline uplift (e.g. +5% inflation) seeds every line, but each line can be
// nudged off that baseline — fuel might be +12% on a bunker-price forecast, yard −20%
// with no refit this cycle — and carry a short reason. Those reasons persist as the
// line's note so the plan explains itself when it's shown to management/owners.
//
// Inputs:
//   chart     : [{ bucket, category, code, kind }]        the MYBA lines to seed onto
//   priorRows : [{ category, amount, ym }]                prior-period spend, category
//               already resolved to a chart category where possible; ym = 'YYYY-MM'
//   months    : [{ ym, label }]                           the NEW budget's months, in order
//   opts      : { uplift?, target?, perLine? }
//                 uplift  : baseline percent applied to every line (default 0)
//                 target  : if set, scale the whole plan to hit that total (per-line
//                           uplift + baseline are ignored in target mode)
//                 perLine : { [normCat]: { uplift?: number, reason?: string } }
//                           per-line override of the baseline percent, plus a reason
//
// Prior months map onto new months by calendar position (month-of-year), so July 2026
// spend seeds July 2027. Prior spend for a month the new period doesn't cover is dropped.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
export const normCat = (s) => String(s ?? '').trim().toLowerCase();
const moyOf = (ym) => parseInt(String(ym || '').slice(5, 7), 10) || 0;

// month-of-year (1..12) -> first new ym that covers it
const moyIndex = (months) => {
  const m = new Map();
  (months || []).forEach((mo) => { const k = moyOf(mo.ym); if (k && !m.has(k)) m.set(k, mo.ym); });
  return m;
};

export const computeSeed = (chart, priorRows, months, opts = {}) => {
  const byMoy = moyIndex(months);
  const baseline = num(opts.uplift);
  const perLine = opts.perLine || {};
  const hasTarget = opts.target != null && Number.isFinite(Number(opts.target));

  // Aggregate prior spend onto each chart category, per new-period month (raw, pre-uplift).
  const acc = new Map(); // normCat -> { annual, monthly: Map(ym->amt) }
  (priorRows || []).forEach((row) => {
    const targetYm = byMoy.get(moyOf(row.ym));
    if (!targetYm) return;                         // month not in the new period
    const key = normCat(row.category);
    if (!acc.has(key)) acc.set(key, { annual: 0, monthly: new Map() });
    const a = acc.get(key);
    const v = num(row.amount);
    a.annual += v;
    a.monthly.set(targetYm, (a.monthly.get(targetYm) || 0) + v);
  });

  const rawTotal = [...acc.values()].reduce((s, a) => s + a.annual, 0);
  const targetFactor = hasTarget ? (rawTotal > 0 ? num(opts.target) / rawTotal : 0) : null;

  // One output row per chart line. Expense lines seed from spend at their effective
  // uplift; revenue and unmatched lines land at 0 for you to fill.
  const lines = (chart || []).map((c) => {
    const key = normCat(c.category);
    const src = c.kind === 'revenue' ? null : acc.get(key);
    const ov = perLine[key] || {};
    const upliftPct = ov.uplift != null && Number.isFinite(Number(ov.uplift)) ? num(ov.uplift) : baseline;
    const factor = hasTarget ? targetFactor : 1 + upliftPct / 100;
    const priorAmount = src ? r2(src.annual) : 0;

    const monthly = {};
    let amount = 0;
    if (src) {
      src.monthly.forEach((v, ym) => { const s = r2(v * factor); if (s) { monthly[ym] = s; amount = r2(amount + s); } });
    }
    return {
      bucket: c.bucket, category: c.category, code: c.code || null, kind: c.kind || 'expense',
      amount, monthly, priorAmount,
      upliftPct: hasTarget ? null : upliftPct,          // n/a in target mode
      adjusted: !hasTarget && upliftPct !== baseline,   // differs from the baseline
      reason: (ov.reason || '').trim() || null,
    };
  });

  const seededTotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const seededCount = lines.filter((l) => l.amount > 0).length;
  return { lines, seededTotal, seededCount, priorTotal: r2(rawTotal), baseline };
};

// The prior period to seed from: the same-length span shifted back one year. For
// 2027 Season (01/01/2027–31/12/2027) that's 2026 Season. ISO dates in, ISO out.
export const priorPeriodOf = (startISO, endISO) => {
  const back = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y) return iso;
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  return { from: back(startISO), to: back(endISO) };
};
