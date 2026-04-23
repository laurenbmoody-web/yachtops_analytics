import React from 'react';
import DrawerRow from './DrawerRow';
import DailyRoutineTimeline from './DailyRoutineTimeline';
import {
  valuesFromBucket,
  valuesFromFoodAvoid,
  valuesFromGuestNotes,
  routineIsRenderable,
  labelForRowKey,
} from './drawerRowValues';
import {
  MOMENT_LABELS,
  MOMENT_NEXT_ANCHOR_KEY,
  SERVICE_MOMENTS,
  getCurrentServiceMoment,
  nextKeyTimeForMoment,
  resolveEffectiveMoment,
} from '../utils/serviceMoment';

// Context-aware strip above the full At-a-glance list. Renders 2-3 rows
// specifically relevant to the current service moment so the stew sees the
// imminently-useful preferences first.
//
// Mapping (from the drawer spec §RIGHT NOW · Option B):
//   Breakfast  → HOT DRINKS, FOOD · AVOID, DAILY ROUTINE (breakfast anchor highlighted)
//   Lunch      → FOOD · AVOID, DAILY ROUTINE (lunch anchor highlighted)
//   Afternoon  → DRINKS, AMBIENCE, GUEST NOTES
//   Dinner     → DRINKS, FOOD · AVOID, DAILY ROUTINE (dinner anchor highlighted)
//   Turndown   → AMBIENCE, DAILY ROUTINE (bed anchor highlighted)
//
// Duplication with the main At-a-glance list is intentional — the spec
// says the strip is the quick-reference, the list is the reference.
//
// Edge cases handled here:
//   - guest.current_state === 'ashore' → null. They're not on the boat.
//   - guest.current_state === 'asleep' during Turndown or Breakfast →
//     resolveEffectiveMoment forces Turndown rows.
//   - all rows for the effective moment are empty → null.

const MOMENT_ROWS = {
  [SERVICE_MOMENTS.BREAKFAST]: ['hot_drinks', 'food_avoid', 'daily_routine'],
  [SERVICE_MOMENTS.LUNCH]:     ['food_avoid', 'daily_routine'],
  [SERVICE_MOMENTS.AFTERNOON]: ['drinks', 'ambience', 'guest_notes'],
  [SERVICE_MOMENTS.DINNER]:    ['drinks', 'food_avoid', 'daily_routine'],
  [SERVICE_MOMENTS.TURNDOWN]:  ['ambience', 'daily_routine'],
};

function valuesForRow(rowKey, data) {
  switch (rowKey) {
    case 'hot_drinks':  return valuesFromBucket(data.hot_drinks);
    case 'drinks':      return valuesFromBucket(data.drinks);
    case 'ambience':    return valuesFromBucket(data.ambience);
    case 'food_avoid':  return valuesFromFoodAvoid(data.food_avoid);
    case 'guest_notes': return valuesFromGuestNotes(data.guest_notes);
    default:            return [];
  }
}

export default function DrawerRightNow({ guest, data, nowDate = null }) {
  if (!data) return null;
  if (guest?.current_state === 'ashore') return null;

  const nominal  = getCurrentServiceMoment(nowDate ?? new Date());
  const moment   = resolveEffectiveMoment({ moment: nominal, guestState: guest?.current_state });
  const rowKeys  = MOMENT_ROWS[moment] ?? [];
  if (rowKeys.length === 0) return null;

  // Build a renderable slate: [{ key, kind: 'values'|'routine', values? }].
  // Empty rows drop out here so the all-empty check below is a single scan.
  const slate = rowKeys
    .map(rk => {
      if (rk === 'daily_routine') {
        return routineIsRenderable(data.routine)
          ? { key: rk, kind: 'routine' }
          : null;
      }
      const values = valuesForRow(rk, data);
      return values.length > 0 ? { key: rk, kind: 'values', values } : null;
    })
    .filter(Boolean);

  if (slate.length === 0) return null;

  const momentLabel  = MOMENT_LABELS[moment] ?? '';
  const nextTime     = nextKeyTimeForMoment(moment, data.routine);
  const highlightKey = MOMENT_NEXT_ANCHOR_KEY[moment];

  return (
    <section className="p-drawer-rightnow" aria-label={`Right now · ${momentLabel}`}>
      <div className="p-drawer-rightnow-header">
        <span>Right now</span>
        <span className="p-drawer-rightnow-sep" aria-hidden="true">·</span>
        <span className="p-drawer-rightnow-moment">{momentLabel.toUpperCase()}</span>
        {nextTime && (
          <>
            <span className="p-drawer-rightnow-sep" aria-hidden="true">·</span>
            <span className="p-drawer-rightnow-time">{nextTime}</span>
          </>
        )}
      </div>
      <div className="p-drawer-rightnow-rows">
        {slate.map(row => {
          if (row.kind === 'routine') {
            return (
              <DrawerRow key={row.key} label={labelForRowKey(row.key)}>
                <DailyRoutineTimeline anchors={data.routine} highlightKey={highlightKey} />
              </DrawerRow>
            );
          }
          return (
            <DrawerRow
              key={row.key}
              label={labelForRowKey(row.key)}
              values={row.values}
            />
          );
        })}
      </div>
    </section>
  );
}
