import React from 'react';

// A wardrobe / armoire glyph in the lucide stroke style — the icon set has no
// literal closet, so this draws a two-door cabinet with knob dots and legs.
const WardrobeIcon = ({ size = 18, strokeWidth = 2, className = '', ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <rect x="5" y="3" width="14" height="17" rx="1.5" />
    <line x1="12" y1="3" x2="12" y2="20" />
    <path d="M10.2 11.3h.01" />
    <path d="M13.8 11.3h.01" />
    <path d="M7.5 20v1.6" />
    <path d="M16.5 20v1.6" />
  </svg>
);

export default WardrobeIcon;
