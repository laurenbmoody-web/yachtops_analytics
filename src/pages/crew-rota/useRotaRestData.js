// useRotaRestData — rest-panel data for one crew member, computed from
// their last 7 days of rota_shifts.
//
// Returns a shape compatible with what RestPanelPopover already reads
// (the old MOCK_REST_DATA entry): timeline / weekChart / labels /
// banner prose / *Meta / *Summary. Trip insights + AI suggestions stay
// hardcoded placeholders per spec (trip + AI engine are later steps).

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { hhmmToDecimal } from './useRotaShifts';

const ON_DUTY_TYPES = new Set(['duty', 'watch', 'standby', 'training']);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// Hardcoded placeholders (trip + AI are later steps).
function staticTripInsights(firstName) {
  return {
    tripMeta: 'This trip so far · day 3 of 5',
    tripSummary: `<em>${firstName}</em> has worked across the first three days of the Marchetti charter.`,
    tripStats: [
      { num: '—', label: 'Duty', sub: 'Trip totals land with trip integration' },
      { num: '—', label: 'Watch', sub: 'Later step' },
      { num: '—', label: 'Standby', sub: 'Later step' },
    ],
  };
}

export function useRotaRestData(memberId) {
  // AuthContext exposes `activeTenantId`, not `tenantId`.
  const { activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!tenantId || !memberId) { setData(null); return undefined; }

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

        const onDutyToday = todayRows
          .filter(s => ON_DUTY_TYPES.has(s.shift_type))
          .reduce((sum, s) => sum + shiftHours(s), 0);
        const rest24h = Math.max(0, 24 - onDutyToday);

        const weekOnDuty = all
          .filter(s => ON_DUTY_TYPES.has(s.shift_type))
          .reduce((sum, s) => sum + shiftHours(s), 0);
        const pastWeekHours = Math.max(0, 7 * 24 - weekOnDuty);

        const dailyBelow = rest24h < 10;
        const weeklyBelow = pastWeekHours < 77;
        const mlcWarning = !offToday && (dailyBelow || weeklyBelow);

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

        const firstName = '';
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
              return {
                headline: 'Weekly rest is <em>below the 77-hour MLC minimum</em>.',
                body: `The rolling 7-day rest total is <strong>${fmtHours(pastWeekHours)}</strong> against the 77h weekly minimum. The cumulative shortfall needs reducing over the coming days.`,
              };
            })()
          : { headline: null, body: null };

        const trip = staticTripInsights(firstName || 'This crew member');

        if (cancelled) return;
        setData({
          mlcWarning,
          offToday,
          rest24hLabel: offToday ? 'Off duty today' : `${fmtHours(rest24h)} rest`,
          pastWeekLabel: `Past week ${fmtHours(pastWeekHours)}`,
          bannerHeadline: banner.headline,
          bannerBody: banner.body,
          timelineMeta: '18:30 yesterday → now',
          timelineSummary: offToday
            ? '24h off duty · no shifts today'
            : `${fmtHours(rest24h)} rest · ${fmtHours(onDutyToday)} on duty`,
          timeline,
          chartMeta: 'Rolling 7d rest · evolving by day',
          chartSummary: `${Math.round(pastWeekHours)}h projected by tonight`,
          chartShort: weeklyBelow ? `${Math.round(77 - pastWeekHours)}h short` : null,
          chartShortOf: weeklyBelow ? '77h weekly minimum' : null,
          weekChart,
          ...trip,
          suggestions: [],
        });
      } catch (e) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, memberId]);

  return { data, loading, error };
}
