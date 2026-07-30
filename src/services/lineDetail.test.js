// Cargo Accounts — reconciliation line-detail logic tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  departmentForCode, defaultAllocation, needsTripPick, accountImpliesAllocation,
  defaultCardholder, isBorrowedCard,
  splitTotal, splitRemainder, validateSplits, signedSplits,
  netOfVat, vatFromRate, baseFromFx, lineCompleteness,
  effectiveDate, datesDiffer, straddlesMonth,
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
test('split amounts are magnitudes — the crew never type a minus sign', () => {
  const splits = [{ amount: 1200 }, { amount: 500 }];
  assert.equal(splitTotal(splits), 1700);
  // A -2000 payment with 1700 allocated leaves 300 (not -3700).
  assert.equal(splitRemainder(-2000, splits), 300);
  assert.equal(splitRemainder(-1700, splits), 0);
});

test('the £26 payment split £14 leaves £12 (regression)', () => {
  // Previously computed -26 - 14 = -40, which read as "-£40.00 left to allocate".
  assert.equal(splitRemainder(-26, [{ amount: 14 }]), 12);
  assert.equal(splitRemainder(-26, [{ amount: 14 }, { amount: 12 }]), 0);
});

test('signedSplits gives the typed magnitudes the payment direction', () => {
  assert.deepEqual(signedSplits(-26, [{ amount: 14 }, { amount: '12' }]).map((s) => s.amount), [-14, -12]);
  assert.deepEqual(signedSplits(500, [{ amount: 200 }, { amount: 300 }]).map((s) => s.amount), [200, 300]);
  // A stray minus typed in is normalised, not doubled up.
  assert.deepEqual(signedSplits(-26, [{ amount: -14 }]).map((s) => s.amount), [-14]);
});

test('no splits is valid — splitting is optional', () => {
  assert.deepEqual(validateSplits(-2000, []), { ok: true, reason: null, remainder: 0 });
});

test('a valid split must have 2+ parts, categories, amounts, and add up', () => {
  const good = [
    { amount: 1200, category: 'Guest Food Stock' },
    { amount: 800, category: 'Crew Food & Consumables' },
  ];
  assert.equal(validateSplits(-2000, good).ok, true);

  assert.match(validateSplits(-2000, [{ amount: 2000, category: 'Guest Food Stock' }]).reason, /two parts/);
  assert.match(validateSplits(-2000, [{ amount: 1200 }, { amount: 800, category: 'X' }]).reason, /category/);
  assert.match(validateSplits(-2000, [{ amount: 0, category: 'A' }, { amount: 2000, category: 'B' }]).reason, /amount/);
});

test('a split that does not add up reports the shortfall as a magnitude', () => {
  const short = [{ amount: 1200, category: 'A' }, { amount: 500, category: 'B' }];
  const v = validateSplits(-2000, short);
  assert.equal(v.ok, false);
  assert.match(v.reason, /add up/);
  assert.equal(v.remainder, 300);
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

// ── the two dates ───────────────────────────────────────────────────────────
test('effectiveDate picks the spend date or the statement date by basis', () => {
  const t = { txn_date: '2026-06-30', statement_date: '2026-07-02' };
  assert.equal(effectiveDate(t, 'spend'), '2026-06-30');       // when it happened
  assert.equal(effectiveDate(t, 'statement'), '2026-07-02');   // when the bank posted it
  assert.equal(effectiveDate(t), '2026-06-30');                // spend is the default
});

test('effectiveDate falls back when one date is missing', () => {
  assert.equal(effectiveDate({ txn_date: '2026-07-01' }, 'statement'), '2026-07-01');
  assert.equal(effectiveDate({ statement_date: '2026-07-03' }, 'spend'), '2026-07-03');
  assert.equal(effectiveDate(null), null);
});

test('datesDiffer only when both exist and disagree', () => {
  assert.equal(datesDiffer({ txn_date: '2026-07-01', statement_date: '2026-07-03' }), true);
  assert.equal(datesDiffer({ txn_date: '2026-07-01', statement_date: '2026-07-01' }), false);
  assert.equal(datesDiffer({ txn_date: '2026-07-01' }), false);
});

test('straddlesMonth catches the case that moves a cost between months', () => {
  // 30 June spend that posts 2 July — June owns the cost, the bank shows it in July.
  assert.equal(straddlesMonth({ txn_date: '2026-06-30', statement_date: '2026-07-02' }), true);
  // Same month, just a posting lag — not a period problem.
  assert.equal(straddlesMonth({ txn_date: '2026-07-01', statement_date: '2026-07-03' }), false);
  assert.equal(straddlesMonth({ txn_date: '2026-07-01', statement_date: '2026-07-01' }), false);
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
    { category: 'Deck Consumables', note: 'tender spares', department: 'Deck', allocation: 'owner' },
    { account: { funds_type: 'general' }, hasReceipt: true },
  );
  assert.deepEqual(full.missing, []);
  assert.equal(full.complete, true);
});

test('charter spend on a ship card is incomplete until the charter is named', () => {
  const base = { category: 'Guest Food Stock', note: 'provisions', department: 'Galley', allocation: 'charter' };
  const acct = { account: { funds_type: 'general' }, hasReceipt: true };
  assert.ok(lineCompleteness(base, acct).missing.includes('charter'));
  assert.equal(lineCompleteness({ ...base, trip_id: 'trip-9' }, acct).complete, true);
});

test('a typed charter name satisfies the charter requirement', () => {
  const r = lineCompleteness(
    { category: 'Guest Food Stock', note: 'provisions', department: 'Galley', allocation: 'charter', charter_ref: 'Med Aug 26' },
    { account: { funds_type: 'general' }, hasReceipt: true },
  );
  assert.equal(r.complete, true);
});

test('charter spend on a dedicated APA card needs no charter pick', () => {
  const r = lineCompleteness(
    { category: 'Guest Food Stock', note: 'provisions', department: 'Galley', allocation: 'charter' },
    { account: { funds_type: 'charter_apa' }, hasReceipt: true },
  );
  assert.equal(r.complete, true);
});

test('a split line does not also demand a top-level department', () => {
  const r = lineCompleteness(
    { category: 'Guest Food Stock', note: 'big shop', allocation: 'owner' },
    { account: { funds_type: 'general' }, hasReceipt: true, splitCount: 2 },
  );
  assert.equal(r.complete, true);
});
