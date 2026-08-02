// Cargo Accounts — when the month doesn't match the statement, say what it
// probably is.
//
// "Out by £100.01, find it" is not help. Cargo holds every line, both dates, the
// pending flag and the unassigned pile, so it can nearly always name the handful
// of lines that would explain a gap of exactly that size. The crew then confirm
// or dismiss — Cargo never edits anything on a hunch, and never plugs.
//
// Ranked by how specific the explanation is, not how likely: a duplicate pair
// worth exactly the difference is worth showing above a coincidental sum of two
// unrelated lines, because it tells you what to DO.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isLive = (t) => t && t.status !== 'void';
const mag = (t) => Math.abs(Number(t?.amount) || 0);
const near = (a, b) => Math.abs(round2(a) - round2(b)) < 0.005;
const ymOf = (iso) => (iso ? String(iso).slice(0, 7) : '');
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');
const naming = (t) => t?.description || t?.payee || 'that line';

// Two lines are a suspected double-post when they're the same money to the same
// place within a few days. Same-day repeat purchases exist, so this is a question,
// never an assertion.
const DUP_DAYS = 4;
const daysApart = (a, b) => {
  const x = new Date(dayOf(a)); const y = new Date(dayOf(b));
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return Infinity;
  return Math.abs((x - y) / 86400000);
};

/**
 * @param difference  ours − theirs, as statementChecks reports it. Positive means
 *                    Cargo holds MORE than the statement (something we have that
 *                    the bank doesn't); negative means the bank has more.
 * @param monthTxns   this account's lines for the month being closed
 * @param poolTxns    every line loaded — used to find spend that belongs here but
 *                    was filed elsewhere (unassigned, or dated into another month)
 * @param accountId   the account being closed
 * @param monthKey    'YYYY-MM'
 */
export const findDifferenceCandidates = ({
  difference, monthTxns = [], poolTxns = [], accountId = null, monthKey = '',
} = {}) => {
  const gap = round2(Math.abs(Number(difference) || 0));
  if (gap < 0.005) return [];

  const cargoHasMore = Number(difference) > 0;
  const live = monthTxns.filter(isLive);
  const out = [];
  const claimed = new Set();          // a line explains the gap once, not four times

  const push = (c) => {
    if (out.length >= 4) return;
    if (c.txnIds.some((id) => claimed.has(id))) return;
    c.txnIds.forEach((id) => claimed.add(id));
    out.push(c);
  };

  // ── Cargo holds more than the bank ────────────────────────────────────────
  if (cargoHasMore) {
    // A double-post is the commonest cause and the only one that's plainly wrong.
    for (const a of live) {
      if (!near(mag(a), gap)) continue;
      const twin = live.find((b) => b.id !== a.id && near(mag(b), mag(a))
        && naming(b) === naming(a) && daysApart(a.txn_date, b.txn_date) <= DUP_DAYS);
      if (twin) {
        push({
          key: `dup:${a.id}`, kind: 'duplicate', amount: mag(a), txnIds: [a.id, twin.id],
          label: `${naming(a)} appears twice within ${DUP_DAYS} days`,
          action: 'If it was only paid once, void the copy.',
        });
      }
    }

    // Authorised but not settled — genuinely not on this statement yet.
    live.filter((t) => t.is_pending && near(mag(t), gap)).forEach((t) => push({
      key: `pend:${t.id}`, kind: 'pending', amount: mag(t), txnIds: [t.id],
      label: `${naming(t)} is still pending at the bank`,
      action: 'The bank hasn’t posted it, so it belongs to next month’s statement.',
    }));

    // Spent in this month, posted in another (or the reverse) — the two-date model
    // means Cargo can be right and still disagree with a statement.
    live.filter((t) => near(mag(t), gap) && t.statement_date
      && ymOf(t.statement_date) !== ymOf(t.txn_date)).forEach((t) => push({
      key: `strad:${t.id}`, kind: 'straddle', amount: mag(t), txnIds: [t.id],
      label: `${naming(t)} was spent in one month and posted in another`,
      action: 'Switch "Month by" to the statement date and see if it agrees.',
    }));

    // Nothing clever left to say — but a line of exactly that size is still where
    // to look first.
    live.filter((t) => near(mag(t), gap)).forEach((t) => push({
      key: `exact:${t.id}`, kind: 'exact', amount: mag(t), txnIds: [t.id],
      label: `${naming(t)} is exactly the difference`,
      action: 'Check it against the statement — is it really on there?',
    }));

    // A refund booked as spend is out by twice its value, which is why a half-gap
    // money-in line explains a whole-gap difference.
    live.filter((t) => Number(t.amount) > 0 && near(mag(t) * 2, gap)).forEach((t) => push({
      key: `sign:${t.id}`, kind: 'sign', amount: mag(t), txnIds: [t.id],
      label: `${naming(t)} is money in — if it should be money out, that alone is the gap`,
      action: 'A refund pointed the wrong way is out by double its value.',
    }));
  }

  // ── The bank holds more than Cargo ────────────────────────────────────────
  if (!cargoHasMore) {
    // The likeliest answer is spend Cargo already has but hasn't put on this card.
    poolTxns.filter(isLive)
      .filter((t) => !t.account_id && near(mag(t), gap))
      .forEach((t) => push({
        key: `unass:${t.id}`, kind: 'unassigned', amount: mag(t), txnIds: [t.id],
        label: `${naming(t)} has no account and is exactly the difference`,
        action: 'If it came off this card, assign it and the month agrees.',
      }));

    // Or spend on this card sitting in the wrong month.
    poolTxns.filter(isLive)
      .filter((t) => t.account_id === accountId && ymOf(t.txn_date) !== monthKey && near(mag(t), gap))
      .forEach((t) => push({
        key: `month:${t.id}`, kind: 'othermonth', amount: mag(t), txnIds: [t.id],
        label: `${naming(t)} is on this card but dated ${ymOf(t.txn_date) || 'another month'}`,
        action: 'If the bank posted it this month, correct the date spent.',
      }));
  }

  // Last resort, either direction: two lines that happen to add up. Weakest —
  // offered only when nothing more specific fits.
  if (!out.length) {
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        if (!near(mag(live[i]) + mag(live[j]), gap)) continue;
        push({
          key: `pair:${live[i].id}:${live[j].id}`, kind: 'pair',
          amount: gap, txnIds: [live[i].id, live[j].id],
          label: `${naming(live[i])} and ${naming(live[j])} together come to the difference`,
          action: 'A coincidence as often as not — check both.',
        });
        if (out.length >= 2) return out;
      }
    }
  }

  return out;
};

// The sentence above the list. Honest when there's nothing to offer — a false
// "we found it" is worse than admitting the search came up empty.
// Is the typed figure a slip of the pen rather than a real disagreement? A
// statement that's out by one digit, or by a swapped pair, or by a decimal place,
// is almost always a mistype — and sending someone hunting for a missing
// transaction to explain their own typo wastes the afternoon.
//
// Compared as fixed-2 strings, because that's the shape both numbers are read and
// typed in.
export const typoKind = (ours, theirs) => {
  const a = Number(ours); const b = Number(theirs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;

  const sa = Math.abs(a).toFixed(2);
  const sb = Math.abs(b).toFixed(2);

  if (sa.length === sb.length) {
    let diffs = 0;
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) diffs += 1;
    if (diffs === 1) return 'one digit out';
    const sorted = (x) => x.split('').sort().join('');
    if (diffs === 2 && sorted(sa) === sorted(sb)) return 'two digits swapped';
  }

  // A decimal place adrift, either way.
  if (Math.abs(a * 10 - b) < 0.005 || Math.abs(a / 10 - b) < 0.005) return 'a decimal place out';

  // A digit dropped or added — same digits in order, one string shorter.
  const digits = (x) => x.replace('.', '');
  const [shortS, longS] = digits(sa).length < digits(sb).length ? [digits(sa), digits(sb)] : [digits(sb), digits(sa)];
  if (longS.length === shortS.length + 1) {
    for (let i = 0; i < longS.length; i += 1) {
      if (longS.slice(0, i) + longS.slice(i + 1) === shortS) return 'a digit too many';
    }
  }
  return null;
};

// What the gap MEANS, which is not the same as which number is bigger. On total
// out, Cargo being higher means Cargo holds a charge the bank never made. On the
// closing balance it's the reverse: Cargo higher means more money left, which
// means LESS spend recorded — a line missing. Reading both off `ours > theirs`
// gave the closing-balance case exactly the wrong advice.
export const differenceMeaning = (key, ours, theirs) => {
  if (key === 'opening') return 'opening';
  const cargoHigher = Number(ours) > Number(theirs);
  if (key === 'closing') return cargoHigher ? 'missingOut' : 'extraOut';
  if (key === 'moneyIn') return cargoHigher ? 'extraIn' : 'missingIn';
  return cargoHigher ? 'extraOut' : 'missingOut';   // moneyOut
};

const SAY = {
  extraOut: (gap) => `Cargo has ${gap} of spending the statement doesn’t. Check for a line the bank never charged — then re-check the figure you typed.`,
  missingOut: (gap) => `Cargo is missing ${gap} of spending the statement has. Check for a line that never made it in — then re-check the figure you typed.`,
  extraIn: (gap) => `Cargo has ${gap} of money in the statement doesn’t. Check for a payment that never actually arrived — then re-check the figure you typed.`,
  missingIn: (gap) => `Cargo is missing ${gap} of money in the statement has. Check for a payment in that was never recorded — then re-check the figure you typed.`,
  opening: (gap) => `The opening balance is ${gap} out. That figure is last month’s closing balance — check that month before this one.`,
};

export const differenceLead = (candidates = [], { key = 'moneyOut', ours, theirs, amountText = '' } = {}) => {
  if (candidates.length) {
    return candidates.length === 1
      ? 'One line would explain it:'
      : `${candidates.length} lines could explain it:`;
  }

  // Check the typing first. Hunting for a missing line is a long job, and it's
  // the wrong one when the two figures differ by a single digit.
  const typo = typoKind(ours, theirs);
  if (typo) {
    return `These two figures are ${typo}. Check the one you typed against the statement before looking for a missing line.`;
  }

  const gap = amountText || 'the difference';
  return SAY[differenceMeaning(key, ours, theirs)](gap);
};

