// Cargo Accounts — reconciliation line-detail logic (pure, no imports beyond the
// chart). Decides the DEFAULTS and VALIDITY for turning a coded ledger line into a
// fully reconciled one, so the panel stays dumb and this stays testable.
//
// Three rules the crew actually work by:
//
//  1. CARDHOLDER — crew reconcile their own cards, so the spender defaults to the
//     card's holder. Only occasionally did someone borrow another crew member's
//     card, so it's an override, not a question we ask every time.
//
//  2. CHARTER vs OWNER — if the vessel has dedicated charter/APA cards, the account
//     itself answers it (funds_type) and we don't nag. If charter money goes out on
//     a general/ship card, the line must say so — and then it MUST name which
//     charter, because an APA cost with no charter can't be billed.
//
//  3. SPLITS — one payment attributed across several MYBA lines. The parts must sum
//     to the parent (that's the whole point), so we surface the remainder live.

import { STANDARD_CHART_OF_ACCOUNTS } from '../pages/accounts/budgets/data/mybaChartOfAccounts.js';

// ── Department ───────────────────────────────────────────────────────────────
// MYBA bucket → the department that owns the spend, so picking a category
// pre-fills the department instead of asking twice. Buckets that aren't a
// department (Guest Costs, Fuel, Financial…) stay null — the user may still set one.
const BUCKET_DEPARTMENT = {
  Deck: 'Deck',
  Engineer: 'Engineering',
  Interior: 'Interior',
};

const CODE_DEPARTMENT = {
  CFC: 'Galley',    // crew food & consumables — the galley buys it
  GFE: 'Galley',    // guest food stock
  GWS: 'Galley',    // guest wine stock
  FLE: 'Engineering',
  FLT: 'Engineering',
  NAV: 'Bridge',
  CRT: 'Bridge',
  LSF: 'Deck',
  ADM: 'Shore / Management',
  MGE: 'Shore / Management',
  INS: 'Shore / Management',
};

const BUCKET_BY_CODE = STANDARD_CHART_OF_ACCOUNTS.reduce((m, l) => { m[l.code] = l.bucket; return m; }, {});

// Suggested department for a MYBA code, or null when the code implies none.
export const departmentForCode = (code) => {
  if (!code) return null;
  if (CODE_DEPARTMENT[code]) return CODE_DEPARTMENT[code];
  return BUCKET_DEPARTMENT[BUCKET_BY_CODE[code]] || null;
};

// ── Allocation (charter vs owner) ────────────────────────────────────────────
// An account whose funds are ring-fenced for a charter answers the question by
// itself. 'charter_apa' → charter money; 'owner' → owner money. Anything else
// (general, petty_cash) is ambiguous and must be stated per line.
export const isDedicatedCharterAccount = (account) => (account?.funds_type === 'charter_apa');
export const isDedicatedOwnerAccount = (account) => (account?.funds_type === 'owner');

// Does this account settle the allocation question on its own?
export const accountImpliesAllocation = (account) =>
  isDedicatedCharterAccount(account) || isDedicatedOwnerAccount(account);

// The allocation a line should start on: whatever it already has, else whatever
// the account implies, else nothing (make the user choose).
export const defaultAllocation = (txn, account) => {
  if (txn?.allocation) return txn.allocation;
  if (isDedicatedCharterAccount(account)) return 'charter';
  if (isDedicatedOwnerAccount(account)) return 'owner';
  return null;
};

// Which charter? Only asked when the money is charter money AND the account isn't
// already a dedicated charter card (in which case the card's own charter context
// applies and we don't interrupt).
export const needsTripPick = (allocation, account) =>
  allocation === 'charter' && !isDedicatedCharterAccount(account);

// ── Cardholder ───────────────────────────────────────────────────────────────
// Defaults to the card's holder; an explicit crew_id on the line always wins
// (that's the "someone borrowed the card" case).
export const defaultCardholder = (txn, account) => txn?.crew_id || account?.holder_user_id || null;

// True when the line's spender isn't the card's own holder — worth flagging in the
// UI so it's a visible, deliberate exception rather than a silent mis-assignment.
export const isBorrowedCard = (crewId, account) =>
  Boolean(crewId && account?.holder_user_id && crewId !== account.holder_user_id);

// ── Splits ───────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The crew type MAGNITUDES ("14" on a £26 payment), not signed figures — nobody
// types a minus sign into a split. So split amounts are always interpreted as
// absolute values and given the parent's direction. Everything below therefore
// works in magnitudes, which is also what we show back.
export const splitTotal = (splits) =>
  round2((splits || []).reduce((a, s) => a + Math.abs(Number(s.amount) || 0), 0));

// How much of the payment is still unallocated, as a magnitude: a £26 payment with
// one £14 part leaves £12.
export const splitRemainder = (parentAmount, splits) =>
  round2(Math.abs(Number(parentAmount) || 0) - splitTotal(splits));

// Apply the parent's direction to the typed magnitudes, ready to store.
export const signedSplits = (parentAmount, splits) => {
  const sign = (Number(parentAmount) || 0) < 0 ? -1 : 1;
  return (splits || []).map((s) => ({ ...s, amount: round2(sign * Math.abs(Number(s.amount) || 0)) }));
};

// The most a given part may be: the payment less everything allocated to the OTHER
// parts. Used to refuse an over-allocation as it's typed, rather than letting a
// line be saved that doesn't reconcile.
export const maxForPart = (parentAmount, splits, index) => {
  const others = (splits || []).filter((_, i) => i !== index);
  return Math.max(0, round2(Math.abs(Number(parentAmount) || 0) - splitTotal(others)));
};

// Clamp a typed part amount to what's actually left. Returns the value to keep and
// whether it had to be cut back, so the UI can reject the keystroke visibly.
export const clampSplitAmount = (parentAmount, splits, index, typed) => {
  const raw = String(typed ?? '');
  if (raw === '' || raw === '.') return { value: raw, clamped: false };
  const n = Math.abs(Number(raw));
  if (Number.isNaN(n)) return { value: '', clamped: false };
  const max = maxForPart(parentAmount, splits, index);
  if (n > max + 0.004) return { value: String(max), clamped: true };
  return { value: raw, clamped: false };
};

// Is the split set ready to save? Every part needs a category and a non-zero
// amount, and the parts must add up to the payment exactly.
export const validateSplits = (parentAmount, splits) => {
  const list = splits || [];
  if (!list.length) return { ok: true, reason: null, remainder: 0 };
  const remainder = splitRemainder(parentAmount, list);
  if (list.length < 2) return { ok: false, reason: 'A split needs at least two parts', remainder };
  if (list.some((s) => !s.category)) return { ok: false, reason: 'Every part needs a category', remainder };
  if (list.some((s) => !Number(s.amount))) return { ok: false, reason: 'Every part needs an amount', remainder };
  if (Math.abs(remainder) > 0.004) return { ok: false, reason: 'Parts must add up to the payment', remainder };
  return { ok: true, reason: null, remainder: 0 };
};

// ── VAT / FX ─────────────────────────────────────────────────────────────────
// Net-of-VAT figure for display, so the crew can sanity-check a reclaim.
export const netOfVat = (amount, vatAmount) => {
  const a = Number(amount) || 0;
  const v = Number(vatAmount) || 0;
  if (!v) return a;
  return round2(a - (a < 0 ? -Math.abs(v) : Math.abs(v)));
};

// VAT implied by a rate, when the crew give a % instead of a figure.
export const vatFromRate = (amount, ratePct) => {
  const a = Math.abs(Number(amount) || 0);
  const r = Number(ratePct) || 0;
  if (!r) return 0;
  return round2(a - a / (1 + r / 100));
};

// Base-currency value of a foreign line. fx_rate is "base per txn currency".
export const baseFromFx = (amount, fxRate) => {
  const a = Number(amount) || 0;
  const r = Number(fxRate);
  if (!r || Number.isNaN(r)) return a;
  return round2(a * r);
};

// ── The two dates ────────────────────────────────────────────────────────────
// A bank line has a date it HAPPENED (txn_date — the crew tapped the card) and a
// date it LANDED on the statement (statement_date — the bank posted it). They
// differ constantly on cards, and at a month boundary that difference decides
// which month's accounts own the cost.
//
//   'spend'     — group/report by when it happened. Correct for management
//                 accounts and budget-vs-actual: the cost belongs to the month it
//                 was incurred.
//   'statement' — group by when the bank posted it. Correct when tying the ledger
//                 to a bank statement, because that's the month the bank shows.
export const DATE_BASES = ['spend', 'statement'];

export const effectiveDate = (txn, basis = 'spend') => {
  if (!txn) return null;
  if (basis === 'statement') return txn.statement_date || txn.txn_date || null;
  return txn.txn_date || txn.statement_date || null;
};

// True when the two dates disagree — worth showing on the line, because it's the
// case that silently moves money between months.
export const datesDiffer = (txn) =>
  Boolean(txn?.statement_date && txn?.txn_date && txn.statement_date !== txn.txn_date);

// Does the posting date fall in a different MONTH from the spend date? This is the
// one that actually distorts a period, so it earns a visible flag.
export const straddlesMonth = (txn) => {
  if (!datesDiffer(txn)) return false;
  return String(txn.txn_date).slice(0, 7) !== String(txn.statement_date).slice(0, 7);
};

// ── Completeness ─────────────────────────────────────────────────────────────
// The five things a reconciled line needs, in the order they're worked through.
// The UI renders these as a small filled/unfilled track (no pills, no prose) so
// the state of every line is scannable down the list.
export const REQUIREMENTS = [
  { key: 'category', label: 'Category' },
  { key: 'note', label: 'Description' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'department', label: 'Department' },
  { key: 'allocation', label: 'Who pays' },
];

// Per-requirement done/not, plus the count — the data behind the track.
export const requirementState = (txn, { account, hasReceipt, splitCount = 0 } = {}) => {
  const alloc = txn?.allocation || defaultAllocation(txn, account);
  const charterOk = alloc !== 'charter' || !needsTripPick(alloc, account)
    || Boolean(txn?.trip_id || txn?.charter_ref);
  const done = {
    // A split line is categorised by its parts, so the parent needn't carry one.
    category: Boolean(txn?.category) || splitCount > 0,
    note: Boolean(txn?.note),
    receipt: Boolean(hasReceipt),
    // A split line carries its departments on the parts, so the parent needn't repeat it.
    department: Boolean(txn?.department) || splitCount > 0,
    allocation: Boolean(alloc) && charterOk,
  };
  const count = REQUIREMENTS.filter((r) => done[r.key]).length;
  return { done, count, total: REQUIREMENTS.length };
};

// Three-state summary for the row's rail: nothing done yet, part-way, or finished.
export const lineState = (txn, ctx = {}) => {
  const { count, total } = requirementState(txn, ctx);
  if (count === 0) return 'untouched';
  if (count < total) return 'progress';
  return 'complete';
};


// What "reconciled" really means for a line, as a checklist the UI can render.
// Category is the only hard requirement; the rest are 'wanted' — flagged when
// missing so the crew can see how solid the line is, without being blocked.
export const lineCompleteness = (txn, { account, hasReceipt, splitCount = 0 } = {}) => {
  const missing = [];
  if (!txn?.category) missing.push('category');
  if (!hasReceipt) missing.push('receipt');
  if (!txn?.note) missing.push('note');
  if (!txn?.department && !splitCount) missing.push('department');
  const alloc = txn?.allocation || defaultAllocation(txn, account);
  if (!alloc) missing.push('allocation');
  // An APA cost with no charter named can't be billed to anyone — a typed
  // charter_ref counts, for vessels that haven't set trips up in Cargo.
  if (alloc === 'charter' && needsTripPick(alloc, account) && !txn?.trip_id && !txn?.charter_ref) missing.push('charter');
  return { missing, complete: missing.length === 0 };
};
