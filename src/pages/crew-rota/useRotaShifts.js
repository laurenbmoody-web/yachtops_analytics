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
import { supabase } from '../../lib/supabase';
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

// Build the derived per-crew object the grid + list + popover expect.
export function deriveCrew(member, memberShifts, weekShifts, now = new Date()) {
  const todayOnDuty = memberShifts.filter(s => ON_DUTY_TYPES.has(s.shiftType));
  const offToday =
    memberShifts.length > 0 && memberShifts.every(s => s.shiftType === 'off');

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
    departmentColor: member.departmentColor,
    permissionTier: member.permissionTier,
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
  const { tenantId } = useAuth();
  const [crew, setCrew] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!tenantId) { setLoading(false); return undefined; }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1 — crew: active tenant_members + department + profile fallback
        const { data: members, error: mErr } = await supabase
          .from('tenant_members')
          .select(`
            id, user_id, display_name, role, permission_tier, department_id, active,
            departments:department_id ( id, name, color ),
            profiles:user_id ( id, full_name )
          `)
          .eq('tenant_id', tenantId)
          .eq('active', true);
        if (mErr) throw mErr;
        if (cancelled) return;

        const mappedMembers = (members ?? []).map(m => ({
          id: m.id,
          userId: m.user_id,
          name: m.display_name || m.profiles?.full_name || 'Unknown',
          role: m.role,
          department: m.departments?.name || 'Other',
          departmentColor: m.departments?.color || null,
          permissionTier: m.permission_tier,
        }));

        // 2 — effective date: today, else the most recent dated shift
        const today = new Date().toISOString().slice(0, 10);
        let effDate = today;
        const { data: todayRows, error: tErr } = await supabase
          .from('rota_shifts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('shift_date', today)
          .limit(1);
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

        const { data: shiftRows, error: sErr } = await supabase
          .from('rota_shifts')
          .select('id, member_id, shift_date, start_time, end_time, shift_type, sub_type, notes')
          .eq('tenant_id', tenantId)
          .gte('shift_date', windowStartStr)
          .lte('shift_date', effDate);
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

        const derived = mappedMembers.map(m => {
          const todayS = dayShifts.filter(s => s.memberId === m.id);
          const weekS = mappedShifts.filter(s => s.memberId === m.id);
          return deriveCrew(m, todayS, weekS);
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
  }, [tenantId]);

  return { crew, shifts, effectiveDate, loading, error };
}
