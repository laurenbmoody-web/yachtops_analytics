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

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const ON_DUTY_TYPES = new Set(['duty', 'watch', 'standby', 'training']);

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
export function deriveCrew(member, memberShifts, weekShifts, now = new Date()) {
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

  const onDutyHoursToday = shiftRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
  const rest24hDecimal = Math.max(0, 24 - onDutyHoursToday);

  // Rolling 7-day rest: 7*24 minus on-duty hours across the window.
  const weekOnDutyHours = weekShifts
    .filter(s => ON_DUTY_TYPES.has(s.shiftType))
    .reduce((sum, s) => {
      let start = hhmmToDecimal(s.startTime);
      let end = hhmmToDecimal(s.endTime);
      if (end != null && start != null && end <= start) end += 24;
      return sum + ((end != null && start != null) ? (end - start) : 0);
    }, 0);
  const pastWeekHours = Math.max(0, 7 * 24 - weekOnDutyHours);

  const mlcWarning = rest24hDecimal < 10 || pastWeekHours < 77;

  // onNow: current wall-clock falls inside an on-duty window today.
  const nowDec = now.getHours() + now.getMinutes() / 60;
  let onNow = false;
  let onUntil = null;
  for (const r of shiftRanges) {
    const endWrapped = r.end > 24 ? r.end - 24 : r.end;
    const within = r.end > 24
      ? (nowDec >= r.start || nowDec < endWrapped)
      : (nowDec >= r.start && nowDec < r.end);
    if (within) { onNow = true; onUntil = fmtClock(endWrapped); break; }
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
    // Derived UI fields (shape-compatible with the old MOCK_CREW)
    shifts: shiftRanges,
    shiftText,
    rest24h: offToday ? null : fmtHours(rest24hDecimal),
    pastWeek: fmtHours(pastWeekHours),
    rest24hDecimal,
    pastWeekHours,
    mlcWarning: offToday ? false : mlcWarning,
    onNow,
    onUntil,
    offToday,
  };
}

export function useRotaShifts() {
  // AuthContext exposes `activeTenantId` (not `tenantId`) — matching the
  // pattern used by useTripGuests / useTripsMigration. Destructuring
  // `tenantId` here was always undefined, so the effect bailed before
  // it could even log.
  const { user, activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  console.log('[useRotaShifts] hook called, activeTenantId:', activeTenantId, 'hasUser:', !!user);
  const [crew, setCrew] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    console.log('[useRotaShifts] effect, tenantId:', tenantId, 'hasUser:', !!user);
    // Gate on user too — querying before the session hydrates would
    // send an anon request that RLS ({authenticated}) returns empty.
    if (!user || !tenantId) {
      console.log('[useRotaShifts] BAILING — no user/tenantId');
      setLoading(false);
      return undefined;
    }

    console.log('[useRotaShifts] fetching, tenantId:', tenantId);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1 — crew: active tenant_members + plain table-name embeds.
        // PostgREST resolves the embed by table name when there's a
        // single FK from tenant_members to that table.
        const { data: members, error: mErr, status: mStatus, statusText: mStatusText } = await supabase
          .from('tenant_members')
          .select(`
            id,
            user_id,
            display_name,
            role,
            permission_tier,
            department_id,
            role_id,
            departments ( name, color ),
            profiles ( full_name, avatar_url ),
            roles ( name )
          `)
          .eq('tenant_id', tenantId)
          .eq('active', true);
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
          // Friendly job title from roles.name ("Chief Stewardess"),
          // falling back to the permission role string.
          role: m.roles?.name || m.role || '',
          department: m.departments?.name || '',
          departmentId: m.department_id || null,
          departmentColor: m.departments?.color || '#5F5E5A',
          permissionTier: m.permission_tier,
        }));

        // 2 — effective date: today, else the most recent dated shift
        const today = new Date().toISOString().slice(0, 10);
        let effDate = today;
        const { data: todayRows, error: tErr, status: tStatus } = await supabase
          .from('rota_shifts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('shift_date', today)
          .limit(1);
        console.log('[useRotaShifts] RAW today-probe response:', {
          today, count: todayRows?.length, error: tErr, status: tStatus, rawData: todayRows,
        });
        if (tErr) throw tErr;
        if ((todayRows ?? []).length === 0) {
          const { data: latest } = await supabase
            .from('rota_shifts')
            .select('shift_date')
            .eq('tenant_id', tenantId)
            .order('shift_date', { ascending: false })
            .limit(1);
          if ((latest ?? []).length > 0) effDate = latest[0].shift_date;
        }
        if (cancelled) return;

        // 3 — shifts: the effective day + the rolling 7-day window
        const windowStart = new Date(`${effDate}T00:00:00`);
        windowStart.setDate(windowStart.getDate() - 6);
        const windowStartStr = windowStart.toISOString().slice(0, 10);

        const { data: shiftRows, error: sErr, status: sStatus, statusText: sStatusText } = await supabase
          .from('rota_shifts')
          .select('id, member_id, shift_date, start_time, end_time, shift_type, sub_type, notes')
          .eq('tenant_id', tenantId)
          .gte('shift_date', windowStartStr)
          .lte('shift_date', effDate);
        console.log('[useRotaShifts] RAW shifts response:', {
          count: shiftRows?.length,
          error: sErr,
          status: sStatus,
          statusText: sStatusText,
          effectiveDate: effDate,
          windowStart: windowStartStr,
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
        }));

        const dayShifts = mappedShifts.filter(s => s.date === effDate);

        // ── Current crew status as of the effective date ──
        // Mirrors crew-management/index.jsx:265-279 — most recent
        // crew_status_history row per user_id with changed_at <= asOf.
        const asOfIso = `${effDate}T23:59:59.999Z`;
        const userIds = mappedMembers.map(m => m.userId).filter(Boolean);
        const statusByUser = new Map();
        if (userIds.length > 0) {
          const { data: history, error: hErr } = await supabase
            .from('crew_status_history')
            .select('user_id, new_status, changed_at')
            .eq('tenant_id', tenantId)
            .in('user_id', userIds)
            .lte('changed_at', asOfIso)
            .order('changed_at', { ascending: false });
          console.log('[useRotaShifts] crew_status_history:', history?.length, 'error:', hErr);
          if (hErr) throw hErr;
          for (const row of (history ?? [])) {
            if (!statusByUser.has(row.user_id)) statusByUser.set(row.user_id, row.new_status);
          }
        }
        if (cancelled) return;

        const derived = mappedMembers.map(m => {
          const todayS = dayShifts.filter(s => s.memberId === m.id);
          const weekS = mappedShifts.filter(s => s.memberId === m.id);
          const c = deriveCrew(m, todayS, weekS);
          c.currentStatus = statusByUser.get(m.userId) ?? null;
          return c;
        });

        if (cancelled) return;
        setCrew(derived);
        setShifts(dayShifts);
        setEffectiveDate(effDate);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, tenantId]);

  return { crew, shifts, effectiveDate, loading, error };
}
