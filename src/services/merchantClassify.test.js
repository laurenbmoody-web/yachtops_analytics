// Cargo Accounts — merchant-intelligence unit tests. Run: `node --test`.
// Pure engine only (no Supabase) — the seed dictionary, name normalisation, and the
// learned-rule-first resolver that categorises the Enable Banking feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMerchant, suggestFromMerchant, suggestWithRules } from './merchantClassify.js';

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

test('seed: unambiguous marine vendors route high-confidence', () => {
  assert.equal(suggestFromMerchant({ payee: 'TOTAL MARINE FUELS' }).code, 'FLE');
  assert.equal(suggestFromMerchant({ payee: 'Pantaenius Yacht Insurance' }).code, 'INS');
  assert.equal(suggestFromMerchant({ payee: 'Bureau Veritas' }).code, 'CRT');
  assert.equal(suggestFromMerchant({ payee: 'Port Vauban Capitainerie' }).code, 'HAR');
  const fuel = suggestFromMerchant({ payee: 'Shell' });
  assert.equal(fuel.confidence, 'high');
  assert.equal(fuel.source, 'merchant');
});

test('seed: two-sided vendors match but are flagged low for a human check', () => {
  const market = suggestFromMerchant({ payee: 'Carrefour Cannes' });
  assert.equal(market.code, 'GFE');
  assert.equal(market.confidence, 'low');
  const air = suggestFromMerchant({ payee: 'RYANAIR' });
  assert.equal(air.code, 'CTE');
  assert.equal(air.confidence, 'low');
});

test('description keyword pass catches product words when the merchant is unknown', () => {
  const s = suggestFromMerchant({ payee: 'BQT SA 0099', description: 'DIESEL GASOIL BUNKERS' });
  assert.equal(s.code, 'FLE');
  assert.equal(s.source, 'description');
});

test('no signal at all → null (stays in the review queue)', () => {
  assert.equal(suggestFromMerchant({ payee: 'ZZ Untraceable 4471', description: 'ref 8891' }), null);
});

test('suggestWithRules: a learned rule is authoritative over the seed guess', () => {
  const rules = new Map([['carrefour cannes', { bucket: 'Crew Cost', category: 'Crew Food & Consumables', code: 'CFC' }]]);
  const { suggestion, merchantKey } = suggestWithRules({ payee: 'CARREFOUR CANNES 04/26' }, rules);
  assert.equal(merchantKey, 'carrefour cannes');
  assert.equal(suggestion.code, 'CFC');          // learned CFC beats seed's default GFE
  assert.equal(suggestion.confidence, 'high');
  assert.equal(suggestion.source, 'learned');
});

test('suggestWithRules: falls through to seed when no rule, still returns merchantKey', () => {
  const { suggestion, merchantKey } = suggestWithRules({ payee: 'Shell' }, new Map());
  assert.equal(suggestion.code, 'FLE');
  assert.equal(merchantKey, 'shell');
});

test('suggestWithRules: unknown merchant returns key so a manual rule can be saved', () => {
  const { suggestion, merchantKey } = suggestWithRules({ payee: 'Mystery Vendor 9910' }, new Map());
  assert.equal(suggestion, null);
  assert.equal(merchantKey, 'mystery vendor');
});
