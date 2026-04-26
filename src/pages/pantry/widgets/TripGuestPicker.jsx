// TripGuestPicker — pill row of trip guests for note-scoping.
//
// v1: single-select. `selected` is a string id or null; onChange fires
// with the new id (or null when the same selected pill is tapped to
// unscope). Phase D upgrades both call sites to multi-select; the
// upgrade is prop-shape only — onMouseDown.preventDefault() and the
// useGuests source stay the same.
//
// Reads from useGuests() which already filters to is_active_on_trip,
// so the pill row covers AWAKE, ASLEEP, and ASHORE guests — all
// selectable per spec, since a stew can take a note for an ashore
// guest about something to action when they return.
//
// onMouseDown.preventDefault() on each pill is load-bearing: it stops
// the chip stealing focus from the parent input, which keeps the
// keyboard up on mobile and lets parent blur-to-save fire only when
// the user genuinely taps off the surface.

import React from 'react';
import { useGuests } from '../hooks/useGuests';

export default function TripGuestPicker({ selected = null, onChange, ariaLabel = 'Tag note for guest' }) {
  const { guests } = useGuests();

  if (!guests || guests.length === 0) return null;

  return (
    <div className="p-note-chips" role="group" aria-label={ariaLabel}>
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
          >
            {g.first_name}
          </button>
        );
      })}
    </div>
  );
}
