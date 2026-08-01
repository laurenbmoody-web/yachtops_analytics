// Cargo Accounts — choosing WHICH account a line was paid from.
//
// A vessel's accounts are not distinguishable by name. A typical set is three
// "Owner card"s, three "Charter APA card"s and two "Petty cash" floats — one per
// department head. Printing `name (currency)` therefore renders the same string
// several times over and the crew are asked to pick blind.
//
// What actually tells them apart is the holder and the last four digits, so that
// is what the label carries. And because the crew reconcile their OWN cards, the
// ones they hold come first — everyone else's stay reachable (someone does
// occasionally borrow a card) but out of the way.

const clean = (v) => String(v ?? '').trim();

// Accounts nobody personally holds: the operating account, the APA holding
// account — vessel-level money rather than a card in someone's pocket.
export const isVesselAccount = (a) => {
  const role = clean(a?.holder_role).toLowerCase();
  return !a?.holder_user_id && (!role || role === 'vessel' || role === 'yacht');
};

// Whose card is it? holder_user_id is the real link; holder_role is the fallback
// for accounts set up before anyone was invited (which is most of them).
export const isHeldBy = (a, { userId, roleName } = {}) => {
  if (!a) return false;
  if (a.holder_user_id) return Boolean(userId) && a.holder_user_id === userId;
  const role = clean(a.holder_role).toLowerCase();
  if (!role || role === 'vessel' || role === 'yacht') return false;
  return Boolean(roleName) && role === clean(roleName).toLowerCase();
};

// Which accounts belong in the Spending page's wallet.
//
// This is a vessel-wide page, and a vessel's twelve accounts are mostly cards in
// individual crew members' pockets — those are reconciled on their own page, not
// here. So the wallet is the vessel's own money, plus any card that actually
// moved money in the month being looked at, because that spend has to be
// reconciled somewhere and this is where it landed.
//
// A card with no spend this month is still included when it's a vessel account:
// a quiet month is a claim to confirm against the statement, not a card to hide.
// Retired accounts drop out unless they carry spend in the month.
export const walletAccounts = (accounts = [], hasActivity = () => false) =>
  accounts.filter((a) => {
    const active = a?.is_active !== false;
    const moved = Boolean(hasActivity(a));
    if (!active) return moved;
    return isVesselAccount(a) || moved;
  });

// "Owner card · Chief Stewardess ••6614" — the three facts that separate one row
// from the next. Currency is appended only where it isn't already obvious.
export const accountLabel = (a, { withCurrency = true } = {}) => {
  if (!a) return '';
  const holder = isVesselAccount(a) ? '' : clean(a.holder_role);
  const last4 = clean(a.card_last4);
  // 0000 is the sandbox feed's placeholder — it distinguishes nothing.
  // The holder and their card's digits read as one fact, so they stay together.
  const who = [holder, last4 && last4 !== '0000' ? `••${last4}` : ''].filter(Boolean).join(' ');
  const label = [clean(a.name) || 'Account', who].filter(Boolean).join(' · ');
  return withCurrency && a.currency ? `${label} (${a.currency})` : label;
};

export const GROUPS = [
  { key: 'mine', label: 'Your cards' },
  { key: 'vessel', label: 'Vessel accounts' },
  { key: 'others', label: 'Held by other crew' },
];

// Split the list three ways, in the order the crew think about it. Empty groups
// are dropped so the picker never shows a heading with nothing under it.
export const groupAccounts = (accounts = [], { userId, roleName } = {}) => {
  const live = accounts.filter((a) => a && a.is_active !== false);
  const bucket = { mine: [], vessel: [], others: [] };
  for (const a of live) {
    if (isHeldBy(a, { userId, roleName })) bucket.mine.push(a);
    else if (isVesselAccount(a)) bucket.vessel.push(a);
    else bucket.others.push(a);
  }
  const byName = (x, y) => accountLabel(x).localeCompare(accountLabel(y));
  return GROUPS
    .map((g) => ({ ...g, accounts: bucket[g.key].sort(byName) }))
    .filter((g) => g.accounts.length);
};

// Stripe tells us the last four digits of the card that was actually charged, and
// financial_accounts records the same four for each vessel card — so a card
// payment can name its own account with no one being asked.
//
// Matched ONLY when exactly one active account carries those digits. Two cards
// ending 4471 is rare but possible, and posting spend to the wrong one is worse
// than leaving the line for someone to assign. '0000' never matches: it is the
// sandbox feed's filler, not a real card.
export const matchAccountByLast4 = (accounts = [], last4) => {
  const digits = clean(last4);
  if (!/^\d{4}$/.test(digits) || digits === '0000') return null;
  const hits = accounts.filter((a) => a?.is_active !== false && clean(a?.card_last4) === digits);
  return hits.length === 1 ? hits[0] : null;
};

// Preselect only when there is genuinely one answer: a single account of yours in
// the line's own currency. Guessing between two of your cards would be worse than
// asking — a wrong account misstates two balances, not one.
export const defaultAccountId = (accounts = [], { userId, roleName, currency } = {}) => {
  const mine = accounts.filter((a) => a?.is_active !== false && isHeldBy(a, { userId, roleName }));
  const matching = currency ? mine.filter((a) => a.currency === currency) : mine;
  return matching.length === 1 ? matching[0].id : '';
};
