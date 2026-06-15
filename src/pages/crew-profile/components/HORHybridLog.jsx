import React, { useMemo, useRef, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { getCrewWorkEntries, addWorkEntries, deleteWorkEntriesForDate } from '../utils/horStorage';

// ── HOR hybrid log — compact calendar (overview) + inline-edit day list ──────
// The month calendar on the left is an always-on overview; the day list on the
// right is editable inline. Clicking a calendar day jumps to and expands its
// row. The expanded row paints via presets ("As rostered" / "Clear") or typed
// times and saves automatically. Rest figures + day statuses come straight
// from the props the parent already derives via the shared restHours engine —
// this component never re-implements the MLC maths, it only edits + draws.

const SEG_PER_DAY = 48; // 30-minute segments

const hhmmToSeg = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Math.max(0, Math.min(48, Math.round(((h || 0) * 60 + (m || 0)) / 30)));
};
const segToHHMM = (i) => {
  const h = Math.floor(i / 2);
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Worked 30-min segments → contiguous [startHour, endHour] ranges for the bar.
const segmentsToIntervals = (segs) => {
  const on = new Set(segs || []);
  const out = [];
  let start = null;
  for (let i = 0; i < SEG_PER_DAY; i += 1) {
    const isOn = on.has(i);
    if (isOn && start === null) start = i;
    if (!isOn && start !== null) { out.push([start / 2, i / 2]); start = null; }
  }
  if (start !== null) out.push([start / 2, SEG_PER_DAY / 2]);
  return out;
};

// A single contiguous on-duty block from typed times. end <= start means the
// block runs to midnight (the single-day model can't represent a true overnight
// wrap; the crew can split it across two days if needed).
const timesToSegments = (start, end) => {
  const s = hhmmToSeg(start);
  let e = hhmmToSeg(end);
  if (e <= s) e = SEG_PER_DAY;
  const segs = [];
  for (let i = s; i < e; i += 1) segs.push(i);
  return segs;
};

const onDutyHours = (segs) => (segs?.length || 0) * 0.5;

// Tone for a rest figure, matching the calendar bands (breach < 10h,
// marginal < 11h, else compliant). Used only for colour, not for the
// authoritative status (which the parent computes via the engine).
const toneForRest = (rest, isOff) => {
  if (isOff) return 'off';
  if (rest < 10) return 'red';
  if (rest < 11) return 'amber';
  return 'green';
};

const dayLabel = (dateStr) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
};

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const Bar = ({ intervals, rota, big }) => (
  <div className={`cp-bar${rota ? ' rota' : ''}${big ? ' big' : ''}`}>
    {intervals.map(([s, e], i) => (
      <span key={i} className="blk" style={{ left: `${(s / 24) * 100}%`, width: `${((e - s) / 24) * 100}%` }} />
    ))}
  </div>
);

const Ticks = () => (
  <div className="cp-ticks">
    {[0, 6, 12, 18, 24].map((h) => (
      <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>
    ))}
  </div>
);

const HORHybridLog = ({
  crewId,
  calendarData = [],
  monthName,
  todayStr,
  onMonthChange,
  onChanged,
}) => {
  const [selectedDate, setSelectedDate] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [typeMode, setTypeMode] = useState(false);
  const [draftStart, setDraftStart] = useState('08:00');
  const [draftEnd, setDraftEnd] = useState('18:00');
  const rowRefs = useRef({});
  const listRef = useRef(null);

  // Per-date worked segments (unioned), recomputed when the month data changes
  // or after a local save. Reads the same localStorage cache the engine uses.
  const segsByDate = useMemo(() => {
    const map = new Map();
    for (const e of getCrewWorkEntries(crewId) || []) {
      if (!e?.date) continue;
      const set = map.get(e.date) || new Set();
      (e.workSegments || []).forEach((s) => set.add(s));
      map.set(e.date, set);
    }
    const out = {};
    for (const [date, set] of map) out[date] = Array.from(set).sort((a, b) => a - b);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewId, calendarData, refreshKey]);

  // First-of-month weekday for the calendar's leading blanks.
  const startDow = useMemo(() => {
    const first = calendarData[0];
    if (!first?.date) return 0;
    const [y, m] = first.date.split('-').map(Number);
    return new Date(y, m - 1, 1).getDay();
  }, [calendarData]);

  // Scroll the selected row into view when the selection changes.
  useEffect(() => {
    if (!selectedDate) return;
    const el = rowRefs.current[selectedDate];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedDate]);

  // Reset the typed-times sub-mode whenever a different day is opened, seeding
  // the inputs from that day's current first/last on-duty block.
  useEffect(() => {
    setTypeMode(false);
    if (!selectedDate) return;
    const iv = segmentsToIntervals(segsByDate[selectedDate]);
    if (iv.length) {
      setDraftStart(segToHHMM(Math.round(iv[0][0] * 2)));
      setDraftEnd(segToHHMM(Math.round(iv[iv.length - 1][1] * 2)));
    } else {
      setDraftStart('08:00');
      setDraftEnd('18:00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const afterSave = () => {
    setRefreshKey((k) => k + 1);
    if (onChanged) onChanged();
  };

  const saveSegments = (dateStr, segs, msg) => {
    addWorkEntries(crewId, [{ date: dateStr, workSegments: segs, source: 'edited' }]);
    afterSave();
    showToast(msg, 'success');
  };

  const handleAsRostered = (dateStr) => {
    // Confirm the rota's hours as the logged actual (current segments == rota
    // for a baseline day). If there are no segments it logs an off day.
    saveSegments(dateStr, segsByDate[dateStr] || [], 'Logged as rostered');
  };
  const handleClear = (dateStr) => {
    saveSegments(dateStr, [], 'Day cleared — logged as off');
  };
  const handleApplyTimes = (dateStr) => {
    saveSegments(dateStr, timesToSegments(draftStart, draftEnd), 'Hours logged');
    setTypeMode(false);
  };
  const handleResetToBaseline = (dateStr) => {
    deleteWorkEntriesForDate(crewId, dateStr);
    afterSave();
    showToast('Reset to rota baseline', 'success');
  };

  const renderEditor = (cd) => {
    const segs = typeMode ? timesToSegments(draftStart, draftEnd) : (segsByDate[cd.date] || []);
    const onDuty = onDutyHours(segs);
    const isOff = onDuty === 0;
    const rest = Math.max(0, 24 - onDuty);
    const tone = toneForRest(rest, isOff);
    const isRota = cd.source === 'baseline';
    const intervals = segmentsToIntervals(segs);
    const statusWord = isOff ? 'off' : tone === 'red' ? '✕ breach' : tone === 'amber' ? '⚠ marginal' : '✓ compliant';

    return (
      <div className="cp-ed" ref={(el) => { rowRefs.current[cd.date] = el; }}>
        <div className="top">
          <span className="dt">{dayLabel(cd.date)}</span>
          <span className="src">{isRota ? 'pre-filled from rota' : cd.source === 'actual' ? 'logged' : 'no entry'}</span>
        </div>
        <Bar intervals={intervals} rota={isRota && !typeMode} big />
        <Ticks />

        {typeMode ? (
          <div className="cp-timeinputs">
            <div>
              <label>On duty from</label>
              <input type="time" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
            </div>
            <div>
              <label>Until</label>
              <input type="time" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
            </div>
            <button type="button" className="apply" onClick={() => handleApplyTimes(cd.date)}>Apply</button>
            <button type="button" className="cp-tlink" onClick={() => setTypeMode(false)}>cancel</button>
          </div>
        ) : (
          <div className="cp-presets">
            <button
              type="button"
              className={`cp-preset${isRota ? ' act' : ''}`}
              onClick={() => handleAsRostered(cd.date)}
            >
              ✓ As rostered
            </button>
            <button
              type="button"
              className={`cp-preset${isOff && cd.source === 'actual' ? ' act' : ''}`}
              onClick={() => handleClear(cd.date)}
            >
              Clear
            </button>
            {cd.source === 'actual' && (
              <button type="button" className="cp-preset" onClick={() => handleResetToBaseline(cd.date)}>
                Reset to rota
              </button>
            )}
            <button type="button" className="cp-tlink" onClick={() => setTypeMode(true)}>type times instead ›</button>
          </div>
        )}

        <div className="cp-restbox">
          On duty <b className="ink">{Number(onDuty.toFixed(1))}h</b> · Rest{' '}
          <b className={tone === 'off' ? '' : tone}>{Number(rest.toFixed(1))}h</b> {statusWord}
          <span className="auto">saves automatically</span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="cp-hor-wrap">
        {/* Compact calendar overview */}
        <div className="cp-hor-cal">
          <div className="cp-hor-subh">
            <span className="mo">{monthName}</span>
            <span>
              <button type="button" className="cp-hor-navbtn" onClick={() => onMonthChange?.(-1)} aria-label="Previous month">‹</button>
              <button type="button" className="cp-hor-navbtn" onClick={() => onMonthChange?.(1)} aria-label="Next month">›</button>
            </span>
          </div>
          <div className="cp-hor-grid">
            {DOW.map((d, i) => <div key={`dow-${i}`} className="cp-hor-dow">{d}</div>)}
            {Array.from({ length: startDow }).map((_, i) => <div key={`b-${i}`} className="cp-hor-c blank" />)}
            {calendarData.map((cd) => {
              const isProvisional = cd.date > todayStr && cd.source !== 'actual';
              const tone = cd.status === 'breach' ? 'red' : cd.status === 'warning' ? 'amber' : '';
              const cls = `cp-hor-c${tone ? ` ${tone}` : ''}${isProvisional ? ' future' : ''}${selectedDate === cd.date ? ' sel' : ''}`;
              return (
                <div key={cd.date} className={cls} onClick={() => setSelectedDate(cd.date)}>
                  <div className="d">{cd.day}</div>
                  <div className="v">{Number((cd.restHours ?? 24).toFixed(1))}</div>
                </div>
              );
            })}
          </div>
          <p className="cp-hor-hint">
            Tap any day to jump to it on the right and edit. Green = compliant, dashed = still from the rota (not yet logged).
          </p>
        </div>

        {/* Inline-edit day list */}
        <div className="cp-hor-list" ref={listRef}>
          {calendarData.map((cd) => {
            if (selectedDate === cd.date) return <React.Fragment key={cd.date}>{renderEditor(cd)}</React.Fragment>;
            const segs = segsByDate[cd.date] || [];
            const onDuty = onDutyHours(segs);
            const isOff = onDuty === 0;
            const rest = cd.restHours ?? (24 - onDuty);
            const tone = toneForRest(rest, isOff);
            const isRota = cd.source === 'baseline';
            return (
              <div
                key={cd.date}
                className="cp-il"
                ref={(el) => { rowRefs.current[cd.date] = el; }}
                onClick={() => setSelectedDate(cd.date)}
              >
                <div className="dd">
                  <b>{dayLabel(cd.date)}</b>
                  <span>{cd.source === 'actual' ? 'logged' : isRota ? 'from rota' : '—'}</span>
                </div>
                <div className="bw"><Bar intervals={segmentsToIntervals(segs)} rota={isRota} /></div>
                <div className={`rr ${tone === 'off' ? 'off' : tone === 'red' ? 'red' : tone === 'amber' ? 'amber' : ''}`}>
                  {isOff ? 'off' : `${Number(rest.toFixed(1))}h rest`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HORHybridLog;
