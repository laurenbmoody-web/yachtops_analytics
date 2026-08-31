// What a job points at — the stock it uses, the equipment it services.
//
// Reads and writes job_links, and owns the one piece of real consequence in
// this feature: completing a job with a quantified stock link takes that stock
// off the shelf, and reopening the job puts it back.

import { supabase } from '../../../lib/supabaseClient';

export const INVENTORY = 'inventory';
export const EQUIPMENT = 'equipment';

// Why the link exists. 'about' moves nothing; 'uses' consumes stock when the
// job is completed. Default is 'about' — the safe thing to do by accident.
export const ABOUT = 'about';
export const USES = 'uses';

// Verbs that mean the job consumes what it is linked to. Used to preselect the
// purpose when someone links an item, never to decide it: the toggle is right
// there and always wins. "Replace the ashtray" can just as easily mean swap it
// for a clean one, so a guess must be visible and one click to undo, not a
// silent deduction from real stock.
const CONSUMING_VERBS = [
  'replace', 'replacing', 'refill', 'refilling', 'top up', 'topping up',
  'renew', 'renewing', 'change', 'changing', 'restock', 'restocking',
  'fit ', 'fitting', 'install', 'installing', 'swap', 'swapping',
  'new filter', 'new filters', 'use up',
];

/** Does this job title read as consuming something? */
export const suggestsConsumption = (title) => {
  const t = String(title || '')?.toLowerCase();
  if (!t) return false;
  return CONSUMING_VERBS?.some(v => t?.includes(v));
};

const jobIdOf = (job) => job?.supabase_id || job?.id || null;

// A size-tracked item keeps per-size quantities inside stock_locations[].sizes.
// A flat deduction would desync that breakdown, so — exactly as provisioning
// does when receiving — we refuse it rather than corrupt the item.
export const isVariantItem = (item) =>
  !!item?.has_variants || (Array.isArray(item?.variants) && item?.variants?.length > 0);

const normalizeLocations = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    ?.map(l => (typeof l === 'string'
      ? { locationName: l, qty: 0 }
      : { ...l, qty: Number(l?.qty) || 0 }))
    ?.filter(Boolean);
};

/**
 * Move `delta` on an item's stock and say exactly where it moved.
 *
 * stock_locations is authoritative when the item has any, and total_qty is its
 * sum — writing one without the other is what desyncs an item, so both go
 * together here, alongside the legacy `quantity` mirror the rest of inventory
 * still reads.
 *
 * Consuming draws from the fullest location first, so the shelf that can cover
 * it does rather than scattering a deduction across the vessel, and it reports
 * the per-location breakdown it used. Restoring takes that same breakdown back
 * so the stock returns to the shelf it left, not wherever happens to be first.
 *
 * Stock never goes negative: a job that uses more than the shelf holds empties
 * the shelf and reports the shortfall rather than recording a negative count
 * nobody can act on.
 *
 * @param delta negative to consume, positive to put back
 * @param into  for a restore, the breakdown recorded when it was consumed
 * @returns { applied, shortfall, stock_locations, total, breakdown }
 */
export const applyStockDelta = (item, delta, into = null) => {
  const locations = normalizeLocations(item?.stock_locations);
  const currentTotal = locations?.length > 0
    ? locations?.reduce((s, l) => s + (l?.qty || 0), 0)
    : (Number(item?.total_qty ?? item?.quantity) || 0);

  if (delta >= 0) {
    if (locations?.length === 0) {
      return {
        applied: delta, shortfall: 0, stock_locations: locations,
        total: currentTotal + delta, breakdown: null,
      };
    }

    // Put each amount back where it came from. A location that has since been
    // renamed or removed falls through to the first one rather than vanishing.
    const plan = Array.isArray(into) && into?.length > 0
      ? into
      : [{ locationName: locations?.[0]?.locationName, qty: delta }];
    const next = [...locations];
    let unplaced = 0;
    plan?.forEach(entry => {
      const qty = Number(entry?.qty) || 0;
      if (qty <= 0) return;
      const idx = next?.findIndex(l => l?.locationName === entry?.locationName);
      if (idx >= 0) next[idx] = { ...next[idx], qty: (next[idx]?.qty || 0) + qty };
      else unplaced += qty;
    });
    if (unplaced > 0) next[0] = { ...next[0], qty: (next[0]?.qty || 0) + unplaced };

    const moved = plan?.reduce((s, e) => s + (Number(e?.qty) || 0), 0) || delta;
    return {
      applied: moved, shortfall: 0, stock_locations: next,
      total: currentTotal + moved, breakdown: null,
    };
  }

  const wanted = Math.abs(delta);
  const applied = Math.min(wanted, currentTotal);
  const shortfall = wanted - applied;

  if (locations?.length === 0) {
    return {
      applied: -applied, shortfall, stock_locations: locations,
      total: currentTotal - applied, breakdown: null,
    };
  }

  let left = applied;
  const order = [...locations]
    ?.map((l, i) => ({ l, i }))
    ?.sort((a, b) => (b?.l?.qty || 0) - (a?.l?.qty || 0));
  const next = [...locations];
  const breakdown = [];
  for (const { l, i } of order) {
    if (left <= 0) break;
    const take = Math.min(left, l?.qty || 0);
    if (take <= 0) continue;
    next[i] = { ...l, qty: (l?.qty || 0) - take };
    breakdown?.push({ locationName: l?.locationName, qty: take });
    left -= take;
  }

  return { applied: -applied, shortfall, stock_locations: next, total: currentTotal - applied, breakdown };
};

/** Add one per-location breakdown to another, summing by location. */
const mergeBreakdown = (a, b) => {
  if (!Array.isArray(a) || a?.length === 0) return Array.isArray(b) ? b : null;
  if (!Array.isArray(b) || b?.length === 0) return a;
  const out = a?.map(e => ({ ...e }));
  b?.forEach(e => {
    const i = out?.findIndex(x => x?.locationName === e?.locationName);
    if (i >= 0) out[i].qty = (Number(out[i]?.qty) || 0) + (Number(e?.qty) || 0);
    else out?.push({ ...e });
  });
  return out;
};

/**
 * Pull `amount` back out of a recorded breakdown.
 *
 * @returns { plan, rest } — plan is where that amount came from, so it goes
 *          back to the same shelves; rest is what stays consumed.
 */
const takeFromBreakdown = (bd, amount) => {
  if (!Array.isArray(bd) || bd?.length === 0) return { plan: null, rest: null };
  let left = amount;
  const plan = [];
  const rest = [];
  bd?.forEach(e => {
    const have = Number(e?.qty) || 0;
    const take = Math.min(left, have);
    if (take > 0) { plan?.push({ locationName: e?.locationName, qty: take }); left -= take; }
    const keep = have - take;
    if (keep > 0) rest?.push({ locationName: e?.locationName, qty: keep });
  });
  return { plan: plan?.length ? plan : null, rest: rest?.length ? rest : null };
};

/** Every link on a job, with enough of the target to render it. */
export const loadJobLinks = async ({ job, tenantId }) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId) return [];

  const { data, error } = await supabase
    ?.from('job_links')
    ?.select(`
      id, kind, purpose, qty, note, consumed_at, consumed_from, inventory_item_id, equipment_id, created_at,
      inventory_items ( id, name, unit, total_qty, quantity, location, sub_location, has_variants, variants, stock_locations ),
      equipment ( id, name, code, manufacturer, model, location_label )
    `)
    ?.eq('job_id', jobId)
    ?.eq('tenant_id', tenantId)
    ?.order('created_at', { ascending: true });
  if (error) throw error;

  return (data || [])?.map(r => ({
    id: r?.id,
    kind: r?.kind,
    purpose: r?.purpose || ABOUT,
    qty: r?.qty === null || r?.qty === undefined ? null : Number(r?.qty),
    note: r?.note || '',
    consumedAt: r?.consumed_at || null,
    consumedFrom: r?.consumed_from || null,
    item: r?.inventory_items || null,
    equipment: r?.equipment || null,
    name: r?.inventory_items?.name || r?.equipment?.name || 'Unknown',
  }));
};

export const addJobLink = async ({
  job, tenantId, kind, targetId, purpose = ABOUT, qty = null, userId = null,
}) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId || !targetId) return null;

  const { data, error } = await supabase
    ?.from('job_links')
    ?.insert({
      tenant_id: tenantId,
      job_id: jobId,
      kind,
      inventory_item_id: kind === INVENTORY ? targetId : null,
      equipment_id: kind === EQUIPMENT ? targetId : null,
      purpose: kind === INVENTORY ? purpose : ABOUT,
      qty: kind === INVENTORY && purpose === USES && qty ? qty : null,
      created_by: userId,
    })
    ?.select('id')
    ?.single();
  if (error) throw error;
  return data?.id || null;
};

export const setJobLinkQty = async ({ linkId, qty }) => {
  const { error } = await supabase
    ?.from('job_links')
    ?.update({ qty: qty || null, updated_at: new Date()?.toISOString() })
    ?.eq('id', linkId);
  if (error) throw error;
};

/**
 * Switch a link between "the job is about this" and "the job uses this up".
 *
 * Dropping back to a reference clears the quantity: a number left behind on a
 * link that no longer consumes anything is the ambiguity this field exists to
 * remove.
 */
export const setJobLinkPurpose = async ({ linkId, purpose, qty = null }) => {
  const { error } = await supabase
    ?.from('job_links')
    ?.update({
      purpose,
      qty: purpose === USES ? (qty || null) : null,
      updated_at: new Date()?.toISOString(),
    })
    ?.eq('id', linkId);
  if (error) throw error;
};

export const removeJobLink = async ({ linkId }) => {
  const { error } = await supabase?.from('job_links')?.delete()?.eq('id', linkId);
  if (error) throw error;
};

/**
 * Move stock for one link and record it.
 *
 * @param sign -1 to consume on completion, +1 to put back on reopen
 * @returns { name, moved, shortfall, refused } for the caller to report
 */
const moveStockForLink = async ({ link, tenantId, userId, sign }) => {
  const item = link?.item;
  if (!item || !link?.qty) return null;

  if (isVariantItem(item)) {
    return { name: item?.name, moved: 0, shortfall: 0, refused: 'size-tracked' };
  }

  const { applied, shortfall, stock_locations, total, breakdown } =
    applyStockDelta(item, sign * Number(link?.qty), sign > 0 ? link?.consumedFrom : null);
  if (applied === 0 && shortfall === 0) return null;

  const { error: itemErr } = await supabase
    ?.from('inventory_items')
    ?.update({
      stock_locations,
      quantity: total,
      total_qty: total,
      updated_at: new Date()?.toISOString(),
    })
    ?.eq('id', item?.id)
    ?.eq('tenant_id', tenantId);
  if (itemErr) throw itemErr;

  // The movements ledger is best-effort, the same way provisioning treats it:
  // a ledger failure must never leave the stock write half-done.
  try {
    await supabase?.from('inventory_movements')?.insert({
      tenant_id: tenantId,
      inventory_item_id: item?.id,
      qty_delta: applied,
      reason: sign < 0 ? 'job' : 'job_reopened',
      notes: sign < 0 ? 'Used on a job' : 'Returned when the job was reopened',
      created_by: userId || null,
    });
  } catch (err) {
    console.warn('[jobLinks] movement ledger write failed (non-blocking):', err);
  }

  await supabase
    ?.from('job_links')
    ?.update({
      consumed_at: sign < 0 ? new Date()?.toISOString() : null,
      consumed_by: sign < 0 ? (userId || null) : null,
      // Recorded on the way out so the way back in is exact.
      consumed_from: sign < 0 ? (breakdown || null) : null,
      updated_at: new Date()?.toISOString(),
    })
    ?.eq('id', link?.id);

  return { name: item?.name, moved: Math.abs(applied), shortfall, refused: null };
};

/**
 * Completing a job takes the parts it used off the shelf.
 *
 * Only links explicitly marked as using the item move. A link that is merely
 * about the item — the ashtrays a cleaning round polishes — is left alone no
 * matter what is in its quantity field.
 *
 * consumed_at makes this exactly-once —
 * so a double click, or completing a job that was completed and reopened and
 * completed again, deducts one time each.
 */
export const consumeJobLinks = async ({ job, tenantId, userId }) => {
  const links = await loadJobLinks({ job, tenantId });
  const pending = links?.filter(
    l => l?.kind === INVENTORY && l?.purpose === USES && l?.qty > 0 && !l?.consumedAt);
  const results = [];
  for (const link of pending) {
    try {
      const r = await moveStockForLink({ link, tenantId, userId, sign: -1 });
      if (r) results?.push(r);
    } catch (err) {
      console.warn('[jobLinks] could not consume stock for link', link?.id, err);
    }
  }
  return results;
};

/** Reopening a job puts back exactly what completing it took. */
export const restoreJobLinks = async ({ job, tenantId, userId }) => {
  const links = await loadJobLinks({ job, tenantId });
  const consumed = links?.filter(l => l?.kind === INVENTORY && l?.qty > 0 && l?.consumedAt);
  const results = [];
  for (const link of consumed) {
    try {
      const r = await moveStockForLink({ link, tenantId, userId, sign: 1 });
      if (r) results?.push(r);
    } catch (err) {
      console.warn('[jobLinks] could not restore stock for link', link?.id, err);
    }
  }
  return results;
};

/** Inventory items and equipment matching a search, for the link picker. */
export const searchLinkTargets = async ({ tenantId, query, limit = 20 }) => {
  if (!tenantId) return { items: [], equipment: [] };
  const q = String(query || '')?.trim();
  const like = `%${q}%`;

  let itemQuery = supabase
    ?.from('inventory_items')
    ?.select('id, name, unit, total_qty, quantity, location, sub_location, has_variants')
    ?.eq('tenant_id', tenantId)
    ?.order('name')
    ?.limit(limit);
  if (q) itemQuery = itemQuery?.ilike('name', like);

  let equipQuery = supabase
    ?.from('equipment')
    ?.select('id, name, code, manufacturer, model, location_label')
    ?.eq('tenant_id', tenantId)
    ?.eq('active', true)
    ?.order('name')
    ?.limit(limit);
  if (q) equipQuery = equipQuery?.ilike('name', like);

  const [{ data: items }, { data: equipment }] = await Promise.all([itemQuery, equipQuery]);
  return { items: items || [], equipment: equipment || [] };
};

/**
 * Every job ever linked to one item or machine — the service history.
 *
 * Ordered newest first, and carries the quantity used so the item's page can
 * show what a job actually took, not just that it happened.
 */
export const loadJobHistoryForTarget = async ({ tenantId, kind, targetId, limit = 50 }) => {
  if (!tenantId || !targetId) return [];
  const column = kind === EQUIPMENT ? 'equipment_id' : 'inventory_item_id';

  const { data, error } = await supabase
    ?.from('job_links')
    ?.select(`
      id, qty, consumed_at, created_at,
      team_jobs ( id, title, description, status, due_date, completed_at, completed_by, assigned_to, source )
    `)
    ?.eq('tenant_id', tenantId)
    ?.eq(column, targetId)
    ?.order('created_at', { ascending: false })
    ?.limit(limit);
  if (error) throw error;

  return (data || [])
    ?.filter(r => r?.team_jobs)
    ?.map(r => ({
      linkId: r?.id,
      qty: r?.qty === null || r?.qty === undefined ? null : Number(r?.qty),
      consumedAt: r?.consumed_at || null,
      job: r?.team_jobs,
    }))
    // Completed jobs read newest-first by when they were finished; open ones
    // sort by when they were linked. Both are "most recent first" to a reader.
    ?.sort((a, b) => {
      const at = a?.job?.completed_at || a?.consumedAt || a?.job?.due_date || '';
      const bt = b?.job?.completed_at || b?.consumedAt || b?.job?.due_date || '';
      return String(bt)?.localeCompare(String(at));
    });
};

/**
 * Correct how much a completed job actually used.
 *
 * The verb guess and the quantity someone typed before the round are both
 * estimates; what came off the shelf is only known afterwards. So a consumed
 * link stays editable, and stock follows the correction — take one more, or
 * put one back, against the shelves it originally came from. Setting it to
 * zero returns everything and reopens the quantity, which is the full undo.
 *
 * Only the difference moves, so a correction leaves one honest ledger row
 * rather than a return and a fresh withdrawal that never happened.
 *
 * @returns { name, moved, shortfall, refused, direction } for the caller
 */
export const adjustConsumedQty = async ({ link, tenantId, userId, newQty }) => {
  const item = link?.item;
  if (!item || !link?.consumedAt) return null;

  const current = Number(link?.qty) || 0;
  const next = Math.max(0, Number(newQty) || 0);
  const delta = next - current;
  if (delta === 0) return null;

  if (isVariantItem(item)) {
    return { name: item?.name, moved: 0, shortfall: 0, refused: 'size-tracked' };
  }

  let result;
  let consumedFrom;

  if (delta > 0) {
    // Using more than was booked out: take the extra now.
    result = applyStockDelta(item, -delta);
    consumedFrom = mergeBreakdown(link?.consumedFrom, result?.breakdown);
  } else {
    // Used less: hand the difference back to the shelves it came from.
    const give = Math.abs(delta);
    const { plan, rest } = takeFromBreakdown(link?.consumedFrom, give);
    result = applyStockDelta(item, give, plan);
    consumedFrom = rest;
  }

  const { applied, shortfall, stock_locations, total } = result;

  const { error: itemErr } = await supabase
    ?.from('inventory_items')
    ?.update({
      stock_locations,
      quantity: total,
      total_qty: total,
      updated_at: new Date()?.toISOString(),
    })
    ?.eq('id', item?.id)
    ?.eq('tenant_id', tenantId);
  if (itemErr) throw itemErr;

  try {
    await supabase?.from('inventory_movements')?.insert({
      tenant_id: tenantId,
      inventory_item_id: item?.id,
      qty_delta: applied,
      reason: 'job_adjusted',
      notes: `Corrected from ${current} to ${next} used on a job`,
      created_by: userId || null,
    });
  } catch (err) {
    console.warn('[jobLinks] movement ledger write failed (non-blocking):', err);
  }

  const { error: linkErr } = await supabase
    ?.from('job_links')
    ?.update({
      qty: next > 0 ? next : null,
      // Back to nothing used at all: the link stops being a consumption and
      // its quantity opens up again rather than sitting at a stale zero.
      consumed_at: next > 0 ? link?.consumedAt : null,
      consumed_by: next > 0 ? (userId || link?.consumedBy || null) : null,
      consumed_from: next > 0 ? consumedFrom : null,
      updated_at: new Date()?.toISOString(),
    })
    ?.eq('id', link?.id);
  if (linkErr) throw linkErr;

  return {
    name: item?.name,
    moved: Math.abs(applied),
    shortfall,
    refused: null,
    direction: delta > 0 ? 'out' : 'back',
  };
};
