// Deck ordering — shared by ManageScans (the reel) and the map's room picker so
// rooms always travel down the vessel in the same order in both places.
//
// Top of the vessel downward where names match convention, alphabetical
// otherwise, unassigned last. A rank helper, nothing cleverer.
const DECK_KEYWORDS = ['sun', 'bridge', 'main', 'lower', 'tank'];

export const deckRank = (deck) => {
  const d = (deck || '').toLowerCase();
  const i = DECK_KEYWORDS.findIndex((k) => d.includes(k));
  return i === -1 ? DECK_KEYWORDS.length : i;
};

// Reel order: decks in vessel order (unassigned last), then row order
// (sort_order, created_at) within each deck.
export const reelOrder = (scans) => [...scans].sort((a, b) => {
  const ad = (a.deck || '').trim(); const bd = (b.deck || '').trim();
  if (!ad !== !bd) return ad ? -1 : 1;
  if (ad && bd) {
    const r = deckRank(ad) - deckRank(bd);
    if (r !== 0) return r;
    const alpha = ad.toLowerCase().localeCompare(bd.toLowerCase());
    if (alpha !== 0) return alpha;
  }
  const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (so !== 0) return so;
  return String(a.created_at).localeCompare(String(b.created_at));
});
