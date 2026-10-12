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

// The stored bonded.kind is an unreliable signal — the item form defaults it to
// "wine", so most spirits carry kind:"wine". So we classify from the PRODUCT
// NAME / BRAND first (strong, accurate signals), ordered so the more specific
// categories win (champagne before wine, spirits/liqueurs/fortified before wine).
const ARTICLE_RX = [
  ['Champagne & Sparkling', /\b(champagne|prosecco|cava|cr[eé]mant|spumante|sparkling|brut|mo[eë]t|veuve|bollinger|dom\s*p[eé]rignon|lanson|taittinger|laurent[\s-]?perrier|mumm|pol\s*roger|ruinart|perrier[\s-]?jou[eë]t)\b/i],
  ['Beer', /\b(beer|lager|ale|ipa|stout|pilsner|peroni|heineken|corona|budweiser|guinness|carlsberg|estrella|birra|moretti|asahi)\b/i],
  ['Cider', /\b(cider|cidre)\b/i],
  ['Liqueurs', /\b(liqueur|baileys|cointreau|amaretto|disaronno|kahl[uú]a|limoncello|triple\s*sec|grand\s*marnier|chambord|drambuie|frangelico|sambuca|campari|aperol|chartreuse|st[\s-]?germain|midori|malibu|j[aä]germeister|southern\s*comfort|pimm)\b/i],
  ['Fortified wine', /\b(port|sherry|vermouth|madeira|marsala|martini\s*(bianco|rosso|extra\s*dry|fiero)|noilly\s*prat|dubonnet|lillet|pineau)\b/i],
  ['Spirits', /\b(whisky|whiskey|bourbon|scotch|\brye\b|vodka|\bgin\b|\brum\b|tequila|mezcal|cognac|brandy|armagnac|grappa|pisco|aquavit|absinthe|calvados|glenfiddich|glenlivet|glenmorangie|macallan|balvenie|lagavulin|laphroaig|talisker|dalmore|highland\s*park|hennessy|courvoisier|r[eé]my\s*martin|martell|bombay|tanqueray|hendrick|beefeater|sipsmith|absolut|smirnoff|grey\s*goose|belvedere|ciroc|bacardi|havana|captain\s*morgan|kraken|patr[oó]n|don\s*julio|jose\s*cuervo|johnnie\s*walker|chivas|jameson|jack\s*daniel|jim\s*beam|maker'?s\s*mark|woodford|botanist|monkey\s*47|roku|nikka|hibiki|yamazaki)\b/i],
  ['Wine', /\b(wine|merlot|cabernet|sauvignon\s*blanc|sauvignon|chardonnay|pinot\s*(noir|grigio|gris)|rioja|ros[eé]|shiraz|syrah|malbec|grenache|tempranillo|zinfandel|sangiovese|nebbiolo|chablis|bordeaux|burgundy|sancerre|chianti|barolo|ch[aâ]teau|domaine|viognier|gew[uü]rztraminer|riesling|vino)\b/i],
  ['Tobacco', /\b(tobacco|cigarette|rolling\s*tobacco)\b/i],
  ['Cigars', /\b(cigar|cohiba|montecristo|romeo\s*y\s*julieta|partag[aá]s|davidoff)\b/i],
];

// Folder-leaf words → category, used only when the name gives no signal.
const FOLDER_RX = [
  ['Champagne & Sparkling', /champagne|sparkling/i],
  ['Spirits', /spirit/i],
  ['Wine', /\bwine\b/i],
  ['Beer', /beer/i],
  ['Liqueurs', /liqueur/i],
  ['Tobacco', /tobacco/i],
  ['Cigars', /cigar/i],
];

const KIND_LABEL = {
  spirit: 'Spirits', spirits: 'Spirits', vodka: 'Spirits', gin: 'Spirits', whisky: 'Spirits', whiskey: 'Spirits', rum: 'Spirits', tequila: 'Spirits', brandy: 'Spirits', cognac: 'Spirits',
  champagne: 'Champagne & Sparkling', sparkling: 'Champagne & Sparkling', prosecco: 'Champagne & Sparkling', cava: 'Champagne & Sparkling',
  beer: 'Beer', beers: 'Beer', ale: 'Beer', lager: 'Beer', cider: 'Cider',
  liqueur: 'Liqueurs', liqueurs: 'Liqueurs', aperitif: 'Liqueurs', digestif: 'Liqueurs',
  fortified: 'Fortified wine', port: 'Fortified wine', sherry: 'Fortified wine', vermouth: 'Fortified wine',
  tobacco: 'Tobacco', cigarette: 'Tobacco', cigarettes: 'Tobacco', cigar: 'Cigars', cigars: 'Cigars',
  // NB: 'wine' deliberately omitted — too often a wrong default on spirits.
};

// The FAL 3 "Name of article" bucket for a bonded item. Name/brand first (most
// reliable), then the stored kind (minus the unreliable "wine" default), then
// the folder leaf word, else "Other stores".
export const bondedArticle = (item) => {
  const hay = `${item?.name || ''} ${item?.brand || ''}`.toLowerCase();
  for (const [label, rx] of ARTICLE_RX) if (rx.test(hay)) return label;
  const kind = String(cf(item)?.bonded?.kind || '').toLowerCase().trim();
  if (kind && KIND_LABEL[kind]) return KIND_LABEL[kind];
  const folder = lastSegment(item?.subLocation || item?.location || '');
  for (const [label, rx] of FOLDER_RX) if (rx.test(folder)) return label;
  return 'Other stores';
};

// PHYSICAL stow locations only (vessel/deck locations) — never folder names.
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
    // Physical boat locations only — if an item has no stow location assigned it
    // contributes none (the group shows "—" rather than a folder name).
    locNames(item).forEach((n) => entry.locations.add(n));
    byArticle.set(article, entry);
  }
  const rows = Array.from(byArticle.values())
    .map((e) => ({ article: e.article, qty: e.qty, lines: e.lines, locations: Array.from(e.locations).sort() }))
    .sort((a, b) => b.qty - a.qty || a.article.localeCompare(b.article));
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalLines = rows.reduce((s, r) => s + r.lines, 0);
  return { rows, totalQty, totalLines, items: bonded };
};
