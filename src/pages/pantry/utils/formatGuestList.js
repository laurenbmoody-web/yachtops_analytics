// Format a list of guest UUIDs into a "for John, Jane and Susan"-style
// fragment for stew-note rows. Reads from a Map<id, guestRow> the
// caller already built from useGuests() — keeps the helper pure.
//
// Truncates to first-two-plus-N at 4+ guests so the meta line doesn't
// get unwieldy. The full set is always available on the underlying
// note record if a future tooltip / drawer wants to show it.

export function formatGuestList(guestIds, guestById) {
  if (!Array.isArray(guestIds) || guestIds.length === 0) return '';

  const names = guestIds
    .map(id => guestById?.get?.(id)?.first_name)
    .filter(Boolean);

  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}
