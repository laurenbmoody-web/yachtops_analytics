// rotaHorExportData — single source of truth for assembling the Hours-of-Rest
// export payload ({ rows, days, meta, windowShifts, breachReasons }) consumed by
// rotaHorExport's exportRestLogPDF / exportRestLogCSV.
//
// The pure transforms here are the SAME ones RestLogView uses on-screen, so the
// rota page's export and any other caller (e.g. the month-end hub) produce a
// byte-for-byte identical Record of Hours of Rest. RestLogView imports these
// rather than keeping its own copies — change the rest-log presentation in one
// place and both paths follow.
//
// `loadRotaHorExportData({ tenantId, year, month })` additionally runs the exact
// Supabase queries RotaWorkspace runs (crew, rota_shifts, hor_work_entries,
// vessels/tenants identity, hor_breach_reasons), so the payload can be built
// headlessly for an arbitrary month without mounting the rota page.

import { supabase } from '../../lib/supabaseClient';
import {
  ON_DUTY_TYPES,
  assessMlc,
  reframeToOperationalDay,
  workEntriesToShifts,
  mergeLoggedOverPlan,
  MLC_DAILY_REST_MIN,
  MLC_WEEKLY_REST_MIN,
} from './restHours';
import { getRoleDisplayName } from './crewDisplay';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { getSignatureUrl } from '../crew-profile/utils/horSignatures';
import { fetchMonthStatusesForMonth } from '../crew-profile/utils/horMonthStatus';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function pad2(n) { return String(n).padStart(2, '0'); }
function parseLocal(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function toYmd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDaysStr(s, n) { const d = parseLocal(s); d.setDate(d.getDate() + n); return toYmd(d); }
const hhmmToDec = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60; };

// ── Pure transforms (mirrored from RestLogView; single source) ──────────────

// Per (member, day) rest summary. Trailing-7 weekly rest is sliced from the
// passed shift list.
export function computeCell(memberId, dateStr, windowShifts) {
  const dayShifts = windowShifts.filter((s) => s.memberId === memberId && s.date === dateStr);
  const weekStart = addDaysStr(dateStr, -6);
  const weekShifts = windowShifts.filter(
    (s) => s.memberId === memberId && s.date >= weekStart && s.date <= dateStr,
  );
  const onDuty = dayShifts.filter((s) => ON_DUTY_TYPES.has(s.shiftType));
  const isOff = onDuty.length === 0;
  const mlc = assessMlc({ dayShifts, weekShifts });
  return {
    date: dateStr,
    isOff,
    rest24h: mlc.rest24h,
    pastWeekHours: mlc.pastWeekHours,
    dailyLow: !isOff && mlc.rest24h < MLC_DAILY_REST_MIN,
    marginal: !isOff && mlc.rest24h >= MLC_DAILY_REST_MIN && mlc.rest24h < MLC_DAILY_REST_MIN + 1,
    weeklyLow: mlc.pastWeekHours < MLC_WEEKLY_REST_MIN,
    // Structural MLC/STCW rules — surfaced so the summary can't under-report a
    // breach the per-seafarer record (which lists all four) does flag.
    splitBreach: !isOff && mlc.breaches.some((b) => b.rule === 'rest_period_split'),
    stretchBreach: mlc.breaches.some((b) => b.rule === 'max_work_stretch_14h'),
  };
}

const nextDateStr = (dateStr) => addDaysStr(dateStr, 1);

// Calendar basis: split any shift running past midnight into a start-day part
// (…→24:00) and a next-day part (00:00→…) so each calendar day is credited only
// the on-duty hours that physically fall on it. Operational basis reconciles
// overnight work via reframeToOperationalDay, so it is left untouched there.
export const splitAtMidnight = (shifts) => {
  const out = [];
  for (const s of (shifts || [])) {
    const st = hhmmToDec(s.startTime);
    const en = hhmmToDec(s.endTime);
    if (st == null || en == null || en >= st) { out.push(s); continue; }
    out.push({ ...s, endTime: '24:00' });
    if (en > 0) out.push({ ...s, date: nextDateStr(s.date), startTime: '00:00', endTime: s.endTime });
  }
  return out;
};

// Overlay a crew's logged actuals onto the rota plan (logged wins per member-day).
export function mergeWorkEntriesIntoShifts(crew, windowShifts, workEntries) {
  const userToMember = new Map((crew || []).filter((c) => c.userId).map((c) => [c.userId, c.id]));
  const { loggedShifts, loggedDays } = workEntriesToShifts(workEntries, userToMember);
  return mergeLoggedOverPlan(windowShifts, loggedShifts, loggedDays);
}

// The 24h "day" anchor for the daily-rest rule, then frame the shifts by it.
export function dayStartHourFor(horDayBasis, operationalDayStartHour) {
  return horDayBasis === 'operational' ? (operationalDayStartHour || 0) : 0;
}
export function frameShifts(mergedShifts, dayStartHour) {
  return dayStartHour
    ? reframeToOperationalDay(mergedShifts, dayStartHour)
    : splitAtMidnight(mergedShifts);
}
export function mlcBasisLabel(dayStartHour) {
  return dayStartHour
    ? `Rest assessed on a 24-hour day commencing ${String(dayStartHour).padStart(2, '0')}:00`
    : 'Rest assessed on a calendar day (00:00–24:00)';
}

// Dept-grouped rows with per-cell rest + per-member breach tallies.
export function buildRestLogRows(crew, days, framedShifts) {
  const byDept = new Map();
  for (const c of crew) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c);
  }
  const ordered = [
    ...DEPT_ORDER.filter((d) => byDept.has(d)),
    ...Array.from(byDept.keys()).filter((d) => !DEPT_ORDER.includes(d)),
  ];
  return ordered.map((dept) => {
    const members = byDept.get(dept).map((c) => {
      const cells = days.map((d) => computeCell(c.id, d, framedShifts));
      return {
        id: c.id,
        userId: c.userId,
        name: c.name,
        role: getRoleDisplayName(c.role),
        cells,
        dailyBreachDays: cells.filter((x) => x.dailyLow).length,
        weeklyBreachDays: cells.filter((x) => x.weeklyLow).length,
        splitBreachDays: cells.filter((x) => x.splitBreach).length,
        stretchBreachDays: cells.filter((x) => x.stretchBreach).length,
      };
    });
    return { dept, color: byDept.get(dept)[0]?.departmentColor || '#5F5E5A', members };
  });
}

export function buildRestLogMeta({
  vesselName, imoNumber, flagState, portOfRegistry, departmentName,
  periodLabel, period, crew, dayStartHour,
}) {
  return {
    vesselName,
    imoNumber,
    flagState,
    portOfRegistry,
    departmentName,
    periodLabel,
    period,
    crewNames: Object.fromEntries((crew || []).filter((c) => c.userId).map((c) => [c.userId, c.name])),
    crewRoles: Object.fromEntries((crew || []).filter((c) => c.userId).map((c) => [c.userId, getRoleDisplayName(c.role)])),
    horDayStartHour: dayStartHour,
    basisLabel: mlcBasisLabel(dayStartHour),
    generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
  };
}

// Exports are the signed RECORD: for an in-progress period, clamp to today so we
// never assert not-yet-elapsed (still editable) days as fact. Past periods
// export whole. Tallies + period label follow the clamp. Mirrors
// RestLogView.buildExport.
export function clampExportToToday({ rows, days, meta, periodLabel, realToday }) {
  const ed = realToday ? days.filter((d) => d <= realToday) : days;
  const clamped = ed.length < days.length;
  const er = clamped
    ? rows.map((r) => ({
      ...r,
      members: r.members.map((m) => {
        const cells = m.cells.filter((c) => c.date <= realToday);
        return {
          ...m,
          cells,
          dailyBreachDays: cells.filter((x) => x.dailyLow).length,
          weeklyBreachDays: cells.filter((x) => x.weeklyLow).length,
          splitBreachDays: cells.filter((x) => x.splitBreach).length,
        stretchBreachDays: cells.filter((x) => x.stretchBreach).length,
        };
      }),
    }))
    : rows;
  const label = (clamped && ed.length)
    ? `${periodLabel} (to ${parseLocal(ed[ed.length - 1]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`
    : periodLabel;
  return { days: ed, rows: er, meta: { ...meta, periodLabel: label }, empty: ed.length === 0 };
}

// ── Captured sign-off signatures (for the management record) ────────────────
// Each signed-off month carries the seafarer's submission signature and the
// approver's (master's) counter-signature in the private hor-signatures bucket.
// We re-sign the stored paths, fetch the PNGs as data URLs (origin-independent,
// so jsPDF can embed them without tainting), and read their natural dimensions
// for aspect-correct placement on the record's signature lines.

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(r.error);
  r.onload = () => resolve(String(r.result));
  r.readAsDataURL(blob);
});
const imageDims = (dataUrl) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => resolve({ w: 0, h: 0 });
  img.src = dataUrl;
});
async function loadSignatureImage(path) {
  if (!path) return null;
  try {
    const url = await getSignatureUrl(path);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const dataUrl = await blobToDataURL(await res.blob());
    const { w, h } = await imageDims(dataUrl);
    return { dataUrl, w, h };
  } catch {
    return null;
  }
}
const fmtSigDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// userId -> { seafarer:{img,name,date}, master:{img,name,date} } for every
// member whose month carries a signature. Members with no sign-off are omitted
// (their record keeps blank signature lines).
async function buildSignaturesForMonth({ tenantId, year, mi }) {
  const statuses = await fetchMonthStatusesForMonth({ tenantId, year, jsMonth: mi });
  const out = {};
  await Promise.all(Object.entries(statuses || {}).map(async ([userId, row]) => {
    const hasSub = row?.submit_signature_path || row?.submit_signed_name;
    const hasApp = row?.approve_signature_path || row?.approve_signed_name;
    if (!hasSub && !hasApp) return;
    const [subImg, appImg] = await Promise.all([
      loadSignatureImage(row?.submit_signature_path),
      loadSignatureImage(row?.approve_signature_path),
    ]);
    out[userId] = {
      seafarer: hasSub ? { img: subImg, name: row?.submit_signed_name || '', date: fmtSigDate(row?.submitted_at) } : null,
      master: hasApp ? { img: appImg, name: row?.approve_signed_name || '', date: fmtSigDate(row?.confirmed_at || row?.locked_at) } : null,
    };
  }));
  return out;
}

// ── Headless month loader ───────────────────────────────────────────────────

// Assemble the full export payload for one month, running the same queries the
// rota page runs. `month` is 1-based. Returns { rows, days, meta, windowShifts,
// breachReasons, empty } — exactly the args exportRestLogPDF/CSV expect (plus
// `empty` when the period hasn't started). Clamped to today like the rota export.
export async function loadRotaHorExportData({ tenantId, year, month, withSignatures = false }) {
  const mi = month - 1; // 0-based
  const last = new Date(year, mi + 1, 0);
  const daysInMonth = last.getDate();
  const days = [];
  for (let i = 1; i <= daysInMonth; i += 1) days.push(toYmd(new Date(year, mi, i)));
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  // Rolling-7 context needs a 6-day lead-in before the 1st; work entries fetched
  // a touch wider still (harmless extras are ignored by the per-day windows).
  const windowStart = addDaysStr(firstDay, -6);
  const weStart = addDaysStr(firstDay, -13);

  const [crewRes, shiftRes, weRes, veRes, tnRes, brRes] = await Promise.all([
    supabase.from('tenant_members')
      .select('id, user_id, display_name, permission_tier, department_id, role_id, custom_role_id, departments ( name, color ), profiles ( full_name ), role:roles!role_id ( name ), custom_role:tenant_custom_roles!custom_role_id ( name )')
      .eq('tenant_id', tenantId).eq('active', true),
    supabase.from('rota_shifts')
      .select('id, member_id, shift_date, start_time, end_time, shift_type, sub_type, notes, status')
      .eq('tenant_id', tenantId).gte('shift_date', windowStart).lte('shift_date', lastDay),
    supabase.from('hor_work_entries')
      .select('subject_user_id, entry_date, work_segments, segment_types')
      .eq('tenant_id', tenantId).gte('entry_date', weStart).lte('entry_date', lastDay),
    supabase.from('vessels')
      .select('name, operational_day_start_hour, hor_day_basis, imo_number, flag, port_of_registry')
      .eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants')
      .select('imo_number, flag, port_of_registry').eq('id', tenantId).maybeSingle(),
    supabase.from('hor_breach_reasons')
      .select('subject_user_id, breach_date, note_text, signed_off_at, signed_off_by, updated_at, updated_by')
      .eq('tenant_id', tenantId).gte('breach_date', firstDay).lte('breach_date', lastDay),
  ]);

  const crew = (crewRes.data || []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.display_name || m.profiles?.full_name || 'Unknown',
    role: m.role?.name || m.custom_role?.name || null,
    department: m.departments?.name || '',
    departmentId: m.department_id || null,
    departmentColor: m.departments?.color || '#5F5E5A',
  }));

  const windowShifts = (shiftRes.data || []).map((s) => ({
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

  const workEntries = weRes.data || [];

  const ve = veRes.data || {};
  const tn = tnRes.data || {};
  const horDayBasis = ve.hor_day_basis || 'calendar';
  const operationalDayStartHour = ve.operational_day_start_hour ?? 6;
  const dayStartHour = dayStartHourFor(horDayBasis, operationalDayStartHour);

  const mergedShifts = mergeWorkEntriesIntoShifts(crew, windowShifts, workEntries);
  const framedShifts = frameShifts(mergedShifts, dayStartHour);
  const rows = buildRestLogRows(crew, days, framedShifts);

  const meta = buildRestLogMeta({
    vesselName: ve.name ?? null,
    imoNumber: ve.imo_number ?? tn.imo_number ?? null,
    flagState: ve.flag ?? tn.flag ?? null,
    portOfRegistry: ve.port_of_registry ?? tn.port_of_registry ?? null,
    departmentName: null,
    periodLabel: `${MONTH_NAMES[mi]} ${year}`,
    period: 'month',
    crew,
    dayStartHour,
  });

  const breachReasons = {};
  (brRes.data || []).forEach((r) => {
    breachReasons[`${r.subject_user_id}|${String(r.breach_date).slice(0, 10)}`] = r;
  });

  // Clamp an in-progress month to today (no-op for a fully past month).
  const realToday = toYmd(new Date());
  const clamped = clampExportToToday({ rows, days, meta, periodLabel: meta.periodLabel, realToday });

  // The captured sign-off signatures, when this pack is the signed record sent
  // to management (the on-screen rota export leaves the lines blank for wet ink).
  let signatures = {};
  if (withSignatures) {
    try { signatures = await buildSignaturesForMonth({ tenantId, year, mi }); }
    catch (e) { console.warn('[HOR] signature load failed', e); }
  }

  return { ...clamped, windowShifts: mergedShifts, breachReasons, signatures };
}
