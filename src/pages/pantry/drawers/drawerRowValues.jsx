// Shared helpers that turn the structured data from useGuestDrawerPrefs into
// the string[] of display fragments each DrawerRow expects. Used by both the
// full At-a-glance list (DrawerAtAGlance) and the context-aware RIGHT NOW
// strip (DrawerRightNow) so both surfaces render the same value for a given
// row without drifting.
//
// The hook has already done bucketing, cleansing, and grouping. These
// helpers are narrow shape-converters — bucket entries → values array.

import React from 'react';

export function valuesFromBucket(bucket) {
  return (bucket || []).map(r => r.value);
}

export function valuesFromFoodAvoid(foodAvoid) {
  // For v1 we show the value only — the key (e.g. 'Spice') provides context
  // but the VALUE is what the stew needs to see ("Spicy food (mild
  // tolerance)"). If a row has no value the hook already filtered it.
  return (foodAvoid || []).map(r => r.value);
}

export function valuesFromGuestNotes(notes) {
  if (!notes) return [];
  const out = [];
  for (const t of notes.top_things || []) out.push(t);
  if (notes.communication) out.push(notes.communication);
  if (notes.familiarity)   out.push(notes.familiarity);
  for (const n of notes.priority_notes || []) out.push(n);
  return out;
}

export function routineIsRenderable(routine) {
  return Array.isArray(routine) && routine.length >= 2;
}

// ReactNode label for FOOD · AVOID rows, with only the AVOID span tinted
// terracotta via the .p-drawer-row-label-accent class.
export function labelForFoodAvoid() {
  return (
    <>
      FOOD · <span className="p-drawer-row-label-accent">AVOID</span>
    </>
  );
}

// Maps a drawer row key (matching MOMENT_ROWS in serviceMoment / strip
// mapping) to its display label. Food avoid is a ReactNode; everything
// else is a plain string.
export function labelForRowKey(rowKey) {
  switch (rowKey) {
    case 'hot_drinks':    return 'HOT DRINKS';
    case 'drinks':        return 'DRINKS';
    case 'food_avoid':    return labelForFoodAvoid();
    case 'daily_routine': return 'DAILY ROUTINE';
    case 'guest_notes':   return 'GUEST NOTES';
    case 'ambience':      return 'AMBIENCE';
    default: {
      const s = String(rowKey ?? '');
      return s.toUpperCase().replace(/_/g, ' ');
    }
  }
}
