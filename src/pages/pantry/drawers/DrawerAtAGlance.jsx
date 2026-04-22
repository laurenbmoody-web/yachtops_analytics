import React from 'react';
import DrawerRow from './DrawerRow';
import DailyRoutineTimeline from './DailyRoutineTimeline';

// Renders the 6-row curated At-a-glance list from the structured data
// returned by useGuestDrawerPrefs(guestId). Empty rows auto-skip inside
// DrawerRow — we don't gate here. If EVERY row is empty (guest has no
// structured prefs at all), render the "no prefs yet" empty copy instead
// so the section isn't completely blank under its heading.
//
// DAILY ROUTINE breaks the label+values pattern: its right-hand slot is
// the DailyRoutineTimeline component (horizontal mini-timeline, serif time
// above tracked-caps label). We gate its rendering on >=2 anchors upstream
// rather than relying on DrawerRow's auto-skip, because the children slot
// always renders when provided.

const GUEST_NOTES_CHAR_CAP = 120;

function labelForFoodAvoid() {
  // ReactNode label so only the AVOID span gets the terracotta accent.
  return (
    <>
      FOOD · <span className="p-drawer-row-label-accent">AVOID</span>
    </>
  );
}

// Join the bucketed {key, value} rows into value-only display fragments.
// Hook already trims values and filters empties.
function valuesFromBucket(bucket) {
  return (bucket || []).map(r => r.value);
}

function valuesFromFoodAvoid(foodAvoid) {
  // For v1 we show the value only — the key (e.g. 'Spice') provides context
  // but the VALUE is what the stew needs to see ("Avoid spicy food
  // (tolerance: mild)"). If a row has no value we've already filtered it.
  return (foodAvoid || []).map(r => r.value);
}

function valuesFromGuestNotes(notes) {
  if (!notes) return [];
  const out = [];
  for (const t of notes.top_things || []) out.push(t);
  if (notes.communication) out.push(notes.communication);
  if (notes.familiarity)   out.push(notes.familiarity);
  for (const n of notes.priority_notes || []) out.push(n);
  return out;
}

function routineIsRenderable(routine) {
  return Array.isArray(routine) && routine.length >= 2;
}

export default function DrawerAtAGlance({ data, loading, error }) {
  if (loading) {
    return (
      <div className="p-drawer-atglance">
        <div className="p-drawer-atglance-empty">Loading preferences…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-drawer-atglance">
        <div className="p-drawer-atglance-empty" style={{ color: 'var(--accent)' }}>
          Failed to load preferences: {error}
        </div>
      </div>
    );
  }

  const safe = data || {};
  const hotDrinks = valuesFromBucket(safe.hot_drinks);
  const drinks    = valuesFromBucket(safe.drinks);
  const foodAvoid = valuesFromFoodAvoid(safe.food_avoid);
  const hasRoutine = routineIsRenderable(safe.routine);
  const notes     = valuesFromGuestNotes(safe.guest_notes);
  const ambience  = valuesFromBucket(safe.ambience);

  const allEmpty =
    hotDrinks.length === 0 &&
    drinks.length === 0 &&
    foodAvoid.length === 0 &&
    !hasRoutine &&
    notes.length === 0 &&
    ambience.length === 0;

  if (allEmpty) {
    return (
      <div className="p-drawer-atglance">
        <div className="p-drawer-atglance-empty">
          No preferences saved yet. Tap 'Full preferences →' to add them, or dictate them with the mic.
        </div>
      </div>
    );
  }

  return (
    <div className="p-drawer-atglance">
      <DrawerRow label="HOT DRINKS"    values={hotDrinks} />
      <DrawerRow label="DRINKS"        values={drinks} />
      <DrawerRow label={labelForFoodAvoid()} values={foodAvoid} />
      {hasRoutine && (
        <DrawerRow label="DAILY ROUTINE">
          <DailyRoutineTimeline anchors={safe.routine} />
        </DrawerRow>
      )}
      <DrawerRow label="GUEST NOTES"   values={notes} charCap={GUEST_NOTES_CHAR_CAP} />
      <DrawerRow label="AMBIENCE"      values={ambience} />
    </div>
  );
}
