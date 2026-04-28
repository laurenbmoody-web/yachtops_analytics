// TripGuestPicker — pill row of trip guests for note-scoping.
//
// v2 (Phase D): multi-select. `selected` is a string[] of guest UUIDs;
// onChange fires with the new array. Tap a pill to toggle: absent →
// added at end of array, present → removed. Empty array is the
// unscoped/general state.
//
// Reads from useGuests() (already filtered to is_active_on_trip), so
// the pill row covers AWAKE, ASLEEP, and ASHORE guests — all
// selectable per spec, since a stew can take a note for an ashore
// guest about something to action when they return.
//
// `guests` prop lets the parent pass an already-fetched list to skip
// the duplicate fetch — important for surfaces (the standby widget)
// that already call useGuests() for other reasons. With the prop the
// picker renders synchronously the first time it appears.
//
// `hidden` prop toggles visibility without un-mounting. Mounting is
// always-on so guest data is ready instantly when the parent's input
// gets focus — the previous focus-gated mount caused a visible beat
// before the pills appeared.
//
// onMouseDown.preventDefault() on each pill is load-bearing: it stops
// the chip stealing focus from the parent input, which keeps the
// keyboard up on mobile and lets parent blur-to-save fire only when
// the user genuinely taps off the surface.

import React from 'react';
import { useGuests } from '../hooks/useGuests';

export default function TripGuestPicker({
  selected = [],
  onChange,
  guests: guestsProp = null,
  hidden = false,
  ariaLabel = 'Tag note for guest',
}) {
  // Fall back to the hook only when the parent didn't pass guests.
  // Calling useGuests() unconditionally is fine — it's idempotent
  // per-tenant, but skipping the fetch is faster and quieter.
  const internal = useGuests();
  const guests = guestsProp ?? internal.guests;

  if (!guests || guests.length === 0) return null;

  const selectedArr = Array.isArray(selected) ? selected : [];
  const selectedSet = new Set(selectedArr);

  const toggle = (id) => {
    if (selectedSet.has(id)) onChange(selectedArr.filter(x => x !== id));
    else                     onChange([...selectedArr, id]);
  };

  return (
    <div
      className={`p-note-chips${hidden ? ' is-hidden' : ''}`}
      role="group"
      aria-label={ariaLabel}
      aria-hidden={hidden || undefined}
    >
      {guests.map(g => {
        const isSelected = selectedSet.has(g.id);
        return (
          <button
            type="button"
            key={g.id}
            className={`p-note-chip${isSelected ? ' selected' : ''}`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => toggle(g.id)}
            aria-pressed={isSelected}
            aria-label={`Tag note for ${g.first_name}`}
            tabIndex={hidden ? -1 : 0}
          >
            {g.first_name}
          </button>
        );
      })}
    </div>
  );
}
