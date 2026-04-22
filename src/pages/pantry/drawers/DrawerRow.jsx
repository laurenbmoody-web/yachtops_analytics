import React from 'react';

// Generic row primitive for the drawer's At-a-glance list.
//
// Props:
//   - label:    string OR ReactNode. Rendered in the fixed-width label column.
//               Pass a ReactNode when a portion of the label needs accent
//               colour — e.g. the AVOID span on the FOOD · AVOID row.
//   - values:   string[] of already-rendered display fragments. Joined with
//               " · " (spaced middle dot) per spec.
//   - charCap:  optional character cap on the joined values string. Applies a
//               graceful "…" truncation so the row can't overflow the drawer.
//               Used for GUEST NOTES at ~120 chars per spec; other rows omit.
//
// If values is empty or contains only empty fragments, the row returns null
// so the parent doesn't render an empty label.
export default function DrawerRow({ label, values, charCap = null }) {
  const fragments = (values || []).map(v => (v ?? '').trim()).filter(Boolean);
  if (fragments.length === 0) return null;

  let joined = fragments.join(' · ');
  if (charCap && joined.length > charCap) {
    joined = joined.slice(0, charCap).trimEnd().replace(/[,.·\s]+$/, '') + '…';
  }

  return (
    <div className="p-drawer-row">
      <div className="p-drawer-row-label">{label}</div>
      <div className="p-drawer-row-values">{joined}</div>
    </div>
  );
}
