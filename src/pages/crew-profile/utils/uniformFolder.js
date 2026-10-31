// Charter classification for a uniform item, derived from its inventory folder
// path (location + sub_location). Mirrors the logic the Wardrobe-management crew
// view uses, so the Issued Kit tab, the acknowledgement flow and the exported
// record all read charter-first (On charter → Off charter → General) the same
// way. Accepts either `sub_location` (snake, from the DB / RPC) or `subLocation`
// (camel, from inventoryStorage).

export const CHARTER_ORDER = { 'On charter': 0, 'Off charter': 1, General: 2 };

export const pathSegs = (item) => {
  const sub = item?.sub_location ?? item?.subLocation ?? '';
  const parts = [];
  if (item?.location) parts.push(item.location);
  if (sub) String(sub).split('>').forEach((s) => parts.push(s));
  return parts.map((s) => (s || '').trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase());
};

// Segments below the "Uniform" anchor (where charter/type live).
export const uniformRel = (item) => {
  const segs = pathSegs(item);
  const ui = segs.map((s) => s.toLowerCase()).lastIndexOf('uniform');
  return ui >= 0 ? segs.slice(ui + 1) : segs;
};

export const charterOf = (rel = []) => {
  for (const s of rel) {
    if (/off[\s-]*charter/i.test(s)) return 'Off charter';
    if (/on[\s-]*charter/i.test(s)) return 'On charter';
  }
  return 'General';
};

// Charter for a folder-bearing item ({ location, sub_location|subLocation }).
export const charterOfItem = (item) => (item ? charterOf(uniformRel(item)) : 'General');
