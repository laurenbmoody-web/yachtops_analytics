import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertTriangle, ChevronDown, RefreshCw, Trash2, Plus, RotateCcw, CheckCircle2, Activity } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import DateRangePicker from './DateRangePicker';
import { assessApply, CIRCADIAN_WINDOW_DAYS, computeShortenPrefill, computeBulkShortenPrefill } from './restHours';
import TimeSelect from './TimeSelect';

// Phase 3a + 3b — Apply-template modal (simple + shift-pattern paths).
//
// Opens from a row-body click in the PatternPicker. Writes nothing on
// open; commits only on the explicit "Apply to rota" button after a
// conflict review (if any).
//
// SIMPLE path (3a, brief §4): name/scope/hours preview, date range via
// the always-visible calendar picker, collapsible crew checklist with
// inline selected names, conflict batch-summary, then a single batch
// write to rota_shifts.
//
// SHIFT PATTERN path (3b, brief §5): role-slot assignment via per-slot
// dropdowns filtered to crew with that job title; auto-match pre-selects
// the crew currently active per crew_status_history; date range via the
// same picker; pass-the-baton expansion across the range; preview
// matrix; mismatch warning (M ≠ N) that does NOT hard-block. Same
// conflict batch-summary as simple; same write path.
//
// Date handling: every date is a plain local 'YYYY-MM-DD' string.
// Local Date constructors / getFullYear/getMonth/getDate only.
// No toISOString in this file.

// ── Constants + utils ──────────────────────────────────────────────────────
const TYPE_COLOR = {
  duty: '#1C1B3A', watch: '#C65A1A', standby: '#B8935E',
  training: '#6B7F6B', medical: '#7A2E1E',
};
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = (n) => String(n).padStart(2, '0');

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromStr(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function rangeDays(startStr, endStr) {
  if (!startStr || !endStr || startStr > endStr) return [];
  const start = fromStr(startStr);
  const end = fromStr(endStr);
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toLocalDateStr(d));
  }
  return out;
}
function startOfThisWeekMondayStr() {
  const x = new Date();
  const w = x.getDay();
  const shift = w === 0 ? -6 : 1 - w;
  x.setDate(x.getDate() + shift);
  return toLocalDateStr(x);
}
function defaultRange() {
  const start = startOfThisWeekMondayStr();
  const [y, m, d] = start.split('-').map(Number);
  const endD = new Date(y, m - 1, d);
  endD.setDate(endD.getDate() + 6);
  return { start, end: toLocalDateStr(endD) };
}
function fmtTime(t) { return t ? String(t).slice(0, 5) : ''; }
function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

// "28 May" — from a plain 'YYYY-MM-DD' string. Local components only.
function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const d = fromStr(dateStr);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

// Date-list formatter — collapses enumerated dates to range form when
// they're contiguous (within a single month: "27–31 May"; cross-month
// or year: "28 May–2 Jun"). Non-contiguous falls back to a comma list
// ("27, 29, 31 May"). Used everywhere a sequence of YYYY-MM-DD strings
// is displayed (bulk readout's still-breaching / excluded clauses, the
// Shortened panel's rollup row). Sorts the input internally so callers
// don't need to.
function fmtDateRange(dates) {
  if (!Array.isArray(dates) || dates.length === 0) return '';
  if (dates.length === 1) return fmtDateShort(dates[0]);
  const sorted = [...dates].sort();
  let contiguous = true;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = fromStr(sorted[i - 1]);
    const b = fromStr(sorted[i]);
    if ((b - a) / 86_400_000 !== 1) { contiguous = false; break; }
  }
  if (contiguous) {
    const first = fromStr(sorted[0]);
    const last = fromStr(sorted[sorted.length - 1]);
    if (first.getMonth() === last.getMonth()
        && first.getFullYear() === last.getFullYear()) {
      return `${first.getDate()}–${last.getDate()} ${MONTH_SHORT[first.getMonth()]}`;
    }
    return `${fmtDateShort(sorted[0])}–${fmtDateShort(sorted[sorted.length - 1])}`;
  }
  return sorted.map(fmtDateShort).join(', ');
}

function fmtHoursH(decimal) {
  if (decimal == null || Number.isNaN(decimal)) return '—';
  const total = Math.max(0, Math.round(Number(decimal) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Honest one-liner per rule (used in the hard-warning list).
function formatMlcBreachPhrase(breach) {
  const { rule, projected, limit } = breach;
  if (rule === 'daily_rest_10h') {
    return `only ${fmtHoursH(projected)} rest — MLC minimum ${limit}h`;
  }
  if (rule === 'weekly_rest_77h') {
    return `${fmtHoursH(projected)} rolling 7-day rest — MLC minimum ${limit}h`;
  }
  if (rule === 'rest_period_split') {
    const pc = projected?.periodCount ?? '?';
    const longest = projected?.longest ?? 0;
    return `rest split into ${pc} period${pc === 1 ? '' : 's'}, longest ${fmtHoursH(longest)} — MLC requires ≤${limit?.maxPeriods} periods with one ≥${limit?.longestMin}h`;
  }
  if (rule === 'max_work_stretch_14h') {
    return `${fmtHoursH(projected)} continuous on-duty — MLC maximum ${limit}h`;
  }
  return `breach of ${rule}`;
}

// Short, scannable chip labels — plain problem statement, no rule
// numbers, no math symbols. Canonical order matches the rules in
// restHours.js: daily, weekly, structural split, max stretch. Renderers
// iterate this list so chip order is identical row-to-row.
const MLC_RULE_CHIPS = [
  { rule: 'daily_rest_10h',       label: 'not enough rest per day' },
  { rule: 'weekly_rest_77h',      label: 'not enough rest per week' },
  { rule: 'rest_period_split',    label: 'broken rest' },
  { rule: 'max_work_stretch_14h', label: 'too long without a break' },
];

// Numbers spelt out for the piled-up template (max 8 shifts is plenty).
const NUMBER_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function numberWord(n) { return NUMBER_WORD[n] || String(n); }

// UX copy for the breach advisory. restHours.js emits the diagnosis;
// this function renders the human sentence. Returns null for diagnoses
// out of v1 scope (structural rules).
function adviseBreach(diagnosis) {
  if (!diagnosis) return null;
  if (diagnosis.rule === 'daily_rest_10h') {
    const date = fmtDateShort(diagnosis.date);
    if (diagnosis.cause === 'single_long_shift') {
      const k = diagnosis.culprits[0];
      const hours = Math.round(k.durationHours);
      const subject = k.source === 'proposed' ? 'the pattern adds' : 'the crew already has';
      return `Why — ${subject} a ${hours}h shift on ${fmtDateShort(k.date)}; on its own that leaves under 10h rest. A shorter shift, or splitting it across two crew, would ease this.`;
    }
    if (diagnosis.cause === 'two_shifts_too_close') {
      const gap = Math.round(diagnosis.gapHours);
      return `Why — two shifts on ${date} fall only ${gap}h apart. More space between them would bring the rest back up.`;
    }
    if (diagnosis.cause === 'piled_up') {
      return `Why — ${numberWord(diagnosis.shiftCount)} shifts stack up on ${date}. Dropping or reassigning one would ease the load.`;
    }
    // ambiguous
    return `Why — rest is short across several shifts on ${date}, with no single one driving it.`;
  }
  if (diagnosis.rule === 'weekly_rest_77h') {
    if (diagnosis.cause === 'one_spike_day' && diagnosis.heaviestDay) {
      const hd = diagnosis.heaviestDay;
      const hours = Math.round(hd.hours);
      return `Why — ${fmtDateShort(hd.date)} carries ${hours}h, most of this week’s load. Lightening that day would help most.`;
    }
    return 'Why — the load is heavy right across the week, with no single day standing out. Spreading work to other crew would bring it down.';
  }
  return null;
}

// Composite identity for a proposed row — same six fields ccaeb41's
// pushIfNew dedupe uses. Stable across re-renders; content-addressed so
// no risk of array-index drift when slots/dropped state changes.
function dropRowKey(row) {
  return `${row.member_id}|${row.shift_date}|${row.shift_type}|${row.sub_type ?? ''}|${row.start_time}|${row.end_time}`;
}

// Pick the row a "Drop this shift" lever should target, given a diagnosis
// and the current proposed row set. Returns { row, reason }: reason ===
// 'existing' means the culprit isn't in the proposed rows (existing-only
// shift), 'no_match' is a defensive fallback that shouldn't fire in
// practice. Only single_long_shift (daily) and one_spike_day (weekly)
// have a clean lever in v1.
function resolveDropCulprit({ diagnosis, memberId, allRows }) {
  if (!diagnosis) return { row: null, reason: null };

  if (diagnosis.cause === 'single_long_shift') {
    const c = diagnosis.culprits?.[0];
    if (!c) return { row: null, reason: 'no_culprit' };
    if (c.source !== 'proposed') return { row: null, reason: 'existing' };
    const row = allRows.find((r) =>
      r.member_id === memberId
      && r.shift_date === c.date
      && r.start_time === c.startTime
      && r.end_time === c.endTime
    );
    return { row: row || null, reason: row ? null : 'no_match' };
  }

  if (diagnosis.cause === 'one_spike_day') {
    const day = diagnosis.heaviestDay?.date;
    if (!day) return { row: null, reason: 'no_culprit' };
    const candidates = allRows.filter(
      (r) => r.member_id === memberId && r.shift_date === day,
    );
    if (candidates.length === 0) return { row: null, reason: 'existing' };
    // Longest by duration; tie-break by later start_time.
    const withDuration = candidates.map((r) => {
      const [sh, sm] = r.start_time.split(':').map(Number);
      const [eh, em] = r.end_time.split(':').map(Number);
      let start = sh + (sm || 0) / 60;
      let end = eh + (em || 0) / 60;
      if (end <= start) end += 24;
      return { row: r, duration: end - start, startDec: start };
    });
    withDuration.sort((a, b) => (b.duration - a.duration) || (b.startDec - a.startDec));
    return { row: withDuration[0].row, reason: null };
  }

  return { row: null, reason: null };
}

// Sentence-case rule title for the per-rule summary line.
const MLC_RULE_TITLE = {
  daily_rest_10h:       'Not enough rest per day',
  weekly_rest_77h:      'Not enough rest per week',
  rest_period_split:    'Broken rest',
  max_work_stretch_14h: 'Too long without a break',
};

// Day-count → chip severity tier. Drives the chip fill intensity so
// "bad" reads before the text does. Four tiers in the Cargo terracotta
// family, lightest → deepest. Tunable in CSS.
function chipSeverity(dayCount) {
  if (dayCount >= 7) return 'extreme';
  if (dayCount >= 5) return 'high';
  if (dayCount >= 3) return 'medium';
  return 'low';
}

// Per-member breach summary keyed by rule. Missing rules → 0 days.
function ruleSummary(mlcBreaches) {
  const byRule = new Map();
  for (const b of mlcBreaches) {
    byRule.set(b.rule, (byRule.get(b.rule) || 0) + 1);
  }
  return MLC_RULE_CHIPS
    .map(({ rule, label }) => ({ rule, label, dayCount: byRule.get(rule) || 0 }))
    .filter((r) => r.dayCount > 0);
}

// Total day-count weight for row sorting (worst-first).
function memberSeverity(mlcBreaches) {
  return mlcBreaches.length;
}

// "all 7 days, 18–24 May" when every apply day breached, else "5 of 7 days".
// Used by the totals rules (daily, weekly) where the apply-range coverage
// is meaningful. Structural rules (split, stretch) just say "N days".
function daysClauseTotals(dayCount, applyDates) {
  const total = applyDates.length;
  if (dayCount === total && total > 0) {
    if (total === 1) return `1 day (${fmtDateShort(applyDates[0])})`;
    return `all ${total} days, ${fmtDateShort(applyDates[0])}–${fmtDateShort(applyDates[total - 1])}`;
  }
  return `${dayCount} of ${total} days`;
}

function daysClauseStructural(dayCount) {
  return `${dayCount} day${dayCount === 1 ? '' : 's'}`;
}

// Per-rule worst-breach pick. Worst = least-rest / longest-stretch /
// most-broken-rest day for each rule respectively.
function pickWorstBreach(rule, breaches) {
  if (rule === 'daily_rest_10h' || rule === 'weekly_rest_77h') {
    return breaches.reduce((a, b) =>
      (a == null || Number(b.projected) < Number(a.projected)) ? b : a, null);
  }
  if (rule === 'rest_period_split') {
    return breaches.reduce((a, b) => {
      const cur = Number(b.projected?.longest ?? 999);
      const prev = a ? Number(a.projected?.longest ?? 999) : 999;
      return cur < prev ? b : a;
    }, null);
  }
  if (rule === 'max_work_stretch_14h') {
    return breaches.reduce((a, b) =>
      (a == null || Number(b.projected) > Number(a.projected)) ? b : a, null);
  }
  return breaches[0] || null;
}

// Per-rule summary sentence. `worst` is exposed so the caller can pass
// its diagnosis to adviseBreach — the advisory should describe the same
// day the sentence highlights.
function summariseRule(rule, breaches, applyDates) {
  const title = MLC_RULE_TITLE[rule] || rule;
  if (breaches.length === 0) return null;
  const worst = pickWorstBreach(rule, breaches);

  if (rule === 'daily_rest_10h') {
    return {
      sentence: `${title} — ${daysClauseTotals(breaches.length, applyDates)}. Worst ${fmtHoursH(worst.projected)} on ${fmtDateShort(worst.date)} (${worst.limit}h required).`,
      worst,
    };
  }
  if (rule === 'weekly_rest_77h') {
    return {
      sentence: `${title} — ${daysClauseTotals(breaches.length, applyDates)}. Lowest ${fmtHoursH(worst.projected)} on ${fmtDateShort(worst.date)} (${worst.limit}h required).`,
      worst,
    };
  }
  if (rule === 'rest_period_split') {
    const longest = Number(worst?.projected?.longest ?? 0);
    const tail = longest < 0.01
      ? 'none of the rest periods reached 6h'
      : `longest rest only ${fmtHoursH(longest)} (6h needed)`;
    return {
      sentence: `${title} — ${daysClauseStructural(breaches.length)}. Worst ${fmtDateShort(worst.date)}: ${tail}.`,
      worst,
    };
  }
  if (rule === 'max_work_stretch_14h') {
    return {
      sentence: `${title} — ${daysClauseStructural(breaches.length)}. Longest ${fmtHoursH(worst.projected)} continuous on ${fmtDateShort(worst.date)} (${worst.limit}h max).`,
      worst,
    };
  }
  return null;
}

// One collapsible member row in the MLC breach list. Defaults collapsed.
// Expanded view shows the per-rule summary sentences first; a further
// disclosure reveals the day-by-day prose detail beneath.
// Short labels for the per-rule live readout in the Shorten inline editor.
// Distinct from the chip labels (which are plain-language) and from the
// rule TITLE labels (which are sentence-case). These are mid-sentence
// fragments — "clears daily rest", "still breaches 14h continuous".
const MLC_RULE_SHORT_LABEL = {
  daily_rest_10h:       'daily rest',
  weekly_rest_77h:      'weekly rest',
  rest_period_split:    'split rest',
  max_work_stretch_14h: '14h continuous',
};

function joinAnd(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function computeNewDurationH(newStart, newEnd) {
  const [sh, sm] = String(newStart).split(':').map(Number);
  const [eh, em] = String(newEnd).split(':').map(Number);
  let start = sh + (sm || 0) / 60;
  let end = eh + (em || 0) / 60;
  if (end <= start) end += 24;
  return end - start;
}

// Inline shorten editor — replaces the single Drop button on
// single_long_shift advisories. Drop stays as a tertiary escape below.
// State is local: the editor's open/closed, the trim direction (end/start),
// and the in-flight TimeSelect value. Apply commits via onShortenRow;
// Cancel discards. Direction defaults to the larger d_new_max per the
// computeShortenPrefill result (preserves more work — Correction 3).
function ShortenLever({
  rule,
  diagnosis,
  memberId,
  mlcBreaches,
  allRows,
  computePrefillFor,
  previewWithEdit,
  onShortenRow,
  onDropRow,
}) {
  const { row: culpritRow, reason } = resolveDropCulprit({
    diagnosis, memberId, allRows,
  });
  const existingCulprit = reason === 'existing';
  const tooltip = existingCulprit
    ? 'This shift is already on the rota — edit it from the grid.'
    : undefined;

  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [direction, setDirection] = useState('end');
  const [currentTime, setCurrentTime] = useState(null);

  const openEditor = () => {
    if (!culpritRow || existingCulprit) return;
    const p = computePrefillFor(culpritRow);
    if (!p) return;
    const dir = p.defaultDirection;
    const dirData = p[dir];
    setPrefill(p);
    setDirection(dir);
    setCurrentTime(dir === 'end' ? dirData.newEnd : dirData.newStart);
    setOpen(true);
  };

  const switchDirection = (nextDir) => {
    if (!prefill) return;
    const dirData = prefill[nextDir];
    setDirection(nextDir);
    setCurrentTime(nextDir === 'end' ? dirData.newEnd : dirData.newStart);
  };

  const cancel = () => {
    setOpen(false);
    setPrefill(null);
    setCurrentTime(null);
  };

  const applyShorten = () => {
    if (!culpritRow || !currentTime) return;
    const newStart = direction === 'end' ? culpritRow.start_time : currentTime;
    const newEnd   = direction === 'end' ? currentTime           : culpritRow.end_time;
    onShortenRow?.(culpritRow, newStart, newEnd, rule);
    cancel();
  };

  const dropFromHere = () => {
    if (!culpritRow) return;
    onDropRow?.(culpritRow, rule);
    cancel();
  };

  // Collapsed-state buttons.
  if (!open) {
    return (
      <div className="ap-mlc-lever-row">
        <button
          type="button"
          className="ap-mlc-shorten-btn"
          disabled={existingCulprit || !culpritRow}
          title={tooltip}
          onClick={openEditor}
        >Shorten this shift</button>
        <button
          type="button"
          className="ap-mlc-drop-link"
          disabled={existingCulprit || !culpritRow}
          title={tooltip}
          onClick={dropFromHere}
        >or drop this shift</button>
      </div>
    );
  }

  // Expanded inline editor.
  const dirData = prefill?.[direction];
  const directionViable = !!dirData?.viable;
  // Per-rule live readout via previewWithEdit. Restricted to the rules
  // this member was already breaching pre-edit so the readout describes
  // what the chief is fixing — newly-induced breaches (cascade) surface
  // in the main MLC list after Apply, not here (spec Correction 2).
  const originalRules = new Set((mlcBreaches || []).map((b) => b.rule));
  let cleared = [];
  let remaining = [];
  let newDurationH = 0;
  if (currentTime && culpritRow) {
    const newStart = direction === 'end' ? culpritRow.start_time : currentTime;
    const newEnd   = direction === 'end' ? currentTime           : culpritRow.end_time;
    newDurationH = computeNewDurationH(newStart, newEnd);
    const key = dropRowKey(culpritRow);
    const previewAssessment = previewWithEdit(key, newStart, newEnd);
    const previewRules = new Set(
      (previewAssessment.byMember?.[memberId]?.mlcBreaches || []).map((b) => b.rule),
    );
    cleared   = [...originalRules].filter((r) => !previewRules.has(r));
    remaining = [...originalRules].filter((r) =>  previewRules.has(r));
  }
  const noChange = !!currentTime && !!culpritRow && (
    (direction === 'end'   && currentTime === String(culpritRow.end_time).slice(0, 5)) ||
    (direction === 'start' && currentTime === String(culpritRow.start_time).slice(0, 5))
  );
  const applyDisabled = !culpritRow || !currentTime || !directionViable || noChange;

  // Readout copy. Precedence:
  //   1. Direction is non-viable     → "Can't shorten enough — try Drop".
  //   2. Chief's pick == original    → "Trimming from this end won't
  //      shorten the shift — try the other end." (Folded in from C2
  //      review: silent-grey Apply with no stated reason reads as a bug;
  //      surface the reason in the readout when Apply is disabled.)
  //   3. Otherwise                    → per-rule clears / still-breaches.
  let readout;
  if (!directionViable) {
    readout = `Can't shorten enough to clear — try Drop`;
  } else if (noChange) {
    readout = `Trimming from this end won't shorten the shift — try the other end`;
  } else {
    const lbl = (rs) => joinAnd(rs.map((r) => MLC_RULE_SHORT_LABEL[r] || r));
    const dur = `New length ${fmtHoursH(newDurationH)}`;
    if (cleared.length === 0 && remaining.length === 0) {
      readout = dur;
    } else if (cleared.length > 0 && remaining.length === 0) {
      readout = `${dur} · clears ${lbl(cleared)}`;
    } else if (cleared.length === 0 && remaining.length > 0) {
      readout = `${dur} · still breaches ${lbl(remaining)}`;
    } else {
      readout = `${dur} · clears ${lbl(cleared)} — still breaches ${lbl(remaining)}`;
    }
  }

  const originalLabel = `${culpritRow.start_time.slice(0, 5)}–${culpritRow.end_time.slice(0, 5)}  (${fmtHoursH(computeNewDurationH(culpritRow.start_time, culpritRow.end_time))})`;

  return (
    <div className="ap-mlc-shorten-panel">
      <div className="ap-mlc-shorten-head">Shorten</div>

      <div className="ap-mlc-shorten-toggle">
        <span className="ap-mlc-shorten-label">Trim from:</span>
        <button
          type="button"
          className={`ap-mlc-shorten-tog${direction === 'end' ? ' is-on' : ''}`}
          onClick={() => switchDirection('end')}
        >End</button>
        <button
          type="button"
          className={`ap-mlc-shorten-tog${direction === 'start' ? ' is-on' : ''}`}
          onClick={() => switchDirection('start')}
        >Start</button>
      </div>

      <div className="ap-mlc-shorten-row">
        <span className="ap-mlc-shorten-label">Original:</span>
        <span className="ap-mlc-shorten-value">{originalLabel}</span>
      </div>

      <div className="ap-mlc-shorten-row">
        <span className="ap-mlc-shorten-label">
          {direction === 'end' ? 'New end:' : 'New start:'}
        </span>
        <TimeSelect
          value={currentTime || ''}
          onChange={setCurrentTime}
          ariaLabel={direction === 'end' ? 'New end time' : 'New start time'}
        />
      </div>

      <div className="ap-mlc-shorten-readout">{readout}</div>

      <div className="ap-mlc-shorten-actions">
        <button type="button" className="ap-mlc-shorten-cancel" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="ap-mlc-shorten-apply"
          disabled={applyDisabled}
          onClick={applyShorten}
        >Apply shorten</button>
      </div>

      <button
        type="button"
        className="ap-mlc-drop-link ap-mlc-drop-link-tertiary"
        onClick={dropFromHere}
      >or drop this shift</button>
    </div>
  );
}

// Compact block rendered IN PLACE OF the (rule sentence + Why advisory
// + futile message) stack when the bulk pre-fill can't clear ANY
// breaching day. Common case: weekly rest overloaded across the entire
// range. The chief can't act from a Shorten lever here — the only fix
// from this screen is to Drop all the recurring proposed shifts (which
// removes them from the apply, leaving the chief to reassign elsewhere
// or override). v1.2 density pass C1 compresses an 8-line stack into a
// two-line block that preserves the regulatory anchor (the MLC limit
// and the worst-case projected value).
function ShortenFutileCompact({
  rule, worstBreach, breachCount, culpritRows, onBulkDropRows,
}) {
  const title = MLC_RULE_TITLE[rule] || rule;
  // Line 1 — regulatory anchor. Keep the rule title, the affected-day
  // count, and the worst figure with the MLC limit. Drop the date-range
  // tail and the "fell short" framing (both recoverable from context).
  let sentence;
  if (rule === 'weekly_rest_77h' && worstBreach) {
    sentence = `${title} — all ${breachCount} days. Lowest ${fmtHoursH(worstBreach.projected)} on ${fmtDateShort(worstBreach.date)} (${worstBreach.limit}h required).`;
  } else if (rule === 'daily_rest_10h' && worstBreach) {
    sentence = `${title} — all ${breachCount} days. Worst ${fmtHoursH(worstBreach.projected)} on ${fmtDateShort(worstBreach.date)} (${worstBreach.limit}h required).`;
  } else {
    sentence = `${title} — ${breachCount} day${breachCount === 1 ? '' : 's'}.`;
  }
  // Line 2 — action. Rule-aware reason text; the drop button signals
  // scale ("Drop all N shifts") rather than reading as a casual single-
  // shift drop. The chief still lands in the Removed panel afterward
  // with Restore available on the rolled-up entry.
  const reasonText = rule === 'weekly_rest_77h'
    ? 'Week is overloaded — shortening won’t fix this'
    : rule === 'daily_rest_10h'
      ? 'Day already over — shortening won’t fix this'
      : 'Shortening can’t fix this';
  const canDrop = Array.isArray(culpritRows) && culpritRows.length > 0;
  return (
    <div className="ap-mlc-futile-block">
      <div className="ap-mlc-futile-sentence">{sentence}</div>
      <div className="ap-mlc-futile-action">
        <span className="ap-mlc-futile-icon" aria-hidden="true">⚠</span>
        <span className="ap-mlc-futile-text">
          {reasonText}.{' '}
          <button
            type="button"
            className="ap-mlc-futile-drop"
            disabled={!canDrop}
            onClick={() => canDrop && onBulkDropRows?.(culpritRows, rule)}
          >Drop all {breachCount} shifts</button>
          {' '}or reassign elsewhere.
        </span>
      </div>
    </div>
  );
}

// Binding-rule explainer copy. Surfaced in the bulk summary readout
// behind a [why?] inline reveal when the bulk's binding rule isn't
// 'daily' — so the chief understands why a 16h shift is being trimmed
// to 10h (not just to the daily cap of 13h-with-margin). Spec
// requirement, not optional.
//
// Values are bare phrases — the [why?] reveal block renders them with
// its own surrounding chrome. Earlier (v1.2 C2) these strings carried
// a leading " — " separator for inline concatenation into the summary
// sentence; the D3 density-pass moved them behind the reveal, so the
// separator is gone.
const BULK_BINDING_EXPLAIN = {
  daily:    '',
  weekly:   'the later days hit the weekly rest limit',
  stretch:  'chain to surrounding shifts caps the trim',
  min_trim: '', // means "trim by at least 30 min" — informational only
  overnight_boundary: '', // only fires on excluded days, not the bulk's binding
};

// Bulk lever — replaces the single-day Shorten lever on single_long_shift
// advisories with recurringDays ≥ 2. Same direction-toggle + TimeSelect
// shape as v1.1's ShortenLever, but operates across N days at once.
// Per-day amend / exclude is C3; this commit ships bulk-only (uniform
// trim across all included days, fall-out days surfaced in the readout).
function BulkShortenLever({
  rule,
  breaches,
  allMemberBreaches,
  memberId,
  allRows,
  computeBulkPrefillFor,
  previewWithEdits,
  onBulkShortenRows,
  onBulkDropRows,
}) {
  // Resolve a culprit row per breach day. If ANY day's culprit is
  // existing-source, the bulk is disabled with the v1.1 tooltip
  // (mixed proposed/existing is a v1.3 concern).
  const culpritInfo = useMemo(() => {
    let anyExisting = false;
    const culprits = [];
    for (const b of breaches) {
      const { row, reason } = resolveDropCulprit({
        diagnosis: b.diagnosis, memberId, allRows,
      });
      if (reason === 'existing') anyExisting = true;
      if (row) culprits.push(row);
    }
    return { culprits, anyExisting };
  }, [breaches, memberId, allRows]);

  const recurringDays = breaches.length;
  const existingTooltip = 'This shift is already on the rota — edit it from the grid.';
  const buttonsDisabled = culpritInfo.anyExisting || culpritInfo.culprits.length === 0;

  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [direction, setDirection] = useState('end');
  const [currentTime, setCurrentTime] = useState(null);
  // Per-day list expand toggle.
  const [perDayOpen, setPerDayOpen] = useState(false);
  // Per-day state — explicit chief decisions only. A date with no
  // entry uses the default-from-prefill semantics (viable-in-bulk-
  // direction → include=true; non-viable → include=false). When the
  // chief Excludes / Includes / Amends a day, an entry lands here.
  //   { include: bool, customTime: 'HH:MM' | undefined }
  // PRESERVED across direction switches per the C3 rework (the
  // spec settlement). Switching direction recomputes the bulk's
  // representative time and the default-derived per-day defaults
  // but does NOT clear chief-set entries.
  const [perDayState, setPerDayState] = useState(() => new Map());
  // Per-row amend mini-editor.
  const [amendOpenForDate, setAmendOpenForDate] = useState(null);
  const [amendDraftTime, setAmendDraftTime] = useState(null);
  // Binding-rule [why?] reveal — closed by default. Preserved across
  // direction switches the same way perDayState is (the chief opened it
  // for a reason; recomputing on direction change doesn't invalidate
  // the explainer for the new direction). Reset on cancel + open.
  const [bindingWhyOpen, setBindingWhyOpen] = useState(false);

  const openEditor = () => {
    if (buttonsDisabled) return;
    const p = computeBulkPrefillFor(culpritInfo.culprits);
    if (!p) return;
    setPrefill(p);
    setDirection(p.direction);
    setCurrentTime(p.direction === 'end' ? p.bulkNewEnd : p.bulkNewStart);
    setPerDayState(new Map());
    setPerDayOpen(false);
    setAmendOpenForDate(null);
    setAmendDraftTime(null);
    setBindingWhyOpen(false);
    setOpen(true);
  };

  const switchDirection = (nextDir) => {
    if (!prefill || nextDir === direction) return;
    const p = computeBulkPrefillFor(culpritInfo.culprits, nextDir);
    if (!p) return;
    setPrefill(p);
    setDirection(nextDir);
    setCurrentTime(nextDir === 'end' ? p.bulkNewEnd : p.bulkNewStart);
    // perDayState is PRESERVED — exclusions and amendments survive the
    // direction switch (the C3 rework). amendDraftTime is reset only if
    // the chief was mid-amend on a day; the open amend stays open with
    // its in-progress value untouched (the chief's deliberate input).
  };

  const cancel = () => {
    setOpen(false);
    setPrefill(null);
    setCurrentTime(null);
    setPerDayState(new Map());
    setPerDayOpen(false);
    setAmendOpenForDate(null);
    setAmendDraftTime(null);
    setBindingWhyOpen(false);
  };

  // Drop tertiary — batch all breaching rows in one transition.
  const dropAll = () => {
    if (!culpritInfo.culprits || culpritInfo.culprits.length === 0) return;
    onBulkDropRows?.(culpritInfo.culprits, rule);
    cancel();
  };

  // Effective per-day state — merges chief's explicit perDayState with
  // the default derived from prefill.viableInBulkDirection.
  const effectivePerDay = (date) => {
    const explicit = perDayState.get(date);
    if (explicit) return explicit;
    const entry = prefill?.perDay.find((d) => d.date === date);
    return {
      include: !!entry?.viableInBulkDirection,
      customTime: undefined,
    };
  };

  // Per-row action handlers. Each writes a fresh perDayState; React
  // batches the single setState as it lives inside an event handler.
  const includeDay = (date) => {
    const next = new Map(perDayState);
    const existing = next.get(date) || { customTime: undefined };
    next.set(date, { ...existing, include: true });
    setPerDayState(next);
  };
  const excludeDay = (date) => {
    const next = new Map(perDayState);
    next.set(date, { include: false, customTime: undefined });
    setPerDayState(next);
  };
  const openAmend = (date) => {
    if (!prefill) return;
    const eff = effectivePerDay(date);
    const entry = prefill.perDay.find((d) => d.date === date);
    // Mini-editor initial value: existing customTime if amended, else
    // the day's representative bulk time (direction-aware).
    const initial = eff.customTime
      ?? (direction === 'end' ? (entry?.newEnd ?? currentTime) : (entry?.newStart ?? currentTime));
    setAmendDraftTime(initial);
    setAmendOpenForDate(date);
  };
  const confirmAmend = () => {
    if (!amendOpenForDate || !amendDraftTime) return;
    const next = new Map(perDayState);
    next.set(amendOpenForDate, { include: true, customTime: amendDraftTime });
    setPerDayState(next);
    setAmendOpenForDate(null);
    setAmendDraftTime(null);
  };
  const cancelAmend = () => {
    setAmendOpenForDate(null);
    setAmendDraftTime(null);
  };
  const resetAmend = (date) => {
    const next = new Map(perDayState);
    const existing = next.get(date);
    if (!existing) return;
    if (existing.customTime !== undefined) {
      if (existing.include) {
        next.delete(date); // back to default include=true, customTime=undefined
      } else {
        next.set(date, { ...existing, customTime: undefined });
      }
    }
    setPerDayState(next);
  };

  // Compute the per-day edits + preview state for the current time.
  // Memoised so a TimeSelect change triggers exactly one preview pass.
  const previewState = useMemo(() => {
    if (!prefill || !currentTime || !open) return null;
    // Build the per-day edit set FROM the chief's effective per-day
    // state, not from prefill alone. include=true days enter the write
    // set; their time is the chief's customTime if amended, else the
    // bulk's currentTime. include=false days don't appear in the set.
    // Compared to C2's auto-exclude-on-fall-out: C3 lets the chief
    // control inclusion via Exclude/Include, and the readout informs
    // (without auto-excluding) when an included day's time wouldn't
    // clear the rule. Apply writes all include=true days — fall-out
    // days persist in the main MLC list as remaining breaches.
    const includedEdits = [];
    const excludedEntries = [];
    for (const d of prefill.perDay) {
      if (!d.row) continue;
      const eff = effectivePerDay(d.date);
      if (!eff.include) { excludedEntries.push(d); continue; }
      const time = eff.customTime ?? currentTime;
      const newStart = direction === 'end' ? d.row.start_time : time;
      const newEnd   = direction === 'end' ? time              : d.row.end_time;
      includedEdits.push({
        date: d.date, row: d.row, newStart, newEnd, key: dropRowKey(d.row),
        amended: eff.customTime !== undefined,
      });
    }
    if (includedEdits.length === 0) {
      const originalRules = new Set((allMemberBreaches || []).map((b) => b.rule));
      return {
        includedEdits: [], excludedEntries,
        stillBreachingDates: [], clearedDates: [],
        clearedOtherRules: [], remainingOtherRules: [...originalRules].filter((r) => r !== rule),
        newDurationHFirst: 0,
      };
    }
    const overrides = includedEdits.map((e) => [e.key, { newStart: e.newStart, newEnd: e.newEnd }]);
    const assessment = previewWithEdits(overrides);
    const memberPreviewBreaches = assessment.byMember?.[memberId]?.mlcBreaches || [];
    // SCOPED to included days only (D2 of density pass). Excluded days
    // have no edit applied, so their original times still breach in the
    // preview — they appeared in the unscoped set and caused the
    // readout to list the same dates in both "would still breach" and
    // "excluded" clauses. Scoping here cleanly separates "the chief's
    // trim didn't clear this day" from "this day wasn't trimmed at all".
    const includedDateSet = new Set(includedEdits.map((e) => e.date));
    const stillBreachingDates = new Set(
      memberPreviewBreaches
        .filter((b) => b.rule === rule && includedDateSet.has(b.date))
        .map((b) => b.date),
    );
    const clearedDates = includedEdits
      .filter((e) => !stillBreachingDates.has(e.date))
      .map((e) => e.date);
    // Other rules this member was breaching pre-edit — and their status
    // after the preview. Used for the co-breach readout shape.
    const originalRules = new Set((allMemberBreaches || []).map((b) => b.rule));
    const previewRules = new Set(memberPreviewBreaches.map((b) => b.rule));
    const otherOriginal = [...originalRules].filter((r) => r !== rule);
    const clearedOtherRules = otherOriginal.filter((r) => !previewRules.has(r));
    const remainingOtherRules = otherOriginal.filter((r) => previewRules.has(r));
    // Representative duration — first included edit; uniform recurring
    // shifts make this match every entry. Amended days may differ; the
    // per-day list shows the per-day duration accurately.
    const newDurationHFirst = computeNewDurationH(
      includedEdits[0].newStart, includedEdits[0].newEnd,
    );
    return {
      includedEdits,
      excludedEntries,
      stillBreachingDates: [...stillBreachingDates],
      clearedDates,
      clearedOtherRules,
      remainingOtherRules,
      newDurationHFirst,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, currentTime, direction, memberId, rule, perDayState]);

  // Collapsed state — the primary + secondary buttons.
  if (!open) {
    return (
      <div className="ap-mlc-lever-row">
        <button
          type="button"
          className="ap-mlc-shorten-btn"
          disabled={buttonsDisabled}
          title={culpritInfo.anyExisting ? existingTooltip : undefined}
          onClick={openEditor}
        >Shorten these {recurringDays} shifts</button>
        <button
          type="button"
          className="ap-mlc-drop-link"
          disabled={buttonsDisabled}
          title={culpritInfo.anyExisting ? existingTooltip : undefined}
          onClick={() => onBulkDropRows?.(culpritInfo.culprits, rule)}
        >or drop these shifts</button>
      </div>
    );
  }

  // Expanded inline editor.
  const dirData = prefill;
  const lbl = (rs) => joinAnd(rs.map((r) => MLC_RULE_SHORT_LABEL[r] || r));
  const ruleLabel = MLC_RULE_SHORT_LABEL[rule] || rule;
  const includedCount = previewState?.includedEdits.length ?? 0;
  const stillBreachingDates = previewState?.stillBreachingDates || [];
  const excludedEntries = previewState?.excludedEntries || [];
  const totalCount = recurringDays;
  const writtenCount = includedCount;
  const noChange = !!currentTime && (
    (direction === 'end'   && currentTime === String(culpritInfo.culprits[0]?.end_time ?? '').slice(0, 5)) ||
    (direction === 'start' && currentTime === String(culpritInfo.culprits[0]?.start_time ?? '').slice(0, 5))
  );
  const applyDisabled = writtenCount === 0 || noChange;

  // Original-times line — uniform recurring → any culprit row's times
  // are the same. Use the first.
  const originalRow = culpritInfo.culprits[0];
  const origStart = String(originalRow.start_time).slice(0, 5);
  const origEnd   = String(originalRow.end_time).slice(0, 5);
  const origDur   = computeNewDurationH(origStart, origEnd);

  // Build the readout. Precedence:
  //   1. direction non-viable → futile case (shouldn't reach here, the
  //      MlcMemberRow router catches it — but defensive copy is safe).
  //   2. no-change          → "Trimming from this end won't shorten…"
  //   3. structured         → "Trims X of N days…" + binding-rule
  //                           [why?] reveal + clears/breaches text
  // C3: writtenCount = chief's include=true count (chief controls
  // inclusion via Exclude/Include); stillBreachingDates surfaces the
  // would-still-breach days from preview but does NOT auto-exclude them.
  // D3 (density pass): the binding-rule explainer demotes to a [why?]
  // affordance — bindingExplain is computed here for the JSX to read
  // and the summary line no longer concatenates it inline. The render
  // appends a period after [why?] in the structured case via
  // summaryNeedsPeriod; non-viable and no-change cases set
  // summaryNeedsPeriod = false (their detail already supplies the
  // closing punctuation, or there's no detail).
  let readoutSummary;
  let readoutDetail;
  let bindingExplain = '';
  let summaryNeedsPeriod = false;
  if (!dirData || dirData.bulkDNewMaxH <= 0) {
    readoutSummary = `Can't shorten enough to clear — try Drop`;
    readoutDetail = '';
  } else if (noChange) {
    readoutSummary = `Trimming from this end won't shorten the shift`;
    readoutDetail = '— try the other end';
  } else {
    const newStartLabel = direction === 'end' ? origStart : currentTime;
    const newEndLabel   = direction === 'end' ? currentTime : origEnd;
    const durLabel = fmtHoursH(previewState?.newDurationHFirst ?? 0);
    const timesLabel = `${newStartLabel}–${newEndLabel} (${durLabel})`;
    const allWritten = writtenCount === totalCount;
    const verb = allWritten ? 'to' : 'at';
    const countLabel = allWritten ? `all ${totalCount} day${totalCount === 1 ? '' : 's'}` : `${writtenCount} of ${totalCount} days`;
    bindingExplain = BULK_BINDING_EXPLAIN[dirData.bulkBindingRule] || '';
    readoutSummary = `Trims ${countLabel} ${verb} ${timesLabel}`;
    summaryNeedsPeriod = true;
    const stillBreachDateRange = fmtDateRange(stillBreachingDates);
    const excludedDateRange = fmtDateRange(excludedEntries.map((e) => e.date));
    // Combined-form (D2): collapse the two clauses into one when EVERY
    // non-trimmed day is genuinely non-clearable by shortening. The
    // condition is intentionally strict.
    //
    // STRICTNESS COMMENT — do not loosen, please. The combined sentence
    // "The other N days (…) can't be cleared by shortening" makes a
    // universal claim about every non-trimmed day. If even one
    // non-trimmed day is "chief-excluded but actually viable" or
    // "viable in the other direction", that day CAN be cleared by
    // shortening (with an Include or a direction switch), and the
    // combined claim becomes a false statement. Fall back to separate
    // clauses in that case — each clause is locally correct. The four
    // gating conditions:
    //   (1) at least one non-trimmed day — otherwise "the other 0
    //       days …" is meaningless. Combined form needs a real set.
    //   (2) no included day still breaches THIS rule — otherwise the
    //       chief's trim partly missed the mark on a trimmed day, which
    //       deserves its own clause.
    //   (3) every non-trimmed day is in excludedEntries (no silent
    //       slippage in our accounting).
    //   (4) every excluded day is non-viable in BOTH directions — a day
    //       viable in the other direction could be rescued by toggling,
    //       and the combined claim would be false for it.
    const nonTrimmedCount = totalCount - writtenCount;
    const allOtherNonClearable =
      nonTrimmedCount > 0
      && stillBreachingDates.length === 0
      && excludedEntries.length === nonTrimmedCount
      && excludedEntries.every((e) =>
        !e.viableInBulkDirection && !e.viableInOtherDirection
      );

    const tailParts = [];
    if (writtenCount === 0) {
      tailParts.push(`No days selected — re-include some days or pick a different time`);
    } else if (allOtherNonClearable) {
      // Combined form — single sentence covers both "wouldn't trim" and
      // "can't clear" for the non-trimmed set. The four predicates
      // above guarantee this is a true statement.
      tailParts.push(`The other ${nonTrimmedCount} day${nonTrimmedCount === 1 ? '' : 's'} (${excludedDateRange}) can't be cleared by shortening`);
      // Co-breach still surfaces — combined form is about THIS rule's
      // non-clearability for the other days; other rules' status on
      // trimmed days is an independent compliance signal that must not
      // be hidden.
      if ((previewState?.remainingOtherRules || []).length > 0) {
        tailParts.push(`Trimmed days still breach ${lbl(previewState.remainingOtherRules)}`);
      }
    } else {
      // Fall back to separate clauses, each in range form.
      if (stillBreachingDates.length === 0) {
        if ((previewState?.remainingOtherRules || []).length > 0) {
          tailParts.push(`Clears ${ruleLabel} — still breaches ${lbl(previewState.remainingOtherRules)}`);
        } else {
          tailParts.push(`Clears the breach`);
        }
      } else {
        tailParts.push(`${stillBreachDateRange} would still breach ${ruleLabel}`);
      }
      if (excludedEntries.length > 0) {
        const needsOther = excludedEntries.some((e) => e.viableInOtherDirection);
        const otherDir = direction === 'end' ? 'start' : 'end';
        const dirReason = needsOther
          ? `would need ${otherDir}-trim`
          : `can't be cleared by shortening`;
        tailParts.push(`${excludedDateRange} excluded — ${dirReason}`);
      }
    }
    readoutDetail = tailParts.join('. ');
  }

  return (
    <div className="ap-mlc-shorten-panel">
      <div className="ap-mlc-shorten-head">Shorten — {recurringDays} days</div>

      <div className="ap-mlc-shorten-toggle">
        <span className="ap-mlc-shorten-label">Trim from:</span>
        <button
          type="button"
          className={`ap-mlc-shorten-tog${direction === 'end' ? ' is-on' : ''}`}
          onClick={() => switchDirection('end')}
        >End</button>
        <button
          type="button"
          className={`ap-mlc-shorten-tog${direction === 'start' ? ' is-on' : ''}`}
          onClick={() => switchDirection('start')}
        >Start</button>
      </div>

      <div className="ap-mlc-shorten-row">
        <span className="ap-mlc-shorten-label">Original:</span>
        <span className="ap-mlc-shorten-value">{origStart}–{origEnd}  ({fmtHoursH(origDur)})</span>
      </div>

      <div className="ap-mlc-shorten-row">
        <span className="ap-mlc-shorten-label">
          {direction === 'end' ? 'Bulk new end:' : 'Bulk new start:'}
        </span>
        <TimeSelect
          value={currentTime || ''}
          onChange={setCurrentTime}
          ariaLabel={direction === 'end' ? 'Bulk new end time' : 'Bulk new start time'}
        />
      </div>

      <div className="ap-mlc-shorten-readout">
        {readoutSummary}
        {bindingExplain && (
          <>
            {' '}
            <button
              type="button"
              className="ap-mlc-binding-why"
              aria-expanded={bindingWhyOpen}
              aria-controls="ap-mlc-binding-explain"
              onClick={() => setBindingWhyOpen((o) => !o)}
            >[why?]</button>
          </>
        )}
        {summaryNeedsPeriod && '.'}
        {readoutDetail && (
          <>
            {' '}
            {readoutDetail}
            {!readoutDetail.endsWith('.') ? '.' : ''}
          </>
        )}
      </div>
      {bindingExplain && bindingWhyOpen && (
        <div
          className="ap-mlc-binding-explain"
          id="ap-mlc-binding-explain"
        >{bindingExplain}.</div>
      )}

      <button
        type="button"
        className="ap-bulk-perday-toggle"
        aria-expanded={perDayOpen}
        onClick={() => setPerDayOpen((v) => !v)}
      >{perDayOpen ? '▾' : '▸'} Amend individual days</button>

      {perDayOpen && prefill && (
        <ul className="ap-bulk-perday-list">
          {prefill.perDay.map((dayEntry) => {
            const isAmending = amendOpenForDate === dayEntry.date;
            const eff = effectivePerDay(dayEntry.date);
            const date = dayEntry.date;
            const dateLabel = (() => {
              const d = fromStr(date);
              return `${WEEKDAY_SHORT[d.getDay()]} ${fmtDateShort(date)}`;
            })();

            if (isAmending) {
              return (
                <li key={date} className="ap-bulk-perday-row is-editing">
                  <span className="ap-bulk-perday-date">{dateLabel}</span>
                  <span className="ap-bulk-perday-amend-label">
                    {direction === 'end' ? 'New end:' : 'New start:'}
                  </span>
                  <TimeSelect
                    value={amendDraftTime || ''}
                    onChange={setAmendDraftTime}
                    ariaLabel="Custom new time"
                  />
                  <button
                    type="button" className="ap-bulk-perday-mini-confirm"
                    onClick={confirmAmend}
                  >Confirm</button>
                  <button
                    type="button" className="ap-bulk-perday-mini-cancel"
                    onClick={cancelAmend}
                  >Cancel</button>
                </li>
              );
            }

            if (!eff.include) {
              // Excluded — work out the honest reason.
              const isDirectionExcluded = !dayEntry.viableInBulkDirection;
              const needsOther = isDirectionExcluded && dayEntry.viableInOtherDirection;
              const otherDir = direction === 'end' ? 'start' : 'end';
              // Each reasonCopy carries its own connector — needs-other
              // and no-fix use the explanatory em-dash; chief-action
              // uses a prepositional phrase ("by you"). Lets the JSX
              // render "excluded {reasonCopy}" uniformly without
              // hard-coding an em-dash that reads awkwardly on the
              // chief-action variant.
              let reasonCopy;
              if (needsOther) {
                reasonCopy = `— needs ${otherDir}-trim`;
              } else if (isDirectionExcluded) {
                reasonCopy = `— can't be cleared by shortening`;
              } else {
                reasonCopy = `by you`;
              }
              return (
                <li key={date} className="ap-bulk-perday-row is-excluded">
                  <span className="ap-bulk-perday-date">{dateLabel}</span>
                  <span className="ap-bulk-perday-excluded">excluded {reasonCopy}</span>
                  <button
                    type="button" className="ap-bulk-perday-action"
                    onClick={() => includeDay(date)}
                  >Include</button>
                </li>
              );
            }

            // Included — compute the effective times for display.
            const time = eff.customTime ?? currentTime;
            const newStart = direction === 'end' ? dayEntry.row.start_time : time;
            const newEnd   = direction === 'end' ? time                       : dayEntry.row.end_time;
            const dur = computeNewDurationH(newStart, newEnd);
            const amended = eff.customTime !== undefined;
            const wouldStillBreach = (previewState?.stillBreachingDates || []).includes(date);
            return (
              <li
                key={date}
                className={`ap-bulk-perday-row${amended ? ' is-amended' : ''}${wouldStillBreach ? ' is-fall-out' : ''}`}
              >
                <span className="ap-bulk-perday-date">{dateLabel}</span>
                <span className="ap-bulk-perday-times">
                  {String(newStart).slice(0, 5)}–{String(newEnd).slice(0, 5)} ({fmtHoursH(dur)})
                  {amended && <span className="ap-bulk-perday-tag"> amended</span>}
                  {wouldStillBreach && <span className="ap-bulk-perday-tag ap-bulk-perday-tag-warn"> would still breach</span>}
                </span>
                {amended ? (
                  <button
                    type="button" className="ap-bulk-perday-action"
                    onClick={() => resetAmend(date)}
                  >Reset</button>
                ) : (
                  <>
                    <button
                      type="button" className="ap-bulk-perday-action"
                      onClick={() => openAmend(date)}
                    >Amend</button>
                    <button
                      type="button" className="ap-bulk-perday-action"
                      onClick={() => excludeDay(date)}
                    >Exclude</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="ap-mlc-shorten-actions">
        <button type="button" className="ap-mlc-shorten-cancel" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="ap-mlc-shorten-apply"
          disabled={applyDisabled}
          onClick={() => {
            const edits = (previewState?.includedEdits || []).map((e) => ({
              row: e.row, newStart: e.newStart, newEnd: e.newEnd,
            }));
            onBulkShortenRows?.(edits, rule);
            cancel();
          }}
        >Apply to {writtenCount} day{writtenCount === 1 ? '' : 's'}</button>
      </div>

      <button
        type="button"
        className="ap-mlc-drop-link ap-mlc-drop-link-tertiary"
        onClick={dropAll}
      >or drop these shifts</button>
    </div>
  );
}

function MlcMemberRow({ name, mlcBreaches, applyDates, memberId, allRows, onDropRow, onShortenRow, onBulkShortenRows, onBulkDropRows, computePrefillFor, computeBulkPrefillFor, previewWithEdit, previewWithEdits }) {
  const [open, setOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const chips = useMemo(() => ruleSummary(mlcBreaches), [mlcBreaches]);
  const ruleSummaries = useMemo(() => {
    // Group breaches by rule, preserving canonical order from MLC_RULE_CHIPS.
    const byRule = new Map();
    for (const b of mlcBreaches) {
      if (!byRule.has(b.rule)) byRule.set(b.rule, []);
      byRule.get(b.rule).push(b);
    }
    return MLC_RULE_CHIPS
      .filter(({ rule }) => byRule.has(rule))
      .map(({ rule }) => {
        const summary = summariseRule(rule, byRule.get(rule), applyDates);
        if (!summary) return null;
        return {
          rule,
          sentence: summary.sentence,
          advisory: adviseBreach(summary.worst?.diagnosis),
          diagnosis: summary.worst?.diagnosis,
          breaches: byRule.get(rule),
        };
      })
      .filter(Boolean);
  }, [mlcBreaches, applyDates]);
  return (
    <li className={`ap-mlc-member${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="ap-mlc-member-trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown size={12} className="ap-mlc-member-chev" />
        <span className="ap-mlc-member-name">{name}</span>
        <span className="ap-mlc-chips">
          {chips.map((c) => (
            <span
              key={c.rule}
              className={`ap-mlc-chip ap-mlc-chip-${chipSeverity(c.dayCount)}`}
            >
              <span className="ap-mlc-chip-label">{c.label}</span>
              <span className="ap-mlc-chip-sep">·</span>
              <span className="ap-mlc-chip-days">{c.dayCount}d</span>
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="ap-mlc-member-expand">
          <ul className="ap-mlc-rule-summary">
            {ruleSummaries.map((rs) => {
              const cause = rs.diagnosis?.cause;
              const isShortenRule = cause === 'single_long_shift';
              const isDropOnlyRule = cause === 'one_spike_day';
              const recurringDays = isShortenRule ? rs.breaches.length : 0;
              const goBulk = isShortenRule && recurringDays >= 2;

              // Bulk-futility check (recurringDays ≥ 2 only). Run the
              // bulk prefill against this rule's culprits + a preview
              // pass; if zero days clear, the bulk lever is futile and
              // we render <ShortenFutileMessage> in its place.
              //
              // NOTE on retroactive grouping (v1.2 deliberate behaviour):
              // already-committed single-day shortens DO NOT re-group
              // into a bulk lever later — by design. Those days no
              // longer carry the breach in rs.breaches (the shorten
              // cleared it), so recurringDays here reflects only the
              // breaches that REMAIN unfixed. The bulk lever exists
              // for the case the chief encounters BEFORE any per-day
              // commits. If the chief restores all the per-day edits,
              // the original N-day recurring breach reappears and the
              // bulk lever renders for it next open.
              let futile = false;
              let futileCulprits = []; // promoted out of the futility-detection
                                       // block so the compact futile render
                                       // below can pass them to the Drop link.
              if (goBulk) {
                const culprits = rs.breaches
                  .map((b) => resolveDropCulprit({ diagnosis: b.diagnosis, memberId, allRows }))
                  .filter((r) => r.row && r.reason !== 'existing')
                  .map((r) => r.row);
                futileCulprits = culprits;
                if (culprits.length === 0) {
                  futile = true;
                } else {
                  const p = computeBulkPrefillFor(culprits);
                  if (!p || p.bulkDNewMaxH <= 0) {
                    futile = true;
                  } else {
                    // Preview the bulk's per-day edits across all viable
                    // days; count cleared days for this rule.
                    const overrides = p.perDay
                      .filter((d) => d.viableInBulkDirection && d.row)
                      .map((d) => [
                        dropRowKey(d.row),
                        { newStart: d.newStart, newEnd: d.newEnd },
                      ]);
                    if (overrides.length === 0) {
                      futile = true;
                    } else {
                      const preview = previewWithEdits(overrides);
                      const previewBreachDates = new Set(
                        (preview.byMember?.[memberId]?.mlcBreaches || [])
                          .filter((b) => b.rule === rs.rule)
                          .map((b) => b.date),
                      );
                      const originalDates = new Set(rs.breaches.map((b) => b.date));
                      const cleared = [...originalDates].filter((d) => !previewBreachDates.has(d));
                      futile = cleared.length === 0;
                    }
                  }
                }
              }

              // one_spike_day keeps the v1 single Drop button unchanged.
              let dropOnly = null;
              if (isDropOnlyRule) {
                const { row: culpritRow, reason } = resolveDropCulprit({
                  diagnosis: rs.diagnosis, memberId, allRows,
                });
                const enabled = !!culpritRow;
                const tooltip = reason === 'existing'
                  ? 'This shift is already on the rota — edit it from the grid.'
                  : undefined;
                dropOnly = (
                  <button
                    type="button"
                    className="ap-mlc-drop-btn"
                    disabled={!enabled}
                    title={tooltip}
                    onClick={enabled ? () => onDropRow?.(culpritRow, rs.rule) : undefined}
                  >Drop this shift</button>
                );
              }
              // Density-pass C1: the futile branch suppresses the verbose
              // rule sentence + Why advisory and renders a single compact
              // two-line block. The 8-line stack of (sentence + advisory +
              // futile message) collapses to (regulatory line + action
              // line with Drop link). The chief loses nothing compliance-
              // critical — the rule title, day count, worst projected
              // value, and MLC limit all survive on the regulatory line.
              if (goBulk && futile) {
                const worstBreach = pickWorstBreach(rs.rule, rs.breaches);
                return (
                  <li key={rs.rule}>
                    <ShortenFutileCompact
                      rule={rs.rule}
                      worstBreach={worstBreach}
                      breachCount={rs.breaches.length}
                      culpritRows={futileCulprits}
                      onBulkDropRows={onBulkDropRows}
                    />
                  </li>
                );
              }
              return (
                <li key={rs.rule}>
                  <div className="ap-mlc-rule-sentence">{rs.sentence}</div>
                  {rs.advisory && (
                    <div className="ap-mlc-rule-advisory">{rs.advisory}</div>
                  )}
                  {isShortenRule && !goBulk && (
                    <ShortenLever
                      rule={rs.rule}
                      diagnosis={rs.diagnosis}
                      memberId={memberId}
                      mlcBreaches={mlcBreaches}
                      allRows={allRows}
                      computePrefillFor={computePrefillFor}
                      previewWithEdit={previewWithEdit}
                      onShortenRow={onShortenRow}
                      onDropRow={onDropRow}
                    />
                  )}
                  {goBulk && !futile && (
                    <BulkShortenLever
                      rule={rs.rule}
                      breaches={rs.breaches}
                      allMemberBreaches={mlcBreaches}
                      memberId={memberId}
                      allRows={allRows}
                      computeBulkPrefillFor={computeBulkPrefillFor}
                      previewWithEdits={previewWithEdits}
                      onBulkShortenRows={onBulkShortenRows}
                      onBulkDropRows={onBulkDropRows}
                    />
                  )}
                  {dropOnly}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="ap-mlc-detail-toggle"
            aria-expanded={showDetail}
            onClick={() => setShowDetail((s) => !s)}
          >
            {showDetail ? 'Hide day-by-day detail' : 'Show day-by-day detail'}
          </button>
          {showDetail && (
            <ul className="ap-mlc-member-detail">
              {mlcBreaches.map((b, i) => (
                <li key={`${b.rule}-${b.date}-${i}`}>
                  {formatMlcBreachPhrase(b)} on <strong>{fmtDateShort(b.date)}</strong>.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ── Crew-row inline-select (used by the pattern-apply role slots) ──────────
function CrewSelect({ value, candidates, onChange, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)
          && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = candidates.find((c) => c.id === value) || null;
  const display = selected ? selected.name : (placeholder || '—');

  return (
    <div className={`cs-wrap${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="cs-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="cs-value">{display}</span>
        <ChevronDown size={12} className="cs-chev" />
      </button>
      {open && (
        <div ref={menuRef} className="cs-menu" role="listbox">
          {candidates.length === 0 && (
            <div className="cs-empty">No crew with this job title.</div>
          )}
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === value}
              className={`cs-opt${c.id === value ? ' is-active' : ''}`}
              onClick={() => { onChange?.(c.id); setOpen(false); }}
            >
              <span className="cs-opt-name">{c.name}</span>
              {c.subtitle && <span className="cs-opt-sub">{c.subtitle}</span>}
            </button>
          ))}
          {value && (
            <button
              type="button"
              className="cs-opt cs-opt-clear"
              onClick={() => { onChange?.(null); setOpen(false); }}
            >Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Collapsible crew picker for simple-apply (Part C) ──────────────────────
function CrewCollapsible({ visibleCrew, ticked, setTicked, hodHint }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  const tickedList = visibleCrew.filter((c) => ticked.has(c.id));
  const inlineLabel = (() => {
    if (tickedList.length === 0) return 'No crew selected';
    if (tickedList.length <= 3) return tickedList.map((c) => firstName(c.name)).join(', ');
    const heads = tickedList.slice(0, 2).map((c) => firstName(c.name)).join(', ');
    return `${heads} +${tickedList.length - 2}`;
  })();

  const toggleAll = (on) => {
    if (on) setTicked(new Set(visibleCrew.map((c) => c.id)));
    else setTicked(new Set());
  };

  return (
    <div className="ap-crew-collapsible">
      <button
        ref={triggerRef}
        type="button"
        className={`ap-crew-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ap-crew-inline">
          <span className="ap-crew-count">{tickedList.length}</span>
          <span className="ap-crew-names">{inlineLabel}</span>
        </span>
        <ChevronDown size={14} className="ap-crew-chev" />
      </button>
      {open && (
        <div className="ap-crew-expanded">
          <div className="ap-crew-actions-row">
            <button type="button" className="ap-linkbtn"
              onClick={() => toggleAll(true)}>Select all</button>
            <span className="tp-dot">·</span>
            <button type="button" className="ap-linkbtn"
              onClick={() => toggleAll(false)}>None</button>
          </div>
          {hodHint && <div className="ap-hod-hint">{hodHint}</div>}
          <div className="ap-crew-list">
            {visibleCrew.length === 0 && <div className="ap-empty">No eligible crew.</div>}
            {visibleCrew.map((c) => {
              const isOn = ticked.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`te-dept-row${isOn ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => setTicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                      return next;
                    })}
                  />
                  <span className="ap-crew-name">{c.name}</span>
                  <span className="ap-crew-role">{c.role || ''}</span>
                  <span className="ap-crew-dept">{c.department || ''}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────
export default function ApplyTemplateModal({
  open, template, rota, trip, crew = [], currentUser, tier, myMemberId,
  applyTemplate, ensureDraft, onClose, onApplied, onToast,
}) {
  const isPattern = template?.kind === 'rotation';
  const hodDeptId = tier === 'HOD' ? (currentUser?.department_id || null) : null;
  const visibleCrew = useMemo(() => {
    if (!hodDeptId) return crew;
    return crew.filter((c) => c.departmentId === hodDeptId);
  }, [crew, hodDeptId]);

  // ── Date range state — used by both paths. Default = This week. ────
  const [range, setRange] = useState(() => defaultRange());

  // ── Simple-apply state: who's ticked ───────────────────────────────
  const [ticked, setTicked] = useState(() => new Set());

  // ── Pattern-apply WORK MODEL (in-memory, this-apply-only) ─────────
  // slots[] mirrors template.body.roles[] by position so the pass-the-
  // baton math (cellDutyIndex(j, k) using slot index j) still works
  // unchanged. The template row is NEVER mutated — drop / double / un-
  // drop affect this state only.
  //   { title, members: [memberId|null] (1 or 2), dropped: bool }
  const [slots, setSlots] = useState([]);

  // ── Modal-phase state (shared) ─────────────────────────────────────
  // Staged review flow:
  //   'select'    → user is configuring the apply
  //   'conflicts' → Stage 1: resolve shift conflicts (skip vs overwrite)
  //   'mlc'       → Stage 2: MLC + circadian against the post-resolution
  //                  roster; mandatory reason on MLC breaches
  //   'applying'  → DB write in flight
  //
  // The breach analysis on Stage 2 is recomputed against the chosen
  // resolution, so the advisory describes the roster that will actually
  // land — not a worst-case union.
  const [phase, setPhase] = useState('select');
  const [conflicts, setConflicts] = useState(null);
  const [historyShifts, setHistoryShifts] = useState([]);
  const [resolutionMode, setResolutionMode] = useState(null); // 'skip' | 'overwrite' | null
  const [assessment, setAssessment] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Lever-pulled drops — per-modal session, keyed by dropRowKey.
  // Value carries the full proposed row + the rule the chief was looking
  // at when they pulled the lever (audit attribution in commit 3).
  const [droppedRows, setDroppedRows] = useState(() => new Map());
  // Lever-pulled shortens (v1.1). Keyed by the ORIGINAL row's dropRowKey.
  // Value: { row (original), newStart, newEnd, byRule }. Mutually
  // exclusive with droppedRows for the same key — enforced by the drop /
  // shorten handlers, NOT by pushIfNew (which would otherwise need to
  // decide an arbitrary winner).
  const [editedRows, setEditedRows] = useState(() => new Map());

  // ── Re-seed on open / template change ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    setRange(defaultRange());
    setPhase('select');
    setConflicts(null);
    setHistoryShifts([]);
    setResolutionMode(null);
    setAssessment(null);
    setOverrideReason('');
    setDroppedRows(new Map());
    setEditedRows(new Map());
    setBusy(false);

    if (template?.kind === 'rotation') {
      // Auto-match per slot — pre-pick the first eligible crew currently
      // active, skipping anyone already taken by an earlier slot. Same job
      // title with no fresh eligible crew left → member null (manual pick).
      const titles = Array.isArray(template?.body?.roles) ? template.body.roles : [];
      const picked = new Set();
      const seeded = titles.map((title) => {
        const eligible = visibleCrew.find((c) =>
          (c.role || '') === (title || '')
          && (c.currentStatus === 'active' || c.currentStatus == null)
          && !picked.has(c.id),
        );
        if (eligible) picked.add(eligible.id);
        return { title, members: [eligible?.id || null], dropped: false, widen: false };
      });
      setSlots(seeded);
      setTicked(new Set());
    } else {
      let initialTicked;
      if (template?.scope === 'department' && template?.departmentId) {
        initialTicked = new Set(visibleCrew
          .filter((c) => c.departmentId === template.departmentId)
          .map((c) => c.id));
      } else {
        initialTicked = new Set();
      }
      setTicked(initialTicked);
      setSlots([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  // Default the start to the trip start when the rota is trip-owned,
  // and the end to the trip end — but only seed on open, never overwrite
  // the user's subsequent edits.
  useEffect(() => {
    if (!open) return;
    if (rota?.ownerType === 'trip' && trip?.dateStart && trip?.dateEnd) {
      setRange({ start: trip.dateStart, end: trip.dateEnd });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  // ── Derived ────────────────────────────────────────────────────────
  const dates = useMemo(() => rangeDays(range?.start, range?.end), [range]);

  // For simple apply
  const tickedMemberIds = Array.from(ticked);

  // For pattern apply
  const duties = useMemo(
    () => Array.isArray(template?.body?.duties) ? template.body.duties : [],
    [template],
  );
  const slotTitles = useMemo(
    () => Array.isArray(template?.body?.roles) ? template.body.roles : [],
    [template],
  );
  const candidatesPerSlot = useMemo(() => slotTitles.map((slotTitle) => {
    return visibleCrew
      .filter((c) => (c.role || '') === (slotTitle || ''))
      .map((c) => ({
        id: c.id,
        name: c.name,
        subtitle: c.department || '',
        active: c.currentStatus === 'active' || c.currentStatus == null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }), [slotTitles, visibleCrew]);

  // Fallback pools for slots whose job title matches NO active crew
  // (placeholder labels like "Role 3", or a real title with no current
  // active holder). The dropdown is never dead — the user can pick from
  // the template's department crew (default), or widen to all vessel
  // crew. The subtitle in fallback shows the crew's REAL job title so
  // the user can tell who they're picking.
  const fallbackDept = useMemo(() => {
    if (template?.scope !== 'department' || !template?.departmentId) return null;
    return visibleCrew
      .filter((c) => c.departmentId === template.departmentId)
      .map((c) => ({
        id: c.id, name: c.name, subtitle: c.role || c.department || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [template, visibleCrew]);
  const fallbackAll = useMemo(() => visibleCrew
    .map((c) => ({
      id: c.id, name: c.name, subtitle: c.role || c.department || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  [visibleCrew]);

  // Returns { items, source: 'match' | 'dept' | 'all' } for a slot.
  const resolveSlotCandidates = (j) => {
    const matches = candidatesPerSlot[j] || [];
    if (matches.length > 0) return { items: matches, source: 'match' };
    const slot = slots[j];
    if (slot?.widen) return { items: fallbackAll, source: 'all' };
    if (fallbackDept) return { items: fallbackDept, source: 'dept' };
    return { items: fallbackAll, source: 'all' };
  };

  // ── Pattern duty resolution: duty[(j - k + N) mod N] ───────────────
  const N = duties.length;
  const M = slotTitles.length;                            // template-defined slot count
  const effectiveM = slots.filter((s) => !s.dropped).length;  // live, this-apply only
  const cellDutyIndex = (j, k) => (j < N ? ((j - k + N) % N) : null);

  // ── Slot mutators (in-memory, never touch the template) ────────────
  const dropSlot = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j ? { ...s, dropped: true } : s)));
  const restoreSlot = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j ? { ...s, dropped: false } : s)));
  const setSlotMember = (j, mIdx, memberId) => setSlots((prev) =>
    prev.map((s, i) => {
      if (i !== j) return s;
      const members = [...s.members];
      while (members.length <= mIdx) members.push(null);
      members[mIdx] = memberId;
      return { ...s, members };
    }));
  const addDouble = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j && s.members.length < 2
      ? { ...s, members: [...s.members, null] }
      : s)));
  const removeDouble = (j) => setSlots((prev) =>
    prev.map((s, i) => (i === j
      ? { ...s, members: s.members.slice(0, 1) }
      : s)));
  // Widen toggle for no-match / placeholder slots. When narrowing back to
  // the template's department, any previously-picked crew member who isn't
  // in that department is cleared from the slot so the dropdown trigger
  // doesn't silently show a placeholder while the assignment quietly
  // persists. The opposite direction (widen on) keeps all picks.
  const toggleWiden = (j) => setSlots((prev) => prev.map((s, i) => {
    if (i !== j) return s;
    const nextWiden = !s.widen;
    if (!nextWiden && template?.scope === 'department' && template?.departmentId) {
      const eligible = new Set(visibleCrew
        .filter((c) => c.departmentId === template.departmentId)
        .map((c) => c.id));
      return {
        ...s,
        widen: false,
        members: s.members.map((mid) => (mid && eligible.has(mid) ? mid : null)),
      };
    }
    return { ...s, widen: nextWiden };
  }));

  // ── Row builder ────────────────────────────────────────────────────
  // Returns null when the template body / duty is missing required times
  // OR when start_time === end_time. The fallback-to-'00:00' default that
  // historically silently emitted bad rows is gone: a missing time now
  // fails loud (skipped + counted for the toast) rather than landing in
  // the DB as a 24h placeholder.
  const buildSimpleRow = (memberId, dateStr) => {
    const body = template.body || {};
    const startTime = body.start_time;
    const endTime = body.end_time;
    if (!startTime || !endTime || startTime === endTime) return null;
    const row = {
      tenant_id: rota?.tenantId,
      rota_id: rota?.id,
      member_id: memberId,
      shift_date: dateStr,
      start_time: startTime,
      end_time: endTime,
      shift_type: body.shift_type || 'duty',
    };
    if (body.sub_type) row.sub_type = body.sub_type;
    if (rota?.ownerType === 'trip' && rota?.tripId) row.trip_id = rota.tripId;
    if (myMemberId) row.created_by = myMemberId;
    return row;
  };
  const buildPatternRow = (memberId, dateStr, duty) => {
    const startTime = duty?.start_time;
    const endTime = duty?.end_time;
    if (!startTime || !endTime || startTime === endTime) return null;
    const row = {
      tenant_id: rota?.tenantId,
      rota_id: rota?.id,
      member_id: memberId,
      shift_date: dateStr,
      start_time: startTime,
      end_time: endTime,
      shift_type: duty?.shift_type || 'duty',
    };
    if (duty?.sub_type) row.sub_type = duty.sub_type;
    if (rota?.ownerType === 'trip' && rota?.tripId) row.trip_id = rota.tripId;
    if (myMemberId) row.created_by = myMemberId;
    return row;
  };

  // ── Build the full "what would be written" list ────────────────────
  // Belt-and-braces defensive dedupe (ccaeb41): collapse TRULY identical
  // rows. A crew member legitimately doubled into two slots doing
  // DIFFERENT duties on the same day still produces two rows. Lever-
  // dropped rows are filtered here so they never reach commit. Lever-
  // edited rows (v1.1 shorten) have their start/end overridden here.
  //
  // Factored as a helper so reassessAfterLever can call it with NEXT
  // state (the in-flight droppedRows/editedRows Maps that haven't yet
  // applied via setState). targetRowsAndMembers' useMemo calls it with
  // CURRENT state from this render.
  const buildProposedRows = (effDropped, effEdited) => {
    if (!template || dates.length === 0) {
      return { rows: [], memberIds: [], duplicatesDropped: 0, invalidTimesDropped: 0, leverDropped: 0 };
    }
    const rows = [];
    const memberSet = new Set();
    const seen = new Set();
    let duplicatesDropped = 0;
    let invalidTimesDropped = 0;
    let leverDropped = 0;
    const pushIfNew = (rowIn) => {
      // The row builder returns null when the template / duty carries
      // missing or equal times — count and skip rather than coerce.
      if (rowIn == null) { invalidTimesDropped += 1; return; }
      const originalKey = dropRowKey(rowIn);
      // Drop precedence — drop wins over edit when both are present for
      // the same key (the handlers maintain mutual exclusion, but this
      // is the last-line guarantee).
      if (effDropped.has(originalKey)) { leverDropped += 1; return; }
      // Edit application — swap times if this row has been shortened.
      const row = effEdited.has(originalKey)
        ? { ...rowIn,
            start_time: effEdited.get(originalKey).newStart,
            end_time: effEdited.get(originalKey).newEnd }
        : rowIn;
      const finalKey = dropRowKey(row); // recomputed since times may have changed
      if (seen.has(finalKey)) { duplicatesDropped += 1; return; }
      seen.add(finalKey);
      rows.push(row);
      memberSet.add(row.member_id);
    };
    if (isPattern) {
      for (let k = 0; k < dates.length; k += 1) {
        const dateStr = dates[k];
        for (let j = 0; j < slots.length; j += 1) {
          const slot = slots[j];
          if (slot.dropped) continue;
          const di = cellDutyIndex(j, k);
          if (di == null) continue;
          for (const memberId of slot.members) {
            if (!memberId) continue;
            pushIfNew(buildPatternRow(memberId, dateStr, duties[di]));
          }
        }
      }
    } else {
      for (const m of tickedMemberIds) {
        for (const d of dates) pushIfNew(buildSimpleRow(m, d));
      }
    }
    return {
      rows,
      memberIds: Array.from(memberSet),
      duplicatesDropped,
      invalidTimesDropped,
      leverDropped,
    };
  };

  const targetRowsAndMembers = useMemo(
    () => buildProposedRows(droppedRows, editedRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, dates, isPattern, slots, ticked, duties, droppedRows, editedRows],
  );

  if (!open || !template) return null;

  // ── Header detail (preview doubles as header) ──────────────────────
  const headerScope = template.scope === 'vessel'
    ? 'All departments'
    : (template.departmentName || 'Department');
  const headerEyebrow = isPattern ? 'Apply shift pattern' : 'Apply template';
  const headerSwatch = isPattern
    ? null
    : (TYPE_COLOR[template.body?.shift_type] || '#B4B2A9');
  const headerHours = !isPattern
    ? (template.body?.start_time && template.body?.end_time
        ? `${fmtTime(template.body.start_time)} – ${fmtTime(template.body.end_time)}`
        : '—')
    : null;

  // ── Assessment helper — runs assessApply against the post-resolution
  // roster the chosen mode would produce. `mode` is 'skip' | 'overwrite'
  // | 'none' (no conflicts present). conflictKeys / conflictIdSet drive
  // the filtering so the breach analysis describes what will actually land.
  const computeAssessmentFor = ({ memberIds, proposedRows, existingShifts, mode, conflictKeys, conflictIdSet }) => {
    let effProposed = proposedRows;
    let effExisting = existingShifts;
    if (mode === 'skip') {
      effProposed = proposedRows.filter((r) => !conflictKeys.has(`${r.member_id}|${r.shift_date}`));
    } else if (mode === 'overwrite') {
      effExisting = existingShifts.filter((s) => !conflictIdSet.has(s.id));
    }
    return assessApply({
      memberIds,
      dates,
      proposedRows: effProposed,
      existingWindowShifts: effExisting,
    });
  };

  // Third caller of computeAssessmentFor — matches the shape of the two
  // existing callers (sync; computeAssessmentFor itself is sync, only the
  // wrappers around the supabase queries are async). No spinner: the
  // re-assessment is a pure-function call on already-resident data.
  //
  // Drop and edit Maps are passed explicitly because setState is async:
  // the freshly-mutated maps aren't visible via the droppedRows/editedRows
  // closures on this tick. buildProposedRows is re-run with the IN-FLIGHT
  // maps so the assessment reflects the post-mutation state immediately.
  // (v1's earlier version filtered targetRowsAndMembers.rows directly —
  // that worked for adding drops but failed for restores: a row newly
  // undropped wouldn't reappear because the closure-captured `.rows` was
  // the already-filtered set. The buildProposedRows refactor closes that
  // gap.)
  const reassessAfterLever = (nextDroppedRows, nextEditedRows) => {
    const effDropped = nextDroppedRows ?? droppedRows;
    const effEdited  = nextEditedRows  ?? editedRows;
    const { rows: filteredRows, memberIds } = buildProposedRows(effDropped, effEdited);
    const mode = conflicts ? (resolutionMode || 'skip') : 'none';
    const conflictKeys = (conflicts && mode === 'skip') ? conflicts.conflictKeys : new Set();
    const conflictIdSet = new Set(conflicts?.conflictIds || []);
    const next = computeAssessmentFor({
      memberIds,
      proposedRows: filteredRows,
      existingShifts: historyShifts,
      mode,
      conflictKeys,
      conflictIdSet,
    });
    setAssessment(next);
  };

  // One-off preview — does NOT mutate state. Returns the assessment as if
  // the named rows had been edited. v1.1's previewWithEdit is the single-
  // key wrapper. v1.2 needs the multi-key form for the bulk lever's live
  // readout (apply N edits at once and see which days clear).
  //
  // overrides: iterable of [key, {newStart, newEnd}] entries — either a
  // Map or a plain array of tuples.
  const previewWithEdits = (overrides) => {
    const previewEditedMap = new Map(editedRows);
    // The preview entry doesn't need a `row` field — buildProposedRows
    // only reads .newStart / .newEnd. The full row reference is only
    // needed by the Shortened panel for restoration display.
    for (const [key, edit] of overrides) {
      previewEditedMap.set(key, edit);
    }
    const { rows: previewRows, memberIds } = buildProposedRows(droppedRows, previewEditedMap);
    const mode = conflicts ? (resolutionMode || 'skip') : 'none';
    const conflictKeys = (conflicts && mode === 'skip') ? conflicts.conflictKeys : new Set();
    const conflictIdSet = new Set(conflicts?.conflictIds || []);
    return computeAssessmentFor({
      memberIds,
      proposedRows: previewRows,
      existingShifts: historyShifts,
      mode,
      conflictKeys,
      conflictIdSet,
    });
  };
  const previewWithEdit = (key, newStart, newEnd) =>
    previewWithEdits([[key, { newStart, newEnd }]]);

  // Drop-lever click handler. Adds the row's composite key to droppedRows
  // and immediately re-runs the assessment on the post-drop row set.
  // Idempotent: re-dropping an already-dropped row is a no-op.
  //
  // Mutual exclusion (v1.1): if the row was previously shortened, the
  // edit is cleared at the same time. Drop wins.
  const handleDropRow = (row, byRule) => {
    if (!row) return;
    const key = dropRowKey(row);
    if (droppedRows.has(key)) return;
    const nextDropped = new Map(droppedRows);
    nextDropped.set(key, { row, byRule });
    let nextEdited = editedRows;
    if (editedRows.has(key)) {
      nextEdited = new Map(editedRows);
      nextEdited.delete(key);
      setEditedRows(nextEdited);
    }
    setDroppedRows(nextDropped);
    reassessAfterLever(nextDropped, nextEdited);
  };

  // Restore handler — paired with handleDropRow. Removes the key from
  // droppedRows and re-runs the assessment so the row reappears in the
  // proposed set and any breach it caused comes back into the list.
  // The mutual-exclusion invariant means editedRows is already empty
  // for this key at restore time, so no edit handling is needed.
  const handleRestoreRow = (key) => {
    if (!droppedRows.has(key)) return;
    const next = new Map(droppedRows);
    next.delete(key);
    setDroppedRows(next);
    reassessAfterLever(next, editedRows);
  };

  // Pre-fill helper exposed to the inline shorten editor. Bundles the
  // closure over historyShifts + targetRowsAndMembers.rows so the editor
  // component doesn't need to know about the data sources. dayShifts
  // matches restForDay's model — filtered by shift_date — so prefill
  // agrees with assessMlc's view of "daily on-duty".
  const computeShortenPrefillFor = (culpritRow) => {
    if (!culpritRow) return null;
    const date = culpritRow.shift_date;
    const memberId = culpritRow.member_id;
    const [y, mn, d] = date.split('-').map(Number);
    const winStart = new Date(y, mn - 1, d);
    winStart.setDate(winStart.getDate() - 6);
    const winStartStr = `${winStart.getFullYear()}-${pad(winStart.getMonth() + 1)}-${pad(winStart.getDate())}`;
    const toCamel = (r) => ({
      date: r.shift_date,
      startTime: r.start_time,
      endTime: r.end_time,
      shiftType: r.shift_type,
      subType: r.sub_type ?? null,
    });
    const shift = toCamel(culpritRow);
    const allShifts = [
      ...historyShifts.filter((r) => r.member_id === memberId).map(toCamel),
      ...targetRowsAndMembers.rows.filter((r) => r.member_id === memberId).map(toCamel),
    ];
    const dayShifts = allShifts.filter((s) => s.date === date);
    const weekShifts = allShifts.filter((s) => s.date >= winStartStr && s.date <= date);
    return computeShortenPrefill({ shift, dayShifts, weekShifts });
  };

  // Bulk pre-fill helper (v1.2). For a recurring single_long_shift breach
  // across N days, derive per-day {shift, dayShifts, weekShifts} contexts
  // the same way computeShortenPrefillFor does, then call the bulk math.
  // Caller passes the array of culprit proposed rows (one per breaching
  // day for this member+rule).
  const computeBulkPrefillFor = (culpritRows, directionOverride) => {
    if (!culpritRows || culpritRows.length === 0) return null;
    const toCamel = (r) => ({
      date: r.shift_date,
      startTime: r.start_time,
      endTime: r.end_time,
      shiftType: r.shift_type,
      subType: r.sub_type ?? null,
    });
    const perDay = culpritRows.map((culpritRow) => {
      const date = culpritRow.shift_date;
      const memberId = culpritRow.member_id;
      const [y, mn, d] = date.split('-').map(Number);
      const winStart = new Date(y, mn - 1, d);
      winStart.setDate(winStart.getDate() - 6);
      const winStartStr = `${winStart.getFullYear()}-${pad(winStart.getMonth() + 1)}-${pad(winStart.getDate())}`;
      const shift = toCamel(culpritRow);
      const allShifts = [
        ...historyShifts.filter((r) => r.member_id === memberId).map(toCamel),
        ...targetRowsAndMembers.rows.filter((r) => r.member_id === memberId).map(toCamel),
      ];
      const dayShifts = allShifts.filter((s) => s.date === date);
      const weekShifts = allShifts.filter((s) => s.date >= winStartStr && s.date <= date);
      return { shift, dayShifts, weekShifts, row: culpritRow };
    });
    return computeBulkShortenPrefill({ perDay, directionOverride });
  };

  // Shorten-lever click handler (v1.1). Records the new times in
  // editedRows under the row's ORIGINAL composite key, then re-runs the
  // assessment with the in-flight maps. Mutual exclusion: clears any
  // prior drop on the same key (shorten supersedes drop).
  const handleShortenRow = (row, newStart, newEnd, byRule) => {
    if (!row || !newStart || !newEnd) return;
    const key = dropRowKey(row);
    const nextEdited = new Map(editedRows);
    // bulkGroupId = null on single-day shortens; the audit reader uses
    // null to distinguish from bulk operations (v1.2 C4).
    nextEdited.set(key, { row, newStart, newEnd, byRule, bulkGroupId: null });
    let nextDropped = droppedRows;
    if (droppedRows.has(key)) {
      nextDropped = new Map(droppedRows);
      nextDropped.delete(key);
      setDroppedRows(nextDropped);
    }
    setEditedRows(nextEdited);
    reassessAfterLever(nextDropped, nextEdited);
  };

  // Restore handler — paired with handleShortenRow. Removes the edit,
  // re-runs the assessment so the row returns to its original times in
  // proposed and any breach it caused reappears in the list. Mutual-
  // exclusion invariant means droppedRows is already empty for this key.
  const handleRestoreShorten = (key) => {
    if (!editedRows.has(key)) return;
    const next = new Map(editedRows);
    next.delete(key);
    setEditedRows(next);
    reassessAfterLever(droppedRows, next);
  };

  // Bulk shorten handler (v1.2). ATOMIC writer: builds the next
  // editedRows / droppedRows once and commits both via single setState
  // calls (React 18 auto-batches inside event handlers, so the two
  // setStates render as one transition). Reassesses once with the
  // post-bulk maps. No intermediate state where some days are
  // shortened and others aren't.
  //
  // ATOMICITY NOTE: the single-transition guarantee depends on React 18
  // event-handler auto-batching. Calling this from outside an event
  // handler (a setTimeout, a promise resolve callback, etc.) would
  // render the two setStates separately — an intermediate render would
  // show editedRows updated but droppedRows still stale. Today every
  // call site is a click handler so this is fine; if a future call
  // site is asynchronous, wrap the two setStates in unstable_batched
  // updates or restructure to a single state object.
  //
  // perDayEdits: Array<{ row, newStart, newEnd }> — one entry per
  // included day. byRule attribution is uniform across the bulk.
  const handleBulkShorten = (perDayEdits, byRule) => {
    if (!Array.isArray(perDayEdits) || perDayEdits.length === 0) return;
    // One UUID per bulk Apply — every entry written by this call shares
    // it (v1.2 C4). Restoration of some entries doesn't change surviving
    // entries' bulk_group_id. Per-day amendments committed in the SAME
    // Apply call (chief amended a row mid-lever-edit, then clicked Apply
    // once) share the same UUID as their in-bulk siblings — they were
    // part of the same bulk operation. Subsequent re-bulks generate
    // fresh UUIDs.
    const bulkGroupId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const nextEdited = new Map(editedRows);
    let nextDropped = droppedRows;
    let droppedMutated = false;
    for (const { row, newStart, newEnd } of perDayEdits) {
      if (!row || !newStart || !newEnd) continue;
      const key = dropRowKey(row);
      nextEdited.set(key, { row, newStart, newEnd, byRule, bulkGroupId });
      if (droppedRows.has(key)) {
        // Mutual exclusion: shorten supersedes any prior drop.
        if (!droppedMutated) {
          nextDropped = new Map(droppedRows);
          droppedMutated = true;
        }
        nextDropped.delete(key);
      }
    }
    if (droppedMutated) setDroppedRows(nextDropped);
    setEditedRows(nextEdited);
    reassessAfterLever(droppedMutated ? nextDropped : droppedRows, nextEdited);
  };

  // Bulk drop handler (v1.2). Atomic counterpart to handleBulkShorten —
  // drops N rows in one transition. Used by the bulk lever's tertiary
  // "or drop these shifts" link. Same React 18 auto-batching note
  // applies: keep call sites synchronous event handlers.
  const handleBulkDrop = (rows, byRule) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const nextDropped = new Map(droppedRows);
    let nextEdited = editedRows;
    let editedMutated = false;
    for (const row of rows) {
      if (!row) continue;
      const key = dropRowKey(row);
      if (nextDropped.has(key)) continue;
      nextDropped.set(key, { row, byRule });
      if (editedRows.has(key)) {
        if (!editedMutated) {
          nextEdited = new Map(editedRows);
          editedMutated = true;
        }
        nextEdited.delete(key);
      }
    }
    if (editedMutated) setEditedRows(nextEdited);
    setDroppedRows(nextDropped);
    reassessAfterLever(nextDropped, editedMutated ? nextEdited : editedRows);
  };

  // Restore handler — bulk variant for the Shortened panel's rolled-up
  // rows. Removes N edits in one transition.
  const handleRestoreShortenGroup = (keys) => {
    if (!Array.isArray(keys) || keys.length === 0) return;
    const next = new Map(editedRows);
    for (const key of keys) next.delete(key);
    setEditedRows(next);
    reassessAfterLever(droppedRows, next);
  };

  // ── Apply (route into the staged review or commit straight through) ─
  const runConflictCheck = async () => {
    const { rows, memberIds, duplicatesDropped, invalidTimesDropped } = targetRowsAndMembers;
    if (rows.length === 0) {
      if (invalidTimesDropped > 0) {
        onToast?.(`Can’t apply — the template has missing or equal start/end times. Edit the template to set real times.`);
        return;
      }
      onToast?.(isPattern
        ? 'Assign at least one crew member to a role and pick a date range.'
        : 'Pick at least one crew member to apply this template.');
      return;
    }
    if (invalidTimesDropped > 0) {
      onToast?.(`Skipped ${invalidTimesDropped} row${invalidTimesDropped === 1 ? '' : 's'} with missing or equal start/end times.`);
    }
    if (duplicatesDropped > 0) {
      onToast?.(`Dropped ${duplicatesDropped} duplicate row${duplicatesDropped === 1 ? '' : 's'} (same crew, date, and shift).`);
    }
    setBusy(true);
    try {
      // 1 — same-day conflicts.
      const { data, error: qErr } = await supabase
        .from('rota_shifts')
        .select('id, member_id, shift_date')
        .eq('tenant_id', rota.tenantId)
        .in('member_id', memberIds)
        .in('shift_date', dates);
      if (qErr) throw qErr;

      const targetKeys = new Set(rows.map((r) => `${r.member_id}|${r.shift_date}`));
      const conflictRows = (data || []).filter((r) =>
        targetKeys.has(`${r.member_id}|${r.shift_date}`),
      );

      // 2 — 7-day-back history window. `id` included so overwrite-mode
      // recomputes can filter it. Local date components only — no UTC.
      const earliest = dates[0];
      const latest = dates[dates.length - 1];
      const [ey, em, ed] = earliest.split('-').map(Number);
      const histStart = new Date(ey, em - 1, ed);
      histStart.setDate(histStart.getDate() - 6);
      const histStartStr = `${histStart.getFullYear()}-${pad(histStart.getMonth() + 1)}-${pad(histStart.getDate())}`;

      const { data: histData, error: hErr } = await supabase
        .from('rota_shifts')
        .select('id, member_id, shift_date, start_time, end_time, shift_type, sub_type')
        .eq('tenant_id', rota.tenantId)
        .in('member_id', memberIds)
        .gte('shift_date', histStartStr)
        .lte('shift_date', latest);
      if (hErr) throw hErr;

      const history = histData || [];
      setHistoryShifts(history);

      const nextConflicts = conflictRows.length > 0
        ? {
            total: rows.length,
            clashes: conflictRows.length,
            conflictKeys: new Set(conflictRows.map((r) => `${r.member_id}|${r.shift_date}`)),
            conflictIds: conflictRows.map((r) => r.id),
          }
        : null;
      setConflicts(nextConflicts);

      // Stage 1 path: conflicts exist → resolve first, defer MLC analysis.
      if (nextConflicts) {
        setResolutionMode(null);
        setAssessment(null);
        setPhase('conflicts');
        return;
      }

      // No conflicts → analyse straight against existing + proposed.
      const initialAssessment = computeAssessmentFor({
        memberIds,
        proposedRows: rows,
        existingShifts: history,
        mode: 'none',
        conflictKeys: new Set(),
        conflictIdSet: new Set(),
      });

      if (!initialAssessment.hasMlc && !initialAssessment.hasCircadian) {
        // Clean apply — commit straight through.
        setAssessment(null);
        setResolutionMode('skip');
        await commit({
          mode: 'skip',
          conflictKeys: new Set(),
          conflictIds: [],
          assessmentForAudit: null,
        });
        return;
      }
      setAssessment(initialAssessment);
      setResolutionMode('skip'); // implicit — nothing to skip
      setPhase('mlc');
    } catch (e) {
      onToast?.(`Conflict check failed — ${e.message || 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  // ── Stage 1 → Stage 2 (or direct commit) ───────────────────────────
  // Locks the resolution choice, then recomputes the assessment against
  // the post-resolution roster. If that resolution produces no MLC and
  // no circadian flags, we commit straight through — the chief doesn't
  // need to look at a Stage 2 with nothing on it.
  const pickResolution = async (mode) => {
    if (!conflicts) return;
    setBusy(true);
    try {
      setResolutionMode(mode);
      const conflictKeys = mode === 'skip' ? conflicts.conflictKeys : new Set();
      const conflictIds = mode === 'overwrite' ? conflicts.conflictIds : [];
      const conflictIdSet = new Set(conflicts.conflictIds);
      const { rows, memberIds } = targetRowsAndMembers;
      const next = computeAssessmentFor({
        memberIds,
        proposedRows: rows,
        existingShifts: historyShifts,
        mode,
        conflictKeys: conflicts.conflictKeys,
        conflictIdSet,
      });
      if (!next.hasMlc && !next.hasCircadian) {
        setAssessment(null);
        await commit({
          mode,
          conflictKeys,
          conflictIds,
          assessmentForAudit: null,
        });
        return;
      }
      setAssessment(next);
      setOverrideReason('');
      setPhase('mlc');
    } catch (e) {
      onToast?.(`Couldn’t analyse rest hours — ${e.message || 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async ({ mode, conflictKeys, conflictIds, assessmentForAudit }) => {
    setBusy(true);
    setPhase('applying');
    const auditAssessment = assessmentForAudit !== undefined ? assessmentForAudit : assessment;
    const allRows = targetRowsAndMembers.rows;
    const rows = mode === 'skip'
      ? allRows.filter((r) => !conflictKeys.has(`${r.member_id}|${r.shift_date}`))
      : allRows;
    const deleteIds = mode === 'overwrite' ? (conflictIds || []) : [];
    const res = await applyTemplate({ rows, deleteIds });
    if (!res.ok) {
      onToast?.(`Couldn’t apply — ${res.error || 'try again'}`);
      setBusy(false);
      setPhase(auditAssessment ? 'mlc' : (conflicts ? 'conflicts' : 'select'));
      return;
    }

    // ensureDraft per affected department (already optimistic).
    const memberDeptMap = new Map(visibleCrew.map((c) => [c.id, c.departmentId]));
    const affectedDeptIds = new Set();
    for (const r of rows) {
      const did = memberDeptMap.get(r.member_id);
      if (did) affectedDeptIds.add(did);
    }
    for (const departmentId of affectedDeptIds) {
      // eslint-disable-next-line no-await-in-loop
      const er = await ensureDraft({
        departmentId, vesselId: rota.vesselId, tenantId: rota.tenantId,
      });
      if (!er.ok && er.reason === 'no-init') {
        onToast?.('Department status not initialized — ask a CHIEF or COMMAND to enable editing.');
      }
    }

    // ── MLC override audit ─────────────────────────────────────────
    // One rota_approval_events row per affected department, scoped to
    // that department's crew. context.shift_ids is the set of inserted
    // shifts in that department; context.breaches is the per-rule list.
    // RLS requires actor_id = auth.uid(), so we fetch the session user.
    //
    // KNOWN v1 LIMITATION (applyable-MLC-fixes lever): when a drop in
    // one department cascades into a new breach in another (e.g. drop
    // James/Deck → expose Sofia/Engine breach → chief overrides Sofia),
    // the Engine audit row records Sofia's override but carries NO link
    // back to the Deck drop that caused it. The two events share an
    // apply (same actor, same timestamp window) but the causal link is
    // not stored. Deliberate v1 boundary — not an oversight.
    // Broadened gate: fires when an MLC override was justified by a typed
    // reason OR when the chief used the Drop lever to remove proposed
    // rows OR the Shorten lever to trim them (v1.1 C4). The drops-only /
    // shortens-only paths — chief fixes the breach, clicks plain Apply,
    // no override reason needed — are the easy cases to miss and the
    // ones most worth tracing.
    const overrideHappened = !!(auditAssessment?.hasMlc && overrideReason.trim());
    const dropsHappened = droppedRows.size > 0;
    const shortensHappened = editedRows.size > 0;
    if (overrideHappened || dropsHappened || shortensHappened) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const actorId = authData?.user?.id;
        if (actorId) {
          const memberNameMap = new Map(visibleCrew.map((c) => [c.id, c.name]));

          // Inserted shift ids grouped by dept. Position-aligned with the
          // `rows` array that hit the DB (drops were already filtered out
          // by pushIfNew before this point).
          const insertedIds = res.insertedIds || [];
          const idsByDept = new Map();
          for (let i = 0; i < rows.length; i += 1) {
            const did = memberDeptMap.get(rows[i].member_id);
            if (!did) continue;
            const id = insertedIds[i];
            if (!id) continue;
            if (!idsByDept.has(did)) idsByDept.set(did, []);
            idsByDept.get(did).push(id);
          }

          // Remaining MLC breaches grouped by dept (empty when drops
          // cleared everything).
          const breachesByDept = new Map();
          if (auditAssessment?.byMember) {
            for (const [memberId, info] of Object.entries(auditAssessment.byMember)) {
              if (!info.mlcBreaches || info.mlcBreaches.length === 0) continue;
              const did = memberDeptMap.get(memberId);
              if (!did) continue;
              if (!breachesByDept.has(did)) breachesByDept.set(did, []);
              for (const b of info.mlcBreaches) {
                breachesByDept.get(did).push({
                  member_id: memberId,
                  member: memberNameMap.get(memberId) || '',
                  date: b.date,
                  rule: b.rule,
                  projected: b.projected,
                  limit: b.limit,
                });
              }
            }
          }

          // Drops grouped by dept. caused_by_rule carries the rule the
          // chief was looking at when they pulled the lever — the audit
          // attribution for the drop.
          const droppedByDept = new Map();
          for (const { row, byRule } of droppedRows.values()) {
            const did = memberDeptMap.get(row.member_id);
            if (!did) continue;
            if (!droppedByDept.has(did)) droppedByDept.set(did, []);
            droppedByDept.get(did).push({
              member_id: row.member_id,
              member_name: memberNameMap.get(row.member_id) || '',
              shift_date: row.shift_date,
              start_time: row.start_time,
              end_time: row.end_time,
              shift_type: row.shift_type,
              sub_type: row.sub_type ?? null,
              caused_by_rule: byRule,
            });
          }

          // Shortens grouped by dept (v1.1 C4). Each entry captures the
          // original AND new times so the audit reader can reconstruct
          // exactly what the chief changed. caused_by_rule attributes the
          // shorten to the rule the chief was looking at (always
          // 'daily_rest_10h' in v1.1 — the only rule with a shorten
          // lever). bulk_group_id (v1.2 C4) groups entries that were
          // written together in one bulk Apply; null for single-day
          // shortens. Readers can group context.shortened_rows by
          // bulk_group_id to reconstruct bulk operations at audit time.
          //
          // Coherence note (v1.2 C3 semantic): an entry whose chief-
          // picked time didn't fully clear the rule still lands in
          // shortened_rows (it WAS shortened, deliberately, even if
          // the breach remained). The residual breach for that
          // (member, date, rule) appears in context.breaches via the
          // standard hasMlc=true → override path. Reader correlates
          // by member_id + shift_date.
          const shortenedByDept = new Map();
          for (const { row, newStart, newEnd, byRule, bulkGroupId } of editedRows.values()) {
            const did = memberDeptMap.get(row.member_id);
            if (!did) continue;
            if (!shortenedByDept.has(did)) shortenedByDept.set(did, []);
            shortenedByDept.get(did).push({
              member_id: row.member_id,
              member_name: memberNameMap.get(row.member_id) || '',
              shift_date: row.shift_date,
              original_start: row.start_time,
              original_end: row.end_time,
              new_start: newStart,
              new_end: newEnd,
              caused_by_rule: byRule,
              bulk_group_id: bulkGroupId ?? null,
            });
          }

          // A dept is "affected" if it has remaining breaches OR drops
          // OR shortens. Inserts alone don't trigger an audit row —
          // clean inserts in depts unrelated to the MLC drama stay
          // un-audited (matches pre-lever behaviour). A dept whose only
          // entry is a shorten (no remaining breach, no drop) IS
          // included here because its dept appears in shortenedByDept.
          const affectedDeptIds = new Set([
            ...breachesByDept.keys(),
            ...droppedByDept.keys(),
            ...shortenedByDept.keys(),
          ]);

          const eventRows = [];
          for (const departmentId of affectedDeptIds) {
            const context = {
              shift_ids: idsByDept.get(departmentId) || [],
              breaches: breachesByDept.get(departmentId) || [],
            };
            const deptDrops = droppedByDept.get(departmentId);
            if (deptDrops && deptDrops.length > 0) context.dropped_rows = deptDrops;
            const deptShortens = shortenedByDept.get(departmentId);
            if (deptShortens && deptShortens.length > 0) context.shortened_rows = deptShortens;
            eventRows.push({
              rota_id: rota.id,
              department_id: departmentId,
              tenant_id: rota.tenantId,
              vessel_id: rota.vesselId,
              event_type: 'mlc_override',
              actor_id: actorId,
              actor_tier: tier,
              // Typed reason when an override happened; null when the
              // lever (drop and/or shorten) cleared the breach and the
              // chief clicked plain Apply. context.dropped_rows and/or
              // context.shortened_rows carry the meaning in that case.
              note: overrideHappened ? overrideReason.trim() : null,
              context,
            });
          }

          if (eventRows.length > 0) {
            const { error: evErr } = await supabase
              .from('rota_approval_events').insert(eventRows);
            if (evErr) console.warn('mlc_override event insert failed:', evErr.message);
          }
        }
      } catch (e) {
        // Audit failure must not block the apply — log and move on.
        console.warn('mlc_override audit threw:', e);
      }
    }

    onToast?.(
      `Wrote ${res.inserted} draft shift${res.inserted === 1 ? '' : 's'}` +
      (res.deleted ? ` (overwrote ${res.deleted}).` : '.'),
    );
    // Successful apply → return the user to the rota grid (close BOTH the
    // apply modal and the picker). Cancel/X/Esc paths still use onClose,
    // which the page wires to "back to picker" — the distinction lives at
    // the call site, not here.
    (onApplied || onClose)?.();
  };

  // ── Pattern preview matrix (roles × first N days, capped to range) ─
  const previewDayCount = Math.min(dates.length, Math.max(N, 1));
  const previewDates = dates.slice(0, previewDayCount);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
      <div className="rest-popover-backdrop" onClick={busy ? undefined : onClose} />
      <div
        className={`te-panel ap-panel${isPattern ? ' ap-panel-pattern' : ''}`}
        role="dialog" aria-modal="true"
        aria-label={`Apply ${template.name}`}
      >
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow">{headerEyebrow}</div>
            <h2 className="tp-title">{template.name}</h2>
            <div className="ap-header-sub">
              {headerSwatch && (
                <span className="ap-header-swatch"
                  style={{ background: headerSwatch }} aria-hidden />
              )}
              {isPattern && (
                <span className="ap-pattern-mark" aria-hidden>
                  <RefreshCw size={11} />
                </span>
              )}
              <span>{headerScope}</span>
              {headerHours && (
                <>
                  <span className="tp-dot">·</span>
                  <span>{headerHours}</span>
                </>
              )}
              {isPattern && (
                <>
                  <span className="tp-dot">·</span>
                  <span>
                    {N} {N === 1 ? 'duty' : 'duties'} · {effectiveM}
                    {effectiveM !== slots.length ? ` of ${slots.length}` : ''}
                    {' '}slot{effectiveM === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>
          <button type="button" className="tp-close"
            aria-label="Close" onClick={busy ? undefined : onClose}><X size={16} /></button>
        </div>

        {phase === 'select' && (
          <div className="te-body ap-body">
            <div className="te-field">
              <span className="te-field-label">When</span>
              <DateRangePicker
                value={range}
                onChange={setRange}
                trip={rota?.ownerType === 'trip' ? trip : null}
              />
            </div>

            {/* SIMPLE — collapsible crew checklist */}
            {!isPattern && (
              <div className="te-field">
                <span className="te-field-label">Crew</span>
                <CrewCollapsible
                  visibleCrew={visibleCrew}
                  ticked={ticked}
                  setTicked={setTicked}
                  hodHint={hodDeptId ? 'HOD scope — only your department’s crew can be assigned.' : null}
                />
                <div className="ap-summary">
                  <strong>{ticked.size}</strong> crew × <strong>{dates.length}</strong> day{dates.length === 1 ? '' : 's'}
                  {' = '}<strong>{targetRowsAndMembers.rows.length}</strong> draft shift{targetRowsAndMembers.rows.length === 1 ? '' : 's'}
                </div>
              </div>
            )}

            {/* PATTERN — role-slot assignments + preview */}
            {isPattern && (
              <>
                <div className="te-field">
                  <span className="te-field-label">Role assignments</span>
                  {hodDeptId && (
                    <div className="ap-hod-hint">
                      HOD scope — only your department’s crew appear in the dropdowns.
                    </div>
                  )}
                  <div className="ap-slot-list">
                    {slots.map((slot, j) => {
                      if (slot.dropped) {
                        return (
                          <div key={`slot-${j}`} className="ap-slot-row is-dropped">
                            <div className="ap-slot-title">
                              <span className="ap-slot-idx">Slot {j + 1}</span>
                              <span className="ap-slot-role ap-slot-role-dropped">
                                {slot.title || <em>Untitled</em>}
                              </span>
                            </div>
                            <div className="ap-slot-dropped-note">
                              Dropped from this apply.
                            </div>
                            <button
                              type="button"
                              className="ap-slot-action"
                              onClick={() => restoreSlot(j)}
                              aria-label={`Restore slot ${j + 1}`}
                            ><RotateCcw size={12} /> Restore</button>
                          </div>
                        );
                      }
                      const m1 = slot.members[0] || null;
                      const m2 = slot.members[1] || null;
                      const resolved = resolveSlotCandidates(j);
                      const baseCands = resolved.items;
                      const isFallback = resolved.source !== 'match';
                      // Soft hint: if a candidate is already a member of
                      // ANOTHER non-dropped slot, append "already in Slot N"
                      // to its subtitle so a deliberate repeat is visible
                      // rather than silent. Does NOT filter — the chief is
                      // allowed to repeat (that's the double-up case).
                      const effCands = baseCands.map((c) => {
                        const otherSlotNums = [];
                        slots.forEach((s, idx) => {
                          if (idx === j || s.dropped) return;
                          if (s.members.includes(c.id)) otherSlotNums.push(idx + 1);
                        });
                        if (otherSlotNums.length === 0) return c;
                        const hint = otherSlotNums.length === 1
                          ? `already in Slot ${otherSlotNums[0]}`
                          : `already in Slots ${otherSlotNums.join(', ')}`;
                        return {
                          ...c,
                          subtitle: c.subtitle ? `${c.subtitle} · ${hint}` : hint,
                        };
                      });
                      // Second-position candidates: filter out the first pick.
                      const candsForSecond = effCands.filter((c) => c.id !== m1);
                      const noUsable = effCands.length === 0;
                      const deptName = template?.departmentName || 'the department';
                      return (
                        <div key={`slot-${j}`} className="ap-slot-row">
                          <div className="ap-slot-title">
                            <span className="ap-slot-idx">Slot {j + 1}</span>
                            <span className="ap-slot-role">{slot.title || <em>Untitled</em>}</span>
                          </div>
                          <div className="ap-slot-controls">
                            <CrewSelect
                              value={m1}
                              candidates={effCands}
                              onChange={(id) => setSlotMember(j, 0, id)}
                              placeholder={noUsable ? '— no crew available —' : 'Assign…'}
                              disabled={noUsable}
                            />
                            {slot.members.length === 2 && (
                              <div className="ap-slot-double-row">
                                <CrewSelect
                                  value={m2}
                                  candidates={candsForSecond}
                                  onChange={(id) => setSlotMember(j, 1, id)}
                                  placeholder="Assign second crew…"
                                  disabled={candsForSecond.length === 0}
                                />
                                <button
                                  type="button"
                                  className="ap-slot-inline-btn"
                                  onClick={() => removeDouble(j)}
                                  aria-label={`Remove second crew from slot ${j + 1}`}
                                  title="Remove second crew"
                                ><X size={12} /></button>
                              </div>
                            )}
                            {isFallback && (
                              <div className="ap-slot-fallback">
                                <span>
                                  No exact job-title match — showing{' '}
                                  {resolved.source === 'dept' ? `${deptName} crew` : 'all vessel crew'}.
                                </span>
                                {fallbackDept && (
                                  <button
                                    type="button"
                                    className="ap-slot-action ap-slot-action-widen"
                                    onClick={() => toggleWiden(j)}
                                  >{slot.widen
                                    ? `Just ${deptName} crew`
                                    : 'Show all vessel crew'}</button>
                                )}
                              </div>
                            )}
                            <div className="ap-slot-foot">
                              {slot.members.length < 2 && !noUsable && (
                                <button
                                  type="button"
                                  className="ap-slot-action"
                                  onClick={() => addDouble(j)}
                                ><Plus size={12} /> Add another crew to this slot</button>
                              )}
                              <button
                                type="button"
                                className="ap-slot-action ap-slot-action-drop"
                                onClick={() => dropSlot(j)}
                                aria-label={`Drop slot ${j + 1} from this apply`}
                              ><Trash2 size={12} /> Drop slot</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live mismatch banner. effectiveM = live, non-dropped slot
                    count (this-apply only). The template's M/N are unchanged. */}
                {effectiveM === N && N > 0 && (slots.length !== N || slots.some((s) => s.dropped)) && (
                  <div className="ap-mismatch ap-mismatch-ok">
                    <CheckCircle2 size={14} color="#2D5A3A" />
                    <span>Evened up: {N} active slot{N === 1 ? '' : 's'} matching {N} dut{N === 1 ? 'y' : 'ies'} this apply.</span>
                  </div>
                )}
                {effectiveM > N && (
                  <div className="ap-mismatch">
                    <AlertTriangle size={14} color="#7A2E1E" />
                    <span>
                      More active slots ({effectiveM}) than duties ({N}) — {effectiveM - N} over-rolled this cycle.
                      Use <strong>Drop slot</strong> above to remove a slot from this apply, or apply as-is
                      (over-rolled slots produce no rows).
                    </span>
                  </div>
                )}
                {effectiveM < N && effectiveM > 0 && (
                  <div className="ap-mismatch">
                    <AlertTriangle size={14} color="#7A2E1E" />
                    <span>
                      This pattern has more duties ({N}) than active slots ({effectiveM}) — {N - effectiveM} dut{N - effectiveM === 1 ? 'y goes' : 'ies go'} uncovered each day.
                      To add a duty, <strong>edit the shift pattern</strong> (apply doesn't change the template).
                    </span>
                  </div>
                )}

                {previewDayCount > 0 && (
                  <div className="te-field">
                    <span className="te-field-label">Preview (first {previewDayCount} day{previewDayCount === 1 ? '' : 's'})</span>
                    <div className="ap-preview-wrap">
                      <table className="ap-preview">
                        <thead>
                          <tr>
                            <th>Role / crew</th>
                            {previewDates.map((d, k) => {
                              const dt = fromStr(d);
                              return (
                                <th key={d} className="ap-preview-dh">
                                  <div>Day {k + 1}</div>
                                  <div className="ap-preview-date">{WEEKDAY_SHORT[dt.getDay()]} {dt.getDate()} {MONTH_SHORT[dt.getMonth()]}</div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Flatten to one preview row per (non-dropped slot,
                            // member position). Doubled slots appear twice;
                            // dropped slots are skipped entirely (per spec).
                            const previewRows = [];
                            slots.forEach((s, j) => {
                              if (s.dropped) return;
                              s.members.forEach((mid, i) => {
                                previewRows.push({ slotIdx: j, memberIdx: i, memberId: mid, title: s.title });
                              });
                            });
                            return previewRows.map((pr) => {
                              const assignedCrew = pr.memberId
                                ? visibleCrew.find((c) => c.id === pr.memberId)
                                : null;
                              return (
                                <tr key={`pr-${pr.slotIdx}-${pr.memberIdx}`}>
                                  <td className="ap-preview-role">
                                    <div className="ap-preview-role-title">
                                      {pr.title}
                                      {pr.memberIdx > 0 && (
                                        <span className="ap-preview-double-tag">2nd</span>
                                      )}
                                    </div>
                                    <div className="ap-preview-role-crew">
                                      {assignedCrew ? assignedCrew.name : <em>unassigned</em>}
                                    </div>
                                  </td>
                                  {previewDates.map((d, k) => {
                                    const di = cellDutyIndex(pr.slotIdx, k);
                                    if (di == null) {
                                      return <td key={`c-${pr.slotIdx}-${pr.memberIdx}-${k}`} className="ap-preview-empty">—</td>;
                                    }
                                    const duty = duties[di];
                                    const c = TYPE_COLOR[duty?.shift_type] || '#B4B2A9';
                                    return (
                                      <td key={`c-${pr.slotIdx}-${pr.memberIdx}-${k}`} className="ap-preview-cell"
                                        style={{ background: c, color: '#F5F1EA' }}>
                                        <div className="ap-preview-cell-label">{duty?.label || 'Duty'}</div>
                                        <div className="ap-preview-cell-time">
                                          {fmtTime(duty?.start_time)}–{fmtTime(duty?.end_time)}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="ap-summary">
                      <strong>{targetRowsAndMembers.rows.length}</strong> draft shift{targetRowsAndMembers.rows.length === 1 ? '' : 's'} across <strong>{dates.length}</strong> day{dates.length === 1 ? '' : 's'}.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {phase === 'conflicts' && conflicts && (
          <div className="te-body ap-body">
            <div className="ap-conflict">
              <div className="ap-conflict-head">
                <AlertTriangle size={16} color="#7A2E1E" />
                <span>Existing shifts in this range</span>
              </div>
              <div className="ap-conflict-body">
                This will create <strong>{conflicts.total}</strong> shift{conflicts.total === 1 ? '' : 's'}.
                {' '}<strong>{conflicts.clashes}</strong> of them clash with an existing shift.
              </div>
              <div className="ap-conflict-help">Pick one rule for the whole batch:</div>
              <ul className="ap-conflict-options">
                <li><strong>Skip the clashing days</strong> — only write where the crew member is free; existing shifts stay.</li>
                <li><strong>Overwrite</strong> — replace the clashing shifts with this template (still as drafts).</li>
              </ul>
            </div>
          </div>
        )}

        {phase === 'mlc' && (
          <div className="te-body ap-body">
            {conflicts && resolutionMode && (
              <div className="ap-stage-crumb">
                Conflicts {resolutionMode === 'skip' ? 'will be skipped' : 'will be overwritten'} ·{' '}
                <button
                  type="button"
                  className="ap-stage-crumb-link"
                  onClick={() => setPhase('conflicts')}
                  disabled={busy}
                >Change</button>
              </div>
            )}
            {assessment?.hasMlc && (
              <div className="ap-mlc-hard">
                <div className="ap-mlc-head">
                  <AlertTriangle size={16} color="#7A2E1E" />
                  <span>MLC rest-hour breaches</span>
                </div>
                <div className="ap-mlc-body">
                  This apply would create these MLC breaches:
                </div>
                <ul className="ap-mlc-list">
                  {Object.entries(assessment.byMember)
                    .filter(([, info]) => info.mlcBreaches && info.mlcBreaches.length > 0)
                    .sort((a, b) => memberSeverity(b[1].mlcBreaches) - memberSeverity(a[1].mlcBreaches))
                    .map(([memberId, info]) => {
                      const c = visibleCrew.find((x) => x.id === memberId);
                      const name = c?.name || 'Unknown';
                      return (
                        <MlcMemberRow
                          key={`mlc-${memberId}`}
                          name={name}
                          mlcBreaches={info.mlcBreaches}
                          applyDates={dates}
                          memberId={memberId}
                          allRows={targetRowsAndMembers.rows}
                          onDropRow={handleDropRow}
                          onShortenRow={handleShortenRow}
                          onBulkShortenRows={handleBulkShorten}
                          onBulkDropRows={handleBulkDrop}
                          computePrefillFor={computeShortenPrefillFor}
                          computeBulkPrefillFor={computeBulkPrefillFor}
                          previewWithEdit={previewWithEdit}
                          previewWithEdits={previewWithEdits}
                        />
                      );
                    })}
                </ul>
                <label className="ap-override-label">
                  <span>Reason for override <em>(required to proceed)</em></span>
                  <textarea
                    className="ap-override-reason"
                    rows={2}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. departure window — crew rotates off in two days"
                  />
                </label>
              </div>
            )}

            {droppedRows.size > 0 && (
              <div className="ap-removed">
                <div className="ap-removed-head">Removed from this apply</div>
                <div className="ap-removed-sub">
                  These shifts were dropped to clear MLC breaches. Restore any that shouldn’t be.
                </div>
                <ul className="ap-removed-list">
                  {Array.from(droppedRows.entries()).map(([key, entry]) => {
                    const r = entry.row;
                    const member = visibleCrew.find((c) => c.id === r.member_id);
                    const memberName = member?.name || 'Unknown';
                    // Duration via the same overnight branch the rest of
                    // the calc uses — end <= start → end += 24.
                    const [sh, sm] = r.start_time.split(':').map(Number);
                    const [eh, em] = r.end_time.split(':').map(Number);
                    let startDec = sh + (sm || 0) / 60;
                    let endDec = eh + (em || 0) / 60;
                    if (endDec <= startDec) endDec += 24;
                    const durationLabel = fmtHoursH(endDec - startDec);
                    const startStr = String(r.start_time).slice(0, 5);
                    const endStr = String(r.end_time).slice(0, 5);
                    return (
                      <li key={key} className="ap-removed-item">
                        <span className="ap-removed-text">
                          <strong>{memberName}</strong>
                          {' — '}
                          {durationLabel} {r.shift_type},
                          {' '}{startStr}–{endStr} on {fmtDateShort(r.shift_date)}
                        </span>
                        <button
                          type="button"
                          className="ap-removed-restore"
                          onClick={() => handleRestoreRow(key)}
                        >Restore</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {editedRows.size > 0 && (() => {
              // Display rollup: group entries by (member + original times
              // + new times); within each group, sort dates, detect
              // contiguous runs, render as a single rolled-up line with
              // one Restore that undoes all the group's keys. Bulk
              // shortens (N entries with identical orig/new) collapse to
              // one line; single-day shortens render exactly as v1.1.
              const groups = new Map();
              for (const [key, entry] of editedRows.entries()) {
                const r = entry.row;
                const newStart = String(entry.newStart).slice(0, 5);
                const newEnd   = String(entry.newEnd).slice(0, 5);
                const origStart = String(r.start_time).slice(0, 5);
                const origEnd   = String(r.end_time).slice(0, 5);
                const groupKey = `${r.member_id}|${origStart}|${origEnd}|${newStart}|${newEnd}`;
                if (!groups.has(groupKey)) {
                  const member = visibleCrew.find((c) => c.id === r.member_id);
                  groups.set(groupKey, {
                    memberId: r.member_id,
                    memberName: member?.name || 'Unknown',
                    origStart, origEnd, newStart, newEnd,
                    dates: [], keys: [],
                  });
                }
                groups.get(groupKey).dates.push(r.shift_date);
                groups.get(groupKey).keys.push(key);
              }
              // Date-range formatting reuses the module-level fmtDateRange
              // helper now that the bulk readout shares the same logic.
              return (
                <div className="ap-shortened">
                  <div className="ap-shortened-head">Shortened in this apply</div>
                  <div className="ap-shortened-sub">
                    These shifts were trimmed to clear MLC breaches. Restore any that shouldn&rsquo;t be.
                  </div>
                  <ul className="ap-shortened-list">
                    {Array.from(groups.values()).map((g) => {
                      g.dates.sort();
                      const origDur = computeNewDurationH(g.origStart, g.origEnd);
                      const newDur  = computeNewDurationH(g.newStart, g.newEnd);
                      const dateLabel = fmtDateRange(g.dates);
                      const handleRestore = () => {
                        if (g.keys.length === 1) handleRestoreShorten(g.keys[0]);
                        else handleRestoreShortenGroup(g.keys);
                      };
                      return (
                        <li key={`${g.memberId}|${g.origStart}|${g.newStart}|${g.dates[0]}`} className="ap-shortened-item">
                          <span className="ap-shortened-text">
                            <strong>{g.memberName}</strong>
                            {' — '}
                            {g.origStart}–{g.origEnd} ({fmtHoursH(origDur)})
                            {' shortened to '}
                            {g.newStart}–{g.newEnd} ({fmtHoursH(newDur)})
                            {' on '}{dateLabel}
                          </span>
                          <button
                            type="button"
                            className="ap-removed-restore"
                            onClick={handleRestore}
                          >Restore</button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}

            {assessment?.hasCircadian && (
              <div className="ap-circadian-soft">
                <div className="ap-circadian-head">
                  <Activity size={14} />
                  <span>Circadian rhythm — schedule swings</span>
                </div>
                <div className="ap-circadian-body">
                  These crew swing between day and night work several times in a week — worth a glance before you apply
                </div>
                <ul className="ap-circadian-list">
                  {Object.entries(assessment.byMember).flatMap(([memberId, info]) => {
                    if (!info.circadianFlags || info.circadianFlags.length === 0) return [];
                    const c = visibleCrew.find((x) => x.id === memberId);
                    const name = c?.name || 'Unknown';
                    return info.circadianFlags.map((f, i) => (
                      <li key={`circ-${memberId}-${i}`}>
                        <strong>{name}</strong> — {f.count} schedule swings in the past {CIRCADIAN_WINDOW_DAYS} days.
                      </li>
                    ));
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            {phase === 'select' && (
              <>
                <button type="button" className="v2-btn-ghost"
                  onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="v2-btn-filled"
                  onClick={runConflictCheck}
                  disabled={busy || targetRowsAndMembers.rows.length === 0}>
                  {busy ? 'Checking…' : 'Apply to rota'}
                </button>
              </>
            )}
            {phase === 'conflicts' && conflicts && (
              <>
                <button type="button" className="v2-btn-ghost"
                  onClick={() => setPhase('select')} disabled={busy}>Back</button>
                <button type="button" className="v2-btn-ghost"
                  onClick={() => pickResolution('skip')}
                  disabled={busy}>Skip conflicts</button>
                <button type="button" className="v2-btn-filled"
                  onClick={() => pickResolution('overwrite')}
                  disabled={busy}>Overwrite</button>
              </>
            )}
            {phase === 'mlc' && (() => {
              const needsReason = !!assessment?.hasMlc;
              const reasonOk = !needsReason || overrideReason.trim().length > 0;
              const blocked = busy || !reasonOk;
              const applyLabel = needsReason ? 'Override + apply' : 'Apply';
              const mode = resolutionMode || 'skip';
              const conflictKeys = (conflicts && mode === 'skip') ? conflicts.conflictKeys : new Set();
              const conflictIds = (conflicts && mode === 'overwrite') ? conflicts.conflictIds : [];
              return (
                <>
                  <button type="button" className="v2-btn-ghost"
                    onClick={() => setPhase(conflicts ? 'conflicts' : 'select')}
                    disabled={busy}>Back</button>
                  <button type="button" className="v2-btn-filled"
                    onClick={() => commit({
                      mode, conflictKeys, conflictIds,
                      assessmentForAudit: assessment,
                    })}
                    disabled={blocked}>{applyLabel}</button>
                </>
              );
            })()}
            {phase === 'applying' && (
              <button type="button" className="v2-btn-filled" disabled>Applying…</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
