import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { getCrewWorkEntries, addWorkEntries, deleteWorkEntriesForDate } from '../utils/horStorage';

// ── HOR hybrid log — compact calendar (overview) + inline-edit day list ──────
// The month calendar on the left is an always-on overview; the day list on the
// right is editable inline. Clicking a calendar day jumps to and expands its
// row. The expanded row carries a rota-style drag-paint grid with a shift-type
// palette (duty/watch/standby/training) — the same vocabulary + colours as the
// rota — and saves automatically. Rest figures + statuses come from the props
// the parent derives via the shared restHours engine; this component edits +
// draws only, it never re-implements the MLC maths.

const SEG_PER_DAY = 48; // 30-minute segments

// Rota shift-type palette (RotationTemplateEditor.TYPE_COLOR). 'erase' clears.
const TYPE_COLOR = { duty: '#1C1B3A', watch: '#C65A1A', standby: '#B8935E', training: '#6B7F6B' };
const PALETTE = [['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'], ['training', 'Training']];

const segToHHMM = (i) => {
  const h = Math.floor(i / 2);
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Worked segments (+ types) → contiguous same-type blocks in decimal hours.
const segmentsToTypedBlocks = (segs, types = {}) => {
  const on = new Set(segs || []);
  const typeAt = (i) => types[i] || types[String(i)] || 'duty';
  const out = [];
  let start = null;
  let cur = null;
  for (let i = 0; i < SEG_PER_DAY; i += 1) {
    const isOn = on.has(i);
    const t = isOn ? typeAt(i) : null;
    if (start !== null && (!isOn || t !== cur)) {
      out.push({ s: start / 2, e: i / 2, type: cur });
      start = null; cur = null;
    }
    if (isOn && start === null) { start = i; cur = t; }
  }
  if (start !== null) out.push({ s: start / 2, e: 24, type: cur });
  return out;
};

const onDutyHours = (segs) => (segs?.length || 0) * 0.5;
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

const Bar = ({ blocks, rota, big }) => (
  <div className={`cp-bar${big ? ' big' : ''}`}>
    {blocks.map((b, i) => (
      <span
        key={i}
        className={`blk${rota ? ' rota' : ''}`}
        style={{
          left: `${(b.s / 24) * 100}%`,
          width: `${((b.e - b.s) / 24) * 100}%`,
          ...(rota ? {} : { background: TYPE_COLOR[b.type] || TYPE_COLOR.duty }),
        }}
      />
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

const HORHybridLog = ({ crewId, calendarData = [], monthName, todayStr, onMonthChange, onChanged }) => {
  const [selectedDate, setSelectedDate] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [brush, setBrush] = useState('duty');
  const [draftSegs, setDraftSegs] = useState(() => new Set());
  const [draftTypes, setDraftTypes] = useState({});
  const painting = useRef(false);
  const dirty = useRef(false);
  const draftRef = useRef({ segs: new Set(), types: {} });
  const rowRefs = useRef({});

  // Per-date segments + types, from the same localStorage cache the engine uses.
  const { segsByDate, typesByDate } = useMemo(() => {
    const segs = {};
    const types = {};
    for (const e of getCrewWorkEntries(crewId) || []) {
      if (!e?.date) continue;
      const set = new Set(segs[e.date] || []);
      (e.workSegments || []).forEach((s) => set.add(s));
      segs[e.date] = Array.from(set).sort((a, b) => a - b);
      types[e.date] = { ...(types[e.date] || {}), ...(e.segmentTypes || {}) };
    }
    return { segsByDate: segs, typesByDate: types };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewId, calendarData, refreshKey]);

  const startDow = useMemo(() => {
    const first = calendarData[0];
    if (!first?.date) return 0;
    const [y, m] = first.date.split('-').map(Number);
    return new Date(y, m - 1, 1).getDay();
  }, [calendarData]);

  // Seed the draft from the selected day's current segments/types.
  useEffect(() => {
    if (!selectedDate) return;
    setDraftSegs(new Set(segsByDate[selectedDate] || []));
    setDraftTypes({ ...(typesByDate[selectedDate] || {}) });
    dirty.current = false;
    const el = rowRefs.current[selectedDate];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => { draftRef.current = { segs: draftSegs, types: draftTypes }; }, [draftSegs, draftTypes]);

  const afterSave = () => { setRefreshKey((k) => k + 1); if (onChanged) onChanged(); };

  const persistDraft = useCallback(() => {
    if (!selectedDate) return;
    const segs = Array.from(draftRef.current.segs).sort((a, b) => a - b);
    addWorkEntries(crewId, [{ date: selectedDate, workSegments: segs, segmentTypes: draftRef.current.types, source: 'edited' }]);
    afterSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, crewId]);

  // End any paint drag on a global mouseup; persist if cells changed.
  useEffect(() => {
    const up = () => {
      painting.current = false;
      if (dirty.current) { dirty.current = false; persistDraft(); }
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [persistDraft]);

  const applyBrush = (i) => {
    dirty.current = true;
    setDraftSegs((prev) => {
      const n = new Set(prev);
      if (brush === 'erase') n.delete(i); else n.add(i);
      return n;
    });
    setDraftTypes((prev) => {
      const n = { ...prev };
      if (brush === 'erase') delete n[i]; else n[i] = brush;
      return n;
    });
  };

  const clearDay = () => {
    setDraftSegs(new Set());
    setDraftTypes({});
    addWorkEntries(crewId, [{ date: selectedDate, workSegments: [], segmentTypes: {}, source: 'edited' }]);
    afterSave();
    showToast('Day cleared — logged as off', 'success');
  };
  const logAsRostered = () => { persistDraft(); showToast('Logged as rostered', 'success'); };
  const resetToBaseline = () => {
    deleteWorkEntriesForDate(crewId, selectedDate);
    afterSave();
    showToast('Reset to rota baseline', 'success');
  };

  const renderEditor = (cd) => {
    const segs = Array.from(draftSegs);
    const onDuty = onDutyHours(segs);
    const isOff = onDuty === 0;
    const rest = Math.max(0, 24 - onDuty);
    const tone = toneForRest(rest, isOff);
    const isRota = cd.source === 'baseline';
    const statusWord = isOff ? 'off' : tone === 'red' ? '✕ breach' : tone === 'amber' ? '⚠ marginal' : '✓ compliant';

    return (
      <div className="cp-ed" ref={(el) => { rowRefs.current[cd.date] = el; }}>
        <div className="top">
          <span className="dt">{dayLabel(cd.date)}</span>
          <span className="src">{isRota ? 'pre-filled from rota' : cd.source === 'actual' ? 'logged' : 'no entry'}</span>
        </div>

        {/* Type palette — pick a brush, then drag across the grid. */}
        <div className="cp-pal">
          {PALETTE.map(([k, label]) => (
            <button key={k} type="button" className={`cp-pal-b${brush === k ? ' act' : ''}`} onClick={() => setBrush(k)}>
              <span className="sw" style={{ background: TYPE_COLOR[k] }} />{label}
            </button>
          ))}
          <button type="button" className={`cp-pal-b${brush === 'erase' ? ' act' : ''}`} onClick={() => setBrush('erase')}>
            <span className="sw erase" />Erase
          </button>
        </div>

        {/* 48-cell drag-paint grid (00:00–24:00, 30-min cells). */}
        <div className="cp-paint" onMouseLeave={() => { painting.current = false; }}>
          {Array.from({ length: SEG_PER_DAY }).map((_, i) => {
            const onCell = draftSegs.has(i);
            const t = onCell ? (draftTypes[i] || draftTypes[String(i)] || 'duty') : null;
            return (
              <div
                key={i}
                className={`cp-paint-c${onCell ? ' on' : ''}`}
                style={onCell ? { background: TYPE_COLOR[t] } : undefined}
                onMouseDown={() => { painting.current = true; applyBrush(i); }}
                onMouseEnter={() => { if (painting.current) applyBrush(i); }}
              />
            );
          })}
        </div>
        <Ticks />

        <div className="cp-presets">
          {isRota && (
            <button type="button" className="cp-preset act" onClick={logAsRostered}>✓ Log as rostered</button>
          )}
          <button type="button" className="cp-preset" onClick={clearDay}>Clear (off)</button>
          {cd.source === 'actual' && (
            <button type="button" className="cp-preset" onClick={resetToBaseline}>Reset to rota</button>
          )}
        </div>

        <div className="cp-restbox">
          On duty <b className="ink">{Number(onDuty.toFixed(1))}h</b> · Rest{' '}
          <b className={tone === 'off' ? '' : tone}>{Number(rest.toFixed(1))}h</b> {statusWord}
          <span className="auto">saves automatically</span>
        </div>
      </div>
    );
  };

  return (
    <div className="cp-flatcard p-6">
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
            Tap any day to open it on the right, then drag across the grid to paint hours. Pick a type (duty / watch / standby / training) first.
          </p>
        </div>

        {/* Inline-edit day list */}
        <div className="cp-hor-list">
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
                <div className="bw"><Bar blocks={segmentsToTypedBlocks(segs, typesByDate[cd.date])} rota={isRota} /></div>
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
