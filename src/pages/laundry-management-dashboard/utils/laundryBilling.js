// Charter laundry billing helpers.
//
// Rules from the agreements:
//  • MYBA (basis 'plus_expenses'): guests' personal laundry is billable at cost.
//  • CYBA (basis 'inclusive'): nothing billed.
//  • Crew and ship's-linen/"Other" items are never charged.
// The vessel config decides scope (shoreside-only vs all guest items), the
// onboard pricing method, and currency.

export const CUR_SYM = { EUR: '€', GBP: '£', USD: '$' };
export const money = (n, cur) => `${CUR_SYM[cur] || ''}${(Number(n) || 0).toFixed(2)}`;

const isGuest = (t) => (t || '').toLowerCase() === 'guest';

// Is this item billable given the charter basis + vessel config?
export function isBillable(item, basis, config) {
  if (basis !== 'plus_expenses') return false;
  if (!isGuest(item?.ownerType)) return false;
  if ((config?.scope || 'shoreside') === 'shoreside') return item?.serviceLocation === 'shore';
  return true; // 'all' guest items
}

// Config-suggested charge for an item (before any manual override).
export function suggestCharge(item, config) {
  if (!config) return 0;
  if (config.pricing === 'flat') return Number(config.flatRate) || 0;
  if (config.pricing === 'pricelist') {
    const hay = `${item?.description || ''} ${(item?.tags || []).join(' ')}`.toLowerCase();
    const hit = (config.priceList || []).find((r) => r.label && hay.includes(String(r.label).toLowerCase()));
    return hit ? Number(hit.price) || 0 : 0;
  }
  return 0; // 'manual' or a shore item → entered per item
}

// The charge actually applied: an explicit per-item value wins, else the
// config suggestion.
export function effectiveCharge(item, config) {
  if (item?.charge != null && item?.charge !== '') return Number(item.charge) || 0;
  return suggestCharge(item, config);
}

// Roll up the billable guest items for a period into line items + total.
export function billingSummary(items, basis, config) {
  const lines = (items || [])
    .filter((it) => isBillable(it, basis, config))
    .map((it) => ({ item: it, charge: effectiveCharge(it, config) }));
  const total = lines.reduce((s, l) => s + l.charge, 0);
  return { lines, total, currency: config?.currency || 'EUR' };
}
