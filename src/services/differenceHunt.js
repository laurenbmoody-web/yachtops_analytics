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
export const differenceLead = (candidates = [], cargoHasMore = true) => {
  if (candidates.length) {
    return candidates.length === 1
      ? 'One line would explain it:'
      : `${candidates.length} lines could explain it:`;
  }
  return cargoHasMore
    ? 'Nothing in this month matches the difference on its own. Check for a line the bank hasn’t posted, or two smaller ones together.'
    : 'The bank has spend Cargo doesn’t. Check for a line that was never imported, or one filed to another card.';
};
