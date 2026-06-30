// Sea Time Tracker — Supabase data-access layer
// ---------------------------------------------------------------------------
// Replaces the localStorage prototype (seaTimeStorage.js) with the real
// tenant-scoped tables created in 20260617090000_sea_service_foundation.sql.
//
// The qualification RULES still live in seaTimeStorage.js as pure functions
// (classifyServiceType / evaluateEntryQualification / summariseProgress); this
// module only handles IO + the row<->entry mapping, then runs those pure rules
// over the fetched rows. When the rules eventually move server-side, the UI
// keeps calling this module unchanged.

import { supabase } from '../../../lib/supabase';
import {
  getDefaultRulesConfig,
  evaluateEntryQualification,
  summariseProgress,
  SEA_SERVICE_TYPE
} from './seaTimeStorage';

const TABLE = 'sea_service_entries';

// Map the manual modal's free service-type choice onto a vessel_status, so a
// single classifier (vessel_status + watch_hours) works for every entry.
const SERVICE_TYPE_TO_STATUS = {
  'Underway': 'UNDERWAY',
  'Standby': 'ANCHOR',
  'In port': 'IN_PORT',
  'Yard period': 'IN_YARD'
};

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * Resolve the active rules config for a vessel: the per-tenant row if present,
 * otherwise the built-in default. Never throws — falls back to default.
 */
export const getConfig = async (tenantId) => {
  if (!tenantId) return getDefaultRulesConfig();
  try {
    const { data, error } = await supabase
      ?.from('sea_time_config')
      ?.select('config, version, review_status')
      ?.eq('tenant_id', tenantId)
      ?.maybeSingle();
    if (error || !data?.config) return getDefaultRulesConfig();
    return { ...data.config, reviewStatus: data.review_status, version: data.version };
  } catch {
    return getDefaultRulesConfig();
  }
};

/** Command-only: persist the per-vessel rules config (upsert). */
export const saveConfig = async (tenantId, config, reviewStatus = 'UNVERIFIED') => {
  const { error } = await supabase?.from('sea_time_config')?.upsert({
    tenant_id: tenantId,
    config,
    version: config?.version || null,
    review_status: reviewStatus
  }, { onConflict: 'tenant_id' });
  if (error) throw error;
  return true;
};

// ── Row <-> entry mapping ────────────────────────────────────────────────────

/**
 * Map a DB row to the shape the pure rules engine + the existing UI expect,
 * then attach the freshly-computed classification for the selected path.
 */
const rowToEntry = (row, pathId, config) => {
  const base = {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    date: row.entry_date,
    source: row.source,
    vesselStatus: row.vessel_status,
    watchHours: row.watch_hours,
    capacityServed: row.capacity_served,
    locationTradingArea: row.location_trading_area,
    vesselName: row.vessel_name,
    vesselFlag: row.vessel_flag,
    vesselImo: row.vessel_imo,
    grossTonnage: row.vessel_gt,
    lengthM: row.vessel_length_m,   // = the vessel's LOA (loa_m), denormalised by the autolog sync
    maxPax: row.vessel_max_pax,
    vesselType: row.vessel_type,
    vesselOfficialNo: row.vessel_official_number,
    // route / master-of-record enrichment (drives stamp/virtual/external + split)
    cargoRegistered: row.vessel_cargo_registered,
    masterName: row.master_name,
    masterUserId: row.master_user_id,
    masterAboard: row.master_aboard,
    masterOnCargo: row.master_on_cargo,
    verificationStatus: mapVerificationOut(row.verification_status),
    rawVerificationStatus: row.verification_status,
    locked: row.locked,
    signedBy: row.signed_by,
    signedAt: row.signed_at,
    signedName: row.signed_name,
    recordHash: row.record_hash,
    rejectionReason: row.rejection_reason,
    testimonialPath: row.testimonial_path,
    noteReason: row.note,
    documents: row.documents || []
  };

  const evalRes = evaluateEntryQualification(base, pathId, config);
  return {
    ...base,
    serviceType: evalRes.serviceType,
    countsToward: evalRes.countsToward,
    qualifiesForSelectedPath: evalRes.qualifies,
    qualificationReason: evalRes.reason,
    nonQualifyingReasons: evalRes.reasons?.length ? evalRes.reasons : undefined
  };
};

// The UI's existing VERIFICATION_STATUS vocabulary maps onto the DB enum.
const mapVerificationOut = (dbStatus) => ({
  draft: 'NOT_SUBMITTED',
  pending: 'SUBMITTED',
  captain_signed: 'VERIFIED',
  rejected: 'REJECTED'
}[dbStatus] || 'NOT_SUBMITTED');

// ── Reads ─────────────────────────────────────────────────────────────────

/** All of a user's entries on a vessel, classified against the selected path. */
export const fetchEntriesForUser = async (tenantId, userId, pathId) => {
  const config = await getConfig(tenantId);
  const { data, error } = await supabase
    ?.from(TABLE)
    ?.select('*')
    ?.eq('tenant_id', tenantId)
    ?.eq('user_id', userId)
    ?.order('entry_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => rowToEntry(r, pathId, config));
};

/**
 * A user's sea service across EVERY vessel they've served on — sea service is a
 * personal career record, not a per-vessel one. No tenant filter: row-level
 * security scopes it correctly per viewer (the seafarer sees all their vessels;
 * a COMMAND user viewing them sees only their own vessel's portion). Classified
 * against the current vessel's config (MCA rules are not vessel-specific).
 */
export const fetchEntriesAcrossVessels = async (userId, pathId, configTenantId) => {
  const config = await getConfig(configTenantId);
  const { data, error } = await supabase
    ?.from(TABLE)
    ?.select('*')
    ?.eq('user_id', userId)
    ?.order('entry_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => rowToEntry(r, pathId, config));
};

/**
 * Derive a crew member's "guest-on days" (Yacht Purser CoC evidence): the
 * distinct dates they were aboard (sea_service_entries) that fall inside a trip
 * carrying at least one active guest (trips + trip_guests). Tenant-scoped.
 * Returns { days, trips } (trips = guest-carrying trips found), or null on error.
 */
export const fetchGuestOnDays = async (tenantId, userId) => {
  if (!supabase || !tenantId || !userId) return null;
  try {
    const { data: trips } = await supabase
      .from('trips').select('id, start_date, end_date')
      .eq('tenant_id', tenantId).eq('is_deleted', false)
      .not('start_date', 'is', null).not('end_date', 'is', null);
    if (!trips?.length) return { days: 0, trips: 0 };
    const { data: tg } = await supabase
      .from('trip_guests').select('trip_id')
      .in('trip_id', trips.map(t => t.id)).eq('is_active_on_trip', true);
    const guestTripIds = new Set((tg || []).map(r => r.trip_id));
    const guestTrips = trips.filter(t => guestTripIds.has(t.id));
    if (!guestTrips.length) return { days: 0, trips: 0 };
    const { data: svc } = await supabase
      .from(TABLE).select('entry_date').eq('tenant_id', tenantId).eq('user_id', userId);
    const aboard = new Set((svc || []).map(r => String(r.entry_date)));
    const guestOn = new Set();
    for (const d of aboard) {
      if (guestTrips.some(t => d >= String(t.start_date) && d <= String(t.end_date))) guestOn.add(d);
    }
    return { days: guestOn.size, trips: guestTrips.length };
  } catch (e) { console.error('[seatime] guest-on days', e); return null; }
};

/** Calendar map { 'yyyy-mm-dd': entry } for a given month. */
export const getMonthCalendarData = async (tenantId, userId, pathId, year, month) => {
  const config = await getConfig(tenantId);
  const start = new Date(year, month, 1).toISOString().split('T')[0];
  const end = new Date(year, month + 1, 0).toISOString().split('T')[0];
  const { data, error } = await supabase
    ?.from(TABLE)
    ?.select('*')
    ?.eq('tenant_id', tenantId)
    ?.eq('user_id', userId)
    ?.gte('entry_date', start)
    ?.lte('entry_date', end);
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => {
    const e = rowToEntry(r, pathId, config);
    map[r.entry_date] = { ...e, colorState: colorStateForEntry(e) };
  });
  return map;
};

const colorStateForEntry = (e) => {
  if (e.qualifiesForSelectedPath && e.verificationStatus === 'VERIFIED') return 'green';
  if (e.qualifiesForSelectedPath) return 'yellow';
  if (e.source === 'manual') return 'white';
  return 'blue-striped';
};

/** Multi-requirement progress summary for the selected path. */
export const getProgressSummary = async (tenantId, userId, pathId) => {
  const config = await getConfig(tenantId);
  const path = (config?.paths || []).find(p => p.id === pathId);
  if (!path) return null;
  const records = await fetchEntriesForUser(tenantId, userId, pathId);

  // Verification status tally (uses the DB enum on each row) for the panel.
  const statusCounts = { draft: 0, pending: 0, signed: 0, rejected: 0 };
  for (const r of records) {
    if (r.rawVerificationStatus === 'captain_signed') statusCounts.signed += 1;
    else if (r.rawVerificationStatus === 'pending') statusCounts.pending += 1;
    else if (r.rawVerificationStatus === 'rejected') statusCounts.rejected += 1;
    else statusCounts.draft += 1;
  }

  return { ...summariseProgress(path, records), reviewStatus: config?.reviewStatus, statusCounts };
};

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Add manual entries across a date range (one row per day).
 * `vessel` carries the snapshot facts; `period` the per-day attributes.
 */
export const addManualEntries = async (tenantId, userId, { period, vessel, note, documents }) => {
  const rows = [];
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);
  const status = SERVICE_TYPE_TO_STATUS[period.seaServiceType] || 'UNDERWAY';

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    rows.push({
      tenant_id: tenantId,
      user_id: userId,
      entry_date: d.toISOString().split('T')[0],
      source: 'manual',
      vessel_status: status,
      watch_hours: period.watchHours ? Number(period.watchHours) : 0,
      capacity_served: period.capacityServed || null,
      location_trading_area: period.locationTradingArea || null,
      vessel_name: vessel.vesselName || null,
      vessel_flag: vessel.flag || null,
      vessel_imo: vessel.imoNumber || null,
      vessel_official_number: vessel.officialNumber || null,
      vessel_gt: vessel.grossTonnage != null ? Number(vessel.grossTonnage) : null,
      vessel_length_m: vessel.lengthM != null ? Number(vessel.lengthM) : null,
      vessel_type: vessel.vesselType || null,
      path_id: period.pathId || null,
      note: note || null,
      documents: documents || []
    });
  }

  const { data, error } = await supabase?.from(TABLE)?.insert(rows)?.select('id');
  if (error) throw error;
  return data?.length || 0;
};

/**
 * Auto-log: materialise onboard-service days for the crew's current vessel from
 * the management-owned employment record (authority dates, not crew self-entry).
 * Idempotent server-side — safe to call on every load. Returns
 * { inserted, has_start_date, period_from, period_to, reason? }.
 */
export const syncFromVessel = async (tenantId, userId) => {
  if (!tenantId || !userId) return { inserted: 0, has_start_date: false };
  const { data, error } = await supabase?.rpc('sync_sea_service_from_vessel', {
    p_tenant_id: tenantId, p_user_id: userId
  });
  if (error) throw error;
  return data || { inserted: 0, has_start_date: false };
};

/** Update a single entry (crew edits to own unlocked draft, or command). */
export const updateEntry = async (id, updates) => {
  const patch = {};
  if (updates.noteReason !== undefined) patch.note = updates.noteReason;
  if (updates.watchHours !== undefined) patch.watch_hours = Number(updates.watchHours);
  if (updates.capacityServed !== undefined) patch.capacity_served = updates.capacityServed;
  if (updates.locationTradingArea !== undefined) patch.location_trading_area = updates.locationTradingArea;
  const { error } = await supabase?.from(TABLE)?.update(patch)?.eq('id', id);
  if (error) throw error;
  return true;
};

/** Delete an entry (RLS enforces: own unlocked manual, or command). */
export const deleteEntry = async (id) => {
  const { error } = await supabase?.from(TABLE)?.delete()?.eq('id', id);
  if (error) throw error;
  return true;
};

// ── Sign-off workflow (RPCs) ─────────────────────────────────────────────

/** Crew submits draft entries for verification. */
export const submitEntries = async (tenantId, entryIds, { note, sigPath, signedName } = {}) => {
  const { data, error } = await supabase?.rpc('sea_time_submit_entries', {
    p_tenant_id: tenantId, p_entry_ids: entryIds,
    p_note: note || null, p_sig_path: sigPath || null, p_signed_name: signedName || null
  });
  if (error) throw error;
  // Notify the master(s) who'll sign — active COMMAND in the tenant — via bell +
  // email. Fire-and-forget server-side (service role resolves recipients and
  // bypasses owner-scoped notification RLS); never blocks or fails the submit.
  if (tenantId && Array.isArray(entryIds) && entryIds.length) {
    supabase?.functions
      ?.invoke('sendSeaTimeSubmission', { body: { tenantId, entryIds } })
      ?.then(() => {})?.catch(() => {});
  }
  return data;
};

/** Command signs off pending entries (locks + stamps a tamper-evident hash). */
export const signEntries = async (tenantId, entryIds, { note, sigPath, signedName } = {}) => {
  const { data, error } = await supabase?.rpc('sea_time_sign_entries', {
    p_tenant_id: tenantId, p_entry_ids: entryIds,
    p_note: note || null, p_sig_path: sigPath || null, p_signed_name: signedName || null
  });
  if (error) throw error;
  return data;
};

/**
 * Exact count of leave/absence days in [fromIso, toIso] from crew_status_history
 * — the authoritative source the status chip writes to. A day counts as leave if
 * the crew member's status in effect that day is anything other than 'active'
 * (matching the auto-log's is_leave rule). Used to fill the testimonial's
 * leave/absence total precisely, rather than the span-minus-days-aboard proxy.
 * Returns null on failure so callers can fall back.
 */
export const fetchLeaveDaysInRange = async (userId, fromIso, toIso) => {
  if (!userId || !fromIso || !toIso) return null;
  const { data, error } = await supabase
    .from('crew_status_history')
    .select('new_status, changed_at')
    .eq('user_id', userId)
    .order('changed_at', { ascending: true });
  if (error || !data) return null;
  const changes = data.map(r => ({ d: String(r.changed_at).slice(0, 10), s: r.new_status }));
  const end = new Date(toIso + 'T00:00:00');
  let leave = 0;
  for (let t = new Date(fromIso + 'T00:00:00'); t <= end; t.setDate(t.getDate() + 1)) {
    const day = t.toISOString().slice(0, 10);
    let status = 'active';
    for (const c of changes) { if (c.d <= day) status = c.s; else break; }
    if (status !== 'active') leave++;
  }
  return leave;
};

/** Command rejects pending entries with a reason. */
export const rejectEntries = async (tenantId, entryIds, reason) => {
  const { data, error } = await supabase?.rpc('sea_time_reject_entries', {
    p_tenant_id: tenantId, p_entry_ids: entryIds, p_reason: reason
  });
  if (error) throw error;
  return data;
};

export default {
  getConfig,
  saveConfig,
  fetchEntriesForUser,
  fetchEntriesAcrossVessels,
  getMonthCalendarData,
  getProgressSummary,
  addManualEntries,
  syncFromVessel,
  updateEntry,
  deleteEntry,
  submitEntries,
  signEntries,
  rejectEntries,
  fetchLeaveDaysInRange
};
