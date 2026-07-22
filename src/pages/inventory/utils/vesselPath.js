// Trim a stored vessel-location path to "from the space (room pin) onwards".
// The vessel map is Deck › Zone › Space › (sub-space …), so we drop the first
// two levels (deck + zone) and keep the space and anything nested under it.
// A shorter path (≤2 segments) is returned as-is.
export const spaceSegments = (label) => {
  const parts = String(label || '')
    .split(/[›>]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 2 ? parts.slice(2) : parts;
};

// Just the end location (the leaf), e.g. "Container 1" or "Owner's Cabin".
export const spaceLeaf = (label) => {
  const segs = spaceSegments(label);
  return segs.length ? segs[segs.length - 1] : '';
};
