import React from 'react';

// Horizontal mini-timeline of time/label pairs for the DAILY ROUTINE row.
//
// Props:
//   - anchors:             [{ time: "07:30", label: "Breakfast Time",
//                             short: "BREAKFAST", sortKey: 450 }]
//                          Expected pre-sorted by sortKey — the hook's
//                          parseRoutineAnchor + sort step guarantees this.
//   - highlightKey:        Optional exact-match on `label`. The matching
//                          anchor renders with terracotta emphasis. Used
//                          by the Phase 5 RIGHT NOW strip to call out the
//                          current moment's anchor. Not used in the main
//                          At a glance list.
//   - currentMinuteOfDay:  Optional integer 0-1439. If null, derived from
//                          the browser's local time. Exposed as a prop for
//                          testing and so Phase 5 can pass a moment-derived
//                          value without this component recomputing.
//                          TODO(phase-2): swap browser local for a vessel-
//                          local time helper when it exists.
//
// Rules:
//   - Fewer than 2 anchors: returns null (row hides entirely).
//   - 2-6 anchors: render all.
//   - More than 6: pick the 5 closest to currentMinuteOfDay, re-sort by
//                  sortKey, and render a "…" marker on whichever side had
//                  anchors omitted (before / after / both).

const MAX_ANCHORS = 6;
const TRIM_TARGET = 5;

function nowMinuteOfDay() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export default function DailyRoutineTimeline({ anchors, highlightKey = null, currentMinuteOfDay = null }) {
  const safe = Array.isArray(anchors) ? anchors : [];
  if (safe.length < 2) return null;

  let displayed = safe;
  let hasBefore = false;
  let hasAfter  = false;

  if (safe.length > MAX_ANCHORS) {
    const nowMin = currentMinuteOfDay ?? nowMinuteOfDay();
    const byDistance = safe
      .map(a => ({ a, dist: Math.abs((a.sortKey ?? 0) - nowMin) }))
      .sort((x, y) => x.dist - y.dist)
      .slice(0, TRIM_TARGET)
      .map(x => x.a);
    byDistance.sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
    const firstSort = byDistance[0]?.sortKey ?? 0;
    const lastSort  = byDistance[byDistance.length - 1]?.sortKey ?? 0;
    hasBefore = safe.some(a => (a.sortKey ?? 0) < firstSort);
    hasAfter  = safe.some(a => (a.sortKey ?? 0) > lastSort);
    displayed = byDistance;
  }

  return (
    <div className="p-drawer-routine-timeline" role="list" aria-label="Daily routine timeline">
      {hasBefore && (
        <div className="p-drawer-routine-ellipsis" aria-hidden="true">…</div>
      )}
      {displayed.map((a, i) => {
        const isHighlighted = highlightKey != null && a.label === highlightKey;
        return (
          <div
            key={a.label ?? `${a.time}-${i}`}
            className={`p-drawer-routine-anchor${isHighlighted ? ' highlight' : ''}`}
            role="listitem"
            aria-label={`${a.short || a.label}: ${a.time}`}
          >
            <div className="p-drawer-routine-time">{a.time}</div>
            <div className="p-drawer-routine-label">{a.short || a.label}</div>
          </div>
        );
      })}
      {hasAfter && (
        <div className="p-drawer-routine-ellipsis" aria-hidden="true">…</div>
      )}
    </div>
  );
}
