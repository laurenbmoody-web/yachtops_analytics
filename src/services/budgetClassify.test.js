// Cargo Accounts — Phase 1.2. Classifier tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySpend } from './budgetClassify.js';

test('drinks route to Guest Wine Stock, high confidence', () => {
  const r = classifySpend({ category: 'Wine, Champagne & Fortified' });
  assert.equal(r.code, 'GWS');
  assert.equal(r.confidence, 'high');
});

test('fuel routes to Fuel & Lube Oil', () => {
  assert.equal(classifySpend({ category: 'Diesel / fuel' }).code, 'FLE');
});

test('flowers route to Guest Flowers', () => {
  assert.equal(classifySpend({ category: 'Edible Flowers' }).code, 'FLO');
});

test('food + charter trip → Guest Food Stock, high', () => {
  const r = classifySpend({ category: 'Meat & Poultry', tripType: 'Charter', boardTitle: 'Smith Charter 01/03/2026' });
  assert.equal(r.code, 'GFE');
  assert.equal(r.confidence, 'high');
});

test('food + crew board → Crew Food & Consumables, high', () => {
  const r = classifySpend({ category: 'Fresh Produce', boardTitle: 'Crew Food' });
  assert.equal(r.code, 'CFC');
  assert.equal(r.confidence, 'high');
});

test('food with NO who-signal is low confidence (the ambiguous case → review)', () => {
  const r = classifySpend({ category: 'Dairy & Eggs' });
  assert.equal(r.code, 'GFE');
  assert.equal(r.confidence, 'low');
});

test('owner trip counts as guest context', () => {
  const r = classifySpend({ category: 'Vegetables', tripType: 'Owner' });
  assert.equal(r.confidence, 'high');
  assert.equal(r.code, 'GFE');
});

test('consumables route by department, low confidence', () => {
  assert.equal(classifySpend({ category: 'Deck cleaning consumables', department: 'Deck' }).code, 'DCN');
  assert.equal(classifySpend({ category: 'Galley Consumables & Non-food', department: 'Interior' }).confidence, 'low');
});

test('unknown category with no department → null (Unbudgeted)', () => {
  assert.equal(classifySpend({ category: 'Mystery thing' }), null);
});

test('a drink token inside a word does not match — "gin" must not hit "engineer"', () => {
  assert.equal(classifySpend({ category: 'Engineer Spares & Renewals' }), null);
  assert.equal(classifySpend({ category: 'Engine room supplies' }), null);
  // but a real drink still routes
  assert.equal(classifySpend({ category: 'Gin & tonic' }).code, 'GWS');
});
