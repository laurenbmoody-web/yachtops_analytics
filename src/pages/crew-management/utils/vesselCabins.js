// vesselCabins — data access for the Crew Movements board.
//
//   Cabins + beds are the vessel's fixed sleeping layout (Configure cabins).
//   Assignments berth a crew member in a bed for a date range; end_date is the
//   first FREE day (departure/move), null = open-ended. One crew member can hold
//   several consecutive assignments as they move cabins over a tour.

import { supabase } from '../../../lib/supabaseClient';

// ── read ─────────────────────────────────────────────────────────────────────
export async function fetchCabins(tenantId) {
  if (!tenantId) return [];
  const [{ data: cabs }, { data: beds }] = await Promise.all([
    supabase.from('vessel_cabins').select('*').eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
    supabase.from('cabin_beds').select('*').eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
  ]);
  const byCabin = {};
  (beds || []).forEach((b) => { (byCabin[b.cabin_id] = byCabin[b.cabin_id] || []).push(b); });
  return (cabs || []).map((c) => ({ ...c, beds: byCabin[c.id] || [] }));
}

export async function fetchAssignments(tenantId) {
  if (!tenantId) return [];
  const { data } = await supabase.from('cabin_assignments').select('*').eq('tenant_id', tenantId);
  return data || [];
}

// The crew member's CURRENT cabin from the Movements board — the active
// assignment (start on/before today, open-ended or ending after today),
// resolved bed → cabin. Returns { cabin, deck, bed } or null. This is the single
// source of truth for "which cabin" — wardrobe/issued-kit read it, not the old
// free-text crew_employment.cabin.
export async function fetchCabinForUser(tenantId, userId, onDate = null) {
  if (!tenantId || !userId) return null;
  const day = onDate || new Date().toISOString().slice(0, 10);
  const { data: assigns } = await supabase
    .from('cabin_assignments').select('bed_id, start_date, end_date')
    .eq('tenant_id', tenantId).eq('user_id', userId);
  if (!assigns?.length) return null;
  const active = assigns
    .filter((a) => (a.start_date || '') <= day && (!a.end_date || a.end_date > day))
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))[0];
  if (!active?.bed_id) return null;
  const { data: bed } = await supabase.from('cabin_beds').select('cabin_id, label').eq('id', active.bed_id).maybeSingle();
  if (!bed?.cabin_id) return null;
  const { data: cabin } = await supabase.from('vessel_cabins').select('name, deck').eq('id', bed.cabin_id).maybeSingle();
  if (!cabin) return null;
  return { cabin: cabin.name, deck: cabin.deck || null, bed: bed.label || null };
}

// ── cabin/bed setup — reconcile the desired state against what's stored ───────
// `cabins` is the editor's working array: each cabin { id?, name, deck, linen, beds:[{id?,label}] }.
// New rows have no id; removed rows are simply absent. Returns nothing (throws on error).
export async function saveCabins(tenantId, cabins, userId) {
  if (!tenantId) throw new Error('No vessel selected.');
  const existing = await fetchCabins(tenantId);
  const keptCabinIds = new Set(cabins.filter((c) => c.id).map((c) => c.id));

  // Deleted cabins (cascade removes their beds + assignments).
  const delCab = existing.filter((c) => !keptCabinIds.has(c.id)).map((c) => c.id);
  if (delCab.length) {
    const { error } = await supabase.from('vessel_cabins').delete().in('id', delCab);
    if (error) throw error;
  }

  for (let i = 0; i < cabins.length; i += 1) {
    const c = cabins[i];
    const linen = c.linen && c.linen !== '—' ? c.linen : null;
    const payload = { tenant_id: tenantId, name: (c.name || 'Cabin').trim(), deck: c.deck || null, linen_day: linen, sort_order: i, updated_at: new Date().toISOString() };
    let cabinId = c.id;
    if (cabinId) {
      const { error } = await supabase.from('vessel_cabins').update(payload).eq('id', cabinId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('vessel_cabins').insert({ ...payload, created_by: userId }).select('id').single();
      if (error) throw error;
      cabinId = data?.id;
    }

    // Beds for this cabin.
    const desiredBeds = c.beds || [];
    const existBeds = existing.find((e) => e.id === cabinId)?.beds || [];
    const keptBedIds = new Set(desiredBeds.filter((b) => b.id).map((b) => b.id));
    const delBeds = existBeds.filter((b) => !keptBedIds.has(b.id)).map((b) => b.id);
    if (delBeds.length) {
      const { error } = await supabase.from('cabin_beds').delete().in('id', delBeds);
      if (error) throw error;
    }
    for (let j = 0; j < desiredBeds.length; j += 1) {
      const b = desiredBeds[j];
      const bp = { cabin_id: cabinId, tenant_id: tenantId, label: (b.label || 'Bed').trim(), sort_order: j };
      if (b.id) {
        const { error } = await supabase.from('cabin_beds').update(bp).eq('id', b.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cabin_beds').insert(bp);
        if (error) throw error;
      }
    }
  }
}

// ── assignment writes ─────────────────────────────────────────────────────────
export async function createAssignment({ tenantId, bedId, userId, startDate, endDate = null, createdBy = null }) {
  const { data, error } = await supabase.from('cabin_assignments')
    .insert({ tenant_id: tenantId, bed_id: bedId, user_id: userId, start_date: startDate, end_date: endDate, created_by: createdBy })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateAssignment(id, patch) {
  const { error } = await supabase.from('cabin_assignments')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteAssignment(id) {
  const { error } = await supabase.from('cabin_assignments').delete().eq('id', id);
  if (error) throw error;
}
