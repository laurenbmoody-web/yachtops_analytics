// useRotaRestData — rest-panel data for one crew member, computed from
// their last 7 days of rota_shifts.
//
// Returns a shape compatible with what RestPanelPopover already reads
// (the old MOCK_REST_DATA entry): timeline / weekChart / labels /
// banner prose / *Meta / *Summary. The shift-type breakdown is now computed
// live from the loaded 7-day window; trip-scoped totals + AI suggestions
// remain later steps (trip + AI engine).

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hhmmToDecimal } from './useRotaShifts';
import { ON_DUTY_TYPES, assessMlc, restForWeek } from './restHours';
import { blockHours } from './coverageEngine';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Add n days to a 'YYYY-MM-DD' string using LOCAL date components — never
// round-trips through toISOString (UTC), which would drift a day in
// negative-offset timezones and desync the chart window from the headline.
function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}

// DB rows arrive snake_case; the shared MLC utility expects camelCase.
function toCamelShift(s) {
  return {
    date: s.shift_date,
    startTime: s.start_time,
    endTime: s.end_time,
    shiftType: s.shift_type,
    subType: s.sub_type,
  };
}

function fmtHours(decimal) {
  if (decimal == null) return '—';
  const total = Math.max(0, Math.round(decimal * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function shiftHours(s) {
  let start = hhmmToDecimal(s.start_time);
  let end = hhmmToDecimal(s.end_time);
  if (start == null || end == null) return 0;
  if (end <= start) end += 24;
  return end - start;
}

function subLabel(s) {
  if (s.sub_type) return `${s.shift_type} · ${s.sub_type}`;
  if (s.notes) return s.notes;
  return `${s.shift_type} · service`;
}

// Apply an AI-proposed change to a set of snake_case shift rows, returning a
// modified copy. The model identifies the target block by date + start time;
// 'remove' drops it, 'shorten'/'shift' rewrite its times. Used purely to
// RECOMPUTE rest deltas — it never writes to the DB.
function applyChange(rows, change) {
  if (!change || !change.shift_date) return rows;
  const targetHH = (change.original_start || '').slice(0, 5);
  return rows.flatMap(r => {
    const isTarget = r.shift_date === change.shift_date
      && ON_DUTY_TYPES.has(r.shift_type)
      && (!targetHH || (r.start_time || '').slice(0, 5) === targetHH);
    if (!isTarget) return [r];
    if (change.action === 'remove') return [];
    return [{ ...r, start_time: change.new_start || r.start_time, end_time: change.new_end || r.end_time }];
  });
}

function effect(name, fromH, toH, minH) {
  const ok = (h) => h >= minH;
  return {
    name,
    from: fmtHours(fromH),
    to: fmtHours(toH),
    fromColor: ok(fromH) ? '#2D5A3A' : '#7A2E1E',
    toColor: ok(toH) ? '#2D5A3A' : '#7A2E1E',
    note: ok(toH) ? 'now compliant' : `${fmtHours(Math.max(0, minH - toH))} short`,
    noteColor: ok(toH) ? '#2D5A3A' : '#7A2E1E',
  };
}

// Turn one AI suggestion into the shape RestPanelPopover renders, computing the
// real rest deltas by applying the proposed change and re-running assessMlc.
//
// Weekly rest is FORWARD-LOOKING: a past 7-day deficit can't be undone, so a
// change is evaluated on the rolling 7-day window it actually lands in (the
// change's own date for future edits), then compared to the current trailing
// total — i.e. "where the rolling figure gets to once you make this change".
function enrichSuggestion(sg, ctx) {
  const { todayRows, allRows, effDate, rest24h, pastWeekHours, dailyBelow, weeklyBelow } = ctx;
  const change = sg.change || null;

  // Daily-rest effect only when the change lands on the assessed day.
  const changeIsToday = change && change.shift_date === effDate;
  const newToday = changeIsToday ? applyChange(todayRows, change) : todayRows;
  const repToday = assessMlc({ dayShifts: newToday.map(toCamelShift), weekShifts: [] });

  // Rolling 7-day window at the change's date (future edits pay off the day
  // they land), with the change applied.
  const evalDate = change?.shift_date && change.shift_date > effDate ? change.shift_date : effDate;
  const winStart = addDays(evalDate, -6);
  const winRows = allRows.filter(s => s.shift_date >= winStart && s.shift_date <= evalDate);
  const afterWeek = assessMlc({ dayShifts: [], weekShifts: applyChange(winRows, change).map(toCamelShift) }).pastWeekHours;

  const effects = [];
  if (dailyBelow && changeIsToday) effects.push(effect('Daily rest', rest24h, repToday.rest24h, 10));
  if (weeklyBelow) {
    const ok = afterWeek >= 77;
    const future = evalDate > effDate;
    const wd = new Date(`${evalDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
    effects.push({
      name: 'Rolling 7-day rest',
      from: fmtHours(pastWeekHours),
      to: fmtHours(afterWeek),
      fromColor: pastWeekHours >= 77 ? '#2D5A3A' : '#7A2E1E',
      toColor: ok ? '#2D5A3A' : '#7A2E1E',
      note: ok ? (future ? `compliant by ${wd}` : 'now compliant') : `still ${fmtHours(Math.max(0, 77 - afterWeek))} short`,
      noteColor: ok ? '#2D5A3A' : '#7A2E1E',
    });
  }
  if (!dailyBelow && !weeklyBelow) {
    effects.push({
      name: 'Rest pattern',
      to: repToday.anyBreach ? 'still breached' : 'compliant',
      toColor: repToday.anyBreach ? '#7A2E1E' : '#2D5A3A',
      note: repToday.anyBreach ? 'needs another change' : 'splits within MLC',
      noteColor: repToday.anyBreach ? '#7A2E1E' : '#2D5A3A',
    });
  }

  return {
    type: sg.confidence === 'high' ? 'confident' : 'judgment',
    pill: sg.confidence === 'high' ? 'High confidence' : 'Judgement call',
    headline: sg.headline,
    body: sg.body,
    effects,
    // Structured change + the block of hours it frees, so the panel can hand
    // off to the coverage flow instead of making the chief edit by hand.
    change,
    freedBlock: computeFreed(change, allRows),
    primaryAction: change ? 'Apply to grid' : 'Adjust in grid',
    secondaryAction: 'Dismiss',
  };
}

// Resolve the actual rota_shifts block a change touches and the hours it frees.
// `remove` frees the whole block; `shorten` frees the trimmed-off portion and
// records the kept remainder so the source keeps a (shorter) shift.
function computeFreed(change, allRows) {
  if (!change || !change.shift_date) return null;
  const targetHH = (change.original_start || '').slice(0, 5);
  const src = (allRows || []).find(r => r.shift_date === change.shift_date
    && ON_DUTY_TYPES.has(r.shift_type)
    && (r.start_time || '').slice(0, 5) === targetHH);
  if (!src) return null;
  const sStart = (src.start_time || '').slice(0, 5);
  const sEnd = (src.end_time || '').slice(0, 5);
  const base = {
    date: change.shift_date,
    sourceShiftId: src.id,
    sourceShiftType: src.shift_type,
    sourceSubType: src.sub_type ?? null,
  };
  if (change.action !== 'shorten') {
    return { ...base, action: 'remove', start: sStart, end: sEnd, hours: blockHours(sStart, sEnd) };
  }
  // Shorten: kept = [new_start, new_end]; the freed slice is whatever the trim
  // removes (a suffix trim if the start is unchanged, else a prefix trim).
  const kStart = (change.new_start || sStart).slice(0, 5);
  const kEnd = (change.new_end || sEnd).slice(0, 5);
  const freedStart = kStart === sStart ? kEnd : sStart;
  const freedEnd = kStart === sStart ? sEnd : kStart;
  return {
    ...base,
    action: 'shorten',
    keep: { start: kStart, end: kEnd },
    start: freedStart,
    end: freedEnd,
    hours: blockHours(freedStart, freedEnd),
  };
}

// Friendly label per on-duty shift type.
const TYPE_LABELS = { duty: 'Duty', watch: 'Watch', standby: 'Standby', training: 'Training' };

export function useRotaRestData(memberId, crewName = null, crewRole = null, crewDept = null, anchorDate = null) {
  // AuthContext exposes `activeTenantId`, not `tenantId`.
  const { user, activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // AI rest suggestions (hybrid: model proposes the change, we compute deltas).
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user || !tenantId || !memberId) { setData(null); setSuggestions([]); return undefined; }

    setLoading(true);
    setError(null);
    setSuggestions([]);

    (async () => {
      try {
        // Anchor the 7-day window on the date the rota page is VIEWING (passed
        // in), so the panel always reflects the same week as the grid/list. A
        // member with future-dated shifts must NOT pull a future week here —
        // that's what made the panel disagree with the row's MLC verdict.
        const localToday = (() => {
          const d = new Date();
          const p = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        })();
        const effDate = anchorDate || localToday;

        // Fetch 13 trailing days (so each charted day has a full trailing
        // 7-day window behind it) plus 7 forward days, so a suggestion that
        // changes a FUTURE day can be evaluated on the rolling window it lands in.
        const fetchStartStr = addDays(effDate, -12);
        const fetchEndStr = addDays(effDate, 7);
        const weekStartStr = addDays(effDate, -6);

        const { data: rows, error: sErr } = await supabase
          .from('rota_shifts')
          .select('id, shift_date, start_time, end_time, shift_type, sub_type, notes')
          .eq('tenant_id', tenantId)
          .eq('member_id', memberId)
          .gte('shift_date', fetchStartStr)
          .lte('shift_date', fetchEndStr)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true });
        if (sErr) throw sErr;
        if (cancelled) return;

        const all = rows ?? [];
        const todayRows = all.filter(s => s.shift_date === effDate);
        // The trailing 7 days drive the MLC weekly assessment + breakdown.
        // Forward rows are kept in `all` for suggestion deltas only.
        const weekRows = all.filter(s => s.shift_date >= weekStartStr && s.shift_date <= effDate);
        const offToday = todayRows.length > 0 && todayRows.every(s => s.shift_type === 'off');

        // Shared MLC assessment — totals stay identical to the prior
        // inline math; rules 3 + 4 are now also reflected in mlcWarning.
        const mlcReport = assessMlc({
          dayShifts: todayRows.map(toCamelShift),
          weekShifts: weekRows.map(toCamelShift),
        });
        const onDutyToday = mlcReport.onDutyToday;
        const rest24h = mlcReport.rest24h;
        const pastWeekHours = mlcReport.pastWeekHours;
        const dailyBelow = rest24h < 10;
        const weeklyBelow = pastWeekHours < 77;
        const mlcWarning = !offToday && mlcReport.anyBreach;

        // ── 24h timeline: rest gaps + on-duty blocks across the day ──
        const onDutySorted = todayRows
          .filter(s => ON_DUTY_TYPES.has(s.shift_type))
          .map(s => ({
            start: hhmmToDecimal(s.start_time),
            end: (() => { let e = hhmmToDecimal(s.end_time); const st = hhmmToDecimal(s.start_time); if (e != null && st != null && e <= st) e += 24; return e; })(),
            label: subLabel(s),
          }))
          .filter(s => s.start != null && s.end != null)
          .sort((a, b) => a.start - b.start);

        const timeline = [];
        if (offToday || onDutySorted.length === 0) {
          timeline.push({ label: '24h off duty', sub: 'no shifts today', flex: 24, type: 'rest' });
        } else {
          let cursor = 0;
          for (const blk of onDutySorted) {
            if (blk.start > cursor) {
              timeline.push({
                label: `${fmtHours(blk.start - cursor)} rest`,
                sub: `${String(Math.floor(cursor)).padStart(2, '0')}:00 — ${String(Math.floor(blk.start)).padStart(2, '0')}:00`,
                flex: blk.start - cursor,
                type: 'rest',
              });
            }
            timeline.push({
              label: `${fmtHours(blk.end - blk.start)} on duty`,
              sub: blk.label,
              flex: blk.end - blk.start,
              type: 'on',
            });
            cursor = Math.max(cursor, blk.end);
          }
          if (cursor < 24) {
            timeline.push({
              label: `${fmtHours(24 - cursor)} rest`,
              sub: 'remaining',
              flex: 24 - cursor,
              type: 'rest',
            });
          }
        }

        // ── Rolling 7-day rest chart: each bar is the trailing-7-day rest
        //    total AS OF that day (evolving toward today's total, which equals
        //    the headline pastWeekHours). Same restForWeek basis as the
        //    headline so the last bar and the headline always agree. ──
        const weekChart = [];
        for (let i = 6; i >= 0; i -= 1) {
          const ds = addDays(effDate, -i);
          const winStartStr = addDays(ds, -6);
          const winRows = all.filter(s => s.shift_date >= winStartStr && s.shift_date <= ds);
          const rollingRest = restForWeek(winRows.map(toCamelShift)).pastWeekHours;
          weekChart.push({
            day: weekdayOf(ds),
            date: ds,
            hours: Math.round(rollingRest),
            status: rollingRest >= 77 ? 'ok' : 'low',
            isToday: ds === effDate,
          });
        }

        // ── Shift-type breakdown over the loaded 7-day window (real data;
        //    trip-scoped totals arrive with trip integration later) ──
        const typeHours = {};
        const typeCount = {};
        for (const s of weekRows) {
          if (!ON_DUTY_TYPES.has(s.shift_type)) continue;
          typeHours[s.shift_type] = (typeHours[s.shift_type] || 0) + shiftHours(s);
          typeCount[s.shift_type] = (typeCount[s.shift_type] || 0) + 1;
        }
        const typeKeys = ['duty', 'watch', 'standby', ...(typeHours.training ? ['training'] : [])];
        const tripStats = typeKeys.map(t => ({
          num: fmtHours(typeHours[t] || 0),
          label: TYPE_LABELS[t],
          sub: typeCount[t] ? `${typeCount[t]} shift${typeCount[t] > 1 ? 's' : ''}` : 'none rostered',
        }));
        const daysWorked = new Set(
          weekRows.filter(s => ON_DUTY_TYPES.has(s.shift_type)).map(s => s.shift_date),
        ).size;

        const banner = mlcWarning
          ? (() => {
              if (dailyBelow && weeklyBelow) {
                return {
                  headline: 'Rest is below MLC <em>daily and weekly</em>.',
                  body: `Daily rest is <strong>${fmtHours(rest24h)}</strong> against the 10h minimum, and the rolling 7-day total is <strong>${fmtHours(pastWeekHours)}</strong> against the 77h weekly minimum. Both need recovery before the next shift.`,
                };
              }
              if (dailyBelow) {
                return {
                  headline: 'Daily rest is <em>below the 10-hour MLC minimum</em>.',
                  body: `The last 24 hours show <strong>${fmtHours(rest24h)}</strong> of rest. MLC requires 10 hours in any 24-hour window. The next shift cannot start until the daily minimum is recoverable.`,
                };
              }
              if (weeklyBelow) {
                return {
                  headline: 'Weekly rest is <em>below the 77-hour MLC minimum</em>.',
                  body: `The rolling 7-day rest total is <strong>${fmtHours(pastWeekHours)}</strong> against the 77h weekly minimum. The cumulative shortfall needs reducing over the coming days.`,
                };
              }
              // Structural breach only — daily/weekly totals are fine but
              // rule 3 (period split) or rule 4 (14h stretch) is broken.
              const breachLabels = mlcReport.breaches.map(b => b.label).join(' · ');
              return {
                headline: 'Rest pattern <em>breaches MLC structural rules</em>.',
                body: `Daily and weekly totals are within MLC, but rest does not split as required: ${breachLabels}.`,
              };
            })()
          : { headline: null, body: null };

        if (cancelled) return;
        setData({
          mlcWarning,
          mlcChip: mlcWarning
            ? (dailyBelow && weeklyBelow
                ? 'Below MLC daily & weekly'
                : dailyBelow
                  ? 'Below MLC daily'
                  : weeklyBelow
                    ? 'Below MLC weekly'
                    : 'Below MLC rest pattern')
            : null,
          offToday,
          rest24hLabel: offToday ? 'Off duty today' : `${fmtHours(rest24h)} rest`,
          pastWeekLabel: `Past week ${fmtHours(pastWeekHours)}`,
          // Numeric figures + breach flags drive the per-section MLC tags.
          weeklyHours: Math.round(pastWeekHours),
          weeklyBelow,
          dailyHours: Math.round(rest24h),
          dailyBelow,
          // Structural rules, scoped to the right section:
          //  · rest_period_split is assessed on TODAY's shifts → Daily section.
          //  · max_work_stretch_14h is assessed over the 7-day window → Weekly.
          splitBreach: mlcReport.breaches.some(b => b.rule === 'rest_period_split'),
          stretchBreach: mlcReport.breaches.some(b => b.rule === 'max_work_stretch_14h'),
          bannerHeadline: banner.headline,
          bannerBody: banner.body,
          timelineMeta: 'Today · 00:00 → 24:00',
          timelineStart: '00:00',
          timelineEnd: '24:00',
          timelineSummary: offToday
            ? '24h off duty · no shifts today'
            : `${fmtHours(rest24h)} rest · ${fmtHours(onDutyToday)} on duty`,
          timeline,
          chartMeta: 'Rolling 7d rest · evolving by day',
          chartSummary: `${Math.round(pastWeekHours)}h projected by tonight`,
          chartShort: weeklyBelow ? `${Math.round(77 - pastWeekHours)}h short` : null,
          chartShortOf: weeklyBelow ? '77h weekly minimum' : null,
          weekChart,
          tripMeta: 'Shift breakdown · last 7 days',
          tripStats,
          onDutyWeekLabel: fmtHours(mlcReport.onDutyWeek),
          daysWorked,
        });

        // ── AI rest suggestions (hybrid: model proposes the change, we
        //    recompute the real before→after deltas with assessMlc) ──
        if (mlcWarning) {
          setSuggestionsLoading(true);
          try {
            const blocks = todayRows
              .filter(s => ON_DUTY_TYPES.has(s.shift_type))
              .map(s => ({ start: (s.start_time || '').slice(0, 5), end: (s.end_time || '').slice(0, 5), type: s.shift_type }));
            const weekDays = [];
            for (let i = 6; i >= 0; i -= 1) {
              const ds = addDays(effDate, -i);
              const onD = weekRows
                .filter(s => s.shift_date === ds && ON_DUTY_TYPES.has(s.shift_type))
                .reduce((a, s) => a + shiftHours(s), 0);
              weekDays.push({ date: ds, on_duty_hours: Math.round(onD), rest_hours: Math.round(Math.max(0, 24 - onD)) });
            }
            const { data: aiRes } = await supabase.functions.invoke('generate-rest-insights', {
              body: {
                member: { name: crewName || 'This crew member', role: crewRole, department: crewDept },
                breaches: mlcReport.breaches.map(b => ({ rule: b.rule, label: b.label })),
                today: { date: effDate, rest_hours: Math.round(rest24h), on_duty_hours: Math.round(onDutyToday), blocks },
                week: { rest_hours: Math.round(pastWeekHours), days: weekDays },
              },
            });
            if (cancelled) return;
            const rawSuggestions = Array.isArray(aiRes?.suggestions) ? aiRes.suggestions : [];
            const enriched = rawSuggestions.map(sg => enrichSuggestion(sg, {
              todayRows, allRows: all, effDate, rest24h, pastWeekHours, dailyBelow, weeklyBelow,
            }));
            if (!cancelled) setSuggestions(enriched);
          } catch (aiErr) {
            // AI is best-effort — never break the panel if it fails.
            if (!cancelled) setSuggestions([]);
          } finally {
            if (!cancelled) setSuggestionsLoading(false);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, tenantId, memberId, crewName, crewRole, crewDept, anchorDate]);

  return { data, loading, error, suggestions, suggestionsLoading };
}
