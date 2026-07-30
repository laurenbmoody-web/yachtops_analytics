// Cargo Accounts — month-end close. Pure, no Supabase, so the money equation is
// testable and the UI can't quietly disagree with what gets written down.
//
// THE RULE THAT MATTERS: a month is never "balanced" by posting a figure that makes
// it balance. That's a plug, and a plug hides the very thing reconciliation exists to
// catch. The number that must reach zero is the DIFFERENCE between what Cargo thinks
// the account holds and what the bank says it holds:
//
//     opening + money in − money out  =  ledger closing
//     ledger closing − bank closing   =  difference   → must be 0 to close
//
// What happens *after* that depends on how the account is funded, which is the part
// vessels genuinely differ on:
//
//   IMPREST  — a float held at a set level (the classic ship's account). Spend it,
//              report it, and the manager transfers in exactly what was spent so the
//              float is restored. Closes back to the float level, NOT to zero.
//   PREPAID  — loaded up front (Voly-style cards). Spend draws the balance down;
//              there is no reimbursement, so the question is when to top up.
//   APA      — the charter advance belongs to the guest. At the end of the charter
//              the unspent balance is returned, so this one really does close to zero.

// ── Which model does an account run? ─────────────────────────────────────────
// An explicit funding_model wins; otherwise it's inferred from the funds_type the
// account already carries, so existing accounts behave sensibly without setup.
export const FUNDING_MODELS = ['imprest', 'prepaid', 'apa'];

export const fundingModel = (account) => {
  if (FUNDING_MODELS.includes(account?.funding_model)) return account.funding_model;
  if (account?.funds_type === 'charter_apa') return 'apa';
  return 'imprest';                     // owner / general / petty_cash all behave as a float
};

export const fundingModelLabel = (model) => ({
  imprest: 'Float — reimbursed monthly',
  prepaid: 'Prepaid — drawn down',
  apa: 'Charter APA — returned to guest',
}[model] || 'Float');

// ── When is a month actually due? ────────────────────────────────────────────
// Month-end is month-end: you cannot reconcile July against a statement the bank
// hasn't issued. So the close only presents itself as due once the month is over.
//
// It is NOT hidden before then, because the half of the work that isn't the
// statement — categories, receipts — is exactly what you want chipped away during
// the month rather than discovered in a heap on the 1st. It just collapses to what
// you can act on today.
export const lastDayOfMonth = (monthKey) => {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const monthEndStage = (monthKey, today = new Date(), status = 'open') => {
  if (status === 'approved' || status === 'submitted') return 'closed';
  const now = (today instanceof Date ? today : new Date(today)).toISOString().slice(0, 7);
  const key = String(monthKey || '').slice(0, 7);
  if (!key) return 'running';
  if (key > now) return 'ahead';        // a month that hasn't started
  if (key === now) return 'running';    // still collecting spend; no statement yet
  return 'due';                         // over, and waiting to be balanced
};

// Only a month that's actually over opens itself. Anything else would be a panel
// demanding figures that don't exist yet.
export const opensByDefault = (stage) => stage === 'due';

// What the collapsed line says. It has to be worth reading on its own, or the
// section is just a closed drawer.
export const stageSummary = (stage, { monthLabel = 'this month', blockers = [], statementDue = '' } = {}) => {
  if (stage === 'closed') return `${monthLabel} is closed.`;
  if (stage === 'ahead') return `${monthLabel} hasn’t started.`;
  if (stage === 'running') {
    const work = blockers.filter((b) => b.count > 0);
    const total = work.reduce((s, b) => s + b.count, 0);
    const tail = statementDue ? ` The statement covers up to ${statementDue}.` : '';
    if (!total) return `${monthLabel} is still running, and every line so far is in order.${tail}`;
    return `${monthLabel} is still running. ${total} ${total === 1 ? 'line' : 'lines'} to sort before it can be balanced.${tail}`;
  }
  return `${monthLabel} is over and waiting to be balanced.`;
};

// ── The cash-book equation ───────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Void lines never move money; everything else does.
const isLive = (t) => t && t.status !== 'void';

export const monthFigures = (openingBalance, txns) => {
  let moneyIn = 0; let moneyOut = 0;
  (txns || []).filter(isLive).forEach((t) => {
    const a = Number(t.amount) || 0;
    if (a >= 0) moneyIn += a; else moneyOut += a;
  });
  const opening = round2(openingBalance);
  return {
    opening,
    moneyIn: round2(moneyIn),
    moneyOut: round2(moneyOut),        // negative
    net: round2(moneyIn + moneyOut),
    closing: round2(opening + moneyIn + moneyOut),
  };
};

// ── Matching the bank statement ──────────────────────────────────────────────
// The month-end statement is the source document, and it states four things:
// an opening balance, total money in, total money out, and a closing balance.
// Cargo must agree with whichever of those the statement gives us.
//
// The two checks catch different mistakes, which is why both are worth having:
//   TOTAL OUT / TOTAL IN — catches a line we never received, a duplicate, or a
//                          wrong amount. This is the month's own arithmetic.
//   CLOSING BALANCE      — catches all of the above PLUS an error carried in from
//                          the opening balance or a previous period.
// Matching the movement totals is the practical minimum; matching the closing
// balance as well is the stronger proof.

export const compareFigure = (ours, theirs) => {
  if (theirs == null || theirs === '') return null;             // statement didn't state it
  return round2(Number(ours || 0) - Number(theirs));
};

export const isBalanced = (difference) => difference != null && Math.abs(difference) < 0.005;

// Kept for the closing-balance-only case.
export const reconcileDifference = (ledgerClosing, bankClosing) => compareFigure(ledgerClosing, bankClosing);

// One row per figure the statement gave us, so the UI can show ours vs theirs.
// `statement` = { opening, moneyIn, moneyOut, closing } — any subset.
export const statementChecks = (figures, statement = {}) => {
  const rows = [
    { key: 'moneyOut', label: 'Total out', ours: Math.abs(figures.moneyOut), theirs: statement.moneyOut == null || statement.moneyOut === '' ? null : Math.abs(Number(statement.moneyOut)) },
    { key: 'moneyIn', label: 'Total in', ours: figures.moneyIn, theirs: statement.moneyIn == null || statement.moneyIn === '' ? null : Math.abs(Number(statement.moneyIn)) },
    { key: 'opening', label: 'Opening balance', ours: figures.opening, theirs: statement.opening == null || statement.opening === '' ? null : Number(statement.opening) },
    { key: 'closing', label: 'Closing balance', ours: figures.closing, theirs: statement.closing == null || statement.closing === '' ? null : Number(statement.closing) },
  ];
  return rows.map((r) => {
    const difference = compareFigure(r.ours, r.theirs);
    return { ...r, difference, stated: r.theirs != null, ok: difference == null ? null : isBalanced(difference) };
  });
};

// Has the statement told us enough to reconcile at all? The month's movement is the
// minimum — a closing balance alone can't prove the lines themselves are right.
export const hasEnoughStatement = (checks) =>
  checks.some((c) => c.stated && (c.key === 'moneyOut' || c.key === 'moneyIn' || c.key === 'closing'));

// ── What each funding model owes or holds at the end of the month ────────────
// Derived from the figures — never typed, never used to force a balance.
export const fundingOutcome = (model, figures, account) => {
  const closing = figures?.closing ?? 0;
  if (model === 'apa') {
    // The advance belongs to the guest: whatever is left goes back.
    return {
      key: 'return',
      label: 'Unspent to return to guest',
      amount: round2(Math.max(0, closing)),
      note: closing < 0
        ? 'The APA is overspent — this much is due from the guest.'
        : 'Settle at the end of the charter, not month-end.',
      overspent: closing < 0 ? round2(Math.abs(closing)) : 0,
    };
  }
  if (model === 'prepaid') {
    return {
      key: 'available',
      label: 'Available to spend',
      amount: closing,
      note: closing <= 0 ? 'Exhausted — a top-up is needed before further spend.' : 'Drawn down as it is spent; top up before it runs out.',
    };
  }
  // Imprest: restore the float to its set level. With no target set we can still say
  // what was spent, which is what a reimbursement claim is for.
  const target = Number(account?.float_target);
  if (Number.isFinite(target) && target > 0) {
    return {
      key: 'reimbursement',
      label: 'Reimbursement due to restore float',
      amount: round2(Math.max(0, target - closing)),
      note: `Float is set at ${target.toFixed(2)}.`,
      floatTarget: round2(target),
    };
  }
  return {
    key: 'reimbursement',
    label: 'Spend to reimburse',
    amount: round2(Math.abs(figures?.moneyOut ?? 0)),
    note: 'Set a float level on the account to track the top-up precisely.',
    floatTarget: null,
  };
};

// ── Can this month be closed? ────────────────────────────────────────────────
// Everything that must be true, as a list the UI can show. Closing is blocked
// until all of it is clear — no plug, no override.
export const closeBlockers = ({
  txns = [], hasReceipt = () => false, splitCount = () => 0,
  figures = null, statement = {}, requireReceipts = true,
} = {}) => {
  const live = txns.filter(isLive);
  const blockers = [];

  const uncategorised = live.filter((t) => !t.category && splitCount(t) === 0);
  if (uncategorised.length) {
    blockers.push({ key: 'uncategorised', label: 'still to categorise', count: uncategorised.length });
  }

  const unassigned = live.filter((t) => !t.account_id);
  if (unassigned.length) {
    blockers.push({ key: 'unassigned', label: 'not assigned to an account', count: unassigned.length });
  }

  if (requireReceipts) {
    const noReceipt = live.filter((t) => !hasReceipt(t));
    if (noReceipt.length) {
      blockers.push({ key: 'receipts', label: 'without a receipt', count: noReceipt.length });
    }
  }

  const pending = live.filter((t) => t.is_pending);
  if (pending.length) {
    blockers.push({ key: 'pending', label: 'still pending at the bank', count: pending.length });
  }

  // Nothing to reconcile against yet.
  const checks = figures ? statementChecks(figures, statement) : [];
  if (!figures || !hasEnoughStatement(checks)) {
    blockers.push({ key: 'statement', label: 'enter the month’s figures from the bank statement', count: 0 });
    return blockers;
  }

  // Every figure the statement DID state must agree.
  checks.filter((c) => c.stated && c.ok === false).forEach((c) => {
    blockers.push({
      key: `diff:${c.key}`,
      label: `${c.label.toLowerCase()} doesn’t match the statement`,
      count: 0,
      amount: Math.abs(c.difference),
      ours: c.ours,
      theirs: c.theirs,
    });
  });

  return blockers;
};

export const canCloseMonth = (args) => closeBlockers(args).length === 0;

// The sentence the month-end section leads with. closeMessage states what's
// wrong; this states what to DO about it, because a status nobody can act on is
// just decoration. Always exactly one instruction — the next one, not all of them.
export const closeHeadline = (blockers = [], status = 'open', monthLabel = 'this month', fmt = null) => {
  const money = fmt || formatAmount;
  if (status === 'approved') return `${monthLabel} is closed and signed off.`;
  if (status === 'submitted') return `${monthLabel} is with Command for sign-off.`;
  if (!blockers.length) return `Everything agrees. Close ${monthLabel}.`;

  // A mismatch outranks everything: it means the lines themselves are wrong, and
  // categorising more of them won't fix it.
  const diff = blockers.find((b) => b.key.startsWith('diff:'));
  if (diff) {
    const dir = diff.ours > diff.theirs ? 'more than' : 'less than';
    return `Cargo has ${money(diff.amount)} ${dir} the statement on ${diff.label.replace(' doesn’t match the statement', '')}.`;
  }

  if (blockers.some((b) => b.key === 'statement')) {
    return `Type ${monthLabel}’s figures from the bank statement and Cargo will tell you whether it agrees.`;
  }

  const first = blockers[0];
  const n = first.count;
  return `${n} ${n === 1 ? 'line' : 'lines'} ${first.label} — sort ${n === 1 ? 'it' : 'those'} first.`;
};

const formatAmount = (n) => Number(n || 0).toFixed(2);

// A one-line summary for the strip: what's left, or that it's ready.
export const closeMessage = (blockers, status) => {
  if (status === 'approved') return 'Closed and signed off.';
  if (status === 'submitted') return 'Submitted for sign-off.';
  if (!blockers.length) return 'Balanced — ready to close.';
  const diff = blockers.find((b) => b.key.startsWith('diff:'));
  if (diff) return `Out by ${diff.amount.toFixed(2)} — ${diff.label}.`;
  const first = blockers[0];
  return first.count
    ? `${first.count} ${first.count === 1 ? 'line' : 'lines'} ${first.label}.`
    : `First: ${first.label}.`;
};
