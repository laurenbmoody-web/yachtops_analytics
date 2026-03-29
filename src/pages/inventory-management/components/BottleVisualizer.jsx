import React, { useRef, useCallback, useEffect } from 'react';

// Wine bottle SVG path constants
// Bottle bounding box: width=100, height=220
// Fill area: y=60 (neck base) to y=210 (bottom inside), height=150
const BOTTLE_WIDTH = 100;
const BOTTLE_HEIGHT = 220;
const FILL_TOP = 60;      // y coordinate where liquid fill begins (neck base)
const FILL_BOTTOM = 210;  // y coordinate at bottle bottom (inner)
const FILL_HEIGHT = FILL_BOTTOM - FILL_TOP; // 150px

// Outer bottle shape (wine bottle silhouette)
const BOTTLE_PATH = `
  M 50 5
  C 50 5, 38 8, 36 18
  L 34 40
  C 30 46, 18 52, 16 62
  L 14 195
  C 14 205, 20 215, 50 215
  C 80 215, 86 205, 86 195
  L 84 62
  C 82 52, 70 46, 66 40
  L 64 18
  C 62 8, 50 5, 50 5
  Z
`;

// Clip path for the liquid fill (straight rectangular fill area clipped to bottle shape)
const CLIP_PATH_ID = 'bottleClip';

/**
 * BottleVisualizer
 * @param {number} value - fill level 0–1
 * @param {function} onChange - called with new value 0–1 when user drags
 * @param {number} size - size in px for the container (default 160)
 */
const BottleVisualizer = ({ value = 0, onChange, size = 160 }) => {
  const svgRef = useRef(null);
  const isDragging = useRef(false);

  // Convert fill fraction (0–1) to y coordinate for the fill rectangle top
  // 0 = empty (fill top = FILL_BOTTOM), 1 = full (fill top = FILL_TOP)
  const fractionToY = (fraction) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    return FILL_BOTTOM - clamped * FILL_HEIGHT;
  };

  // Convert SVG y coordinate to fill fraction
  const yToFraction = (svgY) => {
    const fraction = (FILL_BOTTOM - svgY) / FILL_HEIGHT;
    return Math.max(0, Math.min(1, fraction));
  };

  const getSVGY = (clientY) => {
    const svg = svgRef.current;
    if (!svg) return FILL_BOTTOM;
    const rect = svg.getBoundingClientRect();
    const scaleY = BOTTLE_HEIGHT / rect.height;
    return (clientY - rect.top) * scaleY;
  };

  const handlePointerDown = useCallback((e) => {
    isDragging.current = true;
    svgRef.current?.setPointerCapture(e.pointerId);
    const svgY = getSVGY(e.clientY);
    onChange?.(yToFraction(svgY));
  }, [onChange]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    const svgY = getSVGY(e.clientY);
    onChange?.(yToFraction(svgY));
  }, [onChange]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const fillY = fractionToY(value);
  const fillRectHeight = FILL_BOTTOM - fillY;

  // Liquid colour: amber/golden for spirits, shift to red-wine for higher fill
  const fillColor = value > 0.6 ? '#8B1A3A' : '#C4842A';
  const fillColorLight = value > 0.6 ? '#B22254' : '#E09A3A';

  // Percentage label
  const pct = Math.round(value * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
      <svg
        ref={svgRef}
        width={size}
        height={size * (BOTTLE_HEIGHT / BOTTLE_WIDTH)}
        viewBox={`0 0 ${BOTTLE_WIDTH} ${BOTTLE_HEIGHT}`}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          {/* Clip path traces the inner bottle shape */}
          <clipPath id={CLIP_PATH_ID}>
            {/* Neck */}
            <rect x="36" y="15" width="28" height="28" />
            {/* Body */}
            <path d="M 16 62 L 84 62 L 86 195 C 86 205 80 215 50 215 C 20 215 14 205 14 195 Z" />
          </clipPath>
          {/* Wave gradient for liquid surface */}
          <linearGradient id="liquidGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColorLight} stopOpacity="0.9" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Bottle glass — light grey fill */}
        <path
          d={BOTTLE_PATH}
          fill="#E8EDF2"
          stroke="#9BAAB8"
          strokeWidth="2"
        />

        {/* Liquid fill clipped to bottle interior */}
        <g clipPath={`url(#${CLIP_PATH_ID})`}>
          {fillRectHeight > 0 && (
            <rect
              x="0"
              y={fillY}
              width={BOTTLE_WIDTH}
              height={fillRectHeight + 10}
              fill="url(#liquidGrad)"
            />
          )}
          {/* Wavy surface line if not empty/full */}
          {value > 0.02 && value < 0.98 && (
            <path
              d={`M 0 ${fillY} Q 25 ${fillY - 4} 50 ${fillY} Q 75 ${fillY + 4} 100 ${fillY} L 100 ${fillY + 6} Q 75 ${fillY + 10} 50 ${fillY + 6} Q 25 ${fillY + 2} 0 ${fillY + 6} Z`}
              fill={fillColorLight}
              opacity="0.6"
            />
          )}
        </g>

        {/* Bottle outline on top */}
        <path
          d={BOTTLE_PATH}
          fill="none"
          stroke="#6B7F92"
          strokeWidth="2"
        />

        {/* Bottle label area (decorative) */}
        {value < 0.75 && (
          <rect x="24" y="110" width="52" height="44" rx="4" fill="white" fillOpacity="0.35" stroke="#9BAAB8" strokeWidth="0.5" />
        )}

        {/* Drag indicator line */}
        {value > 0.02 && value < 0.98 && (
          <line
            x1="14"
            y1={fillY}
            x2="86"
            y2={fillY}
            stroke="white"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            opacity="0.7"
          />
        )}

        {/* Cork/cap at top */}
        <rect x="40" y="2" width="20" height="14" rx="3" fill="#8B6914" />
        <rect x="42" y="4" width="16" height="10" rx="2" fill="#A07820" />
      </svg>

      {/* Percentage display */}
      <div style={{
        marginTop: 8,
        fontSize: 28,
        fontWeight: 700,
        color: value > 0 ? '#1E3A5F' : '#94A3B8',
        letterSpacing: '-0.5px',
        lineHeight: 1
      }}>
        {pct}%
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
        {value === 0 ? 'Empty' : value >= 1 ? 'Full' : 'Drag to adjust'}
      </div>
    </div>
  );
};

export default BottleVisualizer;
