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

// The department a line should start on, in priority order:
//
//   1. Whatever is already on the line — never overridden.
//   2. The department of the person whose CARD it is. Cards are departmental: the
//      chief stew works her own, the engineer his, so spend on a card belongs to
//      that department's budget whatever was bought. This follows the "who spent it"
//      selection, so when a reconciler spots a line that was actually someone
//      else's, changing the spender moves the department with it — which is what
//      they'd otherwise do by hand.
//   3. The department the MYBA code implies — a backstop for a shared/ship card with
//      no named holder, or a crew member with no department recorded.
//   4. The department of whoever is reconciling, as a last resort.
//
// Note this ranks the cardholder ABOVE the category on purpose. The MYBA code still
// records what was bought (an engineer buying interior consumables is still ICN); the
// department records whose card and budget it came out of.
//
// Nothing here is silent: the panel says which of these a value came from, and any of
// it can be overridden.
export const defaultDepartment = (txn, { spenderDepartment, reconcilerDepartment } = {}) => {
  if (txn?.department) return txn.department;
  if (spenderDepartment) return spenderDepartment;
  return departmentForCode(txn?.category_code) || reconcilerDepartment || '';
};

// ── Allocation (charter vs owner) ────────────────────────────────────────────
// An account whose funds are ring-fenced for a charter answers the question by
// itself. 'charter_apa' → charter money; 'owner' → owner money. Anything else
// (general, petty_cash) is ambiguous and must be stated per line.
export const isDedicatedCharterAccount = (account) => (account?.funds_type === 'charter_apa');

export const isCharterTrip = (t) => String(t?.trip_type || '').toLowerCase() === 'charter';

// Does this vessel charter at all? NOT "is it on charter today" — provisioning
// for a charter happens weeks ahead of it, so the date a thing was bought says
// nothing about whose money bought it. Tying the option to a charter covering the
// spend date meant a crate of wine bought in July for a September charter had no
// way to be coded as charter money.
//
// "Set up for charter" in Cargo's terms is an APA/charter account on the books or
// a charter trip on record. A line already allocated to charter keeps the option
// regardless — hiding it wouldn't unset the value, just make it unreadable.
export const canBeCharter = ({ account, accounts = [], trips = [], allocation = '' } = {}) => (
  allocation === 'charter'
  || isDedicatedCharterAccount(account)
  || accounts.some(isDedicatedCharterAccount)
  || trips.some(isCharterTrip)
);

// The charters a line can be pinned to — every one on record, whenever it runs.
export const charterOptions = (trips = []) => trips.filter(isCharterTrip);
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
// What a line needs before its month can be defended. `optional` items still show
// in the detail panel's track — they're worth having — but they don't count as
// outstanding on the row, because a row that says "needs a note" on every line is
// telling the crew off for not writing prose about Alfies Fish & Chips.
//
// The four that aren't optional are the ones an auditor would ask for: what it
// was (category), proof (receipt or a stated reason), who bears it (allocation),
// and which department it lands in.
export const REQUIREMENTS = [
  { key: 'category', label: 'Category' },
  { key: 'note', label: 'Description', optional: true },
  { key: 'receipt', label: 'Receipt' },
  // Also optional: the department follows the card, and the card follows its
  // holder — so it's answered before anyone looks at the line, and the panel
  // writes the derived value down on any save. Occasionally someone moves a line
  // to another department; that's an edit, not an outstanding task.
  { key: 'department', label: 'Department', optional: true },
  { key: 'allocation', label: 'Who pays' },
];

// Evidence for a line is a receipt OR a stated reason there isn't one. No
// thresholds, no exemptions by amount or source: every line needs one or the other.
//
// The reason is not optional — ticking "no receipt" without saying why proves
// nothing, so a blank reason leaves the line unevidenced.
//
// A line raised against a supplier invoice already HAS its document: the invoice
// is in Cargo, linked to this line, and is better evidence than a photographed
// till slip. Asking the crew to go and attach a receipt for it was asking them to
// re-prove something the system was holding — and it blocked the month's close
// until they did.
//
// A purchase order is NOT evidence and never counts. A PO says what was ordered;
// it says nothing about what was paid, which is the thing a receipt attests to.
export const hasEvidence = (txn, hasAttachment) => {
  if (hasAttachment) return true;
  if (txn?.supplier_invoice_id) return true;
  return Boolean(txn?.receipt_waived) && Boolean(String(txn?.receipt_waived_reason || '').trim());
};

// The patch that declares (or withdraws) "there is no receipt for this". A blank
// or whitespace reason is a withdrawal, not a declaration — see hasEvidence: an
// unexplained "no receipt" evidences nothing, so it must not be storable as one.
export const receiptWaiverPatch = (reason) => {
  const text = String(reason ?? '').trim();
  return text
    ? { receipt_waived: true, receipt_waived_reason: text }
    : { receipt_waived: false, receipt_waived_reason: null };
};

// Per-requirement done/not, plus the count — the data behind the track.
export const requirementState = (txn, {
  account, hasReceipt, splitCount = 0, spenderDepartment = '',
} = {}) => {
  const alloc = txn?.allocation || defaultAllocation(txn, account);
  const charterOk = alloc !== 'charter' || !needsTripPick(alloc, account)
    || Boolean(txn?.trip_id || txn?.charter_ref);
  const done = {
    // A split line is categorised by its parts, so the parent needn't carry one.
    category: Boolean(txn?.category) || splitCount > 0,
    note: Boolean(txn?.note),
    receipt: hasEvidence(txn, hasReceipt),
    // A split line carries its departments on the parts, so the parent needn't
    // repeat it. Beyond that, a department Cargo can work out from the category
    // code or from whose card it is counts as answered: the row was saying "needs
    // a department" while the panel showed one, because the panel displays the
    // derived value and this only looked at the stored one.
    //
    // The reconciler's own department is NOT a derivation — that's "whoever
    // happens to be looking", so it stays a prompt rather than an answer.
    department: Boolean(txn?.department) || splitCount > 0
      || Boolean(departmentForCode(txn?.category_code)) || Boolean(spenderDepartment),
    allocation: Boolean(alloc) && charterOk,
  };
  // The row's rail (untouched / part-way / complete) reads off the required
  // ones, so an unwritten note can't hold a line at amber forever.
  const required = REQUIREMENTS.filter((r) => !r.optional);
  const count = required.filter((r) => done[r.key]).length;
  return { done, count, total: required.length };
};

// What's outstanding, in words, shortest useful form — e.g. "needs a note" or
// "needs a receipt and a note". The row prints this as ordinary muted text: a
// count of anonymous ticks can't tell you what to do, and a pill shouts.
const NEEDS_WORDING = {
  category: 'a category',
  note: 'a note',
  receipt: 'a receipt',
  receiptReason: 'a reason for no receipt',
  department: 'a department',
  allocation: 'owner or charter',
};

export const outstandingText = (txn, ctx = {}) => {
  const { done } = requirementState(txn, ctx);
  const missing = REQUIREMENTS.filter((r) => !r.optional && !done[r.key]).map((r) => (
    // A ticked "no receipt" box with nothing typed needs the reason, not a receipt.
    r.key === 'receipt' && txn?.receipt_waived ? NEEDS_WORDING.receiptReason : NEEDS_WORDING[r.key]
  ));
  if (!missing.length) return '';
  if (missing.length === 1) return `needs ${missing[0]}`;
  if (missing.length === 2) return `needs ${missing[0]} and ${missing[1]}`;
  return `needs ${missing.slice(0, 2).join(', ')} and ${missing.length - 2} more`;
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

// ── Spend date can't be after the bank posted it ─────────────────────────────
// A card authorisation always happens before — or on — the day the bank posts it.
// A spend date later than the statement date is therefore impossible, and would
// push the cost into a month it can't belong to.
export const maxSpendDate = (txn) => txn?.statement_date || null;

export const isSpendDateValid = (spendDate, statementDate) => {
  if (!spendDate) return false;
  if (!statementDate) return true;                 // nothing to check against
  return String(spendDate) <= String(statementDate);
};

// ── What may be voided ───────────────────────────────────────────────────────
// Voiding says "this money never moved". That's only ever true of a line a human
// typed. A bank-derived line is the bank's own record — the money DID move, so it
// can't be wished away; a genuine reversal arrives as its own refund line.
const BANK_DERIVED = new Set(['bank_feed', 'import']);

export const canVoidTxn = (txn) => {
  if (!txn || txn.status === 'void') return false;
  return !BANK_DERIVED.has(txn.source);
};

export const voidBlockedReason = (txn) => {
  if (!txn || !BANK_DERIVED.has(txn.source)) return null;
  return txn.source === 'bank_feed'
    ? 'This came from the bank — the money moved, so it can’t be voided. A reversal arrives as its own refund line.'
    : 'This came from an imported statement and can’t be voided.';
};

// ── Refunds ──────────────────────────────────────────────────────────────────
// A merchant refund arrives in the feed as its own POSITIVE line from the same
// merchant. Left alone it looks like income, which flatters the accounts and
// leaves the original spend overstated. Linked to the original it nets the same
// MYBA line down, which is what actually happened.
//
// A refund is a candidate match when: it's money in, the merchant matches, the
// original is money out, the refund is no bigger than the original, the original
// isn't already refunded, and it's within a sensible window.
const REFUND_WINDOW_DAYS = 120;

const daysBetween = (a, b) => {
  const da = new Date(a); const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((da - db) / 86400000);
};

export const looksLikeRefund = (txn) =>
  Boolean(txn) && Number(txn.amount) > 0 && txn.source === 'bank_feed' && !txn.refund_of_id;

// Best original for a refund line, or null. `normalize` is injected so this stays
// free of the merchant classifier (and easy to test).
export const findRefundCandidate = (refund, all, normalize) => {
  if (!looksLikeRefund(refund)) return null;
  const key = normalize(refund.payee);
  if (!key) return null;
  const refunded = new Set((all || []).map((t) => t.refund_of_id).filter(Boolean));
  const candidates = (all || []).filter((t) => {
    if (t.id === refund.id || t.status === 'void') return false;
    if (Number(t.amount) >= 0) return false;                       // must be money out
    if (normalize(t.payee) !== key) return false;                  // same merchant
    if (Math.abs(Number(t.amount)) + 0.004 < Number(refund.amount)) return false; // not bigger than the original
    if (refunded.has(t.id)) return false;                          // already refunded
    const gap = daysBetween(refund.txn_date, t.txn_date);
    return gap != null && gap >= 0 && gap <= REFUND_WINDOW_DAYS;   // after it, within the window
  });
  if (!candidates.length) return null;
  // Prefer an exact amount match, then the most recent.
  const exact = candidates.filter((t) => Math.abs(Math.abs(Number(t.amount)) - Number(refund.amount)) <= 0.004);
  const pool = exact.length ? exact : candidates;
  return pool.sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)))[0];
};

// The fields a refund inherits from the spend it reverses, so the same budget line
// nets down instead of the refund landing as income.
export const refundInheritedFields = (original) => ({
  category: original?.category || null,
  category_code: original?.category_code || null,
  department: original?.department || null,
  allocation: original?.allocation || null,
  trip_id: original?.trip_id || null,
  charter_ref: original?.charter_ref || null,
});
