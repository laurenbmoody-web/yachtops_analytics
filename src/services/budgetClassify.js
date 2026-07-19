// Cargo Accounts — Phase 1.2. Context-reading spend classifier (pure, no imports).
//
// Given a spend item plus its associated context — the provisioning board title,
// the linked trip and its type, the department, and the source category — suggest
// the MYBA budget line it belongs to, with a confidence. Only HIGH-confidence
// suggestions are auto-routed by the resolver; anything lower is left in the review
// queue for a human to set via the dropdown (which then trains the learned map).
//
// Deterministic and explainable on purpose — money should never be filed by a black
// box. An optional LLM tie-breaker can layer on top later for the genuinely murky.

const lc = (s) => String(s ?? '').toLowerCase();
const has = (hay, re) => re.test(lc(hay));

// Target MYBA lines this classifier can route to (must match the standard chart).
const L = {
  GFE: { bucket: 'Guest Costs', category: 'Guest Food Stock', code: 'GFE' },
  GWS: { bucket: 'Guest Costs', category: 'Guest Wine Stock', code: 'GWS' },
  FLO: { bucket: 'Guest Costs', category: 'Guest Flowers', code: 'FLO' },
  CFC: { bucket: 'Crew Cost', category: 'Crew Food & Consumables', code: 'CFC' },
  FLE: { bucket: 'Fuel', category: 'Fuel & Lube Oil', code: 'FLE' },
  ICN: { bucket: 'Interior', category: 'Interior Consumables', code: 'ICN' },
  DCN: { bucket: 'Deck', category: 'Deck Consumables', code: 'DCN' },
  ECN: { bucket: 'Engineer', category: 'Engineer Consumables', code: 'ECN' },
};

// Word-boundaried so short tokens don't match inside unrelated words — e.g. a bare
// "gin" must not match "en·gin·eer" (which used to route all Engineer spend to Guest
// Wine Stock). Anchors on whole words; plurals/‑y forms handled explicitly.
const DRINK = /\b(?:wine|champagnes?|prosecco|beers?|ciders?|spirits?|whisk(?:e?y)?|vodkas?|gin|rum|liqueurs?|cocktails?|fortified|vermouth|aperitifs?|sake)\b/;
const FOOD = /produce|fruit|veg|salad|dairy|egg|cheese|meat|poultry|beef|pork|lamb|fish|seafood|shellfish|caviar|pantry|dry\s*goods|bakery|bread|charcuterie|grocer|provision|food|truffle|legume|pulse|mushroom|herb|spice|condiment|vinegar|flour|gelling|stabilis|thicken|edible|sea\s*veg|foraged|acidulant|syrup|bitters/;
const CLEANING = /clean|consumable|non-?food|detergent|paper|hygiene|laundry\s*powder|chemical/;
const FUEL = /\bfuel\b|diesel|\blube\b|gas\s*oil/;
const FLOWERS = /flower|floral|bouquet/;

// Does the board/trip context point at guests (charter/owner) or the crew?
const whoSignal = ({ boardTitle, tripName, tripType }) => {
  const ctx = `${lc(boardTitle)} ${lc(tripName)}`;
  if (/crew|galley crew|crew mess/.test(ctx)) return 'crew';
  if (/charter|guest|owner/.test(ctx)) return 'guest';
  const t = lc(tripType);
  if (t === 'charter' || t === 'owner') return 'guest';
  if (t === 'crew') return 'crew';
  return null; // unknown
};

const deptConsumable = (department) => {
  const d = lc(department);
  if (/deck/.test(d)) return L.DCN;
  if (/engine|engineer|eng\b/.test(d)) return L.ECN;
  if (/interior|stew|galley/.test(d)) return L.ICN;
  return null;
};

// Returns { bucket, category, code, confidence: 'high'|'low', reason } or null.
export const classifySpend = (item = {}) => {
  const cat = item.category || '';
  const who = whoSignal(item);

  if (has(cat, FLOWERS)) return { ...L.FLO, confidence: 'high', reason: 'flowers' };
  if (has(cat, DRINK)) return { ...L.GWS, confidence: 'high', reason: 'drinks → guest wine stock' };
  if (has(cat, FUEL)) return { ...L.FLE, confidence: 'high', reason: 'fuel' };

  if (has(cat, FOOD)) {
    if (who === 'guest') return { ...L.GFE, confidence: 'high', reason: 'food + guest/charter context' };
    if (who === 'crew') return { ...L.CFC, confidence: 'high', reason: 'food + crew context' };
    // Ambiguous: food with no owner/crew/charter signal — suggest guest food but flag.
    return { ...L.GFE, confidence: 'low', reason: 'food, no crew/guest signal — check' };
  }

  if (has(cat, CLEANING)) {
    const d = deptConsumable(item.department);
    if (d) return { ...d, confidence: 'low', reason: 'consumables by department — check' };
    return { ...L.ICN, confidence: 'low', reason: 'consumables, no department — check' };
  }

  // Pure department fallback (no category signal at all).
  const d = deptConsumable(item.department);
  if (d) return { ...d, confidence: 'low', reason: 'department only — check' };

  return null; // no idea → Unbudgeted review queue
};
