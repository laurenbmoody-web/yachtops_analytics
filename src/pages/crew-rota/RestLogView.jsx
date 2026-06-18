import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import RotaBreachReasonModal from './RotaBreachReasonModal';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { ON_DUTY_TYPES, assessMlc, reframeToOperationalDay, workEntriesToShifts, mergeLoggedOverPlan, MLC_DAILY_REST_MIN, MLC_WEEKLY_REST_MIN } from './restHours';
import { getContrastText, getRoleDisplayName } from './crewDisplay';
import { MONTH_SHORT } from './MonthCalendar';
import { exportRestLogCSV, exportRestLogPDF } from './rotaHorExport';

// RestLogView — the rota page's "Hours of rest log" (audit) view.
//
// A crew × N-day compliance matrix focused on REST hours (not shift ranges
// like the Week matrix). Each cell shows the daily rest figure, flagged when
// it breaches the MLC daily minimum; the trailing summary column counts the
// member's breach days across the period. The whole table exports to CSV and
// PDF for auditing (see rotaHorExport).
//
// Period (week | month) and the day columns are decided by the parent
// (RotaWorkspace) so the same selectedDate + stepper drive both the fetch
// window and these columns. windowShifts already carries a ≥6-day lead-in
// before the first column, so each cell's rolling-7-day weekly rest is
// accurate from day one.
//
// Visual language mirrors the Week matrix (dept colour spine, sticky name
// column, navy/cream cells) — month mode swaps 1fr columns for fixed-width
// ones so a 31-day period scrolls horizontally rather than crushing.

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) { return String(n).padStart(2, '0'); }
function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtRest(decimal) {
  if (decimal == null) return '—';
  const total = Math.max(0, Math.round(decimal * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${pad2(m)}`;
}
function isWeekend(dateStr) {
  const w = parseLocal(dateStr).getDay();
  return w === 0 || w === 6;
}

// Per (member, day) rest summary. Trailing-7 weekly rest is sliced from the
// parent windowShifts — identical method to the Week matrix's cellSummary,
// but surfacing the daily + weekly breach flags the audit log keys on.
function computeCell(memberId, dateStr, windowShifts) {
  const dayShifts = windowShifts.filter((s) => s.memberId === memberId && s.date === dateStr);
  const weekStart = (() => {
    const d = parseLocal(dateStr);
    d.setDate(d.getDate() - 6);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();
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
    // "Marginal" = met the 10h floor but with under an hour to spare, i.e. ~14h
    // on duty — right at the max-work-stretch limit too. Surfaced in amber.
    marginal: !isOff && mlc.rest24h >= MLC_DAILY_REST_MIN && mlc.rest24h < MLC_DAILY_REST_MIN + 1,
    weeklyLow: mlc.pastWeekHours < MLC_WEEKLY_REST_MIN,
  };
}

function DayHeader({ dateStr, index, isToday }) {
  const d = parseLocal(dateStr);
  const weekend = isWeekend(dateStr);
  const showMon = d.getDate() === 1 || index === 0;
  const cls = ['rl-day-head'];
  if (isToday) cls.push('is-today');
  if (weekend) cls.push('is-weekend');
  return (
    <div className={cls.join(' ')} data-rl-date={dateStr}>
      <div className="rl-day-head-dow">{WEEKDAY_SHORT[d.getDay()]}</div>
      <div className="rl-day-head-num">{d.getDate()}</div>
      <div className="rl-day-head-mon">{showMon ? MONTH_SHORT[d.getMonth()] : ' '}</div>
    </div>
  );
}

const hhmmToDec = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60; };
const nextDateStr = (dateStr) => { const d = parseLocal(dateStr); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// Calendar basis: split any shift running past midnight into a start-day part
// (…→24:00) and a next-day part (00:00→…), so each calendar day is credited only
// the on-duty hours that physically fall on it. This makes a PLANNED overnight
// rota shift attribute the same way logged actuals and the crew profile already
// do (logged work_segments are stored per-day, so they are split by
// construction). Operational basis reconciles overnight work via
// reframeToOperationalDay, so it is left untouched there.
const splitAtMidnight = (shifts) => {
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

function Cell({ cell, isToday, isFuture, onClick, ariaLabel }) {
  const weekend = isWeekend(cell.date);
  const cls = ['rl-c'];
  if (cell.isOff) cls.push('off'); else cls.push('f');
  if (weekend && cell.isOff) cls.push('sat');
  if (cell.dailyLow) cls.push('is-warn');
  else if (cell.marginal) cls.push('is-marginal');
  if (isToday) cls.push('is-today-col');
  if (isFuture) cls.push('is-future');
  return (
    <button type="button" className={cls.join(' ')} onClick={onClick} aria-label={ariaLabel}>
      {cell.isOff ? (
        <span className="rl-c-off">·</span>
      ) : (
        <span className="rl-c-rest">{fmtRest(cell.rest24h)}</span>
      )}
    </button>
  );
}

export default function RestLogView({
  crew = [],
  windowShifts = [],
  days = [],
  period = 'month',
  realToday,
  vesselName = null,
  imoNumber = null,
  flagState = null,
  portOfRegistry = null,
  periodLabel = '',
  departmentName = null,
  breachReasons = {},
  workEntries = [],
  tenantId = null,
  canSignOff = false,
  onReasonsSaved,
  horDayBasis = 'calendar',
  operationalDayStartHour = 0,
  onCellClick,
}) {
  const wrapRef = useRef(null);
  const [showBreachModal, setShowBreachModal] = useState(false);
  // When set, the breach-reason modal is scoped to (and pre-expanded on) one
  // crew member — driven by clicking their badge in the BREACHES column.
  const [breachFilterUserId, setBreachFilterUserId] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef(null);

  // Close the Export menu on an outside click or Escape.
  useEffect(() => {
    if (!showExport) return undefined;
    const onDocClick = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setShowExport(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowExport(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [showExport]);

  // Overlay the crew's logged actuals onto the rota plan: any day a crew member
  // has logged is the truth, so drop the rota shifts for that member-day and use
  // the logged ones instead. The rota fills only the un-logged gaps.
  const userToMember = useMemo(
    () => new Map((crew || []).filter((c) => c.userId).map((c) => [c.userId, c.id])),
    [crew],
  );
  const { loggedShifts, loggedDays } = useMemo(
    () => workEntriesToShifts(workEntries, userToMember),
    [workEntries, userToMember],
  );
  const mergedShifts = useMemo(
    () => mergeLoggedOverPlan(windowShifts, loggedShifts, loggedDays),
    [windowShifts, loggedShifts, loggedDays],
  );

  // The 24h "day" anchor for the daily-rest rule: 0 (midnight) for the classic
  // calendar basis, the vessel's operational day-start when opted in. Reframing
  // the shifts by this offset lets the existing rules assess the operational day.
  const dayStartHour = horDayBasis === 'operational' ? (operationalDayStartHour || 0) : 0;
  const framedShifts = useMemo(
    () => (dayStartHour
      ? reframeToOperationalDay(mergedShifts, dayStartHour)
      : splitAtMidnight(mergedShifts)),
    [mergedShifts, dayStartHour],
  );
  const basisLabel = dayStartHour
    ? `Rest assessed on a 24-hour day commencing ${String(dayStartHour).padStart(2, '0')}:00`
    : 'Rest assessed on a calendar day (00:00–24:00)';

  // Dept-grouped rows with per-cell rest + per-member breach tallies. One pass
  // feeds both the rendered matrix and the exports (same source, same order).
  const rows = useMemo(() => {
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
        };
      });
      return { dept, color: byDept.get(dept)[0]?.departmentColor || '#5F5E5A', members };
    });
  }, [crew, days, framedShifts]);

  // Land the scroll on today when it falls in the period, else the start.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (days.includes(realToday)) {
      const el = wrap.querySelector(`[data-rl-date="${realToday}"]`);
      const spacer = wrap.querySelector('.rl-head-spacer');
      const offset = spacer ? spacer.offsetWidth : 0;
      if (el) { wrap.scrollLeft = Math.max(0, el.offsetLeft - offset); return; }
    }
    wrap.scrollLeft = 0;
  }, [days, realToday, period]);

  const meta = useMemo(() => ({
    vesselName,
    imoNumber,
    flagState,
    portOfRegistry,
    departmentName,
    periodLabel,
    period,
    // userId -> name / role, so the PDF can attribute each recorded reason.
    crewNames: Object.fromEntries((crew || []).filter((c) => c.userId).map((c) => [c.userId, c.name])),
    crewRoles: Object.fromEntries((crew || []).filter((c) => c.userId).map((c) => [c.userId, getRoleDisplayName(c.role)])),
    horDayStartHour: dayStartHour, // 0 = calendar; >0 = operational anchor
    basisLabel,
    generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
  }), [vesselName, imoNumber, flagState, portOfRegistry, departmentName, periodLabel, period, crew, dayStartHour, basisLabel]);

  // Planned breach days with no recorded reason yet — what a chief/command is
  // prompted to justify (and thereby sign off) at the rota stage.
  const unjustifiedBreaches = useMemo(() => {
    const out = [];
    rows.forEach((r) => r.members.forEach((m) => {
      if (!m.userId) return;
      m.cells.forEach((c) => {
        if (!c.dailyLow && !c.weeklyLow) return;
        if (breachReasons[`${m.userId}|${c.date}`]) return; // already explained
        const types = [];
        const labels = [];
        if (c.dailyLow) { types.push('daily_rest_10h'); labels.push('Daily'); }
        if (c.weeklyLow) { types.push('weekly_rest_77h'); labels.push('Weekly'); }
        out.push({
          key: `${m.userId}|${c.date}`,
          userId: m.userId,
          name: m.name,
          role: m.role,
          date: c.date,
          dateLabel: parseLocal(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
          breachLabel: labels.join(' + '),
          breachTypes: types,
        });
      });
    }));
    return out;
  }, [rows, breachReasons]);

  // EVERY breach day (justified or not), carrying any recorded reason + sign-off
  // state — powers the per-crew drill-in from the BREACHES badge, so already
  // explained days are shown read-only alongside any still outstanding.
  const allBreaches = useMemo(() => {
    const out = [];
    rows.forEach((r) => r.members.forEach((m) => {
      if (!m.userId) return;
      m.cells.forEach((c) => {
        if (!c.dailyLow && !c.weeklyLow) return;
        const types = [];
        const labels = [];
        if (c.dailyLow) { types.push('daily_rest_10h'); labels.push('Daily'); }
        if (c.weeklyLow) { types.push('weekly_rest_77h'); labels.push('Weekly'); }
        const rec = breachReasons[`${m.userId}|${c.date}`];
        out.push({
          key: `${m.userId}|${c.date}`,
          userId: m.userId,
          name: m.name,
          role: m.role,
          date: c.date,
          dateLabel: parseLocal(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
          breachLabel: labels.join(' + '),
          breachTypes: types,
          reason: rec?.note_text || null,
          signedOff: !!rec?.signed_off_at,
        });
      });
    }));
    return out;
  }, [rows, breachReasons]);

  // Fleet KPIs for the period (scoped to whoever's in view / the dept filter).
  const kpi = useMemo(() => {
    let onDuty = 0; let breach = 0; let marginal = 0;
    const breachCrew = new Set();
    rows.forEach((r) => r.members.forEach((m) => m.cells.forEach((c) => {
      if (c.isOff) return;
      onDuty += 1;
      if (c.dailyLow) { breach += 1; breachCrew.add(m.id); }
      else if (c.marginal) marginal += 1;
    })));
    return {
      breach,
      marginal,
      breachCrew: breachCrew.size,
      rate: onDuty ? Math.round(((onDuty - breach) / onDuty) * 100) : 100,
    };
  }, [rows]);

  // Exports are the signed RECORD: for an in-progress period, clamp to today so
  // we never assert not-yet-elapsed (still editable) days as fact. Past periods
  // export whole. Tallies + period label follow the clamp.
  const buildExport = () => {
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
          };
        }),
      }))
      : rows;
    const label = (clamped && ed.length)
      ? `${periodLabel} (to ${parseLocal(ed[ed.length - 1]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`
      : periodLabel;
    return { days: ed, rows: er, meta: { ...meta, periodLabel: label }, empty: ed.length === 0 };
  };
  const runExport = (fn) => {
    const e = buildExport();
    if (e.empty) { window.alert('This period hasn’t started yet — there’s nothing to record.'); return; }
    fn(e);
  };

  if (days.length === 0) return null;

  return (
    <div className="rl-card">
      <div className="rl-kpis">
        <div className="rl-kpi rl-kpi-green">
          <div className="rl-kpi-n">{kpi.rate}%</div>
          <div className="rl-kpi-l">MLC compliance</div>
          <div className="rl-kpi-s">days with ≥{MLC_DAILY_REST_MIN}h rest</div>
        </div>
        <div className="rl-kpi rl-kpi-red">
          <div className="rl-kpi-n">{kpi.breach}</div>
          <div className="rl-kpi-l">Breach days</div>
          <div className="rl-kpi-s">{kpi.breachCrew} of {crew.length} crew</div>
        </div>
        <div className="rl-kpi rl-kpi-amber">
          <div className="rl-kpi-n">{kpi.marginal}</div>
          <div className="rl-kpi-l">Marginal days</div>
          <div className="rl-kpi-s">≤{MLC_DAILY_REST_MIN + 1}h — at the limit</div>
        </div>
        {canSignOff && unjustifiedBreaches.length > 0 ? (
          <button type="button" className="rl-kpi rl-kpi-red rl-kpi-action" onClick={() => setShowBreachModal(true)}>
            <div className="rl-kpi-n">{unjustifiedBreaches.length}</div>
            <div className="rl-kpi-l">Reasons outstanding</div>
            <div className="rl-kpi-s">record &amp; sign off →</div>
          </button>
        ) : (
          <div className="rl-kpi">
            <div className="rl-kpi-n">{unjustifiedBreaches.length}</div>
            <div className="rl-kpi-l">Reasons outstanding</div>
            <div className="rl-kpi-s">{unjustifiedBreaches.length === 0 ? 'all recorded' : 'awaiting sign-off'}</div>
          </div>
        )}
      </div>
      {showBreachModal && (
        <RotaBreachReasonModal
          isOpen={showBreachModal}
          onClose={() => { setShowBreachModal(false); setBreachFilterUserId(null); }}
          tenantId={tenantId}
          breaches={breachFilterUserId
            ? allBreaches.filter((b) => b.userId === breachFilterUserId)
            : unjustifiedBreaches}
          canEdit={canSignOff}
          initialExpandedUserId={breachFilterUserId}
          onSaved={onReasonsSaved}
        />
      )}
      <div className="rl-toolbar">
        <div className="rl-legend">
          <span className="rl-legend-item"><span className="rl-sw rl-sw-ok" /> compliant</span>
          <span className="rl-legend-item"><span className="rl-sw rl-sw-marg" /> borderline (≤{MLC_DAILY_REST_MIN + 1}h)</span>
          <span className="rl-legend-item"><span className="rl-sw rl-sw-warn" /> below {MLC_DAILY_REST_MIN}h</span>
        </div>
        <div className="rl-actions">
          <div className="rl-export" ref={exportRef}>
            <button
              type="button"
              className="crew-rota-pill"
              onClick={() => setShowExport((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showExport}
              title="Export the rest log"
            ><Download size={12} /> Export ▾</button>
            {showExport && (
              <div className="rl-export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowExport(false); runExport((e) => exportRestLogPDF({ rows: e.rows, days: e.days, meta: e.meta, windowShifts: mergedShifts, breachReasons })); }}
                >
                  <span className="rl-export-t">Record of Hours of Rest</span>
                  <span className="rl-export-s">MLC / IMO-ILO PDF — the compliance record</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowExport(false); runExport((e) => exportRestLogCSV({ rows: e.rows, days: e.days, meta: e.meta })); }}
                >
                  <span className="rl-export-t">Data (CSV)</span>
                  <span className="rl-export-s">Raw rest hours for spreadsheets / payroll</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rl-grid-wrap" ref={wrapRef}>
        <div
          className={`rl-grid-inner${period === 'month' ? ' is-month' : ''}`}
          style={{ '--rl-cols': days.length }}
        >
          <div className="rl-head-row">
            <div className="rl-head-spacer">Crew</div>
            {days.map((d, i) => (
              <DayHeader key={d} dateStr={d} index={i} isToday={d === realToday} />
            ))}
            <div className="rl-head-sum">Breaches</div>
          </div>

          {rows.map(({ dept, color, members }) => (
            <div key={dept} className="rl-dept-group">
              <div
                className="rl-dept-strip"
                style={{ background: color, color: getContrastText(color) }}
                role="rowheader"
                aria-label={`${dept} department`}
              >
                <span className="rl-dept-strip-text">{dept}</span>
              </div>
              <div className="rl-dept-rows">
                {members.map((m) => {
                  const totalBreaches = m.dailyBreachDays + m.weeklyBreachDays;
                  // Always drillable: approvers can record outstanding reasons,
                  // everyone can review which days breached and any recorded reason.
                  const canDrillBreach = totalBreaches > 0 && !!m.userId;
                  return (
                    <div key={m.id} className="rl-row">
                      <div className="rl-nm">
                        <div className="rl-nm-line">
                          <span className="rl-nm-name">{m.name}</span>
                          <span className="rl-dot" />
                          <span className="rl-role" title={m.role || ''}>{m.role}</span>
                        </div>
                      </div>
                      {m.cells.map((c) => (
                        <Cell
                          key={c.date}
                          cell={c}
                          isToday={c.date === realToday}
                          isFuture={realToday ? c.date > realToday : false}
                          onClick={() => onCellClick?.(c.date)}
                          ariaLabel={`${m.name} on ${c.date}: ${c.isOff ? 'off duty' : `${fmtRest(c.rest24h)} rest`}${realToday && c.date > realToday ? ' (planned)' : ''}`}
                        />
                      ))}
                      <div className={`rl-sum${totalBreaches > 0 ? ' has-breach' : ''}`}>
                        {totalBreaches === 0 ? (
                          <span className="rl-sum-ok">✓</span>
                        ) : canDrillBreach ? (
                          <button
                            type="button"
                            className="rl-sum-action"
                            title={`${m.dailyBreachDays} daily · ${m.weeklyBreachDays} weekly — click to see the days${canSignOff ? ' & record reasons' : ''}`}
                            onClick={() => { setBreachFilterUserId(m.userId); setShowBreachModal(true); }}
                          >
                            {totalBreaches}d
                          </button>
                        ) : (
                          <span className="rl-sum-count" title={`${m.dailyBreachDays} daily · ${m.weeklyBreachDays} weekly`}>
                            {totalBreaches}d
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
