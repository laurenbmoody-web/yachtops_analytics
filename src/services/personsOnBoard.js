// Persons on board — guests (on-trip) and contractors, the two non-crew legs of
// the sign-in board. Crew live in crewPresence.js. Guests reuse the existing
// guests.current_state / ashore_context model (managed elsewhere from Pantry),
// so the board writes the same fields and appends to the same history log.
import { supabase } from '../lib/supabaseClient';
import { appendGuestHistory } from '../utils/guestHistoryLog';

const guestName = (g) => [g.first_name, g.last_name].filter(Boolean).join(' ').trim() || 'Guest';

// ── Guests ────────────────────────────────────────────────────────────────
// Active-on-trip guests + whether they're currently on board (any state that
// isn't 'ashore').
export async function fetchGuestsOnBoard(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('guests')
    ?.select('id, first_name, last_name, current_state, ashore_context, cabin_allocated')
    ?.eq('tenant_id', tenantId)
    ?.eq('is_deleted', false)
    ?.eq('is_active_on_trip', true)
    ?.order('last_name');
  if (error) { console.error('[pob] guests fetch failed', error); return []; }
  return (data || []).map((g) => ({
    id: g.id,
    name: guestName(g),
    onboard: (g.current_state ?? 'awake') !== 'ashore',
    returningAt: g.ashore_context?.returning_at || null,
    cabin: g.cabin_allocated || null,
  }));
}

// Toggle a guest on board / ashore — mirrors the Pantry write (current_state +
// ashore_context + history_log) so the two stay in sync. Going ashore keeps any
// existing ashore context (destination / back-by set in Pantry); coming aboard
// clears it.
export async function setGuestOnBoard(guestId, onboard, actorUserId) {
  if (!guestId) return;
  const nextState = onboard ? 'awake' : 'ashore';
  const { data: cur, error } = await supabase
    ?.from('guests')?.select('current_state, ashore_context')?.eq('id', guestId)?.single();
  if (error) throw error;
  const prevState = cur?.current_state ?? 'awake';
  const prevAshore = cur?.ashore_context ?? null;
  const nextAshore = onboard ? null : prevAshore;
  const changes = { current_state: { from: prevState, to: nextState } };
  if (JSON.stringify(prevAshore) !== JSON.stringify(nextAshore)) {
    changes.ashore_context = { from: prevAshore, to: nextAshore };
  }
  await appendGuestHistory(supabase, {
    guestId,
    action: 'state_changed',
    actorUserId: actorUserId ?? null,
    changes,
    columnUpdates: { current_state: nextState, ashore_context: nextAshore, updated_at: new Date().toISOString() },
  });
}

// ── Contractors ─────────────────────────────────────────────────────────────
// Currently-aboard contractors (signed in, not yet out).
// Visitors currently present — on board OR temporarily stepped out (e.g. lunch).
// `state` distinguishes the two; a permanent sign-off sets status 'ashore' and
// drops off the board.
export async function fetchContractorsOnBoard(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.select('id, name, company, phone, reason, signed_in_at, status')
    ?.eq('tenant_id', tenantId)
    ?.in('status', ['onboard', 'stepped_out'])
    ?.order('signed_in_at', { ascending: true });
  if (error) { console.error('[pob] contractors fetch failed', error); return []; }
  return (data || []).map((k) => ({ ...k, state: k.status || 'onboard' }));
}

// ── Expected visitors (pre-registered for planned work) ─────────────────────
export async function fetchExpectedVisitors(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.select('id, name, company, phone, reason, created_at')
    ?.eq('tenant_id', tenantId)?.eq('status', 'expected')?.order('created_at', { ascending: true });
  if (error) { console.error('[pob] expected fetch failed', error); return []; }
  return data || [];
}

export async function addExpectedVisitor(tenantId, { name, company, phone, reason }, createdBy) {
  if (!tenantId || !name?.trim()) throw new Error('Name is required');
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.insert({
      tenant_id: tenantId, name: name.trim(), company: company?.trim() || null, phone: phone?.trim() || null,
      reason: reason?.trim() || null, status: 'expected', created_by: createdBy || null,
    })?.select()?.single();
  if (error) throw error;
  return data;
}

// Turn an expected entry into an on-board visit (on arrival), carrying induction.
export async function activateExpected(id, { inducted, reason } = {}) {
  if (!id) return null;
  const now = new Date().toISOString();
  const patch = { status: 'onboard', signed_in_at: now, updated_at: now };
  if (inducted) { patch.inducted = true; patch.inducted_at = now; }
  if (reason != null) patch.reason = reason.trim() || null;
  const { data, error } = await supabase?.from('contractor_visits')?.update(patch)?.eq('id', id)?.select()?.single();
  if (error) throw error;
  return data;
}

// Cancel an expected entry (status 'ashore' drops it off the expected list).
export async function cancelExpected(id) {
  if (!id) return;
  const { error } = await supabase
    ?.from('contractor_visits')?.update({ status: 'ashore', updated_at: new Date().toISOString() })?.eq('id', id);
  if (error) throw error;
}

// Temporarily step a visitor out (keeps the visit open — they can tap back in
// without re-entering anything).
export async function stepOutContractor(id) {
  if (!id) return;
  const { error } = await supabase
    ?.from('contractor_visits')?.update({ status: 'stepped_out', updated_at: new Date().toISOString() })?.eq('id', id);
  if (error) throw error;
}

// Bring a stepped-out visitor back on board.
export async function returnContractor(id) {
  if (!id) return;
  const { error } = await supabase
    ?.from('contractor_visits')?.update({ status: 'onboard', updated_at: new Date().toISOString() })?.eq('id', id);
  if (error) throw error;
}

// Recently-seen visitors who are NOT currently present — for one-tap re-sign-in
// so a returning contractor never re-types their details. De-duplicated by phone
// (falling back to name), keeping each person's most recent visit.
export async function fetchRecentVisitors(tenantId, { limit = 8 } = {}) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.select('name, company, phone, reason, inducted, signed_in_at, status')
    ?.eq('tenant_id', tenantId)
    ?.order('signed_in_at', { ascending: false })
    ?.limit(120);
  if (error) { console.error('[pob] recent visitors fetch failed', error); return []; }
  const present = new Set();
  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    const key = String(r.phone || r.name || '').trim().toLowerCase();
    if (!key) continue;
    if (['onboard', 'stepped_out'].includes(r.status)) { present.add(key); continue; }
    if (seen.has(key) || present.has(key)) continue;
    seen.add(key);
    out.push({ name: r.name, company: r.company || '', phone: r.phone || '', reason: r.reason || '', inducted: !!r.inducted, lastSeen: r.signed_in_at });
    if (out.length >= limit) break;
  }
  return out;
}

export async function addContractor(tenantId, name, company, phone, createdBy, opts = {}) {
  if (!tenantId || !name?.trim()) throw new Error('Name is required');
  const now = new Date().toISOString();
  const inducted = !!opts.inducted;
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.insert({
      tenant_id: tenantId,
      name: name.trim(),
      company: company?.trim() || null,
      phone: phone?.trim() || null,
      reason: opts.reason?.trim() || null,
      inducted,
      inducted_at: inducted ? now : null,
      status: 'onboard',
      signed_in_at: now,
      created_by: createdBy || null,
    })
    ?.select()
    ?.single();
  if (error) throw error;
  return data;
}

// Sign a contractor off the boat (keeps the record + times).
export async function signOutContractor(id) {
  if (!id) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    ?.from('contractor_visits')
    ?.update({ status: 'ashore', signed_out_at: now, updated_at: now })
    ?.eq('id', id);
  if (error) throw error;
}
