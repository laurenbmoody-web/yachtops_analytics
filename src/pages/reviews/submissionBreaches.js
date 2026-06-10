import { assessMlc } from '../crew-rota/restHours';

// computeSubmissionBreaches — does any crew member breach MLC on any day of
// this submission? Assesses each (member, working day) across the submission
// range against the four MLC rules (assessMlc), using a trailing-7-day window
// for the weekly/stretch rules. Reads the live rota_shifts so it reflects any
// edits the reviewer made before accepting.
//
// Returns { hasBreaches, count, crew: [{ name, days }] } where count is the
// number of breaching (member, day) pairs.

function addDays(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export async function computeSubmissionBreaches(
  supabase,
  { rotaId, departmentId, tenantId, dateStart, dateEnd },
) {
  const empty = { hasBreaches: false, count: 0, crew: [] };
  if (!rotaId || !departmentId || !dateStart) return empty;
  const end = dateEnd || dateStart;

  const { data: members, error: mErr } = await supabase
    .from('tenant_members')
    .select('id, display_name, profiles ( full_name )')
    .eq('tenant_id', tenantId)
    .eq('department_id', departmentId)
    .eq('active', true);
  if (mErr || !members || members.length === 0) return empty;
  const memberList = members.map((m) => ({
    id: m.id,
    name: m.display_name || m.profiles?.full_name || 'Crew',
  }));
  const ids = memberList.map((m) => m.id);

  // Window: 6 days before the start (for the trailing-7 weekly window) → end.
  const { data: shiftRows, error: sErr } = await supabase
    .from('rota_shifts')
    .select('member_id, shift_date, start_time, end_time, shift_type, status')
    .eq('rota_id', rotaId)
    .in('member_id', ids)
    .gte('shift_date', addDays(dateStart, -6))
    .lte('shift_date', end);
  if (sErr) return empty;
  const shifts = (shiftRows || []).map((s) => ({
    memberId: s.member_id,
    date: s.shift_date,
    startTime: s.start_time,
    endTime: s.end_time,
    shiftType: s.shift_type,
  }));

  // Day list across the submission (lexical YYYY-MM-DD compare; capped).
  const days = [];
  for (let d = dateStart, i = 0; d <= end && i < 400; d = addDays(d, 1), i += 1) days.push(d);

  const breachByMember = new Map();
  let count = 0;
  for (const m of memberList) {
    for (const day of days) {
      const dayShifts = shifts.filter((s) => s.memberId === m.id && s.date === day);
      if (dayShifts.length === 0) continue;
      const weekStart = addDays(day, -6);
      const weekShifts = shifts.filter(
        (s) => s.memberId === m.id && s.date >= weekStart && s.date <= day,
      );
      const report = assessMlc({ dayShifts, weekShifts });
      if (report.anyBreach) {
        count += 1;
        breachByMember.set(m.name, (breachByMember.get(m.name) || 0) + 1);
      }
    }
  }

  const crew = [...breachByMember.entries()].map(([name, n]) => ({ name, days: n }));
  return { hasBreaches: count > 0, count, crew };
}
