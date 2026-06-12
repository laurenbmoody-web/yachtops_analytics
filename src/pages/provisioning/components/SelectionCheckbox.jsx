import React from 'react';

// ── SelectionCheckbox ───────────────────────────────────────────────────────
// Custom-styled checkbox for selection surfaces. Replaces the native UA
// checkmark glyph (which renders pixelated at small sizes on some setups)
// with an inline SVG checkmark that anti-aliases cleanly via currentColor.
//
// Origin: extracted from ProvisioningBoardDetail.jsx where the same
// markup lived for the items-list bulk-selection model. Lifted into a
// shared component (Phase X — checkbox SVG-check sweep) so every
// selection surface can adopt it without re-implementing.
//
// Indeterminate state intentionally omitted — the dash glyph reads as
// "remove" which is the opposite of "some selected". The "some
// selected" UI signal lives in the floating action bar's count, not
// on the header checkbox.
//
// Styles live in components/bulk-action-bar.css (.pv-sel-checkbox-*
// class set). Consumers must ensure that stylesheet is loaded.
//
// Props:
//   checked     — controlled checked state.
//   onChange    — change handler. Receives the native event.
//   ariaLabel   — accessibility label for the input.

export default function SelectionCheckbox({ checked, onChange, ariaLabel }) {
  return (
    <label className="pv-sel-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        className="pv-sel-checkbox-input"
      />
      <span className="pv-sel-checkbox-box">
        {checked && (
          <svg className="pv-sel-checkbox-tick" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3.5 8 7 11 12.5 5" />
          </svg>
        )}
      </span>
    </label>
  );
}
