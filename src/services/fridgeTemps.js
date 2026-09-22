// Fridge/freezer temperature logging — weekly food-safety checks.
// Data lives in `fridges` (the appliance list + safe range) and
// `fridge_temp_logs` (each reading: a typed temp and/or a photo, flagged
// in/out of range). See migration 20260922100000_fridge_temp_logs.sql.
import { supabase } from '../lib/supabaseClient';

// Monday 00:00 (local) of the current week — the weekly cadence boundary.
export function startOfWeek(d = new Date()) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (s.getDay() + 6) % 7; // 0 = Monday
  s.setDate(s.getDate() - dow);
  s.setHours(0, 0, 0, 0);
  return s;
}

// Whether a reading sits inside the fridge's safe range. Returns null when we
// can't tell (no typed temp, or no range configured).
export function computeInRange(tempC, safeMin, safeMax) {
  if (tempC == null || tempC === '') return null;
  const t = Number(tempC);
  if (Number.isNaN(t)) return null;
  const lo = safeMin == null ? -Infinity : Number(safeMin);
  const hi = safeMax == null ? Infinity : Number(safeMax);
  if (lo === -Infinity && hi === Infinity) return null;
  return t >= lo && t <= hi;
}

export async function fetchFridges(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    ?.from('fridges')
    ?.select('id, name, kind, location, code, safe_min, safe_max, sort_order, active')
    ?.eq('tenant_id', tenantId)
    ?.eq('active', true)
    ?.order('sort_order', { ascending: true });
  if (error) { console.error('[fridgeTemps] fetchFridges', error); return []; }
  return data || [];
}

// Fridges + this-week status: whether each has been logged since Monday, and
// the most recent reading either way.
export async function fetchWeekStatus(tenantId) {
  const fridges = await fetchFridges(tenantId);
  if (!fridges.length) return { fridges: [], byFridge: {} };
  const weekStart = startOfWeek().toISOString();
  const ids = fridges.map((f) => f.id);
  const { data: logs, error } = await supabase
    ?.from('fridge_temp_logs')
    ?.select('id, fridge_id, temp_c, photo_url, in_range, logged_at')
    ?.eq('tenant_id', tenantId)
    ?.in('fridge_id', ids)
    ?.order('logged_at', { ascending: false });
  if (error) console.error('[fridgeTemps] fetchWeekStatus', error);
  const byFridge = {};
  fridges.forEach((f) => { byFridge[f.id] = { loggedThisWeek: false, lastLog: null }; });
  (logs || []).forEach((l) => {
    const b = byFridge[l.fridge_id];
    if (!b) return;
    if (!b.lastLog) b.lastLog = l; // newest first, so first seen is latest
    if (l.logged_at >= weekStart) b.loggedThisWeek = true;
  });
  return { fridges, byFridge };
}

// Upload a thermometer photo. Reuses the public `item-images` bucket under a
// fridge-temps/ path (same pattern as inventory photos).
export async function uploadFridgePhoto(file, tenantId) {
  if (!file) return '';
  const ext = (file.type?.split('/')?.[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `fridge-temps/${tenantId || 'shared'}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('item-images').upload(path, file, {
    upsert: true, contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('item-images').getPublicUrl(path);
  return pub?.publicUrl || '';
}

export async function logReading(tenantId, fridge, { tempC, photoUrl, note, loggedBy }) {
  if (!tenantId || !fridge?.id) throw new Error('Missing fridge');
  const temp = tempC === '' || tempC == null ? null : Number(tempC);
  if (temp == null && !photoUrl) throw new Error('Enter a temperature or add a photo');
  const in_range = computeInRange(temp, fridge.safe_min, fridge.safe_max);
  const { data, error } = await supabase
    ?.from('fridge_temp_logs')
    ?.insert({
      tenant_id: tenantId,
      fridge_id: fridge.id,
      temp_c: temp,
      photo_url: photoUrl || null,
      in_range,
      note: note?.trim() || null,
      logged_by: loggedBy || null,
      logged_at: new Date().toISOString(),
    })
    ?.select()
    ?.single();
  if (error) throw error;
  return data;
}

// History across all fridges, newest first, with fridge name + logger name.
export async function fetchHistory(tenantId, { fridgeId = null, limit = 300 } = {}) {
  if (!tenantId) return [];
  let q = supabase
    ?.from('fridge_temp_logs')
    ?.select('id, fridge_id, temp_c, photo_url, in_range, note, logged_by, logged_at, fridges(name, kind, safe_min, safe_max)')
    ?.eq('tenant_id', tenantId)
    ?.order('logged_at', { ascending: false })
    ?.limit(limit);
  if (fridgeId) q = q?.eq('fridge_id', fridgeId);
  const { data, error } = await q;
  if (error) { console.error('[fridgeTemps] fetchHistory', error); return []; }
  const rows = data || [];
  // Resolve logger names in one round-trip.
  const uids = [...new Set(rows.map((r) => r.logged_by).filter(Boolean))];
  let names = {};
  if (uids.length) {
    const { data: profs } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', uids);
    (profs || []).forEach((p) => { names[p.id] = p.full_name; });
  }
  return rows.map((r) => ({
    ...r,
    fridgeName: r.fridges?.name || '—',
    fridgeKind: r.fridges?.kind || 'fridge',
    safeMin: r.fridges?.safe_min,
    safeMax: r.fridges?.safe_max,
    loggedByName: names[r.logged_by] || null,
  }));
}

// ── Manage (COMMAND / CHIEF) ────────────────────────────────────────────────
export async function addFridge(tenantId, { name, kind = 'fridge', safeMin, safeMax, sortOrder = 99 }) {
  const code = `FRG${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await supabase
    ?.from('fridges')
    ?.insert({
      tenant_id: tenantId, name: name?.trim() || 'Fridge', kind,
      safe_min: safeMin ?? null, safe_max: safeMax ?? null, sort_order: sortOrder, code,
    })
    ?.select()?.single();
  if (error) throw error;
  return data;
}

export async function updateFridge(id, patch) {
  const { error } = await supabase
    ?.from('fridges')
    ?.update({
      name: patch.name?.trim(),
      kind: patch.kind,
      safe_min: patch.safeMin ?? null,
      safe_max: patch.safeMax ?? null,
      updated_at: new Date().toISOString(),
    })
    ?.eq('id', id);
  if (error) throw error;
}

// Soft-remove (keeps the log history intact via the FK).
export async function deactivateFridge(id) {
  const { error } = await supabase?.from('fridges')?.update({ active: false })?.eq('id', id);
  if (error) throw error;
}
