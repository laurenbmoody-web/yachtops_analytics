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
//   - children: optional ReactNode rendered in the values slot in place of
//               the joined string. Used by the DAILY ROUTINE row whose
//               content is a mini-timeline component rather than text. When
//               children is provided, values/charCap are ignored and the
//               row renders unconditionally (caller is responsible for
//               deciding whether the row should appear).
//
// Without children: if values is empty or contains only empty fragments,
// the row returns null so the parent doesn't render an empty label.
export default function DrawerRow({ label, values, charCap = null, children = null }) {
  if (children != null) {
    return (
      <div className="p-drawer-row">
        <div className="p-drawer-row-label">{label}</div>
        <div className="p-drawer-row-values">{children}</div>
      </div>
    );
  }

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
