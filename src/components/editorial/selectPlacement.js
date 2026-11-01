// Where a dropdown's list should hang, and how tall it may be.
//
// A list is absolutely positioned, so it cannot make the page taller: opened
// near the bottom of the window it hangs below the fold with nothing to
// scroll to. The old behaviour was "always downward, always up to 264px",
// which is right until the field is low on screen — and on a long record
// most fields are.
//
// Pure so it can be tested without a browser; the component only supplies
// measurements and applies the answer.

export const DEFAULT_MAX = 264;
export const MIN_HEIGHT = 132;
export const GUTTER = 12;

/**
 * All measurements are in viewport coordinates.
 *
 * `boundsTop`/`boundsBottom` are the edges of whatever the list is really
 * confined by. Usually that is the window, but a select inside a scrolling
 * panel — the add-guest modal is `max-height: 90vh; overflow-y: auto` — is
 * clipped by the panel instead, and the list cannot extend that panel's
 * scroll height any more than it can the page's. Measuring the window there
 * would call a list "fits" while the panel cut it off.
 *
 * @param {object} m
 * @param {number} m.triggerTop     field's top edge
 * @param {number} m.triggerBottom  field's bottom edge
 * @param {number} m.contentHeight  the list's natural (unclamped) height
 * @param {number} [m.viewportHeight] shorthand for bounds of 0..viewportHeight
 * @param {number} [m.boundsTop]    top edge of the confining box
 * @param {number} [m.boundsBottom] bottom edge of the confining box
 * @param {number} [m.maxHeight]    cap, however much room there is
 * @param {number} [m.minHeight]    never squash the ROOM below this
 * @param {number} [m.gutter]       breathing room against the edges
 * @returns {{ up: boolean, maxHeight: number }}
 */
export function placeMenu({
  triggerTop,
  triggerBottom,
  viewportHeight,
  boundsTop = 0,
  boundsBottom,
  contentHeight,
  maxHeight = DEFAULT_MAX,
  minHeight = MIN_HEIGHT,
  gutter = GUTTER,
}) {
  const lower = boundsBottom ?? viewportHeight;
  const below = Math.max(0, lower - triggerBottom - gutter);
  const above = Math.max(0, triggerTop - boundsTop - gutter);

  // The height we would like: the content, never more than the cap. A
  // contentHeight of 0 means "not measured yet", not "empty" — an empty list
  // still draws its no-options line — so fall back to the cap rather than
  // collapsing the panel to nothing.
  const natural = contentHeight > 0 ? contentHeight : maxHeight;
  const wanted = Math.min(natural, maxHeight);

  // Stay down when it fits down. Only flip when it does not fit below AND
  // there is genuinely more room above — flipping into an equally bad space
  // just moves the problem and costs the reader their place.
  const up = wanted > below && above > below;

  const room = up ? above : below;

  // The floor applies to the ROOM, not to the list: a three-option list is
  // allowed to be short. It is being squeezed by a cramped window that makes
  // a list unusable, and past that point it overhangs rather than becoming a
  // two-line peephole.
  return { up, maxHeight: Math.min(wanted, Math.max(minHeight, room)) };
}
