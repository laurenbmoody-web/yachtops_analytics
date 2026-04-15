import React, { useState, useEffect } from 'react';

const NAVY   = '#1E3A5F';
const GREY   = '#CBD5E1';
const LINK_COUNT = 8;
const LINK_SPACING = 18; // px, center-to-center
const CHAIN_TOP    = 8;  // px, space for cleat above first link center

// Link geometry — alternating vertical / horizontal
const LINK_RX = (i) => (i % 2 === 0 ? 6 : 9);   // even = vertical, odd = horizontal
const LINK_RY = (i) => (i % 2 === 0 ? 9 : 6);
const LINK_CY = (i) => CHAIN_TOP + i * LINK_SPACING + LINK_SPACING / 2;
// Link 0 cy=17, link 7 cy=143; bottom of link 7 (horizontal, ry=6) = 149

// Anchor ring sits just below the last link
const RING_CY    = 157;
const SHANK_TOP  = 161;
const SHANK_BOT  = 201;
const STOCK_Y    = 165;
const CROWN_Y    = 199;

// CSS injected inside the SVG for the drop transition + sway animation
const INNER_CSS = `
  #cg-rig { transform: translate(0, var(--drop, 0px)); transition: transform 900ms cubic-bezier(0.25, 0.8, 0.3, 1); }
  #cg-anchor { transform-origin: 40px ${RING_CY}px; animation: cgAnchorSway 4s ease-in-out infinite; }
  @keyframes cgAnchorSway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
`;

// SVG total height: cleat (8) + 8 links (144) + ring + shank + flukes ≈ 220 + some padding
const SVG_H = 230;

const AnchorChainProgress = ({ percent }) => {
  const [animPercent, setAnimPercent] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimPercent(percent), 120);
    return () => clearTimeout(t);
  }, [percent]);

  const filledLinks = Math.round((animPercent / 100) * LINK_COUNT);
  // Gentle descent: at 100% the rig has dropped 16px — stays well within SVG bounds
  const drop = (percent * 0.16).toFixed(2);

  return (
    <div style={{ flexShrink: 0, width: 80 }}>
      <svg
        width="80"
        height={SVG_H}
        viewBox={`0 0 80 ${SVG_H}`}
        style={{ '--drop': `${drop}px`, overflow: 'visible' }}
        aria-hidden="true"
      >
        <style>{INNER_CSS}</style>

        <g id="cg-rig">
          {/* ── Cleat (mount point at top) ── */}
          <rect x="29" y="0" width="22" height="8" rx="3" fill={NAVY} />

          {/* ── Chain links ── */}
          {Array.from({ length: LINK_COUNT }).map((_, i) => {
            const filled = i < filledLinks;
            return (
              <ellipse
                key={i}
                cx="40"
                cy={LINK_CY(i)}
                rx={LINK_RX(i)}
                ry={LINK_RY(i)}
                style={{
                  fill: filled ? NAVY : 'none',
                  stroke: filled ? NAVY : GREY,
                  strokeWidth: 1.8,
                  transition: `fill 450ms ease ${i * 40}ms, stroke 450ms ease ${i * 40}ms`,
                }}
              />
            );
          })}

          {/* ── Anchor ── */}
          <g id="cg-anchor">
            {/* Ring — open circle, stroke only */}
            <circle
              cx="40" cy={RING_CY} r="5.5"
              fill="none" stroke={NAVY} strokeWidth="2.2"
            />
            {/* Shank */}
            <rect x="38.5" y={SHANK_TOP} width="3" height={SHANK_BOT - SHANK_TOP} rx="1.5" fill={NAVY} />
            {/* Stock */}
            <rect x="20" y={STOCK_Y} width="40" height="4" rx="2" fill={NAVY} />
            {/* Crown cross-piece */}
            <rect x="27" y={CROWN_Y} width="26" height="4" rx="2" fill={NAVY} />
            {/* Left fluke */}
            <path
              d={`M27,${CROWN_Y + 2} L20,${CROWN_Y + 2} Q14,${CROWN_Y + 2} 14,${CROWN_Y + 9} Q14,${CROWN_Y + 16} 20,${CROWN_Y + 16} Q25,${CROWN_Y + 16} 27,${CROWN_Y + 11} L33,${CROWN_Y + 5} Z`}
              fill={NAVY}
            />
            {/* Right fluke */}
            <path
              d={`M53,${CROWN_Y + 2} L60,${CROWN_Y + 2} Q66,${CROWN_Y + 2} 66,${CROWN_Y + 9} Q66,${CROWN_Y + 16} 60,${CROWN_Y + 16} Q55,${CROWN_Y + 16} 53,${CROWN_Y + 11} L47,${CROWN_Y + 5} Z`}
              fill={NAVY}
            />
          </g>
        </g>
      </svg>
    </div>
  );
};

export default AnchorChainProgress;
