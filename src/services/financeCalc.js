// Cargo Accounts — Phase 0. Pure balance/formatting math.
//
// Deliberately free of any Supabase / browser imports so it can be unit-tested
// in isolation (node --test) and reused by both the service layer and the pages.
//
// Sign convention (mirrors ledger_transactions): amount > 0 = money IN,
// amount < 0 = money OUT. Voided transactions never affect a balance.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// A transaction counts toward a balance unless it is voided.
export const isLiveTxn = (t) => t && t.status !== 'void';

// A row needs attention when it isn't yet assigned to an account, or is still
// unreconciled (this is the Ledger "Needs attention" queue — it surfaces the
// auto-posted supplier-invoice rows and any cross-currency rows awaiting a rate).
export const isNeedsAttention = (t) => !t?.account_id || t?.status === 'unreconciled';

// Current balance of one account, in the ACCOUNT's own currency:
// opening_balance + Σ amount of its live transactions.
export const computeAccountBalance = (account, transactions) => {
  if (!account) return 0;
  const delta = (transactions || []).reduce((sum, t) => (
    isLiveTxn(t) && t.account_id === account.id ? sum + num(t.amount) : sum
  ), 0);
  return num(account.opening_balance) + delta;
};

// Balance of one account in the tenant REPORTING currency, using amount_base for
// the movements. Phase 0 has no base value for opening_balance, so it is taken at
// face value (correct while fx_rate = 1; refine when a live FX feed lands — Phase 1+).
export const computeAccountBaseBalance = (account, transactions) => {
  if (!account) return 0;
  const delta = (transactions || []).reduce((sum, t) => (
    isLiveTxn(t) && t.account_id === account.id ? sum + num(t.amount_base) : sum
  ), 0);
  return num(account.opening_balance) + delta;
};

// Tenant cash position = Σ base balances across ACTIVE accounts. Unassigned rows
// (account_id NULL — e.g. the auto-posted invoice queue) are intentionally excluded
// until a user assigns them to an account.
export const computeCashPosition = (accounts, transactions) => (
  (accounts || [])
    .filter((a) => a && a.is_active !== false)
    .reduce((sum, a) => sum + computeAccountBaseBalance(a, transactions), 0)
);

// amount_base derivation for a new/edited transaction (rounded to 2dp).
export const deriveAmountBase = (amount, fxRate = 1) => (
  Math.round(num(amount) * num(fxRate) * 100) / 100
);

// Money formatter. Editorial figures render tabular; the sign is explicit when
// requested so ledger columns read +/− at a glance.
export const formatMoney = (amount, currency = 'EUR', { signed = false } = {}) => {
  const n = num(amount);
  let body;
  try {
    body = new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Math.abs(n));
  } catch {
    body = `${currency} ${Math.abs(n).toFixed(2)}`;
  }
  if (signed) return `${n < 0 ? '−' : '+'}${body}`;
  return `${n < 0 ? '−' : ''}${body}`;
};
