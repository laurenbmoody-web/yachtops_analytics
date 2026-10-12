// Shared helpers for bonded / duty-free "ship's stores" reporting, used by both
// the PDF and XLSX inventory exports. A bonded-stores summary groups alcohol &
// tobacco by article type with running totals, ordered highest → lowest — the
// shape a UK NMSW FAL 3 Ship's Stores Declaration expects.

const lastSegment = (str) => {
  if (!str) return '';
  const parts = String(str).split(/[›>\/\\|]/).map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || String(str);
};

const cf = (item) => item?.customFields || item?.custom_fields || {};

// Custom-field keys that are internal plumbing, not user-facing attributes — kept
// out of the Details column / spreadsheet columns so exports stay readable.
// Compared after lower-casing and turning spaces into underscores.
export const INTERNAL_CF_KEYS = new Set([
  'profile', 'variantkind', 'variant_kind', 'bonded', 'source',
  'rrpeur', 'rrp_eur', 'dimensions', 'innerboxqty', 'inner_box_qty',
  'ordermultiple', 'order_multiple',
]);

export const normCfKey = (k) => String(k || '').toLowerCase().replace(/\s/g, '_');
export const isInternalCfKey = (k) => INTERNAL_CF_KEYS.has(normCfKey(k));

// A value worth printing: skip objects/arrays (they stringify to "[object Object]")
// and empty values. Returns a clean string or '' to skip.
export const cfDisplayValue = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') return ''; // never "[object Object]"
  const s = String(value).trim();
  return s;
};

// Total on-hand quantity for an item (sum of stock locations, else quantity).
export const bondedTotalQty = (item) => {
  const locs = item?.stockLocations || [];
  if (locs.length) return locs.reduce((sum, l) => sum + (Number(l?.qty) || 0), 0);
  return Number(item?.quantity ?? item?.totalQty ?? 0) || 0;
};

const ALCOHOL_PATH_KW = ['alcohol', 'spirit', 'wine', 'beer', 'champagne', 'bar', 'liqueur', 'cellar', 'bonded', 'tobacco', 'cigar'];

// Bonded / duty-free store item: a bonded profile, the alcohol flag, or a
// bonded/alcohol-sounding folder path. Checks the bonded markers BEFORE the
// isAlcohol flag so tobacco & cigars (isAlcohol === false) are still included.
export const isBondedStore = (item) => {
  const c = cf(item);
  if (c.bonded) return true;
  if (c.profile === 'bonded') return true;
  if (item?.isAlcohol) return true;
  const path = [item?.subLocation, item?.location].filter(Boolean).join(' ').toLowerCase();
  return ALCOHOL_PATH_KW.some((k) => path.includes(k));
};

const KIND_LABEL = {
  spirit: 'Spirits', spirits: 'Spirits', vodka: 'Spirits', gin: 'Spirits', whisky: 'Spirits', whiskey: 'Spirits', rum: 'Spirits', tequila: 'Spirits', brandy: 'Spirits', cognac: 'Spirits',
  wine: 'Wine', wines: 'Wine', red: 'Wine', white: 'Wine', rose: 'Wine', 'rosé': 'Wine',
  champagne: 'Champagne & Sparkling', sparkling: 'Champagne & Sparkling', prosecco: 'Champagne & Sparkling', cava: 'Champagne & Sparkling',
  beer: 'Beer', beers: 'Beer', ale: 'Beer', lager: 'Beer', cider: 'Cider',
  liqueur: 'Liqueurs', liqueurs: 'Liqueurs', aperitif: 'Liqueurs', digestif: 'Liqueurs',
  fortified: 'Fortified wine', port: 'Fortified wine', sherry: 'Fortified wine', vermouth: 'Fortified wine',
  tobacco: 'Tobacco', cigarette: 'Tobacco', cigarettes: 'Tobacco', cigar: 'Cigars', cigars: 'Cigars',
};

// The FAL 3 "Name of article" bucket for a bonded item: its bonded kind, else a
// keyword in the item/folder name, else the folder leaf, else "Other stores".
export const bondedArticle = (item) => {
  const c = cf(item);
  const kind = String(c?.bonded?.kind || '').toLowerCase().trim();
  if (kind && KIND_LABEL[kind]) return KIND_LABEL[kind];
  if (kind) return kind.charAt(0).toUpperCase() + kind.slice(1);
  // Keyword match on the name / folder path.
  const hay = `${item?.name || ''} ${item?.subLocation || ''} ${item?.location || ''}`.toLowerCase();
  for (const [kw, label] of Object.entries(KIND_LABEL)) {
    if (hay.includes(kw)) return label;
  }
  return lastSegment(item?.subLocation || item?.location || '') || 'Other stores';
};

const locNames = (item) => {
  const locs = item?.stockLocations || [];
  return locs.map((l) => lastSegment(l?.locationName || l?.location_name || l?.location || l?.name || '')).filter(Boolean);
};

/**
 * Group bonded items into FAL 3 article rows.
 * @returns {{ rows: Array<{article,qty,lines,locations:string[]}>, totalQty:number, totalLines:number, items:Array }}
 *   rows ordered by qty descending. `lines` = number of distinct products in the
 *   bucket; `qty` = total units; `locations` = distinct stow locations/folders.
 */
export const buildBondedSummary = (items) => {
  const bonded = (items || []).filter(isBondedStore);
  const byArticle = new Map();
  for (const item of bonded) {
    const article = bondedArticle(item);
    const qty = bondedTotalQty(item);
    const entry = byArticle.get(article) || { article, qty: 0, lines: 0, locations: new Set() };
    entry.qty += qty;
    entry.lines += 1;
    const names = locNames(item);
    if (names.length) names.forEach((n) => entry.locations.add(n));
    else {
      const folder = lastSegment(item?.subLocation || item?.location || '');
      if (folder) entry.locations.add(folder);
    }
    byArticle.set(article, entry);
  }
  const rows = Array.from(byArticle.values())
    .map((e) => ({ article: e.article, qty: e.qty, lines: e.lines, locations: Array.from(e.locations).sort() }))
    .sort((a, b) => b.qty - a.qty || a.article.localeCompare(b.article));
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalLines = rows.reduce((s, r) => s + r.lines, 0);
  return { rows, totalQty, totalLines, items: bonded };
};
