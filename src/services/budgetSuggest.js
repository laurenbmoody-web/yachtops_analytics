// Cargo Accounts — guided-create "Suggest %" (pure, no imports). Proposes a per-line
// uplift for a new budget, grounded so the reason shown to owners is defensible:
//
//   1. This vessel's own year-over-year trend, where two prior seasons exist — the
//      strongest signal, because it already knows THIS boat (fuel runs hot, wages flat).
//   2. Otherwise a curated category-sensitivity default — how that KIND of cost
//      typically moves — so a first budget with no history still beats a flat number.
//
// It never invents a macro figure ("+7% because inflation") — every suggestion cites a
// real basis. Output is the { normCat: { uplift, reason } } shape the create screen's
// per-line editors already consume.

const normCat = (s) => String(s ?? '').trim().toLowerCase();
const clampRound = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

// Category sensitivity by MYBA code — the fallback when there's no usable history.
// pct = typical annual movement; reason = the one-line justification.
const SENSITIVITY_BY_CODE = {
  OCW: { pct: 3, reason: 'Crew wages — contracted, typical annual step' },
  CCW: { pct: 3, reason: 'Casual crew wages — market rate' },
  CTE: { pct: 4, reason: 'Crew travel — airfare inflation' },
  CFC: { pct: 5, reason: 'Crew food — grocery inflation' },
  CUF: { pct: 4, reason: 'Uniforms — supplier price inflation' },
  MCC: { pct: 4, reason: 'General crew cost inflation' },
  FLE: { pct: 8, reason: 'Fuel — volatile, marine bunker trend' },
  FLT: { pct: 8, reason: 'Tender fuel — tracks marine fuel prices' },
  INS: { pct: 9, reason: 'Marine insurance — hard market, premiums rising' },
  MGE: { pct: 3, reason: 'Management fees — contract escalator' },
  PJT: { pct: 3, reason: 'Project fees — contract escalator' },
  ADM: { pct: 3, reason: 'Administration — general inflation' },
  AGT: { pct: 3, reason: 'Agent fees — contract terms' },
  GFE: { pct: 5, reason: 'Guest provisioning — food inflation' },
  GWS: { pct: 5, reason: 'Guest wine — supplier price inflation' },
  GCT: { pct: 4, reason: 'Guest travel — transport inflation' },
  FLO: { pct: 4, reason: 'Flowers — supplier price inflation' },
  GME: { pct: 4, reason: 'Guest misc — general inflation' },
  SHY: { pct: 6, reason: 'Yard rates — labour & berth inflation' },
  RFT: { pct: 6, reason: 'Refit — yard labour inflation' },
  DSR: { pct: 5, reason: 'Deck spares — parts inflation' },
  ESR: { pct: 5, reason: 'Engineer spares — parts inflation' },
  ISR: { pct: 5, reason: 'Interior spares — parts inflation' },
  SPW: { pct: 6, reason: 'Shore power & water — utility inflation' },
  HAR: { pct: 5, reason: 'Harbour dues — port tariff inflation' },
};
const DEFAULT_SENSITIVITY = { pct: 4, reason: 'General cost inflation' };

// yoyByCat: { normCat: { recent, prev, pct } }  from the two prior seasons.
// opts.recentYear / prevYear label the trend reason. minPrev guards tiny lines whose
// % swings are noise. clamp bounds an extreme trend to a sane planning range.
export const computeSuggestions = (chart, yoyByCat, opts = {}) => {
  const { recentYear, prevYear, minPrev = 500, clampLo = -40, clampHi = 60 } = opts;
  const yoy = yoyByCat || {};
  const out = {};
  (chart || []).forEach((c) => {
    if (c.kind === 'revenue') return;
    const key = normCat(c.category);
    const y = yoy[key];
    if (y && y.prev >= minPrev && y.recent > 0 && y.pct != null && Number.isFinite(y.pct)) {
      const uplift = clampRound(y.pct, clampLo, clampHi);
      const span = prevYear && recentYear ? `${prevYear}→${recentYear}` : 'last two seasons';
      out[key] = { uplift, reason: `Matches your ${span} spend trend`, basis: 'history' };
    } else {
      const s = SENSITIVITY_BY_CODE[c.code] || DEFAULT_SENSITIVITY;
      out[key] = { uplift: s.pct, reason: s.reason, basis: 'sensitivity' };
    }
  });
  return out;
};

export { SENSITIVITY_BY_CODE, DEFAULT_SENSITIVITY };
