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
import { ON_DUTY_TYPES, assessMlc } from './restHours';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// Friendly label per on-duty shift type.
const TYPE_LABELS = { duty: 'Duty', watch: 'Watch', standby: 'Standby', training: 'Training' };

export function useRotaRestData(memberId) {
  // AuthContext exposes `activeTenantId`, not `tenantId`.
  const { user, activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!user || !tenantId || !memberId) { setData(null); return undefined; }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Anchor the 7-day window on this member's most recent dated
        // shift (consistent with the grid's effective-date fallback).
        const { data: latest } = await supabase
          .from('rota_shifts')
          .select('shift_date')
          .eq('tenant_id', tenantId)
          .eq('member_id', memberId)
          .order('shift_date', { ascending: false })
          .limit(1);
        const effDate = (latest ?? [])[0]?.shift_date
          || new Date().toISOString().slice(0, 10);

        const windowStart = new Date(`${effDate}T00:00:00`);
        windowStart.setDate(windowStart.getDate() - 6);
        const windowStartStr = windowStart.toISOString().slice(0, 10);

        const { data: rows, error: sErr } = await supabase
          .from('rota_shifts')
          .select('id, shift_date, start_time, end_time, shift_type, sub_type, notes')
          .eq('tenant_id', tenantId)
          .eq('member_id', memberId)
          .gte('shift_date', windowStartStr)
          .lte('shift_date', effDate)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true });
        if (sErr) throw sErr;
        if (cancelled) return;

        const all = rows ?? [];
        const todayRows = all.filter(s => s.shift_date === effDate);
        const offToday = todayRows.length > 0 && todayRows.every(s => s.shift_type === 'off');

        // Shared MLC assessment — totals stay identical to the prior
        // inline math; rules 3 + 4 are now also reflected in mlcWarning.
        const mlcReport = assessMlc({
          dayShifts: todayRows.map(toCamelShift),
          weekShifts: all.map(toCamelShift),
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

        // ── Rolling 7-day rest chart (rest hours per day) ──
        const weekChart = [];
        for (let i = 6; i >= 0; i -= 1) {
          const d = new Date(`${effDate}T00:00:00`);
          d.setDate(d.getDate() - i);
          const ds = d.toISOString().slice(0, 10);
          const dayRows = all.filter(s => s.shift_date === ds);
          const dayOnDuty = dayRows
            .filter(s => ON_DUTY_TYPES.has(s.shift_type))
            .reduce((sum, s) => sum + shiftHours(s), 0);
          const restH = Math.max(0, 24 - dayOnDuty);
          weekChart.push({
            day: WEEKDAY[d.getDay()],
            date: ds,
            hours: Math.round(restH),
            status: restH >= 11 ? 'ok' : 'low',
            isToday: ds === effDate,
          });
        }

        // ── Shift-type breakdown over the loaded 7-day window (real data;
        //    trip-scoped totals arrive with trip integration later) ──
        const typeHours = {};
        const typeCount = {};
        for (const s of all) {
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
          all.filter(s => ON_DUTY_TYPES.has(s.shift_type)).map(s => s.shift_date),
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
          offToday,
          rest24hLabel: offToday ? 'Off duty today' : `${fmtHours(rest24h)} rest`,
          pastWeekLabel: `Past week ${fmtHours(pastWeekHours)}`,
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
          suggestions: [],
        });
      } catch (e) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, tenantId, memberId]);

  return { data, loading, error };
}
