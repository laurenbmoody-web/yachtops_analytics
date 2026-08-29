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
export async function fetchContractorsOnBoard(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.select('id, name, company, phone, signed_in_at')
    ?.eq('tenant_id', tenantId)
    ?.eq('status', 'onboard')
    ?.order('signed_in_at', { ascending: true });
  if (error) { console.error('[pob] contractors fetch failed', error); return []; }
  return data || [];
}

export async function addContractor(tenantId, name, company, phone, createdBy) {
  if (!tenantId || !name?.trim()) throw new Error('Name is required');
  const { data, error } = await supabase
    ?.from('contractor_visits')
    ?.insert({
      tenant_id: tenantId,
      name: name.trim(),
      company: company?.trim() || null,
      phone: phone?.trim() || null,
      status: 'onboard',
      signed_in_at: new Date().toISOString(),
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
