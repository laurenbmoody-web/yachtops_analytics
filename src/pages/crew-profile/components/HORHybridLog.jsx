import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { getCrewWorkEntries, addWorkEntries, deleteWorkEntriesForDate } from '../utils/horStorage';
import { fetchShiftTemplates, saveShiftTemplate, deleteShiftTemplate } from '../utils/horWorkEntries';
import './hor-time-modal.css';

// ── HOR hybrid log — compact calendar (overview) + inline-edit day list ──────
// The month calendar on the left is an always-on overview; the day list on the
// right is editable inline. Clicking a calendar day jumps to and expands its
// row, which carries a rota-style drag-paint grid + shift-type palette
// (duty/watch/standby/training — same vocabulary + colours as the rota) and
// saves automatically. Reusable per-user TEMPLATES (DB, owner-scoped) can be
// saved from a day and applied to one day or, in bulk mode, a range/selection
// of days at once. Rest figures + statuses come from the props the parent
// derives via the shared restHours engine — this component edits + draws only.

const SEG_PER_DAY = 48; // 30-minute segments

const TYPE_COLOR = { duty: '#1C1B3A', watch: '#C65A1A', standby: '#B8935E', training: '#6B7F6B' };
const PALETTE = [['duty', 'Duty'], ['watch', 'Watch'], ['standby', 'Standby'], ['training', 'Training']];

const segToHHMM = (i) => {
  const h = Math.floor(i / 2);
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

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
    {Array.from({ length: 25 }).map((_, h) => {
      const isMajor = h % 3 === 0; // 0, 3, 6, 9, 12, 15, 18, 21, 24 emphasised
      return (
        <span
          key={h}
          className={isMajor ? 'major' : 'minor'}
          style={{ left: `${(h / 24) * 100}%` }}
        >
          {h}
        </span>
      );
    })}
  </div>
);

// Scroll-wheel time picker (iPhone-alarm style) — a precise way to enter a
// start/end time block, alongside drag-painting. Values snap to the 30-min
// segment grid. Each column is a scroll-snap list; the centred row is the value.
const WHEEL_ITEM_H = 32;
const HOURS_START = Array.from({ length: 24 }, (_, h) => ({ value: h, label: String(h).padStart(2, '0') }));
const HOURS_END = Array.from({ length: 25 }, (_, h) => ({ value: h, label: String(h).padStart(2, '0') }));
const MINUTES = [{ value: 0, label: '00' }, { value: 30, label: '30' }];

const Wheel = ({ items, value, onChange }) => {
  const ref = useRef(null);
  const settle = useRef(null);
  useEffect(() => {
    const idx = items.findIndex((it) => it.value === value);
    if (ref.current && idx >= 0 && Math.round(ref.current.scrollTop / WHEEL_ITEM_H) !== idx) {
      ref.current.scrollTop = idx * WHEEL_ITEM_H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (!ref.current) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(ref.current.scrollTop / WHEEL_ITEM_H)));
      ref.current.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
      if (items[idx].value !== value) onChange(items[idx].value);
    }, 90);
  };
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  return (
    <div className="cp-wheel-frame">
      <div className="cp-wheel" ref={ref} onScroll={onScroll}>
        <div className="cp-wheel-pad" />
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            className={`cp-wheel-it${it.value === value ? ' sel' : ''}`}
            onClick={() => onChange(it.value)}
          >
            {it.label}
          </button>
        ))}
        <div className="cp-wheel-pad" />
      </div>
      <div className="cp-wheel-band" aria-hidden="true" />
    </div>
  );
};

const HORHybridLog = ({ crewId, calendarData = [], monthName, todayStr, onMonthChange, onChanged }) => {
  const [selectedDate, setSelectedDate] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [brush, setBrush] = useState('duty');
  // Day-builder modal: a list of typed segments (Duty 06:00–10:00, Standby
  // 11:00–14:00, …). Gaps between segments are rest/breaks. One wheel pair
  // edits whichever segment field is active.
  const [showWheel, setShowWheel] = useState(false);
  const [rows, setRows] = useState([]); // { type, sH, sM, eH, eM }
  const [activeRow, setActiveRow] = useState(0);
  const [activeField, setActiveField] = useState('start'); // 'start' | 'end' within active row
  const [draftSegs, setDraftSegs] = useState(() => new Set());
  const [draftTypes, setDraftTypes] = useState({});
  const painting = useRef(false);
  const dirty = useRef(false);
  const draftRef = useRef({ segs: new Set(), types: {} });
  const rowRefs = useRef({});
  const wrapRef = useRef(null);

  // Templates (DB, owner-scoped) + the editor's apply/save sub-state.
  const [templates, setTemplates] = useState([]);
  const [showApply, setShowApply] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  // Brief "✓ Saved" confirmation after each autosave — makes the silent
  // auto-persist visible so it's never ambiguous whether a change stuck.
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef(null);

  // Bulk-apply: select a range / set of days, then apply one template to all.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSel, setBulkSel] = useState(() => new Set());
  const [bulkAnchor, setBulkAnchor] = useState(null);
  const [bulkTplId, setBulkTplId] = useState('');

  const loadTemplates = useCallback(() => {
    fetchShiftTemplates().then((t) => setTemplates(t || [])).catch(() => setTemplates([]));
  }, []);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

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

  useEffect(() => {
    if (!selectedDate) return;
    setDraftSegs(new Set(segsByDate[selectedDate] || []));
    setDraftTypes({ ...(typesByDate[selectedDate] || {}) });
    setShowApply(false);
    setSavingTpl(false);
    setShowWheel(false);
    dirty.current = false;
    const el = rowRefs.current[selectedDate];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => { draftRef.current = { segs: draftSegs, types: draftTypes }; }, [draftSegs, draftTypes]);

  const afterSave = () => {
    setRefreshKey((k) => k + 1);
    setSavedFlash(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 2200);
    if (onChanged) onChanged();
  };
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Click anywhere on the page outside the calendar + day list to collapse the
  // open editor. Clicks inside the wrap (calendar days, day rows, the editor
  // itself + its paint drags) keep their own behaviour, so this never fights
  // the re-click-to-collapse toggle.
  useEffect(() => {
    // While the time modal is open it's portaled outside the wrap, so skip the
    // collapse-on-outside-click handler — otherwise interacting with the modal
    // would collapse the editor behind it.
    if (!selectedDate || bulkMode || showWheel) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setSelectedDate(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [selectedDate, bulkMode, showWheel]);

  // Esc closes the time modal.
  useEffect(() => {
    if (!showWheel) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setShowWheel(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showWheel]);

  const persistDraft = useCallback(() => {
    if (!selectedDate) return;
    const segs = Array.from(draftRef.current.segs).sort((a, b) => a - b);
    addWorkEntries(crewId, [{ date: selectedDate, workSegments: segs, segmentTypes: draftRef.current.types, source: 'edited' }]);
    afterSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, crewId]);

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

  // Day-builder helpers — segment index from a row's start/end.
  const rowStartSeg = (r) => r.sH * 2 + (r.sM >= 30 ? 1 : 0);
  const rowEndSeg = (r) => Math.min(SEG_PER_DAY, r.eH * 2 + (r.eM >= 30 ? 1 : 0));
  const setRowField = (idx, key, value) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  const addSegmentRow = () => setRows((rs) => {
    const last = rs[rs.length - 1];
    let sH = last ? last.eH : 8;
    const sM = last ? last.eM : 0;
    if (sH >= 24) sH = 22; // leave room for an end time
    const eH = Math.min(24, sH + 4);
    setActiveRow(rs.length);
    setActiveField('start');
    return [...rs, { type: 'duty', sH, sM, eH, eM: 0 }];
  });

  const removeSegmentRow = (idx) => setRows((rs) => {
    if (rs.length <= 1) return rs;
    const next = rs.filter((_, i) => i !== idx);
    setActiveRow((a) => Math.max(0, Math.min(a, next.length - 1)));
    return next;
  });

  // Paint every segment row onto the draft (gaps stay rest = breaks), persist —
  // same store as drag-painting. Later rows win on overlap.
  const saveDay = () => {
    if (!rows.length || rows.some((r) => rowEndSeg(r) <= rowStartSeg(r))) {
      showToast('Each segment needs an end after its start', 'error'); return;
    }
    const segs = new Set(draftSegs);
    const types = { ...draftTypes };
    rows.forEach((r) => {
      const s = rowStartSeg(r);
      const e = rowEndSeg(r);
      for (let i = s; i < e; i += 1) { segs.add(i); types[i] = r.type; }
    });
    setDraftSegs(segs);
    setDraftTypes(types);
    draftRef.current = { segs, types };
    addWorkEntries(crewId, [{ date: selectedDate, workSegments: Array.from(segs).sort((a, b) => a - b), segmentTypes: types, source: 'edited' }]);
    afterSave();
    setShowWheel(false);
    showToast(rows.length === 1 ? 'Added 1 segment' : `Added ${rows.length} segments`, 'success');
  };

  const clearDay = () => {
    setDraftSegs(new Set());
    setDraftTypes({});
    addWorkEntries(crewId, [{ date: selectedDate, workSegments: [], segmentTypes: {}, source: 'edited' }]);
    afterSave();
    showToast('Day cleared — logged as off', 'success');
  };
  const logAsRostered = () => { persistDraft(); showToast('Logged as rostered', 'success'); };
  const resetToBaseline = async () => {
    const date = selectedDate;
    if (!date) return;
    deleteWorkEntriesForDate(crewId, date);
    // onChanged === parent loadHORData: re-pulls the rota baseline into the
    // cache for the now-cleared day. Await it, then repaint the grid from the
    // restored baseline — the draft only auto-syncs on day-switch, so without
    // this the editor keeps showing the old edits and the reset looks like a
    // no-op.
    if (onChanged) await onChanged();
    const restored = (getCrewWorkEntries(crewId) || []).filter((e) => e?.date === date);
    const segs = new Set();
    const types = {};
    for (const e of restored) {
      (e.workSegments || []).forEach((s) => segs.add(s));
      Object.assign(types, e.segmentTypes || {});
    }
    setDraftSegs(segs);
    setDraftTypes(types);
    setRefreshKey((k) => k + 1);
    showToast('Reset to rota baseline', 'success');
  };

  // ── Templates ──────────────────────────────────────────────────────────────
  const doSaveTemplate = async () => {
    const name = (tplName || '').trim();
    if (!name) return;
    try {
      await saveShiftTemplate({
        name,
        workSegments: Array.from(draftSegs).sort((a, b) => a - b),
        segmentTypes: draftTypes,
      });
      setTplName('');
      setSavingTpl(false);
      loadTemplates();
      showToast('Template saved', 'success');
    } catch (e) {
      showToast('Could not save template', 'error');
    }
  };
  const applyTemplateToDay = (tpl) => {
    const segs = (tpl.work_segments || []).map(Number);
    const types = tpl.segment_types || {};
    setDraftSegs(new Set(segs));
    setDraftTypes({ ...types });
    addWorkEntries(crewId, [{ date: selectedDate, workSegments: segs, segmentTypes: types, source: 'edited' }]);
    afterSave();
    setShowApply(false);
    showToast(`Applied “${tpl.name}”`, 'success');
  };
  const duplicateTemplate = async (tpl) => {
    try {
      await saveShiftTemplate({ name: `${tpl.name} copy`, workSegments: tpl.work_segments || [], segmentTypes: tpl.segment_types || {} });
      loadTemplates();
    } catch (e) { showToast('Could not duplicate', 'error'); }
  };
  const removeTemplate = async (tpl) => {
    try { await deleteShiftTemplate(tpl.id); loadTemplates(); if (bulkTplId === tpl.id) setBulkTplId(''); }
    catch (e) { showToast('Could not delete', 'error'); }
  };

  // ── Bulk apply ───────────────────────────────────────────────────────────────
  const toggleBulk = (date, shiftKey) => {
    setBulkSel((prev) => {
      const n = new Set(prev);
      if (shiftKey && bulkAnchor) {
        const order = calendarData.map((c) => c.date);
        let a = order.indexOf(bulkAnchor);
        let b = order.indexOf(date);
        if (a > b) [a, b] = [b, a];
        for (let i = a; i <= b; i += 1) n.add(order[i]);
      } else if (n.has(date)) {
        n.delete(date);
      } else {
        n.add(date);
      }
      return n;
    });
    if (!shiftKey) setBulkAnchor(date);
  };
  const exitBulk = () => { setBulkMode(false); setBulkSel(new Set()); setBulkAnchor(null); };
  const applyBulk = () => {
    const tpl = templates.find((t) => t.id === bulkTplId);
    if (!tpl || bulkSel.size === 0) return;
    const dates = Array.from(bulkSel);
    const segs = (tpl.work_segments || []).map(Number);
    addWorkEntries(crewId, dates.map((d) => ({ date: d, workSegments: segs, segmentTypes: tpl.segment_types || {}, source: 'edited' })));
    afterSave();
    showToast(`Applied “${tpl.name}” to ${dates.length} day(s)`, 'success');
    exitBulk();
  };

  const onCalendarDay = (cd, e) => {
    if (bulkMode) toggleBulk(cd.date, e.shiftKey);
    else setSelectedDate((cur) => (cur === cd.date ? null : cd.date)); // click again to collapse
  };

  const renderEditor = (cd) => {
    const segs = Array.from(draftSegs);
    const onDuty = onDutyHours(segs);
    const isOff = onDuty === 0;
    const rest = Math.max(0, 24 - onDuty);
    const tone = toneForRest(rest, isOff);
    const isRota = cd.source === 'baseline';
    const statusWord = tone === 'off' ? 'Off' : tone === 'red' ? 'Below minimum' : tone === 'amber' ? 'Borderline' : 'Compliant';

    return (
      <div className="cp-ed" ref={(el) => { rowRefs.current[cd.date] = el; }}>
        <div className="top">
          <span className="dt">{dayLabel(cd.date)}</span>
          <span className="src">{isRota ? 'pre-filled from rota' : cd.source === 'actual' ? 'logged' : 'no entry'}</span>
          <button type="button" className="cp-ed-collapse" onClick={() => setSelectedDate(null)} aria-label="Collapse day" title="Collapse">▴</button>
        </div>

        <div className="cp-restbox">
          <span className={`dot ${tone}`} />
          <b className={`rest ${tone}`}>{Number(rest.toFixed(1))}h rest</b>
          <span className="sub"> · {Number(onDuty.toFixed(1))}h on duty</span>
          <span className="right">
            {savedFlash && <span className="auto saved">✓ Saved</span>}
            <span className={`verdict ${tone}`}>{statusWord}</span>
          </span>
        </div>

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
          {isRota && <button type="button" className="cp-preset act" onClick={logAsRostered}>✓ Log as rostered</button>}
          <button type="button" className="cp-preset" onClick={clearDay}>Clear (off)</button>
          {cd.source === 'actual' && <button type="button" className="cp-preset" onClick={resetToBaseline}>Reset to rota</button>}
          <button type="button" className="cp-preset" onClick={() => { setShowWheel((v) => !v); setRows([{ type: brush, sH: 8, sM: 0, eH: 12, eM: 0 }]); setActiveRow(0); setActiveField('start'); setShowApply(false); setSavingTpl(false); }}>Enter times ▾</button>
          <button type="button" className="cp-preset" onClick={() => { setShowApply((v) => !v); setSavingTpl(false); setShowWheel(false); }}>Apply template ▾</button>
          <button type="button" className="cp-preset act" onClick={() => { setSavingTpl((v) => !v); setShowApply(false); setShowWheel(false); }}>+ Add template</button>
        </div>

        {showWheel && createPortal((() => {
          const valid = rows.length > 0 && rows.every((r) => rowEndSeg(r) > rowStartSeg(r));
          // Summary: total on-duty, plus gaps between segments shown as breaks.
          let onDutySegs = 0;
          rows.forEach((r) => { if (rowEndSeg(r) > rowStartSeg(r)) onDutySegs += rowEndSeg(r) - rowStartSeg(r); });
          const ordered = rows.filter((r) => rowEndSeg(r) > rowStartSeg(r)).sort((a, b) => rowStartSeg(a) - rowStartSeg(b));
          let breakSegs = 0;
          for (let i = 1; i < ordered.length; i += 1) { const g = rowStartSeg(ordered[i]) - rowEndSeg(ordered[i - 1]); if (g > 0) breakSegs += g; }
          const summary = !valid
            ? 'Each segment needs an end after its start'
            : `${Number((onDutySegs * 0.5).toFixed(1))}h on duty${breakSegs > 0 ? ` · ${Number((breakSegs * 0.5).toFixed(1))}h break` : ''}`;

          const ar = rows[activeRow] || rows[0] || { sH: 8, sM: 0, eH: 12, eM: 0 };
          const isStart = activeField === 'start';
          const curH = isStart ? ar.sH : ar.eH;
          const curM = isStart ? ar.sM : ar.eM;
          const typeLabel = (k) => (PALETTE.find(([key]) => key === k) || [, 'Duty'])[1];

          return (
            <div className="htm-overlay" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setShowWheel(false); }}>
              <div className="htm-modal" role="dialog" aria-modal="true" aria-label="Build the day">
                <h4 className="htm-title">Build the day</h4>

                {/* Type control applies to the active segment row. */}
                <div className="htm-seg">
                  {PALETTE.map(([k, label]) => (
                    <button key={k} type="button" className={`htm-seg-b${ar.type === k ? ' act' : ''}`} onClick={() => setRowField(activeRow, 'type', k)}>
                      <span className="htm-sw" style={{ background: TYPE_COLOR[k] }} />{label}
                    </button>
                  ))}
                </div>

                <div className="htm-rows">
                  {rows.map((r, idx) => (
                    <div key={idx} className={`htm-row${idx === activeRow ? ' act' : ''}`}>
                      <button type="button" className="htm-row-type" onClick={() => setActiveRow(idx)}>
                        <span className="htm-sw" style={{ background: TYPE_COLOR[r.type] }} />{typeLabel(r.type)}
                      </button>
                      <button type="button" className={`htm-row-time${idx === activeRow && isStart ? ' act' : ''}`} onClick={() => { setActiveRow(idx); setActiveField('start'); }}>
                        {hhmm(r.sH, r.sM)}
                      </button>
                      <span className="htm-row-arrow" aria-hidden="true">→</span>
                      <button type="button" className={`htm-row-time${idx === activeRow && !isStart ? ' act' : ''}`} onClick={() => { setActiveRow(idx); setActiveField('end'); }}>
                        {r.eH === 24 ? '24:00' : hhmm(r.eH, r.eM)}
                      </button>
                      <button type="button" className="htm-row-x" disabled={rows.length <= 1} aria-label="Remove segment" onClick={() => removeSegmentRow(idx)}>×</button>
                    </div>
                  ))}
                </div>

                <button type="button" className="htm-breaktoggle" onClick={addSegmentRow}>+ add segment</button>

                <div className="htm-wheels">
                  <Wheel items={isStart ? HOURS_START : HOURS_END} value={curH} onChange={(v) => setRowField(activeRow, isStart ? 'sH' : 'eH', v)} />
                  <span className="htm-colon">:</span>
                  <Wheel items={MINUTES} value={curM} onChange={(v) => setRowField(activeRow, isStart ? 'sM' : 'eM', v)} />
                </div>

                <div className="htm-dur">{summary}</div>
                <div className="htm-actions">
                  <button type="button" className="htm-cancel" onClick={() => setShowWheel(false)}>Cancel</button>
                  <button type="button" className="htm-add" onClick={saveDay} disabled={!valid}>Save day</button>
                </div>
              </div>
            </div>
          );
        })(), document.body)}

        {savingTpl && (
          <div className="cp-timeinputs">
            <div style={{ flex: 1 }}>
              <label>Template name</label>
              <input
                type="text"
                value={tplName}
                placeholder="e.g. 4-on 8-off watch"
                onChange={(e) => setTplName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSaveTemplate(); }}
                style={{ width: '100%' }}
              />
            </div>
            <button type="button" className="apply" onClick={doSaveTemplate}>Save</button>
          </div>
        )}

        {showApply && (
          <div className="cp-tplmenu">
            {templates.length === 0 ? (
              <p className="empty">No templates yet — paint a day, then “+ Add template”.</p>
            ) : templates.map((t) => (
              <div key={t.id} className="cp-tplrow">
                <button type="button" className="name" onClick={() => applyTemplateToDay(t)}>
                  {t.name}
                  <span className="hrs">{((t.work_segments || []).length * 0.5)}h</span>
                </button>
                <button type="button" className="ic" title="Duplicate" onClick={() => duplicateTemplate(t)}><Icon name="Copy" size={14} /></button>
                <button type="button" className="ic del" title="Delete" onClick={() => removeTemplate(t)}><Icon name="Trash2" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="cp-flatcard p-6">
      {/* Bulk-apply toolbar */}
      <div className="cp-hor-toolbar">
        {!bulkMode ? (
          <>
            {/* The shift-type brush lives on this line (not inside each day box)
                so the open day editor has more room for the hours readout. */}
            {selectedDate && (
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
            )}
            <button type="button" className="cp-preset" onClick={() => setBulkMode(true)}>Bulk apply template…</button>
          </>
        ) : (
          <div className="cp-bulkbar">
            <span className="n">{bulkSel.size} day{bulkSel.size === 1 ? '' : 's'} selected</span>
            <select value={bulkTplId} onChange={(e) => setBulkTplId(e.target.value)}>
              <option value="">Choose template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className="apply" disabled={!bulkTplId || bulkSel.size === 0} onClick={applyBulk}>Apply</button>
            <button type="button" className="cp-tlink" onClick={exitBulk}>cancel</button>
            <span className="hint">click days (shift-click for a range)</span>
          </div>
        )}
      </div>

      <div className="cp-hor-wrap" ref={wrapRef}>
        {/* Compact calendar overview */}
        <div className="cp-hor-cal">
          <div className="cp-hor-subh">
            <button type="button" className="cp-hor-navbtn" onClick={() => onMonthChange?.(-1)} aria-label="Previous month">‹</button>
            <span className="mo">{monthName}</span>
            <button type="button" className="cp-hor-navbtn" onClick={() => onMonthChange?.(1)} aria-label="Next month">›</button>
          </div>
          <div className="cp-hor-grid">
            {DOW.map((d, i) => <div key={`dow-${i}`} className="cp-hor-dow">{d}</div>)}
            {Array.from({ length: startDow }).map((_, i) => <div key={`b-${i}`} className="cp-hor-c blank" />)}
            {calendarData.map((cd) => {
              const isProvisional = cd.date > todayStr && cd.source !== 'actual';
              const tone = cd.status === 'breach' ? 'red' : cd.status === 'warning' ? 'amber' : '';
              const picked = bulkMode && bulkSel.has(cd.date);
              const cls = `cp-hor-c${tone ? ` ${tone}` : ''}${isProvisional ? ' future' : ''}${(!bulkMode && selectedDate === cd.date) || picked ? ' sel' : ''}`;
              return (
                <div key={cd.date} className={cls} onClick={(e) => onCalendarDay(cd, e)}>
                  <div className="d">{cd.day}</div>
                  <div className="v">{Number((cd.restHours ?? 24).toFixed(1))}</div>
                </div>
              );
            })}
          </div>
          <p className="cp-hor-hint">
            {bulkMode
              ? 'Click days (shift-click for a range), pick a template, then Apply.'
              : 'Tap any day to open it on the right, then drag across the grid to paint hours. Pick a type first. Click the day again (or anywhere off the editor) to collapse it.'}
          </p>
        </div>

        {/* Inline-edit day list */}
        <div className="cp-hor-list">
          {calendarData.map((cd) => {
            if (!bulkMode && selectedDate === cd.date) return <React.Fragment key={cd.date}>{renderEditor(cd)}</React.Fragment>;
            const segs = segsByDate[cd.date] || [];
            const onDuty = onDutyHours(segs);
            const isOff = onDuty === 0;
            const rest = cd.restHours ?? (24 - onDuty);
            const tone = toneForRest(rest, isOff);
            const isRota = cd.source === 'baseline';
            const picked = bulkMode && bulkSel.has(cd.date);
            return (
              <div
                key={cd.date}
                className={`cp-il${picked ? ' picked' : ''}`}
                ref={(el) => { rowRefs.current[cd.date] = el; }}
                onClick={(e) => onCalendarDay(cd, e)}
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
