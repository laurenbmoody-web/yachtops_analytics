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
  assert.equal(suggest({ payee: 'Port Vauban Capitainerie' }).suggestion.code, 'HAR');
  const fuel = suggest({ payee: 'Shell' });
  assert.equal(fuel.kind, 'single');
  assert.equal(fuel.suggestion.confidence, 'high');
  assert.equal(fuel.suggestion.source, 'merchant');
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
