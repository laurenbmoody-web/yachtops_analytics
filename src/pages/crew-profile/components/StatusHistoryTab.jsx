import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import LogoSpinner from '../../../components/LogoSpinner';
import {
  CREW_STATUSES, getStatusLabel, getStatusCellClass,
  buildStatusPeriods, getStatusForDay,
} from '../../../utils/crewStatus';
import { fetchProfileActivity, ACTIVITY_CATEGORIES, activityCat } from '../utils/profileActivity';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const fmtDay = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

// ── Status month-grid calendar ───────────────────────────────────────────────
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function MonthCalendar({ periods }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const totalDays = daysInMonth(calYear, calMonth);
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // Monday-based

  const prev = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); };
  const next = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); };
  const goToday = () => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); };

  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  return (
    <div className="act-cal">
      <div className="act-cal-nav">
        <button type="button" onClick={prev} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
        <span>{MONTHS[calMonth]} {calYear}</span>
        <button type="button" onClick={next} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
        <button type="button" className="act-cal-today" onClick={goToday}>Today</button>
      </div>
      <div className="act-mgrid act-mhead">
        {WEEKDAYS.map((w) => <div key={w} className="act-mwd">{w}</div>)}
      </div>
      <div className="act-mgrid">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="act-mcell is-blank" />;
          const day = new Date(calYear, calMonth, d);
          const stat = getStatusForDay(periods, day);
          const isToday = day.getTime() === today.getTime();
          return (
            <div
              key={d}
              title={`${d} ${MONTHS[calMonth]}: ${stat ? getStatusLabel(stat) : 'No data'}`}
              className={`act-mcell ${stat ? getStatusCellClass(stat) : 'act-mcell-empty'} ${day > today ? 'is-future' : ''} ${isToday ? 'is-today' : ''}`}
            >
              <span className="act-mnum">{d}</span>
              {stat && <span className="act-mstat">{getStatusLabel(stat)}</span>}
            </div>
          );
        })}
      </div>
      <div className="act-cal-legend">
        {CREW_STATUSES.map(({ value, label }) => (
          <span key={value}><i className={`act-sw ${getStatusCellClass(value)}`} />{label}</span>
        ))}
      </div>
    </div>
  );
}

const StatusHistoryTab = ({ userId, tenantId }) => {
  const [activity, setActivity] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('timeline'); // 'timeline' | 'calendar'
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!userId) { setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [acts, sh] = await Promise.all([
        fetchProfileActivity(userId),
        supabase.from('crew_status_history').select('*').eq('user_id', userId).order('changed_at', { ascending: true }),
      ]);
      if (cancelled) return;
      setActivity(acts);
      setStatusRows(sh.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, tenantId]);

  const periods = buildStatusPeriods(statusRows);
  // Only offer filters for categories that actually have events.
  const presentCats = ACTIVITY_CATEGORIES.filter((c) => activity.some((e) => e.category === c.id));
  const shown = filter === 'all' ? activity : activity.filter((e) => e.category === filter);

  return (
    <div>
      <div className="cd-controls" style={{ marginTop: 0 }}>
        <div className="cp-section-head">
          <span className="cp-section-num">08 /</span>
          <h3>Activity</h3>
        </div>
        <div className="cd-seg">
          <button type="button" className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
          <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Status calendar</button>
        </div>
      </div>
      <p className="kit-sub">Everything recorded on this profile — status changes, documents, kit, compliance, banking and profile edits.</p>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : view === 'calendar' ? (
        <MonthCalendar periods={periods} />
      ) : (
        <>
          {presentCats.length > 0 && (
            <div className="act-pills">
              <button type="button" className={`act-pill ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
              {presentCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`act-pill ${filter === c.id ? 'on' : ''}`}
                  onClick={() => setFilter(c.id)}
                  style={filter === c.id ? { borderColor: c.color, color: c.color, background: c.bg } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="cd-muted">No activity recorded yet.</p>
          ) : (
            <div className="act-list">
              {shown.map((e) => {
                const c = activityCat(e.category);
                return (
                  <div key={e.id} className="act-item">
                    <span className="act-ic" style={{ background: c.bg }}>
                      <Icon name={c.icon} size={15} style={{ color: c.color }} />
                    </span>
                    <div className="act-body">
                      <div className="act-title">{e.title}</div>
                      {e.detail && <div className="act-detail">{e.detail}</div>}
                      {e.actor && <div className="act-actor">by {e.actor}</div>}
                    </div>
                    <div className="act-when">{fmtDay(e.at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StatusHistoryTab;
