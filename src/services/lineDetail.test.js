// Cargo Accounts — reconciliation line-detail logic tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  departmentForCode, defaultAllocation, needsTripPick, accountImpliesAllocation,
  defaultCardholder, isBorrowedCard,
  splitTotal, splitRemainder, validateSplits, signedSplits,
  netOfVat, vatFromRate, baseFromFx, lineCompleteness,
  effectiveDate, datesDiffer, straddlesMonth,
  REQUIREMENTS, requirementState, lineState, maxForPart, clampSplitAmount,
  maxSpendDate, isSpendDateValid, canVoidTxn, voidBlockedReason,
  looksLikeRefund, findRefundCandidate, refundInheritedFields, defaultDepartment,
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

// ── completeness track / row state ──────────────────────────────────────────
test('requirementState reports each requirement and a count', () => {
  const ship = { funds_type: 'general' };
  const bare = requirementState({}, { account: ship, hasReceipt: false });
  assert.equal(bare.count, 0);
  assert.equal(bare.total, 5);
  assert.equal(bare.done.category, false);

  const part = requirementState({ category: 'Deck Consumables', note: 'hose' }, { account: ship, hasReceipt: false });
  assert.equal(part.count, 2);
  assert.equal(part.done.note, true);
  assert.equal(part.done.receipt, false);
});

test('a split line counts department as covered — the parts carry it', () => {
  const ctx = { account: { funds_type: 'owner' }, hasReceipt: true, splitCount: 2 };
  const r = requirementState({ category: 'X', note: 'y' }, ctx);
  assert.equal(r.done.department, true);
  assert.equal(r.count, 5);
});

test('charter allocation is only "done" once the charter is named', () => {
  const ship = { account: { funds_type: 'general' }, hasReceipt: true };
  assert.equal(requirementState({ allocation: 'charter' }, ship).done.allocation, false);
  assert.equal(requirementState({ allocation: 'charter', trip_id: 't1' }, ship).done.allocation, true);
  assert.equal(requirementState({ allocation: 'charter', charter_ref: 'Med Aug' }, ship).done.allocation, true);
});

test('lineState gives the three row states', () => {
  const ship = { account: { funds_type: 'general' }, hasReceipt: false };
  assert.equal(lineState({}, ship), 'untouched');
  assert.equal(lineState({ category: 'X' }, ship), 'progress');
  assert.equal(lineState(
    { category: 'X', note: 'y', department: 'Deck', allocation: 'owner' },
    { account: { funds_type: 'general' }, hasReceipt: true },
  ), 'complete');
});

// ── split clamping (an over-allocation can never be typed) ──────────────────
test('maxForPart is the payment less the other parts', () => {
  const splits = [{ amount: 14 }, { amount: '' }];
  assert.equal(maxForPart(-26, splits, 1), 12);   // 26 - 14
  assert.equal(maxForPart(-26, splits, 0), 26);   // nothing else allocated
});

test('clampSplitAmount refuses an over-allocation and reports it', () => {
  const splits = [{ amount: 14 }, { amount: '' }];
  // Typing 14 into part 2 of a £26 payment would total 28 — cut back to 12.
  assert.deepEqual(clampSplitAmount(-26, splits, 1, '14'), { value: '12', clamped: true });
  assert.deepEqual(clampSplitAmount(-26, splits, 1, '12'), { value: '12', clamped: false });
  assert.deepEqual(clampSplitAmount(-26, splits, 1, '5'), { value: '5', clamped: false });
});

test('clampSplitAmount leaves partial typing alone', () => {
  assert.deepEqual(clampSplitAmount(-26, [{ amount: '' }], 0, ''), { value: '', clamped: false });
  assert.deepEqual(clampSplitAmount(-26, [{ amount: '' }], 0, '.'), { value: '.', clamped: false });
});

// ── spend date vs posted date ───────────────────────────────────────────────
test('a spend date after the posted date is impossible', () => {
  assert.equal(isSpendDateValid('2026-07-28', '2026-07-30'), true);   // before
  assert.equal(isSpendDateValid('2026-07-30', '2026-07-30'), true);   // same day
  assert.equal(isSpendDateValid('2026-08-01', '2026-07-30'), false);  // after the bank posted it
});

test('with no posted date there is nothing to validate against', () => {
  assert.equal(isSpendDateValid('2026-08-01', null), true);
  assert.equal(isSpendDateValid('', '2026-07-30'), false);
  assert.equal(maxSpendDate({ statement_date: '2026-07-30' }), '2026-07-30');
  assert.equal(maxSpendDate({}), null);
});

// ── voiding ─────────────────────────────────────────────────────────────────
test('bank-derived lines cannot be voided — the money actually moved', () => {
  assert.equal(canVoidTxn({ source: 'bank_feed', status: 'unreconciled' }), false);
  assert.equal(canVoidTxn({ source: 'import', status: 'reconciled' }), false);
  assert.match(voidBlockedReason({ source: 'bank_feed' }), /came from the bank/);
});

test('lines Cargo created may be voided; an already-void line may not', () => {
  assert.equal(canVoidTxn({ source: 'manual', status: 'reconciled' }), true);
  assert.equal(canVoidTxn({ source: 'supplier_invoice', status: 'unreconciled' }), true);
  assert.equal(canVoidTxn({ source: 'manual', status: 'void' }), false);
  assert.equal(voidBlockedReason({ source: 'manual' }), null);
});

// ── refunds ─────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').toLowerCase().trim();

test('a positive bank line from a known merchant is a refund candidate', () => {
  const spend = { id: 's1', payee: 'JD Sports', amount: -42, txn_date: '2026-07-28', source: 'bank_feed' };
  const refund = { id: 'r1', payee: 'JD Sports', amount: 42, txn_date: '2026-08-02', source: 'bank_feed' };
  assert.equal(looksLikeRefund(refund), true);
  assert.equal(findRefundCandidate(refund, [spend, refund], norm)?.id, 's1');
});

test('a partial refund still matches its original', () => {
  const spend = { id: 's1', payee: 'JD Sports', amount: -42, txn_date: '2026-07-28', source: 'bank_feed' };
  const refund = { id: 'r1', payee: 'JD Sports', amount: 20, txn_date: '2026-08-02', source: 'bank_feed' };
  assert.equal(findRefundCandidate(refund, [spend, refund], norm)?.id, 's1');
});

test('a refund never matches a smaller original, a different merchant, or one already refunded', () => {
  const small = { id: 's1', payee: 'JD Sports', amount: -10, txn_date: '2026-07-28', source: 'bank_feed' };
  const other = { id: 's2', payee: 'Ryanair', amount: -99, txn_date: '2026-07-28', source: 'bank_feed' };
  const refund = { id: 'r1', payee: 'JD Sports', amount: 42, txn_date: '2026-08-02', source: 'bank_feed' };
  assert.equal(findRefundCandidate(refund, [small, other, refund], norm), null);

  const spend = { id: 's3', payee: 'JD Sports', amount: -42, txn_date: '2026-07-28', source: 'bank_feed' };
  const already = { id: 'r0', payee: 'JD Sports', amount: 42, txn_date: '2026-07-30', source: 'bank_feed', refund_of_id: 's3' };
  assert.equal(findRefundCandidate(refund, [spend, already, refund], norm), null);
});

test('a refund must come after the spend and inside the window', () => {
  const spend = { id: 's1', payee: 'JD Sports', amount: -42, txn_date: '2026-07-28', source: 'bank_feed' };
  const before = { id: 'r1', payee: 'JD Sports', amount: 42, txn_date: '2026-07-01', source: 'bank_feed' };
  const ancient = { id: 'r2', payee: 'JD Sports', amount: 42, txn_date: '2027-06-01', source: 'bank_feed' };
  assert.equal(findRefundCandidate(before, [spend, before], norm), null);
  assert.equal(findRefundCandidate(ancient, [spend, ancient], norm), null);
});

test('an exact-amount original wins over a merely larger one', () => {
  const big = { id: 'big', payee: 'Carrefour', amount: -300, txn_date: '2026-07-20', source: 'bank_feed' };
  const exact = { id: 'exact', payee: 'Carrefour', amount: -42, txn_date: '2026-07-18', source: 'bank_feed' };
  const refund = { id: 'r1', payee: 'Carrefour', amount: 42, txn_date: '2026-07-25', source: 'bank_feed' };
  assert.equal(findRefundCandidate(refund, [big, exact, refund], norm)?.id, 'exact');
});

test('a refund inherits the coding of the spend it reverses, not income', () => {
  const original = { category: 'Crew Uniforms', category_code: 'CUF', department: 'Deck', allocation: 'owner' };
  assert.deepEqual(refundInheritedFields(original), {
    category: 'Crew Uniforms', category_code: 'CUF', department: 'Deck',
    allocation: 'owner', trip_id: null, charter_ref: null,
  });
});

test('money out, a manual line, or an already-linked refund is not a refund candidate', () => {
  assert.equal(looksLikeRefund({ amount: -42, source: 'bank_feed' }), false);
  assert.equal(looksLikeRefund({ amount: 42, source: 'manual' }), false);
  assert.equal(looksLikeRefund({ amount: 42, source: 'bank_feed', refund_of_id: 'x' }), false);
});

// ── department default: whose card it is, first ──────────────────────────────
test('an explicit department on the line is never overridden', () => {
  assert.equal(
    defaultDepartment({ department: 'Deck', category_code: 'ICN' }, { spenderDepartment: 'Galley' }),
    'Deck',
  );
});

test("the cardholder's department wins — cards are departmental", () => {
  // The engineer's card, whatever was bought on it, is Engineering's spend.
  assert.equal(
    defaultDepartment({ category_code: 'ICN' }, { spenderDepartment: 'Engineering' }),
    'Engineering',
  );
  assert.equal(
    defaultDepartment({ category_code: 'GFE' }, { spenderDepartment: 'Interior' }),
    'Interior',
  );
});

test('the MYBA code backs it up when no cardholder department is known', () => {
  // A shared ship card with no named holder, or a crew member with no department set.
  assert.equal(defaultDepartment({ category_code: 'DCN' }, {}), 'Deck');
  assert.equal(defaultDepartment({ category_code: 'FLE' }, { spenderDepartment: '' }), 'Engineering');
});

test('with nothing to go on, department stays unset rather than guessed', () => {
  assert.equal(defaultDepartment({}, {}), '');
  assert.equal(defaultDepartment({ category_code: 'GME' }, {}), '');
  assert.equal(defaultDepartment(null, {}), '');
});

test('the reconciler fills in only when no spender is known', () => {
  // Crew reconcile their own cards, so on an account with no named holder the
  // person doing the work is still the best available guess.
  assert.equal(
    defaultDepartment({}, { spenderDepartment: '', reconcilerDepartment: 'Engineering' }),
    'Engineering',
  );
  // A known spender always wins over the reconciler.
  assert.equal(
    defaultDepartment({}, { spenderDepartment: 'Galley', reconcilerDepartment: 'Engineering' }),
    'Galley',
  );
  // The category is only reached when no person's department is known.
  assert.equal(
    defaultDepartment({ category_code: 'DCN' }, { reconcilerDepartment: 'Bridge' }),
    'Deck',
  );
});
