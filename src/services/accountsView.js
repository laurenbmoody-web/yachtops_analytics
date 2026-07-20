// Cargo Accounts — pure view helpers for the vessel overview (no Supabase), so
// they are unit-testable. Turn a flat list of accounts-with-balances into the
// holder-grouped shape and the funds KPI totals the overview renders.

const VESSEL = 'Vessel';

// Group active accounts by holder_role, Vessel/Command first, then holders in
// first-seen order. Each group carries its balance total and a rolled-up
// reconcile state ('reconciled' | 'due') from the accounts' unreconciled counts.
export function groupAccountsByHolder(accounts) {
  const active = (accounts || []).filter((a) => a.is_active !== false);
  const order = [];
  const byHolder = new Map();
  active.forEach((a) => {
    const key = a.holder_role || 'Unassigned';
    if (!byHolder.has(key)) { byHolder.set(key, []); order.push(key); }
    byHolder.get(key).push(a);
  });
  // Vessel/Command group sorts to the top.
  order.sort((x, y) => (x === VESSEL ? -1 : y === VESSEL ? 1 : 0));
  return order.map((holder) => {
    const list = byHolder.get(holder);
    const total = list.reduce((s, a) => s + (Number(a.base_balance) || 0), 0);
    const toReconcile = list.filter((a) => (a.unreconciled || 0) > 0).length;
    return { holder, accounts: list, total, toReconcile };
  });
}

// Funds KPI totals across active accounts, in base/reporting currency.
export function fundsTotals(accounts) {
  const active = (accounts || []).filter((a) => a.is_active !== false);
  const sum = (pred) => active.filter(pred).reduce((s, a) => s + (Number(a.base_balance) || 0), 0);
  return {
    owner: sum((a) => a.funds_type === 'owner'),
    charterApa: sum((a) => a.funds_type === 'charter_apa'),
    pettyCash: sum((a) => a.kind === 'petty_cash'),
    ownerCards: active.filter((a) => a.funds_type === 'owner').length,
    apaCards: active.filter((a) => a.funds_type === 'charter_apa').length,
    pettyFloats: active.filter((a) => a.kind === 'petty_cash').length,
    toReconcile: active.filter((a) => (a.unreconciled || 0) > 0).length,
    holders: new Set(active.map((a) => a.holder_role || 'Unassigned')).size,
  };
}
