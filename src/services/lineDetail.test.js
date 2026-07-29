// Cargo Accounts — reconciliation line-detail logic tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  departmentForCode, defaultAllocation, needsTripPick, accountImpliesAllocation,
  defaultCardholder, isBorrowedCard,
  splitTotal, splitRemainder, validateSplits,
  netOfVat, vatFromRate, baseFromFx, lineCompleteness,
} from './lineDetail.js';

// ── department ──────────────────────────────────────────────────────────────
test('department is implied by the MYBA code where it makes sense', () => {
  assert.equal(departmentForCode('DCN'), 'Deck');          // Deck bucket
  assert.equal(departmentForCode('ECN'), 'Engineering');   // Engineer bucket
  assert.equal(departmentForCode('ICN'), 'Interior');      // Interior bucket
  assert.equal(departmentForCode('CFC'), 'Galley');        // crew food → galley
  assert.equal(departmentForCode('FLE'), 'Engineering');   // fuel → engineering
  assert.equal(departmentForCode('NAV'), 'Bridge');
  assert.equal(departmentForCode('INS'), 'Shore / Management');
  assert.equal(departmentForCode(null), null);
});

test('a code with no departmental owner returns null rather than guessing', () => {
  assert.equal(departmentForCode('GME'), null);   // Guest Miscellaneous
  assert.equal(departmentForCode('NCR'), null);   // revenue
});

// ── allocation (charter vs owner) ───────────────────────────────────────────
test('a dedicated charter/APA card answers the allocation itself', () => {
  const apa = { funds_type: 'charter_apa' };
  assert.equal(accountImpliesAllocation(apa), true);
  assert.equal(defaultAllocation({}, apa), 'charter');
  // ...and we do NOT then interrupt to ask which charter — the card is the context.
  assert.equal(needsTripPick('charter', apa), false);
});

test('a dedicated owner card defaults to owner', () => {
  const owner = { funds_type: 'owner' };
  assert.equal(defaultAllocation({}, owner), 'owner');
  assert.equal(accountImpliesAllocation(owner), true);
});

test('a general ship card is ambiguous — no default, and charter must name a charter', () => {
  const ship = { funds_type: 'general' };
  assert.equal(accountImpliesAllocation(ship), false);
  assert.equal(defaultAllocation({}, ship), null);         // make the user choose
  assert.equal(needsTripPick('charter', ship), true);      // → reveal the trip picker
  assert.equal(needsTripPick('owner', ship), false);
});

test('an allocation already on the line always wins over the account default', () => {
  assert.equal(defaultAllocation({ allocation: 'owner' }, { funds_type: 'charter_apa' }), 'owner');
});

// ── cardholder ──────────────────────────────────────────────────────────────
test('cardholder defaults to the card holder, since crew reconcile their own cards', () => {
  assert.equal(defaultCardholder({}, { holder_user_id: 'crew-1' }), 'crew-1');
});

test('an explicit spender on the line wins — the borrowed-card case', () => {
  const acct = { holder_user_id: 'crew-1' };
  assert.equal(defaultCardholder({ crew_id: 'crew-2' }, acct), 'crew-2');
  assert.equal(isBorrowedCard('crew-2', acct), true);   // flag it as a deliberate exception
  assert.equal(isBorrowedCard('crew-1', acct), false);
  assert.equal(isBorrowedCard(null, acct), false);
});

// ── splits ──────────────────────────────────────────────────────────────────
test('split totals and remainder work in the parent sign convention', () => {
  const splits = [{ amount: -1200 }, { amount: -500 }];
  assert.equal(splitTotal(splits), -1700);
  assert.equal(splitRemainder(-2000, splits), -300);
  assert.equal(splitRemainder(-1700, splits), 0);
});

test('no splits is valid — splitting is optional', () => {
  assert.deepEqual(validateSplits(-2000, []), { ok: true, reason: null, remainder: 0 });
});

test('a valid split must have 2+ parts, categories, amounts, and add up', () => {
  const good = [
    { amount: -1200, category: 'Guest Food Stock' },
    { amount: -800, category: 'Crew Food & Consumables' },
  ];
  assert.equal(validateSplits(-2000, good).ok, true);

  assert.match(validateSplits(-2000, [{ amount: -2000, category: 'Guest Food Stock' }]).reason, /two parts/);
  assert.match(validateSplits(-2000, [{ amount: -1200 }, { amount: -800, category: 'X' }]).reason, /category/);
  assert.match(validateSplits(-2000, [{ amount: 0, category: 'A' }, { amount: -2000, category: 'B' }]).reason, /amount/);
});

test('a split that does not add up reports the shortfall', () => {
  const short = [{ amount: -1200, category: 'A' }, { amount: -500, category: 'B' }];
  const v = validateSplits(-2000, short);
  assert.equal(v.ok, false);
  assert.match(v.reason, /add up/);
  assert.equal(v.remainder, -300);
});

test('split parts must run the same direction as the payment', () => {
  const mixed = [{ amount: -2500, category: 'A' }, { amount: 500, category: 'B' }];
  assert.match(validateSplits(-2000, mixed).reason, /same direction/);
});

// ── VAT / FX ────────────────────────────────────────────────────────────────
test('net of VAT keeps the payment direction', () => {
  assert.equal(netOfVat(-120, 20), -100);
  assert.equal(netOfVat(-120, 0), -120);
});

test('VAT can be derived from a rate', () => {
  assert.equal(vatFromRate(-120, 20), 20);
  assert.equal(vatFromRate(-120, 0), 0);
});

test('base currency comes from the FX rate', () => {
  assert.equal(baseFromFx(-100, 0.85), -85);
  assert.equal(baseFromFx(-100, null), -100);   // no rate → unchanged
});

// ── completeness ────────────────────────────────────────────────────────────
test('completeness lists what a line still needs', () => {
  const ship = { funds_type: 'general' };
  const bare = lineCompleteness({}, { account: ship, hasReceipt: false });
  assert.equal(bare.complete, false);
  assert.ok(bare.missing.includes('category'));
  assert.ok(bare.missing.includes('receipt'));
  assert.ok(bare.missing.includes('allocation'));
});

test('a fully coded owner line on a ship card is complete', () => {
  const full = lineCompleteness(
    { category: 'Deck Consumables', description: 'tender spares', department: 'Deck', allocation: 'owner' },
    { account: { funds_type: 'general' }, hasReceipt: true },
  );
  assert.deepEqual(full.missing, []);
  assert.equal(full.complete, true);
});

test('charter spend on a ship card is incomplete until the charter is named', () => {
  const base = { category: 'Guest Food Stock', description: 'provisions', department: 'Galley', allocation: 'charter' };
  const acct = { account: { funds_type: 'general' }, hasReceipt: true };
  assert.ok(lineCompleteness(base, acct).missing.includes('charter'));
  assert.equal(lineCompleteness({ ...base, trip_id: 'trip-9' }, acct).complete, true);
});

test('charter spend on a dedicated APA card needs no charter pick', () => {
  const r = lineCompleteness(
    { category: 'Guest Food Stock', description: 'provisions', department: 'Galley', allocation: 'charter' },
    { account: { funds_type: 'charter_apa' }, hasReceipt: true },
  );
  assert.equal(r.complete, true);
});

test('a split line does not also demand a top-level department', () => {
  const r = lineCompleteness(
    { category: 'Guest Food Stock', description: 'big shop', allocation: 'owner' },
    { account: { funds_type: 'general' }, hasReceipt: true, splitCount: 2 },
  );
  assert.equal(r.complete, true);
});
