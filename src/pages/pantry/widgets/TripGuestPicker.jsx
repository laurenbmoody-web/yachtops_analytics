// TripGuestPicker — pill row of trip guests for note-scoping.
//
// v1: single-select. `selected` is a string id or null; onChange fires
// with the new id (or null when the same selected pill is tapped to
// unscope). Phase D upgrades both call sites to multi-select; the
// upgrade is prop-shape only — onMouseDown.preventDefault() and the
// useGuests source stay the same.
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
  selected = null,
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

  return (
    <div
      className={`p-note-chips${hidden ? ' is-hidden' : ''}`}
      role="group"
      aria-label={ariaLabel}
      aria-hidden={hidden || undefined}
    >
      {guests.map(g => {
        const isSelected = selected === g.id;
        return (
          <button
            type="button"
            key={g.id}
            className={`p-note-chip${isSelected ? ' selected' : ''}`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onChange(isSelected ? null : g.id)}
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
