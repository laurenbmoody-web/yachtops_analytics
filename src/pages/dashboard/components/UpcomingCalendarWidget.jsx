import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { getStatusLabel } from '../../../utils/crewStatus';
import './calendar-widget.css';

// Calendar widget — a compact agenda of what's coming, across three streams:
//   • group   — vessel trips (charters / owner trips), tenant-wide
//   • crew    — crew changes (leave, travel, joins/returns), tenant-wide
//   • personal— the viewer's own calendar events (user-scoped)
// The full calendar lives at /ops-vessel-calendar.

const HORIZON = 21; // days ahead to look
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return toYmd(dt); };
const parse = (ymd) => new Date(`${ymd}T00:00:00`);
const dm = (ymd) => { const d = parse(ymd); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; };
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Crew';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const cleanLoc = (l) => String(l || '').replace(/\s*\([A-Z]{3}\)\s*$/, '').trim(); // drop airport codes

const UpcomingCalendarWidget = () => {
  const navigate = useNavigate();
  const { user, activeTenantId } = useAuth();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const todayStr = toYmd(new Date());
  const horizonEnd = addDays(todayStr, HORIZON);

  const load = useCallback(async () => {
    if (!activeTenantId || !user?.id) { setEvents([]); setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const [membersRes, tripsRes, crewRes, persRes] = await Promise.all([
        supabase.from('tenant_members')
          .select('user_id, display_name').eq('tenant_id', activeTenantId),
        // Group: trips overlapping [today, horizon]. is_deleted may be null.
        supabase.from('trips')
          .select('id, name, trip_type, start_date, end_date, is_deleted')
          .eq('tenant_id', activeTenantId)
          .lte('start_date', horizonEnd).gte('end_date', todayStr),
        // Crew changes: leave / travel / joins in the window.
        supabase.from('crew_calendar_entries')
          .select('id, user_id, kind, note, from_location, to_location, start_date, end_date')
          .eq('tenant_id', activeTenantId)
          .lte('start_date', horizonEnd).gte('end_date', todayStr),
        // Personal: the viewer's own events (no tenant column on this table).
        supabase.from('personal_calendar_events')
          .select('id, title, start_at, end_at, location')
          .eq('user_id', user.id)
          .gte('start_at', `${todayStr}T00:00:00`).lte('start_at', `${horizonEnd}T23:59:59`),
      ]);
      if (tripsRes.error) throw tripsRes.error;
      if (crewRes.error) throw crewRes.error;

      const nameByUser = new Map((membersRes.data || []).map((m) => [m.user_id, m.display_name]));
      const out = [];

      for (const t of (tripsRes.data || [])) {
        if (t.is_deleted) continue;
        const multi = t.end_date > t.start_date;
        out.push({
          id: `trip-${t.id}`, cat: 'group', to: '/trips-management-dashboard',
          start: t.start_date, end: t.end_date,
          tag: cap(t.trip_type) || null,
          title: (t.name || '').trim() || `${cap(t.trip_type) || 'Trip'}`,
          sub: multi ? `${dm(t.start_date)} → ${dm(t.end_date)} · ${t.trip_type ? cap(t.trip_type) : 'Trip'}` : (cap(t.trip_type) || 'Trip'),
        });
      }

      for (const c of (crewRes.data || [])) {
        const who = firstName(nameByUser.get(c.user_id));
        const label = (c.note || '').trim() || getStatusLabel(c.kind);
        const route = c.from_location && c.to_location
          ? `${cleanLoc(c.from_location)} → ${cleanLoc(c.to_location)}` : null;
        out.push({
          id: `crew-${c.id}`, cat: 'crew', to: '/crew-management',
          start: c.start_date, end: c.end_date || c.start_date,
          title: `${who} · ${label}`,
          sub: route || getStatusLabel(c.kind),
        });
      }

      for (const p of (persRes?.data || [])) {
        const day = String(p.start_at).slice(0, 10);
        const time = String(p.start_at).slice(11, 16);
        out.push({
          id: `pers-${p.id}`, cat: 'personal', to: '/ops-vessel-calendar',
          start: day, end: String(p.end_at || p.start_at).slice(0, 10),
          time: time && time !== '00:00' ? time : null,
          title: p.title || 'Personal event',
          sub: p.location || 'Personal',
        });
      }

      // Sort by the day it lands in the agenda: an event already under way sorts
      // to today; future events by their start.
      out.sort((a, b) => {
        const ka = a.start < todayStr ? todayStr : a.start;
        const kb = b.start < todayStr ? todayStr : b.start;
        return ka.localeCompare(kb) || a.cat.localeCompare(b.cat);
      });
      setEvents(out);
    } catch (err) {
      console.error('[UpcomingCalendarWidget] fetch error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, user?.id, todayStr, horizonEnd]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // Next 7 days for the strip, with the categories present on each.
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(todayStr, i);
    const cats = new Set();
    for (const e of events) { if (e.start <= date && e.end >= date) cats.add(e.cat); }
    const d = parse(date);
    return { date, dow: WD[d.getDay()][0], dnum: d.getDate(), isToday: i === 0, cats: [...cats] };
  }), [events, todayStr]);

  // Group the agenda by landing day (ongoing → today).
  const groups = useMemo(() => {
    const byDay = new Map();
    for (const e of events) {
      const day = e.start < todayStr ? todayStr : e.start;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(e);
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, todayStr]);

  const VISIBLE_GROUPS = 3;
  const shownGroups = groups.slice(0, VISIBLE_GROUPS);
  const hiddenCount = groups.slice(VISIBLE_GROUPS).reduce((n, [, evs]) => n + evs.length, 0);

  const groupLabel = (day) => {
    if (day === todayStr) return { label: 'Today', isToday: true };
    if (day === addDays(todayStr, 1)) return { label: 'Tomorrow', isToday: false };
    const d = parse(day);
    return { label: `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`, isToday: false };
  };

  const whenFor = (e, day) => {
    if (e.time) return { text: e.time, now: false };
    if (e.start < todayStr && e.end >= todayStr) return { text: 'now', now: true }; // ongoing
    if (e.end > e.start && day === (e.start < todayStr ? todayStr : e.start)) return { text: `→ ${dm(e.end)}`, now: false };
    return { text: '', now: false };
  };

  return (
    <div className="ce-card cw-cats rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="ce-title">Calendar</h3>
          <p className={`ce-status${!loading && !error && events.length ? ' is-attention' : ''}`}>
            {loading ? 'Loading…' : error ? 'Couldn’t load' : events.length ? `${events.length} in the next ${HORIZON} days` : 'Next 3 weeks'}
          </p>
        </div>
        <button type="button" className="ce-link" onClick={() => navigate('/ops-vessel-calendar')}>Open calendar</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="cw-skel" style={{ height: 46 }} />
          <div className="cw-skel" style={{ height: 40 }} />
          <div className="cw-skel" style={{ height: 40 }} />
        </div>
      ) : error ? (
        <div className="cw-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load the calendar.
          <button type="button" className="cw-retry" onClick={load}>Retry</button>
        </div>
      ) : (
        <>
          {/* Week strip */}
          <div className="cw-strip">
            {week.map((d) => (
              <div key={d.date} className={`cw-day${d.isToday ? ' is-today' : ''}`}>
                <span className="cw-dow">{d.dow}</span>
                <span className="cw-dnum">{d.dnum}</span>
                <span className="cw-dots">
                  {d.cats.map((c) => <i key={c} className={`cw-dot is-${c}`} />)}
                </span>
              </div>
            ))}
          </div>

          {events.length === 0 ? (
            <div className="cw-empty">
              <div className="ic"><Icon name="CalendarDays" size={18} /></div>
              <div className="t">Clear ahead</div>
              <div className="s">No trips, crew changes or events in the next {HORIZON} days</div>
            </div>
          ) : (
            <>
              <div className="cw-divider" />
              <div className="cw-agenda">
                {shownGroups.map(([day, evs]) => {
                  const gl = groupLabel(day);
                  return (
                    <React.Fragment key={day}>
                      <div className={`cw-ghead${gl.isToday ? ' is-today' : ''}`}><span className="n">{gl.label}</span></div>
                      {evs.map((e) => {
                        const w = whenFor(e, day);
                        return (
                          <div
                            key={e.id}
                            className={`cw-row is-${e.cat}`}
                            onClick={() => navigate(e.to)}
                            role="link" tabIndex={0}
                            onKeyDown={(ev) => ev.key === 'Enter' && navigate(e.to)}
                          >
                            <span className="cw-rail" />
                            <div className="cw-main">
                              <div className="cw-t">{e.cat === 'group' && e.tag && <span className="cw-tag">{e.tag}</span>}{e.title}</div>
                              <div className="cw-s">{e.sub}</div>
                            </div>
                            {w.text && <span className={`cw-when${w.now ? ' is-now' : ''}`}>{w.text}</span>}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="cw-foot">
                {hiddenCount > 0
                  ? <button type="button" className="cw-more" onClick={() => navigate('/ops-vessel-calendar')}>+{hiddenCount} more →</button>
                  : <span className="cw-legend">
                      <span><i style={{ background: 'var(--g)' }} />Vessel</span>
                      <span><i style={{ background: 'var(--c)' }} />Crew</span>
                    </span>}
                {hiddenCount > 0 && <span className="cw-legend">
                  <span><i style={{ background: 'var(--g)' }} />Vessel</span>
                  <span><i style={{ background: 'var(--c)' }} />Crew</span>
                </span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default UpcomingCalendarWidget;
