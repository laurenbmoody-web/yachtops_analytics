import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { classify, TYPE_META } from '../../../seatime/engine';

// Calendar view for the logged sea service. Two zooms:
//   • Month (A) — a real Mon–Sun grid with day-cell gridlines; service reads as
//     continuous banners spanning the days each voyage covers.
//   • Year (B) — an annual heatmap: 12 month-rows × day-cells filled by service
//     type, with tallies up top. A career-at-a-glance view.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_KEYS = ['seagoing', 'watchkeeping', 'standby', 'yard'];

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parseISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

// Expand voyage entries into a per-day map keyed by ISO date.
function buildDayMap(entries, vessels, config, serviceFilter) {
  const map = new Map();
  for (const e of entries) {
    if (!e.from || !e.to) continue;
    if (serviceFilter !== 'all' && e.type !== serviceFilter) continue;
    const v = vessels[e.vesselId] || {};
    const c = classify(e, v, config);
    const qual = !e.excluded && c.qual;
    const start = parseISO(e.from), end = parseISO(e.to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
      map.set(iso, { type: e.type, qual, excluded: !!e.excluded, vesselName: v.name, entryId: e.id });
    }
  }
  return map;
}

// Greedy lane packing of week segments so overlapping bars stack.
function packLanes(segs) {
  const laneEnds = [];
  segs.sort((a, b) => a.startCol - b.startCol);
  for (const s of segs) {
    let lane = laneEnds.findIndex((end) => end < s.startCol);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.endCol); } else { laneEnds[lane] = s.endCol; }
    s.lane = lane;
  }
  return Math.max(1, laneEnds.length);
}

const TypeBar = ({ type, qual, excluded, label, wide }) => {
  const tm = TYPE_META[type];
  return (
    <div className="stc-bar" style={{ color: tm.color, background: tm.bg, boxShadow: `inset 0 0 0 1px ${tm.color}22`, opacity: excluded ? 0.55 : 1 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d={tm.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {wide && <span className="stc-bar-l">{label}</span>}
      {!excluded && qual && <Icon name="Check" size={11} color="#5E8E6F" className="stc-bar-vm" />}
      {!excluded && !qual && <Icon name="X" size={11} color="#A32D2D" className="stc-bar-vm" />}
      {excluded && <span className="stc-bar-vm" style={{ fontSize: 8, fontWeight: 800, color: '#8A93A3' }}>EXCL</span>}
    </div>
  );
};

const SeaServiceCalendar = ({ entries, vessels, config, serviceFilter }) => {
  const dayMap = useMemo(() => buildDayMap(entries, vessels, config, serviceFilter), [entries, vessels, config, serviceFilter]);

  // Land where the data is: month/year of the most recent entry.
  const anchor = useMemo(() => {
    const ds = entries.map((e) => e.to || e.from).filter(Boolean).sort();
    return ds.length ? parseISO(ds[ds.length - 1]) : new Date();
  }, [entries]);

  const [zoom, setZoom] = useState('month');
  const [cursor, setCursor] = useState({ y: anchor.getFullYear(), m: anchor.getMonth() });

  const stepMonth = (n) => setCursor((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const stepYear = (n) => setCursor((c) => ({ ...c, y: c.y + n }));
  const goToday = () => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); };

  // ── month grid (A) ──
  const weeks = useMemo(() => {
    const { y, m } = cursor;
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7; // Mon = 0
    const dim = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push({ day: d, iso: isoOf(y, m, d) });
    while (cells.length % 7 !== 0) cells.push(null);
    const out = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cursor]);

  const renderMonth = () => (
    <>
      <div className="stc-nav">
        <button className="stc-navbtn" onClick={() => stepMonth(-1)} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
        <div className="stc-mo">{MONTHS[cursor.m]} {cursor.y}</div>
        <button className="stc-navbtn" onClick={() => stepMonth(1)} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
        <button className="stc-today" onClick={goToday}>Today</button>
      </div>
      <div className="stc-cal">
        <div className="stc-dow">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}</div>
        {weeks.map((week, wi) => {
          // segments: contiguous run of one entry within this week
          const byEntry = new Map();
          week.forEach((cell, ci) => {
            if (!cell) return;
            const info = dayMap.get(cell.iso);
            if (!info) return;
            const seg = byEntry.get(info.entryId);
            if (seg) { seg.endCol = ci; } else { byEntry.set(info.entryId, { startCol: ci, endCol: ci, info }); }
          });
          const segs = [...byEntry.values()];
          const lanes = packLanes(segs);
          return (
            <div className="stc-wk" key={wi} style={{ minHeight: 24 + lanes * 24 }}>
              <div className="stc-cells">
                {week.map((cell, ci) => (
                  <i key={ci} className={!cell ? 'off' : (ci >= 5 ? 'wknd' : '')}>{cell ? cell.day : ''}</i>
                ))}
              </div>
              <div className="stc-ov" style={{ gridTemplateRows: `repeat(${lanes}, 20px)` }}>
                {segs.map((s) => (
                  <div key={s.info.entryId} style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`, gridRow: s.lane + 1 }}>
                    <TypeBar type={s.info.type} qual={s.info.qual} excluded={s.info.excluded}
                      wide={s.endCol - s.startCol >= 1}
                      label={`${s.info.vesselName || ''} · ${TYPE_META[s.info.type].label}`} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  // ── year heatmap (B) ──
  const yearStats = useMemo(() => {
    const counts = { seagoing: 0, watchkeeping: 0, standby: 0, yard: 0, total: 0 };
    for (const [iso, info] of dayMap) {
      if (Number(iso.slice(0, 4)) !== cursor.y) continue;
      if (info.excluded || !info.qual) continue;
      counts[info.type] += 1; counts.total += 1;
    }
    return counts;
  }, [dayMap, cursor.y]);

  const renderYear = () => (
    <>
      <div className="stc-nav">
        <button className="stc-navbtn" onClick={() => stepYear(-1)} aria-label="Previous year"><Icon name="ChevronLeft" size={16} /></button>
        <div className="stc-mo">{cursor.y}</div>
        <button className="stc-navbtn" onClick={() => stepYear(1)} aria-label="Next year"><Icon name="ChevronRight" size={16} /></button>
        <button className="stc-today" onClick={goToday}>This year</button>
      </div>
      <div className="stc-kpis">
        <div className="stc-kpi"><b>{yearStats.total}</b><span>Days this year</span></div>
        <div className="stc-kpi"><b style={{ color: TYPE_META.seagoing.color }}>{yearStats.seagoing}</b><span>Seagoing</span></div>
        <div className="stc-kpi"><b style={{ color: TYPE_META.watchkeeping.color }}>{yearStats.watchkeeping}</b><span>Watchkeeping</span></div>
        <div className="stc-kpi"><b style={{ color: TYPE_META.standby.color }}>{yearStats.standby}</b><span>Standby</span></div>
        <div className="stc-kpi"><b style={{ color: TYPE_META.yard.color }}>{yearStats.yard}</b><span>Shipyard</span></div>
      </div>
      <div className="stc-heat">
        <div className="stc-hrow stc-hhead">
          <span className="stc-ml" />
          {Array.from({ length: 31 }, (_, i) => <span key={i} className="stc-hh">{[0, 4, 9, 14, 19, 24, 29].includes(i) ? i + 1 : ''}</span>)}
        </div>
        {MON_SHORT.map((mon, mi) => {
          const dim = new Date(cursor.y, mi + 1, 0).getDate();
          return (
            <div className="stc-hrow" key={mon}>
              <span className="stc-ml">{mon}</span>
              {Array.from({ length: 31 }, (_, di) => {
                if (di >= dim) return <span key={di} className="stc-hc none" />;
                const info = dayMap.get(isoOf(cursor.y, mi, di + 1));
                if (!info) return <span key={di} className="stc-hc" />;
                if (info.excluded) return <span key={di} className="stc-hc excl" />;
                const tm = TYPE_META[info.type];
                return <span key={di} className="stc-hc" title={`${di + 1} ${mon} · ${tm.label}${info.vesselName ? ' · ' + info.vesselName : ''}`}
                  style={info.qual ? { background: tm.color, borderColor: tm.color } : { background: '#fff', boxShadow: 'inset 0 0 0 1.5px #A32D2D' }} />;
              })}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="stc">
      <div className="stc-zoom">
        <button className={zoom === 'month' ? 'on' : ''} onClick={() => setZoom('month')}>Month</button>
        <button className={zoom === 'year' ? 'on' : ''} onClick={() => setZoom('year')}>Year</button>
      </div>
      {zoom === 'month' ? renderMonth() : renderYear()}
      <div className="stc-legend">
        {TYPE_KEYS.map((k) => (
          <span key={k}><i className="sw" style={{ background: zoom === 'year' ? TYPE_META[k].color : TYPE_META[k].bg, boxShadow: zoom === 'year' ? 'none' : `inset 0 0 0 1px ${TYPE_META[k].color}33` }} /> {TYPE_META[k].label === 'Yard' ? 'Shipyard' : TYPE_META[k].label}</span>
        ))}
        <span><Icon name="Check" size={12} color="#5E8E6F" /> Qualifies</span>
        <span><i className="sw" style={{ background: '#fff', boxShadow: 'inset 0 0 0 1.5px #A32D2D' }} /> Non-qualifying</span>
      </div>
    </div>
  );
};

export default SeaServiceCalendar;
