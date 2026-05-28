import React, { useState, useEffect } from 'react';
import './summary-gauges.css';

// ── Count-up animation hook ───────────────────────────────────────────────────
export const useCountUp = (target, delay = 0) => {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf;
    let start = null;
    const duration = 700;
    const from = 0;
    const to = target;
    const tick = (now) => {
      if (!start) start = now + delay;
      const elapsed = Math.max(0, now - start);
      const t = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setVal(from + (to - from) * ease);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay]);
  return val;
};

// ── Semi-circle gauge SVG ─────────────────────────────────────────────────────
//
// Gradient stop colours come from CSS classes (.sg-grad-*-from / -to) so the
// SVG resolves them against the .pv-dashboard --d-* tokens without inline
// hex literals. The `gradientKind` prop picks the gradient pair:
//   'sage'      → progress / received / paid (--d-sage-deep → --d-sage)
//   'attention' → "left to pay" outstanding amount (--d-orange flat-ish)
//
export const SemiGauge = ({ pct = 0, gradientId, gradientKind = 'sage', delay = 0 }) => {
  const animPct = useCountUp(Math.max(0, Math.min(1, pct)), delay);
  const dashoffset = 100 * (1 - animPct);
  const fromClass = `sg-grad-${gradientKind}-from`;
  const toClass   = `sg-grad-${gradientKind}-to`;
  return (
    <svg viewBox="0 0 120 68" width="120" height="68" style={{ overflow: 'visible', display: 'block', margin: '0 auto' }}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="110" y2="0">
          <stop offset="0%"   className={fromClass} />
          <stop offset="100%" className={toClass} />
        </linearGradient>
      </defs>
      {/* Track */}
      <path d="M 10,64 A 54,54 0 0,1 110,64" fill="none" className="sg-gauge-track" strokeWidth="8"
        strokeLinecap="round" pathLength="100" />
      {/* Progress */}
      <path d="M 10,64 A 54,54 0 0,1 110,64" fill="none" stroke={`url(#${gradientId})`}
        strokeWidth="8" strokeLinecap="round" pathLength="100"
        strokeDasharray="100" strokeDashoffset={dashoffset} />
    </svg>
  );
};

export const CURR_PILLS = [
  { code: 'GBP', symbol: '£' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
];

// ── Shared SummaryGauges component ────────────────────────────────────────────
//
// Props (all pre-computed by the caller):
//   Items gauge:    leftToReceive, totalCount, receivedCount
//   Cost gauge:     totalValue, costSubtext
//   Payments gauge: leftToPayValue, paidValue
//   Display:        dispSymbol, dispCurr, setDisplayCurrency, fxRatesLabel
//
const SummaryGauges = ({
  leftToReceive,
  totalCount,
  receivedCount,
  totalValue,
  costSubtext,
  leftToPayValue,
  paidValue,
  dispSymbol,
  dispCurr,
  setDisplayCurrency,
  fxRatesLabel,
}) => {
  const itemPct = totalCount > 0 ? receivedCount / totalCount : 0;
  const totalBoardValue = (paidValue || 0) + (leftToPayValue || 0);
  const paymentPct = totalBoardValue > 0 ? (paidValue || 0) / totalBoardValue : 0;

  const animItemLeft   = useCountUp(leftToReceive  || 0, 0);
  const animTotal      = useCountUp(totalValue     || 0, 150);
  const animLeftToPay  = useCountUp(leftToPayValue || 0, 300);
  const animPaid       = useCountUp(paidValue      || 0, 300);

  return (
    <div>
      <div className="sg-grid">

        {/* Card 1: Items */}
        <div className="sg-card">
          <SemiGauge pct={itemPct} gradientId="gauge-items" gradientKind="sage" delay={0} />
          <div className="sg-gauge-block">
            <p className="sg-value">
              {Math.round(animItemLeft)} item{Math.round(animItemLeft) !== 1 ? 's' : ''}
            </p>
            <p className="sg-sub">left to receive</p>
            <p className="sg-note is-sage">{receivedCount} of {totalCount} received</p>
          </div>
        </div>

        {/* Card 2: Total cost (no gauge arc) */}
        <div className="sg-card is-text-only">
          <p className="sg-eyebrow">Total cost</p>
          <p className="sg-value is-cost">
            {dispSymbol}{Math.round(animTotal).toLocaleString()}
          </p>
          <p className="sg-sub">{costSubtext}</p>
        </div>

        {/* Card 3: Payments */}
        <div className="sg-card">
          <SemiGauge pct={paymentPct} gradientId="gauge-payments" gradientKind="attention" delay={300} />
          <div className="sg-gauge-block">
            <p className="sg-value">
              {dispSymbol}{Math.round(animLeftToPay).toLocaleString()}
            </p>
            <p className="sg-sub">left to pay</p>
            <p className="sg-note is-sage">{dispSymbol}{Math.round(animPaid).toLocaleString()} paid</p>
          </div>
        </div>

      </div>

      {/* Currency toggle + FX label */}
      <div className="sg-curr-wrap">
        <div className="sg-curr-row">
          {CURR_PILLS.map(pill => {
            const active = dispCurr === pill.code;
            return (
              <button
                key={pill.code}
                onClick={() => setDisplayCurrency(pill.code)}
                className={`sg-curr-pill${active ? ' is-active' : ''}`}
              >
                {pill.symbol} {pill.code}
              </button>
            );
          })}
        </div>
        {fxRatesLabel && <span className="sg-fx-label">{fxRatesLabel}</span>}
      </div>
    </div>
  );
};

export default SummaryGauges;
