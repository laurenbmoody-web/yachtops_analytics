// useRotaRestData — rest-panel data for one crew member, computed from
// their last 7 days of rota_shifts.
//
// Returns a shape compatible with what RestPanelPopover already reads
// (the old MOCK_REST_DATA entry): timeline / weekChart / labels /
// banner prose / *Meta / *Summary. The shift-type breakdown is now computed
// live from the loaded 7-day window; trip-scoped totals + AI suggestions
// remain later steps (trip + AI engine).

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { hhmmToDecimal } from './useRotaShifts';
import { ON_DUTY_TYPES, assessMlc, restForWeek } from './restHours';
import { generateRankedSuggestions } from './suggestionEngine';

// Session cache so re-opening the panel for an unchanged rota returns the
// identical ranked suggestions + copy (no re-roll, no extra model call).
const SUGGESTION_CACHE = new Map();

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

// Turn one ENGINE-RANKED fix (+ its AI copy, if any) into the shape
// RestPanelPopover renders. The change/freedBlock are already resolved by the
// engine; copy falls back to a template when the model is unavailable.
function buildSuggestion(r, copy, effDate) {
  // Compliance is judged on ALL four rules, not just the weekly total — a
  // lever that restores weekly rest but leaves a 14h-continuous / split breach
  // open must NOT read as "now compliant".
  const resolves = !!r.resolvesAll;
  const weeklyOk = r.restTo >= 77;
  const future = r.freedBlock.date > effDate;
  const weeklyEffect = {
    name: 'Rolling 7-day rest',
    from: fmtHours(r.restFrom),
    to: fmtHours(r.restTo),
    fromColor: r.restFrom >= 77 ? '#2D5A3A' : '#7A2E1E',
    toColor: resolves ? '#2D5A3A' : '#7A2E1E',
    note: resolves
      ? (future ? `compliant by ${r.dayLabel}` : 'now compliant')
      : weeklyOk
        ? 'weekly ok · breach remains'
        : `still ${fmtHours(Math.max(0, 77 - r.restTo))} short`,
    noteColor: resolves ? '#2D5A3A' : '#7A2E1E',
  };
  return {
    type: r.confidence === 'high' ? 'confident' : 'judgment',
    pill: r.confidence === 'high' ? 'High confidence' : 'Judgement call',
    headline: copy?.headline || fallbackHeadline(r),
    body: copy?.body || fallbackBody(r),
    effects: [weeklyEffect],
    change: r.change,
    freedBlock: r.freedBlock,
    resolves,
    primaryAction: 'Apply to grid',
    secondaryAction: 'Dismiss',
  };
}

function fallbackHeadline(r) {
  if (r.kind === 'day_off') return `Full day off ${r.dayLabel}`;
  if (r.kind === 'future_off') return `Lighten ${r.dayLabel}`;
  if (r.kind === 'shorten') return `Trim the ${r.dayLabel} watch`;
  return `Hand off the ${r.dayLabel} watch`;
}
function fallbackBody(r) {
  const who = (r.coverage.roles && r.coverage.roles.length)
    ? r.coverage.roles[0]
    : 'another crew member in the department';
  const verb = r.kind === 'day_off' ? 'A full day off'
    : r.kind === 'future_off' ? 'Dropping this block'
      : r.kind === 'shorten' ? 'Trimming this block' : 'Freeing this block';
  // Coverage clause — only claim someone absorbs it when crew are actually free
  // during the block; otherwise be explicit that it would need manual cover.
  const coverage = r.coverage.ok
    ? `${who} can absorb the coverage.`
    : 'No one in the department is free during the block, so it would need manual cover.';
  // Be honest when the lever eases load but doesn't clear the breach (e.g. a
  // structural 14h-continuous breach from already-worked days that no
  // forward reschedule can undo).
  if (!r.resolvesAll && r.remainingBreaches && r.remainingBreaches.length) {
    return `${verb} ${r.dayLabel} eases the load, but doesn’t clear the breach on its own (${r.remainingBreaches.join(' · ')}). ${coverage}`;
  }
  return `${verb} ${r.dayLabel} helps close the rest deficit. ${coverage}`;
}


// Friendly label per on-duty shift type.
const TYPE_LABELS = { duty: 'Duty', watch: 'Watch', standby: 'Standby', training: 'Training' };

export function useRotaRestData(memberId, crewName = null, crewRole = null, crewDept = null, anchorDate = null, opts = {}) {
  // AuthContext exposes `activeTenantId`, not `tenantId`.
  const { user, activeTenantId } = useAuth();
  const tenantId = activeTenantId;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Roster + window shifts + the source crew object feed the deterministic
  // suggestion engine. Held in refs so updating them doesn't re-trigger the
  // member fetch — the effect reads the latest values when it runs.
  const sourceMemberRef = useRef(opts.sourceMember);
  const rosterRef = useRef(opts.roster);
  const windowShiftsRef = useRef(opts.windowShifts);
  sourceMemberRef.current = opts.sourceMember;
  rosterRef.current = opts.roster;
  windowShiftsRef.current = opts.windowShifts;
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
        const nowDate = new Date();
        const p2 = (n) => String(n).padStart(2, '0');
        const localToday = `${nowDate.getFullYear()}-${p2(nowDate.getMonth() + 1)}-${p2(nowDate.getDate())}`;
        const nowHHMM = `${p2(nowDate.getHours())}:${p2(nowDate.getMinutes())}`;
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

        // ── Rest suggestions ── The engine deterministically RANKS the fixes
        //    (same rota → same top 2); the model only writes copy for them.
        if (mlcWarning) {
          setSuggestionsLoading(true);
          try {
            const sourceMember = sourceMemberRef.current
              || { id: memberId, department: crewDept, role: crewRole, name: crewName };
            const ranked = generateRankedSuggestions({
              sourceMember,
              effDate,
              allRows: all,
              report: mlcReport,
              roster: rosterRef.current || [],
              windowShifts: windowShiftsRef.current || [],
              limit: 2,
              realToday: localToday,
              nowHHMM,
            });

            // Stable cache key: who, when, and exactly which ranked fixes.
            const cacheKey = `${memberId}|${effDate}|${ranked.map(r => r.id).join(',')}`;
            if (SUGGESTION_CACHE.has(cacheKey)) {
              if (!cancelled) setSuggestions(SUGGESTION_CACHE.get(cacheKey));
            } else if (ranked.length === 0) {
              if (!cancelled) setSuggestions([]);
            } else {
              let copyById = new Map();
              try {
                const { data: aiRes } = await supabase.functions.invoke('generate-rest-insights', {
                  body: {
                    member: { name: crewName || 'This crew member', role: crewRole, department: crewDept },
                    breaches: mlcReport.breaches.map(b => ({ label: b.label })),
                    changes: ranked.map(r => ({
                      id: r.id,
                      kind: r.kind,
                      day_label: r.dayLabel,
                      block_label: r.blockLabel,
                      freed_hours: Math.round(r.freedBlock.hours),
                      rest_from: Math.round(r.restFrom),
                      rest_to: Math.round(r.restTo),
                      resolves: r.resolvesAll,
                      remaining_breaches: r.remainingBreaches || [],
                      coverage_ok: !!r.coverage.ok,
                      coverage_roles: Array.from(new Set(r.coverage.roles || [])),
                    })),
                  },
                });
                copyById = new Map((aiRes?.copy || []).map(c => [c.id, c]));
              } catch {
                // Copy is best-effort; fall back to templated text below.
              }
              if (cancelled) return;
              const enriched = ranked.map(r => buildSuggestion(r, copyById.get(r.id), effDate));
              SUGGESTION_CACHE.set(cacheKey, enriched);
              if (!cancelled) setSuggestions(enriched);
            }
          } catch (aiErr) {
            // Never break the panel if suggestion generation fails.
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
