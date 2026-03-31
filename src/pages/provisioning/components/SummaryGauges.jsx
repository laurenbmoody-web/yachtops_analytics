import React, { useState, useEffect } from 'react';

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
export const SemiGauge = ({ pct = 0, gradientId, gradFrom, gradTo, delay = 0 }) => {
  const animPct = useCountUp(Math.max(0, Math.min(1, pct)), delay);
  const dashoffset = 100 * (1 - animPct);
  return (
    <svg viewBox="0 0 120 68" width="120" height="68" style={{ overflow: 'visible', display: 'block', margin: '0 auto' }}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="110" y2="0">
          <stop offset="0%" stopColor={gradFrom} />
          <stop offset="100%" stopColor={gradTo} />
        </linearGradient>
      </defs>
      {/* Track */}
      <path d="M 10,64 A 54,54 0 0,1 110,64" fill="none" stroke="#CBD5E1" strokeWidth="8"
        strokeLinecap="round" pathLength="100" opacity="0.4" />
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

  const cardStyle = {
    background: 'var(--color-background-secondary, white)',
    borderRadius: 'var(--border-radius-lg, 12px)',
    padding: '1.5rem 1.25rem',
    textAlign: 'center',
    border: '1px solid #F1F5F9',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>

        {/* Card 1: Items */}
        <div style={cardStyle}>
          <SemiGauge pct={itemPct} gradientId="gauge-items" gradFrom="#1D9E75" gradTo="#5DCAA5" delay={0} />
          <div style={{ marginTop: -4 }}>
            <p style={{ fontSize: 30, fontWeight: 700, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}>
              {Math.round(animItemLeft)} item{Math.round(animItemLeft) !== 1 ? 's' : ''}
            </p>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: '4px 0 6px' }}>left to receive</p>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#1D9E75' }}>{receivedCount} of {totalCount} received</p>
          </div>
        </div>

        {/* Card 2: Total cost (no gauge arc) */}
        <div style={{ ...cardStyle, justifyContent: 'center', gap: 6 }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94A3B8', margin: 0 }}>Total cost</p>
          <p style={{ fontSize: 36, fontWeight: 700, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em', margin: '8px 0 4px' }}>
            {dispSymbol}{Math.round(animTotal).toLocaleString()}
          </p>
          <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>{costSubtext}</p>
        </div>

        {/* Card 3: Payments */}
        <div style={cardStyle}>
          <SemiGauge pct={paymentPct} gradientId="gauge-payments" gradFrom="#BA7517" gradTo="#EF9F27" delay={300} />
          <div style={{ marginTop: -4 }}>
            <p style={{ fontSize: 30, fontWeight: 700, color: '#0F172A', lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}>
              {dispSymbol}{Math.round(animLeftToPay).toLocaleString()}
            </p>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: '4px 0 6px' }}>left to pay</p>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#15803D' }}>{dispSymbol}{Math.round(animPaid).toLocaleString()} paid</p>
          </div>
        </div>

      </div>

      {/* Currency toggle + FX label */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {CURR_PILLS.map((pill, idx) => {
            const active = dispCurr === pill.code;
            return (
              <React.Fragment key={pill.code}>
                {idx > 0 && <span style={{ fontSize: 11, color: '#E2E8F0', margin: '0 6px', userSelect: 'none' }}>·</span>}
                <button
                  onClick={() => setDisplayCurrency(pill.code)}
                  style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? '#1E3A5F' : '#CBD5E1', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {pill.symbol} {pill.code}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        {fxRatesLabel && <span style={{ fontSize: 10, color: '#CBD5E1', marginTop: 4 }}>{fxRatesLabel}</span>}
      </div>
    </div>
  );
};

export default SummaryGauges;
