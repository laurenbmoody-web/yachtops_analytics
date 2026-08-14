// Cargo Accounts — merchant-intelligence unit tests. Run: `node --test`.
// Pure engine only (no Supabase) — the seed dictionary, name normalisation, and the
// learned-rule-first resolver that categorises the Enable Banking feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMerchant, suggest, resolveSuggestion } from './merchantClassify.js';

test('normalizeMerchant collapses legal suffixes to a stable key', () => {
  // Dotted and undotted legal forms of the same vendor land on one key.
  assert.equal(normalizeMerchant('Med Provisions S.A.R.L.'), 'med provisions');
  assert.equal(normalizeMerchant('MED PROVISIONS SARL'), 'med provisions');
  assert.equal(normalizeMerchant('Marina Port GmbH'), 'marina port');
});

test('normalizeMerchant strips card-scheme + reference noise and digit runs', () => {
  assert.equal(normalizeMerchant('CARTE 1234 TOTAL MARINE FUELS REF 998877'), 'total marine fuels');
  assert.equal(normalizeMerchant(''), '');
  assert.equal(normalizeMerchant(null), '');
});

test('seed: unambiguous marine vendors are a confident single suggestion', () => {
  assert.equal(suggest({ payee: 'TOTAL MARINE FUELS' }).suggestion.code, 'FLE');
  assert.equal(suggest({ payee: 'Pantaenius Yacht Insurance' }).suggestion.code, 'INS');
  assert.equal(suggest({ payee: 'Bureau Veritas' }).suggestion.code, 'CRT');
  // A marina is a berth booked from an operator; the port authority's own invoice
  // is a due. The chart now has a line for each, so the two stop being one number.
  assert.equal(suggest({ payee: 'Port Vauban Capitainerie' }).suggestion.code, 'BRT');
  assert.equal(suggest({ payee: 'Harbour Master Palma' }).suggestion.code, 'HAR');
  const fuel = suggest({ payee: 'Shell' });
  assert.equal(fuel.kind, 'single');
  assert.equal(fuel.suggestion.confidence, 'high');
  assert.equal(fuel.suggestion.source, 'merchant');
});

test('seed: the detail lines are reachable from a real payee', () => {
  // A chart line nothing can ever route to is just a longer dropdown.
  const code = (payee) => suggest({ payee }).suggestion?.code;
  assert.equal(code('STARLINK MARITIME'), 'SAT');
  assert.equal(code('Furuno France'), 'NAV');
  assert.equal(code('Panama Canal Authority'), 'CNL');
  assert.equal(code('Sludge & Waste Services Antibes'), 'WST');
  assert.equal(code('AWLGRIP EUROPE'), 'DPT');
  assert.equal(code('Chantier Naval La Ciotat'), 'DDK');
  assert.equal(code('Blanchisserie du Port'), 'ILA');
  assert.equal(code('Microsoft Ireland'), 'ITS');
  assert.equal(code('Cayman Maritime Registry'), 'REG');
  assert.equal(code('STCW Training Centre'), 'CTR');
  assert.equal(code('Seabob Cayago'), 'TJS');
  assert.equal(code('Antibes Scuba Dive Centre'), 'TDV');
});

test('seed: a rule never fires only to be shadowed by an earlier one', () => {
  // Life-saving claims "zodiac" before tenders do, on purpose — the safety trade
  // wins a shared name. This pins that, so nobody "fixes" it by reordering.
  assert.equal(suggest({ payee: 'Zodiac Milpro' }).suggestion.code, 'LSF');
});

test('seed: every code the classifier routes to is a real chart line', () => {
  // The seed table references lines by code alone; a typo would silently return
  // null and drop the transaction into the review queue with no explanation.
  const payees = ['TOTAL MARINE', 'Pantaenius', 'Bureau Veritas', 'Peters & May',
    'STARLINK', 'Furuno', 'Admiralty Charts', 'Viking Life', 'Marina Ibiza',
    'Harbour Dues', 'Pilotage Services', 'Suez Canal', 'Douane Francaise',
    'Garbage Collection', 'Chandlery Co', 'MTU Marine', 'Cave de Vin', 'Interflora',
    'Musto', 'Yacht Agent SL', 'Vodafone', 'Netflix', 'Adobe', 'Antifouling Ltd',
    'Jotun Paints', 'Drydock Barcelona', 'Laundrette', 'Ship Registry', 'Avocat Nice',
    'Accounting Partners', 'Crew Agency Ltd', 'Sea School', 'Jet Ski Hire',
    'Scuba Store', 'Water Toys Co', 'Castoldi'];
  payees.forEach((p) => {
    const s = suggest({ payee: p });
    assert.notEqual(s.kind, 'none', `${p} matched nothing`);
    if (s.kind === 'single') assert.ok(s.suggestion.category, `${p} resolved to no line`);
    else s.options.forEach((o) => assert.ok(o.category, `${p} resolved to no line`));
  });
});

test('seed: two-sided vendors return a guest-vs-crew choice, not a guess', () => {
  const market = suggest({ payee: 'Carrefour Cannes' });
  assert.equal(market.kind, 'choice');
  assert.deepEqual(market.options.map((o) => o.code), ['GFE', 'CFC']);
  const air = suggest({ payee: 'RYANAIR' });
  assert.equal(air.kind, 'choice');
  assert.deepEqual(air.options.map((o) => o.code), ['CTE', 'GCT']);
});

test('description keyword pass catches product words when the merchant is unknown', () => {
  const s = suggest({ payee: 'BQT SA 0099', description: 'DIESEL GASOIL BUNKERS' });
  assert.equal(s.kind, 'single');
  assert.equal(s.suggestion.code, 'FLE');
  assert.equal(s.suggestion.source, 'description');
});

test('no signal at all → kind none (stays in the review queue)', () => {
  assert.equal(suggest({ payee: 'ZZ Untraceable 4471', description: 'ref 8891' }).kind, 'none');
});

test('resolveSuggestion: a learned rule is authoritative for an unknown/single merchant', () => {
  const rules = new Map([['mystery vendor', { bucket: 'Deck', category: 'Deck Consumables', code: 'DCN' }]]);
  const r = resolveSuggestion({ payee: 'MYSTERY VENDOR 9910' }, rules);
  assert.equal(r.kind, 'single');
  assert.equal(r.suggestion.code, 'DCN');
  assert.equal(r.suggestion.source, 'learned');
  assert.equal(r.merchantKey, 'mystery vendor');
});

test('resolveSuggestion: a two-sided vendor stays a choice even once filed, with a preferred side', () => {
  const rules = new Map([['carrefour cannes', { bucket: 'Crew Cost', category: 'Crew Food & Consumables', code: 'CFC' }]]);
  const r = resolveSuggestion({ payee: 'CARREFOUR CANNES 04/26' }, rules);
  assert.equal(r.kind, 'choice');                       // still ask
  assert.deepEqual(r.options.map((o) => o.code), ['GFE', 'CFC']);
  assert.equal(r.preferred, 'Crew Food & Consumables'); // pre-highlight the learned side
});

test('resolveSuggestion: two-sided with no rule yet has no preferred side', () => {
  const r = resolveSuggestion({ payee: 'Uber *trip' }, new Map());
  assert.equal(r.kind, 'choice');
  assert.equal(r.preferred, null);
});

test('resolveSuggestion: unknown merchant with no rule → none, still returns key', () => {
  const r = resolveSuggestion({ payee: 'Mystery Vendor 9910' }, new Map());
  assert.equal(r.kind, 'none');
  assert.equal(r.merchantKey, 'mystery vendor');
});

test('a department store is two-sided — provisions or crew uniform', () => {
  // M&S normalises to "m s" (the ampersand is stripped), and sells both.
  const ms = suggest({ payee: 'M&S WHITE ROSE' });
  assert.equal(ms.kind, 'choice');
  assert.deepEqual(ms.options.map((o) => o.code), ['GFE', 'CUF']);
  assert.equal(suggest({ payee: 'Marks and Spencer' }).kind, 'choice');
});
