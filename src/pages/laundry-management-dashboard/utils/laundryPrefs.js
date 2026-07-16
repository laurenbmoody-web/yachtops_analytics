// Surface a guest's laundry-relevant preferences when they're picked in the
// Add Laundry modal — e.g. "sensitive detergent only", "dry clean, no starch",
// "hang, don't fold". Preferences don't have a dedicated Laundry category, so we
// match laundry wording across whatever category the crew filed them under.

import { getPreferencesByGuest } from '../../../utils/preferencesStorage';

const LAUNDRY_RX = /laundr|detergent|fabric|soften|starch|\biron(?:ed|ing)?\b|press(?:ed|ing)?|dry.?clean|hand.?wash|delicate|\bhang\b|\bfold\b|bleach|hypoaller|\bwash\b|linen|garment|silk|cashmere|tumble/i;
const RANK = { high: 0, normal: 1, low: 2 };

export async function getGuestLaundryNotes(guestId) {
  if (!guestId) return [];
  let prefs = [];
  try { prefs = await getPreferencesByGuest(guestId); } catch { return []; }
  const seen = new Set();
  return (prefs || [])
    .filter((p) => {
      const hay = `${p.key || ''} ${p.value || ''} ${(p.tags || []).join(' ')}`;
      return LAUNDRY_RX.test(hay);
    })
    .sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1))
    .map((p) => ({ text: String(p.value || p.key || '').trim(), priority: p.priority || 'normal' }))
    .filter((n) => {
      const k = n.text.toLowerCase();
      if (!n.text || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
