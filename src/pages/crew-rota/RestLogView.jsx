import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import RotaBreachReasonModal from './RotaBreachReasonModal';
import { DEPT_ORDER, MlcTriangle } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import { ON_DUTY_TYPES, assessMlc, reframeToOperationalDay, MLC_DAILY_REST_MIN, MLC_WEEKLY_REST_MIN } from './restHours';
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

function Cell({ cell, isToday, onClick, ariaLabel }) {
  const weekend = isWeekend(cell.date);
  const cls = ['rl-c'];
  if (cell.isOff) cls.push('off'); else cls.push('f');
  if (weekend && cell.isOff) cls.push('sat');
  if (cell.dailyLow) cls.push('is-warn');
  if (isToday) cls.push('is-today-col');
  return (
    <button type="button" className={cls.join(' ')} onClick={onClick} aria-label={ariaLabel}>
      {cell.isOff ? (
        <span className="rl-c-off">off</span>
      ) : (
        <span className="rl-c-rest">
          {fmtRest(cell.rest24h)}
          {cell.dailyLow && <MlcTriangle size={9} />}
        </span>
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
  tenantId = null,
  canSignOff = false,
  onReasonsSaved,
  horDayBasis = 'calendar',
  operationalDayStartHour = 0,
  onCellClick,
}) {
  const wrapRef = useRef(null);
  const [showBreachModal, setShowBreachModal] = useState(false);

  // The 24h "day" anchor for the daily-rest rule: 0 (midnight) for the classic
  // calendar basis, the vessel's operational day-start when opted in. Reframing
  // the shifts by this offset lets the existing rules assess the operational day.
  const dayStartHour = horDayBasis === 'operational' ? (operationalDayStartHour || 0) : 0;
  const framedShifts = useMemo(
    () => reframeToOperationalDay(windowShifts, dayStartHour),
    [windowShifts, dayStartHour],
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
    // userId -> display name, so the PDF can attribute each recorded reason.
    crewNames: Object.fromEntries((crew || []).filter((c) => c.userId).map((c) => [c.userId, c.name])),
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

  if (days.length === 0) return null;

  return (
    <div className="rl-card">
      {canSignOff && unjustifiedBreaches.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          margin: '0 0 10px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D',
          fontSize: 13, fontWeight: 500,
        }}>
          <AlertTriangle size={16} />
          <span style={{ flex: 1 }}>
            {unjustifiedBreaches.length} planned breach day{unjustifiedBreaches.length === 1 ? '' : 's'} need a reason for the record.
          </span>
          <button type="button" className="crew-rota-pill" onClick={() => setShowBreachModal(true)}>
            Record &amp; sign off
          </button>
        </div>
      )}
      {showBreachModal && (
        <RotaBreachReasonModal
          isOpen={showBreachModal}
          onClose={() => setShowBreachModal(false)}
          tenantId={tenantId}
          breaches={unjustifiedBreaches}
          onSaved={onReasonsSaved}
        />
      )}
      <div className="rl-toolbar">
        <div className="rl-legend">
          <span className="rl-legend-item"><span className="rl-sw rl-sw-ok" /> ≥{MLC_DAILY_REST_MIN}h daily rest</span>
          <span className="rl-legend-item"><span className="rl-sw rl-sw-warn" /> below MLC minimum</span>
          <span className="rl-legend-item"><span className="rl-sw rl-sw-off" /> off duty</span>
        </div>
        <div className="rl-actions">
          <button
            type="button"
            className="crew-rota-pill"
            onClick={() => exportRestLogCSV({ rows, days, meta })}
            title="Export the log as a CSV (spreadsheet)"
          ><Download size={12} /> CSV</button>
          <button
            type="button"
            className="crew-rota-pill"
            onClick={() => exportRestLogPDF({ rows, days, meta, windowShifts, breachReasons })}
            title="Export the MLC/IMO-ILO Record of Hours of Rest (PDF)"
          ><Download size={12} /> PDF</button>
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
                          onClick={() => onCellClick?.(c.date)}
                          ariaLabel={`${m.name} on ${c.date}: ${c.isOff ? 'off duty' : `${fmtRest(c.rest24h)} rest`}`}
                        />
                      ))}
                      <div className={`rl-sum${totalBreaches > 0 ? ' has-breach' : ''}`}>
                        {totalBreaches === 0 ? (
                          <span className="rl-sum-ok">✓</span>
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
