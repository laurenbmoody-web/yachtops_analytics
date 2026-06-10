// useRotaShifts — live crew + today's shifts from Supabase rota_shifts.
//
// Returns { crew, shifts, effectiveDate, loading, error }.
//
// crew[]  — one object per active tenant_member, shaped for the grid /
//           list / glance widget. Includes both raw fields (id, name,
//           role, department, permissionTier) and derived UI fields the
//           existing components already consume unchanged: shifts (decimal
//           hour ranges), shiftText (display string), rest24h / pastWeek
//           (formatted strings), mlcWarning, onNow, offToday.
// shifts[] — raw mapped rota_shifts rows for the effective day.
//
// "Today" per spec; but the seed data may be dated differently from the
// runtime clock, so when today has no rows we fall back to the most
// recent shift_date that does — the grid is never silently empty.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { ON_DUTY_TYPES, assessMlc } from './restHours';

export function hhmmToDecimal(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtHours(decimal) {
  if (decimal == null) return null;
  const total = Math.max(0, Math.round(decimal * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtClock(decimal) {
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Resolve one crew member's status as of a date — the most recent
// crew_status_history row with changed_at <= asOf. Parameterised by
// date so future Week / Trip-span views can pass other dates; the
// Today view defaults to today. (The hook resolves all crew in one
// batched query for perf; this is for single ad-hoc lookups.)
// Signature note: tenantId is explicit since this runs outside React
// context. Returns lowercase snake_case new_status, or null.
export async function getStatusAsOf(userId, tenantId, asOfDate = new Date().toISOString().slice(0, 10)) {
  if (!userId || !tenantId) return null;
  const asOfIso = `${asOfDate}T23:59:59.999Z`;
  const { data } = await supabase
    .from('crew_status_history')
    .select('new_status, changed_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .lte('changed_at', asOfIso)
    .order('changed_at', { ascending: false })
    .limit(1);
  return (data ?? [])[0]?.new_status ?? null;
}

// Build the derived per-crew object the grid + list + popover expect.
//
// `isViewingToday` gates the real-time "on duty now" check: when the chief
// is viewing a non-today date, the wall-clock comparison against that date's
// shifts is semantically nonsensical (a crew member can't be "on duty NOW"
// for a shift on a different date), so we force onNow=false. Rest-hour math
// is unaffected and still moves with the viewed date.
export function deriveCrew(member, memberShifts, weekShifts, now = new Date(), isViewingToday = true) {
  const todayOnDuty = memberShifts.filter(s => ON_DUTY_TYPES.has(s.shiftType));
  const offToday =
    memberShifts.length > 0 && memberShifts.every(s => s.shiftType === 'off');
  // Render-state inputs for the on-vessel sub-section split.
  const medicalToday = memberShifts.some(s => s.shiftType === 'medical');
  const activeOnShift = todayOnDuty.length > 0;

  // Decimal-hour ranges for the grid. Overnight shifts (end <= start)
  // extend past midnight; the grid clamps to its 48-slot window.
  const shiftRanges = todayOnDuty.map(s => {
    let start = hhmmToDecimal(s.startTime);
    let end = hhmmToDecimal(s.endTime);
    if (end != null && start != null && end <= start) end += 24;
    return { start, end, type: s.shiftType, subType: s.subType };
  }).filter(r => r.start != null && r.end != null);

  // Rest-hour math via the shared MLC utility. Covers all four rules
  // (10h/24h, 77h/7d, ≤2 rest periods one ≥6h, ≤14h continuous on-duty);
  // mlcWarning trips if any rule breaches.
  const mlcReport = assessMlc({ dayShifts: memberShifts, weekShifts });
  const rest24hDecimal = mlcReport.rest24h;
  const pastWeekHours = mlcReport.pastWeekHours;
  const mlcWarning = mlcReport.anyBreach;

  // onNow: current wall-clock falls inside an on-duty window today.
  // Only meaningful when the viewed date IS today — otherwise the wall-
  // clock comparison doesn't represent reality (see fn comment).
  const nowDec = now.getHours() + now.getMinutes() / 60;
  let onNow = false;
  let onUntil = null;
  if (isViewingToday) {
    for (const r of shiftRanges) {
      const endWrapped = r.end > 24 ? r.end - 24 : r.end;
      const within = r.end > 24
        ? (nowDec >= r.start || nowDec < endWrapped)
        : (nowDec >= r.start && nowDec < r.end);
      if (within) { onNow = true; onUntil = fmtClock(endWrapped); break; }
    }
  }

  // Display shift text — "08:00–14:00 · 18:00–22:00" or off label.
  const shiftText = offToday
    ? 'off today'
    : todayOnDuty
        .map(s => `${(s.startTime || '').slice(0, 5)}–${(s.endTime || '').slice(0, 5)}`)
        .join(', ');

  return {
    id: member.id,
    userId: member.userId,
    name: member.name,
    initials: initialsFromName(member.name),
    role: member.role,
    department: member.department,
    departmentId: member.departmentId,
    departmentColor: member.departmentColor,
    permissionTier: member.permissionTier,
    // Render-state + status (currentStatus filled by the hook after
    // resolving crew_status_history).
    medicalToday,
    activeOnShift,
    currentStatus: null,
    // Raw effective-day rota_shifts rows for this member (edit mode needs
    // ids + status to toggle/patch cells). Read-mode components ignore it.
    rawShifts: memberShifts,
    // Derived UI fields (shape-compatible with the old MOCK_CREW)
    shifts: shiftRanges,
    shiftText,
    rest24h: offToday ? null : fmtHours(rest24hDecimal),
    pastWeek: fmtHours(pastWeekHours),
    rest24hDecimal,
    pastWeekHours,
    mlcReport,
    mlcWarning: offToday ? false : mlcWarning,
    onNow,
    onUntil,
    offToday,
  };
}

// Local YYYY-MM-DD for "today" using local date components (no UTC).
function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// `selectedDate` (YYYY-MM-DD) anchors the fetch window. The window spans
// [anchor - historyDays .. anchor + forwardDays], inclusive. The DERIVED
// per-crew rest figures are still anchored on selectedDate (trailing 7
// days ending there) — forwardDays only widens the fetch so the week-view
// matrix can compute per-cell MLC for cells that sit FORWARD of
// selectedDate. Day view passes {historyDays:6, forwardDays:0} (unchanged
// 7-day trailing). Week view passes {historyDays:6, forwardDays:6} so
// the leftmost cell (selectedDate) has its trailing-7 history AND the
// rightmost cell (selectedDate+6) has its own days fetched.
//
// rotaId / departmentId (optional, 2nd-arg options): scope the fetch to a
// single rota and/or a single department's members. Both default to null,
// in which case the query is byte-for-byte the historical tenant+date-only
// fetch — the zero-arg (trip-detail SectionCrew) and selectedDate-only
// (/crew) callers are unaffected. The split-view passes both to show one
// department's slice of one rota.
export function useRotaShifts(
  selectedDate,
  { historyDays = 6, forwardDays = 0, rotaId = null, departmentId = null } = {},
) {
  const anchorDate = selectedDate || localTodayStr();
  // AuthContext exposes `activeTenantId` (not `tenantId`) — matching the
  // pattern used by useTripGuests / useTripsMigration. Destructuring
  // `tenantId` here was always undefined, so the effect bailed before
  // it could even log.
  const { user, activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  console.log('[useRotaShifts] hook called, activeTenantId:', activeTenantId, 'hasUser:', !!user);
  // Raw state — optimistic mutations modify these; `crew`, `shifts`,
  // `draftCount` derive via useMemo so cell edits flow to the UI in the
  // same React render that fires the (background) DB write.
  const [members, setMembers] = useState([]);
  const [windowShifts, setWindowShifts] = useState([]); // 7-day rolling window
  const [statusByUser, setStatusByUser] = useState(() => new Map());
  const [effectiveDate, setEffectiveDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Extracted so mutations can await a refresh. `silent` keeps the grid
  // mounted during a post-mutation refetch (no loading placeholder swap —
  // that blank/scroll-reset read as a full page refresh). Race note: rapid
  // successive loads are last-write-wins into state, acceptable for Phase 1.
  const load = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    // Gate on user too — querying before the session hydrates would
    // send an anon request that RLS ({authenticated}) returns empty.
    if (!user || !tenantId) {
      console.log('[useRotaShifts] BAILING — no user/tenantId');
      setLoading(false);
      return;
    }

    console.log('[useRotaShifts] fetching, tenantId:', tenantId, 'silent:', silent);
    if (!silent) setLoading(true);
    setError(null);

    {
      const cancelled = false;
      try {
        // 1 — crew: active tenant_members. Job title resolves from the
        // GLOBAL roles catalog first, then the per-tenant custom roles
        // catalog (exactly one of role_id / custom_role_id is populated
        // per crew member — see crew-management/index.jsx:174). The
        // explicit `role:roles!role_id(...)` and `custom_role:tenant_
        // custom_roles!custom_role_id(...)` aliases disambiguate the two
        // FK paths and surface them as `m.role` / `m.custom_role`. No
        // tier fallback — a member with neither role_id nor
        // custom_role_id has null title, not their permission_tier.
        // departmentId (optional) scopes the crew to a single department —
        // used by the /reviews split-view to show just the reviewed dept.
        // Absent ⇒ all active members (the /crew + trip-detail behavior).
        let membersQuery = supabase
          .from('tenant_members')
          .select(`
            id,
            user_id,
            display_name,
            permission_tier,
            department_id,
            role_id,
            custom_role_id,
            departments ( name, color ),
            profiles ( full_name, avatar_url ),
            role:roles!role_id ( name ),
            custom_role:tenant_custom_roles!custom_role_id ( name )
          `)
          .eq('tenant_id', tenantId)
          .eq('active', true);
        if (departmentId) membersQuery = membersQuery.eq('department_id', departmentId);
        const { data: members, error: mErr, status: mStatus, statusText: mStatusText } = await membersQuery;
        console.log('[useRotaShifts] RAW crew response:', {
          count: members?.length,
          error: mErr,
          status: mStatus,
          statusText: mStatusText,
          firstRow: members?.[0],
          rawData: members,
        });
        if (mErr) throw mErr;
        if (cancelled) return;

        const mappedMembers = (members ?? []).map(m => ({
          id: m.id,
          userId: m.user_id,
          name: m.display_name || m.profiles?.full_name || 'Unknown',
          // Job title: global role first, then tenant custom role. No tier
          // fallback — a member with neither linked has a null title.
          role: m.role?.name || m.custom_role?.name || null,
          department: m.departments?.name || '',
          departmentId: m.department_id || null,
          departmentColor: m.departments?.color || '#5F5E5A',
          permissionTier: m.permission_tier,
        }));

        // 2 — effective date: strictly the anchor (selectedDate). No more
        // "fall back to latest dated row" — when the chief navigates to a
        // date with no shifts, the grid empty IS the truth. The previous
        // fallback was a seed-data workaround that became actively
        // misleading once stepper nav lets you pick arbitrary dates.
        const effDate = anchorDate;
        if (cancelled) return;

        // 3 — shifts: the effective day + the rolling window. Format the
        // bounds with LOCAL date components — toISOString() converts local
        // midnight to UTC, which in a timezone ahead of UTC rolls the bound
        // back a day. With day view's forwardDays:0 that dropped the selected
        // day's own shifts from the window (visible as "week shows them, day
        // grid is empty"). shift_date is a local calendar date, so compare
        // against local YYYY-MM-DD.
        const pad2 = (n) => String(n).padStart(2, '0');
        const toLocalYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        const windowStart = new Date(`${effDate}T00:00:00`);
        windowStart.setDate(windowStart.getDate() - historyDays);
        const windowStartStr = toLocalYmd(windowStart);
        const windowEnd = new Date(`${effDate}T00:00:00`);
        windowEnd.setDate(windowEnd.getDate() + forwardDays);
        const windowEndStr = toLocalYmd(windowEnd);

        // rotaId (optional) scopes the fetch to one rota. The base query
        // filters by tenant_id + date window ONLY — for /crew that's
        // invisible (one standing rota per tenant), but a tenant with
        // multiple rotas overlapping the same dates would bleed rows
        // across rotas. The split-view's specific-rota pane needs this
        // filter to be correct. departmentId (optional) scopes to the
        // dept's members, mirroring getDraftShiftCount — members are
        // already dept-filtered above, so reuse their ids.
        let shiftsQuery = supabase
          .from('rota_shifts')
          .select('id, member_id, shift_date, start_time, end_time, shift_type, sub_type, notes, status')
          .eq('tenant_id', tenantId)
          .gte('shift_date', windowStartStr)
          .lte('shift_date', windowEndStr);
        if (rotaId) shiftsQuery = shiftsQuery.eq('rota_id', rotaId);
        if (departmentId) shiftsQuery = shiftsQuery.in('member_id', mappedMembers.map((m) => m.id));
        const { data: shiftRows, error: sErr, status: sStatus, statusText: sStatusText } = await shiftsQuery;
        console.log('[useRotaShifts] RAW shifts response:', {
          count: shiftRows?.length,
          error: sErr,
          status: sStatus,
          statusText: sStatusText,
          effectiveDate: effDate,
          windowStart: windowStartStr,
          windowEnd: windowEndStr,
          firstRow: shiftRows?.[0],
          rawData: shiftRows,
        });
        if (sErr) throw sErr;
        if (cancelled) return;

        const mappedShifts = (shiftRows ?? []).map(s => ({
          id: s.id,
          memberId: s.member_id,
          date: s.shift_date,
          startTime: s.start_time,
          endTime: s.end_time,
          shiftType: s.shift_type,
          subType: s.sub_type,
          notes: s.notes,
          status: s.status,
        }));

        // ── Current crew status as of the effective date ──
        // Mirrors crew-management/index.jsx:265-279 — most recent
        // crew_status_history row per user_id with changed_at <= asOf.
        //
        // Status resolves as of real today, independent of which date
        // the grid is rendering. The Today view always shows current
        // operational state. Week/Trip views will pass per-date status
        // via getStatusAsOf(userId, tenantId, date) so they can resolve
        // historical status per day. Do not re-couple to effDate.
        const realToday = new Date().toISOString().slice(0, 10);
        const asOfIso = `${realToday}T23:59:59.999Z`;
        const userIds = mappedMembers.map(m => m.userId).filter(Boolean);
        const nextStatusByUser = new Map();
        if (userIds.length > 0) {
          const { data: history, error: hErr } = await supabase
            .from('crew_status_history')
            .select('user_id, new_status, changed_at')
            .eq('tenant_id', tenantId)
            .in('user_id', userIds)
            .lte('changed_at', asOfIso)
            .order('changed_at', { ascending: false });
          if (hErr) throw hErr;
          for (const row of (history ?? [])) {
            if (!nextStatusByUser.has(row.user_id)) nextStatusByUser.set(row.user_id, row.new_status);
          }
        }
        if (cancelled) return;

        setMembers(mappedMembers);
        setWindowShifts(mappedShifts);
        setStatusByUser(nextStatusByUser);
        setEffectiveDate(effDate);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    }
  }, [user, tenantId, anchorDate, historyDays, forwardDays, rotaId, departmentId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived state (memoised) ───────────────────────────────────────────────
  // `windowShifts` is the source of truth during an edit session; optimistic
  // mutations modify it directly so cells re-render on the same render the
  // event handler dispatches (no await on the DB before UI updates).

  const shifts = useMemo(
    () => (effectiveDate ? windowShifts.filter(s => s.date === effectiveDate) : []),
    [windowShifts, effectiveDate],
  );

  const isViewingToday = anchorDate === localTodayStr();
  // Trailing 7-day window for per-crew rest figures anchored on selectedDate.
  // When forwardDays > 0 the fetched windowShifts also contains future
  // shifts; those must NOT enter the per-crew rest math (MLC's 7-day window
  // is strictly trailing). Slice here.
  const weekTrailingStart = useMemo(() => {
    const d = new Date(`${anchorDate}T00:00:00`);
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [anchorDate]);
  const crew = useMemo(
    () => members.map((m) => {
      const todayS = shifts.filter(s => s.memberId === m.id);
      const weekS = windowShifts.filter(
        s => s.memberId === m.id && s.date >= weekTrailingStart && s.date <= anchorDate,
      );
      const c = deriveCrew(m, todayS, weekS, new Date(), isViewingToday);
      c.currentStatus = statusByUser.get(m.userId) ?? null;
      return c;
    }),
    [members, windowShifts, shifts, statusByUser, isViewingToday, weekTrailingStart, anchorDate],
  );

  const draftCount = useMemo(
    () => shifts.filter(s => s.status === 'draft').length,
    [shifts],
  );

  // ── Paint-brush mutation (optimistic) ─────────────────────────────────────
  // ONE entrypoint for the grid. Computes the overlapping shifts in
  // [loSlot, hiSlot+1), replaces them with surviving outside-fragments plus
  // (when not erasing) a new shift of the active type, updates local state
  // SYNCHRONOUSLY for an instant-paint feel, then fires the DB writes in
  // the background. On failure: silent refetch from server + error to the
  // caller. No awaited refetch on success — server truth reconciles when
  // the user clicks Edit/Done (page-level refetch).
  //
  // Same-type no-op: painting a range already covered entirely by the
  // same active type does no work and no DB write. Erase on an empty
  // range is likewise a no-op.

  const applyPaint = useCallback(async ({
    crewMember, loSlot, hiSlot, type, erase = false,
    rotaId, tripId = null, createdByMemberId = null, gridStartHour = 6,
  }) => {
    if (!tenantId || !rotaId || !crewMember?.id || !effectiveDate) {
      return { ok: false, error: 'missing-context' };
    }
    const lo = Math.min(loSlot, hiSlot);
    const hi = Math.max(loSlot, hiSlot);
    const newLo = lo;          // inclusive slot index
    const newHi = hi + 1;      // exclusive slot index

    const toDec = (t) => {
      if (!t) return null;
      const [h, m] = String(t).split(':').map(Number);
      return h + (m || 0) / 60;
    };
    const spanOf = (s) => {
      let st = toDec(s.startTime);
      let en = toDec(s.endTime);
      if (st == null || en == null) return null;
      if (en <= st) en += 24;
      return {
        sSlot: Math.round((st - gridStartHour) * 2),
        eSlot: Math.round((en - gridStartHour) * 2),
      };
    };
    const dec = (slot) => {
      const d = (gridStartHour + slot * 0.5) % 24;
      const h = Math.floor(d);
      const mm = Math.round((d - h) * 60);
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    const subTypeFor = (t) => (t === 'watch' ? 'navigation' : t === 'standby' ? 'maintenance' : null);

    // Member's shifts on the effective date (everything else is untouched).
    const memberDay = windowShifts.filter(
      s => s.memberId === crewMember.id && s.date === effectiveDate,
    );

    // Partition into untouched, overlapping (to delete), and surviving fragments.
    const overlappingIds = [];
    const survivingFragments = []; // new rows for outside-of-paint slivers
    const untouched = [];
    for (const s of memberDay) {
      const span = spanOf(s);
      if (!span) { untouched.push(s); continue; }
      if (span.eSlot <= newLo || span.sSlot >= newHi) {
        untouched.push(s);
        continue;
      }
      overlappingIds.push(s.id);
      if (span.sSlot < newLo) {
        survivingFragments.push({
          startTime: s.startTime, endTime: dec(newLo),
          shiftType: s.shiftType, subType: s.subType ?? null,
        });
      }
      if (span.eSlot > newHi) {
        survivingFragments.push({
          startTime: dec(newHi), endTime: s.endTime,
          shiftType: s.shiftType, subType: s.subType ?? null,
        });
      }
    }

    // No-op short-circuits.
    if (erase && overlappingIds.length === 0) {
      return { ok: true, noop: true };
    }
    if (!erase) {
      let allSame = true;
      for (let i = lo; i <= hi; i += 1) {
        let cov = null;
        for (const s of memberDay) {
          const sp = spanOf(s);
          if (sp && i >= sp.sSlot && i < sp.eSlot) { cov = s; break; }
        }
        if (!cov || cov.shiftType !== type) { allSame = false; break; }
      }
      if (allSame) return { ok: true, noop: true };
    }

    // Build optimistic rows (temp ids — reconciled to real ids on insert).
    const tmpId = () => `tmp-${Math.random().toString(36).slice(2, 10)}`;
    const optimisticInserts = [
      ...survivingFragments.map(f => ({
        id: tmpId(),
        memberId: crewMember.id,
        date: effectiveDate,
        startTime: f.startTime,
        endTime: f.endTime,
        shiftType: f.shiftType,
        subType: f.subType,
        notes: null,
        status: 'draft',
      })),
      ...(erase ? [] : [{
        id: tmpId(),
        memberId: crewMember.id,
        date: effectiveDate,
        startTime: dec(newLo),
        endTime: dec(newHi),
        shiftType: type,
        subType: subTypeFor(type),
        notes: null,
        status: 'draft',
      }]),
    ];

    // 1. Optimistic local update — runs synchronously, paints the grid now.
    setWindowShifts((prev) => {
      const others = prev.filter(
        s => !(s.memberId === crewMember.id && s.date === effectiveDate),
      );
      const keep = memberDay.filter(s => !overlappingIds.includes(s.id));
      return [...others, ...keep, ...optimisticInserts];
    });

    // 2. Background DB writes. Insert first, then delete — a partial
    // failure leaves an overlap (recoverable) rather than a hole.
    try {
      let realIds = [];
      if (optimisticInserts.length > 0) {
        const dbRows = optimisticInserts.map((opt) => {
          const row = {
            tenant_id: tenantId,
            rota_id: rotaId,
            member_id: crewMember.id,
            shift_date: effectiveDate,
            start_time: opt.startTime,
            end_time: opt.endTime,
            shift_type: opt.shiftType || 'duty',
            sub_type: opt.subType ?? null,
            status: 'draft',
          };
          if (tripId) row.trip_id = tripId;
          if (createdByMemberId) row.created_by = createdByMemberId;
          return row;
        });
        const { data, error: insErr } = await supabase
          .from('rota_shifts').insert(dbRows).select('id');
        if (insErr) throw new Error(insErr.message);
        realIds = (data || []).map(d => d.id);
      }
      if (overlappingIds.length > 0) {
        const { error: delErr } = await supabase
          .from('rota_shifts').delete().in('id', overlappingIds);
        if (delErr) throw new Error(delErr.message);
      }
      // 3. Reconcile temp ids → real ids. Position-aligned with optimisticInserts.
      if (realIds.length === optimisticInserts.length) {
        const idMap = new Map();
        for (let i = 0; i < realIds.length; i += 1) {
          idMap.set(optimisticInserts[i].id, realIds[i]);
        }
        setWindowShifts(prev => prev.map(
          s => (idMap.has(s.id) ? { ...s, id: idMap.get(s.id) } : s),
        ));
      }
      return { ok: true };
    } catch (e) {
      // 4. Failure: server truth wins. Silent refetch wipes optimistic state.
      load({ silent: true });
      return { ok: false, error: e.message || String(e) };
    }
  }, [tenantId, effectiveDate, windowShifts, load]);

  // ── Phase 3a — applyTemplate (multi-row write) ────────────────────────────
  // The apply flow precomputes the exact rows to INSERT (with status=
  // 'draft', tenant/rota/member/dates/times all filled per the verified
  // schema) and the existing shift ids to DELETE (overwrite case). We do
  // insert-then-delete in the background (same pattern as splitShift —
  // partial failure leaves an overlap, never data loss). Optimistic local
  // state update is filtered to the loaded 7-day window so the rolling
  // rest calc in deriveCrew never sees out-of-window rows; out-of-window
  // inserts become visible on the next refetch. Failure → silent refetch +
  // return error.

  const applyTemplate = useCallback(async ({ rows = [], deleteIds = [] } = {}) => {
    if (!tenantId) return { ok: false, error: 'missing-context' };
    if (rows.length === 0 && deleteIds.length === 0) {
      return { ok: true, noop: true, inserted: 0, deleted: 0 };
    }

    // Window predicate for optimistic local rendering — [effDate-historyDays
    // .. effDate+forwardDays]. (lexical YYYY-MM-DD comparison is correct here.)
    let inWindow = () => false;
    if (effectiveDate) {
      const anchor = new Date(`${effectiveDate}T00:00:00`);
      const start = new Date(anchor); start.setDate(start.getDate() - historyDays);
      const end = new Date(anchor); end.setDate(end.getDate() + forwardDays);
      const pad = (n) => String(n).padStart(2, '0');
      const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
      const endStr = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
      inWindow = (d) => d >= startStr && d <= endStr;
    }

    setWindowShifts((prev) => {
      const filtered = deleteIds.length
        ? prev.filter((s) => !deleteIds.includes(s.id))
        : prev;
      const optimistic = rows
        .filter((r) => inWindow(r.shift_date))
        .map((r) => ({
          id: `tmp-${Math.random().toString(36).slice(2, 10)}`,
          memberId: r.member_id,
          date: r.shift_date,
          startTime: r.start_time,
          endTime: r.end_time,
          shiftType: r.shift_type,
          subType: r.sub_type ?? null,
          notes: r.notes ?? null,
          status: r.status || 'draft',
        }));
      return [...filtered, ...optimistic];
    });

    try {
      let inserted = 0;
      let insertedIds = [];
      if (rows.length > 0) {
        const { data, error: insErr } = await supabase
          .from('rota_shifts').insert(rows).select('id');
        if (insErr) throw new Error(insErr.message);
        inserted = (data || []).length;
        // Position-aligned with `rows` — supabase preserves input order.
        insertedIds = (data || []).map((d) => d.id);
      }
      if (deleteIds.length > 0) {
        const { error: delErr } = await supabase
          .from('rota_shifts').delete().in('id', deleteIds);
        if (delErr) throw new Error(delErr.message);
      }
      // Reconcile temp ids — a silent refetch is cleaner than threading
      // N temp-id maps across a batch. Out-of-window rows are also
      // unobservable in local state anyway; refetch realigns everything.
      await load({ silent: true });
      return { ok: true, inserted, insertedIds, deleted: deleteIds.length };
    } catch (e) {
      load({ silent: true });
      return { ok: false, error: e.message || String(e) };
    }
  }, [tenantId, effectiveDate, historyDays, forwardDays, load]);

  return {
    crew, shifts, windowShifts, effectiveDate, loading, error, draftCount,
    isViewingToday, refetch: load, applyPaint, applyTemplate,
  };
}
